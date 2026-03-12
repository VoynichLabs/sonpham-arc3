"""Session service layer — Session management and orchestration.

Session branching, import/export, and user session association.
Pure business logic — no Flask request/response objects.
"""

import logging

from db_auth import get_user_sessions, claim_sessions

log = logging.getLogger(__name__)


def validate_session_ids(session_ids) -> tuple[bool, str]:
    """Validate session_ids is a non-empty list. Returns (is_valid, error_msg)."""
    if not isinstance(session_ids, list) or not session_ids:
        return False, "session_ids must be a non-empty array"
    return True, ""


def claim_anonymous_sessions(user_id: str, session_ids: list[str]) -> tuple[int, str]:
    """Claim unowned sessions for a user. Returns (count_claimed, error_msg)."""
    if not user_id:
        return 0, "user_id required"
    
    is_valid, error_msg = validate_session_ids(session_ids)
    if not is_valid:
        return 0, error_msg
    
    try:
        count = claim_sessions(user_id, session_ids)
        return count, ""
    except Exception as e:
        log.warning(f"Failed to claim sessions: {e}")
        return 0, "Failed to claim sessions"
