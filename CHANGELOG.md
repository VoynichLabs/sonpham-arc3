# Changelog

All notable changes to this project will be documented here.
Format: [SemVer](https://semver.org/) — what / why / how. Author and model noted per entry. New entries at the top. 

---

## [1.1.0] — refactor/phase-1-modularization
*Author: Mark Barney + Cascade (Claude Opus 4.6 thinking) | 2026-03-11*

### Added
- `constants.py` — shared color palette, action labels, game description (extracted from server.py/agent.py)
- `bot_protection.py` — Cloudflare Turnstile verification, IP rate limiting, user-agent filtering (extracted from server.py)
- `grid_analysis.py` — RLE row compression, change maps, color histograms, flood-fill region maps (extracted from server.py)
- `prompt_builder.py` — LLM prompt construction and response parsing (extracted from server.py)
- `session_manager.py` — in-memory session state and DB-backed session recovery (extracted from server.py)
- `static/js/utils/formatting.js` — canonical HTML escaping (escapeHtml, _esc), formatDuration, formatCost
- `static/js/utils/json-parsing.js` — findFinalMarker, extractJsonFromText, parseRlmClientOutput, parseClientLLMResponse
- `static/js/utils/tokens.js` — estimateTokens, TOKEN_PRICES lookup table
- `static/js/config/scaffolding-schemas.js` — SCAFFOLDING_SCHEMAS declarative field definitions
- `static/js/rendering/grid-renderer.js` — renderGridOnCanvas, renderGridWithChangesOnCanvas (pure canvas rendering)
- `static/js/observatory/obs-lifecycle.js` — in-app observatory mode enter/exit/status lifecycle
- `static/js/observatory/obs-log-renderer.js` — shared observatory log/tooltip rendering utilities
- `static/js/observatory/obs-scrubber.js` — shared step scrubber slider UI logic
- `static/js/observatory/obs-swimlane-renderer.js` — shared swimlane timeline rendering
- `static/js/scaffolding-linear.js` — linear (single-turn) prompt builder (extracted from scaffolding.js)
- `static/js/scaffolding-rlm.js` — RLM reflective reasoning loop (extracted from scaffolding.js)
- `static/js/scaffolding-three-system.js` — three-system/two-system cognitive architecture (extracted from scaffolding.js)
- `static/js/scaffolding-agent-spawn.js` — agent spawn multi-agent orchestrator (extracted from scaffolding.js)
- LM Studio server-side proxy endpoint `/api/llm/lmstudio-proxy` to bypass CORS
- LM Studio system-message-to-user promotion in `_callLLMInner` for Jinja template compatibility
- File headers (Author/Date/PURPOSE/SRP-DRY) on all 29 new and modified files per `coding-standards.md`
- `CHANGELOG.md` updated with v1.1.0 refactor entry (restored from master, not overwritten)
- `docs/2026-03-11-refactor-headers-plan.md` — plan doc for header compliance task

### Changed
- `server.py` — reduced to Flask glue layer; imports from new Python modules
- `agent.py` — imports shared constants from `constants.py`
- `db.py` — updated imports for session_manager.py compatibility
- `static/js/scaffolding.js` — core LLM call infrastructure only; scaffolding types extracted to separate files
- `static/js/llm.js` — formatting and token helpers extracted to utility modules
- `static/js/state.js` — SCAFFOLDING_SCHEMAS extracted to config/scaffolding-schemas.js
- `static/js/ui.js` — pure grid rendering extracted to rendering/grid-renderer.js
- `static/js/observatory.js` — shared rendering extracted to observatory/ modules
- `static/js/obs-page.js` — shared rendering extracted to observatory/ modules
- `static/js/reasoning.js` — formatting extracted to utils/formatting.js
- `static/js/share-page.js` — formatting extracted to utils/formatting.js

### Fixed
- LM Studio 400 Bad Request when only system messages present (promoted to user role)
- LM Studio proxy swallowing error body (now forwards actual response body and status)

---

## [1.0.2] — feature/lmstudio-support
*Author: Mark Barney + Cascade (Claude Opus 4.6 Thinking) | 2026-03-10*

### Fixed
- **"No API key for LM Studio" error** (`scaffolding.js`) — LM Studio is a local program, not a cloud API. It doesn't need an API key. But `_callLLMInner` has a key gate that all non-Puter providers must pass. The LM Studio call block was positioned after this gate with no key set, so every LLM call threw immediately. Fix: `loadModels()` now sets a dummy key (`'local-no-key-needed'`) in localStorage when LM Studio models are discovered (both server-side and client-side paths). The key gate passes, the LM Studio block ignores the key and uses `baseUrl` from localStorage instead. No restructuring of provider routing needed.
- **CORS blocking all LM Studio calls** (`scaffolding.js`, `server.py`) — LM Studio does NOT send `Access-Control-Allow-Origin` headers. Every browser fetch to `localhost:1234` — both discovery AND chat completions — was blocked by CORS policy. Discovery was already fixed by server-side probing in staging mode. LLM calls now route through `/api/llm/lmstudio-proxy` on our Flask server, which forwards to `localhost:1234` server-to-server (no CORS). Same pattern as the existing Cloudflare Workers AI proxy (`/api/llm/cf-proxy`). Custom base URLs (Cloudflare Tunnel) are passed through.
- **LM Studio 400 Bad Request on system-only messages** (`scaffolding.js`) — LM Studio Jinja templates require at least one `user` message. The scaffold orchestrator sends `[{role:'system', content:...}]` only, which LM Studio rejects with `"No user query found in messages"`. Fix: LM Studio branch in `_callLLMInner` now promotes the system message to user role when no user message is present. Same pattern as the existing Gemini branch.
- **LM Studio proxy swallowing error details** (`server.py`) — `/api/llm/lmstudio-proxy` used `raise_for_status()` which replaced the actual LM Studio error body with a generic httpx exception string. Fix: proxy now forwards the actual response body and status code from LM Studio, so the client sees the real error message.

---

## [1.0.1] — feature/lmstudio-support
*Author: Mark Barney + Cascade (Claude Opus 4.6 Thinking) | 2026-03-10*

### Added
- **LM Studio provider** (`scaffolding.js`, `ui.js`, `models.py`, `server.py`) — users can now run inference against locally loaded LM Studio models directly from the web UI. Browser calls `localhost:1234/v1/chat/completions` directly; Railway server is never involved in the call path.
- **`LMSTUDIO_CAPABILITIES` lookup table** (`models.py`) — known capability overrides (reasoning, image) keyed on `api_model` ID. Used by both CLI (`agent.py`) and browser discovery paths.
- **`docs/lmstudio-integration.md`** — developer notes capturing every integration pitfall hit during implementation.
- **`docs/2026-03-10-lmstudio-discovery-plan.md`** — architecture plan for completing client-side discovery (pending).
- **`coding-standards.md`** — Mark's coding standards, now tracked in repo.
- **`AGENTS.md`** — agent-specific coding instructions incorporating all standards.

### Fixed
- `reasoning_content` fallback in `_callLLMInner` (`scaffolding.js`) — GLM-series models return thinking tokens in `reasoning_content`; `content` comes back `null`. Blind `content || ''` read produced empty output. Fixed to `content || reasoning_content || ''`.
- LM Studio models not appearing in model selector dropdown (`scaffolding.js`) — `'Lmstudio'` was missing from `providerOrder`; all discovered models were silently dropped.
- Duplicate model entries in dropdown (`server.py`) — static registry entries and dynamic discovery both produced entries for the same `api_model`, showing every model twice. Dynamic entries now skip any `api_model` already in the static registry. Static LM Studio entries subsequently removed entirely (see below).
- Embedding models appearing in chat model selector (`server.py`) — `text-embedding-*` models filtered out of dynamic discovery results.
- Wrong image capability on `qwen3.5-35b-a3b` (`models.py`, `server.py`) — model has confirmed vision encoder (mmproj, from load logs) but was marked `image: False`. Corrected to `True`.
- Misleading CORS error message (`scaffolding.js`) — told users to enable CORS when LM Studio 0.3+ has it on by default. Updated to direct users to check model load state instead.

### Removed
- Static LM Studio model registry entries (`models.py`) — `lmstudio-qwen3.5-35b`, `lmstudio-glm-4.7-flash`, `lmstudio-glm-4.6v-flash` were hardcoded for one developer's machine. Removed in favour of pure dynamic discovery so any model a user has loaded appears automatically.

### Completed (plan execution by Cascade, using Claude Opus 4.6 Thinking)
- **Server-side LM Studio discovery removed** from `server.py` — port 1234 removed from `LOCAL_PORTS`; `is_lmstudio` branching and `LMSTUDIO_CAPABILITIES` server-side lookup cleaned up. Ports 8080/8000 retained for other local servers.
- **Browser-side LM Studio discovery finalized** in `scaffolding.js` `loadModels()` — fetches `{baseUrl}/v1/models` directly from browser with 1.5s timeout, filters embedding models, annotates capabilities from `LMSTUDIO_CAPABILITIES`, merges into `modelsData`. Dead dedup code removed.
- **File headers added** to all edited files (`scaffolding.js`, `ui.js`, `server.py`, `models.py`) per `coding-standards.md`.
- **`docs/lmstudio-integration.md` rewritten** — architecture section now documents client-side discovery flow; pitfalls #3, #6, #7 updated to reference correct files; testing section replaced with browser-based verification; client↔server communication analysis and next-developer notes added.
- **`CHANGELOG.md` created and maintained** (this file) — was missing, now tracks all changes.
- **Dead `LMSTUDIO_CAPABILITIES` import removed** from `server.py` — no longer used after server-side discovery removal. Comment added explaining it lives in `models.py` for CLI agent path only.
- **Hybrid discovery strategy implemented** — LM Studio does NOT send CORS headers by default, so browser-only discovery fails silently. Fix: server-side discovery restored for staging mode (server is local, no CORS needed); client-side discovery kept for production (Railway, requires user to enable CORS in LM Studio). Client-side dedup prevents doubles when both paths find models. Console warning added for CORS/network failures to aid debugging. New pitfall documented in `docs/lmstudio-integration.md`.

---

## [1.0.0] — master baseline
*2026-03-10*

Initial versioned baseline. Captures the state of `master` at the time `CHANGELOG.md` was introduced. All prior work is recorded in git history.
