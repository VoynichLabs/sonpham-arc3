# Arena UI Enhancements Plan

**Date**: 15-Mar-2026
**Goal**: Improve arena auto research page with ELO chart, Code button, inline program editor, and client-side agent creation.

## Scope

### In scope
1. **ELO history chart** below live tournament (right col) — line chart showing agent ELO over time
2. **Code button** in leaderboard — next to Play, opens code modal
3. **Program.md editor cleanup** — remove version dropdown, put Edit next to section header
4. **Client-side agent creation** — Edit opens editor with model select + API key + "Create New Code Agent" button that runs evolution locally via BYOK LLM

### Out of scope
- Server-side changes to evolution loop
- New DB tables (ELO history is derived from existing `arena_games` data)

## Architecture

### 1. ELO Chart (Right col, below live tournament)
- **Where**: Add a `<canvas>` below `#arLiveGames` in `ar-right-col`
- **Data source**: `/api/arena/agents/<game_id>` already returns ELO per agent. For history, add a lightweight endpoint `/api/arena/elo-history/<game_id>` that queries `arena_games` to reconstruct ELO progression per agent.
- **Rendering**: Simple canvas line chart (no Chart.js dependency needed — snake_autoresearch does it inline)
- **JS**: New function `arRenderEloChart(gameId)` in `arena-autoresearch.js`

### 2. Code Button in Leaderboard
- **Where**: `arRenderLeaderboard()` in `arena.js` — add "Code" button next to "Play ▶"
- **Action**: Calls existing `arShowAgentCode(gameId, agentId, name)` which opens the code modal
- **No new backend needed** — endpoint already exists

### 3. Program.md Editor Cleanup
- **Where**: `arena.html` program area HTML + `arena.js` `arRenderProgram()`
- **Changes**:
  - Remove `<select id="arProgramVersion">` dropdown
  - Move "Edit" button inline with section header (`.ar-section-header`)
  - Keep the edit/view toggle logic as-is

### 4. Client-Side Agent Creation
- **Where**: Program area in center column — when Edit is clicked
- **UI Flow**:
  1. Click "Edit" → shows editor with:
     - Program.md textarea (read-only reference)
     - Model select dropdown (populated from `loadModels()` / BYOK)
     - API key input field
     - "Create New Code Agent" button
  2. Click "Create New Code Agent" →
     - Runs `arFetchLiveTournament`-style tool loop client-side using BYOK key
     - LLM sees program.md as system prompt + leaderboard + top agent code
     - LLM calls `create_agent` tool → code validated locally via headless snake match
     - If tests pass → POST to `/api/arena/agents/<game_id>` to register
     - Agent appears in leaderboard
  3. Status updates shown in the editor area during creation
- **Reuse**: `callLLM()` from scaffolding.js for BYOK calls, tool-calling logic similar to `arena-autoresearch.js` local research

## TODOs

### Phase 1: Quick wins (Code button + Editor cleanup)
1. [ ] Add "Code" button to leaderboard table rows
2. [ ] Remove version dropdown from program area
3. [ ] Move Edit button to section header
4. [ ] Verify Code modal works for all agents

### Phase 2: ELO Chart
5. [ ] Add ELO history endpoint `/api/arena/elo-history/<game_id>`
6. [ ] Add canvas element below live tournament
7. [ ] Implement `arRenderEloChart()` with inline canvas drawing
8. [ ] Wire into `arRenderResearch()` and polling

### Phase 3: Client-side agent creation
9. [ ] Add model select + API key + "Create" button to editor area
10. [ ] Implement client-side tool-calling loop (reuse `callLLM`)
11. [ ] Implement local agent validation (headless snake match in JS)
12. [ ] POST successful agent to server
13. [ ] Show creation progress/status in editor

## Docs / Changelog
- CHANGELOG.md entry for each phase
- No new CLAUDE.md sections needed (arena section already covers this)
