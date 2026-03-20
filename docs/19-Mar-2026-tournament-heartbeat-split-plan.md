# Tournament Heartbeat Split — Plan

**Date**: 2026-03-19  
**Goal**: Decouple tournament thread lifecycle from evolution lifecycle so tournament can run independently.

## Scope

**In scope**
- Add dedicated tournament heartbeat start/stop functions.
- Add dedicated evolution heartbeat start/stop functions.
- Keep compatibility wrapper (`start_arena_heartbeat`) that starts both.
- Update server bootstrap to start tournament and evolution independently.
- Extend heartbeat status payload to report independent running states.
- Add `CHANGELOG.md` entry.

**Out of scope**
- Matchmaking algorithm changes.
- ELO formula changes.
- New API routes.
- DB schema changes.

## Architecture

- `server/arena_heartbeat.py`
  - Introduce separate runtime flags:
    - `tournament_running`
    - `evolution_running`
  - Tournament loops (`_db_writer_thread`, `_tournament_loop_for_game`) use `tournament_running`.
  - Evolution loops (`_evolution_loop_for_game`) use `evolution_running`.
  - Add:
    - `start_arena_tournament_heartbeat()`
    - `stop_arena_tournament_heartbeat()`
    - `start_arena_evolution_heartbeat()`
    - `stop_arena_evolution_heartbeat()`
  - Keep:
    - `start_arena_heartbeat()` calling both starters.
    - `stop_arena_heartbeat()` stopping both.

- `server/app.py`
  - Startup block in prod mode starts tournament heartbeat and evolution heartbeat separately.
  - Non-fatal bootstrap logs identify which subsystem failed.

## TODOs

1. Update heartbeat state model to separate tournament/evolution lifecycle flags.
2. Refactor loop guards to use subsystem-specific flags.
3. Add independent start/stop functions for tournament and evolution.
4. Update compatibility wrappers.
5. Update app startup bootstrap to start each subsystem separately.
6. Add changelog entry.
7. Verify with import checks and quick startup probes for:
   - tournament-only running
   - evolution-only running
   - both running

## Docs / Changelog touchpoints

- `CHANGELOG.md`: add a “Changed” entry describing split heartbeat lifecycle.

