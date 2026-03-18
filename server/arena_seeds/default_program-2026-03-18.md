# Snake Agent Program

## Goal
Win 2-player snake games on a 20x20 grid. Last snake alive wins. Longer snake wins on head-on collision or timeout (turn 350). 8 food items. ELO-ranked (K=32).

## Agent Interface
```python
def get_move(state):
    # 'grid_size': (20, 20)
    # 'my_snake': [[x,y], ...] — head first, LISTS not tuples
    # 'my_direction': 'UP'/'DOWN'/'LEFT'/'RIGHT'
    # 'enemy_snake': [[x,y], ...] — empty list if dead
    # 'enemy_direction': str or None
    # 'food': [[x,y], ...]
    # 'turn': int
    # 'prev_moves': list — mutable, persists across turns
    # 'memory': dict — mutable, persists across turns (500KB cap)
    return 'UP'  # Must return 'UP', 'DOWN', 'LEFT', or 'RIGHT'
```

## Rules
- Coordinates are LISTS [x,y] — use `tuple()` for sets: `set(tuple(s) for s in state['my_snake'])`
- Directions: UP=(0,-1) DOWN=(0,1) LEFT=(-1,0) RIGHT=(1,0). Origin (0,0) = top-left
- `enemy_snake` is `[]` when dead — always check before using
- Must return in <100ms. Must not crash.

## Memory
- `state['prev_moves']` — mutable list, persists across turns
- `state['memory']` — mutable dict (500KB cap), persists across turns, starts `{}`

## Strategy
Study the top agents on the leaderboard. Use the tools below to read their source code, analyze their match history, and watch game replays to understand how they win and lose. Devise a strategy specifically designed to beat the current top performers. Don't copy — counter.

## Libraries
You may use any Python library available in the runtime. Always test-import first:
```python
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
```
Missing imports are logged automatically as library requests. Your agent MUST still work if a library is unavailable — always provide a fallback path using only available modules.

Pre-installed: `random`, `math`, `collections`, `itertools`, `functools`, `heapq`.

Blocked (security): `os`, `subprocess`, `socket`, `sys`. No `open()`, `exec()`, `eval()`, or `__import__()`.

## Tools
| Tool | Purpose |
|------|---------|
| `query_db(sql)` | SELECT on arena DB (agents, games tables) |
| `read_agent(agent_name)` | Read any agent's source code |
| `get_agent_games(agent_name, limit)` | Agent's recent match results |
| `get_game_replay(game_id, start_turn, end_turn)` | Turn-by-turn replay (keep ranges small, 10-20 turns) |
| `test_match(agent1_name, agent2_name)` | Run a live match between two agents |
| `create_agent(name, code)` | Submit new agent (auto-validated) |
| `edit_current_agent(name, code)` | Fix agent created this round |
| `run_test(agent_name)` | Run validation tests |
