"""GitHub Copilot provider — device flow OAuth + API calls."""

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# COPILOT AUTH STATE
# ═══════════════════════════════════════════════════════════════════════════

_COPILOT_TOKEN_FILE = Path(__file__).parent / "data" / ".copilot_token"


def _load_copilot_token() -> Optional[str]:
    try:
        if _COPILOT_TOKEN_FILE.exists():
            return _COPILOT_TOKEN_FILE.read_text().strip() or None
    except Exception:
        pass
    return None


def _save_copilot_token(token: Optional[str]):
    try:
        _COPILOT_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        if token:
            _COPILOT_TOKEN_FILE.write_text(token)
        elif _COPILOT_TOKEN_FILE.exists():
            _COPILOT_TOKEN_FILE.unlink()
    except Exception:
        pass


copilot_oauth_token: Optional[str] = _load_copilot_token()
copilot_api_token: Optional[str] = None
copilot_token_expiry: float = 0.0
copilot_device_code: Optional[str] = None
copilot_auth_lock = threading.Lock()


def _get_copilot_token() -> str:
    """Fetch a fresh Copilot API token using the stored OAuth token."""
    global copilot_api_token, copilot_token_expiry
    with copilot_auth_lock:
        if not copilot_oauth_token:
            raise ValueError("Copilot not authenticated. Complete the OAuth flow first.")
        if time.time() > copilot_token_expiry - 300:
            import httpx
            resp = httpx.get(
                "https://api.github.com/copilot_internal/v2/token",
                headers={"Authorization": f"token {copilot_oauth_token}",
                         "Accept": "application/json"},
                timeout=30.0,
            )
            if resp.status_code != 200:
                logger.error("Copilot token exchange failed: %s %s", resp.status_code, resp.text)
                resp.raise_for_status()
            data = resp.json()
            logger.info("Copilot token exchange OK, keys: %s", list(data.keys()))
            copilot_api_token = data["token"]
            copilot_token_expiry = data.get("expires_at", time.time() + 1500)
        return copilot_api_token


def _call_copilot(model_name: str, prompt: str, image_b64: str | None = None) -> str:
    """Call GitHub Copilot via OpenAI-compatible API."""
    from llm_providers_openai import _call_openai_compatible
    
    token = _get_copilot_token()
    return _call_openai_compatible(
        url="https://api.githubcopilot.com/chat/completions",
        api_key=token,
        model=model_name,
        prompt=prompt,
        image_b64=image_b64,
        extra_headers={
            "Copilot-Integration-Id": "vscode-chat",
            "editor-version": "vscode/1.100.0",
            "user-agent": "GitHubCopilotChat/0.24.0",
        },
    )
