"""Unit tests for prompt_builder.py — JSON extraction, parsing, and prompt construction."""

import unittest
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from prompt_builder import _extract_json, _parse_llm_response, _build_prompt


class TestExtractJson(unittest.TestCase):
    """Test _extract_json with various JSON patterns."""

    def test_plain_json_object(self):
        """Extract simple JSON object with required field."""
        # _extract_json only returns objects with specific fields
        result = _extract_json('{"action": 1, "key": "value"}')
        self.assertIsNotNone(result)
        self.assertEqual(result["action"], 1)

    def test_json_with_action_field(self):
        """Extract JSON with 'action' field."""
        result = _extract_json('{"action": 3, "data": {}}')
        self.assertEqual(result["action"], 3)

    def test_json_with_plan_field(self):
        """Extract JSON with 'plan' field."""
        result = _extract_json('{"plan": [{"action": 0}]}')
        self.assertIsNotNone(result)
        self.assertEqual(result["plan"], [{"action": 0}])

    def test_json_embedded_in_text(self):
        """Extract JSON from text containing JSON."""
        text = 'Here is the result: {"action": 2, "data": {"x": 10, "y": 20}}'
        result = _extract_json(text)
        self.assertIsNotNone(result)
        self.assertEqual(result["action"], 2)
        self.assertEqual(result["data"]["x"], 10)

    def test_json_with_nested_objects(self):
        """Extract nested JSON object."""
        result = _extract_json('{"action": 1, "outer": {"inner": {"deep": 1}}}')
        self.assertIsNotNone(result)
        self.assertEqual(result["outer"]["inner"]["deep"], 1)

    def test_json_with_array(self):
        """Extract JSON with array field."""
        result = _extract_json('{"plan": [{"action": 0}, {"action": 1}]}')
        self.assertIsNotNone(result)
        self.assertEqual(len(result["plan"]), 2)

    def test_no_json_returns_none(self):
        """Return None when no valid JSON found."""
        result = _extract_json("No JSON here at all")
        self.assertIsNone(result)

    def test_invalid_json_returns_none(self):
        """Return None for malformed JSON."""
        result = _extract_json('{"incomplete": ')
        self.assertIsNone(result)

    def test_json_with_escaped_quotes(self):
        """Handle escaped quotes in JSON strings."""
        result = _extract_json('{"action": 1, "observation": "He said \\"hello\\""}')
        self.assertIsNotNone(result)
        self.assertIn("observation", result)

    def test_json_with_type_field(self):
        """Extract JSON with 'type' field."""
        result = _extract_json('{"type": "move", "action": 1}')
        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "move")

    def test_json_with_verdict_field(self):
        """Extract JSON with 'verdict' field."""
        result = _extract_json('{"verdict": "success", "score": 100}')
        self.assertIsNotNone(result)
        self.assertEqual(result["verdict"], "success")

    def test_multiple_json_objects_returns_first(self):
        """Return first valid JSON when multiple objects exist."""
        text = '{"action": 1} and {"action": 2}'
        result = _extract_json(text)
        self.assertIsNotNone(result)
        self.assertEqual(result["action"], 1)

    def test_json_with_comments_filtered(self):
        """Filter out JavaScript-style comments."""
        text = '// This is a comment\n{"action": 0}'
        result = _extract_json(text)
        self.assertIsNotNone(result)

    def test_json_with_newlines_and_whitespace(self):
        """Handle JSON with newlines and indentation."""
        text = '''{
            "action": 3,
            "data": {
                "x": 15,
                "y": 25
            }
        }'''
        result = _extract_json(text)
        self.assertIsNotNone(result)
        self.assertEqual(result["action"], 3)

    def test_json_with_numbers(self):
        """Correctly parse numeric values."""
        result = _extract_json('{"action": 1, "count": 42, "ratio": 3.14, "negative": -5}')
        self.assertIsNotNone(result)
        self.assertEqual(result["count"], 42)
        self.assertAlmostEqual(result["ratio"], 3.14, places=2)
        self.assertEqual(result["negative"], -5)

    def test_json_with_booleans_and_null(self):
        """Handle boolean and null values."""
        result = _extract_json('{"action": 1, "success": true, "failed": false, "data": null}')
        self.assertIsNotNone(result)
        self.assertTrue(result["success"])
        self.assertFalse(result["failed"])
        self.assertIsNone(result["data"])


class TestParseLLMResponse(unittest.TestCase):
    """Test _parse_llm_response with various response formats."""

    def test_parse_simple_json_response(self):
        """Parse simple JSON in response."""
        content = '{"action": 2, "data": {}}'
        result = _parse_llm_response(content, "gpt-4o")
        self.assertIsNotNone(result["parsed"])
        self.assertEqual(result["parsed"]["action"], 2)
        self.assertEqual(result["model"], "gpt-4o")

    def test_parse_json_with_thinking_tags(self):
        """Extract thinking block and parse JSON from main content."""
        content = '<think>Let me analyze this...</think>\n{"action": 1}'
        result = _parse_llm_response(content, "claude-3-5-sonnet")
        self.assertIn("Let me analyze", result["thinking"])
        self.assertEqual(result["parsed"]["action"], 1)

    def test_parse_json_in_thinking_when_no_main_json(self):
        """Extract JSON from thinking block if main content has none."""
        content = '<think>The answer is: {"action": 3}</think>\nNo JSON here'
        result = _parse_llm_response(content, "claude")
        self.assertEqual(result["parsed"]["action"], 3)

    def test_parse_non_string_response_converts_to_json(self):
        """Handle non-string content by converting to JSON."""
        content = {"action": 4}
        result = _parse_llm_response(content, "gpt-4")
        self.assertIsNotNone(result)

    def test_parse_response_without_json_returns_raw(self):
        """Return raw content when no JSON found."""
        content = "This is just plain text, no JSON at all."
        result = _parse_llm_response(content, "model")
        self.assertIsNone(result["parsed"])
        self.assertIn("plain text", result["raw"])

    def test_parse_empty_response(self):
        """Handle empty response gracefully."""
        result = _parse_llm_response("", "model")
        self.assertIsNone(result["parsed"])

    def test_parse_response_with_multiple_thinking_blocks(self):
        """Handle multiple thinking blocks (uses first/outer)."""
        content = '<think>First</think> text <think>Second</think>'
        result = _parse_llm_response(content, "model")
        self.assertIn("First", result["thinking"])

    def test_parse_response_thinking_length_capped(self):
        """Thinking content capped at 500 chars."""
        long_thinking = "x" * 1000
        content = f'<think>{long_thinking}</think>\n{{"action": 1}}'
        result = _parse_llm_response(content, "model")
        self.assertLessEqual(len(result["thinking"]), 500)

    def test_parse_complex_json_response(self):
        """Parse complex JSON with plan array."""
        content = '''{
            "observation": "Character near wall",
            "plan": [
                {"action": 0, "data": {}},
                {"action": 1, "data": {}}
            ]
        }'''
        result = _parse_llm_response(content, "model")
        self.assertIsNotNone(result["parsed"])
        self.assertEqual(len(result["parsed"]["plan"]), 2)


class TestBuildPrompt(unittest.TestCase):
    """Test _build_prompt with various payload configurations."""

    def setUp(self):
        """Set up test fixtures."""
        self.basic_payload = {
            "grid": [[0, 1], [2, 3]],
            "state": "playing",
            "available_actions": [0, 1, 2, 3],
            "levels_completed": 0,
            "win_levels": 1,
            "game_id": "test-game",
            "history": [],
            "change_map": {},
        }
        self.basic_settings = {
            "full_grid": True,
            "color_histogram": False,
            "diff": False,
            "image": False,
        }

    def test_build_basic_prompt(self):
        """Build basic prompt with minimal payload."""
        prompt = _build_prompt(self.basic_payload, self.basic_settings, "off")
        self.assertIn("test-game", prompt)
        self.assertIn("Row 0:", prompt)
        self.assertIn("action", prompt)

    def test_build_prompt_with_custom_system_prompt(self):
        """Include custom system prompt."""
        custom = "Custom prompt text"
        prompt = _build_prompt(
            self.basic_payload, self.basic_settings, "off",
            custom_system_prompt=custom
        )
        self.assertIn(custom, prompt)

    def test_build_prompt_with_custom_hard_memory(self):
        """Include custom hard memory."""
        memory = "Agent learned: pattern X exists"
        prompt = _build_prompt(
            self.basic_payload, self.basic_settings, "off",
            custom_hard_memory=memory
        )
        self.assertIn(memory, prompt)
        self.assertIn("AGENT MEMORY", prompt)

    def test_build_prompt_with_tools_on(self):
        """Include tool instructions when tools_mode='on'."""
        prompt = _build_prompt(self.basic_payload, self.basic_settings, "on")
        self.assertIn("run_python", prompt)
        self.assertIn("analysis", prompt)

    def test_build_prompt_with_planning_mode(self):
        """Build prompt with planning mode (multiple steps)."""
        prompt = _build_prompt(
            self.basic_payload, self.basic_settings, "off",
            planning_mode="3"
        )
        self.assertIn("plan", prompt)
        self.assertIn("3 steps", prompt)

    def test_build_prompt_with_history(self):
        """Include action history in prompt."""
        payload = self.basic_payload.copy()
        payload["history"] = [
            {
                "step": 1,
                "action": 0,
                "result_state": "moving",
                "change_map": {"change_count": 5, "change_map_text": "5 cells"},
                "grid": [[0, 1], [2, 3]],
            }
        ]
        prompt = _build_prompt(payload, self.basic_settings, "off")
        self.assertIn("HISTORY", prompt)
        self.assertIn("Step 1:", prompt)

    def test_build_prompt_with_color_histogram(self):
        """Include color histogram when requested."""
        settings = self.basic_settings.copy()
        settings["color_histogram"] = True
        prompt = _build_prompt(self.basic_payload, settings, "off")
        # Histogram may be empty for uniform grid, but section should exist
        self.assertIn("COLOR HISTOGRAM", prompt)

    def test_build_prompt_with_diff(self):
        """Include change diff when requested."""
        payload = self.basic_payload.copy()
        payload["change_map"] = {
            "change_count": 3,
            "change_map_text": "Cells changed at positions..."
        }
        settings = self.basic_settings.copy()
        settings["diff"] = True
        prompt = _build_prompt(payload, settings, "off")
        self.assertIn("CHANGES", prompt)

    def test_build_prompt_color_palette_always_included(self):
        """Color palette always included in prompt."""
        prompt = _build_prompt(self.basic_payload, self.basic_settings, "off")
        self.assertIn("COLOR PALETTE", prompt)
        self.assertIn("White", prompt)
        self.assertIn("Black", prompt)

    def test_build_prompt_with_interrupt_plan_mode(self):
        """Include expected field when interrupt_plan=True."""
        prompt = _build_prompt(
            self.basic_payload, self.basic_settings, "off",
            planning_mode="2", interrupt_plan=True
        )
        self.assertIn("expected", prompt)

    def test_build_prompt_levels_info_included(self):
        """Include levels progress in prompt."""
        payload = self.basic_payload.copy()
        payload["levels_completed"] = 3
        payload["win_levels"] = 5
        prompt = _build_prompt(payload, self.basic_settings, "off")
        self.assertIn("3/5", prompt)


if __name__ == '__main__':
    unittest.main()
