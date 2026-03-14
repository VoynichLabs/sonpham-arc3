# 2026-03-13 — Settings UX Improvements

## Background

Several long-standing UX issues in the Agent Settings panel:

1. **Model cascade** — selecting a Planner model does not auto-populate Monitor / World Model selects; user has to manually pick the same model N times
2. **Local model token defaults** — LM Studio / Ollama models default to 16384 tokens, which is inappropriate for local hardware; should default to 1024
3. **Diff overlay not enabled by default** — `showChanges` checkbox is unchecked on first load
4. **Graphics tab opacity slider broken** — slider visually moves but has no effect; also not persisted to localStorage (resets to 40% on every reload)
5. **Graphics subtab is undersized** — three tiny controls do not justify their own tab

---

## Scope

**In scope:**
- Model cascade: when Planner model changes, auto-populate sibling selects (Monitor, WM) if they haven't been explicitly set to something different
- Local model token cap: when a local model (lmstudio / ollama) is selected, set all associated token fields to 1024
- Diff overlay on by default: both HTML `checked` attribute and localStorage restore fallback
- Remove Graphics subtab; fold its three controls (Diff overlay, Opacity, Highlight color) into the Input section that already exists in each scaffolding
- Persist graphics settings (opacity, color) to localStorage so they survive page refresh
- Fix opacity: verify `redrawGrid()` reads `#changeOpacity` correctly; fix if not

**Out of scope:**
- Any changes to game rendering logic beyond what's needed to wire the opacity slider
- Any scaffolding logic changes
- Share page / Observatory UI

---

## Architecture

All changes are client-side JavaScript and HTML only. No server changes required.

### Files expected to change

| File | Change |
|------|--------|
| `templates/index.html` | Remove Graphics subtab + tab button; add Diff overlay + Opacity + Color inline to Input rows in each scaffolding pane |
| `static/js/ui.js` | Fix opacity listener to write to localStorage; move graphics listeners to wherever the Input section lives |
| `static/js/scaffolding.js` | Model cascade logic in `_populateAllModelSelects()` + `loadModels()` restore block |
| `static/js/state.js` | `attachSettingsListeners()` — add cascade listeners; add local-model token-cap logic; add graphics persistence |
| `static/js/llm-config.js` | Include graphics settings in `getScaffoldingSettings()` (or a separate `getGraphicsSettings()`) |

---

## Detailed Changes

### 1. Model Cascade

**Trigger:** any "primary" model select changes (e.g. `sf_ts_plannerModelSelect`, `sf_2s_plannerModelSelect`, `sf_wm_agentModelSelect`).

**Rule:** push the new value to sibling selects **only if the sibling's current value equals the previous primary value** (i.e. was in sync). This lets the user break the link by manually choosing a different model on a sibling, after which that sibling is no longer overwritten.

**Implementation sketch (`state.js` — `attachSettingsListeners`):**

```js
// Cascade helper
function _cascadeModel(primaryId, siblingIds) {
  const primary = document.getElementById(primaryId);
  if (!primary) return;
  let lastVal = primary.value;
  primary.addEventListener('change', function () {
    for (const id of siblingIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      // Only cascade if sibling was tracking the old primary value
      if (el.value === lastVal || el.value === '' || el.value === 'Select a model...') {
        el.value = this.value;
      }
    }
    lastVal = this.value;
    updateAllByokKeys();
    saveScaffoldingToStorage();
  });
}

// Wire up per scaffolding
_cascadeModel('sf_ts_plannerModelSelect', ['sf_ts_monitorModelSelect', 'sf_ts_wmModelSelect']);
_cascadeModel('sf_2s_plannerModelSelect', ['sf_2s_monitorModelSelect']);
_cascadeModel('sf_wm_agentModelSelect',   ['sf_wm_wmModelSelect']);
_cascadeModel('sf_as_orchestratorModelSelect', ['sf_as_subagentModelSelect']);
```

**Also:** on initial `loadModels()` restore, if a sibling value is absent from localStorage, set it to the primary's value (so first-time users start in sync).

### 2. Local Model Token Cap

**Trigger:** any model select change (all of them, including the main `modelSelect`).

**Implementation sketch:**

```js
function _applyLocalModelTokenCap(modelName, tokenFieldIds) {
  const m = modelsData.find(m => m.name === modelName);
  if (!m) return;
  if (m.provider === 'lmstudio' || m.provider === 'ollama') {
    for (const id of tokenFieldIds) {
      const el = document.getElementById(id);
      if (el && parseInt(el.value) > 1024) {
        el.value = 1024;
      }
    }
    saveScaffoldingToStorage();
  }
}
```

Wire into each model select's change listener with the relevant token field IDs.

**Default values in `llm-config.js` / `state.js`:** do NOT change the hardcoded `|| 16384` fallbacks — those remain correct for cloud providers. The token cap only applies when a local model is actively selected (event-driven, not at init time). On first load with a local model already saved in localStorage, `_applyLocalModelTokenCap` runs after restore to enforce the cap.

### 3. Diff Overlay On By Default

**`templates/index.html`:** add `checked` attribute to `#showChanges` (and any equivalent checkboxes in non-linear scaffoldings if they exist separately).

**`state.js` `loadScaffoldingFromStorage`:** all restore paths that read `s.input?.diff` should already fall back to `?? true`; verify and fix any that use `?? false` or no fallback.

### 4. Remove Graphics Subtab — Fold Into Input Section

**HTML changes:**
- Remove the `<button>` for the Graphics subtab in the subtab row
- Remove `<div class="subtab-pane" id="subtabGraphics">` and its contents
- Add Diff overlay + Opacity + Highlight color rows into the Input section of each scaffolding that supports diffing:
  - Linear / Linear+Interrupt scaffolding input section
  - RLM input section (`sf_rlm_input*`)
  - Three-System input section (`sf_ts_input*`)
  - Two-System input section
  - World Model harness input section

Since all scaffoldings share the same graphics canvas, these three controls are global — not per-scaffolding. They are placed once as a persistent **"Canvas"** section rendered below the scaffolding settings area, always visible regardless of which scaffolding is active. They live inside `#settingsColumns` so the auto-save `change` listener picks them up automatically.

### 5. Fix Opacity Slider + Persist Graphics

**Verify:** check whether `redrawGrid()` in `ui-grid.js` reads `document.getElementById('changeOpacity').value`. If it reads from a variable set at init time (not live from the DOM), the slider updates text but never affects rendering — this would be the bug.

**Fix:** ensure `redrawGrid()` reads the slider value live each call.

**Persist:** add `changeOpacity`, `changeColor`, and `showChanges` to a `getGraphicsSettings()` helper and save to `localStorage.setItem('arc_graphics', ...)`. Restore on init (before first render).

---

## Acceptance Criteria

- [ ] Selecting a model in Planner automatically selects the same model in Monitor and World Model selects (on scaffoldings that have them)
- [ ] Monitor or WM model can be changed independently without being overwritten by a later Planner change
- [ ] Selecting an LM Studio or Ollama model sets all token fields for that scaffolding to 1024 (if currently above 1024)
- [ ] Diff overlay checkbox is checked on first load (no prior localStorage)
- [ ] Graphics tab / subtab button is gone; diff overlay + opacity + color appear inline in settings
- [ ] Moving the opacity slider visually changes the diff overlay opacity on the canvas in real time
- [ ] Opacity value and highlight color persist across page refresh
- [ ] No regressions on existing scaffolding settings save/restore
- [ ] Import check passes: `python -c "from server.app import app; import db; import agent; import batch_runner; print('OK')"`

