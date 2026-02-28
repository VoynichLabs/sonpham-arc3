"""ARC-AGI-3 Database Layer — SQLite + Turso persistence."""

import base64
import json
import logging
import os
import secrets
import sqlite3
import time
import uuid
import zlib
from pathlib import Path

try:
    import libsql_experimental as libsql
except ImportError:
    libsql = None

log = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# LOCAL SQLite
# ═══════════════════════════════════════════════════════════════════════════

DB_PATH = Path(__file__).parent / "data" / "sessions.db"


def _init_db():
    """Create the sessions database and tables if they don't exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL,
            model TEXT DEFAULT '',
            mode TEXT DEFAULT 'local',
            created_at REAL NOT NULL,
            result TEXT DEFAULT 'NOT_FINISHED',
            steps INTEGER DEFAULT 0,
            levels INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS session_steps (
            session_id TEXT NOT NULL,
            step_num INTEGER NOT NULL,
            action INTEGER NOT NULL,
            data_json TEXT DEFAULT '{}',
            grid_snapshot TEXT,
            change_map_json TEXT,
            llm_response_json TEXT,
            timestamp REAL NOT NULL,
            PRIMARY KEY (session_id, step_num),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
    """)
    # Schema migration: add columns (idempotent)
    for col, defn in [("parent_session_id", "TEXT DEFAULT NULL"),
                      ("branch_at_step", "INTEGER DEFAULT NULL"),
                      ("total_cost", "REAL DEFAULT 0"),
                      ("prompts_json", "TEXT DEFAULT NULL"),
                      ("timeline_json", "TEXT DEFAULT NULL"),
                      ("user_id", "TEXT DEFAULT NULL")]:
        try:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass  # column already exists
    # Session events table (compaction, branch, resume tracking)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS session_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            step_num INTEGER,
            data_json TEXT DEFAULT '{}',
            timestamp REAL NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
    """)
    # LLM call log table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS llm_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            call_type TEXT NOT NULL,
            step_num INTEGER,
            parent_call_id INTEGER,
            model TEXT NOT NULL,
            prompt_preview TEXT,
            prompt_length INTEGER,
            response_preview TEXT,
            response_json TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            thinking_level TEXT,
            tools_active INTEGER DEFAULT 0,
            cache_active INTEGER DEFAULT 0,
            error TEXT,
            attempt INTEGER DEFAULT 0,
            timestamp REAL NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
    """)
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id)")
    except sqlite3.OperationalError:
        pass
    # Batch tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS batch_runs (
            id TEXT PRIMARY KEY,
            created_at REAL NOT NULL,
            config_json TEXT,
            status TEXT DEFAULT 'running',
            total_games INTEGER DEFAULT 0,
            completed_games INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            failures INTEGER DEFAULT 0,
            finished_at REAL
        );
        CREATE TABLE IF NOT EXISTS batch_games (
            batch_id TEXT NOT NULL,
            game_id TEXT NOT NULL,
            session_id TEXT,
            status TEXT DEFAULT 'pending',
            result TEXT,
            steps INTEGER DEFAULT 0,
            levels INTEGER DEFAULT 0,
            started_at REAL,
            finished_at REAL,
            error TEXT,
            PRIMARY KEY (batch_id, game_id)
        );
    """)
    conn.commit()
    conn.close()


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _compress_grid(grid: list) -> str:
    """Compress a grid to zlib+base64 for storage."""
    raw = json.dumps(grid).encode()
    return base64.b64encode(zlib.compress(raw)).decode()


def _decompress_grid(data: str) -> list:
    """Decompress a zlib+base64 grid."""
    return json.loads(zlib.decompress(base64.b64decode(data)))


def _db_insert_session(session_id: str, game_id: str, mode: str):
    """Insert a new session record."""
    try:
        conn = _get_db()
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, game_id, mode, created_at) VALUES (?, ?, ?, ?)",
            (session_id, game_id, mode, time.time()),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.warning(f"DB insert session failed: {e}")


def _db_insert_step(session_id: str, step_num: int, action: int,
                     data: dict, grid: list, change_map: dict,
                     llm_response: dict | None = None):
    """Insert a step record with compressed grid."""
    try:
        conn = _get_db()
        conn.execute(
            "INSERT OR REPLACE INTO session_steps "
            "(session_id, step_num, action, data_json, grid_snapshot, change_map_json, llm_response_json, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session_id, step_num, action,
                json.dumps(data),
                _compress_grid(grid) if grid else None,
                json.dumps(change_map) if change_map else None,
                json.dumps(llm_response) if llm_response else None,
                time.time(),
            ),
        )
        conn.execute(
            "UPDATE sessions SET steps = ?, result = (SELECT result FROM sessions WHERE id = ?) WHERE id = ?",
            (step_num, session_id, session_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.warning(f"DB insert step failed: {e}")


def _db_update_session(session_id: str, **kwargs):
    """Update session fields."""
    try:
        conn = _get_db()
        sets = ", ".join(f"{k} = ?" for k in kwargs)
        conn.execute(f"UPDATE sessions SET {sets} WHERE id = ?",
                     (*kwargs.values(), session_id))
        conn.commit()
        conn.close()
    except Exception as e:
        log.warning(f"DB update session failed: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# TURSO — shared remote DB for persistent session replays
# ═══════════════════════════════════════════════════════════════════════════

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")


def _get_turso_db():
    """Return a libsql connection to Turso, or None if not configured."""
    if not libsql or not TURSO_DATABASE_URL or not TURSO_AUTH_TOKEN:
        return None
    try:
        conn = libsql.connect("db/turso_replica.db",
                              sync_url=TURSO_DATABASE_URL,
                              auth_token=TURSO_AUTH_TOKEN)
        conn.sync()
        return conn
    except Exception as e:
        log.warning(f"Turso connection failed: {e}")
        return None


def _turso_dict_fetchone(cursor):
    """Convert a single libsql tuple row to dict using cursor.description."""
    row = cursor.fetchone()
    if not row:
        return None
    cols = [d[0].lower() for d in cursor.description]
    return dict(zip(cols, row))


def _turso_dict_fetchall(cursor):
    """Convert all libsql tuple rows to dicts using cursor.description."""
    rows = cursor.fetchall()
    if not rows:
        return []
    cols = [d[0].lower() for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


def _init_turso_db():
    """Create tables on Turso (idempotent). Called at import time."""
    conn = _get_turso_db()
    if not conn:
        return
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                game_id TEXT NOT NULL,
                model TEXT DEFAULT '',
                mode TEXT DEFAULT 'local',
                created_at REAL NOT NULL,
                result TEXT DEFAULT 'NOT_FINISHED',
                steps INTEGER DEFAULT 0,
                levels INTEGER DEFAULT 0,
                parent_session_id TEXT DEFAULT NULL,
                branch_at_step INTEGER DEFAULT NULL,
                total_cost REAL DEFAULT 0,
                prompts_json TEXT DEFAULT NULL,
                timeline_json TEXT DEFAULT NULL
            );
            CREATE TABLE IF NOT EXISTS session_steps (
                session_id TEXT NOT NULL,
                step_num INTEGER NOT NULL,
                action INTEGER NOT NULL,
                data_json TEXT DEFAULT '{}',
                grid_snapshot TEXT,
                change_map_json TEXT,
                llm_response_json TEXT,
                timestamp REAL NOT NULL,
                PRIMARY KEY (session_id, step_num),
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
        """)
        # LLM call log table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS llm_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                call_type TEXT NOT NULL,
                step_num INTEGER,
                parent_call_id INTEGER,
                model TEXT NOT NULL,
                prompt_preview TEXT,
                prompt_length INTEGER,
                response_preview TEXT,
                response_json TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost REAL DEFAULT 0,
                duration_ms INTEGER DEFAULT 0,
                thinking_level TEXT,
                tools_active INTEGER DEFAULT 0,
                cache_active INTEGER DEFAULT 0,
                error TEXT,
                attempt INTEGER DEFAULT 0,
                timestamp REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id)")
        except Exception:
            pass
        # Schema migration: add columns (idempotent)
        for col, defn in [("prompts_json", "TEXT DEFAULT NULL"),
                          ("timeline_json", "TEXT DEFAULT NULL"),
                          ("user_id", "TEXT DEFAULT NULL")]:
            try:
                conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} {defn}")
            except Exception:
                pass  # column already exists
        # Auth tables (Turso only)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                created_at REAL NOT NULL,
                last_login_at REAL,
                display_name TEXT DEFAULT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                last_used_at REAL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS magic_links (
                code TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                used INTEGER DEFAULT 0
            );
        """)
        conn.commit()
        conn.sync()
        conn.close()
        log.info("Turso DB initialized successfully")
    except Exception as e:
        log.warning(f"Turso DB init failed: {e}")


def _turso_import_session(payload):
    """Write a session + steps to Turso. Reuses same compression logic as local DB."""
    conn = _get_turso_db()
    if not conn:
        return False
    try:
        sess = payload.get("session")
        steps = payload.get("steps", [])
        prompts_json = json.dumps(sess.get("prompts")) if sess.get("prompts") else None
        timeline_json = json.dumps(sess.get("timeline")) if sess.get("timeline") else None
        user_id = sess.get("user_id")
        conn.execute(
            """INSERT INTO sessions (id, game_id, model, mode, created_at, result, steps, levels,
                                     parent_session_id, branch_at_step, prompts_json, timeline_json, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 result = excluded.result, steps = excluded.steps, levels = excluded.levels,
                 model = COALESCE(excluded.model, sessions.model),
                 prompts_json = COALESCE(excluded.prompts_json, sessions.prompts_json),
                 timeline_json = COALESCE(excluded.timeline_json, sessions.timeline_json),
                 user_id = COALESCE(excluded.user_id, sessions.user_id)""",
            (sess["id"], sess["game_id"], sess.get("model", ""),
             sess.get("mode", "online"), sess.get("created_at", time.time()),
             sess.get("result", "NOT_FINISHED"), sess.get("steps", 0),
             sess.get("levels", 0), sess.get("parent_session_id"),
             sess.get("branch_at_step"), prompts_json, timeline_json, user_id),
        )
        for s in steps:
            grid_snapshot = None
            if s.get("grid"):
                grid_snapshot = _compress_grid(s["grid"])
            conn.execute(
                """INSERT OR REPLACE INTO session_steps
                   (session_id, step_num, action, data_json, grid_snapshot,
                    change_map_json, llm_response_json, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (sess["id"], s.get("step_num", 0), s.get("action", 0),
                 json.dumps(s.get("data", {})),
                 grid_snapshot,
                 json.dumps(s.get("change_map")) if s.get("change_map") else None,
                 json.dumps(s.get("llm_response")) if s.get("llm_response") else None,
                 s.get("timestamp", time.time())),
            )
        conn.commit()
        conn.sync()
        conn.close()
        log.info(f"Turso: imported session {sess['id']} ({len(steps)} steps)")
        return True
    except Exception as e:
        log.warning(f"Turso import failed: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════
# AUTH HELPERS (Turso only)
# ═══════════════════════════════════════════════════════════════════════════

AUTH_TOKEN_TTL = 30 * 24 * 3600  # 30 days
MAGIC_LINK_TTL = 15 * 60         # 15 minutes


def _turso_find_or_create_user(email: str) -> dict | None:
    """Find existing user by email or create a new one. Returns user dict."""
    conn = _get_turso_db()
    if not conn:
        return None
    try:
        email = email.lower().strip()
        cur = conn.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = _turso_dict_fetchone(cur)
        if user:
            conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?",
                         (time.time(), user["id"]))
            conn.commit()
            conn.sync()
            conn.close()
            user["last_login_at"] = time.time()
            return user
        user_id = str(uuid.uuid4())
        now = time.time()
        conn.execute(
            "INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)",
            (user_id, email, now, now),
        )
        conn.commit()
        conn.sync()
        conn.close()
        return {"id": user_id, "email": email, "created_at": now,
                "last_login_at": now, "display_name": None}
    except Exception as e:
        log.warning(f"_turso_find_or_create_user failed: {e}")
        return None


def _turso_create_auth_token(user_id: str) -> str | None:
    """Create a 30-day auth token for a user. Returns token string."""
    conn = _get_turso_db()
    if not conn:
        return None
    try:
        token = secrets.token_urlsafe(32)
        now = time.time()
        conn.execute(
            "INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now, now + AUTH_TOKEN_TTL),
        )
        conn.commit()
        conn.sync()
        conn.close()
        return token
    except Exception as e:
        log.warning(f"_turso_create_auth_token failed: {e}")
        return None


def _turso_verify_auth_token(token: str) -> dict | None:
    """Verify an auth token and return the user dict, or None."""
    conn = _get_turso_db()
    if not conn:
        return None
    try:
        cur = conn.execute(
            "SELECT u.id, u.email, u.display_name FROM auth_tokens t "
            "JOIN users u ON t.user_id = u.id "
            "WHERE t.token = ? AND t.expires_at > ?",
            (token, time.time()),
        )
        user = _turso_dict_fetchone(cur)
        if user:
            conn.execute("UPDATE auth_tokens SET last_used_at = ? WHERE token = ?",
                         (time.time(), token))
            conn.commit()
            conn.sync()
        conn.close()
        return user
    except Exception as e:
        log.warning(f"_turso_verify_auth_token failed: {e}")
        return None


def _turso_create_magic_link(email: str) -> str | None:
    """Create a single-use magic link code (15-min expiry). Returns code."""
    conn = _get_turso_db()
    if not conn:
        return None
    try:
        code = secrets.token_urlsafe(32)
        now = time.time()
        conn.execute(
            "INSERT INTO magic_links (code, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (code, email.lower().strip(), now, now + MAGIC_LINK_TTL),
        )
        conn.commit()
        conn.sync()
        conn.close()
        return code
    except Exception as e:
        log.warning(f"_turso_create_magic_link failed: {e}")
        return None


def _turso_verify_magic_link(code: str) -> str | None:
    """Verify and consume a magic link code. Returns email or None."""
    conn = _get_turso_db()
    if not conn:
        return None
    try:
        cur = conn.execute(
            "SELECT email FROM magic_links WHERE code = ? AND expires_at > ? AND used = 0",
            (code, time.time()),
        )
        row = _turso_dict_fetchone(cur)
        if not row:
            conn.close()
            return None
        conn.execute("UPDATE magic_links SET used = 1 WHERE code = ?", (code,))
        conn.commit()
        conn.sync()
        conn.close()
        return row["email"]
    except Exception as e:
        log.warning(f"_turso_verify_magic_link failed: {e}")
        return None


def _turso_delete_auth_token(token: str):
    """Delete an auth token (logout)."""
    conn = _get_turso_db()
    if not conn:
        return
    try:
        conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
        conn.commit()
        conn.sync()
        conn.close()
    except Exception as e:
        log.warning(f"_turso_delete_auth_token failed: {e}")


def _turso_claim_sessions(user_id: str, session_ids: list[str]) -> int:
    """Claim unowned sessions for a user. Returns count of claimed sessions."""
    conn = _get_turso_db()
    if not conn or not session_ids:
        return 0
    try:
        placeholders = ",".join("?" for _ in session_ids)
        cur = conn.execute(
            f"UPDATE sessions SET user_id = ? WHERE id IN ({placeholders}) AND user_id IS NULL",
            [user_id] + session_ids,
        )
        count = cur.rowcount if hasattr(cur, 'rowcount') else 0
        conn.commit()
        conn.sync()
        conn.close()
        return count
    except Exception as e:
        log.warning(f"_turso_claim_sessions failed: {e}")
        return 0


def _turso_get_user_sessions(user_id: str) -> list[dict]:
    """Get all sessions owned by a user from Turso."""
    conn = _get_turso_db()
    if not conn:
        return []
    try:
        cur = conn.execute(
            "SELECT id, game_id, model, mode, created_at, result, steps, levels, "
            "parent_session_id, branch_at_step, total_cost, user_id "
            "FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200",
            (user_id,),
        )
        rows = _turso_dict_fetchall(cur)
        conn.close()
        return rows
    except Exception as e:
        log.warning(f"_turso_get_user_sessions failed: {e}")
        return []


def _turso_count_recent_magic_links(email: str, window: float = 900) -> int:
    """Count magic links created for an email in the last `window` seconds."""
    conn = _get_turso_db()
    if not conn:
        return 0
    try:
        cur = conn.execute(
            "SELECT COUNT(*) as cnt FROM magic_links WHERE email = ? AND created_at > ?",
            (email.lower().strip(), time.time() - window),
        )
        row = _turso_dict_fetchone(cur)
        conn.close()
        return row["cnt"] if row else 0
    except Exception as e:
        log.warning(f"_turso_count_recent_magic_links failed: {e}")
        return 0


def _log_llm_call(session_id: str, call_type: str, model: str, *,
                   step_num: int | None = None,
                   parent_call_id: int | None = None,
                   prompt_preview: str | None = None,
                   prompt_length: int = 0,
                   response_preview: str | None = None,
                   response_json: dict | None = None,
                   input_tokens: int = 0,
                   output_tokens: int = 0,
                   cost: float = 0,
                   duration_ms: int = 0,
                   thinking_level: str | None = None,
                   tools_active: bool = False,
                   cache_active: bool = False,
                   error: str | None = None,
                   attempt: int = 0) -> int | None:
    """Insert an LLM call log row. Returns call_id or None on failure."""
    try:
        conn = _get_db()
        cur = conn.execute(
            "INSERT INTO llm_calls "
            "(session_id, call_type, step_num, parent_call_id, model, "
            " prompt_preview, prompt_length, response_preview, response_json, "
            " input_tokens, output_tokens, cost, duration_ms, "
            " thinking_level, tools_active, cache_active, error, attempt, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session_id, call_type, step_num, parent_call_id, model,
                prompt_preview[:500] if prompt_preview else None,
                prompt_length,
                response_preview[:1000] if response_preview else None,
                json.dumps(response_json) if response_json else None,
                input_tokens, output_tokens, cost, duration_ms,
                thinking_level, int(tools_active), int(cache_active),
                error, attempt, time.time(),
            ),
        )
        call_id = cur.lastrowid
        conn.commit()
        conn.close()
        return call_id
    except Exception as e:
        log.warning(f"_log_llm_call failed: {e}")
        return None


def _get_session_calls(session_id: str) -> list[dict]:
    """Return all llm_calls for a session, ordered by timestamp."""
    try:
        conn = _get_db()
        rows = conn.execute(
            "SELECT * FROM llm_calls WHERE session_id = ? ORDER BY timestamp",
            (session_id,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        log.warning(f"_get_session_calls failed: {e}")
        return []


# Initialize both DBs at import time (for gunicorn/Railway)
_init_db()
_init_turso_db()
