"""Authentication service layer — Magic link and OAuth token management.

Orchestrates user auth, magic links, and token management.
Pure business logic — no Flask request/response objects.

Note: Most auth functions are imported directly from db_auth.
This module adds validation and orchestration logic on top.
"""

import logging

from db_auth import (
    find_or_create_user,
    create_auth_token,
    verify_auth_token,
    create_magic_link,
    verify_magic_link,
    delete_auth_token,
    count_recent_magic_links,
    AUTH_TOKEN_TTL,
    MAGIC_LINK_TTL,
)

log = logging.getLogger(__name__)


def validate_email(email: str) -> tuple[bool, str]:
    """Validate email format. Returns (is_valid, error_message)."""
    email = (email or "").lower().strip()
    if not email:
        return False, "Email required"
    if "@" not in email or "." not in email.split("@")[-1]:
        return False, "Valid email required"
    return True, ""


def check_magic_link_rate_limit(email: str, max_per_window: int = 3) -> tuple[bool, str]:
    """Check if email has exceeded magic link rate limit."""
    count = count_recent_magic_links(email, window=900)  # 15 minutes
    if count >= max_per_window:
        return False, "Too many requests. Please wait a few minutes."
    return True, ""


def initiate_magic_link(email: str) -> tuple[str | None, str]:
    """Create a magic link code for an email. Returns (code, error_msg)."""
    is_valid, error_msg = validate_email(email)
    if not is_valid:
        return None, error_msg
    
    is_allowed, rate_msg = check_magic_link_rate_limit(email)
    if not is_allowed:
        return None, rate_msg
    
    code = create_magic_link(email)
    if not code:
        return None, "Failed to create magic link"
    
    return code, ""


def verify_and_login(code: str) -> tuple[dict | None, str]:
    """Verify a magic link code and create an auth token. Returns (auth_info, error_msg)."""
    if not code:
        return None, "Code required"
    
    email = verify_magic_link(code)
    if not email:
        return None, "Invalid or expired link"
    
    user = find_or_create_user(email)
    if not user:
        return None, "Failed to create user"
    
    token = create_auth_token(user["id"])
    if not token:
        return None, "Failed to create token"
    
    return {"token": token, "user": user, "ttl": AUTH_TOKEN_TTL}, ""


def logout(token: str):
    """Invalidate an auth token."""
    if token:
        delete_auth_token(token)


def oauth_user_from_google(email: str, display_name: str = "", google_id: str = "") -> tuple[dict | None, str]:
    """Create/find user from Google OAuth and issue auth token. Returns (auth_info, error_msg)."""
    is_valid, error_msg = validate_email(email)
    if not is_valid:
        return None, error_msg
    
    user = find_or_create_user(email, display_name=display_name, google_id=google_id)
    if not user:
        return None, "Failed to create user"
    
    token = create_auth_token(user["id"])
    if not token:
        return None, "Failed to create token"
    
    return {"token": token, "user": user, "ttl": AUTH_TOKEN_TTL}, ""
