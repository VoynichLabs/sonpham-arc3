// Author: Mark Barney + Claude Opus 4.6
// Date: 2026-03-15 14:00
// PURPOSE: Observatory Memory Panel + Files Panel. Derives agent memory state by
//   replaying moveHistory entries. Also renders the Files panel for RGB harness
//   (game prompt log). Supports: Linear, RLM, Three-System/Two-System, Agent Spawn, RGB.
// SRP/DRY check: Pass — memory tracking and files rendering colocated as observatory panels

// ── MemoryStateTracker ──────────────────────────────────────────

class MemoryStateTracker {
  constructor() {
    this.reset();
    this._checkpoints = []; // [{idx, snapshot}] every N steps
    this._checkpointInterval = 20;
  }

  reset() {
    this.scaffolding = null;
    this.observations = [];
    this.compactSummary = '';
    this.rulesDoc = '';
    this.rulesVersion = 0;
    this.rlmVars = {};       // name -> type string
    this.facts = [];
    this.hypotheses = [];
    this.agentStack = [];
    this.turnCount = 0;
    this.stepIndex = -1;
    this._checkpoints = [];
  }

  /** Process one moveHistory entry to accumulate state */
  processStep(entry, idx) {
    this.stepIndex = idx;
    const resp = entry.llm_response;
    if (!resp) return; // human step or follower — no new memory

    // Detect scaffolding type from first response
    if (!this.scaffolding && resp.scaffolding) {
      this.scaffolding = resp.scaffolding;
    }

    this.turnCount++;

    // Observation from parsed response (all scaffoldings)
    if (resp.parsed?.observation) {
      this.observations.push({
        step: entry.step || idx + 1,
        text: resp.parsed.observation,
      });
    }

    // Scaffolding-specific extraction
    if (resp.rlm) this._processRlm(resp);
    if (resp.three_system) this._processThreeSystem(resp);
    if (resp.agent_spawn) this._processAgentSpawn(resp);
  }

  _processRlm(resp) {
    const log = resp.rlm.log || [];
    // Parse SHOW_VARS() output from the last iteration's repl_outputs
    for (const iter of log) {
      const outputs = iter.repl_outputs || [];
      for (const out of outputs) {
        this._parseShowVars(out);
      }
    }
  }

  _parseShowVars(output) {
    if (!output || !output.includes('User variables:')) return;
    const lines = output.split('\n');
    let inVars = false;
    for (const line of lines) {
      if (line.trim() === 'User variables:') { inVars = true; continue; }
      if (inVars) {
        const m = line.match(/^\s+(\w+):\s+(.+)/);
        if (m) {
          this.rlmVars[m[1]] = m[2].trim();
        }
      }
    }
  }

  _processThreeSystem(resp) {
    const ts = resp.three_system;
    // Update rules if world model committed
    if (ts.world_model) {
      const wm = ts.world_model;
      if (wm.rules_version != null) this.rulesVersion = wm.rules_version;
      if (wm.rules_preview) this.rulesDoc = wm.rules_preview;
      // If full rules_doc is available (from tsState), use it
      if (wm.rules_doc) this.rulesDoc = wm.rules_doc;
    }
  }

  _processAgentSpawn(resp) {
    const as = resp.agent_spawn;
    if (as.memories) {
      this.facts = [...(as.memories.facts || [])];
      this.hypotheses = [...(as.memories.hypotheses || [])];
      this.agentStack = [...(as.memories.stack || [])];
    }
  }

  /** Get a serializable snapshot of current memory state */
  getSnapshot() {
    return {
      scaffolding: this.scaffolding,
      turnCount: this.turnCount,
      stepIndex: this.stepIndex,
      observations: [...this.observations],
      compactSummary: this.compactSummary,
      rulesDoc: this.rulesDoc,
      rulesVersion: this.rulesVersion,
      rlmVars: { ...this.rlmVars },
      facts: [...this.facts],
      hypotheses: [...this.hypotheses],
      agentStack: [...this.agentStack],
    };
  }

  /** Clone internal state (for checkpointing) */
  _cloneState() {
    return JSON.parse(JSON.stringify(this.getSnapshot()));
  }

  /** Restore from a cloned snapshot */
  _restoreState(snap) {
    this.scaffolding = snap.scaffolding;
    this.turnCount = snap.turnCount;
    this.stepIndex = snap.stepIndex;
    this.observations = snap.observations;
    this.compactSummary = snap.compactSummary;
    this.rulesDoc = snap.rulesDoc;
    this.rulesVersion = snap.rulesVersion;
    this.rlmVars = snap.rlmVars;
    this.facts = snap.facts;
    this.hypotheses = snap.hypotheses;
    this.agentStack = snap.agentStack;
  }

  /** Replay steps 0..targetIdx and return snapshot. Uses checkpoint cache. */
  replayTo(moveHistory, targetIdx) {
    if (targetIdx < 0) { this.reset(); return this.getSnapshot(); }

    // Find nearest checkpoint at or before targetIdx
    let startIdx = 0;
    for (const cp of this._checkpoints) {
      if (cp.idx <= targetIdx) {
        startIdx = cp.idx + 1;
        this._restoreState(cp.snapshot);
      } else break;
    }

    // If we need to go backwards past any checkpoint, replay from best checkpoint
    if (startIdx > targetIdx + 1) {
      startIdx = 0;
      this.reset();
      for (const cp of this._checkpoints) {
        if (cp.idx <= targetIdx) {
          startIdx = cp.idx + 1;
          this._restoreState(cp.snapshot);
        } else break;
      }
    }

    // If starting from scratch
    if (startIdx === 0 && this.stepIndex >= targetIdx) {
      this.reset();
    }

    // Replay from startIdx to targetIdx
    for (let i = startIdx; i <= targetIdx && i < moveHistory.length; i++) {
      this.processStep(moveHistory[i], i);

      // Save checkpoint every N steps
      if (i > 0 && i % this._checkpointInterval === 0) {
        // Don't duplicate checkpoints
        if (!this._checkpoints.find(cp => cp.idx === i)) {
          this._checkpoints.push({ idx: i, snapshot: this._cloneState() });
        }
      }
    }

    return this.getSnapshot();
  }
}


// ── Singleton tracker instance ──────────────────────────────────

let _memTracker = null;
let _memLastIdx = -1;

function getMemTracker() {
  if (!_memTracker) _memTracker = new MemoryStateTracker();
  return _memTracker;
}

function resetMemTracker() {
  _memTracker = new MemoryStateTracker();
  _memLastIdx = -1;
}


// ── Panel rendering ─────────────────────────────────────────────

function renderMemoryPanel(snapshot) {
  const panel = document.getElementById('obsMemoryContent');
  if (!panel) return;

  if (!snapshot || snapshot.stepIndex < 0) {
    panel.innerHTML = '<div class="mem-empty">No memory yet — waiting for agent steps...</div>';
    return;
  }

  let html = '';
  const scaf = snapshot.scaffolding;

  // Variables section (RLM)
  if (scaf === 'rlm' && Object.keys(snapshot.rlmVars).length > 0) {
    html += '<details class="mem-section" open>';
    html += '<summary class="mem-section-title">Variables</summary>';
    html += '<table class="mem-var-table">';
    html += '<tr><th>Name</th><th>Type</th></tr>';
    for (const [name, type] of Object.entries(snapshot.rlmVars)) {
      html += `<tr><td class="mem-var-name">${_memEsc(name)}</td><td class="mem-var-type">${_memEsc(type)}</td></tr>`;
    }
    html += '</table></details>';
  }

  // Knowledge section (rules_doc for Three-System, compactSummary for Linear)
  if (scaf === 'three_system' || scaf === 'two_system') {
    html += '<details class="mem-section" open>';
    html += `<summary class="mem-section-title">Rules (v${snapshot.rulesVersion})</summary>`;
    if (snapshot.rulesDoc) {
      html += `<pre class="mem-knowledge">${_memEsc(snapshot.rulesDoc)}</pre>`;
    } else {
      html += '<div class="mem-empty-section">No rules discovered yet</div>';
    }
    html += '</details>';
  }

  if (snapshot.compactSummary) {
    html += '<details class="mem-section" open>';
    html += '<summary class="mem-section-title">Compact Summary</summary>';
    html += `<pre class="mem-knowledge">${_memEsc(snapshot.compactSummary)}</pre>`;
    html += '</details>';
  }

  // Facts & Hypotheses (Agent Spawn)
  if (scaf === 'agent_spawn') {
    if (snapshot.facts.length > 0) {
      html += '<details class="mem-section" open>';
      html += `<summary class="mem-section-title">Facts (${snapshot.facts.length})</summary>`;
      html += '<ul class="mem-list mem-facts">';
      for (const f of snapshot.facts) {
        html += `<li>${_memEsc(f)}</li>`;
      }
      html += '</ul></details>';
    }
    if (snapshot.hypotheses.length > 0) {
      html += '<details class="mem-section" open>';
      html += `<summary class="mem-section-title">Hypotheses (${snapshot.hypotheses.length})</summary>`;
      html += '<ul class="mem-list mem-hypotheses">';
      for (const h of snapshot.hypotheses) {
        html += `<li>${_memEsc(h)}</li>`;
      }
      html += '</ul></details>';
    }
  }

  // Observations (all scaffoldings)
  if (snapshot.observations.length > 0) {
    const recent = snapshot.observations.slice(-20); // Show last 20
    const hidden = snapshot.observations.length - recent.length;
    html += '<details class="mem-section">';
    html += `<summary class="mem-section-title">Observations (${snapshot.observations.length})</summary>`;
    if (hidden > 0) {
      html += `<div class="mem-obs-hidden">+ ${hidden} earlier observations</div>`;
    }
    html += '<div class="mem-obs-list">';
    for (const obs of recent) {
      html += `<div class="mem-obs-entry"><span class="mem-obs-step">S${obs.step}</span> ${_memEsc(obs.text)}</div>`;
    }
    html += '</div></details>';
  }

  // Stats footer
  html += `<div class="mem-footer">Turn ${snapshot.turnCount} &middot; Step ${snapshot.stepIndex + 1} &middot; ${scaf || 'linear'}</div>`;

  if (!html.includes('mem-section')) {
    html = '<div class="mem-empty">No memory accumulated yet</div>' + html;
  }

  panel.innerHTML = html;
}

function _memEsc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}


// ── Integration hooks ───────────────────────────────────────────

/** Called when scrubber moves to a new position */
function obsMemoryScrub(idx) {
  let hist = moveHistory;
  if ((!hist || !hist.length) && getActiveSession()) hist = getActiveSession().moveHistory || [];
  if (!hist || !hist.length) return;

  const tracker = getMemTracker();
  const snapshot = tracker.replayTo(hist, idx);
  renderMemoryPanel(snapshot);
  _memLastIdx = idx;

  // Update Files panel (RGB game log at this step)
  obsFilesRenderAtStep(idx);
}

/** Called when a new step is added during live autoplay (incremental) */
function obsMemoryLiveStep(entry, idx) {
  const tracker = getMemTracker();
  tracker.processStep(entry, idx);
  renderMemoryPanel(tracker.getSnapshot());
  _memLastIdx = idx;

  // Update Files panel live
  obsFilesRenderLive();
}

/** Called on enterObsMode — replay all existing steps */
function obsMemoryInit() {
  resetMemTracker();
  let hist = moveHistory;
  if ((!hist || !hist.length) && getActiveSession()) hist = getActiveSession().moveHistory || [];
  if (!hist || !hist.length) {
    renderMemoryPanel(null);
    obsFilesRenderLive();
    return;
  }
  obsMemoryScrub(hist.length - 1);
}


// ═══════════════════════════════════════════════════════════════════════════
// FILES PANEL — Renders the RGB game log (or empty for other scaffoldings)
// ═══════════════════════════════════════════════════════════════════════════

/** Render Files panel with current live game log */
function obsFilesRenderLive() {
  const panel = document.getElementById('obsFilesContent');
  if (!panel) return;

  // Find RGB state for active session
  const sid = activeSessionId || (getActiveSession()?.id);
  if (!sid || typeof _rgbSessions === 'undefined' || !_rgbSessions.has(sid)) {
    panel.innerHTML = '<div class="obs-files-empty">No files — active with RGB harness only</div>';
    return;
  }

  const rgb = _rgbSessions.get(sid);
  const text = rgb.gameLog.text;
  if (!text) {
    panel.innerHTML = '<div class="obs-files-empty">Game log empty — waiting for first step...</div>';
    return;
  }

  panel.innerHTML = _obsFilesHighlight(text);
  panel.scrollTop = panel.scrollHeight;
}

/** Render Files panel at a specific step (for scrubber) */
function obsFilesRenderAtStep(stepIdx) {
  const panel = document.getElementById('obsFilesContent');
  if (!panel) return;

  const sid = activeSessionId || (getActiveSession()?.id);
  if (!sid || typeof _rgbSessions === 'undefined' || !_rgbSessions.has(sid)) {
    panel.innerHTML = '<div class="obs-files-empty">No files — active with RGB harness only</div>';
    return;
  }

  const rgb = _rgbSessions.get(sid);
  const text = rgb.gameLog.getTextAtStep(stepIdx + 1); // steps are 1-indexed in the log
  if (!text) {
    panel.innerHTML = '<div class="obs-files-empty">No log data at this step</div>';
    return;
  }

  panel.innerHTML = _obsFilesHighlight(text);
}

/** Apply syntax highlighting to game log text */
function _obsFilesHighlight(text) {
  // Escape HTML first
  const d = document.createElement('div');
  d.textContent = text;
  let html = d.innerHTML;

  // Highlight section markers
  html = html.replace(/\[(INITIAL BOARD STATE|POST-ACTION BOARD STATE|STRATEGIC ANALYSIS[^\]]*)\]/g,
    '<span class="file-section-marker">[$1]</span>');
  // Highlight separator lines
  html = html.replace(/^={40,}$/gm, '<span class="file-separator">$&</span>');
  // Highlight score lines
  html = html.replace(/^(Score: \d+.*)$/gm, '<span class="file-score-line">$1</span>');

  return html;
}
