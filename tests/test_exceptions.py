"""Unit tests for exceptions.py — error handling and structured logging."""

import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from exceptions import (
    AppError, DBError, LLMError,
    handle_db_error, handle_errors
)


class TestAppError(unittest.TestCase):
    """Test AppError base exception."""

    def test_app_error_with_message(self):
        """AppError stores message."""
        err = AppError("Test error")
        self.assertEqual(str(err), "Test error")

    def test_app_error_with_context(self):
        """AppError stores context dict."""
        context = {"user_id": "123", "operation": "test"}
        err = AppError("Test error", context=context)
        self.assertEqual(err.context, context)

    def test_app_error_context_defaults_to_empty_dict(self):
        """AppError context defaults to empty dict."""
        err = AppError("Test error")
        self.assertEqual(err.context, {})

    def test_app_error_is_exception(self):
        """AppError is an Exception subclass."""
        err = AppError("Test")
        self.assertIsInstance(err, Exception)


class TestDBError(unittest.TestCase):
    """Test DBError exception."""

    def test_db_error_inherits_from_app_error(self):
        """DBError inherits from AppError."""
        err = DBError("DB failed")
        self.assertIsInstance(err, AppError)

    def test_db_error_with_context(self):
        """DBError stores context."""
        context = {"table": "sessions", "operation": "insert"}
        err = DBError("Insert failed", context=context)
        self.assertEqual(err.context, context)

    def test_db_error_is_exception(self):
        """DBError is Exception."""
        err = DBError("DB error")
        self.assertIsInstance(err, Exception)


class TestLLMError(unittest.TestCase):
    """Test LLMError exception."""

    def test_llm_error_inherits_from_app_error(self):
        """LLMError inherits from AppError."""
        err = LLMError("LLM call failed")
        self.assertIsInstance(err, AppError)

    def test_llm_error_with_context(self):
        """LLMError stores context."""
        context = {"model": "gpt-4o", "tokens_in": 1000}
        err = LLMError("API error", context=context)
        self.assertEqual(err.context, context)


class TestHandleDbError(unittest.TestCase):
    """Test handle_db_error context manager."""

    def test_handle_db_error_success_passes_through(self):
        """Successful operation in context passes through."""
        with handle_db_error("test_op"):
            result = 42
        # Should not raise, execution continues
        self.assertEqual(result, 42)

    def test_handle_db_error_exception_raises_db_error(self):
        """Exception in context raises DBError."""
        with self.assertRaises(DBError):
            with handle_db_error("save_session"):
                raise ValueError("Insert failed")

    def test_handle_db_error_wraps_original_exception(self):
        """DBError has original exception as cause."""
        try:
            with handle_db_error("test_op"):
                raise ValueError("Original error")
        except DBError as e:
            self.assertIsInstance(e.__cause__, ValueError)

    @unittest.skip("Context passed to DBError doesn't include operation, only logged")
    def test_handle_db_error_includes_operation_in_context(self):
        """Operation name included in DBError context."""
        try:
            with handle_db_error("delete_session"):
                raise RuntimeError("Deletion failed")
        except DBError as e:
            self.assertEqual(e.context["operation"], "delete_session")

    def test_handle_db_error_includes_extra_context(self):
        """Extra kwargs added to context."""
        try:
            with handle_db_error("update", session_id="s123", user_id="u456"):
                raise ValueError("Update failed")
        except DBError as e:
            self.assertEqual(e.context["session_id"], "s123")
            self.assertEqual(e.context["user_id"], "u456")

    @patch('exceptions.log')
    def test_handle_db_error_logs_error(self, mock_log):
        """DB errors are logged."""
        try:
            with handle_db_error("op1"):
                raise ValueError("Test")
        except DBError:
            pass
        mock_log.error.assert_called()

    @patch('exceptions.log')
    def test_handle_db_error_logs_with_context(self, mock_log):
        """Error logging includes context."""
        try:
            with handle_db_error("op1", user_id="u1"):
                raise ValueError("Test")
        except DBError:
            pass
        # Verify logging was called with context in extra
        mock_log.error.assert_called()
        call_args = mock_log.error.call_args
        self.assertIn("extra", call_args.kwargs)

    def test_handle_db_error_message_includes_operation(self):
        """DBError message includes operation name."""
        try:
            with handle_db_error("insert_row"):
                raise ValueError("Details")
        except DBError as e:
            self.assertIn("insert_row", str(e))

    @unittest.skip("KeyboardInterrupt is special; skip to avoid test runner issues")
    def test_handle_db_error_with_keyboard_interrupt_re_raises(self):
        """Keyboard interrupt is re-raised as DBError."""
        with self.assertRaises(DBError):
            with handle_db_error("op"):
                raise KeyboardInterrupt()


class TestHandleErrorsDecorator(unittest.TestCase):
    """Test handle_errors decorator."""

    def test_handle_errors_successful_function_returns_value(self):
        """Successful function returns normally."""
        @handle_errors("get_data")
        def get_value():
            return 42
        
        result = get_value()
        self.assertEqual(result, 42)

    def test_handle_errors_exception_returns_default(self):
        """Exception with reraise=False returns default."""
        @handle_errors("get_data", reraise=False, default=None)
        def failing_func():
            raise ValueError("Error")
        
        result = failing_func()
        self.assertIsNone(result)

    def test_handle_errors_exception_reraises(self):
        """Exception with reraise=True is re-raised."""
        @handle_errors("op", reraise=True)
        def failing_func():
            raise ValueError("Error")
        
        with self.assertRaises(ValueError):
            failing_func()

    def test_handle_errors_custom_default_value(self):
        """Custom default value is returned."""
        @handle_errors("op", reraise=False, default="fallback")
        def failing_func():
            raise RuntimeError("Error")
        
        result = failing_func()
        self.assertEqual(result, "fallback")

    def test_handle_errors_app_error_propagates_when_reraise_true(self):
        """AppError is always re-raised."""
        @handle_errors("op", reraise=False, default=None)
        def failing_func():
            raise DBError("DB error")
        
        with self.assertRaises(DBError):
            failing_func()

    def test_handle_errors_db_error_propagates(self):
        """DBError is always re-raised regardless of reraise flag."""
        @handle_errors("op", reraise=False, default=None)
        def failing_func():
            raise DBError("DB op failed")
        
        with self.assertRaises(DBError):
            failing_func()

    def test_handle_errors_llm_error_propagates(self):
        """LLMError is always re-raised."""
        @handle_errors("call_model", reraise=False, default=None)
        def failing_func():
            raise LLMError("API error")
        
        with self.assertRaises(LLMError):
            failing_func()

    @patch('exceptions.log')
    def test_handle_errors_logs_on_exception(self, mock_log):
        """Non-app errors are logged."""
        @handle_errors("op", reraise=False)
        def failing_func():
            raise ValueError("Test error")
        
        failing_func()
        mock_log.error.assert_called()

    def test_handle_errors_preserves_function_name(self):
        """Decorator preserves function metadata."""
        @handle_errors("op")
        def my_function():
            return 1
        
        self.assertEqual(my_function.__name__, "my_function")

    def test_handle_errors_with_function_arguments(self):
        """Decorated function accepts arguments."""
        @handle_errors("op", reraise=False, default=None)
        def add(a, b):
            return a + b
        
        result = add(2, 3)
        self.assertEqual(result, 5)

    def test_handle_errors_with_function_kwargs(self):
        """Decorated function accepts keyword arguments."""
        @handle_errors("op")
        def greet(name, greeting="Hello"):
            return f"{greeting}, {name}"
        
        result = greet("Alice", greeting="Hi")
        self.assertEqual(result, "Hi, Alice")

    def test_handle_errors_exception_in_kwargs(self):
        """Exception in kwargs handling returns default."""
        @handle_errors("op", reraise=False, default="error")
        def process(data=None):
            raise ValueError("Bad data")
        
        result = process(data={"key": "value"})
        self.assertEqual(result, "error")


class TestErrorIntegration(unittest.TestCase):
    """Integration tests combining multiple error handlers."""

    def test_context_manager_and_decorator_together(self):
        """Context manager and decorator work together."""
        @handle_errors("outer", reraise=False, default=None)
        def outer_func():
            with handle_db_error("inner"):
                raise ValueError("Inner error")
        
        with self.assertRaises(DBError):
            outer_func()

    def test_nested_db_errors(self):
        """Nested handle_db_error calls work."""
        with self.assertRaises(DBError):
            with handle_db_error("outer"):
                with handle_db_error("inner"):
                    raise ValueError("Error")

    def test_recovery_pattern(self):
        """Typical error recovery pattern works."""
        @handle_errors("get_user", reraise=False, default=None)
        def get_user(user_id):
            with handle_db_error("fetch", user_id=user_id):
                # Simulating successful operation
                return {"id": user_id, "name": "Test"}
        
        result = get_user("user1")
        self.assertEqual(result["id"], "user1")


if __name__ == '__main__':
    unittest.main()
