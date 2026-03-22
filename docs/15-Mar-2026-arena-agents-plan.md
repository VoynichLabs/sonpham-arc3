# Arena Agent Integration Plan

**Date**: 2026-03-15
**Goal**: Replace Arena's hardcoded AI strategies with the real agent/scaffolding system, so each side (Agent A, Agent B) is controlled by an LLM agent with full harness settings. Add per-agent observability.

---

## Scope

### In Scope
1. **Formalize agent settings** — Extract the scaffolding settings rendering into a reusable function that can render settings into any container (not just `#settingsColumns`)
2. **Arena agent settings panels** — Replace strategy dropdowns in Agent A/B side panels with full harness selection (scaffolding type, model select, input toggles, compaction, BYOK keys)
3. **Arena observability mode** — Three-view system:
   - **Match view** (default during play): Canvas in center, step logs on sides (existing)
   - **Observe Agent A**: Observatory panel on LEFT, game canvas on RIGHT
   - **Observe Agent B**: Game canvas on LEFT, observatory panel on RIGHT
   - Only one agent observable at a time (screen size constraint)
   - "Back to Settings" returns to match view with game canvas and per-side step history

### Out of Scope
- Actually wiring LLM calls (the scaffolding harnesses will be configured but won't run real LLM calls in this phase — that requires game-to-prompt adapters for each arena game)
- Multi-agent concurrent execution
- Session persistence for arena matches

---

## Architecture

### 1. Reusable Settings Renderer

Currently `renderScaffoldingSettings()` in `state.js` renders into the hardcoded `#settingsColumns` container. We need to:

- Create `renderAgentSettings(containerId, prefix)` — renders full scaffolding settings into any container
- The `prefix` param (e.g., `'arenaA_'`, `'arenaB_'`) namespaces all element IDs to avoid collisions
- Reuse `renderField()`, `renderGroup()`, `renderPipelineVisualizer()` with prefixed IDs
- Each side gets independent scaffolding type, model select, and settings

**Files touched**: `static/js/state.js` (add prefix support to renderer)

### 2. Arena Settings Panels

Each agent panel gets a **Code / Harness** mode dropdown:
- **Code mode** (default): Existing strategy select + personality bars (hardcoded AI)
- **Harness mode**: Full scaffolding settings (harness dropdown, pipeline viz, model select, thinking level, planning mode, compact/interrupt, BYOK keys)

When "Harness" is selected, the strategy/personality UI hides and the scaffolding settings appear. Each side can independently choose Code or Harness mode.

Each side stores settings independently in localStorage:
- `arc_arena_agent_a_scaffolding` / `arc_arena_agent_b_scaffolding`

**Files touched**: `templates/arena.html`, `static/js/arena.js`, `static/css/arena.css`

### 3. Arena Observability

Add a new view mode to Arena: `'observe-a'` or `'observe-b'`.

**Layout for Observe Agent A** (obs LEFT, canvas RIGHT):
```
┌─────────────────────────────────────────────────┐
│ [← Back]  Agent A Observatory    [Agent B →]    │
├────────────────────┬────────────────────────────┤
│  Status Bar        │  Game Canvas               │
│  Swimlane          │  Scrubber                   │
│  Event Log         │  Reasoning Log              │
│                    │  Transport (Pause/Back)      │
└────────────────────┴────────────────────────────┘
```

**Layout for Observe Agent B** (canvas LEFT, obs RIGHT):
```
┌─────────────────────────────────────────────────┐
│ [← Agent A]   Agent B Observatory   [Back →]    │
├────────────────────────────────┬────────────────┤
│  Game Canvas                   │  Status Bar    │
│  Scrubber                      │  Swimlane      │
│  Reasoning Log                 │  Event Log     │
│  Transport (Pause/Back)        │                │
└────────────────────────────────┴────────────────┘
```

**Files touched**: `templates/arena.html`, `static/js/arena.js`, `static/css/arena.css`

### 4. Script Dependencies

Arena is a standalone page (`arena.html`) that currently only loads `arena.js`. To use the scaffolding system, we need to also load:
- `config/scaffolding-schemas.js` (schema definitions)
- Core rendering functions from `state.js` (extracted or duplicated)

**Approach**: Load `scaffolding-schemas.js` in `arena.html`. Extract the field/group rendering functions into a shared utility that both `state.js` and `arena.js` can use, OR inline a minimal version in arena.js that reads from `SCAFFOLDING_SCHEMAS`.

---

## TODOs

### Phase 1: Load scaffolding schemas in Arena
- [ ] Add `<script>` tags to `arena.html` for `scaffolding-schemas.js`
- [ ] Add required globals that schemas depend on (`MODE`, `FEATURES`)
- [ ] Verify schemas load without errors

### Phase 2: Reusable settings renderer
- [ ] Create `renderArenaAgentSettings(containerId, prefix, schemaId)` in `arena.js`
- [ ] Port `renderField()`, `renderGroup()` rendering logic (minimal subset needed for arena)
- [ ] Port `renderPipelineVisualizer()` for pipeline diagram
- [ ] Add model list fetching (`/api/llm/models`) and `_populateModelSelects(prefix)` for arena
- [ ] Wire up per-prefix localStorage save/restore

### Phase 3: Replace Arena strategy panels
- [ ] Replace `#settingsA` content with `renderArenaAgentSettings('settingsA', 'arenaA_', 'linear')`
- [ ] Replace `#settingsB` content with `renderArenaAgentSettings('settingsB', 'arenaB_', 'linear')`
- [ ] Remove old strategy select/personality UI from arena.html
- [ ] Update `selectGameCard()` to not populate strategy selects (no longer needed)
- [ ] Widen side panels to accommodate settings (300px → 340px)
- [ ] Verify: both panels independently select scaffolding, model, settings

### Phase 4: Arena observability mode
- [ ] Add Arena modes: `'setup'`, `'match'`, `'observe-a'`, `'observe-b'`
- [ ] Add observatory DOM structure to `arena.html` (status bar, log, swimlane, reasoning mirror)
- [ ] Create `enterArenaObsMode(agent)` — shows obs panel for agent A or B
- [ ] Create `exitArenaObsMode()` — returns to match view
- [ ] Add "Observe A" / "Observe B" buttons to match transport bar
- [ ] CSS: obs-a layout (obs left + canvas right), obs-b layout (canvas left + obs right)
- [ ] Wire scrubber in obs mode to show per-agent reasoning at each step
- [ ] "Back to Settings" in obs mode → back to match view (not setup)

### Phase 5: Verify & clean up
- [ ] Verify all three views work (setup → match → observe-a/b → match → setup)
- [ ] Verify keyboard shortcuts work in all modes
- [ ] Verify responsive layout still works
- [ ] Update CHANGELOG.md
- [ ] Update file headers

---

## Future: Shared Observation Module

The observe/observatory code currently exists in two places:
1. **Main app** (`observatory.js`, `observatory/*.js`) — in-app observatory during live gameplay
2. **Arena** (`arena.js` `enterArenaObs/exitArenaObs`) — per-agent obs during arena matches

These should be refactored into a shared observation module to keep the UX consistent. The shared module would provide:
- Status bar rendering
- Log/event rendering
- Scrubber integration
- Reasoning display mirroring
- Common CSS classes

This is tracked as a future improvement, not part of this initial implementation.

## Docs / Changelog
- `CHANGELOG.md` — entry for Arena agent integration
- File headers on all modified files
