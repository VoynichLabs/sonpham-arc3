# ARC-AGI-3 Agent

An LLM-powered system for playing [ARC-AGI-3](https://arcprize.org/) — an interactive reasoning benchmark where each game is a 64×64 pixel grid with 16 colours.  There are no instructions; the agent must discover the rules, controls, and goals by experimenting.

---

## Quick start

```bash
python -m venv venv
source venv/bin/activate
pip install flask python-dotenv arc-agi arcengine httpx google-genai ollama pyyaml anthropic

cp .env.example .env          # fill in your API keys
python agent.py --game ls20   # play one game with default settings
```

---

## Architecture

The agent has **three independently configurable blocks** in `config.yaml`:

### 1  Context block — *what information the agent sees*

| Setting | Default | Effect |
|---------|---------|--------|
| `full_grid` | `true` | Full RLE-compressed 64×64 grid at every step |
| `change_map` | `true` | Cells that changed since the last action (X/. overlay) |
| `color_histogram` | `false` | Count of each colour in the current grid |
| `region_map` | `false` | Connected-component regions per colour (BFS flood-fill) |
| `history_length` | `10` | How many recent moves to show in the prompt |
| `memory_injection` | `true` | Inject relevant facts from `memory/MEMORY.md` |
| `memory_injection_max_chars` | `1500` | Caps the injected memory to stay within token budget |

Turn sources on/off to experiment with the trade-off between prompt size and agent performance.

### 2  Reasoning block — *which model(s) think*

| Setting | Default | Effect |
|---------|---------|--------|
| `executor_model` | `gemini-2.5-flash` | Main model used at every action step |
| `condenser_model` | `null` | Model used to condense old history (null = reuse executor) |
| `reflector_model` | `null` | Model used for post-game reflection (null = reuse executor) |
| `temperature` | `0.3` | Sampling temperature for action decisions |
| `max_tokens` | `2048` | Max output tokens for action decisions |
| `reflection_max_tokens` | `1024` | Max tokens for condensation / reflection passes |

Setting a separate (cheaper) model for condensation and reflection lets you use a more capable model only where it matters most.

### 3  Memory management block — *what the agent remembers*

| Setting | Default | Effect |
|---------|---------|--------|
| `hard_memory_file` | `memory/MEMORY.md` | Cross-session persistent facts (markdown) |
| `session_log_file` | `memory/sessions.json` | Structured log of every game result |
| `allow_inline_memory_writes` | `true` | Agent can write a new fact mid-game |
| `reflect_after_game` | `true` | Run a reflection pass after each game ends |
| `condense_every` | `25` | Summarise old history every N steps (0 = off) |
| `condense_threshold` | `50` | Force condensation when history exceeds N entries |

---

## Module Structure

The codebase is organized into clean, layered modules:

### Python Backend

**Entry Points:**
- `server/app.py` — Flask application (58 routes), thin HTTP wrappers only
- `Procfile` — `gunicorn server.app:app`
- `batch_runner.py` — Background pipeline runner

**Service Layer** (`server/services/`):
- `auth_service.py` — Magic link, Google OAuth, Copilot auth, API key management
- `session_service.py` — Session resume, branch, import, OBS events
- `game_service.py` — Game start, step, reset, undo
- `social_service.py` — Comments, leaderboard, contributors
- `llm_admin_service.py` — LLM model listing, BYOK key management

**Request Helpers:**
- `server/helpers.py` — `get_current_user()`, session context helpers
- `server/state.py` — Shared runtime state

**Database Layer:**
- `db.py` — Connection facade, schema init/migration
- `db_sessions.py` — Session CRUD
- `db_auth.py` — Users, tokens, magic links
- `db_llm.py` — LLM call logging
- `db_tools.py` — Tool execution logging
- `db_exports.py` — File export/import

**LLM Providers:**
- `llm_providers.py` — Router: maps model ID → provider call
- `llm_providers_openai.py` — OpenAI + LM Studio (OpenAI-compat)
- `llm_providers_anthropic.py` — Anthropic Claude
- `llm_providers_google.py` — Google Gemini
- `llm_providers_copilot.py` — GitHub Copilot (device flow)

**Game Agent:**
- `agent.py` — Game-playing agent orchestrator
- `agent_llm.py` — LLM decision logic
- `agent_response_parsing.py` — Parse LLM responses into actions
- `agent_history.py` — Maintain agent action history

**Models & Infrastructure:**
- `models.py` — LLM model registry (39 models: OpenAI, Anthropic, Google, Mistral, Groq, Cloudflare, HuggingFace, Ollama)
- `constants.py` — Shared constants and configuration
- `exceptions.py` — Structured error handling

### JavaScript Frontend (`static/js/`)

Files are loaded via `<script>` tags in global scope (no ES6 modules). Load order is critical (see `templates/index.html`).

**Utility layers:**
- `utils/formatting.js` — Text formatting utilities
- `utils/tokens.js` — Token counting
- `utils/json-parsing.js` — Safe JSON parsing

**Core state & game engine:**
- `state.js` — Shared application state
- `engine.js` — Game step execution
- `reasoning.js` — Reasoning pipeline

**Rendering:**
- `rendering/grid-renderer.js` — 64×64 grid visualization
- `config/scaffolding-schemas.js` — Game scaffolding definitions

**UI components:**
- `ui*.js` — Model selector, token display, tab management, grid UI, main UI
- `llm*.js` — LLM config, timeline, reasoning display, controls, executor

**Game logic:**
- `scaffolding*.js` — Game-specific scaffolding (RLM, three-system, agent-spawn, linear)
- `session*.js` — Session views (grid, history, main)
- `observatory.js` + `observatory/*.js` — OBS event log viewer

**Human interaction:**
- `human*.js` — Social, rendering, input handling, session, game control

**Misc:**
- `leaderboard.js` — Leaderboard display
- `dev.js` — Developer tools (level selector for pi01)

---

## Hard memory

Two files persist knowledge between sessions:

**`memory/MEMORY.md`** — free-form markdown that the agent reads and writes.  Sections:
- `## General` — universal ARC-AGI-3 facts
- `## Strategies` — general solving approaches
- `## <game_id>` — game-specific rules and discoveries

After each game the reflector LLM extracts 2-5 novel facts and appends them under the game's section.  During a game the agent can also write a `"memory_update"` field in its JSON response to save a rule the moment it discovers it.

**`memory/sessions.json`** — structured JSON array logging every game run (timestamp, result, steps, levels completed, model used).

---

## Supported models

| Key | Provider | Requires |
|-----|----------|---------|
| `groq/llama-3.3-70b-versatile` | Groq | `GROQ_API_KEY` |
| `groq/gemma2-9b-it` | Groq | `GROQ_API_KEY` |
| `mistral/mistral-small-latest` | Mistral | `MISTRAL_API_KEY` |
| `gemini-2.0-flash-lite` | Gemini | `GEMINI_API_KEY` |
| `gemini-2.0-flash` | Gemini | `GEMINI_API_KEY` |
| `gemini-2.5-flash` | Gemini | `GEMINI_API_KEY` |
| `gemini-2.5-pro` | Gemini | `GEMINI_API_KEY` |
| `claude-haiku-4-5` | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-sonnet-4-5` | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-sonnet-4-6` | Anthropic | `ANTHROPIC_API_KEY` |
| `cloudflare/llama-3.3-70b` | Cloudflare Workers AI | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` |
| `hf/meta-llama-3.3-70b` | HuggingFace | `HUGGINGFACE_API_KEY` |
| `ollama/llama3.3` | Ollama (local) | Ollama running on port 11434 |

---

## CLI reference

```bash
# Play all games with config defaults
python agent.py

# Play one game
python agent.py --game ls20

# Override the model for this run only
python agent.py --model gemini-2.5-pro --game ft09

# Set a custom step limit
python agent.py --max-steps 400

# Use a different config file
python agent.py --config experiments/config_no_grid.yaml

# Print the resolved config and exit
python agent.py --show-config

# List all available models and check API keys
python agent.py --list-models
```

---

## Experiment recipes

### Minimal context (fastest, cheapest)
```yaml
context:
  full_grid: false
  change_map: true
  color_histogram: true
  region_map: false
  history_length: 5
  memory_injection: true
```

### Maximum context (best reasoning, most tokens)
```yaml
context:
  full_grid: true
  change_map: true
  color_histogram: true
  region_map: true
  history_length: 20
  memory_injection: true
```

### Tiered models (quality where it counts, cheap elsewhere)
```yaml
reasoning:
  executor_model: "gemini-2.5-flash"
  condenser_model: "groq/llama-3.3-70b-versatile"
  reflector_model: "groq/llama-3.3-70b-versatile"
```

### No memory (clean baseline)
```yaml
context:
  memory_injection: false
memory:
  allow_inline_memory_writes: false
  reflect_after_game: false
  condense_every: 0
```

---

## Project structure

```
arc-agi-3/
├── agent.py               # Autonomous CLI agent (main file)
├── config.yaml            # Three-block agent configuration
├── server.py              # Flask web server + visual player
├── play.py                # Minimal starter exploration script
├── memory/
│   ├── MEMORY.md          # Cross-session hard memory (human-readable)
│   └── sessions.json      # Structured session history
├── templates/
│   └── index.html         # Web player UI
├── environment_files/     # Game environment definitions
│   ├── ls20/
│   ├── ft09/
│   └── vc33/
├── .env                   # API keys (not committed)
└── .env.example           # Key template
```

---

## Developer Tools

### pi01 Level Selector

**pi01** is the pirate ship game with 9 levels.

While playing pi01 in the web UI, press **Shift+D** to open the dev level selector panel (bottom-right corner). Click any button to jump directly to that level:

| Button | Level Name |
|--------|-----------|
| L1 | Caribbean Cove |
| L2 | Skull Shoals |
| L3 | Dragon's Lair |
| L4 | Stormy Waters |
| L5 | Kraken's Hunt |
| L6 | Sentinel Straits |
| L7 | Hunter's Web |
| L8 | Fog of War |
| L9 | Key & Switch |

The panel uses the server endpoint `POST /api/dev/jump-level` with the secret header `X-Dev-Secret: arc-dev-2026`.

---

## License

Uses [arc-agi](https://pypi.org/project/arc-agi/) and [arcengine](https://pypi.org/project/arcengine/) from ARC Prize.
