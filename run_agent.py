#!/usr/bin/env python3
"""Standalone agent runner for agent_spawn_with_simulator.

Written from scratch — no batch_runner dependency.
Outputs to output/<timestamp>/ with JSON files matching the DB schema.

Usage:
    python run_agent.py --game ls20
    python run_agent.py --game ls20 --model gemini-2.5-flash --max-steps 50
    python run_agent.py --game ls20 --config my_config.yaml
"""

import argparse
import copy
import json
import os
import secrets
import sqlite3
import sys
import time
import zlib
from datetime import datetime
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import arc_agi
from arcengine import GameState

from agent import MODELS, effective_model

ROOT = Path(__file__).parent
OUTPUT_DIR = ROOT / "output"


# ═══════════════════════════════════════════════════════════════════════════
# OUTPUT MANAGER — writes session data to output/<timestamp>/
# ═══════════════════════════════════════════════════════════════════════════

class SessionOutput:
    """Manages output files for a single agent run session.

    Directory layout:
        output/<timestamp>/
            meta.json          — session metadata
            actions.jsonl      — one line per game action
            llm_calls.jsonl    — one line per LLM call
            simulator.json     — final simulator state (code + accuracy)
            memory.json        — final memory dump
            session.db         — SQLite DB matching server schema
    """

    def __init__(self, session_id: str, game_id: str, model: str):
        self.session_id = session_id
        self.game_id = game_id
        self.model = model
        self.start_time = time.time()

        # Create output directory with timestamp
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_dir = OUTPUT_DIR / f"{ts}_{game_id}_{session_id[:8]}"
        self.run_dir.mkdir(parents=True, exist_ok=True)

        # File paths
        self.meta_path = self.run_dir / "meta.json"
        self.actions_path = self.run_dir / "actions.jsonl"
        self.calls_path = self.run_dir / "llm_calls.jsonl"
        self.sim_path = self.run_dir / "simulator.json"
        self.memory_path = self.run_dir / "memory.json"
        self.db_path = self.run_dir / "session.db"

        # Initialize JSONL files
        self.actions_path.write_text("")
        self.calls_path.write_text("")

        # Initialize SQLite DB
        self._init_db()

        # Write initial metadata
        self._write_meta(result="RUNNING", steps=0, levels=0)

        print(f"  Output dir: {self.run_dir}")

    def _init_db(self):
        """Create SQLite DB with same schema as server."""
        conn = sqlite3.connect(str(self.db_path))
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                game_id TEXT,
                mode TEXT DEFAULT 'agent',
                created_at REAL,
                user_id TEXT,
                player_type TEXT DEFAULT 'agent',
                scaffolding_json TEXT,
                model TEXT,
                result TEXT,
                steps INTEGER DEFAULT 0,
                levels INTEGER DEFAULT 0,
                parent_session_id TEXT,
                branch_at_step INTEGER,
                duration_seconds REAL
            );
            CREATE TABLE IF NOT EXISTS session_actions (
                session_id TEXT,
                step_num INTEGER,
                action INTEGER,
                row INTEGER,
                col INTEGER,
                author_id TEXT,
                author_type TEXT DEFAULT 'agent',
                call_id INTEGER,
                states_json TEXT,
                timestamp REAL,
                PRIMARY KEY (session_id, step_num)
            );
            CREATE TABLE IF NOT EXISTS llm_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                agent_type TEXT,
                agent_id TEXT,
                step_num INTEGER,
                turn_num INTEGER,
                parent_call_id INTEGER,
                model TEXT,
                input_json TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_json TEXT,
                output_tokens INTEGER DEFAULT 0,
                thinking_tokens INTEGER DEFAULT 0,
                thinking_json TEXT,
                cost REAL DEFAULT 0,
                duration_ms INTEGER DEFAULT 0,
                error TEXT,
                timestamp REAL
            );
        """)
        conn.execute(
            "INSERT INTO sessions (id, game_id, mode, created_at, model) VALUES (?, ?, ?, ?, ?)",
            (self.session_id, self.game_id, "agent_spawn_sim", time.time(), self.model),
        )
        conn.commit()
        conn.close()

    def _write_meta(self, **kwargs):
        """Write/update meta.json."""
        meta = {
            "session_id": self.session_id,
            "game_id": self.game_id,
            "model": self.model,
            "scaffolding": "agent_spawn_with_simulator",
            "started_at": datetime.fromtimestamp(self.start_time).isoformat(),
            "elapsed_seconds": round(time.time() - self.start_time, 1),
            **kwargs,
        }
        self.meta_path.write_text(json.dumps(meta, indent=2) + "\n")

    def _compress_grid(self, grid: list) -> str:
        """Compress grid data for storage (same as db.py)."""
        raw = json.dumps(grid).encode()
        return zlib.compress(raw).hex()

    def log_action(self, step_num: int, action: int, grid: list,
                   llm_response: dict, state: str, levels: int,
                   row: int | None = None, col: int | None = None):
        """Log a game action to actions.jsonl and SQLite."""
        compressed = self._compress_grid(grid)
        states_json = json.dumps([{"grid": compressed}])

        # JSONL
        entry = {
            "step_num": step_num,
            "action": action,
            "state": state,
            "levels": levels,
            "reasoning": llm_response.get("reasoning", ""),
            "observation": llm_response.get("observation", ""),
            "timestamp": time.time(),
        }
        with open(self.actions_path, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")

        # SQLite
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.execute(
                "INSERT OR REPLACE INTO session_actions "
                "(session_id, step_num, action, row, col, author_type, states_json, timestamp) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (self.session_id, step_num, action, row, col, "agent", states_json, time.time()),
            )
            conn.execute(
                "UPDATE sessions SET steps = ?, levels = ? WHERE id = ?",
                (step_num, levels, self.session_id),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"  [output] DB action error: {e}")

    def log_llm_call(self, session_id: str, agent_type: str, model: str, *,
                     input_json: str | None = None,
                     output_json: str | None = None,
                     input_tokens: int = 0,
                     output_tokens: int = 0,
                     thinking_tokens: int = 0,
                     thinking_json: str | None = None,
                     cost: float = 0,
                     duration_ms: int = 0,
                     error: str | None = None,
                     **kwargs):
        """Log an LLM call to llm_calls.jsonl and SQLite."""
        # JSONL
        entry = {
            "agent_type": agent_type,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "thinking_tokens": thinking_tokens,
            "cost": round(cost, 6),
            "duration_ms": duration_ms,
            "error": error,
            "timestamp": time.time(),
        }
        with open(self.calls_path, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")

        # SQLite
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.execute(
                "INSERT INTO llm_calls "
                "(session_id, agent_type, model, input_json, input_tokens, "
                "output_json, output_tokens, thinking_tokens, thinking_json, "
                "cost, duration_ms, error, timestamp) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, agent_type, model, input_json, input_tokens,
                 output_json, output_tokens, thinking_tokens, thinking_json,
                 cost, duration_ms, error, time.time()),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"  [output] DB call error: {e}")

    def save_simulator(self, sim_state):
        """Save simulator state."""
        data = {
            "code": sim_state.code,
            "accuracy": sim_state.accuracy,
            "iterations": sim_state.iterations,
            "total_llm_calls": sim_state.total_llm_calls,
            "total_input_tokens": sim_state.total_input_tokens,
            "total_output_tokens": sim_state.total_output_tokens,
            "findings": sim_state.findings,
            "last_test_results": sim_state.last_test_results,
        }
        self.sim_path.write_text(json.dumps(data, indent=2) + "\n")

    def save_memory(self, memories):
        """Save final memory state."""
        data = {
            "facts": memories.facts,
            "hypotheses": memories.hypotheses,
            "observations": [
                {k: v for k, v in obs.items() if k not in ("grid_before", "grid_after")}
                for obs in memories.observations
            ],
            "action_log": memories.action_log,
            "stack": memories.stack,
        }
        self.memory_path.write_text(json.dumps(data, indent=2, default=str) + "\n")

    def finalize(self, result: str, steps: int, levels: int,
                 total_llm_calls: int, total_input_tokens: int,
                 total_output_tokens: int):
        """Write final metadata and update DB."""
        elapsed = round(time.time() - self.start_time, 1)
        self._write_meta(
            result=result,
            steps=steps,
            levels=levels,
            total_llm_calls=total_llm_calls,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            elapsed_seconds=elapsed,
        )
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.execute(
                "UPDATE sessions SET result = ?, steps = ?, levels = ?, "
                "duration_seconds = ? WHERE id = ?",
                (result, steps, levels, elapsed, self.session_id),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"  [output] DB finalize error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# STEP CALLBACK — bridges game loop to SessionOutput
# ═══════════════════════════════════════════════════════════════════════════

def make_step_callback(output: SessionOutput):
    """Create a step_callback function for the game loop."""
    def callback(session_id: str, step_num: int, action: int,
                 data: dict | None, grid: list, llm_response: dict,
                 state: str, levels: int, **kwargs):
        row = data.get("y") if data else None
        col = data.get("x") if data else None
        output.log_action(
            step_num=step_num,
            action=action,
            grid=grid,
            llm_response=llm_response,
            state=state,
            levels=levels,
            row=row,
            col=col,
        )
    return callback


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def load_config(config_path: str | None = None) -> dict:
    """Load config from YAML file."""
    path = Path(config_path) if config_path else ROOT / "config.yaml"
    if not path.exists():
        print(f"Config not found: {path}")
        sys.exit(1)
    with open(path) as f:
        return yaml.safe_load(f)


def main():
    parser = argparse.ArgumentParser(description="Run agent_spawn_with_simulator on a game")
    parser.add_argument("--game", required=True, help="Game ID (e.g., ls20) or 'all'")
    parser.add_argument("--model", help="Override executor/planner model")
    parser.add_argument("--max-steps", type=int, default=200, help="Max game steps (default: 200)")
    parser.add_argument("--config", help="Config YAML path (default: config.yaml)")
    parser.add_argument("--obs", action="store_true", help="Enable observability output")
    args = parser.parse_args()

    cfg = load_config(args.config)

    # Apply model override
    if args.model:
        cfg["reasoning"]["executor_model"] = args.model
        if not cfg["reasoning"].get("planner_model"):
            cfg["reasoning"]["planner_model"] = args.model

    # Force scaffolding mode
    cfg.setdefault("scaffolding", {})["mode"] = "agent_spawn_with_simulator"

    # Enable observability if requested
    if args.obs:
        cfg["observability"] = True

    # Validate model
    exec_model = effective_model(cfg, "executor")
    if exec_model not in MODELS:
        print(f"Unknown model: {exec_model}")
        print(f"Available: {', '.join(sorted(MODELS.keys()))}")
        sys.exit(1)

    info = MODELS[exec_model]
    if info.get("env_key") and not os.environ.get(info["env_key"]):
        print(f"ERROR: {info['env_key']} not set in .env")
        sys.exit(1)

    # Initialize arcade
    arcade = arc_agi.Arcade()
    available_games = [e.game_id for e in arcade.get_environments()]

    # Resolve game IDs
    if args.game == "all":
        games = available_games
    else:
        game_ids = [g.strip() for g in args.game.split(",")]
        games = []
        for gid in game_ids:
            if gid in available_games:
                games.append(gid)
            else:
                matches = [g for g in available_games if g.startswith(gid)]
                if matches:
                    games.append(matches[0])
                else:
                    print(f"Unknown game: {gid} (available: {', '.join(available_games[:10])}...)")
                    sys.exit(1)

    planner_model = effective_model(cfg, "planner")

    print(f"\n{'#'*65}")
    print(f"  Agent Spawn + Simulator Runner")
    print(f"  Model   : {exec_model}")
    print(f"  Planner : {planner_model}")
    print(f"  Games   : {', '.join(games)}")
    print(f"  Max steps: {args.max_steps}")
    print(f"  Output  : {OUTPUT_DIR}/")
    print(f"{'#'*65}\n")

    # Import game loop
    from scaffoldings.agent_spawn_with_simulator.game_loop import play_game_agent_spawn_sim

    results = {}
    for game_id in games:
        session_id = f"sim-{secrets.token_hex(8)}"

        # Create output manager
        output = SessionOutput(session_id, game_id, planner_model)

        # Run game
        t0 = time.time()
        try:
            result = play_game_agent_spawn_sim(
                arcade, game_id, cfg, args.max_steps,
                session_id=session_id,
                step_callback=make_step_callback(output),
                log_llm_call_fn=output.log_llm_call,
            )
        except KeyboardInterrupt:
            result = "INTERRUPTED"
            print(f"\n  [interrupted] {game_id}")
        except Exception as e:
            result = "ERROR"
            print(f"\n  [error] {game_id}: {e}")
            import traceback
            traceback.print_exc()

        elapsed = time.time() - t0

        # Read final stats from the session DB
        final_steps = 0
        final_levels = 0
        final_calls = 0
        final_in_tokens = 0
        final_out_tokens = 0
        try:
            import sqlite3 as _sq
            _conn = _sq.connect(str(output.db_path))
            _conn.row_factory = _sq.Row
            _r = _conn.execute(
                "SELECT COUNT(*) as c FROM session_actions WHERE session_id = ?",
                (session_id,)
            ).fetchone()
            final_steps = _r["c"] if _r else 0
            _r2 = _conn.execute(
                "SELECT COUNT(*) as c, COALESCE(SUM(input_tokens),0) as it, "
                "COALESCE(SUM(output_tokens),0) as ot FROM llm_calls WHERE session_id = ?",
                (session_id,)
            ).fetchone()
            if _r2:
                final_calls = _r2["c"]
                final_in_tokens = _r2["it"]
                final_out_tokens = _r2["ot"]
            _conn.close()
        except Exception:
            pass

        output.finalize(
            result=result,
            steps=final_steps,
            levels=final_levels,
            total_llm_calls=final_calls,
            total_input_tokens=final_in_tokens,
            total_output_tokens=final_out_tokens,
        )

        results[game_id] = result
        print(f"\n  {game_id}: {result} ({elapsed:.1f}s)")
        print(f"  Output: {output.run_dir}\n")

    # Summary
    print(f"\n{'='*65}")
    print("  RESULTS")
    print(f"{'='*65}")
    for gid, res in results.items():
        print(f"  {gid:15s} -> {res}")
    print(f"\n  Scorecard: {arcade.get_scorecard()}\n")


if __name__ == "__main__":
    main()
