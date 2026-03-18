# Othello Agent Program

## Goal
Win Othello (Reversi) games on an 8x8 board. Most discs at game end wins. ELO-ranked (K=32).

## Agent Interface
```python
def get_move(state):
    # 'board': 8x8 int array. 1 = black, -1 = white, 0 = empty. Row 0 = top, Col 0 = left.
    # 'my_color': 1 (black) or -1 (white)
    # 'legal_moves': [[row, col], ...] — pre-computed, never empty when called
    # 'opponent_last_move': [row, col] or None
    # 'turn': int (half-moves, 0 = black's first)
    # 'scores': {'black': int, 'white': int, 'empty': int}
    # 'prev_moves': list — mutable, persists across turns
    return [row, col]  # Must return a list from state['legal_moves']
```

## Rules
- Place a disc to flip opponent discs in all 8 directions (contiguous opponent line ending in your disc)
- Must return a list from `state['legal_moves']`. Anything else = forfeit.
- Game ends: both pass, board full, or 128 half-moves. Most discs wins.
- If no legal moves, your turn is skipped (agent not called).
- Must return in <100ms. Must not crash.

## Memory
- `state['prev_moves']` — mutable list, persists across turns

## Strategy
Study the top agents on the leaderboard. Use the tools below to read their source code, analyze their match history, and watch game replays. Disc count in the midgame is misleading — positional play often matters more than greedy flipping. Devise a strategy specifically designed to beat the current top performers.

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
