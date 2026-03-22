# Arena Server-Side Heartbeat — Plan

**Date**: 2026-03-16
**Goal**: Community Auto Research runs server-side via a 15-minute heartbeat, using Claude OAuth (Anthropic API key) for agent evolution.

---

## Scope

### In
- Background thread that ticks every 15 minutes on server boot
- Reads `ARENA_CLAUDE_KEY` env var (Anthropic API key)
- Evolution cycle: calls Claude to generate new snake agents based on program.md + leaderboard
- Python snake battle engine (mirrors JS `SnakeGame` from arena.js)
- Tournament: runs headless matches between agents, updates ELO in DB
- Stores new agents + match results via existing `db_arena.py` functions

### Out
- Full Claude OAuth device flow (just env var for now, user adds it to Railway later)
- Other arena games (Tron, Connect4, etc.) — snake only for v1
- Client-side local research changes (that still works independently)

---

## Architecture

### New files
- `server/arena_heartbeat.py` — Background thread + evolution loop + tournament runner
- `server/snake_engine.py` — Python snake battle engine (20x20 grid, 2 snakes, deterministic)

### Touched files
- `server/app.py` — Start heartbeat thread on app init
- `server/state.py` — Read `ARENA_CLAUDE_KEY` env var

### Reused
- `llm_providers_anthropic.py` — Call Claude API
- `db_arena.py` — `arena_add_agent()`, `arena_record_game()`, `arena_get_agents()`, `arena_get_program()`
- Evolution prompt structure from `arena-autoresearch.js` (EVOLUTION_TOOLS_DESC, AGENT_INTERFACE)

---

## Flow

```
Server boot
  └─ start_arena_heartbeat() — spawns daemon thread

Every 15 minutes:
  1. Check ARENA_CLAUDE_KEY is set (skip if not)
  2. For each active game (snake):
     a. Load program.md from DB
     b. Load top 10 agents from DB
     c. Build evolution prompt (system + user)
     d. Call Claude (tool-calling loop, max 4 rounds)
     e. Parse tool calls: query_leaderboard, read_agent, create_agent, test_match
     f. Validate new agent code (syntax + safety check)
     g. Store agent in DB via arena_add_agent()
  3. Run tournament round (20 matches between top agents)
     a. Swiss matchmaking (pair similar ELO)
     b. Run each match via Python SnakeEngine
     c. Update ELO + record games in DB
  4. Log results to server console
```

---

## Python Snake Engine Spec

Mirrors JS `SnakeGame` from arena.js:
- 20x20 grid, walls on edges
- Snake A starts top-left, Snake B starts bottom-right
- Food spawns deterministically (seeded)
- Both snakes move simultaneously each turn
- Collision = death (wall, self, other snake, head-on)
- Agent code is JS `getMove(state)` function — executed via a **restricted JS eval** (Node subprocess or PyMiniRacer)
- Returns: winner ('A', 'B', 'draw'), turns, history

### Agent execution
Since agents are JS functions, we need a JS runtime. Options:
1. **PyMiniRacer** (V8 in Python) — lightweight, no subprocess overhead
2. **Node subprocess** — `node -e` with the agent code
3. **Rewrite agents in Python** — breaks compatibility

Recommend **PyMiniRacer** if available, fallback to **Node subprocess**.

---

## TODOs

1. [ ] Add `ARENA_CLAUDE_KEY` to `server/state.py` env var reading
2. [ ] Create `server/snake_engine.py` — Python snake battle (grid, movement, collision, food)
3. [ ] Create `server/arena_heartbeat.py` — background thread, evolution loop, tournament runner
4. [ ] Wire JS agent execution (PyMiniRacer or Node subprocess for `getMove()`)
5. [ ] Add tool-calling loop for Claude evolution (mirrors JS `arHandleToolCall`)
6. [ ] Wire heartbeat start in `server/app.py`
7. [ ] Test: run heartbeat manually, verify agent creation + tournament results in DB
8. [ ] Verify client-side UI picks up new agents/games via existing polling

## Docs / Changelog
- CHANGELOG.md entry for server-side arena heartbeat
- Update CLAUDE.md arena section if needed
