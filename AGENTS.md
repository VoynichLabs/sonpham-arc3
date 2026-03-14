# Agent Instructions

This file governs how AI agents (Claude Code, Cursor, Copilot, etc.) work in this codebase. These rules are non-negotiable and must be followed on every task, every session. They complement `CLAUDE.md` (project architecture) — read both before starting work.

---

## Before you touch any code

1. **Read the plan doc for the current task** in `docs/`. If one does not exist, create it and get it approved before writing any code. Plan doc naming: `docs/{DD-Mon-YYYY}-{goal}-plan.md`.
2. **Read the relevant source files** before suggesting or making changes. Do not modify code you have not read.
3. **Search for existing utilities** before adding new ones. Grep and glob before writing anything new.
4. **For unfamiliar or recently updated libraries**, fetch documentation before coding. Ask the user to provide a URL if needed.

---

## Required: plan doc before coding

Every substantive task requires a plan doc in `docs/` **approved before implementation begins**.

Plan must include:
- **Scope** — what is in and out
- **Architecture** — which modules are touched, what is reused, where new code lives, why
- **TODOs** — ordered steps with explicit verification steps
- **Docs / Changelog touchpoints** — what docs and `CHANGELOG.md` entries are required

Do not start implementing until the user has approved the plan.

---

## Required: file headers

Every TypeScript, JavaScript, or Python file you **create or edit** must start with this header block. Update it every time you touch the file.

```
// Author: {Your Model Name}
// Date: {YYYY-MM-DD HH:MM}
// PURPOSE: Verbose description of what this file does, its integration points, and dependencies
// SRP/DRY check: Pass/Fail — did you verify no existing utility covers this?
```

For Python use `#`. For JS/TS use `//`. Do not add headers to JSON, SQL, YAML, or Markdown.

---

## Required: changelog

Any change that alters observable behaviour must have a `CHANGELOG.md` entry. Format:

```
## [version] — branch or tag
*Author: {name} | {YYYY-MM-DD}*

### Added / Fixed / Changed / Removed
- Description of what changed, why it changed, and how it was done.
```

If `CHANGELOG.md` does not exist, create it starting at `[1.0.0]` as the baseline.

---

## Workflow

1. **Analyse** — read existing code, understand the architecture, identify reuse opportunities
2. **Plan** — write a plan doc, get it approved
3. **Implement** — small focused changes; build on existing patterns
4. **Verify** — test with real services; no mocks or stubs in production code

---

## Code quality rules

- **Naming**: meaningful names everywhere; no single-letter variables outside tight loops
- **Error handling**: exhaustive and user-safe; handle every failure mode explicitly
- **Comments**: explain non-obvious logic and all integration boundaries, especially external API glue
- **No duplication**: if you are writing something twice, find and reuse the first instance
- **No over-engineering**: solve the current problem; do not build for hypothetical future requirements
- **No under-engineering**: fix root causes; do not paper over bugs with workarounds
- **Production only**: no mocks, stubs, fake data, `TODO` logic, or simulated responses in committed code

---

## Architecture rules (this project)

- **All game-playing and LLM logic runs client-side.** Do not add server-side LLM orchestration. See `CLAUDE.md` — Client-Side Architecture section.
- **Server role is limited**: static file serving, session persistence, model registry, proxying game steps only.
- **BYOK / local provider calls go browser → provider directly.** The Railway server must never be in the LLM call path for BYOK providers.
- **Game code must be fully deterministic.** No RNG. See `CLAUDE.md` — Game Design Rules.
- **Model select fields** in `SCAFFOLDING_SCHEMAS` must be wired in three places: `loadModels()` populate, `loadModels()` restore, `attachSettingsListeners()` change listener. See `CLAUDE.md` — Model Select Checklist.

---

## Git and deployment
- **Avoid destructive operations** like `git reset --hard`, `git push --force`, or `git rm` without explicit instruction.
- **Run the pre-push QC checks** before every push (see `CLAUDE.md` — Pre-Push QC).
- **Never skip hooks** (`--no-verify`), force-push to master, or amend published commits without explicit instruction.

---

## Communication rules

- Keep responses tight. Lead with the action or answer, not the reasoning.
- Do not dump chain-of-thought. If the logic is complex, put it in a plan doc or inline comment.
- Do not give time estimates.
- Do not celebrate completion. Nothing is done until the user has tested it.
- If something is blocked or ambiguous, state what you checked and ask one focused question.
- Call out when a web search would surface important up-to-date information (e.g. API changes).

---

## Prohibited

- Guessing at API behaviour without reading docs
- Writing code before a plan is approved
- Committing without being asked
- File headers missing from edited files
- Changelog entries missing for behaviour changes
- Mocks, stubs, placeholder logic, or fake data in committed code
- Time estimates
- Premature celebration or declaring something fixed before it is tested

---

## Codebase Structure

This section documents the modular organization of the codebase for AI agents working on it.

### Python Backend Architecture

The backend is organized in **three layers**: HTTP routes → services → database/LLM providers.

**HTTP Entry Point (`server/app.py`)**
- Flask application with 58 routes
- Thin wrappers — all business logic delegated to service layer
- Response serialization and error handling

**Service Layer (`server/services/`)**
Implements domain logic for five key features:
- `auth_service.py` — Magic link login, Google OAuth, Copilot device flow, API key management
- `session_service.py` — Load/save game sessions, branch sessions, import from URL, OBS event handling
- `game_service.py` — Start game, execute step, reset game, undo moves
- `social_service.py` — User comments, leaderboard calculations, contributor tracking
- `llm_admin_service.py` — List available LLM models, manage BYOK (Bring Your Own Key) provider credentials

**Request Helpers (`server/helpers.py`, `server/state.py`)**
- `get_current_user()` — Extract authenticated user from request
- Session context, rate limiting, request validation
- Shared runtime state (in-memory caches, config)

**Database Layer**
Each module isolates a domain:
- `db.py` — Connection pooling, schema init, migrations
- `db_auth.py` — User accounts, magic link tokens, session tokens
- `db_sessions.py` — Session CRUD, metadata
- `db_llm.py` — LLM call history (for replay, audit)
- `db_tools.py` — Tool execution logs
- `db_exports.py` — File export/import operations

**LLM Provider Layer**
Router + per-provider implementations:
- `llm_providers.py` — Routes model ID (e.g. `claude-sonnet-4-5`) to the correct provider module and call format
- `llm_providers_openai.py` — OpenAI API + LM Studio (OpenAI-compatible local)
- `llm_providers_anthropic.py` — Anthropic Claude
- `llm_providers_google.py` — Google Gemini
- `llm_providers_copilot.py` — GitHub Copilot device flow (BYOK only)
Providers return standardized message/token/cost data.

**Game Agent (`agent.py` + sub-modules)**
Autonomous game-playing loop:
- `agent.py` — Main orchestrator: build context, call LLM, parse response, execute action
- `agent_llm.py` — LLM decision logic (prompt template, request options)
- `agent_response_parsing.py` — Parse LLM responses into structured actions
- `agent_history.py` — Maintain per-game move history and memory

**Model Registry (`models.py`)**
- `MODEL_REGISTRY` — 39 LLM models across 8 providers
- Model metadata: cost, token limits, provider routing
- Used by `llm_providers.py` router

**Infrastructure**
- `exceptions.py` — Structured error classes for service layer
- `constants.py` — Shared constants (grid size, color codes, etc.)

### JavaScript Frontend Architecture

The frontend runs game logic **client-side** (all game steps, reasoning, scaffolding). The server is stateless except for user auth and session persistence.

**Load Order is Critical** — files are loaded in `templates/index.html` and depend on global variables from prior files.

**Core Layers (load first):**
1. `utils/formatting.js` — Text utilities
2. `config/scaffolding-schemas.js` — Game definitions
3. `state.js` — Global application state
4. `engine.js` — Game step execution
5. `reasoning.js` — Reasoning/reflection pipeline
6. `utils/tokens.js` — Token counting
7. `rendering/grid-renderer.js` — Grid drawing

**UI Components:**
- `ui*.js` — Model selector, token counter, tabs, grid viewport, main UI
- `llm*.js` — LLM config panel, timeline, reasoning display, controls, executor

**Game Scaffolding:**
- `scaffolding.js` — Base scaffolding framework
- `scaffolding-rlm.js` — Reasoning + Learning + Memory
- `scaffolding-three-system.js` — Three-system framework
- `scaffolding-agent-spawn.js` — Spawned agent runner
- `scaffolding-linear.js` — Linear reasoning

**Session Management:**
- `session*.js` — View controllers (grid, history, main session view)

**Observatory (OBS):**
- `observatory.js` — Main OBS UI controller
- `observatory/*.js` — Log renderer, event scrubber, swimlane renderer, lifecycle tracker

**Human Interaction:**
- `human*.js` — Social, rendering, input, session control, game control
- `leaderboard.js` — Leaderboard display
- `dev.js` — Developer tools (e.g. pi01 level selector)

### Key Patterns

**Service → DB isolation:** Services never import from each other; they call the database layer. This prevents tight coupling and makes testing straightforward.

**LLM provider abstraction:** All provider calls go through `llm_providers.py` router, which returns a standardized format. New providers are added by:
1. Create `llm_providers_{name}.py`
2. Add entry to `MODEL_REGISTRY` in `models.py`
3. Add routing logic in `llm_providers.py`

**Client-side game logic:** Game steps execute in the browser. The server never participates in game reasoning or scaffolding. This keeps the server stateless and allows games to run fully offline (after initial load).

**Global JS state:** Frontend uses global `window.appState` for all shared state. This simplifies debugging and persistence but requires careful load ordering.
