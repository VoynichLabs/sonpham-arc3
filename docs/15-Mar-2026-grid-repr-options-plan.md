# Grid Representation Options — Plan

## Scope

**In**: Replace the "Full grid (RLE)" toggle across all harnesses with a `<select>` dropdown offering three grid representation formats. Remove RLE from diff maps too.

**Out**: RGB scaffolding (has no input section), batch runner/agent.py (server-side), share.html.

## Current State

- All harnesses have a toggle `inputGrid` / `sf_*_inputGrid` → "Full grid (RLE)" (on/off)
- Linear uses `gridToLexical()` (mnemonic chars), all others use `compressRowJS()` (RLE)
- Diff maps (`computeChangeMapJS()`) use RLE compression (`Xx3 .x5 X`)
- Settings read via `getInputSettings()` / `getScaffoldingSettings()` as `full_grid: boolean`

## Architecture

### New Grid Representation Options

Replace toggle with a `<select>` offering:

| Value | Label | Format |
|-------|-------|--------|
| `numeric` | Numeric Grid | Space-separated integers per row: `0 0 5 5 0 14 14 0` |
| `rgb` | RGB-Agent | ASCII density ramp (70-char palette), maps 0-15 to brightness chars |
| `lp16` | LP16 | Existing `gridToLexical()` — mnemonic chars (`.1234KMmRBbYOrGP`) |

Default: `lp16` (most informative for LLMs, preserves color identity).

### Schema Change

In `scaffolding-schemas.js`, replace:
```js
{ type: 'toggle', id: 'inputGrid', label: 'Full grid (RLE)', default: true }
```
with:
```js
{ type: 'select', id: 'inputGrid', label: 'Grid representation',
  options: [{v:'lp16',l:'LP16'},{v:'numeric',l:'Numeric'},{v:'rgb',l:'RGB-Agent'}],
  default: 'lp16' }
```

Same for all `sf_*_inputGrid` fields.

### New Rendering

Add `case 'select': return renderSelect(f);` to `renderField()` in `state.js`.

### Settings Reading

Change `full_grid: boolean` → `grid_repr: string` in `getInputSettings()` and all per-harness input blocks in `getScaffoldingSettings()`. Read from `<select>.value` instead of `<input>.checked`.

### Grid Encoding Functions

In `scaffolding.js`:
- Keep `gridToLexical()` (= LP16)
- Add `gridToNumeric(grid)` — space-separated integers
- Add `gridToRgbAgent(grid)` — ASCII density ramp
- Add `formatGrid(grid, repr)` — dispatcher that calls the right function
- Add `formatDiffMap(prevGrid, currGrid, repr)` — non-RLE diff using the same encoding

### Diff Map Without RLE

Replace `computeChangeMapJS()`'s RLE compression with a per-cell diff that shows `from→to` using the selected representation, or a simple mask (`X`=changed, `.`=same) without RLE compression.

### Consumer Updates

Each scaffolding file that builds prompts needs updating:

1. **scaffolding-linear.js** `buildClientPrompt()` — use `formatGrid()` instead of `gridToLexical()` directly; use non-RLE diff; history grids also use `formatGrid()`
2. **scaffolding-three-system.js** — `_tsHandleWmQuery()` grid tool and `askLLMThreeSystem()` grid block use `formatGrid()`
3. **scaffolding-agent-spawn.js** — `_asRenderGrid()`, `_asDiffFrames()`, `_buildContext()`, `_buildHistoryBlock()` use `formatGrid()`
4. **scaffolding-rlm.js** — context dict grid formatting (currently done via context JSON, not RLE in prompt)
5. **engine.js** `computeChangeMapJS()` — remove RLE, output raw `X`/`.` mask

## TODOs

1. Add `gridToNumeric()`, `gridToRgbAgent()`, `formatGrid()` to `scaffolding.js`
2. Update `computeChangeMapJS()` in `engine.js` — remove RLE from change map text
3. Replace toggle → select in all input field arrays in `scaffolding-schemas.js`
4. Add `renderSelect()` to `state.js`
5. Update `getInputSettings()` and all `getScaffoldingSettings()` blocks in `llm-config.js`
6. Update `buildClientPrompt()` in `scaffolding-linear.js`
7. Update grid usage in `scaffolding-three-system.js`
8. Update grid usage in `scaffolding-agent-spawn.js`
9. Update file headers, CHANGELOG

## Docs / Changelog

- CHANGELOG entry under current version
- Update file headers on all touched files
