#!/usr/bin/env python3
"""Upload local session data to the cloud server.

Reads session data from output/<run_dir>/session.db and uploads it
to the running server's API.

Usage:
    # Upload a specific session
    python session_uploader.py output/20260308_143000_ls20_abc12345/

    # Upload to a specific server
    python session_uploader.py output/20260308_143000_ls20_abc12345/ --server https://arc3.sonpham.net

    # List available local sessions
    python session_uploader.py --list

    # Upload all sessions from output/
    python session_uploader.py --all
"""

import argparse
import json
import sqlite3
import sys
import zlib
from pathlib import Path

import httpx

ROOT = Path(__file__).parent
OUTPUT_DIR = ROOT / "output"
DEFAULT_SERVER = "http://localhost:5000"


def list_sessions():
    """List all available sessions in output/."""
    if not OUTPUT_DIR.exists():
        print("No output directory found.")
        return

    runs = sorted(OUTPUT_DIR.iterdir())
    if not runs:
        print("No runs found in output/")
        return

    print(f"\n{'='*70}")
    print("  Available Sessions")
    print(f"{'='*70}")

    for run_dir in runs:
        if not run_dir.is_dir():
            continue
        meta_path = run_dir / "meta.json"
        if not meta_path.exists():
            continue

        meta = json.loads(meta_path.read_text())
        print(f"\n  {run_dir.name}/")
        print(f"    Session: {meta.get('session_id', '?')}")
        print(f"    Game:    {meta.get('game_id', '?')}")
        print(f"    Model:   {meta.get('model', '?')}")
        print(f"    Result:  {meta.get('result', '?')}")
        print(f"    Steps:   {meta.get('steps', '?')}")
        print(f"    Time:    {meta.get('elapsed_seconds', '?')}s")

    print()


def read_session_from_dir(run_dir: Path) -> dict:
    """Read session data from a run directory."""
    meta_path = run_dir / "meta.json"
    db_path = run_dir / "session.db"

    if not meta_path.exists():
        raise FileNotFoundError(f"No meta.json in {run_dir}")
    if not db_path.exists():
        raise FileNotFoundError(f"No session.db in {run_dir}")

    meta = json.loads(meta_path.read_text())
    session_id = meta["session_id"]

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # Read session record
    session_row = conn.execute(
        "SELECT * FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    if not session_row:
        conn.close()
        raise ValueError(f"Session {session_id} not found in DB")
    session = dict(session_row)

    # Read actions
    action_rows = conn.execute(
        "SELECT * FROM session_actions WHERE session_id = ? ORDER BY step_num",
        (session_id,),
    ).fetchall()
    actions = [dict(r) for r in action_rows]

    # Read LLM calls
    call_rows = conn.execute(
        "SELECT * FROM llm_calls WHERE session_id = ? ORDER BY timestamp",
        (session_id,),
    ).fetchall()
    calls = [dict(r) for r in call_rows]

    conn.close()

    return {
        "meta": meta,
        "session": session,
        "actions": actions,
        "calls": calls,
    }


def upload_session(run_dir: Path, server: str):
    """Upload a session to the server."""
    print(f"\n  Uploading: {run_dir.name}")

    data = read_session_from_dir(run_dir)
    session_id = data["meta"]["session_id"]
    game_id = data["meta"]["game_id"]

    print(f"    Session: {session_id}")
    print(f"    Game:    {game_id}")
    print(f"    Actions: {len(data['actions'])}")
    print(f"    Calls:   {len(data['calls'])}")

    # Upload via API
    url = f"{server.rstrip('/')}/api/sessions/import"
    payload = {
        "session": data["session"],
        "actions": data["actions"],
        "calls": data["calls"],
    }

    try:
        resp = httpx.post(url, json=payload, timeout=30)
        if resp.status_code == 200:
            result = resp.json()
            print(f"    Status:  uploaded successfully")
            share_url = f"{server.rstrip('/')}/share/{session_id}"
            print(f"    Share:   {share_url}")
            return True
        else:
            print(f"    Status:  FAILED ({resp.status_code})")
            print(f"    Error:   {resp.text[:200]}")
            return False
    except httpx.ConnectError:
        print(f"    Status:  FAILED (cannot connect to {server})")
        return False
    except Exception as e:
        print(f"    Status:  FAILED ({e})")
        return False


def main():
    parser = argparse.ArgumentParser(description="Upload sessions to cloud server")
    parser.add_argument("path", nargs="?", help="Path to run directory (output/<timestamp>/)")
    parser.add_argument("--server", default=DEFAULT_SERVER,
                        help=f"Server URL (default: {DEFAULT_SERVER})")
    parser.add_argument("--list", action="store_true", help="List available sessions")
    parser.add_argument("--all", action="store_true", help="Upload all sessions")
    args = parser.parse_args()

    if args.list:
        list_sessions()
        return

    if args.all:
        if not OUTPUT_DIR.exists():
            print("No output directory found.")
            sys.exit(1)

        success = 0
        total = 0
        for run_dir in sorted(OUTPUT_DIR.iterdir()):
            if not run_dir.is_dir() or not (run_dir / "meta.json").exists():
                continue
            total += 1
            if upload_session(run_dir, args.server):
                success += 1

        print(f"\n  Uploaded {success}/{total} sessions")
        return

    if not args.path:
        parser.print_help()
        print("\n  Use --list to see available sessions")
        sys.exit(1)

    run_dir = Path(args.path)
    if not run_dir.exists():
        # Try relative to output/
        run_dir = OUTPUT_DIR / args.path
    if not run_dir.exists():
        print(f"Directory not found: {args.path}")
        sys.exit(1)

    upload_session(run_dir, args.server)


if __name__ == "__main__":
    main()
