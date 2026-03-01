"""Tools and helpers for agent_spawn scaffolding — frame wrappers, grid formatting."""

from arcengine import GameAction

from agent import ACTION_NAMES, compress_row, compute_change_map


def format_grid(grid: list) -> str:
    """Format a grid for LLM consumption using RLE compression."""
    if not grid:
        return "(empty)"
    lines = []
    for i, row in enumerate(grid):
        lines.append(f"  Row {i:2d}: {compress_row(row)}")
    if len(lines) > 40:
        lines = lines[:20] + [f"  ... ({len(lines) - 40} more rows)"] + lines[-20:]
    return "\n".join(lines)


def format_change_map(prev_grid: list | None, grid: list) -> str:
    """Format the change map between two grids."""
    if prev_grid is None:
        return "(first observation)"
    cm = compute_change_map(prev_grid, grid)
    return cm if cm else "(no change)"


def format_history(history: list, max_entries: int = 15) -> str:
    """Format recent history for prompt injection."""
    if not history:
        return "(no history)"
    recent = history[-max_entries:]
    lines = []
    for h in recent:
        aname = ACTION_NAMES.get(h.get("action", -1), "?")
        lines.append(
            f"  Step {h['step']}: {aname} → state={h.get('state', '?')} "
            f"lvl={h.get('levels', '?')} | {h.get('observation', '')[:80]}"
        )
    return "\n".join(lines)


def validate_action(action_id: int, available_actions: list) -> int:
    """Ensure action_id is valid, fallback to first available."""
    if action_id in available_actions:
        return action_id
    return available_actions[0] if available_actions else 1


def make_game_action(action_id: int) -> GameAction:
    """Convert int action_id to GameAction enum, with fallback."""
    try:
        return GameAction.from_id(int(action_id))
    except (ValueError, KeyError):
        return GameAction.ACTION1
