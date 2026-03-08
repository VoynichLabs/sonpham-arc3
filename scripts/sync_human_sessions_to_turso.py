#!/usr/bin/env python3
"""Sync human sessions from local SQLite to Turso.

Used by the pre-push git hook and can also be run standalone.
Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from .env if not already set.
"""
import os
import sys
import json
import time
import sqlite3
import zlib
import base64

# Load .env if env vars not set
if not os.environ.get("TURSO_DATABASE_URL"):
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sessions.db")


def get_local_db():
    if not os.path.exists(DB_PATH):
        print(f"[turso-sync] Local DB not found at {DB_PATH}")
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_turso_db():
    if not TURSO_DATABASE_URL or not TURSO_AUTH_TOKEN:
        print("[turso-sync] TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not set, skipping")
        return None
    try:
        import libsql_experimental as libsql
        conn = libsql.connect("turso_replica.db", sync_url=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
        conn.sync()
        return conn
    except ImportError:
        print("[turso-sync] libsql_experimental not installed, skipping")
        return None
    except Exception as e:
        print(f"[turso-sync] Failed to connect to Turso: {e}")
        return None


def sync_human_sessions():
    local = get_local_db()
    if not local:
        return

    # Find human sessions with >= 1 step
    rows = local.execute(
        """SELECT s.id, s.game_id, s.model, s.mode, s.created_at, s.result,
                  s.steps, s.levels, s.player_type, s.duration_seconds, s.user_id,
                  s.parent_session_id, s.branch_at_step, s.prompts_json, s.timeline_json
           FROM sessions s
           WHERE s.player_type = 'human' AND s.steps >= 1
           ORDER BY s.created_at DESC"""
    ).fetchall()

    if not rows:
        print("[turso-sync] No human sessions to sync")
        local.close()
        return

    turso = get_turso_db()
    if not turso:
        local.close()
        return

    synced = 0
    for row in rows:
        sid = row["id"]
        try:
            # Upsert session
            turso.execute(
                """INSERT INTO sessions (id, game_id, model, mode, created_at, result, steps, levels,
                                         parent_session_id, branch_at_step, prompts_json, timeline_json,
                                         user_id, player_type, duration_seconds)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     result = excluded.result, steps = excluded.steps, levels = excluded.levels,
                     user_id = COALESCE(excluded.user_id, sessions.user_id),
                     player_type = COALESCE(excluded.player_type, sessions.player_type),
                     duration_seconds = COALESCE(excluded.duration_seconds, sessions.duration_seconds)""",
                (sid, row["game_id"], row["model"] or "", row["mode"] or "local",
                 row["created_at"], row["result"], row["steps"], row["levels"],
                 row["parent_session_id"], row["branch_at_step"],
                 row["prompts_json"], row["timeline_json"],
                 row["user_id"], "human", row["duration_seconds"]),
            )

            # Upsert steps
            steps = local.execute(
                "SELECT * FROM session_steps WHERE session_id = ? ORDER BY step_num",
                (sid,)
            ).fetchall()
            for s in steps:
                turso.execute(
                    """INSERT OR REPLACE INTO session_steps
                       (session_id, step_num, action, data_json, grid_snapshot,
                        change_map_json, llm_response_json, timestamp)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (sid, s["step_num"], s["action"], s["data_json"],
                     s["grid_snapshot"], None, None, s["timestamp"]),
                )
            turso.commit()
            synced += 1
        except Exception as e:
            print(f"[turso-sync] Failed to sync session {sid}: {e}")

    local.close()
    print(f"[turso-sync] Synced {synced}/{len(rows)} human sessions to Turso")


if __name__ == "__main__":
    sync_human_sessions()
