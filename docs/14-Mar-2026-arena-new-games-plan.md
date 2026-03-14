# Arena: Add 4 New Games (Connect Four, Tron, Othello, Go 9x9)

**Date:** 2026-03-14
**Author:** Claude Opus 4.6

## Scope

**In scope:**
- 4 new game engines: Connect Four, Tron (Light Cycles), Othello/Reversi, Go 9x9
- AI strategies for each game (2-3 per game)
- Canvas rendering (match + preview) for each
- Game cards in arena.html
- Tags/categories for all games (Territorial, Symbolic, etc.)
- Wire into existing Arena dispatching (startMatch, renderStep, renderPreview)

**Out of scope:**
- Server-side changes (all client-side)
- LLM-based agents (hardcoded strategies only)
- Tournament/bracket mode
- New CSS (reuses existing arena.css classes)

## Architecture

All new code goes in `static/js/arena.js`. Each game follows the existing pattern:

```
1. Game Engine class (state, rules, step/makeMove)
2. AI Strategies object (2-3 strategies with fn, desc, personality)
3. Render functions (renderXxxFrame, renderXxxPreview)
4. Match runner function (runXxxMatch)
5. Entry in ARENA_GAMES array
6. Game card in arena.html
```

Dispatching is already game-id-based in `startMatch()`, `renderStep()`, and `renderPreview()`. Each new game just adds its branch.

### Game Designs

**1. Connect Four** (`connect4`)
- Tags: Symbolic, Turn-based
- 7 columns x 6 rows, drop pieces, first to 4 in a line wins
- Agent A = Red (ARC3[8]), Agent B = Amber (ARC3[12])
- Empty = Black (ARC3[5]), Board frame = DarkGray (ARC3[3])
- AI: `dropper` (greedy — maximize own lines), `blocker` (defensive — block opponent lines), `balanced` (minimax depth 4)
- Rendering: circles in cells, column drop animation not needed (instant)

**2. Tron / Light Cycles** (`tron`)
- Tags: Territorial, Simultaneous
- 30x30 grid, both agents leave trails, last alive wins
- Agent A = Blue head (ARC3[9]) + trail (ARC3[10]), Agent B = Red head (ARC3[8]) + trail (ARC3[12])
- Reuses Snake DX/DY/DIR constants, mulberry32 RNG not needed (fully deterministic start)
- AI: `greedy` (maximize own space via flood fill), `aggressive` (cut off opponent), `cautious` (stay central, max open space)

**3. Othello / Reversi** (`othello`)
- Tags: Symbolic, Turn-based
- 8x8 grid, place pieces to flip opponent's, most pieces wins
- Agent A = Blue (ARC3[9]), Agent B = Red (ARC3[8])
- Empty = DarkGray (ARC3[3]), valid move hint = dim Green (ARC3[14] at 30% opacity)
- AI: `corner_grabber` (prioritize corners/edges), `maximizer` (flip most pieces), `positional` (weighted square values)

**4. Go 9x9** (`go9`)
- Tags: Symbolic, Turn-based
- 9x9 board (full Go rules: liberties, capture, ko, scoring)
- Agent A = White stones (ARC3[0]), Agent B = Black stones (ARC3[5])
- Board = warm tan via custom fill, star points marked
- AI: `territorial` (claim corners/edges), `aggressive` (invade + cut), `balanced` (minimax-style with territory eval)
- Scoring: Chinese rules (area scoring), simpler to implement
- Ko rule: simple ko (no superko needed for AI vs AI)
- Pass: both consecutive passes = game over → count territory

## TODOs

1. **Update game tags** — Add category tags to existing Snake Battle and Chess960 cards
2. **Connect Four** — Engine + 3 AI strategies + render + match runner + game card
3. **Tron** — Engine + 3 AI strategies + render + match runner + game card
4. **Othello** — Engine + 3 AI strategies + render + match runner + game card
5. **Go 9x9** — Engine + 3 AI strategies + render + match runner + game card
6. **Wire dispatching** — Update renderStep, renderPreview, startMatch for all 4
7. **Update arena.html** — 4 new game cards with previews
8. **Smoke test** — Load /arena, select each game, run a match, verify rendering
9. **Update CHANGELOG.md**

## Docs / Changelog

- `CHANGELOG.md` — New entry for Arena games addition
- No other docs needed (self-contained client-side feature)
