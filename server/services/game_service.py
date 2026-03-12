"""Game service layer — Game initialization and step validation.

Validation and orchestration for game operations.
Pure business logic — no Flask request/response objects.

Note: Arcade game engine operations and session in-memory state
coordination remain in app.py. This module provides helpers.
"""

import logging

log = logging.getLogger(__name__)


def validate_action_id(action_id) -> tuple[bool, str]:
    """Validate action_id is a valid integer. Returns (is_valid, error_msg)."""
    if action_id is None:
        return False, "action required"
    try:
        int(action_id)
        return True, ""
    except (ValueError, TypeError):
        return False, f"Invalid action: {action_id}"


def validate_game_id(game_id: str) -> tuple[bool, str]:
    """Validate game_id is present. Returns (is_valid, error_msg)."""
    if not game_id:
        return False, "game_id required"
    return True, ""


def validate_session_id(session_id: str) -> tuple[bool, str]:
    """Validate session_id is present. Returns (is_valid, error_msg)."""
    if not session_id:
        return False, "session_id required"
    return True, ""
