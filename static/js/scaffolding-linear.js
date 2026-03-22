// Author: Claude Opus 4.6 (1M context)
// Date: 2026-03-15 18:00
// PURPOSE: Linear (single-turn) scaffolding prompt builder for ARC-AGI-3. Provides
//   buildClientPrompt() — constructs system + user messages for a single LLM call
//   with lexical grid encoding, action history, change map, tool instructions,
//   planning mode, compact context, and Anthropic prompt caching support.
//   Returns {system, user, cacheablePrefix} for provider-aware message splitting
//   and Anthropic prompt caching. cacheablePrefix contains the compact context
//   (stable between compaction cycles) for cache_control breakpoint placement.
//   Used by llm.js askLLM() for the default linear scaffolding type.
//   Depends on: getPrompt, gridToLexical, ARC3_LEXICAL_LEGEND (scaffolding.js),
//   extractJsonFromText (json-parsing.js)
// SRP/DRY check: Pass — linear prompt logic fully separated from other scaffolding types
// ═══════════════════════════════════════════════════════════════════════════
// SCAFFOLDING-LINEAR — Linear (single-turn) prompt builder
// Extracted from scaffolding.js — Phase 5 modularization
// Depends on: getPrompt (scaffolding.js), extractJsonFromText (json-parsing.js)
// ═══════════════════════════════════════════════════════════════════════════

function buildClientPrompt(state, history, changeMap, inputSettings, toolsMode, compactContext, planningMode) {
  const grid = state.grid || [];

  // ── System prompt (static per session — cacheable) ──
  const systemParts = [];
  const desc = getPrompt('shared.arc_description');
  const gridRepr = inputSettings.grid_repr || 'lp16';
  systemParts.push(`${desc}\n\nCOLOR PALETTE: ${COLOR_PALETTE}\n${getGridReprLegend(gridRepr)}`);

  // Inject agent priors
  const priors = getPrompt('shared.agent_priors');
  if (priors) {
    systemParts.push(`## AGENT MEMORY\n${priors}`);
  }

  // Task format instructions (static — same every call)
  const tm = toolsMode === 'on';
  const pm = planningMode && planningMode !== 'off';
  const planN = pm ? parseInt(planningMode) : 0;

  const toolInstr = tm ? `\n- You can write Python code blocks to analyse the grid. Wrap code in \\\`\\\`\\\`python fences. The variable \`grid\` is a numpy 2D int array. numpy, collections, itertools, math are available. Use print() for output. Code will be executed and results appended before your final answer.\n- Include "analysis" in your JSON with a summary of what you found.` : '';
  const analysisField = tm ? ', "analysis": "<detailed spatial analysis>"' : '';

  const interruptOn = document.getElementById('interruptPlan')?.checked;
  const expectedField = (pm && interruptOn) ? ', "expected": "<what you expect to see after this plan>"' : '';
  const expectedRule = (pm && interruptOn) ? '\n- "expected": briefly describe what you expect after the plan completes (e.g. "character at the door", "score increased").' : '';

  if (pm) {
    systemParts.push(`## YOUR TASK
1. Identify key objects (character, walls, targets, items).
2. Determine what must happen next to progress.
3. Plan a sequence of actions (up to ${planN} steps).

Respond with EXACTLY this JSON (nothing else):
{"observation": "<what you see>", "reasoning": "<your plan>", "plan": [{"action": <n>, "data": {}}, ...]${analysisField}${expectedField}}

Rules:
- Return a "plan" array of up to ${planN} steps. Each step has "action" (0-7) and "data" ({} or {"x": <0-63>, "y": <0-63>}).
- ACTION6: set "data" to {"x": <0-63>, "y": <0-63>}.
- Other actions: set "data" to {}.${expectedRule}${toolInstr}`);
  } else {
    systemParts.push(`## YOUR TASK
1. Identify key objects (character, walls, targets, items).
2. Determine what must happen next to progress.
3. Choose the best action.

Respond with EXACTLY this JSON (nothing else):
{"observation": "<what you see>", "reasoning": "<your plan>", "action": <number>, "data": {}${analysisField}}

Rules:
- "action" must be a plain integer (0-7).
- ACTION6: set "data" to {"x": <0-63>, "y": <0-63>}.
- Other actions: set "data" to {}.${toolInstr}`);
  }

  // ── User prompt — ordered for Anthropic prefix caching ──
  // Anthropic prompt caching matches an exact token prefix. For maximum cache hits,
  // we order blocks from MOST STABLE to MOST DYNAMIC:
  //   1. Compact context (stable ~5 calls between compactions)  → cacheablePrefix
  //   2. Old history (steps 1..N-1, identical to previous call) → cacheableHistory
  //   3. New step + STATE + CHANGES + GRID (dynamic every call) → user
  // This gives us three cache breakpoints: system, compact prefix, old history.
  let cacheablePrefix = null;
  let cacheableHistory = null;
  const userParts = [];

  // Compact context: stable between compaction cycles — first cacheable block
  if (compactContext) {
    cacheablePrefix = compactContext;
  }

  // History: append-only. Separate old entries (identical to previous call) from
  // the latest entry (new this call). Old entries form a cacheable prefix.
  if (history && history.length) {
    const reasoningTraceOn = document.getElementById('reasoningTrace')?.checked;
    const formatEntry = (h) => {
      let line = `  Step ${h.step || '?'}: ${ACTION_NAMES[h.action] || '?'} -> ${h.result_state || '?'}`;
      if (h.change_map && h.change_map.change_count > 0) {
        line += ` (${h.change_map.change_count} cells changed)`;
        if (h.change_map.change_map_text) line += `\n    Changes: ${h.change_map.change_map_text}`;
      } else if (h.change_map && h.change_map.change_count === 0) {
        line += ` (no change)`;
      }
      if (h.observation) line += ` | ${h.observation}`;
      if (reasoningTraceOn && h.reasoning) line += `\n    Reasoning: ${h.reasoning}`;
      if (h.grid) {
        const gridText = formatGrid(h.grid, gridRepr).split('\n').map(l => `    ${l}`).join('\n');
        line += `\n${gridText}`;
      }
      return line;
    };

    if (history.length > 1) {
      // Old history (all but last) — this text is IDENTICAL to what we sent last call
      const oldLines = history.slice(0, -1).map(formatEntry);
      cacheableHistory = `## HISTORY\n` + oldLines.join('\n');
      // New step — only the latest entry
      const newLine = formatEntry(history[history.length - 1]);
      userParts.push(`## LATEST STEP\n${newLine}`);
    } else {
      // Only one entry — no old history to cache
      userParts.push(`## HISTORY\n${formatEntry(history[0])}`);
    }
  }

  // Dynamic sections: STATE, CHANGES, GRID — change every call
  const actions = (state.available_actions || []).map(a => `${a}=${ACTION_NAMES[a] || 'ACTION'+a}`).join(', ');
  userParts.push(`## STATE\nGame: ${state.game_id} | State: ${state.state} | Levels: ${state.levels_completed}/${state.win_levels}\nAvailable actions: ${actions}`);

  if (inputSettings.diff && changeMap && changeMap.change_count > 0) {
    userParts.push(`## CHANGES (${changeMap.change_count} cells changed)\n${changeMap.change_map_text || ''}`);
  }

  if (gridRepr) {
    const gridText = formatGrid(grid, gridRepr);
    userParts.push(`## GRID (${getGridReprLabel(gridRepr)})\n${gridText}`);
  }

  const system = systemParts.join('\n\n');
  const user = userParts.join('\n\n');

  // Return structured object for provider-aware message building.
  // Cache breakpoints (Anthropic):
  //   1. system message  — static per session (always cached)
  //   2. cacheablePrefix — compact context (stable ~5 calls between compactions)
  //   3. cacheableHistory — old history entries (identical to previous call, cache hit every call)
  // Dynamic content (user) comes last to maximize prefix matching.
  return { system, user, cacheablePrefix, cacheableHistory };
}

// parseClientLLMResponse / parseLLMResponse — defined in utils/json-parsing.js (loaded before scaffolding.js)
