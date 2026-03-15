// Author: Claude Opus 4.6
// Date: 2026-03-15 14:00
// PURPOSE: RGB (Read-Grep-Bash) harness for ARC-AGI-3 web UI. Adapts the RGB Agent
//   architecture (github.com/alexisfox7/RGB-Agent) to client-side execution. The analyzer
//   LLM reads a game log file using text-based tool calls (Read/Grep/Bash), then outputs
//   a batched JSON action plan. Actions drain from a queue with zero LLM calls; queue
//   flushes on score change. Tools are text-based (<tool_call>/<tool_result> XML tags) so
//   they work with ALL providers (Gemini, Groq, Mistral, LM Studio, Anthropic, OpenAI, etc.).
// SRP/DRY check: Pass — RGB-specific logic isolated here; reuses callLLM, runPyodide, engine.js

// ═══════════════════════════════════════════════════════════════════════════
// RGB ACTION QUEUE — Parses JSON action plans, drains one per step
// ═══════════════════════════════════════════════════════════════════════════

class RGBActionQueue {
  constructor() {
    this._queue = [];
    this.planTotal = 0;
    this.planIndex = 0;
    this._lastScore = 0;
    this.scoreChanged = false;
  }

  clear() {
    this._queue = [];
    this.planTotal = 0;
    this.planIndex = 0;
  }

  reset() {
    this.clear();
    this._lastScore = 0;
    this.scoreChanged = false;
  }

  get length() { return this._queue.length; }
  get empty() { return this._queue.length === 0; }

  pop() {
    const action = this._queue.shift();
    this.planIndex++;
    return action;
  }

  checkScore(score) {
    if (score !== this._lastScore) {
      if (this._queue.length > 0) {
        console.log(`[RGB] Score ${this._lastScore}->${score}: flushing ${this._queue.length} queued actions`);
        this.clear();
      }
      this.scoreChanged = true;
      this._lastScore = score;
    }
  }

  /** Parse [ACTIONS] JSON and load the queue. Returns true on success. */
  load(actionsText) {
    const clean = actionsText.replace(/```(?:json)?\s*/g, '').trim();
    let parsed = null;

    for (const char of ['{', '[']) {
      const idx = clean.indexOf(char);
      if (idx >= 0) {
        try {
          parsed = JSON.parse(clean.slice(idx));
          break;
        } catch { /* try next */ }
      }
    }

    if (!parsed) {
      console.warn('[RGB] ActionQueue.load: could not parse:', actionsText.slice(0, 200));
      return false;
    }

    if (Array.isArray(parsed)) parsed = { plan: parsed, reasoning: '' };

    const plan = parsed.plan || parsed.actions || [];
    if (!Array.isArray(plan) || !plan.length) {
      console.warn('[RGB] ActionQueue.load: empty or invalid plan');
      return false;
    }

    const VALID = new Set(['ACTION1','ACTION2','ACTION3','ACTION4','ACTION5','ACTION6','RESET']);
    this._queue = [];

    for (const step of plan) {
      let name, data;
      if (typeof step === 'string') {
        const m = step.match(/ACTION6\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (m) { name = 'ACTION6'; data = { x: parseInt(m[1]), y: parseInt(m[2]) }; }
        else { name = step; data = {}; }
      } else {
        name = step.action;
        if (!name) continue;
        data = name === 'ACTION6' ? { x: parseInt(step.x || 0), y: parseInt(step.y || 0) } : {};
      }
      if (!VALID.has(name)) { console.warn('[RGB] Skipping unrecognized action:', name); continue; }
      this._queue.push({ name, data });
    }

    this.planTotal = this._queue.length;
    this.planIndex = 0;
    const reasoning = parsed.reasoning || '';
    console.log(`[RGB] Loaded ${this.planTotal}-step plan: ${this._queue.map(a => a.name).join(',')} — ${reasoning.slice(0, 100)}`);
    return true;
  }

  /** Serialize queue state for session save */
  serialize() {
    return {
      queue: [...this._queue],
      planTotal: this.planTotal,
      planIndex: this.planIndex,
      lastScore: this._lastScore,
    };
  }

  /** Restore from serialized state */
  restore(data) {
    if (!data) return;
    this._queue = data.queue || [];
    this.planTotal = data.planTotal || 0;
    this.planIndex = data.planIndex || 0;
    this._lastScore = data.lastScore || 0;
    this.scoreChanged = false;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// RGB GAME LOG — Builds the prompt log text that the analyzer reads
// ═══════════════════════════════════════════════════════════════════════════

class RGBGameLog {
  constructor() {
    this._lines = [];
    this._snapshots = []; // [{atStep, lineCount}] for scrubber support
  }

  reset() {
    this._lines = [];
    this._snapshots = [];
  }

  get text() { return this._lines.join('\n'); }
  get lineCount() { return this._lines.length; }

  /** Log the initial board state at game start */
  logInitialState(grid, score, state, gameId) {
    this._lines.push('='.repeat(80));
    this._lines.push(`Action 0 | INITIAL STATE`);
    this._lines.push(`Game: ${gameId} | Score: ${score} | State: ${state}`);
    this._lines.push('='.repeat(80));
    this._lines.push('');
    this._lines.push('[INITIAL BOARD STATE]');
    this._lines.push(`Score: ${score}`);
    this._appendGrid(grid);
    this._lines.push('');
    this._snapshots.push({ atStep: 0, lineCount: this._lines.length });
  }

  /** Log an action and its result */
  logAction(actionNum, actionName, score, state, grid, levelNum, planStep, planTotal) {
    this._lines.push('='.repeat(80));
    const planInfo = planTotal > 0 ? ` | Plan Step ${planStep}/${planTotal}` : '';
    this._lines.push(`Action ${actionNum} | Level ${levelNum}${planInfo}`);
    this._lines.push(`Score: ${score} | State: ${state}`);
    this._lines.push('='.repeat(80));
    this._lines.push('');
    this._lines.push('[POST-ACTION BOARD STATE]');
    this._lines.push(`Score: ${score}`);
    this._appendGrid(grid);
    this._lines.push('');
    this._snapshots.push({ atStep: actionNum, lineCount: this._lines.length });
  }

  /** Log analyzer strategic analysis */
  logAnalysis(actionNum, analysis) {
    this._lines.push(`[STRATEGIC ANALYSIS at action ${actionNum}]`);
    this._lines.push(analysis);
    this._lines.push('');
  }

  /** Get log text up to a specific step (for scrubber) */
  getTextAtStep(step) {
    for (let i = this._snapshots.length - 1; i >= 0; i--) {
      if (this._snapshots[i].atStep <= step) {
        return this._lines.slice(0, this._snapshots[i].lineCount).join('\n');
      }
    }
    return '';
  }

  _appendGrid(grid) {
    if (!grid || !grid.length) { this._lines.push('(empty grid)'); return; }
    // ASCII rendering similar to RGB Agent's format_grid_ascii
    const palette = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1EG[]?-_+~<>i!lI;:,\"^`'. ";
    const n = palette.length;
    for (const row of grid) {
      let chars = '';
      for (const v of row) {
        const idx = Math.min(Math.floor((Math.max(0, Math.min(15, v)) / 16) * (n - 1)), n - 1);
        chars += palette[idx];
      }
      this._lines.push(chars);
    }
  }

  /** Serialize for session save */
  serialize() {
    return { lines: [...this._lines], snapshots: [...this._snapshots] };
  }

  /** Restore from serialized state */
  restore(data) {
    if (!data) return;
    this._lines = data.lines || [];
    this._snapshots = data.snapshots || [];
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// RGB TOOL EXECUTION — Read, Grep, Bash (text-based, universal provider)
// ═══════════════════════════════════════════════════════════════════════════

const RGB_LOG_PATH = '/workspace/game_log.txt';

const RGB_TOOL_DESCRIPTIONS = `You have access to three tools. To use a tool, include a <tool_call> block in your response:

<tool_call>
<name>TOOL_NAME</name>
<input>JSON_INPUT</input>
</tool_call>

Available tools:

1. **read** — Read the game prompt log file.
   Input: {"file_path": "${RGB_LOG_PATH}", "offset": LINE_NUMBER, "limit": NUM_LINES}
   "offset" and "limit" are optional. Without them, the full file is returned.

2. **grep** — Search the game prompt log for a regex pattern. Returns matching lines with line numbers.
   Input: {"pattern": "REGEX_PATTERN", "file_path": "${RGB_LOG_PATH}"}

3. **bash** — Execute Python code. numpy, collections, itertools, math, re are available.
   Input: {"command": "python3 -c \\"PYTHON_CODE\\""}
   The game log file is available at ${RGB_LOG_PATH} for Python file operations.

You may call multiple tools in sequence. After each tool call, you will receive the result in a <tool_result> block.
When you are done analyzing, output your final response with [PLAN] and [ACTIONS] sections.`;


/** Parse <tool_call> blocks from LLM response text */
function rgbParseToolCalls(text) {
  const calls = [];
  const re = /<tool_call>\s*<name>\s*(.*?)\s*<\/name>\s*<input>\s*([\s\S]*?)\s*<\/input>\s*<\/tool_call>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim().toLowerCase();
    let input;
    try { input = JSON.parse(m[2].trim()); } catch { input = { raw: m[2].trim() }; }
    calls.push({ name, input });
  }
  return calls;
}

/** Execute a single RGB tool call, return result string */
async function rgbExecuteTool(name, input, gameLog, sessionId) {
  switch (name) {
    case 'read': {
      const logText = gameLog.text;
      if (input.offset != null || input.limit != null) {
        const lines = logText.split('\n');
        const start = Math.max(0, parseInt(input.offset) || 0);
        const count = parseInt(input.limit) || lines.length;
        return lines.slice(start, start + count).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
      }
      return logText;
    }

    case 'grep': {
      const pattern = input.pattern || input.raw || '';
      const logText = gameLog.text;
      const lines = logText.split('\n');
      const results = [];
      try {
        const re = new RegExp(pattern, 'gi');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${i + 1}: ${lines[i]}`);
            re.lastIndex = 0; // reset for global regex
          }
        }
      } catch (e) {
        return `Error: Invalid regex pattern: ${e.message}`;
      }
      return results.length ? results.join('\n') : '(no matches)';
    }

    case 'bash': {
      let cmd = input.command || input.raw || '';
      // Extract Python code from "python3 -c '...'" or "python -c '...'" wrapper
      const pyMatch = cmd.match(/python3?\s+-c\s+(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))/);
      let code;
      if (pyMatch) {
        code = pyMatch[1] || pyMatch[2] || pyMatch[3] || '';
      } else {
        // Treat the whole command as Python code
        code = cmd;
      }
      // Make the game log available as a file in the Python sandbox
      // We prepend code to write the log to the expected path
      const logSetup = `
import os
os.makedirs('/workspace', exist_ok=True)
with open('${RGB_LOG_PATH}', 'w') as f:
    f.write(${JSON.stringify(gameLog.text)})
`;
      const fullCode = logSetup + '\n' + code;
      try {
        if (typeof runPyodide === 'function' && _pyodideReady) {
          const grid = window._lastLLMGrid || [[]];
          const prevGrid = window._lastLLMPrevGrid || null;
          return await runPyodide(fullCode, grid, prevGrid, sessionId);
        }
        return '[Error: Python sandbox (Pyodide) not available. Enable it in settings.]';
      } catch (e) {
        return `[Error: ${e.message}]`;
      }
    }

    default:
      return `[Error: Unknown tool "${name}"]`;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// RGB PROMPTS — Adapted from RGB Agent prompts.py
// ═══════════════════════════════════════════════════════════════════════════

function rgbBuildInitialPrompt(logPath, planSize) {
  return `You are a strategic advisor for an AI agent playing a grid-based puzzle game.
The agent's full prompt log for this run is at this ABSOLUTE path: ${logPath}

You may only access this single file (use its absolute path directly with read and grep).

Most games have some form of timer mechanism. A score increase means a level was solved.

Deeply analyze this log to understand what the agent has been doing, what has worked,
what hasn't, and what patterns explain the game's behavior.

${RGB_TOOL_DESCRIPTIONS}

Bash (and therefore Python) is available to you. **Always** use Python to
parse the board — do NOT try to visually read the ASCII grid.

The log file uses section markers to delimit board grids:
  [INITIAL BOARD STATE]   — the grid at the start (after Action 0 header)
  [POST-ACTION BOARD STATE] — the grid after each action

To extract the latest board into a matrix:
\`\`\`python
import re
data = open('${logPath}').read()
boards = re.split(r'\\[(?:POST-ACTION|INITIAL) BOARD STATE\\]', data)
last_board = boards[-1].strip()
lines = last_board.split('\\n')
if lines[0].startswith('Score:'):
    lines = lines[1:]
grid = [list(row) for row in lines if row.strip()]
\`\`\`

Your response MUST contain ALL sections below — the agent cannot act without [ACTIONS]:
1. A detailed strategic briefing (explain your reasoning, be specific with coordinates)
2. Followed by exactly this separator and a 2-3 sentence action plan:

[PLAN]
<concise action plan the agent should follow until the next analysis>

3. Followed by exactly this separator and a JSON action plan (REQUIRED):

[ACTIONS]
{"plan": [{"action": "ACTION1"}, {"action": "ACTION6", "x": 3, "y": 7}, ...], "reasoning": "why these steps"}

Available actions: ACTION1-4 (moves), ACTION6 (click at x,y), ACTION5 (no-op), RESET.
Each action MUST be a JSON object. Plan 1-${planSize} actions.
IMPORTANT: shorter plans (3-5 steps) are strongly preferred because the agent can
re-evaluate sooner. Only use more than 5 if you have very high confidence.`;
}

function rgbBuildResumePrompt(logPath, planSize) {
  return `The prompt log has grown since your last analysis. The log file is at: ${logPath}

Re-read the latest actions (from where you left off) and update your strategic briefing.
Focus on what changed: new moves, score transitions, and whether the agent followed
your previous plan or diverged. Parse the board programmatically from the file using
section markers ([POST-ACTION BOARD STATE], etc.) — do NOT visually copy the grid.

${RGB_TOOL_DESCRIPTIONS}

Bash (and therefore Python) is available to you. **Always** use Python to parse the board.

Your response MUST contain ALL sections below — the agent cannot act without [ACTIONS]:
1. A detailed strategic briefing (explain your reasoning, be specific with coordinates)

[PLAN]
<concise action plan the agent should follow until the next analysis>

[ACTIONS]
{"plan": [{"action": "ACTION1"}, ...], "reasoning": "why these steps"}

Available actions: ACTION1-4 (moves), ACTION6 (click at x,y), ACTION5 (no-op), RESET.
Plan 1-${planSize} actions. Shorter plans (3-5 steps) preferred.`;
}


// ═══════════════════════════════════════════════════════════════════════════
// RGB ANALYZER — Multi-turn tool-calling conversation loop
// ═══════════════════════════════════════════════════════════════════════════

/** Per-session RGB state, keyed by sessionId */
const _rgbSessions = new Map();

function getRGBState(sessionId) {
  if (!_rgbSessions.has(sessionId)) {
    _rgbSessions.set(sessionId, {
      gameLog: new RGBGameLog(),
      actionQueue: new RGBActionQueue(),
      analyzerCallCount: 0,
      conversationHistory: [], // persistent multi-turn history for session continuity
    });
  }
  return _rgbSessions.get(sessionId);
}

function resetRGBState(sessionId) {
  _rgbSessions.delete(sessionId);
}


/**
 * Main entry point — called from askLLM() in llm.js when scaffolding === 'rgb'.
 *
 * Returns a response object compatible with the existing askLLM flow:
 *   { parsed: { action, data, plan?, observation?, reasoning? }, model, scaffolding, ... }
 */
async function askLLMRgb(_cur, model, modelInfo, waitEl, isActiveFn, historyForLLM, compactBlock, _snap) {
  const sessionId = _cur.sessionId || activeSessionId;
  const rgb = getRGBState(sessionId);
  const settings = _snap || getScaffoldingSettings();
  const planSize = parseInt(settings.rgb_plan_size) || 5;
  const maxIter = parseInt(settings.rgb_max_tool_iterations) || 15;
  const maxTokens = parseInt(settings.max_tokens) || 16384;
  const thinkingLevel = settings.thinking_level || 'off';

  // ── Step 1: Update game log with current state ──
  const state = _cur.currentState;
  const grid = state.grid || [];
  const score = state.levels_completed || 0;
  const gameState = state.state || 'PLAYING';
  const gameId = state.game_id || 'unknown';
  const stepCount = _cur.stepCount || 0;

  if (rgb.gameLog.lineCount === 0) {
    // First call — log initial state
    rgb.gameLog.logInitialState(grid, score, gameState, gameId);
  }

  // Check if we can drain from queue
  rgb.actionQueue.checkScore(score);

  if (!rgb.actionQueue.empty && !rgb.actionQueue.scoreChanged) {
    // Drain action from queue — zero LLM cost
    const queued = rgb.actionQueue.pop();
    const label = `plan step ${rgb.actionQueue.planIndex}/${rgb.actionQueue.planTotal}`;
    console.log(`[RGB] Queue drain -> ${queued.name} (${label}, ${rgb.actionQueue.length} remaining)`);

    const actionNum = ACTION_MAP_REVERSE[queued.name] || 0;
    const resp = {
      parsed: {
        action: actionNum,
        data: queued.data || {},
        observation: `[RGB Queue] Executing ${queued.name} (${label})`,
        reasoning: `Pre-planned action from analyzer batch plan.`,
      },
      model: model,
      scaffolding: 'rgb',
      usage: { input_tokens: 0, output_tokens: 0 },
      rgb: {
        source: 'queue',
        planStep: rgb.actionQueue.planIndex,
        planTotal: rgb.actionQueue.planTotal,
        queueRemaining: rgb.actionQueue.length,
      },
    };
    return resp;
  }

  // Reset score change flag
  rgb.actionQueue.scoreChanged = false;

  // ── Step 2: Fire analyzer ──
  console.log(`[RGB] Queue empty — firing analyzer (call #${rgb.analyzerCallCount + 1})`);

  if (isActiveFn()) {
    const previewEl = waitEl.querySelector('.stream-preview');
    if (previewEl) {
      previewEl.style.display = 'block';
      previewEl.textContent = 'RGB Analyzer: reading game log...';
    }
  }

  const isFirst = rgb.analyzerCallCount === 0;
  const prompt = isFirst
    ? rgbBuildInitialPrompt(RGB_LOG_PATH, planSize)
    : rgbBuildResumePrompt(RGB_LOG_PATH, planSize);

  // Build conversation: system + user prompt
  // For session continuity, we maintain conversation history
  let messages;
  if (isFirst || rgb.conversationHistory.length === 0) {
    messages = [{ role: 'user', content: prompt }];
    rgb.conversationHistory = [...messages];
  } else {
    // Resume: add new user message to existing conversation
    rgb.conversationHistory.push({ role: 'user', content: prompt });
    messages = [...rgb.conversationHistory];
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let fullAnalysis = '';
  let toolCallLog = [];

  // ── Step 3: Multi-turn tool loop ──
  for (let iter = 0; iter < maxIter; iter++) {
    if (isActiveFn()) {
      const previewEl = waitEl.querySelector('.stream-preview');
      if (previewEl) {
        previewEl.style.display = 'block';
        previewEl.textContent = `RGB Analyzer: iteration ${iter + 1}/${maxIter}...`;
      }
    }

    let rawText;
    try {
      rawText = await callLLM(messages, model, { maxTokens, thinkingLevel });
    } catch (e) {
      console.error('[RGB] LLM call failed:', e);
      throw e;
    }

    // Track tokens
    if (callLLM._lastUsage) {
      totalInputTokens += callLLM._lastUsage.input_tokens || 0;
      totalOutputTokens += callLLM._lastUsage.output_tokens || 0;
    }

    // Parse tool calls from response
    const toolCalls = rgbParseToolCalls(rawText);

    if (toolCalls.length === 0) {
      // No tool calls — this should be the final response with [ACTIONS]
      fullAnalysis = rawText;
      rgb.conversationHistory.push({ role: 'assistant', content: rawText });
      break;
    }

    // Execute tool calls and build result text
    let resultText = '';
    for (const tc of toolCalls) {
      const output = await rgbExecuteTool(tc.name, tc.input, rgb.gameLog, sessionId);
      const truncOutput = output.length > 8000 ? output.slice(0, 8000) + '\n... [truncated]' : output;
      resultText += `<tool_result>\n<name>${tc.name}</name>\n<output>${truncOutput}</output>\n</tool_result>\n\n`;
      toolCallLog.push({ name: tc.name, input: tc.input, outputLen: output.length });
    }

    // Append assistant response + tool results to conversation
    rgb.conversationHistory.push({ role: 'assistant', content: rawText });
    rgb.conversationHistory.push({ role: 'user', content: resultText });
    messages = [...rgb.conversationHistory];

    // Check if [ACTIONS] is in the response (some models output tools AND actions together)
    if (rawText.includes('[ACTIONS]')) {
      fullAnalysis = rawText;
      break;
    }
  }

  rgb.analyzerCallCount++;

  // ── Step 4: Parse [PLAN] and [ACTIONS] from analysis ──
  let hint = fullAnalysis;
  let actionsText = null;
  let planText = '';

  if (hint.includes('\n[ACTIONS]\n')) {
    const parts = hint.split('\n[ACTIONS]\n');
    hint = parts[0];
    actionsText = parts[1].trim();
  } else if (hint.includes('[ACTIONS]')) {
    const idx = hint.indexOf('[ACTIONS]');
    actionsText = hint.slice(idx + '[ACTIONS]'.length).trim();
    hint = hint.slice(0, idx);
  }

  if (hint.includes('\n[PLAN]\n')) {
    const parts = hint.split('\n[PLAN]\n');
    hint = parts[0].trim();
    planText = parts[1].trim();
  } else if (hint.includes('[PLAN]')) {
    const idx = hint.indexOf('[PLAN]');
    planText = hint.slice(idx + '[PLAN]'.length).trim();
    hint = hint.slice(0, idx).trim();
  }

  // Log analysis to game log
  if (hint) {
    rgb.gameLog.logAnalysis(stepCount, planText || hint.slice(0, 500));
  }

  // Load action queue
  let loaded = false;
  if (actionsText) {
    loaded = rgb.actionQueue.load(actionsText);
  }

  if (!loaded) {
    console.warn('[RGB] Analyzer returned no valid [ACTIONS] — falling back to ACTION5 (no-op)');
    return {
      parsed: { action: 5, data: {}, observation: '[RGB] Analyzer failed to produce actions', reasoning: hint || 'No response' },
      model, scaffolding: 'rgb',
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      rgb: { source: 'fallback', toolCalls: toolCallLog },
    };
  }

  // Pop first action from queue
  const firstAction = rgb.actionQueue.pop();
  const actionNum = ACTION_MAP_REVERSE[firstAction.name] || 0;

  return {
    parsed: {
      action: actionNum,
      data: firstAction.data || {},
      observation: planText || hint.slice(0, 300),
      reasoning: hint,
    },
    model,
    scaffolding: 'rgb',
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    rgb: {
      source: 'analyzer',
      analyzerCallCount: rgb.analyzerCallCount,
      toolCalls: toolCallLog,
      planStep: rgb.actionQueue.planIndex,
      planTotal: rgb.actionQueue.planTotal,
      queueRemaining: rgb.actionQueue.length,
      planText: planText,
      hint: hint.slice(0, 500),
    },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// RGB POST-STEP HOOK — Called after each game step to update the game log
// ═══════════════════════════════════════════════════════════════════════════

/** Called after gameStep() completes to update the RGB game log. */
function rgbPostStep(sessionId, actionNum, actionName, state) {
  const rgb = _rgbSessions.get(sessionId);
  if (!rgb) return;

  const grid = state.grid || [];
  const score = state.levels_completed || 0;
  const gameState = state.state || 'PLAYING';
  const levelNum = (state.levels_completed || 0) + 1;
  const planStep = rgb.actionQueue.planIndex;
  const planTotal = rgb.actionQueue.planTotal;

  rgb.gameLog.logAction(actionNum, actionName, score, gameState, grid, levelNum, planStep, planTotal);
}


// ═══════════════════════════════════════════════════════════════════════════
// ACTION MAP — String action names to numeric IDs
// ═══════════════════════════════════════════════════════════════════════════

const ACTION_MAP_REVERSE = {
  'ACTION1': 1, 'ACTION2': 2, 'ACTION3': 3, 'ACTION4': 4,
  'ACTION5': 5, 'ACTION6': 6, 'ACTION7': 7, 'RESET': 0,
};
