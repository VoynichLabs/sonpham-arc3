# sonpham-arc3: SRP/DRY Violations Audit

**Date:** 2026-03-12  
**Branch:** refactor/phase-1-modularization  
**Status:** Phases 1–12 complete. Remaining violations documented below.

---

## Critical Issues

### Duplicate Flask Servers

Two complete, nearly identical Flask servers exist:

| File | Lines | Status |
|------|-------|--------|
| `server.py` | 2566 | **LIVE** — referenced in Procfile (`gunicorn server:app`) |
| `server/app.py` | 2390 | Refactored version — NOT deployed |

**68 route handlers are duplicated** between both files. Every bug fix applied to one does not exist in the other.

**Fix (Phase 13):** Delete `server.py`. Update Procfile: `gunicorn server.app:app`. Verify all 57 routes.

---

## Still-Large Files

| File | Lines | Primary Problem |
|------|-------|----------------|
| `server.py` | 2566 | Monolith: routing + auth + game logic + LLM proxying + sessions + social |
| `server/app.py` | 2390 | Same as server.py — refactored structure but handlers still inline |
| `static/js/llm.js` | 1399 | Orchestration + plan execution + tool use + token calc + UI rendering |
| `static/js/human.js` | 1392 | Game play + canvas rendering + input + session persistence + social |
| `static/js/obs-page.js` | 1466 | Observatory UI: session loading + swimlane + log rendering + scrubber |
| `static/js/state.js` | 968 | Global state + scaffolding config + UI rendering + storage sync |
| `static/js/ui.js` | 1169 | Grid rendering + model mgmt + token mgmt + game loading + 60+ functions |
| `agent.py` | 766 | Config + memory + context building + prompt building + game loop + logging |
| `db.py` | 1028 | Schema + migrations + session CRUD + auth + leaderboard + event logging |
| `llm_providers.py` | 717 | 10+ provider implementations + tool sessions + caching + throttling |

---

## SRP Violations

### `server.py` / `server/app.py`
Each route handler mixes:
- HTTP request parsing and validation
- Business logic (game stepping, auth token generation, session branching)
- Direct database calls (no service/DAO layer)
- LLM provider routing
- Response serialization

### `static/js/llm.js`
Mixes: LLM call orchestration · plan execution · Python REPL tool use · autoplay loop · token calculations · context building · UI updates

### `static/js/human.js`
Mixes: game playing · canvas rendering · keyboard/click input · session persistence · live mode · level tracking · comments/voting · contributors · feedback

### `db.py`
Mixes: schema definition (`CREATE TABLE` in `_init_db`) · schema migrations · session CRUD · action logging · LLM call tracking · observatory event logging · share link management · auth persistence · leaderboard queries · tool execution logging

### `llm_providers.py`
Mixes: provider routing · Gemini (156-line function) · Anthropic · OpenAI · Ollama · Copilot OAuth · Pyodide tool sessions · caching · rate throttling

### `agent.py`
Mixes: config loading · hard memory I/O · context building · prompt building · game loop orchestration (245-line `play_game()`) · post-game logging · observatory metrics

### `static/js/state.js`
Mixes: scaffolding configuration (60+ getters/setters) · session state · localStorage sync · UI rendering (15+ render functions) · session lifecycle management

---

## DRY Violations

| Violation | Files Affected | Priority |
|-----------|---------------|----------|
| 68 duplicate route handlers | `server.py` + `server/app.py` | 🔴 Critical |
| `_extract_json` + `_parse_llm_response` defined in server files, should import from `prompt_builder` | `server.py`, `server/app.py`, `prompt_builder.py` | 🟠 High |
| 22+ bare `except Exception as e:` with no context | `db.py` (22x), `batch_runner.py` (3x), server files | 🟠 High |
| Bearer token validation duplicated | `server.py:2414`, `server/app.py:2238`, `llm_providers.py`, `agent_llm.py` | 🟡 Medium |
| Model registry referenced in backend (`models.py`) and scattered JS | `models.py`, `ui.js`, scaffolding configs | 🟡 Medium |
| `formatDuration()` in `human.js` and `utils/formatting.js` | `human.js`, `utils/formatting.js` | 🟢 Low |
| Prompt templates (`"You are..."`) scattered across files | `models.py`, `constants.py`, test files, scaffoldings | 🟢 Low |

---

## God Functions (> 50 lines)

### Python

| File | Line | Function | Lines |
|------|------|----------|-------|
| `agent.py` | 365 | `play_game()` | 245 |
| `db.py` | 228 | `_migrate_schema()` | 175 |
| `db.py` | 36 | `_init_db()` | 173 |
| `db.py` | 849 | `_export_session_to_file()` | 127 |
| `llm_providers.py` | 283 | `_call_gemini()` | 156 |
| `batch_runner.py` | 311 | `run_batch()` | 131 |
| `prompt_builder.py` | 54 | `_build_prompt()` | 133 |
| `server.py` | 1368 | `import_session()` | 150 |
| `agent.py` | 666 | `main()` | 96 |
| `server.py` | 932 | `llm_models()` | 99 |
| `batch_runner.py` | 161 | `run_single_game()` | 102 |

### JavaScript

| File | Function | Est. Lines |
|------|----------|-----------|
| `llm.js` | `executePlan()` | ~240 |
| `llm.js` | `askLLM()` | ~65 |
| `state.js` | `attachSettingsListeners()` | ~75 |
| `obs-page.js` | swimlane/session rendering | ~100 |

---

## Test Coverage Gaps

| Module | Lines | Tests |
|--------|-------|-------|
| `llm_providers.py` | 717 | None |
| `prompt_builder.py` | 187 | None |
| `db.py` | 1028 | Minimal (import only) |
| `agent.py` | 766 | Import only |
| `batch_runner.py` | 581 | Import only |
| `bot_protection.py` | — | None (integration only) |
| `session_manager.py` | — | Minimal |

---

## Proposed Phases (13–20)

| Phase | Name | Complexity | Priority |
|-------|------|-----------|----------|
| **13** | Delete duplicate `server.py` | Small | 🔴 Critical |
| **14** | Extract service/DAO layer from `server/app.py` | Medium | 🟠 High |
| **15** | Modularize `llm.js` (orchestration / execution / tools / context) | Medium | 🟠 High |
| **16** | Modularize `human.js` (game / render / input / session / social) | Medium | 🟠 High |
| **17** | Decompose god functions in `db.py` (schema / migrations / domain CRUD) | Large | 🟠 High |
| **18** | Centralize LLM provider config (single source of truth, API endpoint) | Small | 🟡 Medium |
| **19** | Add `@handle_error` decorator, replace 25+ bare excepts | Small | 🟡 Medium |
| **20** | Add unit tests for `llm_providers.py`, `prompt_builder.py`, `db.py` | Medium | 🟠 High |

---

## What's Clean (No Further Work Needed)

- `constants.py` — color map, action names, system message
- `grid_analysis.py` — pure grid utility functions
- `models.py` — model registry (minor redundancy acceptable)
- `bot_protection.py` — rate limiting, Turnstile validation
- `session_manager.py` — session state management
- `static/js/rendering/grid-renderer.js` — grid drawing utilities
- `static/js/utils/tokens.js` — token calculation
- `static/js/utils/formatting.js` — date/cost formatting
- `static/js/llm-timeline.js` — timeline rendering (Phase 12)
- `static/js/llm-reasoning.js` — reasoning panel (Phase 12)
- `tests/test_refactor_modules.py` — regression test suite

---

*Generated by Bubba audit sub-agent on 2026-03-12*
