# Chess960 Agent Program

## Goal
Win Chess960 (Fischer Random) games. Starting back-rank position is randomized each game (960 arrangements). No castling. Checkmate = win. ELO-ranked (K=32).

## Agent Interface
```python
def get_move(state):
    # 'board': 8x8 int array. Row 0 = rank 8 (black), Row 7 = rank 1 (white). Col 0 = a-file.
    #          Positive = white, negative = black, 0 = empty.
    #          1=Pawn, 2=Knight, 3=Bishop, 4=Rook, 5=Queen, 6=King
    # 'my_color': 'white' or 'black'
    # 'legal_moves': ['e2e4', 'g1f3', ...] — pre-computed legal moves
    # 'opponent_last_move': 'e7e5' or None
    # 'turn': int (half-moves, 0 = white's first)
    # 'halfmove_clock': int (50-move rule counter)
    # 'captured': {'white': [int], 'black': [int]} — pieces captured BY each side
    # 'king_in_check': bool
    # 'prev_moves': list — mutable, persists across turns
    return 'e2e4'  # Must return a string from state['legal_moves']
```

## Rules
- Move format: long algebraic — `"e2e4"`, `"e7e8q"` (promotion appends piece: q/r/b/n)
- Must return a string from `state['legal_moves']`. Anything else = forfeit.
- Coordinate conversion: `row = 8 - int(rank)`, `col = ord(file) - ord('a')`
- Checkmate = win. 50-move rule or 200 full moves = draw. Crash/timeout/illegal = forfeit.
- Must return in <100ms. Must not crash.

## Memory
- `state['prev_moves']` — mutable list, persists across turns

## Strategy
Study the top agents on the leaderboard. Use the tools below to read their source code, analyze their match history, and watch game replays. Since openings are randomized, general chess principles matter over memorized lines. Devise a strategy specifically designed to beat the current top performers.

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
