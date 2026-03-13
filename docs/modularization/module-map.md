# sonpham-arc3 Module Map

**Last updated: 2026-03-12**  
**Branch: refactor/phase-1-modularization**

This document is a complete reference for the modular organization of the sonpham-arc3 codebase, designed for AI agents working on the system.

---

## Python Backend

### Entry Points

- **`server/app.py`** — Flask application (57 routes), thin HTTP wrappers only  
  All routes delegate immediately to the service layer. No business logic here.
  
- **`Procfile`** — `gunicorn server.app:app`  
  Production deployment configuration.
  
- **`batch_runner.py`** — Background pipeline runner  
  Processes asynchronous batch operations (game runs, exports, etc.).

### Service Layer (`server/services/`)

The service layer implements domain-specific business logic. Each service is responsible for one feature and delegates to the database/LLM layers.

- **`auth_service.py`** — Authentication and authorization
  - Magic link login (email verification)
  - Google OAuth flow (identity provider)
  - GitHub Copilot device flow (BYOK provider auth)
  - API key management (user-owned provider credentials)
  - Token validation and user context

- **`session_service.py`** — Game session management
  - Resume existing session
  - Branch (fork) a session
  - Import session from URL
  - Sync OBS (Observatory) events
  - Session lifecycle hooks

- **`game_service.py`** — Game control
  - Start a new game instance
  - Execute a single step (action + grid update)
  - Reset game state
  - Undo last move
  - Validate game state transitions

- **`social_service.py`** — Social features
  - Post comments on games
  - Calculate leaderboard rankings
  - Track user contributions
  - Manage comment threads

- **`llm_admin_service.py`** — LLM administration
  - List available models (filtered by user permissions)
  - Validate user provider credentials
  - Manage BYOK key storage and refresh
  - Check model availability by provider

### Request Helpers

- **`server/helpers.py`** — HTTP request utilities
  - `get_current_user()` — Extract authenticated user from request
  - `validate_session_ownership()` — Verify user owns session
  - `rate_limit_check()` — Rate limiting middleware
  - Request parameter validation
  - Error response formatting

- **`server/state.py`** — Shared runtime state
  - In-memory caches (model list, user cache, etc.)
  - Configuration management
  - Application startup/shutdown hooks

### Database Layer

Each module isolates a single domain and provides CRUD + domain-specific queries.

- **`db.py`** — Database connection and schema management
  - Connection pooling (SQLite)
  - Schema initialization on first run
  - Migration handling
  - Query execution wrapper
  - Transaction management

- **`db_auth.py`** — Authentication data
  - User accounts (create, read, update, delete)
  - Magic link tokens (generation, validation, expiry)
  - Session tokens (OAuth state, API keys)
  - Password hash management (if applicable)
  - User profile data

- **`db_sessions.py`** — Game session persistence
  - Session CRUD (create, load, save, list)
  - Session metadata (created_at, updated_at, status)
  - Branching support (track parent session)
  - Session filtering (by user, status, game_id)
  - Bulk operations (export, import)

- **`db_llm.py`** — LLM interaction logging
  - Log each LLM call (model, prompt, response, tokens, cost)
  - Usage analytics (total tokens, costs per provider)
  - Call history retrieval
  - Performance profiling data

- **`db_tools.py`** — Tool execution logging
  - Log each tool invocation (game step, action validation, etc.)
  - Tool performance metrics
  - Error tracking

- **`db_exports.py`** — File import/export operations
  - Save session to file (JSON, markdown)
  - Load session from file
  - Batch export (multiple sessions)
  - Format conversion (ARC-native ↔ JSON)

### LLM Provider Layer

Providers handle the low-level details of calling different LLM APIs. The router (`llm_providers.py`) maps model IDs to implementations.

- **`llm_providers.py`** — Router and dispatcher
  - Map model ID (e.g., `claude-sonnet-4-5`) → provider module + settings
  - Call the correct provider with standardized arguments
  - Return standardized response: `{ "message": str, "tokens": { "prompt": int, "completion": int }, "cost": float }`
  - Handle provider-specific errors and retry logic

- **`llm_providers_openai.py`** — OpenAI + OpenAI-compatible local
  - OpenAI API (GPT-4, etc.)
  - LM Studio (local, OpenAI-compatible API)
  - HTTP/HTTPS request handling
  - Token counting (OpenAI's tiktoken)
  - Error handling (rate limits, auth, network)

- **`llm_providers_anthropic.py`** — Anthropic Claude
  - Claude 3 Opus, Sonnet, Haiku
  - Anthropic Python SDK
  - Token counting (Anthropic's tokenizer)
  - Streaming support (if applicable)
  - Error handling (overload, auth)

- **`llm_providers_google.py`** — Google Gemini
  - Gemini 2.0, 1.5, 1.0 models
  - Google Generative AI SDK
  - Token counting
  - Safety settings (if applicable)

- **`llm_providers_copilot.py`** — GitHub Copilot (device flow)
  - Copilot Chat API via device code flow
  - BYOK authentication
  - Token management
  - Fallback handling

### Game Agent (`agent.py` + sub-modules)

The agent is an autonomous game-playing loop that runs server-side (or client-side, depending on deployment). It orchestrates all the layers above.

- **`agent.py`** — Agent orchestrator
  - Main game loop: perceive → reason → act → update
  - Context building (grid, history, memory)
  - LLM call orchestration
  - Response parsing and action validation
  - Session state updates

- **`agent_llm.py`** — LLM decision making
  - Build the reasoning prompt (context + question)
  - Configure LLM request (model, temperature, max_tokens, etc.)
  - Handle LLM response stream (if applicable)

- **`agent_response_parsing.py`** — Parse LLM output
  - Extract action from LLM response (JSON, markdown, free text)
  - Validate action against game rules
  - Handle parsing errors gracefully

- **`agent_history.py`** — Move history and memory
  - Track all moves in the current game
  - Maintain condensed history (for long games)
  - Write facts to persistent memory
  - Retrieve relevant memory during decision-making

### Models & Infrastructure

- **`models.py`** — LLM model registry
  - `MODEL_REGISTRY` — 41 LLM models across 8 providers
  - Model metadata: key, provider, cost per 1K tokens, token limits, aliases
  - Used by `llm_providers.py` router to dispatch calls
  
  **Providers in registry:**
  - OpenAI (GPT-4, GPT-4 Turbo, GPT-3.5, etc.)
  - Anthropic (Claude Opus, Sonnet, Haiku)
  - Google (Gemini 2.0, 1.5, 1.0)
  - Mistral (Mistral Large, Medium, Small)
  - Groq (Llama 3.3, Gemma 2)
  - Cloudflare Workers AI (Llama 3.3)
  - HuggingFace (Meta Llama 3.3)
  - Ollama (local, any model)

- **`constants.py`** — Shared constants
  - Grid size (64×64)
  - Color codes (0-15, standard ARC palette)
  - Message templates
  - Default configuration values

- **`exceptions.py`** — Structured error handling
  - Custom exception classes for each failure mode
  - Hierarchical error types (API error, parsing error, validation error, etc.)
  - Used throughout service and agent layers for explicit error handling

- **`prompt_builder.py`** — Prompt template management
  - Build reasoning prompts for LLM
  - Inject context (grid, history, memory)
  - Format action requests
  - Token budgeting (ensure prompt fits within token limits)

- **`bot_protection.py`** — Anti-abuse and rate limiting
  - Detect rapid/abnormal usage patterns
  - Rate limit enforcement
  - IP-based or user-based limiting

- **`scaffoldings/`** — Game scaffolding (ARC game types)
  - Modular game definitions
  - Pirate ship game (`pi01`)
  - Other ARC variants
  - Constraint and rule definitions per game

---

## JavaScript Frontend (`static/js/`)

All JavaScript files are loaded via `<script>` tags in `templates/index.html`. **Load order is critical** — files depend on globals from prior files. No ES6 modules.

### Core Initialization (Load First)

1. **`utils/formatting.js`** — Text formatting utilities
   - Pad numbers, format time, truncate strings
   - Used by UI and logging

2. **`config/scaffolding-schemas.js`** — Game definitions and scaffolding schemas
   - Game metadata (id, name, rules, levels)
   - Scaffolding type definitions (constraints, rules, action format)
   - Control configuration (what inputs are available to user)
   - UI schema (how to render the game)

3. **`state.js`** — Global application state
   - `window.appState` — single source of truth
   - Game state (current grid, move history, score)
   - Session state (user, session_id, branch info)
   - UI state (selected tab, sidebar visibility, etc.)
   - LLM config (model, temperature, reasoning settings)

4. **`engine.js`** — Game step execution engine
   - Execute a single action (user or agent)
   - Update grid based on game rules
   - Check for game completion
   - Handle undo/redo
   - Deterministic simulation (no RNG)

5. **`reasoning.js`** — Reasoning and reflection pipeline
   - Run reasoning step (LLM call to decide action)
   - Run reflection step (LLM analyzes game result)
   - Maintain reasoning history
   - Memory injection during reasoning

6. **`utils/tokens.js`** — Token counting and budgeting
   - Estimate tokens in text
   - Track prompt/completion token usage
   - Alert when approaching token limits

7. **`rendering/grid-renderer.js`** — 64×64 grid visualization
   - Canvas-based grid rendering
   - Color mapping (0-15 → RGB)
   - Zoom and pan controls
   - Highlight changed cells
   - Render region overlays (if applicable)

### UI Components

- **`ui-models.js`** — Model selector dropdown
  - Load available models from server
  - Restore user's last selection
  - Change listener for model switching

- **`ui-tokens.js`** — Token counter display
  - Show current session tokens used
  - Show tokens per LLM call
  - Alert thresholds

- **`ui-tabs.js`** — Tab navigation (Game, Session, Observatory, Leaderboard, etc.)
  - Tab switching logic
  - Active tab styling
  - Tab content lazy-loading

- **`ui-grid.js`** — Grid viewport and controls
  - Render game grid
  - Zoom/pan controls
  - Click-to-select cells
  - Highlight active regions

- **`ui.js`** — Main UI orchestrator
  - Assemble all UI components
  - Event delegation
  - Modal management
  - Settings panel

### LLM Configuration and Control

- **`llm-config.js`** — LLM settings panel
  - Temperature slider
  - Token limit controls
  - Reasoning mode selector
  - BYOK key input

- **`llm-timeline.js`** — Timeline of LLM calls in session
  - Show all reasoning steps
  - Timestamps and token usage
  - Click to expand/view response

- **`llm-reasoning.js`** — Reasoning display and introspection
  - Show LLM's reasoning for each step
  - Display prompt + response
  - Highlight key phrases

- **`llm-controls.js`** — LLM action controls
  - "Think" button (trigger reasoning step)
  - "Act" button (execute decided action)
  - "Reset reasoning" button
  - Step-by-step or full-auto mode selector

- **`llm-executor.js`** — Agent executor
  - Run full game with agent
  - Pause/resume agent loop
  - Watch agent play in real-time

- **`llm.js`** — Main LLM module orchestrator
  - Coordinate all LLM-related UI elements
  - Manage reasoning/execution state

### Game Scaffolding

- **`scaffolding.js`** — Base scaffolding framework
  - Load game schema from config
  - Validate actions against rules
  - Handle game-specific logic

- **`scaffolding-rlm.js`** — Reasoning + Learning + Memory scaffolding
  - Game type: multi-step learning
  - Agent reasons → acts → learns from result
  - Memory injection between rounds

- **`scaffolding-three-system.js`** — Three-system framework
  - Game type: three-system puzzle
  - Multiple interdependent systems
  - Cross-system constraints

- **`scaffolding-agent-spawn.js`** — Spawned agent runner
  - Game type: multi-agent coordination
  - Launch sub-agents
  - Communicate between agents

- **`scaffolding-linear.js`** — Linear progression
  - Game type: sequential levels
  - Level unlocking logic
  - Progress tracking

### Session Management

- **`session-views-grid.js`** — Grid view of session history
  - Display all moves in grid form
  - Click to jump to move
  - Diff highlighting

- **`session-views-history.js`** — Move history sidebar
  - List all moves with metadata
  - Timestamps, action details
  - Undo/redo controls

- **`session-views.js`** — Session tab manager
  - List all user sessions
  - Resume, branch, export
  - Filter and sort

- **`session.js`** — Main session module
  - Load/save session state
  - Sync with server
  - Handle reconnection

### Observatory (OBS) — Event and Timeline Viewer

- **`observatory.js`** — Main OBS module
  - Timeline visualization of all events
  - Event filtering and search
  - Swimlane view (agent/human actions over time)

- **`observatory/obs-log-renderer.js`** — Event log display
  - Format and render individual events
  - Syntax highlighting for action JSON
  - Timestamp formatting

- **`observatory/obs-scrubber.js`** — Timeline scrubber
  - Drag to seek to point in time
  - Keyboard shortcuts (arrow keys)
  - Speed controls (slow-mo, fast-forward)

- **`observatory/obs-swimlane-renderer.js`** — Swimlane visualization
  - Parallel tracks for agent and human
  - Visual timeline
  - Concurrency indicators

- **`observatory/obs-lifecycle.js`** — Event lifecycle tracker
  - Track lifecycle of events (spawned → completed → error)
  - Visual state machine
  - Error indicators

### Human Interaction

- **`human-social.js`** — Comments and social features
  - Display comments on game
  - Post new comment
  - Edit/delete own comments
  - Threading

- **`human-render.js`** — Custom rendering for human input
  - Draw-to-input mode
  - Cell inspector
  - Manual grid editing

- **`human-input.js`** — Human action input
  - Click-based controls
  - Keyboard shortcuts
  - Drag-and-drop actions
  - Action validation UI

- **`human-session.js`** — Human session management
  - Load user's sessions from server
  - List sessions, filter by status
  - Resume/branch/delete session

- **`human-game.js`** — Human game control
  - Start new game
  - Reset current game
  - Undo last move
  - Quit game

- **`human.js`** — Main human module
  - Assemble all human interaction components
  - Event handlers for user input
  - Hotkey management

### Misc

- **`leaderboard.js`** — Leaderboard display and stats
  - Fetch leaderboard from server
  - Filter by game, time period
  - User ranking and stats

- **`dev.js`** — Developer tools
  - pi01 level selector (Shift+D opens panel)
  - Dev endpoint: `POST /api/dev/jump-level`
  - Secret header: `X-Dev-Secret: arc-dev-2026`

---

## Architecture Patterns

### Service → Database Isolation
Services never call each other. Each service imports only the `db_*` modules it needs, plus shared infrastructure (`exceptions.py`, `constants.py`). This prevents circular dependencies and makes testing straightforward — mock `db_*` functions and test the service in isolation.

### LLM Provider Abstraction
All LLM calls go through `llm_providers.py` router. The router maps a model ID (e.g., `claude-sonnet-4-5`) to a provider module, calls it with standardized arguments, and returns a standardized response. New providers are added by:
1. Create `llm_providers_{name}.py` with `call_llm(model_key, system, user, **options)` function
2. Add entries to `MODEL_REGISTRY` in `models.py`
3. Add routing logic in `llm_providers.py`

### Client-Side Game Logic
Game steps execute in the browser (`engine.js`). The server never participates in game reasoning or scaffolding. This keeps the server stateless and allows games to run fully offline after initial load. The server is used only for:
- User authentication
- Session persistence (save/load to database)
- Leaderboard and social features
- LLM provider credential management

### Global JS State (`window.appState`)
The frontend uses a single global object for all application state. This simplifies debugging and data flow, but requires careful load ordering and explicit state mutations.

---

## Testing Strategy

- **Service layer tests** — Mock `db_*` functions, test service error handling and delegation
- **Database layer tests** — Use in-memory SQLite, test CRUD and domain-specific queries
- **Provider tests** — Mock HTTP calls, test response parsing and error handling
- **Frontend tests** — Mock server API, test UI state and event handling

See `tests/` directory for example test files.

---

## Deployment

- **Server:** Run `gunicorn server.app:app` (see `Procfile`)
- **Background:** Run `batch_runner.py` for async operations
- **Frontend:** Served by Flask from `templates/` and `static/`

All environment variables are sourced from `.env` (see `.env.example` for template).
