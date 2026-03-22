# Snake Random Benchmark Bots — Plan Doc

**Date:** 2026-03-18
**Goal:** Add 3 algorithmic benchmark bots (adapted from well-known snake AI strategies) to the `snake_random` arena, with a distinct blue visual treatment for anchor/benchmark agents.

---

## Scope

### In scope
- 3 new `snake_random` seed agents of increasing strength, adapted from proven snake AI algorithms (chuyangliu/snake, Hawstein/snake-ai)
- Blue visual styling for all anchor agents (`is_anchor=1`) across every arena game — currently anchors only get a small ⚓ badge with no color treatment
- Registration in `_GAME_SEEDS` so they auto-seed on empty arenas

### Out of scope
- Benchmark bots for other game types (snake classic, royale, 2v2, chess960, othello)
- RL/neural-network based agents (require training infrastructure)
- Changes to the `get_move(state)` interface or snake engine

---

## Architecture

### New agent files (`server/arena_seeds/`)

All three agents implement the standard `get_move(state) -> str` interface. All adapted for the 2-player competitive + random walls context (treat walls, enemy snake, own body as obstacles).

| Agent file | Name | Algorithm | Adapted from | Expected strength |
|------------|------|-----------|-------------|-------------------|
| `snake_random_bfs_pathfinder.py` | `seed_bfs` | BFS shortest path to nearest reachable food. Falls back to longest-reachable-area move if no food reachable. | chuyangliu/snake Greedy (simplified) | Medium — beats greedy in wall-heavy maps |
| `snake_random_safe_pathfinder.py` | `seed_safe` | BFS to food + virtual snake simulation + flood-fill safety check. Only commits to a food path if the snake can still reach its own tail after eating (escape route). Falls back to tail-chase. | Hawstein/snake-ai + chuyangliu/snake Greedy | Hard — gold-standard single-player strategy adapted for 2P |
| `snake_random_space_controller.py` | `seed_space` | Flood-fill space maximization + enemy cut-off. Scores moves by: reachable area (flood fill) × 3 + food proximity bonus − proximity-to-enemy penalty. Aggressively picks moves that maximize own territory while shrinking enemy's. | Original, combines wall_avoider flood-fill with competitive space denial | Hard — plays for board control, not just food |

### Algorithm details

**BFS Pathfinder (`seed_bfs`)**
1. Build occupied set: own body + enemy body + walls
2. BFS from head to find nearest reachable food cell
3. Track first move taken in BFS — return that move
4. If no food reachable: pick the safe move with most flood-fill reachable cells
5. If no safe move: return current direction (death imminent)

**Safe Pathfinder (`seed_safe`)**
1. BFS to find nearest food (same as above)
2. Before committing: simulate eating — create virtual snake (head at food, body shifted, +1 length)
3. From virtual snake head, BFS to own tail position — if reachable, the path is safe
4. If not safe: try next-nearest food
5. If no safe food path: follow longest path toward own tail (tail-chase)
6. If tail unreachable: pick move with most flood-fill space (same as wall_avoider)

**Space Controller (`seed_space`)**
1. For each safe move, compute:
   - `my_space`: flood-fill reachable cells from that position (walls + enemy + self as obstacles)
   - `food_bonus`: number of food items reachable in that flood region
   - `enemy_space`: flood-fill from enemy head (optional, skip if enemy dead)
   - Score = `my_space * 3 + food_bonus * 10 - enemy_proximity_penalty`
2. Tiebreaker: prefer moves that go toward food
3. When winning on length: play conservatively (maximize space). When losing: play aggressively (minimize enemy space by cutting off corridors)

### Blue visual treatment for anchor agents

**CSS changes** (`static/css/arena.css`):
- Add `.ar-lb-row.ar-lb-anchor` styles matching the human-agent pattern but in blue
- Row background: `#1E93FF0A` (very subtle blue tint)
- Row hover: `#1E93FF18`
- Agent name color: `#1E93FF` (bright blue, matches existing badge color)
- The ⚓ badge already exists — just adding row-level color treatment

**JS changes** (`static/js/arena.js`):
- Add `anchorClass` variable (like `humanClass`) to apply `ar-lb-anchor` CSS class on anchor rows

---

## TODOs

1. **Create `snake_random_bfs_pathfinder.py`** — BFS pathfinder agent
   - Verify: run 10 test matches against existing `seed_greedy` via Python
2. **Create `snake_random_safe_pathfinder.py`** — Safe pathfinder agent
   - Verify: run 10 test matches against `seed_bfs`
3. **Create `snake_random_space_controller.py`** — Space controller agent
   - Verify: run 10 test matches against `seed_safe`
4. **Register in `_GAME_SEEDS`** (`server/arena_heartbeat.py`) — add 3 new entries to `snake_random` seeds dict
5. **Add blue anchor styling** (`static/css/arena.css`) — `.ar-lb-anchor` row styles
6. **Add anchor CSS class** (`static/js/arena.js`) — apply `ar-lb-anchor` class to anchor rows
7. **Smoke test** — verify all 3 agents pass arena validation (the 12-scenario test in `arena_submit_agent`)
8. **Changelog** entry

---

## Docs / Changelog touchpoints
- `CHANGELOG.md` — new entry for benchmark bots + blue anchor styling
