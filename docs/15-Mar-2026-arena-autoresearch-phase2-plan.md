# Arena Auto Research — Phase 2 Plan

**Date**: 2026-03-15
**Goal**: Make local auto research work end-to-end. Phase 1 delivered DB + APIs + UI shell + evolution/tournament skeleton. Phase 2 wires the actual game execution, connects the LLM evolution loop, and lights up the live tournament canvases.

---

## Scope

### In Scope
1. **Headless match runner** — Generic `arRunHeadlessMatch(gameId, getMoveFnA, getMoveFnB, config)` that runs any arena game with two arbitrary `getMove()` functions and returns a history array
2. **State adapters** — Per-game adapter that converts the game engine's internal state to the standard `AGENT_INTERFACE` format (`{grid, mySnake, enemySnake, food, ...}`)
3. **Fix tournament runner** — Update `arRunTournamentRound()` to use the headless runner instead of trying to inject custom strategies into `game.run()`
4. **Live mini canvases** — Render ongoing matches on the 4 small canvases (`arLive0-3`) in the right column during local research
5. **Fix evolution cycle** — Ensure `callLLM()` integration works from arena context, fix the tool-calling conversation flow
6. **Community submission** — Fix `arSubmitToComminity()` (typo), use current user info, wire BYOK key into local research properly

### Out of Scope
- Community server-side evolution (server doesn't run LLM calls)
- Human vs AI play (Phase 4 per existing stub)
- Server-side tournament orchestration (all matches run client-side)

---

## Architecture

### 1. Headless Match Runner

Each arena game already has a `run(config, strategyA, strategyB)` function that looks up strategies by key from a strategies object. We need a parallel path that accepts raw `getMove(state)` functions.

**Approach**: Add `arRunHeadless(gameId, fnA, fnB, config)` that:
- Instantiates the game engine (SnakeGame, TronGame, etc.)
- On each turn, builds the standard state object for each player
- Calls `fnA(stateForA)` and `fnB(stateForB)` with timeout protection
- Steps the game engine
- Returns the history array

Each game's `run()` function already follows this pattern internally — we just need to extract the state-building and stepping into a generic wrapper.

**Files touched**: `static/js/arena-autoresearch.js`

### 2. State Adapters

The `AGENT_INTERFACE` definitions describe what `getMove(state)` receives. We need adapters from each game's internal state:

| Game | Engine class | State adapter |
|------|-------------|---------------|
| snake | `SnakeGame` | `getAIState()` already exists, reformat for player perspective |
| tron | `TronGame` | Extract positions, trails, turn |
| connect4 | `C4Game` | Board, valid moves, turn |
| chess960 | `ChessGame` | Board, valid moves, color, turn |
| othello | `OthelloGame` | Board, valid moves, turn |
| go9 | `GoGame` | Board, valid moves, turn |
| gomoku | `GomokuGame` | Board, valid moves, turn |
| artillery | `ArtilleryGame` | Positions, terrain, wind, HP |
| poker | `PokerGame` | Hand, community, pot, chips, valid actions |

**Key**: Each adapter takes the game engine + player identifier, returns the state object matching `AGENT_INTERFACE`.

**Files touched**: `static/js/arena-autoresearch.js`

### 3. Live Tournament Canvases

The right column has 4 mini canvases (`arLive0-3`). During local research tournament rounds:
- Pick up to 4 matches to display
- Render each match frame-by-frame on a timer
- Show player names + result in the `arLiveInfo` divs

**Files touched**: `static/js/arena-autoresearch.js`

### 4. Evolution Cycle Fixes

The `arRunEvolutionCycle()` calls `callLLM(messages, model, opts)` from `scaffolding.js`. Verify:
- BYOK key is stored correctly for the selected provider
- `callLLM` returns the raw text response
- Tool-call XML parsing works
- Multi-round conversation flows correctly

**Files touched**: `static/js/arena-autoresearch.js`

---

## TODOs

### Step 1: State adapters for all 9 games
- [x] Add `arGetGameState(gameId, engine, player)` dispatcher
- [x] Snake adapter: reuse `getAIState()`, add `memory` field
- [x] Tron adapter: grid, positions, direction, turn, memory
- [x] Connect4 adapter: board, validMoves, turn, memory
- [x] Chess960 adapter: board, validMoves, myColor, turn, memory
- [x] Othello adapter: board, validMoves, turn, memory
- [x] Go9 adapter: board, validMoves, turn, memory
- [x] Gomoku adapter: board, validMoves, turn, memory
- [x] Artillery adapter: positions, terrain, wind, HP, memory
- [x] Poker adapter: hand, community, pot, chips, validActions, memory
- [x] Verify: each adapter returns the format documented in `AGENT_INTERFACE`

### Step 2: Headless match runner
- [x] Add `arRunHeadless(gameId, fnA, fnB, config)` — game-agnostic runner
- [x] Add per-game `_newEngine(gameId, config)` factory
- [x] Add per-game `_stepEngine(gameId, engine, moveA, moveB)` stepper
- [x] Add per-game `_parseMove(gameId, rawMove, player)` — convert getMove return to engine move
- [x] Add per-game `_isOver(gameId, engine)` and `_getWinner(gameId, engine)` checks
- [x] Wire timeout protection via `arSafeCall()` (already exists)

### Step 3: Fix tournament runner
- [x] Rewrite `arRunTournamentRound()` to call `arRunHeadless()` instead of `game.run()`
- [x] Remove the custom strategies injection hack
- [x] Return match results with history for visualization

### Step 4: Live mini canvases
- [x] Add `arRenderLiveMatch(canvasIndex, gameId, history)` — animates a match on a mini canvas
- [x] During tournament round, pick up to 4 matches, render on `arLive0-3`
- [x] Update `arLiveInfo0-3` with player names and result
- [x] Add frame stepping timer (auto-advance at 5fps)

### Step 5: Evolution cycle integration test
- [x] Verify `callLLM()` from arena context works (BYOK key stored, provider resolved)
- [x] Test tool-call parsing (create_agent, query_leaderboard, read_agent, test_match)
- [x] Test multi-round conversation (6 rounds max)
- [x] Fix any issues found

### Step 6: Community submission cleanup
- [x] Fix typo: `arSubmitToComminity` → `arSubmitToCommunity`
- [x] Use logged-in user info if available
- [x] Show confirmation before submission

---

## Docs / Changelog
- `CHANGELOG.md` — entry for Arena Auto Research Phase 2
- File headers on all modified files
