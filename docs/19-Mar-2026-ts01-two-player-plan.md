# Plan: Tower Siege (ts01) — Two-Player Mode

**Date:** 2026-03-19
**Author:** Claude Sonnet 4.6

---

## Scope

**In:**
- Add alternating two-player turns to `ts01`: Player 1 = Attacker, Player 2 = Defender
- P2 (Defender) manually controls guards each turn instead of guards auto-patrolling
- Redesign 5 levels to balance the P1/P2 roles
- Update HUD to show whose turn it is and highlight defender's valid guard moves
- Bump game version directory to `00000002`

**Out:**
- No AI for either player — both are human click-controlled
- No networking/remote play — local hot-seat only
- No new unit types beyond existing Sapper / Scout / Soldier / Guards

---

## Architecture

### Turn Structure (new)

```
P1 (Attacker) picks a unit → takes one action (move or tool)
    → switches to P2 turn
P2 (Defender) picks a guard → moves it one orthogonal step (or passes)
    → world advances (bombs tick, freeze counters decrement, turn counter increments)
    → win/lose check
    → switches back to P1 turn
```

One full "round" = one P1 action + one P2 guard move.

### State changes

| Field | Before | After |
|---|---|---|
| `current_player` | — | 0 = attacker, 1 = defender |
| `selected_guard_idx` | — | index into `self.guards` when P2 has selected a guard |
| `valid_guard_moves` | — | set of (x,y) P2 can move selected guard to |
| Guard dict | `{'path':…, 'pi':…, 'alive':…}` | `{'x':int, 'y':int, 'alive':True}` |
| `_advance_turn()` | auto-moves guards | only ticks bombs + freezes, increments turn |
| `_check_win_lose()` | unchanged | same rules (attacker wins on core, loses on timeout/all dead) |

Guards no longer follow a fixed patrol path — P2 moves them manually one step per turn.

### Click handling split

```
if current_player == 0:
    # Attacker click — existing logic (select unit, move/tool)
    ...
    # After action_taken: switch to P2 turn
    current_player = 1
else:
    # Defender click — select guard, then move guard
    if selected_guard_idx is None:
        # Try to select a guard at click position
        ...
    else:
        if click == selected guard position:
            # Deselect (guard stays, P2 still needs to move/pass)
        elif click in valid_guard_moves:
            # Move guard → execute world advance → switch to P1
            ...
        # Right-panel "Pass" area click → advance without moving guard
```

### P2 Guard move rules

- Guard moves exactly 1 orthogonal step to any adjacent cell that is:
  - In bounds
  - Not a solid wall, breach wall, gap, or pending bomb
  - Not occupied by another guard
  - Not the tower core (guards can't stand on the win cell)
- Guard CAN move onto an attacker unit cell — this kills that unit (or triggers Soldier contact-kill if it's a Soldier)
- P2 must take a turn (move or pass) — no infinite waiting

### HUD / UI changes

- Top HUD bar shows `ATK` (Yellow) or `DEF` (Red) to indicate whose turn it is
- When P2's turn: guards are highlighted with a Red border (available to move)
- When a guard is selected by P2: LightMagenta border on guard, valid moves shown as White dots
- Right panel: show guard count and "PASS" button area (bottom of panel) that P2 can click to skip guard move

### Renderer additions

- `_draw_label(frame, …, 'DEF', RED)` or `'ATK'` in HUD
- Guard selection highlight (same style as unit selection: LMAG border)
- Valid guard move dots (White dots, same as unit move hints)
- "PASS" text in lower-right panel area (P2 can click this region to pass their turn)

---

## Level Redesigns (2-player balanced)

All 5 levels redesigned for P2 controlling guards. Key balance principle: P2 can disrupt but not trivially block all routes; P1 has enough turns and tools to push through.

### L1 — The Breach (Sapper vs 1 guard)
- P1: Sapper only, breach wall at (10,7), starts at (10,16)
- P2: 1 guard at (10,11) — tries to block south approach
- Turn limit: 18
- Strategy: P1 bombs wall and times approach around guard; P2 tries to intercept

### L2 — Timed Gate (Sapper+Scout vs 1 guard)
- Same gate at (10,7) period=3, breach wall (8,5)
- P2: 1 guard at (10,10)
- P1 has two paths to exploit; P2 must commit to blocking one
- Turn limit: 20

### L3 — Two Guards (All units vs 2 guards)
- Gate at (12,5) period=4, breach wall (10,7), gap at (15,9)
- P2: 2 guards starting at (10,11) and (11,8)
- Turn limit: 28

### L4 — Full Assault (All units vs 3 guards)
- Same map, P2 gets 3 guards: (10,11), (11,8), (13,6)
- Turn limit: 32

### L5 — The Gauntlet (All units vs 3 guards, tight budget)
- Same layout as L4
- Turn limit: 22 (was 20 in single-player; slightly more generous since P2 is active)

---

## File Changes

| File | Change |
|---|---|
| `environment_files/ts/00000002/ts01.py` | New version with 2-player logic (full rewrite of game class and levels) |
| `environment_files/ts/00000002/metadata.json` | Updated `date_downloaded` to 2026-03-19 |
| `CHANGELOG.md` | Entry for two-player mode addition |

The old `00000001/` version is left untouched so existing single-player sessions replay correctly.

---

## TODOs

1. [ ] Create `environment_files/ts/00000002/` directory structure
2. [ ] Write new `ts01.py` with 2-player state, alternating turn logic, redesigned levels
3. [ ] Write `metadata.json` (bump date)
4. [ ] Update `CHANGELOG.md`
5. [ ] Run smoke test: import check + manual trace of L1 solution
6. [ ] Push to staging

---

## Docs / Changelog

- `CHANGELOG.md` — new entry: Two-player mode for Tower Siege (ts01 v2)
- No CLAUDE.md changes needed

---

## Open Questions for Approval

1. **Pass mechanic**: Should P2 be *forced* to move a guard each turn (move only), or is passing allowed? (Plan assumes passing allowed via right-panel click.)
2. **Guard spawn**: Should P2 have any ability to add new guards mid-game, or is the starting guard count fixed? (Plan assumes fixed — simpler.)
3. **Soldier vs guard**: When a guard moves onto a Soldier, should the Soldier kill the guard (same contact-kill rule) or does the guard kill the Soldier? (Plan: Soldier contact-kill triggers on guard-initiated collision too — same as guard-auto-move collision in v1.)
