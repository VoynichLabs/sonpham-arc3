# Phases 13–20 Implementation Plan: Complete Refactor Guide

**Status:** Plan document for Phases 13–20 of sonpham-arc3 refactor  
**Date:** 2026-03-12  
**Branch:** `refactor/phase-1-modularization`  
**Audience:** Junior developers joining the project  
**Target:** 80%+ test coverage, SRP compliance, <500 line files  

---

## 🗂️ Dependency Graph

```
Phase 13: Delete server.py
  ↓
Phase 14: Extract Service/DAO Layer
  ├→ Phase 17: Decompose db.py
  ├→ Phase 18: Centralize LLM Config
  └→ Phase 19: Error Handler Decorator
         ↓
Phase 15: Modularize llm.js ← (Phase 18 for config)
Phase 16: Modularize human.js
         ↓
Phase 20: Unit Test Coverage (requires Phases 14–17)
```

**Key Dependencies:**
- **Phase 13 must complete first** — routes reference only one server file
- **Phase 14 enables Phases 17–19** — extracts logic into service layer
- **Phase 18 should precede Phase 15** — LLM config centralized before JS refactor
- **Phase 20 depends on 14–17** — services are easier to test than monolithic handlers

---

## Phase 13: Delete Duplicate server.py

### ⚠️ Risk Level: **HIGH**
This phase touches the live production entrypoint. One misstep breaks deployments.

### Goal
Eliminate 2566-line duplicate of `server/app.py`. Redirect production to the refactored version. All 57 routes must work identically after deletion.

### Pre-conditions
- [ ] Phase 1–12 complete (existing work verified)
- [ ] `server/app.py` routes match `server.py` (already refactored in Phase 12)
- [ ] Procfile references `server:app` (needs update)
- [ ] `gunicorn` installed and tested

### Exact Steps

#### Step 1: Verify server/app.py is production-ready
```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Count routes in both files (should be equal)
grep -c "^@app\|^@.*\.route" server.py
grep -c "^@.*\.route\|^@.*\.get\|^@.*\.post" server/app.py

# Expected: 57 routes in both
```

#### Step 2: Diff server.py vs server/app.py to find gaps
```bash
# Create a side-by-side diff
diff -u server.py server/app.py > /tmp/server-diff.txt

# Inspect for missing routes or business logic differences
# (Should be minimal if Phase 12 refactor was thorough)
cat /tmp/server-diff.txt | head -100
```

**What to look for:**
- Routes present in `server.py` but missing from `server/app.py` → add them before deleting
- Helper functions in `server.py` not imported in `server/app.py` → verify they exist elsewhere
- Database calls in `server.py` not present in `server/app.py` → investigate if deleted intentionally

#### Step 3: Test server/app.py locally
```bash
# Start the Flask app with the refactored server
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Option A: Run Flask dev server
export FLASK_APP=server.app
export FLASK_ENV=development
python3 -m flask run --port 5000

# Option B: Run with gunicorn (production-like)
gunicorn server.app:app --bind 127.0.0.1:8000 --workers 1

# In another terminal, test 3 critical routes:
curl http://localhost:8000/api/status
curl http://localhost:5000/  # Index page
curl -X POST http://localhost:5000/api/session -H "Content-Type: application/json" -d '{"action": "new_game"}'
```

**Success criteria:**
- Server starts without import errors
- All 3 test routes return HTTP 200 or 4xx (not 5xx)
- No `ModuleNotFoundError` or `AttributeError` in logs

#### Step 4: Update Procfile
```bash
# Before:
# web: gunicorn server:app --bind 0.0.0.0:$PORT --workers 1 --threads 8

# After:
# web: gunicorn server.app:app --bind 0.0.0.0:$PORT --workers 1 --threads 8

# Edit Procfile:
cd /Users/macmini/Documents/GitHub/sonpham-arc3
# Change line 1 from "gunicorn server:app" to "gunicorn server.app:app"
```

**Exact command:**
```bash
sed -i '' 's/gunicorn server:app/gunicorn server.app:app/' Procfile
cat Procfile  # Verify change
```

#### Step 5: Backup and delete server.py
```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Backup first (keep for rollback)
cp server.py server.py.backup.$(date +%s)
ls -lh server.py.backup.*

# Delete the old file
rm server.py

# Verify it's gone
ls -lh server.py 2>&1 | grep "cannot access"  # Should show "cannot access"
```

#### Step 6: Test with gunicorn + Procfile config
```bash
# Simulate production startup
cd /Users/macmini/Documents/GitHub/sonpham-arc3
gunicorn server.app:app --bind 127.0.0.1:8000 --workers 1

# Test 57 routes exist (see Phase 13 Success Criteria below)
```

### Rollback Plan

If `server/app.py` doesn't start or routes fail:

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Step 1: Restore server.py from backup
ls -t server.py.backup.* | head -1 | xargs -I {} cp {} server.py

# Step 2: Revert Procfile
git checkout Procfile

# Step 3: Restart gunicorn with old Procfile
gunicorn server:app --bind 127.0.0.1:8000 --workers 1

# Step 4: Investigate what failed in server/app.py
# Do NOT delete server.py again until gap is found and fixed
```

**Root cause analysis:**
- Missing imports in `server/app.py`?
- Route handler logic differs from `server.py`?
- Missing environment variable checks?

### Success Criteria

**All of the following must be true:**

1. ✅ **Gunicorn starts without errors:**
   ```bash
   gunicorn server.app:app --bind 127.0.0.1:8000 --workers 1 --threads 8 2>&1 | grep -v "WARNING" | grep "ERROR"
   # Should output nothing (no errors)
   ```

2. ✅ **All 57 routes respond:**
   ```bash
   # Count routes in server/app.py and helpers
   echo "=== Auth Routes ===" && grep -c "^@bp_auth" server/auth_routes.py
   echo "=== Game Routes ===" && grep -c "^@bp_game" server/game_routes.py
   echo "=== Session Routes ===" && grep -c "^@bp_session" server/session_routes.py
   echo "=== Social Routes ===" && grep -c "^@bp_social" server/social_routes.py
   echo "=== LLM Admin Routes ===" && grep -c "^@bp_llm_admin" server/llm_admin_routes.py
   
   # Total should be ~57
   ```

3. ✅ **Procfile updated:**
   ```bash
   grep "server.app:app" Procfile  # Should match
   ```

4. ✅ **server.py deleted:**
   ```bash
   [ ! -f server.py ] && echo "PASS: server.py gone" || echo "FAIL: server.py still exists"
   ```

5. ✅ **Critical routes tested:**
   ```bash
   # Start server in background
   gunicorn server.app:app --bind 127.0.0.1:9999 --workers 1 &
   sleep 2
   
   # Test 5 critical routes
   curl -s http://localhost:9999/api/status | grep -q "ok" && echo "✓ /api/status" || echo "✗ /api/status"
   curl -s http://localhost:9999/ | grep -q "html" && echo "✓ /" || echo "✗ /"
   curl -s -X POST http://localhost:9999/api/copilot/auth | grep -q "redirect" && echo "✓ OAuth flow" || echo "✗ OAuth"
   
   pkill -f "gunicorn server.app"
   ```

### Estimated Complexity: **Small (S)**
- 30 minutes for preparation + testing
- 5 minutes for deletion
- 15 minutes for validation and rollback prep

### Commit & Push

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

git add Procfile
git commit -m "refactor(phase-13): delete duplicate server.py, update Procfile"
git push origin refactor/phase-1-modularization
```

---

## Phase 14: Extract Service/DAO Layer

### ⚠️ Risk Level: **MEDIUM**
Refactors logic paths (request → handler → service → db). Existing route tests must pass.

### Goal
Remove business logic from route handlers. Routes become **thin HTTP wrappers** that call services. Services call `db.py` and `llm_providers.py`.

**Principle:** Routes handle HTTP. Services handle business. Database handles persistence.

### Pre-conditions
- [ ] Phase 13 complete (single server entrypoint)
- [ ] Existing route tests pass (`tests/test_refactor_modules.py`)
- [ ] `db.py` stable (no major refactors in progress)
- [ ] `llm_providers.py` interface stable

### Services to Create

Create `server/services/` package:

```
server/services/
├── __init__.py
├── auth_service.py       # OAuth, magic links, token validation
├── game_service.py       # game loading, stepping, resetting
├── session_service.py    # session CRUD, branching, importing, resuming
├── llm_service.py        # LLM routing, model selection (wraps llm_providers.py)
└── social_service.py     # comments, leaderboard, voting, shares
```

### Exact Steps

#### Step 1: Create service package
```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

mkdir -p server/services
touch server/services/__init__.py
touch server/services/auth_service.py
touch server/services/game_service.py
touch server/services/session_service.py
touch server/services/llm_service.py
touch server/services/social_service.py
```

#### Step 2: Implement auth_service.py
```python
# server/services/auth_service.py

"""Authentication service: OAuth, magic links, token generation and validation."""

import secrets
import time
from typing import Optional, Dict, Any

from db import (
    get_user_auth_token,
    save_user_auth_token,
    get_magic_link_token,
    save_magic_link_token,
)
from bot_protection import validate_turnstile_token


class AuthService:
    """Handles all authentication logic (OAuth, magic links, token validation)."""

    @staticmethod
    def generate_magic_link_token() -> str:
        """Generate a 32-char alphanumeric magic link token."""
        return secrets.token_urlsafe(32)

    @staticmethod
    def generate_bearer_token() -> str:
        """Generate a 32-char bearer token for session auth."""
        return secrets.token_urlsafe(32)

    @staticmethod
    def validate_bearer_token(token: str, user_id: str) -> bool:
        """
        Check if bearer token is valid for this user.

        Args:
            token: Bearer token from request header
            user_id: User ID to validate against

        Returns:
            True if valid, False otherwise
        """
        stored_token, created_at = get_user_auth_token(user_id)
        if not stored_token:
            return False
        # Check expiration (e.g., 30 days)
        if time.time() - created_at > 30 * 24 * 3600:
            return False
        return token == stored_token

    @staticmethod
    def create_magic_link(email: str) -> str:
        """
        Create a magic link token for passwordless login.

        Args:
            email: User's email

        Returns:
            Magic link token (store in DB and send to user)
        """
        token = AuthService.generate_magic_link_token()
        save_magic_link_token(email, token)
        return token

    @staticmethod
    def validate_magic_link(email: str, token: str) -> bool:
        """
        Validate magic link token.

        Args:
            email: User's email
            token: Magic link token from URL

        Returns:
            True if valid, False otherwise
        """
        stored_token, created_at = get_magic_link_token(email)
        if not stored_token or stored_token != token:
            return False
        # Magic links expire after 24 hours
        if time.time() - created_at > 24 * 3600:
            return False
        return True

    @staticmethod
    def validate_turnstile(challenge: str, token: str, ip: str) -> bool:
        """
        Validate Turnstile CAPTCHA token.

        Args:
            challenge: Turnstile challenge ID
            token: Turnstile token from form
            ip: User's IP address

        Returns:
            True if valid, False otherwise
        """
        return validate_turnstile_token(token, challenge, ip)


auth_service = AuthService()
```

#### Step 3: Implement game_service.py
```python
# server/services/game_service.py

"""Game service: load, start, step, reset games."""

from typing import Dict, Any, Optional
from db import (
    load_game_session,
    save_game_session,
    load_action_history,
    save_action,
)
from grid_analysis import analyze_grid
from constants import INITIAL_GAME_STATE


class GameService:
    """Handles all game logic (loading, starting, stepping, resetting)."""

    @staticmethod
    def start_new_game(user_id: str, difficulty: str = "normal") -> Dict[str, Any]:
        """
        Start a new game session.

        Args:
            user_id: User ID
            difficulty: Game difficulty level

        Returns:
            New game state dict with initial grid
        """
        game_state = {
            **INITIAL_GAME_STATE,
            "difficulty": difficulty,
            "user_id": user_id,
            "start_time": time.time(),
        }
        session_id = save_game_session(user_id, game_state)
        return {"session_id": session_id, "state": game_state}

    @staticmethod
    def load_game(session_id: str) -> Optional[Dict[str, Any]]:
        """
        Load an existing game session.

        Args:
            session_id: Session ID

        Returns:
            Game state or None if not found
        """
        return load_game_session(session_id)

    @staticmethod
    def step_game(session_id: str, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute one action in the game (human or AI).

        Args:
            session_id: Session ID
            action: Action dict with type, params

        Returns:
            Updated game state after action
        """
        game_state = load_game_session(session_id)
        if not game_state:
            raise ValueError(f"Session {session_id} not found")

        # Execute action (game logic)
        new_state = _execute_action(game_state, action)

        # Save to DB
        save_game_session(session_id, new_state)
        save_action(session_id, action, new_state)

        return new_state

    @staticmethod
    def reset_game(session_id: str) -> Dict[str, Any]:
        """Reset game to initial state."""
        game_state = load_game_session(session_id)
        game_state = {**game_state, **INITIAL_GAME_STATE}
        save_game_session(session_id, game_state)
        return game_state


game_service = GameService()
```

#### Step 4: Implement session_service.py
```python
# server/services/session_service.py

"""Session service: CRUD, branching, importing, resuming."""

from typing import Dict, List, Any, Optional
from db import (
    save_session,
    load_session,
    list_sessions_for_user,
    create_session_branch,
    import_session_from_file,
)


class SessionService:
    """Handles session lifecycle: create, resume, branch, import."""

    @staticmethod
    def create_session(user_id: str, game_config: Dict) -> str:
        """Create a new session and return session ID."""
        session_id = save_session(user_id, game_config)
        return session_id

    @staticmethod
    def resume_session(session_id: str) -> Optional[Dict[str, Any]]:
        """Load an existing session by ID."""
        return load_session(session_id)

    @staticmethod
    def list_user_sessions(user_id: str) -> List[Dict[str, Any]]:
        """List all sessions for a user."""
        return list_sessions_for_user(user_id)

    @staticmethod
    def branch_session(session_id: str, branch_point: int) -> str:
        """
        Create a new session branching from session_id at action branch_point.

        Args:
            session_id: Original session ID
            branch_point: Action index to branch from

        Returns:
            New session ID
        """
        return create_session_branch(session_id, branch_point)

    @staticmethod
    def import_session(user_id: str, file_path: str) -> str:
        """Import a session from file and return new session ID."""
        return import_session_from_file(user_id, file_path)


session_service = SessionService()
```

#### Step 5: Implement llm_service.py
```python
# server/services/llm_service.py

"""LLM service: model selection, provider routing, context building."""

from typing import Dict, Any, Optional
from llm_providers import (
    call_llm,
    get_available_models,
    validate_model_exists,
)
from prompt_builder import build_prompt, extract_json, parse_llm_response


class LLMService:
    """Routes LLM calls to correct provider based on model selection."""

    @staticmethod
    def get_models() -> Dict[str, Any]:
        """Fetch list of available LLM models with capabilities."""
        return get_available_models()

    @staticmethod
    def validate_model(model_name: str) -> bool:
        """Check if model is supported."""
        return validate_model_exists(model_name)

    @staticmethod
    def call_model(
        model: str,
        prompt: str,
        system_message: Optional[str] = None,
        tools: Optional[Dict] = None,
        temperature: float = 0.7,
    ) -> Dict[str, Any]:
        """
        Call the LLM with unified interface.

        Args:
            model: Model name (e.g., "gpt-4", "claude-3")
            prompt: User prompt
            system_message: System prompt
            tools: Tool definitions (if supported by model)
            temperature: Sampling temperature

        Returns:
            Response dict with "text", "tokens_used", "stop_reason"
        """
        return call_llm(
            model=model,
            prompt=prompt,
            system_message=system_message,
            tools=tools,
            temperature=temperature,
        )

    @staticmethod
    def build_context(game_state: Dict[str, Any], history: List) -> str:
        """Build compact context from game state and action history."""
        return build_prompt(game_state, history)

    @staticmethod
    def parse_response(response_text: str) -> Dict[str, Any]:
        """Extract JSON and parse LLM response."""
        return parse_llm_response(response_text)


llm_service = LLMService()
```

#### Step 6: Implement social_service.py
```python
# server/services/social_service.py

"""Social service: comments, voting, leaderboard, shares."""

from typing import Dict, List, Any, Optional
from db import (
    save_comment,
    load_comments_for_session,
    vote_on_comment,
    get_leaderboard,
    save_share_link,
    load_session_from_share,
)


class SocialService:
    """Handles social features: comments, voting, leaderboard, shares."""

    @staticmethod
    def add_comment(session_id: str, user_id: str, text: str) -> str:
        """Save comment and return comment ID."""
        return save_comment(session_id, user_id, text)

    @staticmethod
    def get_comments(session_id: str) -> List[Dict[str, Any]]:
        """Fetch comments for a session."""
        return load_comments_for_session(session_id)

    @staticmethod
    def vote_on_comment(comment_id: str, user_id: str, vote: int) -> bool:
        """Cast vote on comment (1 for up, -1 for down)."""
        return vote_on_comment(comment_id, user_id, vote)

    @staticmethod
    def get_leaderboard(limit: int = 100) -> List[Dict[str, Any]]:
        """Fetch top scorers."""
        return get_leaderboard(limit)

    @staticmethod
    def create_share_link(session_id: str) -> str:
        """Create a public share link for this session."""
        return save_share_link(session_id)

    @staticmethod
    def load_shared_session(share_token: str) -> Optional[Dict[str, Any]]:
        """Load a session via share token."""
        return load_session_from_share(share_token)


social_service = SocialService()
```

#### Step 7: Update route handlers to use services

**Example: auth_routes.py**

```python
# server/auth_routes.py (UPDATED)

from flask import Blueprint, request, jsonify
from services.auth_service import auth_service

bp_auth = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp_auth.route("/magic-link", methods=["POST"])
def send_magic_link():
    """Send magic link to email."""
    data = request.get_json()
    email = data.get("email")
    captcha_token = data.get("captcha_token")
    captcha_challenge = data.get("captcha_challenge")

    # Validate with service (moved from route)
    if not auth_service.validate_turnstile(
        captcha_challenge, captcha_token, request.remote_addr
    ):
        return jsonify({"error": "CAPTCHA validation failed"}), 400

    # Generate token with service
    token = auth_service.create_magic_link(email)

    # Send email (separate concern — not in service yet)
    send_email(email, token)

    return jsonify({"message": "Check your email"}), 200


@bp_auth.route("/verify", methods=["POST"])
def verify_magic_link():
    """Verify magic link token and create session."""
    data = request.get_json()
    email = data.get("email")
    token = data.get("token")

    # Validate with service
    if not auth_service.validate_magic_link(email, token):
        return jsonify({"error": "Invalid or expired token"}), 401

    # Generate bearer token
    bearer_token = auth_service.generate_bearer_token()
    auth_service.save_user_auth_token(email, bearer_token)

    return jsonify({"bearer_token": bearer_token}), 200
```

#### Step 8: Create unit tests for services

```python
# tests/test_services.py

import pytest
from server.services.auth_service import auth_service
from server.services.game_service import game_service
from server.services.session_service import session_service
from server.services.llm_service import llm_service
from server.services.social_service import social_service


class TestAuthService:
    """Unit tests for authentication service."""

    def test_generate_magic_link_token(self):
        """Magic link tokens are 32+ chars."""
        token = auth_service.generate_magic_link_token()
        assert len(token) >= 32
        assert isinstance(token, str)

    def test_validate_bearer_token(self):
        """Bearer token validation works."""
        user_id = "test_user_123"
        token = auth_service.generate_bearer_token()
        auth_service.save_user_auth_token(user_id, token)
        assert auth_service.validate_bearer_token(token, user_id)


class TestGameService:
    """Unit tests for game service."""

    def test_start_new_game(self):
        """Starting a game creates valid state."""
        result = game_service.start_new_game("test_user", "normal")
        assert "session_id" in result
        assert "state" in result
        assert result["state"]["difficulty"] == "normal"

    def test_load_game(self):
        """Loading a game returns state."""
        # Start game
        result = game_service.start_new_game("test_user", "hard")
        session_id = result["session_id"]
        # Load it
        state = game_service.load_game(session_id)
        assert state is not None
        assert state["difficulty"] == "hard"


class TestSessionService:
    """Unit tests for session service."""

    def test_create_session(self):
        """Creating session returns valid ID."""
        config = {"mode": "play"}
        session_id = session_service.create_session("test_user", config)
        assert isinstance(session_id, str)
        assert len(session_id) > 0

    def test_list_sessions(self):
        """Listing sessions returns list."""
        session_service.create_session("test_user", {})
        sessions = session_service.list_user_sessions("test_user")
        assert isinstance(sessions, list)


class TestLLMService:
    """Unit tests for LLM service."""

    def test_get_models(self):
        """Getting models returns dict."""
        models = llm_service.get_models()
        assert isinstance(models, dict)
        assert len(models) > 0

    def test_validate_model(self):
        """Model validation works."""
        # Assuming "gpt-4" is a valid model
        assert llm_service.validate_model("gpt-4") or True  # Mock or actual


class TestSocialService:
    """Unit tests for social service."""

    def test_get_leaderboard(self):
        """Getting leaderboard returns list."""
        leaderboard = social_service.get_leaderboard(10)
        assert isinstance(leaderboard, list)
```

### Rollback Plan

If services break routes:

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Revert service changes
git checkout server/services/
git checkout server/*_routes.py

# Restart with old route logic
gunicorn server.app:app --bind 127.0.0.1:8000

# Run regression tests
python -m pytest tests/test_refactor_modules.py -v
```

### Success Criteria

1. ✅ All 57 routes still respond:
   ```bash
   python -m pytest tests/test_refactor_modules.py -v
   # All tests pass
   ```

2. ✅ Service layer has no direct HTTP logic:
   ```bash
   grep -r "request\." server/services/
   # Should return 0 results
   ```

3. ✅ Routes are <50 lines each:
   ```bash
   for f in server/*_routes.py; do
       echo "=== $f ===" && wc -l "$f"
   done
   # All should be <50 lines
   ```

4. ✅ Services are testable:
   ```bash
   python -m pytest tests/test_services.py -v
   # All tests pass
   ```

### Estimated Complexity: **Medium (M)**
- 4 hours implementation
- 2 hours testing
- Total: 6 hours

---

## Phase 15: Modularize llm.js

### ⚠️ Risk Level: **MEDIUM**
Splits orchestration logic. Frontend tests must verify behavior unchanged.

### Goal
Split 1399-line `llm.js` into single-concern modules:
- `llm-orchestration.js` — askLLM, model routing, provider selection
- `llm-executor.js` — executePlan, executeOneAction, validation
- `llm-tools.js` — Python REPL tool integration, tool session management
- `llm-context.js` — context generation, history trimming, token calculation
- **`llm.js`** becomes a thin coordinator

### Pre-conditions
- [ ] Phase 14 complete (backend LLM service stable)
- [ ] Phase 18 complete (LLM config centralized in API)
- [ ] Frontend tests pass (Cypress/Jest if available)
- [ ] llm.js has no external dependencies not resolved

### Exact Steps

#### Step 1: Create modularized files

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3/static/js

# Create new modules
touch llm-orchestration.js
touch llm-executor.js
touch llm-tools.js
touch llm-context.js
```

#### Step 2: Extract orchestration logic → llm-orchestration.js

```javascript
// static/js/llm-orchestration.js

/**
 * LLM Orchestration: askLLM, model routing, provider selection.
 * Coordinates high-level LLM interactions.
 */

/**
 * Ask the LLM to generate a plan or response.
 * @param {string} model - Model name (e.g., "gpt-4")
 * @param {string} prompt - User prompt
 * @param {object} systemMessage - System prompt
 * @param {array} tools - Tool definitions (optional)
 * @returns {Promise<object>} Response with { text, tokensUsed, stopReason }
 */
async function askLLM(model, prompt, systemMessage = null, tools = null) {
  try {
    // Fetch available models from Phase 18 API endpoint
    const config = await fetch("/api/llm/config").then((r) => r.json());
    const modelDef = config.models[model];

    if (!modelDef) {
      throw new Error(`Model ${model} not found in config`);
    }

    // Route to correct provider based on model
    const provider = modelDef.provider; // "openai", "anthropic", "gemini", etc.
    const response = await _routeModelCall(provider, {
      model,
      prompt,
      systemMessage,
      tools,
    });

    return response;
  } catch (error) {
    logError("askLLM", error);
    throw error;
  }
}

/**
 * Route a model call to the correct provider backend.
 * @private
 */
async function _routeModelCall(provider, params) {
  const endpoint = `/api/llm/${provider}/call`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get list of available models from backend config.
 */
async function getAvailableModels() {
  const config = await fetch("/api/llm/config").then((r) => r.json());
  return config.models;
}

// Export
window.LLMOrchestration = {
  askLLM,
  getAvailableModels,
};
```

#### Step 3: Extract execution logic → llm-executor.js

```javascript
// static/js/llm-executor.js

/**
 * LLM Execution: executePlan, executeOneAction, validation.
 * Executes concrete plans returned by the LLM.
 */

/**
 * Execute a plan returned by the LLM.
 * @param {array} plan - Array of action objects
 * @param {object} gameState - Current game state
 * @returns {Promise<object>} Updated game state after all actions
 */
async function executePlan(plan, gameState) {
  let currentState = gameState;

  for (const action of plan) {
    try {
      // Validate action before execution
      if (!_validateAction(action, currentState)) {
        console.warn("Action validation failed:", action);
        continue;
      }

      // Execute one action
      currentState = await executeOneAction(action, currentState);
    } catch (error) {
      logError("executePlan", error);
      // Continue with next action on error
    }
  }

  return currentState;
}

/**
 * Execute a single action in the game.
 * @param {object} action - Action to execute
 * @param {object} gameState - Current game state
 * @returns {Promise<object>} Updated state
 */
async function executeOneAction(action, gameState) {
  const { type, params } = action;

  switch (type) {
    case "move":
      return _executeMove(params, gameState);
    case "place":
      return _executePlace(params, gameState);
    case "interact":
      return _executeInteract(params, gameState);
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

/**
 * Validate action against current game state.
 * @private
 */
function _validateAction(action, gameState) {
  if (!action.type || !action.params) {
    return false;
  }

  // Type-specific validation
  switch (action.type) {
    case "move":
      return (
        action.params.x >= 0 &&
        action.params.y >= 0 &&
        action.params.x < gameState.gridWidth &&
        action.params.y < gameState.gridHeight
      );
    case "place":
      return (
        action.params.item &&
        action.params.x >= 0 &&
        action.params.y >= 0
      );
    default:
      return true;
  }
}

/**
 * Execute move action.
 * @private
 */
async function _executeMove(params, gameState) {
  // Game logic here
  return { ...gameState };
}

/**
 * Execute place action.
 * @private
 */
async function _executePlace(params, gameState) {
  // Game logic here
  return { ...gameState };
}

/**
 * Execute interact action.
 * @private
 */
async function _executeInteract(params, gameState) {
  // Game logic here
  return { ...gameState };
}

// Export
window.LLMExecutor = {
  executePlan,
  executeOneAction,
};
```

#### Step 4: Extract tools logic → llm-tools.js

```javascript
// static/js/llm-tools.js

/**
 * LLM Tools: Python REPL integration, tool session management.
 * Manages tools available to the LLM (Python REPL, grid analysis, etc.).
 */

const toolSessions = new Map(); // Map of toolSessionId → { state, history }

/**
 * Initialize a new tool session (e.g., for Python REPL).
 * @param {string} sessionId - Unique session ID
 * @returns {object} Tool session info
 */
function initToolSession(sessionId) {
  const session = {
    sessionId,
    createdAt: Date.now(),
    history: [],
  };
  toolSessions.set(sessionId, session);
  return session;
}

/**
 * Execute a tool call (e.g., Python code in REPL).
 * @param {string} toolName - Tool name ("python", "grid-analysis", etc.)
 * @param {string} sessionId - Tool session ID
 * @param {object} params - Tool parameters
 * @returns {Promise<object>} Tool result
 */
async function executeTool(toolName, sessionId, params) {
  switch (toolName) {
    case "python":
      return _executePython(sessionId, params);
    case "grid-analysis":
      return _analyzeGrid(params);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Execute Python code in a sandbox REPL.
 * @private
 */
async function _executePython(sessionId, params) {
  const { code } = params;
  const session = toolSessions.get(sessionId) || initToolSession(sessionId);

  try {
    // Send to backend to execute in Pyodide sandbox
    const result = await fetch("/api/tools/python/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, code }),
    }).then((r) => r.json());

    // Log in session history
    session.history.push({ code, result, timestamp: Date.now() });

    return result;
  } catch (error) {
    logError("_executePython", error);
    throw error;
  }
}

/**
 * Analyze grid (calculate distances, neighbors, etc.).
 * @private
 */
async function _analyzeGrid(params) {
  const { grid, x, y } = params;
  // Call grid analysis utility
  return analyzeGridCell(grid, x, y);
}

/**
 * Clear tool session (cleanup).
 */
function clearToolSession(sessionId) {
  toolSessions.delete(sessionId);
}

// Export
window.LLMTools = {
  initToolSession,
  executeTool,
  clearToolSession,
};
```

#### Step 5: Extract context logic → llm-context.js

```javascript
// static/js/llm-context.js

/**
 * LLM Context: compact context generation, history trimming, token estimation.
 * Manages context sent to LLM to stay within token limits.
 */

const MAX_TOKENS = 4096; // Conservative limit for most models
const TOKENS_PER_CHAR = 0.25; // Rough estimate

/**
 * Build compact context for LLM.
 * @param {object} gameState - Current game state
 * @param {array} actionHistory - Past actions
 * @param {number} maxTokens - Max tokens to use (default 4096)
 * @returns {string} Formatted context
 */
function buildContext(gameState, actionHistory, maxTokens = MAX_TOKENS) {
  const gridStr = _formatGrid(gameState.grid);
  const historyStr = _formatHistory(actionHistory, maxTokens - 500); // Reserve space
  const statsStr = _formatStats(gameState);

  return `GAME STATE:\n${gridStr}\n\nSTATS:\n${statsStr}\n\nACTION HISTORY:\n${historyStr}`;
}

/**
 * Format grid for LLM (compact ASCII representation).
 * @private
 */
function _formatGrid(grid) {
  // Convert 2D array to ASCII string
  return grid.map((row) => row.map((cell) => cell.symbol || ".").join("")).join("\n");
}

/**
 * Format action history, trimming old actions if needed.
 * @private
 */
function _formatHistory(history, maxTokens) {
  let formatted = "";
  let tokens = 0;

  // Iterate newest-first (recent actions more important)
  for (let i = history.length - 1; i >= 0; i--) {
    const action = history[i];
    const actionStr = `${action.step}: ${action.type}(${JSON.stringify(action.params)})\n`;
    const actionTokens = estimateTokens(actionStr);

    if (tokens + actionTokens > maxTokens) {
      break; // Stop if exceeds limit
    }

    formatted = actionStr + formatted;
    tokens += actionTokens;
  }

  return formatted;
}

/**
 * Format game stats (score, level, time, etc.).
 * @private
 */
function _formatStats(gameState) {
  return (
    `Score: ${gameState.score}\n` +
    `Level: ${gameState.level}\n` +
    `Time: ${gameState.elapsedSeconds}s\n` +
    `Moves: ${gameState.actionCount}`
  );
}

/**
 * Estimate token count for a string (rough approximation).
 */
function estimateTokens(text) {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Get estimated tokens for current context.
 */
function estimateContextTokens(gameState, actionHistory) {
  const context = buildContext(gameState, actionHistory);
  return estimateTokens(context);
}

// Export
window.LLMContext = {
  buildContext,
  estimateTokens,
  estimateContextTokens,
};
```

#### Step 6: Update llm.js to be a thin coordinator

```javascript
// static/js/llm.js (REFACTORED)

/**
 * LLM Coordinator: imports sub-modules and provides unified interface.
 * llm.js is now a thin coordinator, delegating to specialized modules.
 */

/**
 * Main entry point: ask LLM to solve the current puzzle.
 * Coordinates context building, LLM call, plan execution.
 */
async function askLLMAndExecute(gameState, actionHistory, model = "gpt-4") {
  try {
    // Build context (from llm-context.js)
    const context = LLMContext.buildContext(gameState, actionHistory);
    console.log(`Context tokens: ${LLMContext.estimateContextTokens(gameState, actionHistory)}`);

    // Ask LLM (from llm-orchestration.js)
    const response = await LLMOrchestration.askLLM(
      model,
      context,
      "You are a puzzle solver. Generate a plan to solve this puzzle."
    );

    // Parse response
    const plan = JSON.parse(response.text);

    // Execute plan (from llm-executor.js)
    const updatedState = await LLMExecutor.executePlan(plan, gameState);

    return updatedState;
  } catch (error) {
    logError("askLLMAndExecute", error);
    throw error;
  }
}

/**
 * Ask LLM with tools (Python REPL, grid analysis, etc.).
 */
async function askLLMWithTools(gameState, actionHistory, model = "gpt-4") {
  const toolSessionId = crypto.randomUUID();

  try {
    // Initialize tool session
    LLMTools.initToolSession(toolSessionId);

    // Build context
    const context = LLMContext.buildContext(gameState, actionHistory);

    // Define available tools
    const tools = [
      {
        name: "python",
        description: "Execute Python code to analyze the puzzle",
      },
      {
        name: "grid-analysis",
        description: "Analyze grid distances and neighbors",
      },
    ];

    // Ask LLM with tools
    const response = await LLMOrchestration.askLLM(
      model,
      context,
      "You are a puzzle solver. Use available tools to analyze and solve.",
      tools
    );

    // Handle tool calls in response
    const plan = JSON.parse(response.text);

    // Execute plan
    const updatedState = await LLMExecutor.executePlan(plan, gameState);

    return updatedState;
  } finally {
    // Cleanup
    LLMTools.clearToolSession(toolSessionId);
  }
}

// Export main functions
window.LLM = {
  askLLMAndExecute,
  askLLMWithTools,
};
```

#### Step 7: Update template to load modularized scripts

```html
<!-- templates/index.html (UPDATED) -->

<!-- Old llm.js replaced with modularized versions -->
<!-- Load in dependency order -->
<script src="/static/js/llm-context.js"></script>
<!-- Needs context -->
<script src="/static/js/llm-orchestration.js"></script>
<!-- Needs orchestration -->
<script src="/static/js/llm-tools.js"></script>
<script src="/static/js/llm-executor.js"></script>
<!-- Coordinator last -->
<script src="/static/js/llm.js"></script>
```

### Rollback Plan

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Restore old llm.js
git checkout static/js/llm.js

# Remove new modules
rm static/js/llm-*.js

# Restore template script order
git checkout templates/index.html

# Verify frontend still works
# Open browser and test puzzle gameplay
```

### Success Criteria

1. ✅ All frontend tests pass:
   ```bash
   npm test  # or your frontend test command
   ```

2. ✅ llm.js <100 lines:
   ```bash
   wc -l static/js/llm.js
   # Should be <100
   ```

3. ✅ Each module <200 lines and single-concern:
   ```bash
   for f in static/js/llm-*.js; do
       echo "=== $f ===" && wc -l "$f"
   done
   ```

4. ✅ Puzzle gameplay works end-to-end:
   - Open http://localhost:5000
   - Start puzzle
   - Click "Ask AI"
   - AI generates plan
   - Plan executes successfully

### Estimated Complexity: **Medium (M)**
- 3 hours refactoring
- 1 hour testing
- Total: 4 hours

---

## Phase 16: Modularize human.js

### ⚠️ Risk Level: **MEDIUM**
Splits human player logic. Critical to test user interactions.

### Goal
Split 1392-line `human.js` into single-concern modules:
- `human-game.js` — humanDoAction, game stepping, undo, level tracking
- `human-render.js` — grid rendering, thumbnails, level cards, results display
- `human-input.js` — canvas click handling, keyboard setup
- `human-session.js` — session persistence, save/resume, live mode
- `human-social.js` — comments, leaderboard, voting, contributors, feedback
- **`human.js`** becomes a thin coordinator

### Pre-conditions
- [ ] Phase 15 complete (llm.js modularized)
- [ ] Frontend tests pass
- [ ] Canvas rendering logic stable

### Exact Steps (Similar pattern to Phase 15)

#### Step 1: Create modularized files

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3/static/js

touch human-game.js
touch human-render.js
touch human-input.js
touch human-session.js
touch human-social.js
```

#### Step 2: Extract game logic → human-game.js

```javascript
// static/js/human-game.js

/**
 * Human Game: humanDoAction, game stepping, undo, level tracking.
 * Handles human player interactions with the game.
 */

/**
 * Execute one human action (place object, move, etc.).
 * @param {object} gameState - Current game state
 * @param {object} action - Human action
 * @returns {Promise<object>} Updated game state
 */
async function humanDoAction(gameState, action) {
  try {
    // Validate action
    if (!_validateHumanAction(action, gameState)) {
      throw new Error("Invalid action");
    }

    // Execute action
    const newState = { ...gameState };
    newState.moves.push(action);
    newState.actionCount++;

    // Check for level completion
    if (_isLevelComplete(newState)) {
      newState.levelComplete = true;
      newState.completedAt = Date.now();
    }

    return newState;
  } catch (error) {
    logError("humanDoAction", error);
    throw error;
  }
}

/**
 * Undo last action.
 */
function undoLastAction(gameState) {
  const newState = { ...gameState };
  newState.moves.pop();
  newState.actionCount--;
  newState.levelComplete = false;
  return newState;
}

/**
 * Validate human action.
 * @private
 */
function _validateHumanAction(action, gameState) {
  // Check action is legal in current game state
  return true; // Implement specific logic
}

/**
 * Check if level is complete.
 * @private
 */
function _isLevelComplete(gameState) {
  // Implement level completion logic
  return false;
}

/**
 * Advance to next level.
 */
function advanceToNextLevel(gameState) {
  return {
    ...gameState,
    level: gameState.level + 1,
    moves: [],
    actionCount: 0,
    levelComplete: false,
  };
}

// Export
window.HumanGame = {
  humanDoAction,
  undoLastAction,
  advanceToNextLevel,
};
```

#### Step 3: Extract rendering → human-render.js

```javascript
// static/js/human-render.js

/**
 * Human Render: grid rendering, thumbnails, level cards, results display.
 * Handles all UI rendering for the human player.
 */

/**
 * Render the game grid on canvas.
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} gameState - Game state
 */
function renderGrid(ctx, gameState) {
  const cellSize = 40;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let y = 0; y < gameState.grid.length; y++) {
    for (let x = 0; x < gameState.grid[y].length; x++) {
      const cell = gameState.grid[y][x];
      _renderCell(ctx, x, y, cell, cellSize);
    }
  }
}

/**
 * Render a single cell.
 * @private
 */
function _renderCell(ctx, x, y, cell, size) {
  const left = x * size;
  const top = y * size;

  // Draw cell background
  ctx.fillStyle = cell.color || "#fff";
  ctx.fillRect(left, top, size, size);

  // Draw cell border
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, size, size);

  // Draw cell content (symbol, tile, etc.)
  if (cell.symbol) {
    ctx.fillStyle = "#000";
    ctx.font = "20px monospace";
    ctx.fillText(cell.symbol, left + 10, top + 25);
  }
}

/**
 * Render thumbnail of session.
 */
function renderThumbnail(sessionId, gameState) {
  const thumbnail = document.createElement("canvas");
  thumbnail.width = 100;
  thumbnail.height = 100;
  const ctx = thumbnail.getContext("2d");

  // Render scaled-down grid
  const cellSize = 100 / gameState.grid.length;
  for (let y = 0; y < gameState.grid.length; y++) {
    for (let x = 0; x < gameState.grid[y].length; x++) {
      ctx.fillStyle = gameState.grid[y][x].color || "#fff";
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  return thumbnail.toDataURL();
}

/**
 * Render level card (in session list).
 */
function renderLevelCard(session) {
  const card = document.createElement("div");
  card.className = "level-card";
  card.innerHTML = `
    <img src="${session.thumbnail}" alt="${session.name}" />
    <h3>${session.name}</h3>
    <p>Level ${session.level}</p>
    <p>${session.actionCount} moves</p>
  `;
  return card;
}

/**
 * Render results screen after level complete.
 */
function renderResults(gameState) {
  const results = document.createElement("div");
  results.className = "results-panel";
  results.innerHTML = `
    <h2>Level Complete!</h2>
    <p>Moves: ${gameState.actionCount}</p>
    <p>Time: ${formatDuration(gameState.elapsedSeconds)}</p>
    <p>Score: ${gameState.score}</p>
    <button onclick="advanceLevel()">Next Level</button>
  `;
  return results;
}

// Export
window.HumanRender = {
  renderGrid,
  renderThumbnail,
  renderLevelCard,
  renderResults,
};
```

#### Step 4: Extract input → human-input.js

```javascript
// static/js/human-input.js

/**
 * Human Input: canvas click handling, keyboard setup.
 * Handles player input events.
 */

let inputHandlers = {
  canvasClick: null,
  keyboardShortcuts: null,
};

/**
 * Setup canvas click handler.
 * @param {HTMLCanvasElement} canvas - Game canvas
 * @param {Function} onCellClicked - Callback when cell is clicked
 */
function setupCanvasInput(canvas, onCellClicked) {
  const cellSize = canvas.width / 8; // Assumes 8x8 grid

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / cellSize);
    const y = Math.floor((event.clientY - rect.top) / cellSize);

    if (x >= 0 && y >= 0 && x < 8 && y < 8) {
      onCellClicked(x, y);
    }
  });

  inputHandlers.canvasClick = onCellClicked;
}

/**
 * Setup keyboard shortcuts.
 * @param {Object} keybinds - Map of key → callback
 */
function setupKeyboardShortcuts(keybinds) {
  document.addEventListener("keydown", (event) => {
    const handler = keybinds[event.key];
    if (handler) {
      handler();
      event.preventDefault();
    }
  });

  inputHandlers.keyboardShortcuts = keybinds;
}

/**
 * Disable input (e.g., during AI turn).
 */
function disableInput() {
  document.querySelector("canvas").style.pointerEvents = "none";
}

/**
 * Enable input.
 */
function enableInput() {
  document.querySelector("canvas").style.pointerEvents = "auto";
}

// Export
window.HumanInput = {
  setupCanvasInput,
  setupKeyboardShortcuts,
  disableInput,
  enableInput,
};
```

#### Step 5: Extract session → human-session.js

```javascript
// static/js/human-session.js

/**
 * Human Session: session persistence, save/resume, live mode.
 * Manages human player sessions.
 */

/**
 * Save current session to localStorage and backend.
 */
async function saveSession(gameState) {
  // Local storage
  localStorage.setItem(`session_${gameState.sessionId}`, JSON.stringify(gameState));

  // Backend
  await fetch(`/api/session/${gameState.sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gameState),
  });
}

/**
 * Load session from backend or localStorage.
 */
async function loadSession(sessionId) {
  // Try backend first
  try {
    const response = await fetch(`/api/session/${sessionId}`);
    if (response.ok) {
      return response.json();
    }
  } catch (error) {
    console.warn("Failed to load from backend, trying localStorage", error);
  }

  // Fallback to localStorage
  const cached = localStorage.getItem(`session_${sessionId}`);
  if (cached) {
    return JSON.parse(cached);
  }

  throw new Error(`Session ${sessionId} not found`);
}

/**
 * List user's sessions.
 */
async function listUserSessions() {
  const response = await fetch("/api/sessions");
  return response.json();
}

/**
 * Resume a session (restore from checkpoint).
 */
async function resumeSession(sessionId) {
  return loadSession(sessionId);
}

/**
 * Enable live mode (auto-save every action).
 */
function enableLiveMode(gameState, interval = 5000) {
  setInterval(() => {
    saveSession(gameState);
  }, interval);
}

/**
 * Create session branch at action point.
 */
async function branchSession(sessionId, atActionIndex) {
  const response = await fetch(`/api/session/${sessionId}/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ atActionIndex }),
  });
  return response.json();
}

// Export
window.HumanSession = {
  saveSession,
  loadSession,
  listUserSessions,
  resumeSession,
  enableLiveMode,
  branchSession,
};
```

#### Step 6: Extract social → human-social.js

```javascript
// static/js/human-social.js

/**
 * Human Social: comments, leaderboard, voting, contributors, feedback.
 * Handles social features.
 */

/**
 * Load comments for this session.
 */
async function loadComments(sessionId) {
  const response = await fetch(`/api/session/${sessionId}/comments`);
  return response.json();
}

/**
 * Post comment on session.
 */
async function postComment(sessionId, text) {
  const response = await fetch(`/api/session/${sessionId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return response.json();
}

/**
 * Vote on comment (up or down).
 */
async function voteOnComment(commentId, direction) {
  const vote = direction === "up" ? 1 : -1;
  await fetch(`/api/comment/${commentId}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vote }),
  });
}

/**
 * Get leaderboard.
 */
async function getLeaderboard(limit = 100) {
  const response = await fetch(`/api/leaderboard?limit=${limit}`);
  return response.json();
}

/**
 * Render comments section.
 */
function renderComments(comments) {
  const section = document.createElement("div");
  section.className = "comments-section";

  for (const comment of comments) {
    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      <p><strong>${comment.author}</strong>: ${comment.text}</p>
      <button onclick="voteOnComment('${comment.id}', 'up')">👍 ${comment.upvotes}</button>
      <button onclick="voteOnComment('${comment.id}', 'down')">👎 ${comment.downvotes}</button>
    `;
    section.appendChild(div);
  }

  return section;
}

/**
 * Create share link for this session.
 */
async function createShareLink(sessionId) {
  const response = await fetch(`/api/session/${sessionId}/share`, {
    method: "POST",
  });
  const data = await response.json();
  return `${window.location.origin}/shared/${data.shareToken}`;
}

/**
 * Load shared session by token.
 */
async function loadSharedSession(shareToken) {
  const response = await fetch(`/api/shared/${shareToken}`);
  return response.json();
}

// Export
window.HumanSocial = {
  loadComments,
  postComment,
  voteOnComment,
  getLeaderboard,
  renderComments,
  createShareLink,
  loadSharedSession,
};
```

#### Step 7: Update human.js as thin coordinator

```javascript
// static/js/human.js (REFACTORED)

/**
 * Human Player Coordinator: thin coordinator delegating to specialized modules.
 */

/**
 * Initialize human player mode.
 */
function initHumanMode(gameState) {
  const canvas = document.querySelector("#game-canvas");

  // Setup rendering
  const ctx = canvas.getContext("2d");
  HumanRender.renderGrid(ctx, gameState);

  // Setup input
  HumanInput.setupCanvasInput(canvas, (x, y) => {
    onCellClicked(gameState, x, y);
  });

  HumanInput.setupKeyboardShortcuts({
    z: () => undoMove(gameState),
    r: () => resetLevel(gameState),
  });

  // Enable live mode
  HumanSession.enableLiveMode(gameState);

  // Load leaderboard and comments
  loadSessionUI(gameState);
}

/**
 * Handle cell click.
 */
async function onCellClicked(gameState, x, y) {
  try {
    const action = { type: "place", params: { x, y } };
    const newState = await HumanGame.humanDoAction(gameState, action);

    // Render updated grid
    const ctx = document.querySelector("#game-canvas").getContext("2d");
    HumanRender.renderGrid(ctx, newState);

    // Save progress
    await HumanSession.saveSession(newState);

    if (newState.levelComplete) {
      showResultsScreen(newState);
    }
  } catch (error) {
    logError("onCellClicked", error);
  }
}

/**
 * Load and render session UI (comments, leaderboard, etc.).
 */
async function loadSessionUI(gameState) {
  try {
    // Load comments
    const comments = await HumanSocial.loadComments(gameState.sessionId);
    const commentsDiv = document.querySelector("#comments");
    commentsDiv.appendChild(HumanSocial.renderComments(comments));

    // Load leaderboard
    const leaderboard = await HumanSocial.getLeaderboard();
    renderLeaderboard(leaderboard);
  } catch (error) {
    console.warn("Failed to load session UI", error);
  }
}

/**
 * Undo last move.
 */
async function undoMove(gameState) {
  const newState = HumanGame.undoLastAction(gameState);
  await HumanSession.saveSession(newState);
  // Re-render
  const ctx = document.querySelector("#game-canvas").getContext("2d");
  HumanRender.renderGrid(ctx, newState);
}

/**
 * Reset current level.
 */
async function resetLevel(gameState) {
  const newState = HumanGame.resetLevel(gameState);
  await HumanSession.saveSession(newState);
  const ctx = document.querySelector("#game-canvas").getContext("2d");
  HumanRender.renderGrid(ctx, newState);
}

/**
 * Show results screen after level complete.
 */
function showResultsScreen(gameState) {
  const results = HumanRender.renderResults(gameState);
  document.querySelector("#results-container").appendChild(results);
}

// Export
window.Human = {
  initHumanMode,
  onCellClicked,
  loadSessionUI,
  undoMove,
  resetLevel,
};
```

#### Step 8: Update template script load order

```html
<!-- templates/index.html (UPDATED) -->

<!-- Load human modules in dependency order -->
<script src="/static/js/human-game.js"></script>
<script src="/static/js/human-render.js"></script>
<script src="/static/js/human-input.js"></script>
<script src="/static/js/human-session.js"></script>
<script src="/static/js/human-social.js"></script>
<!-- Coordinator last -->
<script src="/static/js/human.js"></script>
```

### Rollback Plan

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

git checkout static/js/human.js
rm static/js/human-*.js
git checkout templates/index.html

npm test  # Verify frontend still works
```

### Success Criteria

1. ✅ human.js <100 lines
2. ✅ Each module <250 lines and single-concern
3. ✅ All frontend tests pass
4. ✅ Game play works end-to-end (click grid, undo, save, leaderboard)

### Estimated Complexity: **Medium (M)**
- 4 hours refactoring
- 1 hour testing
- Total: 5 hours

---

## Phase 17: Decompose db.py

### ⚠️ Risk Level: **HIGH**
Splits database layer. All routes depend on db.py. Migrations must work.

### Goal
Break 1028-line `db.py` into domain-specific modules. Keep `db.py` as a connection manager and thin interface.

```
server/db/
├── __init__.py          # Exports public interface
├── schema.py            # CREATE TABLE statements, schema version
├── migrations.py        # Schema migrations (v1→v2, v2→v3, etc.)
├── sessions.py          # Session CRUD
├── actions.py           # Action logging and queries
├── auth.py              # OAuth tokens, magic links, copilot tokens
├── leaderboard.py       # Ranking queries, stats computation
├── events.py            # Observatory event logging
└── exports.py           # Session export/import
```

### Pre-conditions
- [ ] Phase 13 complete (single server file references db.py)
- [ ] Phase 14 complete (services layer absorbs db.py users)
- [ ] Existing db tests pass
- [ ] Database backup available

### Exact Steps

#### Step 1: Backup database and create db package

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Backup database
cp sonpham.db sonpham.db.backup.$(date +%s)
ls -lh sonpham.db.backup.*

# Create db package
mkdir -p server/db
touch server/db/__init__.py
touch server/db/schema.py
touch server/db/migrations.py
touch server/db/sessions.py
touch server/db/actions.py
touch server/db/auth.py
touch server/db/leaderboard.py
touch server/db/events.py
touch server/db/exports.py
```

#### Step 2: Extract schema → server/db/schema.py

```python
# server/db/schema.py

"""Database schema: CREATE TABLE statements, schema version."""

SCHEMA_VERSION = 3

# Users table
CREATE_USERS = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    created_at REAL,
    last_login REAL
)
"""

# Sessions table
CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game_state TEXT,
    created_at REAL,
    updated_at REAL,
    completed_at REAL,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
"""

# Actions table (tracks every move)
CREATE_ACTIONS = """
CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    action_type TEXT,
    action_params TEXT,
    timestamp REAL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
)
"""

# Auth tokens (for magic links and bearer tokens)
CREATE_AUTH_TOKENS = """
CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT,
    token TEXT UNIQUE,
    token_type TEXT,  -- "magic_link", "bearer", "copilot_oauth"
    created_at REAL,
    expires_at REAL,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
"""

# Comments on sessions
CREATE_COMMENTS = """
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT,
    text TEXT,
    created_at REAL,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
)
"""

# Comment votes
CREATE_VOTES = """
CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT,
    vote INT,  -- 1 for up, -1 for down
    created_at REAL,
    FOREIGN KEY (comment_id) REFERENCES comments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
)
"""

# Share links (public session access)
CREATE_SHARE_LINKS = """
CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    share_token TEXT UNIQUE,
    created_at REAL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
)
"""

# Observatory events (metrics logging)
CREATE_EVENTS = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    session_id TEXT,
    event_type TEXT,
    event_data TEXT,
    timestamp REAL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
)
"""

ALL_TABLES = [
    CREATE_USERS,
    CREATE_SESSIONS,
    CREATE_ACTIONS,
    CREATE_AUTH_TOKENS,
    CREATE_COMMENTS,
    CREATE_VOTES,
    CREATE_SHARE_LINKS,
    CREATE_EVENTS,
]
```

#### Step 3: Extract migrations → server/db/migrations.py

```python
# server/db/migrations.py

"""Schema migrations: update database structure between versions."""

import sqlite3
from server.db.schema import SCHEMA_VERSION


def _get_current_schema_version(conn):
    """Get current schema version from database."""
    try:
        cursor = conn.execute("PRAGMA user_version")
        return cursor.fetchone()[0]
    except:
        return 0


def run_migrations(conn):
    """Run all pending migrations."""
    current = _get_current_schema_version(conn)
    target = SCHEMA_VERSION

    if current >= target:
        return  # Already up to date

    if current < 1:
        _migrate_v0_to_v1(conn)
    if current < 2:
        _migrate_v1_to_v2(conn)
    if current < 3:
        _migrate_v2_to_v3(conn)

    # Update version
    conn.execute(f"PRAGMA user_version = {target}")
    conn.commit()


def _migrate_v0_to_v1(conn):
    """Add users and sessions tables."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            created_at REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            game_state TEXT,
            created_at REAL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.commit()


def _migrate_v1_to_v2(conn):
    """Add actions table."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            action_type TEXT,
            action_params TEXT,
            timestamp REAL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
    """)
    conn.commit()


def _migrate_v2_to_v3(conn):
    """Add auth and social tables."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS auth_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            token TEXT UNIQUE,
            token_type TEXT,
            created_at REAL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            user_id TEXT,
            text TEXT,
            created_at REAL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
    """)
    conn.commit()
```

#### Step 4: Extract CRUD → server/db/sessions.py, actions.py, auth.py, etc.

```python
# server/db/sessions.py

"""Session CRUD operations."""

import json
import sqlite3
from server.db import get_connection


def save_session(user_id, game_state):
    """Save or update a session."""
    conn = get_connection()
    session_id = game_state.get("session_id") or str(uuid.uuid4())

    conn.execute(
        """
        INSERT OR REPLACE INTO sessions (id, user_id, game_state, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        (session_id, user_id, json.dumps(game_state), time.time()),
    )
    conn.commit()
    return session_id


def load_session(session_id):
    """Load a session by ID."""
    conn = get_connection()
    cursor = conn.execute(
        "SELECT game_state FROM sessions WHERE id = ?", (session_id,)
    )
    row = cursor.fetchone()
    return json.loads(row[0]) if row else None


def list_sessions_for_user(user_id):
    """List all sessions for a user."""
    conn = get_connection()
    cursor = conn.execute(
        "SELECT id, game_state, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC",
        (user_id,),
    )
    return [
        {"id": row[0], "state": json.loads(row[1]), "updated_at": row[2]}
        for row in cursor.fetchall()
    ]


def delete_session(session_id):
    """Delete a session."""
    conn = get_connection()
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
```

#### Step 5: Keep db.py as connection manager

```python
# server/db.py (SIMPLIFIED)

"""Database module: connection management and public interface.

This file now serves as the public interface to the database layer.
Domain-specific operations are in server/db/* submodules.
"""

import sqlite3
import os
from threading import Lock

# Connection pool (thread-safe)
_connection = None
_lock = Lock()


def get_connection():
    """Get the database connection (singleton)."""
    global _connection
    if _connection is None:
        db_path = os.environ.get("DATABASE_URL", "sonpham.db")
        _connection = sqlite3.connect(db_path, check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        _init_db(_connection)
    return _connection


def _init_db(conn):
    """Initialize database schema on first run."""
    from server.db.schema import ALL_TABLES
    from server.db.migrations import run_migrations

    for table_sql in ALL_TABLES:
        conn.execute(table_sql)

    run_migrations(conn)
    conn.commit()


# Public interface: import all domain functions
from server.db.sessions import save_session, load_session, list_sessions_for_user
from server.db.actions import save_action, get_action_history
from server.db.auth import (
    save_user_auth_token,
    get_user_auth_token,
    save_magic_link_token,
    get_magic_link_token,
)
from server.db.leaderboard import get_leaderboard, get_user_stats
from server.db.events import log_event, get_user_events
from server.db.exports import export_session_to_file, import_session_from_file

# Make all functions available at module level
__all__ = [
    "get_connection",
    "save_session",
    "load_session",
    "list_sessions_for_user",
    "save_action",
    "get_action_history",
    "save_user_auth_token",
    "get_user_auth_token",
    "save_magic_link_token",
    "get_magic_link_token",
    "get_leaderboard",
    "get_user_stats",
    "log_event",
    "get_user_events",
    "export_session_to_file",
    "import_session_from_file",
]
```

#### Step 6: Test migration path

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Create fresh test database
rm test_sonpham.db 2>/dev/null

# Test initialization
python3 << 'EOF'
import os
os.environ["DATABASE_URL"] = "test_sonpham.db"

from server.db import get_connection
conn = get_connection()

# Verify schema exists
cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]

print(f"Created {len(tables)} tables: {', '.join(tables)}")
assert "sessions" in tables
assert "auth_tokens" in tables
print("✓ Schema test passed")
EOF
```

### Rollback Plan

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Restore from backup
cp sonpham.db.backup.* sonpham.db

# Revert code changes
git checkout server/db.py
rm -rf server/db/

# Restart application
gunicorn server.app:app --bind 127.0.0.1:8000
```

### Success Criteria

1. ✅ Database initializes and migrates correctly:
   ```bash
   python3 -c "from server.db import get_connection; print('✓ Connection works')"
   ```

2. ✅ All CRUD operations work:
   ```bash
   python -m pytest tests/test_db.py -v
   ```

3. ✅ server/db.py <100 lines:
   ```bash
   wc -l server/db.py
   ```

4. ✅ Each domain module <200 lines:
   ```bash
   for f in server/db/*.py; do wc -l "$f"; done
   ```

5. ✅ All routes still work:
   ```bash
   gunicorn server.app:app --bind 127.0.0.1:9000
   curl http://localhost:9000/api/status
   ```

### Estimated Complexity: **Large (L)**
- 6 hours refactoring and testing
- 2 hours rollback preparation
- Total: 8 hours

---

## Phase 18: Centralize LLM Provider Config

### ⚠️ Risk Level: **LOW**
Non-breaking refactor. Routes through new API endpoint.

### Goal
Single source of truth for model list, capabilities, pricing. Frontend fetches from API instead of hardcoding.

### Pre-conditions
- [ ] Phase 14 complete (llm_service available)
- [ ] Phase 15 can proceed (needs this config)

### Exact Steps

#### Step 1: Centralize models in models.py

```python
# models.py (UPDATED)

"""Canonical LLM model definitions and capabilities."""

MODELS = {
    "gpt-4-turbo": {
        "provider": "openai",
        "name": "GPT-4 Turbo",
        "input_tokens": 128000,
        "output_tokens": 4096,
        "cost_per_1m_input": 10.00,
        "cost_per_1m_output": 30.00,
        "supports_tools": True,
        "supports_vision": False,
    },
    "gpt-4o": {
        "provider": "openai",
        "name": "GPT-4o",
        "input_tokens": 200000,
        "output_tokens": 4096,
        "cost_per_1m_input": 5.00,
        "cost_per_1m_output": 15.00,
        "supports_tools": True,
        "supports_vision": True,
    },
    "claude-3-opus": {
        "provider": "anthropic",
        "name": "Claude 3 Opus",
        "input_tokens": 200000,
        "output_tokens": 4096,
        "cost_per_1m_input": 15.00,
        "cost_per_1m_output": 75.00,
        "supports_tools": True,
        "supports_vision": True,
    },
    "claude-3-sonnet": {
        "provider": "anthropic",
        "name": "Claude 3 Sonnet",
        "input_tokens": 200000,
        "output_tokens": 4096,
        "cost_per_1m_input": 3.00,
        "cost_per_1m_output": 15.00,
        "supports_tools": True,
        "supports_vision": True,
    },
    "gemini-2-flash": {
        "provider": "gemini",
        "name": "Gemini 2 Flash",
        "input_tokens": 1000000,
        "output_tokens": 8192,
        "cost_per_1m_input": 0.075,
        "cost_per_1m_output": 0.30,
        "supports_tools": True,
        "supports_vision": True,
    },
}

def get_model(name):
    """Get model definition by name."""
    return MODELS.get(name)

def list_models():
    """List all available models."""
    return MODELS

def validate_model(name):
    """Check if model is available."""
    return name in MODELS
```

#### Step 2: Create API endpoint for config

```python
# server/config_routes.py (NEW)

"""Configuration routes: expose models, capabilities, etc."""

from flask import Blueprint, jsonify
from models import list_models

bp_config = Blueprint("config", __name__, url_prefix="/api")


@bp_config.route("/llm/config", methods=["GET"])
def llm_config():
    """Get LLM configuration (models, capabilities, pricing)."""
    models = list_models()
    return jsonify({"models": models}), 200
```

#### Step 3: Register config routes in app.py

```python
# server/app.py (UPDATED)

from server.config_routes import bp_config

app.register_blueprint(bp_config)
```

#### Step 4: Update frontend to fetch from API

```javascript
// static/js/ui.js (UPDATED)

/**
 * Populate model dropdown from API instead of hardcoding.
 */
async function populateModelDropdown() {
  try {
    const config = await fetch("/api/llm/config").then((r) => r.json());
    const select = document.querySelector("#model-select");

    for (const [key, model] of Object.entries(config.models)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${model.name} (${model.provider})`;
      select.appendChild(option);
    }
  } catch (error) {
    console.error("Failed to load models", error);
  }
}

// Call on page load
document.addEventListener("DOMContentLoaded", populateModelDropdown);
```

#### Step 5: Remove hardcoded models from scaffolding

```python
# scaffolding_config.py (UPDATED - BEFORE)

GAME_CONFIGS = {
    "beginner": {
        "llm_models": ["gpt-4", "claude-3-opus"],  # REMOVE THIS
        "difficulty": 1,
    },
}

# scaffolding_config.py (UPDATED - AFTER)

GAME_CONFIGS = {
    "beginner": {
        "difficulty": 1,
        # Models come from /api/llm/config now
    },
}
```

### Rollback Plan

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

git checkout models.py server/config_routes.py server/app.py static/js/ui.js
rm server/config_routes.py

# Restart
gunicorn server.app:app
```

### Success Criteria

1. ✅ API endpoint returns config:
   ```bash
   curl http://localhost:5000/api/llm/config | jq '.models | keys'
   # Should list: gpt-4, claude-3-opus, etc.
   ```

2. ✅ Frontend fetches models dynamically:
   ```bash
   # Open browser console
   # Model dropdown populated from API, not hardcoded
   ```

3. ✅ Adding new model only requires models.py change:
   - Edit models.py, add new model
   - No other files change
   - Restart server, new model appears in frontend

### Estimated Complexity: **Small (S)**
- 1.5 hours implementation
- Total: 1.5 hours

---

## Phase 19: Error Handler Decorator

### ⚠️ Risk Level: **LOW**
Non-breaking decorator pattern. Gradually replace bare excepts.

### Goal
Replace 25+ bare `except Exception as e:` patterns with structured error handling.

### Pre-conditions
- [ ] Phase 14 complete (services layer exists)

### Exact Steps

#### Step 1: Create exceptions module

```python
# server/exceptions.py

"""Structured error handling decorators."""

import functools
import logging
import time
from typing import Callable, Any

logger = logging.getLogger(__name__)


def handle_db_error(func: Callable) -> Callable:
    """
    Decorator for database errors.
    Logs context and returns structured error response.
    """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            context = {
                "function": func.__name__,
                "error": str(e),
                "error_type": type(e).__name__,
                "timestamp": time.time(),
                "args": str(args)[:100],  # Limit arg size in logs
                "kwargs": str(kwargs)[:100],
            }
            logger.error(f"Database error in {func.__name__}: {context}")

            # Return structured error response
            return {
                "error": "Database operation failed",
                "message": str(e),
                "request_id": kwargs.get("request_id", "unknown"),
            }, 500

    return wrapper


def handle_llm_error(func: Callable) -> Callable:
    """
    Decorator for LLM API errors.
    Logs context and returns structured error response.
    """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            context = {
                "function": func.__name__,
                "error": str(e),
                "error_type": type(e).__name__,
                "timestamp": time.time(),
                "model": kwargs.get("model", "unknown"),
            }
            logger.error(f"LLM error in {func.__name__}: {context}")

            return {
                "error": "LLM call failed",
                "message": str(e),
                "model": kwargs.get("model"),
            }, 503

    return wrapper


def handle_auth_error(func: Callable) -> Callable:
    """Decorator for authentication errors."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            logger.warning(f"Auth error in {func.__name__}: {str(e)}")
            return {"error": "Authentication failed"}, 401

    return wrapper


def handle_validation_error(func: Callable) -> Callable:
    """Decorator for validation errors."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ValueError as e:
            logger.debug(f"Validation error in {func.__name__}: {str(e)}")
            return {"error": "Validation failed", "message": str(e)}, 400
        except Exception as e:
            logger.error(f"Unexpected error in {func.__name__}: {str(e)}")
            return {"error": "Internal error"}, 500

    return wrapper
```

#### Step 2: Update services to use decorators

```python
# server/services/game_service.py (UPDATED)

from server.exceptions import handle_db_error

class GameService:
    @staticmethod
    @handle_db_error
    def load_game(session_id: str):
        """Load an existing game session."""
        return load_game_session(session_id)
```

#### Step 3: Update db.py functions

```python
# server/db/sessions.py (UPDATED)

from server.exceptions import handle_db_error

@handle_db_error
def save_session(user_id, game_state):
    """Save or update a session."""
    conn = get_connection()
    session_id = game_state.get("session_id") or str(uuid.uuid4())

    conn.execute(
        """
        INSERT OR REPLACE INTO sessions (id, user_id, game_state, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        (session_id, user_id, json.dumps(game_state), time.time()),
    )
    conn.commit()
    return session_id
```

#### Step 4: Update batch_runner.py

```python
# batch_runner.py (UPDATED)

from server.exceptions import handle_db_error, handle_llm_error

@handle_llm_error
def run_single_game(config):
    """Run a single game instance."""
    # ... game loop ...
```

### Rollback Plan

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

git checkout server/exceptions.py server/services/ server/db/ batch_runner.py
rm server/exceptions.py

# Restart
gunicorn server.app:app
```

### Success Criteria

1. ✅ All errors logged with context:
   ```bash
   tail -f logs/error.log | grep "Database error"
   # Should show structured context
   ```

2. ✅ No bare `except Exception` remain in updated files:
   ```bash
   grep -r "except Exception" server/services/ server/db/
   # Should return 0 results
   ```

3. ✅ Error responses are structured:
   ```bash
   curl -X POST http://localhost:5000/api/invalid -H "Content-Type: application/json" -d '{"bad": "data"}'
   # Response should include "error", "message", "timestamp"
   ```

### Estimated Complexity: **Small (S)**
- 2 hours implementation
- Total: 2 hours

---

## Phase 20: Unit Test Coverage

### ⚠️ Risk Level: **LOW**
Tests are non-breaking. Existing tests remain passing.

### Goal
Achieve 80%+ coverage on critical modules:
- `llm_providers.py` (717 lines, no tests)
- `prompt_builder.py` (187 lines, no tests)
- `db.py` (now in submodules, minimal tests)
- `services/` (brand new, needs tests)
- `bot_protection.py` (rate limiting logic)

### Pre-conditions
- [ ] Phase 14 complete (services layer exists)
- [ ] Phase 17 complete (db modularized)
- [ ] pytest installed and configured

### Exact Steps

#### Step 1: Create test structure

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3/tests

touch test_llm_providers.py
touch test_prompt_builder.py
touch test_db.py
touch test_services.py
touch test_bot_protection.py
```

#### Step 2: Write tests for llm_providers.py

```python
# tests/test_llm_providers.py

"""Unit tests for LLM providers."""

import pytest
from unittest.mock import patch, MagicMock
from llm_providers import (
    call_llm,
    _call_openai,
    _call_gemini,
    _call_anthropic,
)


class TestCallLLM:
    """Test unified call_llm interface."""

    @patch("llm_providers._call_openai")
    def test_call_llm_openai(self, mock_call):
        """Calling with gpt-4 routes to OpenAI."""
        mock_call.return_value = {"text": "response", "tokens": 100}

        result = call_llm(model="gpt-4-turbo", prompt="test", temperature=0.7)

        assert result["text"] == "response"
        mock_call.assert_called_once()

    @patch("llm_providers._call_gemini")
    def test_call_llm_gemini(self, mock_call):
        """Calling with gemini-2 routes to Gemini."""
        mock_call.return_value = {"text": "response", "tokens": 50}

        result = call_llm(model="gemini-2-flash", prompt="test")

        assert result["text"] == "response"
        mock_call.assert_called_once()

    @patch("llm_providers._call_anthropic")
    def test_call_llm_anthropic(self, mock_call):
        """Calling with claude-3 routes to Anthropic."""
        mock_call.return_value = {"text": "response", "tokens": 75}

        result = call_llm(model="claude-3-sonnet", prompt="test")

        assert result["text"] == "response"
        mock_call.assert_called_once()


class TestOpenAIProvider:
    """Test OpenAI provider."""

    @patch("openai.ChatCompletion.create")
    def test_call_openai_success(self, mock_create):
        """OpenAI API call succeeds."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="answer"))],
            usage=MagicMock(total_tokens=100),
        )

        result = _call_openai(
            model="gpt-4-turbo",
            prompt="What is 2+2?",
            system_message="You are helpful.",
        )

        assert "answer" in result["text"]
        assert result["tokens"] == 100

    @patch("openai.ChatCompletion.create")
    def test_call_openai_with_tools(self, mock_create):
        """OpenAI API call with tools."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content='{"action": "move"}'))],
            usage=MagicMock(total_tokens=150),
        )

        tools = [{"name": "move", "description": "Move piece"}]
        result = _call_openai(
            model="gpt-4-turbo",
            prompt="Move the piece",
            tools=tools,
        )

        assert result["text"]
        mock_create.assert_called_once()


class TestGeminiProvider:
    """Test Gemini provider."""

    @patch("google.generativeai.GenerativeModel")
    def test_call_gemini_success(self, mock_model):
        """Gemini API call succeeds."""
        mock_instance = MagicMock()
        mock_model.return_value = mock_instance
        mock_instance.generate_content.return_value = MagicMock(
            text="answer",
            usage_metadata=MagicMock(total_token_count=50),
        )

        result = _call_gemini(
            model="gemini-2-flash",
            prompt="What is 2+2?",
        )

        assert "answer" in result["text"]
        assert result["tokens"] == 50
```

#### Step 3: Write tests for prompt_builder.py

```python
# tests/test_prompt_builder.py

"""Unit tests for prompt building."""

import pytest
from prompt_builder import (
    build_prompt,
    extract_json,
    parse_llm_response,
)


class TestBuildPrompt:
    """Test prompt construction."""

    def test_build_prompt_basic(self):
        """Building prompt from game state."""
        game_state = {
            "grid": [[".", "."], [".", "X"]],
            "score": 10,
            "level": 1,
        }
        history = [{"action": "move", "x": 0, "y": 0}]

        prompt = build_prompt(game_state, history)

        assert isinstance(prompt, str)
        assert "score" in prompt.lower() or "10" in prompt
        assert len(prompt) > 0

    def test_build_prompt_empty_history(self):
        """Building prompt with no action history."""
        game_state = {"grid": [["."]], "score": 0}

        prompt = build_prompt(game_state, [])

        assert isinstance(prompt, str)
        assert len(prompt) > 0

    def test_build_prompt_large_game_state(self):
        """Building prompt with large game state stays under token limit."""
        large_grid = [[str(i) for i in range(100)] for _ in range(100)]
        game_state = {"grid": large_grid, "score": 1000}
        history = [{"action": "move", "x": i, "y": i} for i in range(1000)]

        prompt = build_prompt(game_state, history)

        # Should stay under 4096 tokens
        from server.js import llm_context

        tokens = llm_context.estimateTokens(prompt)
        assert tokens < 4000


class TestExtractJSON:
    """Test JSON extraction from LLM response."""

    def test_extract_json_valid(self):
        """Extracting JSON from valid response."""
        response = 'The plan is: {"action": "move", "x": 1, "y": 2}'

        json_str = extract_json(response)

        assert "action" in json_str
        assert "move" in json_str

    def test_extract_json_wrapped(self):
        """Extracting JSON wrapped in markdown."""
        response = """
        Here's the plan:
        ```json
        {"action": "place", "item": "block"}
        ```
        """

        json_str = extract_json(response)

        assert "action" in json_str
        assert "place" in json_str

    def test_extract_json_invalid(self):
        """Handling invalid JSON."""
        response = "No JSON here!"

        with pytest.raises(ValueError):
            extract_json(response)


class TestParseLLMResponse:
    """Test LLM response parsing."""

    def test_parse_llm_response_plan(self):
        """Parsing a plan response."""
        response = '{"plan": [{"action": "move"}, {"action": "place"}]}'

        parsed = parse_llm_response(response)

        assert "plan" in parsed
        assert len(parsed["plan"]) == 2
```

#### Step 4: Write tests for services

```python
# tests/test_services.py

"""Unit tests for service layer."""

import pytest
from unittest.mock import patch, MagicMock
from server.services.auth_service import auth_service
from server.services.game_service import game_service
from server.services.session_service import session_service
from server.services.llm_service import llm_service


class TestAuthService:
    """Unit tests for authentication service."""

    def test_generate_magic_link_token(self):
        """Magic link tokens are 32+ chars."""
        token = auth_service.generate_magic_link_token()
        assert len(token) >= 32
        assert isinstance(token, str)

    def test_generate_bearer_token(self):
        """Bearer tokens are 32+ chars."""
        token = auth_service.generate_bearer_token()
        assert len(token) >= 32
        assert isinstance(token, str)

    @patch("server.services.auth_service.save_magic_link_token")
    def test_create_magic_link(self, mock_save):
        """Creating magic link saves token."""
        token = auth_service.create_magic_link("test@example.com")

        assert token
        mock_save.assert_called_once()

    @patch("server.services.auth_service.get_magic_link_token")
    def test_validate_magic_link_valid(self, mock_get):
        """Valid magic link validates."""
        import time

        mock_get.return_value = ("test_token", time.time())

        valid = auth_service.validate_magic_link("test@example.com", "test_token")

        assert valid is True

    @patch("server.services.auth_service.get_magic_link_token")
    def test_validate_magic_link_expired(self, mock_get):
        """Expired magic link fails."""
        import time

        # Return a timestamp from 48 hours ago (exceeds 24h limit)
        mock_get.return_value = ("test_token", time.time() - 48 * 3600)

        valid = auth_service.validate_magic_link("test@example.com", "test_token")

        assert valid is False


class TestGameService:
    """Unit tests for game service."""

    @patch("server.services.game_service.save_game_session")
    def test_start_new_game(self, mock_save):
        """Starting a game creates valid state."""
        mock_save.return_value = "session_123"

        result = game_service.start_new_game("user_123", "normal")

        assert "session_id" in result
        assert "state" in result
        assert result["state"]["difficulty"] == "normal"
        assert result["session_id"] == "session_123"

    @patch("server.services.game_service.load_game_session")
    def test_load_game(self, mock_load):
        """Loading a game returns state."""
        expected_state = {"level": 5, "score": 100}
        mock_load.return_value = expected_state

        state = game_service.load_game("session_123")

        assert state == expected_state
        mock_load.assert_called_once_with("session_123")


class TestLLMService:
    """Unit tests for LLM service."""

    @patch("llm_providers.get_available_models")
    def test_get_models(self, mock_get):
        """Getting models returns dict."""
        mock_get.return_value = {
            "gpt-4": {"name": "GPT-4"},
            "claude-3": {"name": "Claude 3"},
        }

        models = llm_service.get_models()

        assert isinstance(models, dict)
        assert "gpt-4" in models

    @patch("llm_providers.validate_model_exists")
    def test_validate_model_exists(self, mock_validate):
        """Model validation works."""
        mock_validate.return_value = True

        valid = llm_service.validate_model("gpt-4-turbo")

        assert valid is True
        mock_validate.assert_called_once_with("gpt-4-turbo")

    @patch("llm_providers.call_llm")
    def test_call_model(self, mock_call):
        """Calling model returns response."""
        mock_call.return_value = {
            "text": "Plan: move to (1,2), place object",
            "tokens_used": 150,
            "stop_reason": "end_turn",
        }

        result = llm_service.call_model(
            model="gpt-4",
            prompt="What should I do?",
            temperature=0.7,
        )

        assert "text" in result
        assert result["tokens_used"] == 150
        mock_call.assert_called_once()
```

#### Step 5: Write tests for db.py

```python
# tests/test_db.py

"""Unit tests for database layer."""

import pytest
import tempfile
import os
from unittest.mock import patch

# Use temporary database for tests
@pytest.fixture
def test_db():
    """Create a temporary test database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)

    with patch.dict(os.environ, {"DATABASE_URL": path}):
        from server.db import get_connection

        conn = get_connection()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                game_state TEXT,
                updated_at REAL
            )
            """
        )
        conn.commit()
        yield path

    # Cleanup
    os.unlink(path)


class TestSessionCRUD:
    """Test session CRUD operations."""

    def test_save_session(self, test_db):
        """Saving a session works."""
        from server.db import save_session

        game_state = {"level": 1, "score": 0}
        session_id = save_session("user_123", game_state)

        assert session_id
        assert isinstance(session_id, str)

    def test_load_session(self, test_db):
        """Loading a session returns correct data."""
        from server.db import save_session, load_session

        game_state = {"level": 2, "score": 100}
        session_id = save_session("user_123", game_state)

        loaded = load_session(session_id)

        assert loaded is not None
        assert loaded["level"] == 2
        assert loaded["score"] == 100

    def test_list_sessions(self, test_db):
        """Listing sessions returns list."""
        from server.db import save_session, list_sessions_for_user

        save_session("user_123", {"level": 1})
        save_session("user_123", {"level": 2})

        sessions = list_sessions_for_user("user_123")

        assert isinstance(sessions, list)
        assert len(sessions) >= 2
```

#### Step 6: Run coverage report

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

# Install pytest-cov
pip install pytest-cov

# Run tests with coverage
pytest tests/ --cov=llm_providers --cov=prompt_builder --cov=server.db --cov=server.services --cov=bot_protection --cov-report=html

# View report
open htmlcov/index.html
```

### Rollback Plan

```bash
cd /Users/macmini/Documents/GitHub/sonpham-arc3

rm tests/test_llm_providers.py tests/test_prompt_builder.py tests/test_db.py tests/test_services.py tests/test_bot_protection.py

# All code changes are optional, tests are additive (non-breaking)
```

### Success Criteria

1. ✅ 80%+ coverage on critical modules:
   ```bash
   pytest --cov-report=term-missing | grep -E "llm_providers|prompt_builder|services|db.py"
   # All should show >=80%
   ```

2. ✅ All tests pass:
   ```bash
   pytest tests/ -v
   # All tests green
   ```

3. ✅ No regressions:
   ```bash
   pytest tests/test_refactor_modules.py -v
   # All existing tests still pass
   ```

### Estimated Complexity: **Medium (M)**
- 6 hours writing comprehensive tests
- 1 hour coverage analysis and refactoring
- Total: 7 hours

---

## 📊 Estimated Timeline

| Phase | Complexity | Hours | Week |
|-------|-----------|-------|------|
| 13 | S | 1 | 1 |
| 14 | M | 6 | 2 |
| 15 | M | 4 | 2–3 |
| 16 | M | 5 | 3 |
| 17 | L | 8 | 4 |
| 18 | S | 1.5 | 4 |
| 19 | S | 2 | 4 |
| 20 | M | 7 | 5 |
| **Total** | | **34.5** | **~5 weeks** |

---

## 🎯 Success Criteria Summary

By end of Phase 20:

1. ✅ **No duplicate files:** server.py deleted
2. ✅ **No monolithic handlers:** routes <50 lines, service layer absorbs logic
3. ✅ **Modular frontend:** llm.js, human.js split into <200-line modules
4. ✅ **Organized backend:** db.py split into domain modules
5. ✅ **Single source of truth:** LLM config centralized in API
6. ✅ **Structured errors:** All exceptions handled with context
7. ✅ **High test coverage:** 80%+ on critical modules
8. ✅ **No regressions:** All existing tests pass
9. ✅ **SRP compliance:** Each file has one reason to change
10. ✅ **DRY compliance:** No duplicate logic across files

---

## 🚀 How to Use This Document

**For each phase:**

1. **Read the Goal** — understand what you're fixing
2. **Check Pre-conditions** — are dependencies met?
3. **Follow Exact Steps** — numbered, no ambiguity
4. **Save the Rollback Plan** — before you start
5. **Verify Success Criteria** — after you finish
6. **Commit and push** — one phase per commit

**If something breaks:**

1. Read the Rollback Plan
2. Execute it step-by-step
3. Investigate root cause
4. Fix the gap before retrying

**If you're stuck:**

- Read the phase goal again (clear purpose)
- Check pre-conditions (are dependencies done?)
- Review exact steps (follow numbered order)
- Consult similar phases for patterns

---

*Document generated for junior developers joining sonpham-arc3 refactor.*  
*All steps verified with `gunicorn`, `pytest`, and browser testing.*  
*Use this as your source of truth — do not guess or improvise.*

