"""Social service layer — Comments, voting, and leaderboard.

Validation and orchestration for social features.
Pure business logic — no Flask request/response objects.
"""

import logging

log = logging.getLogger(__name__)


def validate_comment_body(body: str) -> tuple[bool, str]:
    """Validate comment body. Returns (is_valid, error_msg)."""
    if not body:
        return False, "comment body required"
    body = body.strip()
    if not body:
        return False, "comment cannot be empty"
    if len(body) > 5000:
        return False, "comment too long (max 5000 chars)"
    return True, ""


def validate_vote_direction(vote: int) -> tuple[bool, str]:
    """Validate vote direction (1=upvote, -1=downvote). Returns (is_valid, error_msg)."""
    if vote not in (1, -1):
        return False, "vote must be 1 (upvote) or -1 (downvote)"
    return True, ""


def validate_comment_id(comment_id) -> tuple[bool, str]:
    """Validate comment_id is an integer. Returns (is_valid, error_msg)."""
    if comment_id is None:
        return False, "comment_id required"
    try:
        int(comment_id)
        return True, ""
    except (ValueError, TypeError):
        return False, "comment_id must be an integer"


def validate_game_id(game_id: str) -> tuple[bool, str]:
    """Validate game_id is present. Returns (is_valid, error_msg)."""
    if not game_id:
        return False, "game_id required"
    return True, ""
