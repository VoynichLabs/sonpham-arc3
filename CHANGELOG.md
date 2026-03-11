# Changelog

All notable changes to this project will be documented here.
Format: [SemVer](https://semver.org/) — what / why / how. Author and model noted per entry.

---

## [Unreleased] — feature/lmstudio-support
*Author: Mark Barney + Claude Sonnet 4.6 | 2026-03-10*

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

### Known issues / pending (see plan doc)
- **Server-side LM Studio discovery not yet removed** from `server.py` — the `localhost:1234` probe runs on Railway where that port is dead. Tracked in `docs/2026-03-10-lmstudio-discovery-plan.md`.
- **File headers missing** from all edited files (`scaffolding.js`, `ui.js`, `server.py`, `models.py`). Required by `coding-standards.md`.
- **Browser-side discovery not yet committed** — draft exists as unstaged change in `scaffolding.js`, pending plan approval.

---

## [1.0.0] — master baseline
*2026-03-10*

Initial versioned baseline. Captures the state of `master` at the time `CHANGELOG.md` was introduced. All prior work is recorded in git history.
