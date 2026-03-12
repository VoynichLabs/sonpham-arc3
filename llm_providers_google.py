"""Google Gemini provider — models with function calling, caching, and tool execution."""

import base64
import hashlib
import io
import logging
import os
import re
import threading
import time
from typing import Optional

from models import (
    SYSTEM_MSG, THINKING_BUDGETS, _discovered_local_models,
)

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# TOOL EXECUTION — Python sandbox for Gemini function calling
# ═══════════════════════════════════════════════════════════════════════════

_tool_sessions: dict[str, dict] = {}
_tool_session_lock = threading.Lock()


def _get_tool_declarations():
    from google import genai
    return genai.types.Tool(function_declarations=[
        genai.types.FunctionDeclaration(
            name="run_python",
            description=(
                "Execute Python code to analyse the game grid. "
                "Pre-imported: numpy (as np), collections, itertools. "
                "Available variables: `grid` (numpy 2D int array of current grid), "
                "`prev_grid` (numpy 2D int array of previous grid, or None). "
                "Variables you define persist across calls within the same turn. "
                "Use print() to return results. "
                "IMPORTANT: Keep code short and simple — use numpy vectorized ops, "
                "avoid nested loops over large arrays. Combine analyses into one call "
                "when possible. You have max 3 tool calls per turn, so be efficient."
            ),
            parameters={
                "type": "OBJECT",
                "properties": {
                    "code": {
                        "type": "STRING",
                        "description": "Python code to execute. Use print() for output.",
                    }
                },
                "required": ["code"],
            },
        ),
    ])


_BLOCKED_MODULES = frozenset({
    'os', 'sys', 'subprocess', 'shutil', 'pathlib', 'socket', 'http',
    'urllib', 'requests', 'httpx', 'aiohttp', 'ftplib', 'smtplib',
    'ctypes', 'multiprocessing', 'signal', 'importlib', 'code', 'codeop',
    'compileall', 'py_compile', 'zipimport', 'pkgutil', 'pkg_resources',
})


def _safe_import(name, *args, **kwargs):
    top_level = name.split('.')[0]
    if top_level in _BLOCKED_MODULES:
        raise ImportError(f"Module '{name}' is not allowed in the sandbox")
    return __builtins__['__import__'](name, *args, **kwargs) \
        if isinstance(__builtins__, dict) \
        else __import__(name, *args, **kwargs)


def _get_or_create_tool_session(session_id: str, grid, prev_grid) -> dict:
    import numpy as np
    import collections
    import itertools

    with _tool_session_lock:
        sess = _tool_sessions.get(session_id)
        if sess is None:
            if isinstance(__builtins__, dict):
                safe_builtins = dict(__builtins__)
            else:
                safe_builtins = {k: getattr(__builtins__, k) for k in dir(__builtins__)
                                 if not k.startswith('_')}
                safe_builtins['__import__'] = __builtins__.__import__

            safe_builtins['open'] = None
            safe_builtins['eval'] = None
            safe_builtins['exec'] = None
            safe_builtins['compile'] = None
            safe_builtins['breakpoint'] = None
            safe_builtins['exit'] = None
            safe_builtins['quit'] = None
            safe_builtins['__import__'] = _safe_import

            ns = {
                '__builtins__': safe_builtins,
                'np': np,
                'numpy': np,
                'collections': collections,
                'itertools': itertools,
                'Counter': collections.Counter,
                'defaultdict': collections.defaultdict,
            }
            sess = {'namespace': ns, 'created_at': time.time()}
            _tool_sessions[session_id] = sess

    ns = sess['namespace']
    ns['grid'] = np.array(grid) if grid else np.array([[]])
    ns['prev_grid'] = np.array(prev_grid) if prev_grid else None
    return sess


def _execute_python(session_id: str, code: str, grid, prev_grid, timeout: float = 5.0) -> str:
    sess = _get_or_create_tool_session(session_id, grid, prev_grid)
    ns = sess['namespace']

    output_buf = io.StringIO()
    error = [None]

    def _run():
        import builtins
        def captured_print(*args, **kwargs):
            kwargs['file'] = output_buf
            builtins.print(*args, **kwargs)
        if isinstance(ns['__builtins__'], dict):
            ns['__builtins__']['print'] = captured_print
        try:
            exec(code, ns)
        except Exception as e:
            error[0] = f"{type(e).__name__}: {e}"

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=timeout)

    if t.is_alive():
        return "[TIMEOUT] Code execution exceeded 5 seconds."

    output = output_buf.getvalue()
    if error[0]:
        output = (output + "\n" + error[0]).strip()

    if len(output) > 4000:
        output = output[:4000] + "\n... [truncated]"

    return output or "(no output)"


def _cleanup_tool_session(session_id: str):
    with _tool_session_lock:
        _tool_sessions.pop(session_id, None)


# ═══════════════════════════════════════════════════════════════════════════
# GEMINI CONTEXT CACHING
# ═══════════════════════════════════════════════════════════════════════════

_gemini_cache_registry: dict[tuple, dict] = {}
_gemini_cache_lock = threading.Lock()
_GEMINI_CACHE_MIN_CHARS = 130_000
_GEMINI_CACHE_TTL_MINUTES = 30


def _get_or_create_gemini_cache(model: str, static_content: str) -> str | None:
    if len(static_content) < _GEMINI_CACHE_MIN_CHARS:
        return None

    content_hash = hashlib.sha256(static_content.encode()).hexdigest()[:16]
    cache_key = (model, content_hash)

    with _gemini_cache_lock:
        cached = _gemini_cache_registry.get(cache_key)
        if cached and time.time() < cached["expires_at"]:
            return cached["cache_name"]

    try:
        from google import genai
        api_key = os.environ.get("GEMINI_API_KEY", "")
        client = genai.Client(api_key=api_key)

        cache = client.caches.create(
            model=model,
            config=genai.types.CreateCachedContentConfig(
                contents=[genai.types.Content(
                    role="user",
                    parts=[genai.types.Part.from_text(text=static_content)],
                )],
                ttl=f"{_GEMINI_CACHE_TTL_MINUTES * 60}s",
                display_name=f"arc-agi-{content_hash[:8]}",
            ),
        )

        with _gemini_cache_lock:
            _gemini_cache_registry[cache_key] = {
                "cache_name": cache.name,
                "expires_at": time.time() + (_GEMINI_CACHE_TTL_MINUTES * 60) - 60,
            }
        logger.info(f"Created Gemini cache: {cache.name} for model {model}")
        return cache.name
    except Exception as e:
        logger.warning(f"Gemini cache creation failed: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════
# GEMINI CALL FUNCTION
# ═══════════════════════════════════════════════════════════════════════════

def _call_gemini(model_name: str, prompt: str, image_b64: str | None = None,
                  tools_enabled: bool = False, session_id: str | None = None,
                  grid=None, prev_grid=None,
                  cached_content_name: str | None = None,
                  thinking_level: str = "low",
                  max_tokens: int = 16384) -> dict | str:
    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY", "")
    client = genai.Client(api_key=api_key)

    parts = []
    if image_b64:
        image_bytes = base64.b64decode(image_b64)
        parts.append(genai.types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
    parts.append(genai.types.Part.from_text(text=f"{SYSTEM_MSG}\n\n{prompt}"))
    contents = [genai.types.Content(role="user", parts=parts)]

    is_thinking_model = any(x in model_name for x in ("2.5", "3-pro", "3-flash", "3.1"))
    budget = THINKING_BUDGETS.get(thinking_level, 1024)
    config = genai.types.GenerateContentConfig(
        temperature=0.3,
        max_output_tokens=max_tokens,
    )
    if is_thinking_model:
        config.thinking_config = genai.types.ThinkingConfig(
            thinking_budget=budget,
        )
    if tools_enabled:
        config.tools = [_get_tool_declarations()]
    if cached_content_name:
        config.cached_content = cached_content_name

    tool_calls_log = []
    max_rounds = 3

    for round_i in range(max_rounds):
        if round_i == max_rounds - 1 and config.tools:
            config.tools = None

        response = client.models.generate_content(
            model=model_name, contents=contents, config=config,
        )

        if response.candidates:
            fr = getattr(response.candidates[0], 'finish_reason', None)
            fr_str = str(fr).upper() if fr else ""
            if "MALFORMED" in fr_str and tools_enabled and session_id:
                raw_text = ""
                try:
                    raw_text = response.text or ""
                except Exception:
                    fm = getattr(response.candidates[0], 'finish_message', None)
                    if fm:
                        raw_text = fm
                code_match = re.search(r'```python\s*\n(.*?)```', raw_text, re.DOTALL)
                if code_match:
                    code = code_match.group(1).strip()
                    logger.info(
                        f"Recovered code from MALFORMED_FUNCTION_CALL (len={len(code)}), executing as run_python"
                    )
                    output = _execute_python(session_id, code, grid, prev_grid)
                    tool_calls_log.append({
                        "name": "run_python",
                        "arguments": {"code": code},
                        "output": output,
                    })
                    contents.append(genai.types.Content(
                        role="model",
                        parts=[genai.types.Part.from_function_call(
                            name="run_python", args={"code": code}
                        )],
                    ))
                    contents.append(genai.types.Content(
                        role="user",
                        parts=[genai.types.Part.from_function_response(
                            name="run_python",
                            response={"result": output},
                        )],
                    ))
                    config.tools = None
                    continue
                else:
                    logger.warning(
                        "MALFORMED_FUNCTION_CALL but couldn't extract code, retrying without tools"
                    )
                    config.tools = None
                    continue

        has_function_call = False
        if response.candidates and response.candidates[0].content:
            model_parts = response.candidates[0].content.parts or []
            fn_call_parts = [p for p in model_parts if p.function_call]

            if fn_call_parts and tools_enabled and session_id:
                has_function_call = True
                contents.append(response.candidates[0].content)

                fn_response_parts = []
                for part in fn_call_parts:
                    fc = part.function_call
                    code = fc.args.get("code", "") if fc.args else ""
                    logger.info(f"Tool call: {fc.name}, code length: {len(code)}")

                    output = _execute_python(session_id, code, grid, prev_grid)

                    tool_calls_log.append({
                        "name": fc.name,
                        "arguments": {"code": code},
                        "output": output,
                    })

                    fn_response_parts.append(
                        genai.types.Part.from_function_response(
                            name=fc.name,
                            response={"result": output},
                        )
                    )

                contents.append(genai.types.Content(
                    role="user",
                    parts=fn_response_parts,
                ))
                continue

        final_text = response.text if response.text else ""

        truncated = False
        if response.candidates:
            fr = getattr(response.candidates[0], 'finish_reason', None)
            if fr and str(fr).upper() in ("MAX_TOKENS", "2"):
                truncated = True

        usage = {}
        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            um = response.usage_metadata
            usage = {
                "prompt_tokens": getattr(um, 'prompt_token_count', 0) or 0,
                "completion_tokens": getattr(um, 'candidates_token_count', 0) or 0,
                "total_tokens": getattr(um, 'total_token_count', 0) or 0,
            }

        cache_active = cached_content_name is not None
        if tools_enabled:
            return {"text": final_text, "tool_calls": tool_calls_log, "usage": usage,
                    "cache_active": cache_active, "truncated": truncated}
        return {"text": final_text, "truncated": truncated} if truncated else final_text

    final_text = ""
    try:
        final_text = response.text or ""
    except Exception:
        pass
    if tools_enabled:
        return {"text": final_text, "tool_calls": tool_calls_log, "usage": {},
                "cache_active": cached_content_name is not None}
    return final_text
