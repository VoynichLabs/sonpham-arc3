# OAuth Integration Plan — Claude Code & OpenAI Codex

**Author:** Bubba (OpenClaw agent)  
**Date:** 2026-03-11  
**Branch:** refactor/phase-1-modularization  
**Status:** Design document — not yet implemented

---

## Overview

This document describes how to add OAuth authentication for **Claude Code** (Anthropic) and **OpenAI Codex** to the ARC-AGI-3 project, following the same patterns already established in this codebase for GitHub Copilot (device-code OAuth) and Google (authorization-code OAuth).

---

## Existing OAuth Patterns in This Codebase

The project already implements two OAuth flows you can model from:

### 1. GitHub Copilot — Device Code Flow (`server.py` lines 1116–1192)

**How it works:**
1. Client calls `POST /api/copilot/auth/start` → server requests a device code from GitHub
2. Server returns `user_code` + `verification_uri` for the user to visit in their browser
3. Client polls `POST /api/copilot/auth/poll` → server exchanges device code for access token
4. Token stored in `data/.copilot_token` via `llm_providers._save_copilot_token()`
5. `llm_providers.copilot_oauth_token` holds the live token

**Key files:**
- `server.py`: `/api/copilot/auth/start`, `/api/copilot/auth/poll`, `/api/copilot/auth/status`
- `llm_providers.py`: `copilot_oauth_token`, `copilot_device_code`, `copilot_auth_lock`, `_save_copilot_token()`

### 2. Google OAuth — Authorization Code + PKCE (`server.py` lines 486–590)

**How it works:**
1. Client calls `GET /api/auth/google/login` → server redirects to Google consent screen
2. Google redirects back to `/api/auth/google/callback` with auth code
3. Server exchanges code for tokens, verifies via tokeninfo, stores user in Flask session

**Key files:**
- `server.py`: `/api/auth/logout`, `/api/auth/google/login`, `/api/auth/google/callback`
- `constants.py`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

---

## Plan: Adding Claude Code OAuth (Anthropic)

### Authentication Method
Anthropic uses **API key authentication**, not OAuth. However, Claude Code (the CLI tool) uses a **browser-based OAuth flow** to obtain API credentials when running in interactive mode.

The recommended approach for this project is **per-session API key**, matching the existing pattern for other providers (OpenAI, Gemini, etc.) already in `session_api_keys`.

### Implementation Steps

#### Step 1 — Add constants to `constants.py`
```python
# Anthropic / Claude Code
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
```

#### Step 2 — Add Claude Code provider to `llm_providers.py`
```python
# Claude Code auth state (API key — no OAuth required)
claude_api_key: Optional[str] = os.environ.get("ANTHROPIC_API_KEY") or None
```

Add a provider entry in `MODEL_REGISTRY` in `models.py`:
```python
"claude-3-5-sonnet": {
    "provider": "anthropic",
    "api_base": "https://api.anthropic.com/v1",
    "model_id": "claude-3-5-sonnet-20241022",
},
"claude-3-7-sonnet": {
    "provider": "anthropic",
    "api_base": "https://api.anthropic.com/v1",
    "model_id": "claude-3-7-sonnet-20250219",
},
```

#### Step 3 — Add API routes to `server.py`
```python
@app.route("/api/claude/auth/status")
def claude_auth_status():
    """Check whether an Anthropic API key is configured."""
    return jsonify({
        "authenticated": bool(llm_providers.claude_api_key),
        "source": "env" if os.environ.get("ANTHROPIC_API_KEY") else "session"
    })
```

For session-level key injection (matching the existing `session_api_keys` pattern):
```python
@app.route("/api/claude/auth/set-key", methods=["POST"])
def claude_set_key():
    """Allow user to supply their own Anthropic API key for this session."""
    data = request.get_json() or {}
    key = data.get("api_key", "").strip()
    if not key.startswith("sk-ant-"):
        return jsonify({"error": "Invalid Anthropic API key format"}), 400
    sid = _get_or_create_session_id()
    session_api_keys[sid] = {"anthropic": key}
    return jsonify({"status": "ok"})
```

#### Step 4 — Update `llm_providers.py` call routing
In the provider dispatch function, add:
```python
elif provider == "anthropic":
    import anthropic
    client = anthropic.Anthropic(api_key=claude_api_key or session_key)
    response = client.messages.create(
        model=model_id,
        max_tokens=max_tokens,
        messages=messages,
    )
    return response.content[0].text
```

#### Step 5 — Frontend (JS)
Add a Claude key input to the model selector UI in `static/js/scaffolding-agent-spawn.js` or the settings panel, following the same UX pattern as the existing API key fields.

---

## Plan: Adding OpenAI Codex OAuth

### Authentication Method
OpenAI uses **API key** authentication. The "Codex" models (`codex-mini-latest`, `o3`, `o4-mini`) are accessed through the standard OpenAI API — no separate OAuth flow required.

> **Note:** OpenAI's real-time OAuth (used by ChatGPT plugins) requires an OAuth 2.0 authorization code flow with a registered redirect URI. This project does not currently need that level of integration.

### Implementation Steps

#### Step 1 — Add constants to `constants.py`
```python
# OpenAI / Codex
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
```

#### Step 2 — Add model entries to `models.py`
```python
"codex-mini": {
    "provider": "openai",
    "api_base": "https://api.openai.com/v1",
    "model_id": "codex-mini-latest",
},
"o3": {
    "provider": "openai",
    "api_base": "https://api.openai.com/v1",
    "model_id": "o3",
},
"o4-mini": {
    "provider": "openai",
    "api_base": "https://api.openai.com/v1",
    "model_id": "o4-mini",
},
```

#### Step 3 — Add API routes to `server.py`
```python
@app.route("/api/openai/auth/status")
def openai_auth_status():
    """Check whether an OpenAI API key is configured."""
    return jsonify({
        "authenticated": bool(os.environ.get("OPENAI_API_KEY") or llm_providers.openai_api_key),
        "source": "env" if os.environ.get("OPENAI_API_KEY") else "session"
    })

@app.route("/api/openai/auth/set-key", methods=["POST"])
def openai_set_key():
    """Allow user to supply their own OpenAI API key for this session."""
    data = request.get_json() or {}
    key = data.get("api_key", "").strip()
    if not key.startswith("sk-"):
        return jsonify({"error": "Invalid OpenAI API key format"}), 400
    sid = _get_or_create_session_id()
    session_api_keys[sid] = {"openai": key}
    return jsonify({"status": "ok"})
```

#### Step 4 — Update `llm_providers.py` call routing
OpenAI is likely already partially implemented. For Codex/o-series models, ensure reasoning tokens are handled:
```python
elif provider == "openai":
    from openai import OpenAI
    client = OpenAI(api_key=openai_api_key or session_key)
    # o-series models use max_completion_tokens, not max_tokens
    kwargs = {"model": model_id, "messages": messages}
    if model_id.startswith("o"):
        kwargs["max_completion_tokens"] = max_tokens
    else:
        kwargs["max_tokens"] = max_tokens
    response = client.chat.completions.create(**kwargs)
    return response.choices[0].message.content
```

---

## If Full OAuth Is Required (Future)

If the project needs a proper OAuth 2.0 flow (e.g., to let users log in with their Anthropic or OpenAI account rather than paste a key), the pattern is:

### Using OpenClaw's Plugin OAuth Pattern

OpenClaw's plugin system (`docs/openclaw/tools/plugin.md`) defines a standard auth method interface:
```js
{
  id: "oauth",
  label: "OAuth",
  kind: "oauth",
  async run(ctx) {
    // Run OAuth flow and return auth profiles
  }
}
```

For ARC-AGI-3, the equivalent would be:
1. Register a redirect URI with the provider (Anthropic/OpenAI developer console)
2. Add `/api/[provider]/auth/login` → redirect to provider consent screen
3. Add `/api/[provider]/auth/callback` → exchange code, store token (following the Google pattern in `server.py:525`)
4. Use PKCE (`code_verifier`/`code_challenge`) for security
5. Store tokens encrypted in SQLite via `db.py`, not plaintext files

### CSRF Protection
Copy the existing Google OAuth state pattern:
```python
state = secrets.token_urlsafe(32)
flask_session["[provider]_oauth_state"] = state
# Verify in callback:
expected_state = flask_session.pop("[provider]_oauth_state", None)
if state != expected_state:
    abort(400)
```

---

## Environment Variables Required

Add to `.env.example` and `constants.py`:

```bash
# Anthropic / Claude Code
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI / Codex
OPENAI_API_KEY=sk-...

# Optional: OAuth credentials (only needed for full browser OAuth flow)
ANTHROPIC_CLIENT_ID=
ANTHROPIC_CLIENT_SECRET=
OPENAI_CLIENT_ID=
OPENAI_CLIENT_SECRET=
```

---

## Security Considerations

1. **Never log API keys** — already enforced by the existing `_save_copilot_token()` pattern
2. **Key format validation** — validate prefix (`sk-ant-` for Anthropic, `sk-` for OpenAI) before storing
3. **Session isolation** — use `session_api_keys[sid]` not global state for user-supplied keys
4. **Token expiry** — API keys don't expire; OAuth tokens do. If using full OAuth, implement refresh logic matching `copilot_token_expiry` pattern in `llm_providers.py`
5. **HTTPS only** — OAuth callbacks must use HTTPS in production; `OAUTHLIB_INSECURE_TRANSPORT=1` only for local dev

---

## Files to Modify (Summary)

| File | Change |
|------|--------|
| `constants.py` | Add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` env vars |
| `models.py` | Add Claude + Codex model entries to `MODEL_REGISTRY` |
| `llm_providers.py` | Add `claude_api_key`, `openai_api_key` state; add provider dispatch cases |
| `server.py` | Add `/api/claude/auth/*` and `/api/openai/auth/*` routes |
| `static/js/` | Add key input UI to model selector (scaffolding or settings panel) |
| `.env.example` | Document new env vars |

---

*Document authored by Bubba — OpenClaw agent on Mac Mini M4 Pro. Questions → #openclaw-bots.*
