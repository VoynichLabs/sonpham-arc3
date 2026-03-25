# Plan: Scaffolding Caching Audit + Agent Spawn Restore
**Date:** 2026-03-25
**Author:** Claude Sonnet 4.6

---

## Scope

### In scope
1. Verify Linear and Linear w/ Interrupt have correct prompt caching (they do — confirm and document)
2. Verify RGB Bash tool uses local Pyodide sandbox (it does — confirm and document)
3. Restore Agent Spawn harness to the UI with Anthropic prompt caching on all orchestrator + subagent LLM calls

### Out of scope
- RLM, Three-System, Two-System, World Model (stay removed)
- Server-side caching or any backend changes
- Changing RGB tool behaviour

---

## Architecture

### 1. Linear/Linear w/ Interrupt — Caching Status (ALREADY CORRECT)

`scaffolding-linear.js:buildClientPrompt()` returns `{system, user, cacheablePrefix, cacheableHistory}`:
- `cacheablePrefix` = compact context block (stable between compaction cycles)
- `cacheableHistory` = old history entries (history[0..N-2], identical to previous call)

`llm.js:askLLM()` wraps these as `_linearMsgs` with `_cacheablePrefix` and `_cacheableHistory` fields.

`scaffolding.js:_callLLMInner()` for Anthropic provider:
- System message → `cache_control: {type: 'ephemeral'}` (always cached, static per session)
- cacheablePrefix → `cache_control: {type: 'ephemeral'}` (stable until compaction)
- cacheableHistory → `cache_control: {type: 'ephemeral'}` (identical to last call = cache hit every call)
- Dynamic content (new step, STATE, GRID, CHANGES) → no cache_control (new every call)

**Conclusion**: Three cache breakpoints already in place. "After receiving" is covered: the response on call N becomes the new history entry, which on call N+1 is the tail of cacheableHistory — so it is cached on the next call. No changes needed.

### 2. RGB Bash Tool — Local Sandbox Status (ALREADY CORRECT)

`scaffolding-rgb.js:rgbExecuteTool()` for `bash` case:
- Calls `runPyodide(fullCode, grid, prevGrid, sessionId)` if `typeof runPyodide === 'function' && _pyodideReady`
- Falls back to `[Error: Python sandbox (Pyodide) not available]` if Pyodide not loaded
- Read and Grep tools run in pure JS — always available regardless of Pyodide

**Conclusion**: RGB uses the local Pyodide sandbox. No changes needed to RGB.

### 3. Agent Spawn — Restore with Prompt Caching

#### What was removed (commit 61d29f2)
- Schema from `SCAFFOLDING_SCHEMAS` in `scaffolding-schemas.js`
- `scaffolding-agent-spawn.js` from `build_assets.sh` bundle list

#### What was NOT removed
- `scaffolding-agent-spawn.js` itself (kept on disk, just not bundled)
- `askLLMAgentSpawn` call path in `llm.js:askLLM()` (still routed)

#### Caching to add to Agent Spawn

**Currently: no caching at all.** Every `callLLM` call passes raw flat messages.

**Orchestrator calls** (inside the `for (let turn = 1; ...)` loop):
```js
callLLM([{role: 'system', content: prompt}], orchModel, {...})
```
The `prompt` is the full AS_ORCHESTRATOR_PREMISE + AS_GAME_REFERENCE + dynamic state. The static parts (AS_ORCHESTRATOR_PREMISE, AS_GAME_REFERENCE) are large and identical every turn. We should split:
- System part: `AS_ORCHESTRATOR_PREMISE + '\n\n' + AS_GAME_REFERENCE` → cache on system message
- User part: current state block (dynamic per turn)

**Subagent calls** (inside the `for (let si = 0; ...)` reactive loop):
```js
callLLM(subMessages, subModel, {...})
```
`subMessages` grows each iteration: `[system, user1, assistant1, user2, assistant2, ...]`.
- The system message is static per subagent type → cache it
- Growing conversation: for Anthropic, we can add `cache_control` to the last user message that will be repeated (all but the very latest turn). Mark the penultimate user message as cacheable so the growing conversation prefix is cached.

#### Schema to restore for Agent Spawn

Needs to be added to `SCAFFOLDING_SCHEMAS` with these sections:
- Orchestrator: model select, thinking (High default), max tokens
- Subagent: model select, thinking (Med default), max tokens
- Params: max subagent budget, orchestrator max turns, orchestrator history length
- Model Keys (byokKeysContainer)

Also needs wiring in `_populateAllModelSelects()` in `scaffolding.js` for `sf_as_orchestratorModelSelect` and `sf_as_subagentModelSelect` (which was removed in 61d29f2 — needs to be re-added).

---

## TODOs (ordered)

1. **[DONE — no changes]** Confirm Linear/Linear w/ Interrupt caching is correct
2. **[DONE — no changes]** Confirm RGB uses Pyodide local sandbox for Bash
3. **Re-add Agent Spawn schema** to `scaffolding-schemas.js` (orchestrator model select, subagent model select, params, keys)
4. **Re-add model select population** for `sf_as_orchestratorModelSelect` + `sf_as_subagentModelSelect` in `scaffolding.js:_populateAllModelSelects()`
5. **Add prompt caching to `scaffolding-agent-spawn.js`**:
   - Orchestrator: split `AS_ORCHESTRATOR_PREMISE + AS_GAME_REFERENCE` into system message (cached), dynamic state into user message
   - Subagents: split `systemPrompt + AS_GAME_REFERENCE` into system message (cached), first user message with task; on multi-turn iterations, mark all but last user message with `_cacheableHistory` so growing conversation is cached
6. **Add `scaffolding-agent-spawn.js` back to `build_assets.sh`** (after `scaffolding-linear.js`)
7. **Rebuild bundle** (`bash scripts/build_assets.sh`)
8. **Update CHANGELOG.md**
9. **Push to staging, verify Agent Spawn is selectable and runs**

---

## Verification Steps

- [ ] Agent Spawn appears in the Harness dropdown
- [ ] Model selects for orchestrator and subagent populate correctly
- [ ] Running agent spawn on LS20: confirm orchestrator delegates to subagents, subagents execute steps
- [ ] In browser console: confirm Anthropic logs show `[Anthropic] Cache hit: N tokens read from cache` on orchestrator turn 2+ and subagent iteration 2+
- [ ] Linear: confirm cache hits still appear on turn 2+ (no regression)
- [ ] RGB: confirm Read/Grep work, Bash works if Pyodide is loaded

---

## Docs / Changelog

- `CHANGELOG.md`: Add entry for Agent Spawn restore + caching
