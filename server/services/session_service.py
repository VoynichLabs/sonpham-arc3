"""Session service layer — Session management and orchestration.

Session branching, import/export, and user session association.
Pure business logic — no Flask request/response objects.
"""

import copy
import json
import logging
import time

from db_auth import get_user_sessions, claim_sessions
from db import _get_db, _compress_grid, _decompress_grid
from db_memory import get_session_memory_snapshots, bulk_save_memory_snapshots
from session_manager import (
    game_sessions, session_grids, session_snapshots, session_lock,
    session_step_counts, _reconstruct_session, _action_dict_from_row, _try_recover_session
)

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


def import_session(sess: dict, steps: list, user_id: str = None, mode: str = "online") -> tuple[dict, str]:
    """Import/upsert a session and its steps. Returns (response_dict, error_msg).
    
    Args:
        sess: session metadata dict (id, game_id, model, result, steps, levels, etc.)
        steps: list of step dicts (action, data, grid, llm_response, timestamp, etc.)
        user_id: authenticated user ID (optional)
        mode: server mode (staging/prod)
    """
    if not sess or not sess.get("id") or not sess.get("game_id"):
        return {}, "session.id and session.game_id required"
    
    # Reject trivially short agent sessions (human sessions always saved)
    is_human = sess.get("player_type") == "human"
    if not is_human and len(steps) < 5:
        return {"skipped": True}, "Session too short (min 5 steps)"
    
    try:
        scaffolding_json = json.dumps(sess.get("prompts") or sess.get("scaffolding")) \
            if (sess.get("prompts") or sess.get("scaffolding")) else None
        
        # Tag with authenticated user if present
        if user_id:
            sess["user_id"] = user_id
        
        conn = _get_db()
        conn.execute(
            """INSERT INTO sessions (id, game_id, model, mode, created_at, result, steps, levels,
                                     parent_session_id, branch_at_step, scaffolding_json,
                                     user_id, player_type, duration_seconds, live_mode, live_fps,
                                     game_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 result = excluded.result, steps = excluded.steps, levels = excluded.levels,
                 model = COALESCE(excluded.model, sessions.model),
                 scaffolding_json = COALESCE(excluded.scaffolding_json, sessions.scaffolding_json),
                 user_id = COALESCE(excluded.user_id, sessions.user_id),
                 player_type = COALESCE(excluded.player_type, sessions.player_type),
                 duration_seconds = COALESCE(excluded.duration_seconds, sessions.duration_seconds),
                 live_mode = COALESCE(excluded.live_mode, sessions.live_mode),
                 live_fps = COALESCE(excluded.live_fps, sessions.live_fps),
                 game_version = COALESCE(excluded.game_version, sessions.game_version)""",
            (sess["id"], sess["game_id"], sess.get("model", ""),
             mode, sess.get("created_at", time.time()),
             sess.get("result", "NOT_FINISHED"), sess.get("steps", 0),
             sess.get("levels", 0), sess.get("parent_session_id"),
             sess.get("branch_at_step"), scaffolding_json, user_id,
             sess.get("player_type", "agent"), sess.get("duration_seconds"),
             1 if sess.get("live_mode") else 0,
             sess.get("live_fps"),
             sess.get("game_version")),
        )
        log.info(f"[import] session={sess['id'][:30]} steps={len(steps)}")
        
        # Insert step actions
        for s in steps:
            states_json = None
            if s.get("grid"):
                states_json = json.dumps([{"grid": _compress_grid(s["grid"])}])
            sdata = s.get("data") or {}
            act_row = sdata.get("y") if isinstance(sdata, dict) else None
            act_col = sdata.get("x") if isinstance(sdata, dict) else None
            author_type = s.get("author_type") or ("agent" if s.get("llm_response") else None)
            conn.execute(
                """INSERT OR REPLACE INTO session_actions
                   (session_id, step_num, action, row, col,
                    author_type, states_json, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (sess["id"], s.get("step_num", 0), s.get("action", 0),
                 act_row, act_col, author_type,
                 states_json,
                 s.get("timestamp", time.time())),
            )
        
        # Extract timeline events into llm_calls rows
        conn.execute("DELETE FROM llm_calls WHERE session_id = ?", (sess["id"],))
        calls_imported = 0
        timeline = sess.get("timeline") or []
        if isinstance(timeline, str):
            try:
                timeline = json.loads(timeline)
            except Exception:
                timeline = []
        
        # Build step_num→timestamp lookup
        step_ts = {}
        for s in steps:
            sn = s.get("step_num")
            if sn is not None:
                step_ts[sn] = s.get("timestamp", 0)
        
        # Map timeline events to llm_calls
        for ev in timeline:
            etype = ev.get("type", "")
            if etype in ("reasoning", "compact", "interrupt"):
                agent_type = ev.get("call_type", etype)
            elif etype.startswith("as_"):
                agent_type = etype
            else:
                continue
            
            ts = ev.get("timestamp") or 0
            if not ts:
                step_num = ev.get("stepStart") or ev.get("step_num")
                if step_num and step_num in step_ts:
                    ts = step_ts[step_num]
            if not ts:
                ts = sess.get("created_at", time.time())
            
            input_data = (ev.get("task") or "")[:500]
            output_preview = (ev.get("response_preview") or ev.get("response")
                              or ev.get("reasoning") or ev.get("summary") or "")
            if len(output_preview) > 1000:
                output_preview = output_preview[:1000]
            
            conn.execute(
                """INSERT OR IGNORE INTO llm_calls
                   (session_id, agent_type, step_num, turn_num, model,
                    input_json, input_tokens, output_json, output_tokens,
                    cost, duration_ms, error, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (sess["id"], agent_type,
                 ev.get("stepStart") or ev.get("step_num"),
                 ev.get("turn") or ev.get("parentTurn"),
                 ev.get("model", ""),
                 json.dumps(input_data) if input_data else None,
                 ev.get("input_tokens", 0),
                 json.dumps(output_preview) if output_preview else None,
                 ev.get("output_tokens", 0),
                 ev.get("cost", 0),
                 ev.get("duration") or ev.get("duration_ms") or 0,
                 ev.get("error"), ts),
            )
            calls_imported += 1
        
        conn.commit()
        conn.close()

        # Import memory snapshots if provided
        memory_snaps = sess.get("memory_snapshots") or []
        snaps_imported = 0
        if memory_snaps:
            snaps_imported = bulk_save_memory_snapshots(sess["id"], memory_snaps)

        return {
            "status": "ok", "session_id": sess["id"],
            "steps_imported": len(steps), "calls_imported": calls_imported,
            "memory_snapshots_imported": snaps_imported,
        }, ""
    except Exception as e:
        log.warning(f"Session import failed: {e}")
        return {}, str(e)


def resume(session_id: str, *, get_arcade_fn, env_state_dict_fn, format_action_row_fn) -> tuple[dict, str]:
    """Resume an unfinished session. Replays all steps and returns live state.

    Includes LLM call data attached to steps for reasoning log reconstruction,
    memory snapshots for inspection, and game version info.

    Args:
        session_id: session ID to resume
        get_arcade_fn: callable returning arcade instance
        env_state_dict_fn: callable(env, frame_data=None) returning state dict
        format_action_row_fn: callable(row_dict) formatting action for response

    Returns:
        (state_dict, error_msg)
    """
    try:
        conn = _get_db()
        sess = conn.execute(
            "SELECT game_id, model, parent_session_id, branch_at_step, game_version, scaffolding_json FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if sess:
            sess = dict(sess)

        parent_rows = []
        own_rows = []
        llm_calls = []

        if sess:
            if sess.get("parent_session_id") and sess.get("branch_at_step") is not None:
                parent_rows = conn.execute(
                    "SELECT * FROM session_actions WHERE session_id = ? AND step_num <= ? ORDER BY step_num",
                    (sess["parent_session_id"], sess["branch_at_step"]),
                ).fetchall()
            own_rows = conn.execute(
                "SELECT * FROM session_actions WHERE session_id = ? ORDER BY step_num",
                (session_id,),
            ).fetchall()
            # Fetch LLM calls for this session to reconstruct reasoning
            llm_calls = conn.execute(
                "SELECT * FROM llm_calls WHERE session_id = ? ORDER BY timestamp",
                (session_id,),
            ).fetchall()
            # Also fetch parent LLM calls if branched
            if sess.get("parent_session_id"):
                parent_calls = conn.execute(
                    "SELECT * FROM llm_calls WHERE session_id = ? ORDER BY timestamp",
                    (sess["parent_session_id"],),
                ).fetchall()
                llm_calls = list(parent_calls) + list(llm_calls)
        conn.close()

        if not sess:
            return {}, "Session not found"
    except Exception as e:
        return {}, f"DB error: {e}"

    all_rows = list(parent_rows) + list(own_rows)
    actions = [_action_dict_from_row(dict(r)) for r in all_rows]
    total_steps = len(actions)

    try:
        env, state, per_step_states = _reconstruct_session(
            sess["game_id"], actions, capture_per_step=True,
            get_arcade_fn=get_arcade_fn,
            env_state_dict_fn=env_state_dict_fn,
        )
    except Exception as e:
        return {}, f"Failed to reconstruct session: {e}"

    with session_lock:
        game_sessions[session_id] = env
        session_grids[session_id] = state.get("grid", [])
        session_snapshots[session_id] = []
        session_step_counts[session_id] = len(actions)

    state["session_id"] = session_id
    state["change_map"] = {"changes": [], "change_count": 0, "change_map_text": "(resumed)"}
    state["resumed_step_count"] = total_steps
    state["total_steps"] = total_steps

    step_list = [format_action_row_fn(dict(r)) for r in all_rows]

    # Build step_num → llm_call mapping for reasoning reconstruction
    calls_by_step = {}
    for c in llm_calls:
        cd = dict(c)
        sn = cd.get("step_num")
        if sn is not None:
            if sn not in calls_by_step:
                calls_by_step[sn] = []
            calls_by_step[sn].append(cd)

    for i, s in enumerate(step_list):
        if i < len(per_step_states):
            s["result_state"] = per_step_states[i]["state"]
            s["levels_completed"] = per_step_states[i]["levels_completed"]

        # Attach LLM response data from llm_calls table if not already present
        sn = s.get("step_num")
        if sn is not None and sn in calls_by_step and not s.get("llm_response"):
            calls = calls_by_step[sn]
            primary = calls[0]  # First call at this step is the primary
            # Parse output_json to reconstruct llm_response
            output = None
            if primary.get("output_json"):
                try:
                    output = json.loads(primary["output_json"])
                except Exception:
                    output = primary["output_json"]

            # Build llm_response compatible with client-side rendering
            llm_resp = {
                "parsed": {
                    "observation": f"[{primary.get('agent_type', 'agent')}] {output if isinstance(output, str) else ''}",
                    "reasoning": output if isinstance(output, str) else json.dumps(output)[:500] if output else "",
                    "action": s.get("action", 0),
                },
                "model": primary.get("model", ""),
                "agent_type": primary.get("agent_type", "executor"),
                "usage": {
                    "input_tokens": primary.get("input_tokens", 0),
                    "output_tokens": primary.get("output_tokens", 0),
                },
                "call_duration_ms": primary.get("duration_ms", 0),
            }
            # If there's thinking data, include it
            if primary.get("thinking_json"):
                try:
                    llm_resp["thinking"] = json.loads(primary["thinking_json"])
                except Exception:
                    llm_resp["thinking"] = primary["thinking_json"]

            # Attach sub-calls if multiple calls at same step
            if len(calls) > 1:
                llm_resp["sub_calls"] = [
                    {
                        "type": sc.get("agent_type", "sub"),
                        "agent_id": sc.get("agent_id"),
                        "model": sc.get("model", ""),
                        "duration_ms": sc.get("duration_ms", 0),
                        "input_tokens": sc.get("input_tokens", 0),
                        "output_tokens": sc.get("output_tokens", 0),
                    }
                    for sc in calls[1:]
                ]

            s["llm_response"] = llm_resp

    state["steps"] = step_list
    state["model"] = sess["model"] or ""
    state["game_version"] = sess.get("game_version") or ""

    # Include memory snapshots for inspection
    memory_snapshots = get_session_memory_snapshots(session_id)
    if memory_snapshots:
        state["memory_snapshots"] = memory_snapshots

    return state, ""


def branch(parent_id: str, step_num: int, mode: str = "staging",
           *, get_arcade_fn, env_state_dict_fn, format_action_row_fn) -> tuple[dict, str]:
    """Branch a session at a given step. Creates a new live session from that point.
    
    Args:
        parent_id: parent session ID
        step_num: step number to branch from
        mode: server mode (staging/prod)
        get_arcade_fn, env_state_dict_fn, format_action_row_fn: helper callables
    
    Returns:
        (state_dict, error_msg)
    """
    try:
        conn = _get_db()
        sess = conn.execute("SELECT game_id FROM sessions WHERE id = ?", (parent_id,)).fetchone()
        if not sess:
            conn.close()
            return {}, "Parent session not found"
        
        action_rows = conn.execute(
            "SELECT * FROM session_actions WHERE session_id = ? AND step_num <= ? ORDER BY step_num",
            (parent_id, step_num),
        ).fetchall()
        conn.close()
        
        actions = [_action_dict_from_row(dict(r)) for r in action_rows]
        env, state, per_step_states = _reconstruct_session(
            sess["game_id"], actions, capture_per_step=True,
            get_arcade_fn=get_arcade_fn,
            env_state_dict_fn=env_state_dict_fn,
        )
        
        import secrets
        new_session_id = env._guid if hasattr(env, "_guid") else secrets.token_hex(16)
        with session_lock:
            game_sessions[new_session_id] = env
            session_grids[new_session_id] = state.get("grid", [])
            session_snapshots[new_session_id] = []
            session_step_counts[new_session_id] = len(actions)
        
        conn = _get_db()
        conn.execute(
            """INSERT INTO sessions (id, game_id, mode, created_at, result, steps, levels,
                                     parent_session_id, branch_at_step)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (new_session_id, sess["game_id"], mode, time.time(),
             "NOT_FINISHED", len(actions), state.get("levels_completed", 0),
             parent_id, step_num),
        )
        conn.commit()
        conn.close()
        
        state["session_id"] = new_session_id
        state["parent_session_id"] = parent_id
        state["branch_at_step"] = step_num
        state["change_map"] = {"changes": [], "change_count": 0, "change_map_text": "(branch)"}
        
        step_list = [format_action_row_fn(dict(r)) for r in action_rows]
        for i, s in enumerate(step_list):
            if i < len(per_step_states):
                s["result_state"] = per_step_states[i]["state"]
                s["levels_completed"] = per_step_states[i]["levels_completed"]
        state["steps"] = step_list
        
        return state, ""
    except Exception as e:
        log.warning(f"Session branch failed: {e}")
        return {}, str(e)


def obs_events_handle_post(cursor: int, events: list) -> tuple[dict, str]:
    """Handle POST to obs_events (backward compat — obs_events table removed).
    
    Args:
        cursor: cursor value from request
        events: list of event objects
    
    Returns:
        (response_dict, error_msg)
    """
    # obs_events table removed — accept POST for backward compat but don't store
    return {"ok": True, "cursor": cursor + len(events)}, ""


def obs_events_get(session_id: str) -> tuple[dict, str]:
    """Reconstruct obs events for replay from llm_calls + session_actions.
    
    Args:
        session_id: session ID
    
    Returns:
        ({"events": [...]}, error_msg)
    """
    try:
        conn = _get_db()
        calls = conn.execute(
            "SELECT * FROM llm_calls WHERE session_id = ? ORDER BY timestamp",
            (session_id,),
        ).fetchall()
        action_rows = conn.execute(
            "SELECT * FROM session_actions WHERE session_id = ? ORDER BY step_num",
            (session_id,),
        ).fetchall()
        conn.close()

        from arcengine import GameAction
        
        raw_events = []
        for c in [dict(c) for c in calls]:
            raw_events.append({
                "ts": c.get("timestamp", 0),
                "agent": c.get("agent_type", "planner"),
                "event": "llm_call",
                "model": c.get("model", ""),
                "input_tokens": c.get("input_tokens", 0),
                "output_tokens": c.get("output_tokens", 0),
                "cost": c.get("cost", 0),
                "duration_ms": c.get("duration_ms", 0),
                "step_num": c.get("step_num"),
                "turn_num": c.get("turn_num"),
                "response": (c.get("output_json") or "")[:1000],
            })
        for s in [dict(s) for s in action_rows]:
            grid = None
            if s.get("states_json"):
                try:
                    states = json.loads(s["states_json"])
                    if states and isinstance(states, list) and states[0].get("grid"):
                        grid = _decompress_grid(states[0]["grid"])
                except Exception:
                    pass
            action_id = s.get("action", 0)
            try:
                action_name = GameAction.from_id(int(action_id)).name
            except Exception:
                action_name = str(action_id)
            if s.get("row") is not None and s.get("col") is not None:
                action_name = f"{action_name}@({s['col']},{s['row']})"
            raw_events.append({
                "ts": s.get("timestamp", 0),
                "agent": "executor",
                "event": "act",
                "action": action_name,
                "step_num": s.get("step_num", 0),
                "grid": grid,
            })

        if not raw_events:
            return {"events": []}, ""

        raw_events.sort(key=lambda e: e.get("ts", 0))
        t0 = raw_events[0]["ts"]
        from datetime import datetime, timezone
        events = []
        for ev in raw_events:
            ts = ev.pop("ts", 0)
            ev["t"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            ev["elapsed_s"] = round(ts - t0, 2)
            events.append(ev)

        return {"events": events}, ""
    except Exception as e:
        log.warning(f"GET obs-events failed: {e}")
        return {}, str(e)
