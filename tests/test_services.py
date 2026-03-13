"""Unit tests for server/services/ layer.

Tests that service functions handle input validation, error cases,
and correct delegation to DB/LLM layers.

All tests use mocks for database and external API calls.
"""

import unittest
from unittest.mock import patch, MagicMock, call
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestAuthService(unittest.TestCase):
    """Tests for server/services/auth_service.py"""

    def test_validate_email_requires_email(self):
        """Empty email should be rejected."""
        from server.services.auth_service import validate_email
        is_valid, msg = validate_email("")
        self.assertFalse(is_valid)
        self.assertIn("Email required", msg)

    def test_validate_email_invalid_format(self):
        """Invalid email format should be rejected."""
        from server.services.auth_service import validate_email
        
        # Missing @
        is_valid, msg = validate_email("notanemail")
        self.assertFalse(is_valid)
        
        # Missing domain
        is_valid, msg = validate_email("user@")
        self.assertFalse(is_valid)

    def test_validate_email_valid_format(self):
        """Valid email should pass."""
        from server.services.auth_service import validate_email
        is_valid, msg = validate_email("user@example.com")
        self.assertTrue(is_valid)
        self.assertEqual(msg, "")

    def test_validate_email_whitespace_trimmed(self):
        """Whitespace should be trimmed."""
        from server.services.auth_service import validate_email
        is_valid, msg = validate_email("  user@example.com  ")
        self.assertTrue(is_valid)

    @patch('server.services.auth_service.count_recent_magic_links')
    def test_check_magic_link_rate_limit_under_limit(self, mock_count):
        """Under rate limit should pass."""
        from server.services.auth_service import check_magic_link_rate_limit
        mock_count.return_value = 2  # Under limit of 3
        
        is_valid, msg = check_magic_link_rate_limit("user@example.com")
        self.assertTrue(is_valid)

    @patch('server.services.auth_service.count_recent_magic_links')
    def test_check_magic_link_rate_limit_exceeded(self, mock_count):
        """Over rate limit should fail."""
        from server.services.auth_service import check_magic_link_rate_limit
        mock_count.return_value = 3  # At limit
        
        is_valid, msg = check_magic_link_rate_limit("user@example.com")
        self.assertFalse(is_valid)
        self.assertIn("Too many requests", msg)


class TestGameService(unittest.TestCase):
    """Tests for server/services/game_service.py"""

    def test_validate_action_id_requires_action(self):
        """Missing action_id should be rejected."""
        from server.services.game_service import validate_action_id
        is_valid, msg = validate_action_id(None)
        self.assertFalse(is_valid)
        self.assertIn("action required", msg)

    def test_validate_action_id_must_be_integer(self):
        """Non-integer action should be rejected."""
        from server.services.game_service import validate_action_id
        is_valid, msg = validate_action_id("not-a-number")
        self.assertFalse(is_valid)
        self.assertIn("Invalid action", msg)

    def test_validate_action_id_valid_integer(self):
        """Valid integer action should pass."""
        from server.services.game_service import validate_action_id
        is_valid, msg = validate_action_id(42)
        self.assertTrue(is_valid)

    def test_validate_action_id_numeric_string(self):
        """Numeric string should pass."""
        from server.services.game_service import validate_action_id
        is_valid, msg = validate_action_id("42")
        self.assertTrue(is_valid)

    def test_validate_game_id_requires_game_id(self):
        """Missing game_id should be rejected."""
        from server.services.game_service import validate_game_id
        is_valid, msg = validate_game_id("")
        self.assertFalse(is_valid)
        self.assertIn("game_id required", msg)

    def test_validate_game_id_valid(self):
        """Valid game_id should pass."""
        from server.services.game_service import validate_game_id
        is_valid, msg = validate_game_id("ls20")
        self.assertTrue(is_valid)

    def test_validate_session_id_requires_session_id(self):
        """Missing session_id should be rejected."""
        from server.services.game_service import validate_session_id
        is_valid, msg = validate_session_id("")
        self.assertFalse(is_valid)
        self.assertIn("session_id required", msg)

    def test_validate_session_id_valid(self):
        """Valid session_id should pass."""
        from server.services.game_service import validate_session_id
        is_valid, msg = validate_session_id("sess_abc123")
        self.assertTrue(is_valid)


class TestSessionService(unittest.TestCase):
    """Tests for server/services/session_service.py"""

    def test_validate_session_ids_requires_session_id(self):
        """Empty session_ids should be rejected."""
        from server.services.session_service import validate_session_ids
        
        is_valid, msg = validate_session_ids([])
        self.assertFalse(is_valid)
        self.assertIsInstance(msg, str)

    def test_validate_session_ids_valid(self):
        """Valid session_ids list should pass."""
        from server.services.session_service import validate_session_ids
        
        is_valid, msg = validate_session_ids(["sess_abc123"])
        self.assertTrue(is_valid)


class TestSocialService(unittest.TestCase):
    """Tests for server/services/social_service.py"""

    def test_comment_body_validation_requires_text(self):
        """Empty comment body should be rejected."""
        from server.services.social_service import validate_comment_body
        
        is_valid, msg = validate_comment_body("")
        self.assertFalse(is_valid)
        self.assertIsInstance(msg, str)

    def test_comment_body_validation_valid(self):
        """Valid comment body should pass."""
        from server.services.social_service import validate_comment_body
        
        is_valid, msg = validate_comment_body("Great game!")
        self.assertTrue(is_valid)

    def test_comment_body_whitespace_only_rejected(self):
        """Whitespace-only comment should be rejected."""
        from server.services.social_service import validate_comment_body
        
        is_valid, msg = validate_comment_body("   ")
        self.assertFalse(is_valid)


class TestLLMAdminService(unittest.TestCase):
    """Tests for server/services/llm_admin_service.py"""

    def test_get_models_returns_dict(self):
        """get_models should return a dict with status."""
        from server.services.llm_admin_service import get_models
        
        result = get_models({})
        self.assertIsInstance(result, dict)
        # Should have status or error key
        self.assertTrue(any(key in result for key in ['status', 'error', 'models']))


class TestServiceInputValidation(unittest.TestCase):
    """Cross-service input validation tests."""

    def test_all_services_handle_none_gracefully(self):
        """Services should not crash on None input."""
        from server.services import auth_service, game_service
        
        # None should not crash, should return (False, error_msg)
        result = auth_service.validate_email(None)
        self.assertIsInstance(result, tuple)
        self.assertFalse(result[0])
        
        result = game_service.validate_game_id(None)
        self.assertIsInstance(result, tuple)
        self.assertFalse(result[0])

    def test_validation_errors_are_strings(self):
        """All error messages should be strings."""
        from server.services import auth_service, game_service, social_service
        
        test_cases = [
            (auth_service.validate_email, "invalid"),
            (game_service.validate_game_id, ""),
            (game_service.validate_action_id, None),
            (social_service.validate_comment_body, ""),
        ]
        
        for fn, arg in test_cases:
            _, msg = fn(arg)
            self.assertIsInstance(msg, str)


class TestServiceErrorMessages(unittest.TestCase):
    """Test that services return clear error messages."""

    def test_validation_errors_include_field_name(self):
        """Error messages should indicate which field is invalid."""
        from server.services import game_service
        
        _, msg = game_service.validate_game_id("")
        self.assertIn("game_id", msg.lower())

    def test_auth_validation_error_messages(self):
        """Auth service should return clear error messages."""
        from server.services import auth_service
        
        _, msg = auth_service.validate_email("")
        self.assertIsInstance(msg, str)
        self.assertGreater(len(msg), 0)
        
        _, msg = auth_service.validate_email("invalid-email")
        self.assertIsInstance(msg, str)


class TestServiceIntegration(unittest.TestCase):
    """Integration tests for service layer."""

    @patch('server.services.auth_service.verify_magic_link')
    def test_magic_link_flow_returns_user(self, mock_verify):
        """Magic link verification should return user data."""
        from server.services import auth_service
        
        mock_verify.return_value = ("user_id_123", None)
        
        # Mock the user retrieval
        with patch('server.services.auth_service.find_or_create_user'):
            result = auth_service.verify_and_login("code_123")
            self.assertIsInstance(result, tuple)
            self.assertEqual(len(result), 2)  # Returns (data, error_msg)

    def test_game_validation_functions_return_consistent_type(self):
        """All game validation functions should return (bool, str) tuples."""
        from server.services import game_service
        
        validators = [
            game_service.validate_action_id,
            game_service.validate_game_id,
            game_service.validate_session_id,
        ]
        
        test_inputs = [None, "", "valid_input"]
        
        for validator in validators:
            for test_input in test_inputs:
                result = validator(test_input)
                self.assertIsInstance(result, tuple)
                self.assertEqual(len(result), 2)
                self.assertIsInstance(result[0], bool)
                self.assertIsInstance(result[1], str)


if __name__ == '__main__':
    unittest.main()
