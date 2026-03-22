# Program.md Auto-Evolution Plan

## Scope

**In scope:**
- Auto-evolve program.md every 10 agents created OR 2 hours elapsed (whichever first)
- LLM call (Sonnet) generates a new program.md based on current agents, games, previous programs
- Store full conversation log of how each program.md was created
- New program auto-applies as the default for future evolutions
- Heartbeat message announces the new program version
- Frontend: version dropdown in program.md header to browse all versions
- Frontend: "View Evolution Log" button per version to see how it was created

**Out of scope:**
- Community voting on auto-evolved programs (they auto-apply)
- Reverting to old versions (read-only browsing for now)

## Architecture

### DB Changes

Add columns to `arena_program_versions`:
- `conversation_log TEXT DEFAULT NULL` — full LLM conversation JSON
- `trigger_reason TEXT DEFAULT NULL` — e.g. "10 agents created", "2h elapsed"
- `auto_evolved INTEGER DEFAULT 0` — 1 if created by AI, 0 if human-proposed

Migration in `db.py` using ALTER TABLE (safe, additive).

### Backend — `arena_heartbeat.py`

New function `_should_evolve_program(game_id)`:
- Count agents created with the current `program_version_id`
- Check time since the current program version's `created_at`
- Return `(should_evolve, reason)` — True if >=10 agents OR >=2h

New function `_run_program_evolution(api_key, game_id)`:
- Load current program.md, top 15 agents (names, ELO, win rates, code of top 3)
- Load recent game results (last 20 games showing who beat whom)
- Load previous program versions + their change summaries
- Call Sonnet 4.6 with system prompt explaining the task
- Parse the response to extract the new program.md content
- Auto-apply: insert into `arena_program_versions` (applied=1, auto_evolved=1), update `arena_research`
- Post heartbeat comment announcing the change
- Return the new version

Wire into `_evolution_loop_for_game`: check `_should_evolve_program` after each evolution tick, before the AI analysis check.

### Backend — `db_arena.py`

New function `arena_count_agents_since_program(game_id)`:
- Get current applied version id from `arena_program_versions`
- Count agents where `program_version_id = current_version_id`

New function `arena_auto_evolve_program(game_id, content, change_summary, conversation_log, trigger_reason)`:
- Increment version, insert with `applied=1, auto_evolved=1`
- Update `arena_research.program_md` and `program_version`
- Return the new version dict

### Backend — `app.py`

New endpoint `GET /api/arena/program/<game_id>/versions`:
- Return all versions with metadata (no conversation_log — too large)

Update existing `GET /api/arena/program-version/<id>` to include `conversation_log`.

### Frontend — `arena.html`

Add a `<select>` dropdown in the program.md section header, next to "program.md" label.

### Frontend — `arena.js`

- Populate dropdown from `program.versions` data (already available from research overview)
- On dropdown change, fetch that version's content and display it
- Add "View Log" link that opens a modal showing the evolution conversation

## TODOs

1. [ ] DB migration: add 3 columns to `arena_program_versions`
2. [ ] `db_arena.py`: add `arena_count_agents_since_program()` and `arena_auto_evolve_program()`
3. [ ] `arena_heartbeat.py`: add `_should_evolve_program()` and `_run_program_evolution()`
4. [ ] `arena_heartbeat.py`: wire program evolution into the evolution loop
5. [ ] `app.py`: add `/api/arena/program/<game_id>/versions` endpoint
6. [ ] `arena.html`: add version dropdown + log modal
7. [ ] `arena.js`: populate dropdown, handle version switching, show log
8. [ ] Verify: import check, app boots, test locally
9. [ ] Push to staging

## Docs / Changelog

- CHANGELOG.md entry for the new feature
