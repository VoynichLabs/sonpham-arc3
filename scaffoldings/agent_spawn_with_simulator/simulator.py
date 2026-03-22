"""Simulator agent — builds a predictive model of game mechanics by writing code."""

import copy
import json
import re
import time
import traceback

from agent import (
    call_model_with_metadata,
    effective_model,
    _parse_json,
)

from scaffoldings.agent_spawn.memories import SharedMemories
from scaffoldings.agent_spawn.tools import format_grid
from scaffoldings.agent_spawn_with_simulator.prompts import (
    SIMULATOR_SYSTEM,
    SIMULATOR_TURN_TEMPLATE,
)


def _parse_simulator_response(text: str) -> dict | None:
    """Parse simulator LLM response, handling markdown code blocks and raw code.

    The simulator often outputs code in markdown blocks that break standard JSON
    parsing. This function handles:
    1. Standard JSON with escaped code
    2. Markdown-wrapped JSON (```json ... ```)
    3. Raw code blocks (```python ... ```) with surrounding JSON-like text
    """
    if not text:
        return None

    # Strip <think>...</think> blocks
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    # Try standard JSON parse first
    parsed = _parse_json(text)
    if parsed and parsed.get("command"):
        return parsed

    # Try to extract code from markdown blocks and reconstruct JSON
    code_match = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    if code_match:
        code = code_match.group(1).strip()

        # Check if the code block contains a simulate function
        if "def simulate" in code:
            # Look for command/reasoning in surrounding text
            reasoning = ""
            reasoning_match = re.search(r'"reasoning"\s*:\s*"([^"]*)"', text)
            if reasoning_match:
                reasoning = reasoning_match.group(1)
            confidence_match = re.search(r'"confidence"\s*:\s*([\d.]+)', text)
            confidence = float(confidence_match.group(1)) if confidence_match else 0.5

            return {
                "command": "simulate",
                "code": code,
                "reasoning": reasoning,
                "confidence": confidence,
            }

    # Try extracting code from "code" field even if JSON is malformed
    code_field_match = re.search(r'"code"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    if code_field_match:
        try:
            code = json.loads(f'"{code_field_match.group(1)}"')
            if "def simulate" in code:
                return {
                    "command": "simulate",
                    "code": code,
                    "reasoning": "",
                    "confidence": 0.5,
                }
        except Exception:
            pass

    # Try finding a report command
    if '"command"' in text and '"report"' in text:
        # Try more aggressive JSON extraction
        try:
            # Find all possible JSON objects
            brace_depth = 0
            start = -1
            for i, ch in enumerate(text):
                if ch == '{':
                    if brace_depth == 0:
                        start = i
                    brace_depth += 1
                elif ch == '}':
                    brace_depth -= 1
                    if brace_depth == 0 and start >= 0:
                        try:
                            obj = json.loads(text[start:i+1])
                            if obj.get("command"):
                                return obj
                        except json.JSONDecodeError:
                            pass
                        start = -1
        except Exception:
            pass

    return None


class SimulatorState:
    """Tracks the simulator's evolving code and accuracy across invocations."""

    def __init__(self):
        self.code: str = ""
        self.accuracy: float = 0.0
        self.iterations: int = 0
        self.total_llm_calls: int = 0
        self.total_input_tokens: int = 0
        self.total_output_tokens: int = 0
        self.total_duration_ms: int = 0
        self.findings: list[str] = []
        self.last_test_results: str = ""

    def format_status(self) -> str:
        if not self.code:
            return "(no simulator built yet)"
        return (
            f"Simulator: {self.iterations} iterations, "
            f"accuracy={self.accuracy:.0%}, "
            f"{self.total_llm_calls} LLM calls"
        )


def _format_transitions(observations: list, max_show: int = 15) -> str:
    """Format observed transitions for the simulator prompt."""
    if not observations:
        return "(no transitions observed yet)"

    lines = []
    shown = observations[-max_show:] if len(observations) > max_show else observations
    omitted = len(observations) - len(shown)
    if omitted > 0:
        lines.append(f"(showing last {len(shown)} of {len(observations)} transitions)\n")

    for i, obs in enumerate(shown):
        idx = omitted + i + 1
        action = obs.get("action", "?")
        grid_before = obs.get("grid_before")
        grid_after = obs.get("grid_after")
        obs_text = obs.get("observation", "")

        lines.append(f"--- Transition {idx}: action={action} ---")
        lines.append(f"Observation: {obs_text}")
        if grid_before:
            lines.append(f"BEFORE:\n{format_grid(grid_before)}")
        if grid_after:
            lines.append(f"AFTER:\n{format_grid(grid_after)}")
        lines.append("")

    return "\n".join(lines)


def _test_simulation(code: str, observations: list) -> tuple[float, str]:
    """Test simulation code against observed transitions.

    Returns (accuracy, results_text).
    """
    if not code or not observations:
        return 0.0, "(no code or no observations)"

    # Compile the simulation function
    namespace = {}
    try:
        exec(code, namespace)
    except Exception as e:
        return 0.0, f"COMPILE ERROR: {e}"

    simulate_fn = namespace.get("simulate")
    if simulate_fn is None:
        return 0.0, "ERROR: no 'simulate' function defined in code"

    correct = 0
    total = 0
    results = []

    for i, obs in enumerate(observations):
        grid_before = obs.get("grid_before")
        grid_after = obs.get("grid_after")
        action = obs.get("action", 0)

        if grid_before is None or grid_after is None:
            continue

        total += 1
        try:
            predicted = simulate_fn(copy.deepcopy(grid_before), action)
            if predicted == grid_after:
                correct += 1
                results.append(f"  [{i+1}] action={action}: MATCH")
            else:
                # Find first mismatch for debugging
                mismatch_info = _find_mismatch(predicted, grid_after)
                results.append(f"  [{i+1}] action={action}: MISMATCH — {mismatch_info}")
        except Exception as e:
            results.append(f"  [{i+1}] action={action}: RUNTIME ERROR — {e}")

    if total == 0:
        return 0.0, "(no transitions with grid data to test)"

    accuracy = correct / total
    header = f"Accuracy: {correct}/{total} = {accuracy:.0%}\n"
    return accuracy, header + "\n".join(results)


def _find_mismatch(predicted: list, actual: list) -> str:
    """Find the first mismatch between predicted and actual grids."""
    if not predicted or not actual:
        return "empty grid"
    for r in range(min(len(predicted), len(actual))):
        pred_row = predicted[r] if r < len(predicted) else []
        act_row = actual[r] if r < len(actual) else []
        for c in range(min(len(pred_row), len(act_row))):
            if pred_row[c] != act_row[c]:
                return f"row {r}, col {c}: predicted={pred_row[c]}, actual={act_row[c]}"
    if len(predicted) != len(actual):
        return f"grid height mismatch: predicted={len(predicted)}, actual={len(actual)}"
    return "unknown mismatch"


def run_simulator(
    cfg: dict,
    memories: SharedMemories,
    sim_state: SimulatorState,
    session_id: str = "",
    max_iterations: int = 10,
    observer=None,
    log_llm_call_fn=None,
) -> dict:
    """Run the simulator agent to build/improve a game simulation.

    The simulator does NOT take game actions. It only analyzes observed
    transitions and writes prediction code.

    Returns:
        {
            "code": str,           # current simulation code
            "accuracy": float,     # accuracy on observed transitions
            "iterations": int,     # iterations in this invocation
            "findings": list[str],
            "hypotheses": list[str],
            "llm_calls": int,
            "input_tokens": int,
            "output_tokens": int,
            "duration_ms": int,
            "request_actions": list[int] | None,  # if it needs more data
        }
    """
    model = cfg["reasoning"].get("simulator_model") or effective_model(cfg, "planner")
    # Simulator needs lots of output tokens for code generation
    sim_max_tokens = cfg["reasoning"].get("simulator_max_tokens", 8192)

    llm_calls = 0
    input_tokens = 0
    output_tokens = 0
    duration_ms = 0
    findings = []
    hypotheses = []
    request_actions = None
    iterations_this_run = 0

    observations = memories.observations

    if not observations:
        return {
            "code": sim_state.code,
            "accuracy": 0.0,
            "iterations": 0,
            "findings": ["No observations available yet"],
            "hypotheses": [],
            "llm_calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_ms": 0,
            "request_actions": None,
        }

    print(f"      [simulator] starting — {len(observations)} transitions, "
          f"previous accuracy={sim_state.accuracy:.0%}")

    if observer:
        observer.subagent_start("simulator", "build game simulation", max_iterations, 0)

    for iteration in range(max_iterations):
        # Test current code against observations
        if sim_state.code:
            accuracy, test_results = _test_simulation(sim_state.code, observations)
            sim_state.accuracy = accuracy
            sim_state.last_test_results = test_results
        else:
            accuracy = 0.0
            test_results = "(no simulation code yet)"

        # Early exit if perfect
        if accuracy == 1.0 and sim_state.iterations > 0:
            print(f"      [simulator] perfect accuracy after {sim_state.iterations} iterations")
            break

        # Build prompt
        transitions_text = _format_transitions(observations, max_show=20)
        prompt = SIMULATOR_SYSTEM + "\n\n" + SIMULATOR_TURN_TEMPLATE.format(
            num_transitions=len(observations),
            transitions_text=transitions_text,
            previous_code=sim_state.code if sim_state.code else "(none yet)",
            test_results=test_results,
            memories=memories.format_for_prompt(max_observations=5),
        )

        # Override max_tokens for simulator (needs more room for code)
        sim_cfg = copy.deepcopy(cfg)
        sim_cfg["reasoning"]["max_tokens"] = sim_max_tokens

        result = call_model_with_metadata(
            model, prompt, sim_cfg, role="executor",
            tools_enabled=True, session_id=session_id,
            thinking_budget=16000,
        )
        llm_calls += 1
        input_tokens += result.input_tokens
        output_tokens += result.output_tokens
        duration_ms += result.duration_ms

        # Log LLM call
        if log_llm_call_fn:
            log_llm_call_fn(
                session_id, "simulator", model,
                input_json=prompt[:3000],
                output_json=(result.text or "")[:3000],
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                duration_ms=result.duration_ms,
                error=result.error,
            )

        if result.error or not result.text:
            print(f"      [simulator] LLM error: {result.error}")
            break

        parsed = _parse_simulator_response(result.text)
        if not parsed:
            print(f"      [simulator] failed to parse response")
            break

        command = parsed.get("command", "simulate")
        iterations_this_run += 1
        sim_state.iterations += 1

        if command == "simulate":
            code = parsed.get("code", "")
            if code:
                sim_state.code = code
                confidence = parsed.get("confidence", 0.0)
                reasoning = parsed.get("reasoning", "")
                print(f"      [simulator] iteration {sim_state.iterations}: "
                      f"submitted code (confidence={confidence:.0%})")
                print(f"        reasoning: {reasoning[:100]}")

                # Test immediately
                new_accuracy, new_results = _test_simulation(code, observations)
                sim_state.accuracy = new_accuracy
                sim_state.last_test_results = new_results
                print(f"        accuracy: {new_accuracy:.0%}")

                if new_accuracy == 1.0:
                    print(f"      [simulator] perfect accuracy achieved!")
                    findings.append(f"Simulator achieved 100% accuracy on {len(observations)} transitions")
                    break

        elif command == "request_data":
            request_actions = parsed.get("suggested_actions", [])
            reasoning = parsed.get("reasoning", "")
            print(f"      [simulator] requesting more data: {reasoning[:80]}")
            print(f"        suggested actions: {request_actions}")
            break

        elif command == "report":
            findings.extend(parsed.get("findings", []))
            hypotheses.extend(parsed.get("hypotheses", []))
            final_code = parsed.get("final_code", "")
            if final_code:
                sim_state.code = final_code
                new_accuracy, _ = _test_simulation(final_code, observations)
                sim_state.accuracy = new_accuracy
            print(f"      [simulator] reporting: {parsed.get('summary', '')[:80]}")
            break

    # Update totals
    sim_state.total_llm_calls += llm_calls
    sim_state.total_input_tokens += input_tokens
    sim_state.total_output_tokens += output_tokens
    sim_state.total_duration_ms += duration_ms
    sim_state.findings.extend(findings)

    # Add findings to memories
    for f in findings:
        memories.add_fact(f"[simulator] {f}")
    for h in hypotheses:
        memories.add_hypothesis(f"[simulator] {h}")
    if sim_state.code and sim_state.accuracy > 0:
        memories.add_to_stack(
            summary=f"Simulator: accuracy={sim_state.accuracy:.0%} on {len(observations)} transitions",
            details=f"Iterations: {sim_state.iterations}, code length: {len(sim_state.code)} chars",
            agent_type="simulator",
        )

    print(f"      [simulator] done — {iterations_this_run} iterations, "
          f"accuracy={sim_state.accuracy:.0%}, {llm_calls} calls")

    if observer:
        observer.subagent_report(
            "simulator", 0, llm_calls,
            findings=len(findings), hypotheses=len(hypotheses),
            summary=f"accuracy={sim_state.accuracy:.0%}",
        )

    return {
        "code": sim_state.code,
        "accuracy": sim_state.accuracy,
        "iterations": iterations_this_run,
        "findings": findings,
        "hypotheses": hypotheses,
        "llm_calls": llm_calls,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "duration_ms": duration_ms,
        "request_actions": request_actions,
    }
