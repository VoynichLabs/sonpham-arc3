# Smart Tournament Scheduler — Plan Doc

**Date**: 2026-03-18
**Goal**: Maximize rating clarity by running more games, smarter matchmaking, and ensuring top agents meet.

## Current Problems

1. **Single-threaded tournament** — One thread round-robins 6 games sequentially. Each game waits for the others. Wastes CPU.
2. **Top-10 only picks** — `a1 = agents[random(0..9)]` means agents ranked 11+ rarely play, so their ratings stay uncalibrated.
3. **Top agents don't meet** — Pair cap of 10 stored games means top agents exhaust their quota and stop playing. The cap exists for *storage* (history blobs), not for rating purposes. We can keep playing but skip storing the history.

## Scope

**In**:
- Per-game tournament threads (1 CPU thread per game)
- DB writer queue (single thread for all DB writes — preserves SQLite safety)
- Smart 3-phase scheduler (calibration → top contenders → Swiss)
- Higher pair caps for top agents (play beyond storage cap, just skip history)

**Out**:
- Evolution system (unchanged)
- Game engines (unchanged)
- API endpoints (unchanged)
- Heartbeat status format (unchanged, but may add per-game stats)

## Architecture

### Thread Model

```
Before:  1 tournament thread → round-robin 6 games sequentially
After:   6 tournament threads (1 per game) + 1 DB writer thread
```

**DB Writer Thread**: Reads `(game_id, a1, a2, winner_id, winner_name, result)` tuples from a `queue.Queue`. Calls `arena_record_game()` + `_push_live_match()`. All DB writes funneled here → SQLite safety preserved.

**Per-Game Threads**: Each runs `_tournament_loop_for_game(game_id)`. Computes matches CPU-bound, puts results on the shared DB queue. No direct DB writes except the initial `arena_get_leaderboard` reads (SQLite reads are safe concurrent).

### Smart 3-Phase Scheduler

Each batch of `match_count` matches is split into 3 phases:

**Phase A — Calibration (40% of batch)**
- Sort agents by `games_played` ascending
- Pick the least-played agents as `a1`
- Pair with closest-ELO agent that has > 20 games (established baseline)
- Goal: quickly move provisional agents (K=64) to their true rating

**Phase B — Top Contenders (30% of batch)**
- Take top N agents by ELO (N = min(10, len(agents)))
- Round-robin pairs that haven't played recently
- For pairs that have exhausted the storage cap (10), still play but don't store history
- Goal: ensure the leaderboard top is well-resolved

**Phase C — ELO-Weighted Swiss (30% of batch)**
- Existing algorithm but pick `a1` from full roster, not just top 10
- Same inverse-ELO-distance weighting for `a2`
- Goal: keep the rest of the ladder moving

### Pair Cap Changes

- `MAX_STORED_GAMES_PER_PAIR = 10` — unchanged (controls history storage)
- New: `MAX_RATING_GAMES_PER_PAIR = 30` — allow up to 30 games for rating purposes
- Games beyond storage cap: recorded in DB but with `history = NULL` (saves space)
- For top-20 agents: no pair cap at all (always allow more games)

## TODOs

1. Add `_db_writer_queue` (queue.Queue) and `_db_writer_thread()` function
2. Refactor `_tournament_loop` → `_tournament_loop_for_game(game_id)` (one per game)
3. Implement `_schedule_smart(agents, pair_counts, match_count)` with 3 phases
4. Update `start_arena_heartbeat()` to launch per-game threads + DB writer
5. Update `stop_arena_heartbeat()` + `get_heartbeat_status()` for new thread model
6. Add `MAX_RATING_GAMES_PER_PAIR` constant and use it in scheduling
7. Verify: run locally, check games are produced for all 6 games concurrently

## Docs / Changelog

- `CHANGELOG.md` entry for new scheduler
- Update header in `arena_heartbeat.py`
