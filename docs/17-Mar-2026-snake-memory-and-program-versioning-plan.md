# Snake Memory + Program.md Versioning Plan

**Date**: 2026-03-17
**Goal**: Add persistent `memory` dict to all 4 snake variants + version Program.md files per game

## Scope

### In Scope
1. Add `state['memory']` dict to all 4 snake game engines (classic, random, royale, 2v2)
2. Update all 4 Program.md files to document memory
3. Implement Program.md file-based versioning: `Program-{YYYY-MM-DD}.md` per game
4. Link each agent to the Program.md file that was active when it was created
5. Backward compatibility — existing agents that don't use memory still work

### Out of Scope
- Changing the evolution LLM loop
- Modifying the tournament system
- UI changes

## Architecture

### 1. Memory Dict in Game Engines

**`snake_engine.py`** — All 3 game classes (`SnakeGame`, `SnakeRandomGame`, `SnakeGame4P`):

- Add `self.memory: List[Dict]` alongside existing `self.prev_moves` (one dict per player)
- Expose as `state['memory']` in `get_state()`
- Cap: 50KB serialized size per agent. If exceeded, silently stop accepting new keys (don't crash the agent).
- `SnakeRandomGame` inherits from `SnakeGame`, so it gets memory automatically from the parent's `get_state()`
- `SnakeGame4P` needs its own `self.memory = [{}, {}, {}, {}]`

### 2. Program.md Versioning

**Directory structure** per game:
```
server/arena_seeds/
  snake/
    Program.md              → symlink or copy of the current active version
    Program-2026-03-17.md   → first versioned file
  snake_random/
    Program.md
    Program-2026-03-17.md
  snake_royale/
    Program.md
    Program-2026-03-17.md
  snake_2v2/
    Program.md
    Program-2026-03-17.md
```

Actually, simpler approach — keep flat files with game prefix:
```
server/arena_seeds/
  snake_program.md                → current (what exists now, renamed from default_program.md)
  snake_program-2026-03-17.md     → versioned copy
  snake_random_program.md         → current
  snake_random_program-2026-03-17.md
  snake_royale_program.md         → current
  snake_royale_program-2026-03-17.md
  snake_2v2_program.md            → current
  snake_2v2_program-2026-03-17.md
```

### 3. Agent → Program.md Linkage

Currently `arena_agents.program_version_id` links to `arena_program_versions.id` (DB-stored versions). This stays.

Additionally, store the **filename** of the Program.md used during creation in the arena evolution log. Add `program_file` TEXT column to `arena_agents` to store which file was used (e.g. `snake_random_program-2026-03-17.md`).

This way we can always trace: agent → which exact Program.md text produced it.

### 4. Backward Compatibility

- `state['memory']` is a new key. Existing agents never access it → no breakage.
- `state['prev_moves']` remains unchanged.
- Memory dict starts empty `{}` — agents opt-in by writing to it.

## TODOs

1. **snake_engine.py**: Add `self.memory` to `SnakeGame.__init__()` and `SnakeGame4P.__init__()`
2. **snake_engine.py**: Expose `state['memory']` in all `get_state()` methods
3. **snake_engine.py**: Add memory size cap enforcement after each `get_move()` call
4. **Program.md files**: Add `## Agent Memory (memory dict)` section to all 4 files
5. **Program.md versioning**: Create dated copies of all 4 program files
6. **arena_heartbeat.py**: Log which program file was used during evolution
7. **db.py**: Add `program_file` column to `arena_agents` (migration)
8. **Verify**: Run import check + smoke test

## Docs / Changelog
- CHANGELOG.md entry for memory + program versioning
- Update CLAUDE.md if needed (game state documentation)
