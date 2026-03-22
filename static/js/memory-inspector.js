// memory-inspector.js — Memory Inspector panel for examining agent memory state
// Provides step-by-step memory inspection for Agent Spawn sessions.
// Loaded after reasoning.js and scaffolding-agent-spawn.js.

let _memInspectorData = []; // Array of memory snapshots
let _memInspectorStep = 0;
let _memInspectorFilter = 'all'; // agent type filter

/**
 * Initialize the memory inspector from session state or server data.
 * Called when switching to the Memory tab.
 */
function _renderMemoryInspector() {
  const content = document.getElementById('memoryInspectorContent');
  const slider = document.getElementById('memoryStepSlider');
  const stepLabel = document.getElementById('memoryStepLabel');
  const versionEl = document.getElementById('memoryGameVersion');
  if (!content) return;

  // Get memory snapshots from active session
  const ss = getActiveSession();
  const snapshots = ss?.memorySnapshots || [];
  _memInspectorData = snapshots;

  // Show game version
  if (versionEl) {
    const ver = ss?.gameVersion || currentState?.game_version || '';
    versionEl.textContent = ver ? `Game version: ${ver}` : '';
  }

  if (!snapshots.length) {
    content.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:20px;text-align:center;">
      No memory snapshots recorded yet.<br>
      Memory is captured during Agent Spawn sessions at each step.<br>
      <span style="font-size:10px;">Start an Agent Spawn session or resume one with memory data.</span>
    </div>`;
    if (slider) { slider.max = 0; slider.value = 0; }
    if (stepLabel) stepLabel.textContent = '0';
    return;
  }

  // Set up step slider
  const maxStep = Math.max(...snapshots.map(s => s.step_num || 0));
  if (slider) {
    slider.max = maxStep;
    slider.value = _memInspectorStep <= maxStep ? _memInspectorStep : maxStep;
    slider.oninput = () => {
      _memInspectorStep = parseInt(slider.value);
      if (stepLabel) stepLabel.textContent = _memInspectorStep;
      _renderMemoryAtStep(_memInspectorStep);
    };
  }
  if (stepLabel) stepLabel.textContent = slider?.value || '0';

  // Build agent filter buttons
  const agents = [...new Set(snapshots.map(s => s.agent_type).filter(Boolean))];
  const filterEl = document.getElementById('memoryAgentFilter');
  if (filterEl && agents.length > 1) {
    filterEl.innerHTML = `<button class="mem-filter-btn ${_memInspectorFilter === 'all' ? 'active' : ''}" data-agent="all" onclick="_memFilterAgent('all')" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:${_memInspectorFilter === 'all' ? 'var(--accent)' : 'var(--bg)'};color:${_memInspectorFilter === 'all' ? '#000' : 'var(--text-dim)'};cursor:pointer;">All</button>`;
    for (const a of agents) {
      const c = typeof agentColor === 'function' ? agentColor(a) : '#999';
      const isActive = _memInspectorFilter === a;
      filterEl.innerHTML += `<button class="mem-filter-btn ${isActive ? 'active' : ''}" data-agent="${a}" onclick="_memFilterAgent('${a}')" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid ${c}44;background:${isActive ? c + '33' : 'var(--bg)'};color:${c};cursor:pointer;">${a}</button>`;
    }
  }

  _renderMemoryAtStep(parseInt(slider?.value || 0));
}

/**
 * Filter memory view by agent type.
 */
function _memFilterAgent(agent) {
  _memInspectorFilter = agent;
  // Update button styles
  document.querySelectorAll('.mem-filter-btn').forEach(b => {
    const isActive = b.dataset.agent === agent;
    b.classList.toggle('active', isActive);
    if (b.dataset.agent === 'all') {
      b.style.background = isActive ? 'var(--accent)' : 'var(--bg)';
      b.style.color = isActive ? '#000' : 'var(--text-dim)';
    } else {
      b.style.background = isActive ? b.style.color + '33' : 'var(--bg)';
    }
  });
  _renderMemoryAtStep(_memInspectorStep);
}

/**
 * Render memory state at a specific step number.
 */
function _renderMemoryAtStep(stepNum) {
  const content = document.getElementById('memoryInspectorContent');
  if (!content) return;

  // Find the latest snapshot at or before this step
  let filtered = _memInspectorData.filter(s => (s.step_num || 0) <= stepNum);
  if (_memInspectorFilter !== 'all') {
    filtered = filtered.filter(s => s.agent_type === _memInspectorFilter);
  }

  if (!filtered.length) {
    content.innerHTML = `<div style="color:var(--text-dim);font-size:11px;padding:10px;text-align:center;">
      No memory data at step ${stepNum}. Try advancing the slider.
    </div>`;
    return;
  }

  // Use the latest snapshot
  const snap = filtered[filtered.length - 1];
  const mem = snap.memory || {};
  const agentType = snap.agent_type || 'orchestrator';
  const agentId = snap.agent_id || '';
  const c = typeof agentColor === 'function' ? agentColor(agentType) : '#999';

  let html = '';

  // Header with agent info
  html += `<div style="border-left:3px solid ${c};padding:4px 10px;margin-bottom:10px;">`;
  html += `<span style="font-size:11px;font-weight:600;color:${c};">${agentType}</span>`;
  if (agentId) html += ` <span style="font-size:10px;color:var(--text-dim);">(${agentId})</span>`;
  html += ` <span style="font-size:10px;color:var(--text-dim);">at step ${snap.step_num}</span>`;
  html += `</div>`;

  // Facts section
  const facts = mem.facts || [];
  html += `<details class="mem-section" ${facts.length ? 'open' : ''}>`;
  html += `<summary class="mem-section-title">Facts (${facts.length})</summary>`;
  if (facts.length) {
    html += `<table class="mem-var-table"><tbody>`;
    facts.forEach((f, i) => {
      html += `<tr><td class="mem-var-name">[${i}]</td><td style="color:var(--green);font-size:10px;">${_escHtml(f)}</td></tr>`;
    });
    html += `</tbody></table>`;
  } else {
    html += `<div style="padding:4px 8px;font-size:10px;color:var(--text-dim);">(none)</div>`;
  }
  html += `</details>`;

  // Hypotheses section
  const hypotheses = mem.hypotheses || [];
  html += `<details class="mem-section" ${hypotheses.length ? 'open' : ''}>`;
  html += `<summary class="mem-section-title">Hypotheses (${hypotheses.length})</summary>`;
  if (hypotheses.length) {
    html += `<table class="mem-var-table"><tbody>`;
    hypotheses.forEach((h, i) => {
      html += `<tr><td class="mem-var-name">[${i}]</td><td style="color:var(--purple,#A356D6);font-size:10px;">${_escHtml(h)}</td></tr>`;
    });
    html += `</tbody></table>`;
  } else {
    html += `<div style="padding:4px 8px;font-size:10px;color:var(--text-dim);">(none)</div>`;
  }
  html += `</details>`;

  // Agent Reports (stack) section
  const stack = mem.stack || [];
  html += `<details class="mem-section" ${stack.length ? 'open' : ''}>`;
  html += `<summary class="mem-section-title">Agent Reports (${stack.length})</summary>`;
  if (stack.length) {
    stack.forEach((m, i) => {
      const mc = typeof agentColor === 'function' ? agentColor(m.agentType || 'system') : '#999';
      html += `<div style="border-left:2px solid ${mc};padding:2px 8px;margin:3px 0;font-size:10px;">`;
      html += `<span style="color:${mc};font-weight:600;">[${i}] ${m.agentType || 'system'}</span> `;
      html += `<span style="color:var(--text);">${_escHtml(m.summary || '')}</span>`;
      if (m.details) {
        html += `<details style="margin-top:2px;"><summary style="cursor:pointer;font-size:9px;color:var(--text-dim);">Details</summary>`;
        html += `<div style="white-space:pre-wrap;color:var(--text-dim);font-size:9px;max-height:200px;overflow:auto;">${_escHtml(m.details)}</div></details>`;
      }
      html += `</div>`;
    });
  } else {
    html += `<div style="padding:4px 8px;font-size:10px;color:var(--text-dim);">(no reports)</div>`;
  }
  html += `</details>`;

  // All snapshots at this step (timeline of changes)
  const allAtStep = _memInspectorData.filter(s =>
    (s.step_num || 0) === stepNum && (_memInspectorFilter === 'all' || s.agent_type === _memInspectorFilter)
  );
  if (allAtStep.length > 1) {
    html += `<details class="mem-section">`;
    html += `<summary class="mem-section-title">All Snapshots at Step ${stepNum} (${allAtStep.length})</summary>`;
    allAtStep.forEach((s, i) => {
      const sc = typeof agentColor === 'function' ? agentColor(s.agent_type || 'system') : '#999';
      const m = s.memory || {};
      html += `<div style="border-left:2px solid ${sc};padding:4px 8px;margin:4px 0;">`;
      html += `<span style="font-size:10px;color:${sc};font-weight:600;">${s.agent_type}${s.agent_id ? ' (' + s.agent_id + ')' : ''}</span>`;
      html += `<span style="font-size:9px;color:var(--text-dim);margin-left:6px;">F:${(m.facts||[]).length} H:${(m.hypotheses||[]).length} R:${(m.stack||[]).length}</span>`;
      html += `</div>`;
    });
    html += `</details>`;
  }

  // Raw JSON view
  html += `<details class="mem-section" style="margin-top:8px;">`;
  html += `<summary class="mem-section-title" style="color:var(--text-dim);">Raw JSON</summary>`;
  html += `<pre style="font-size:9px;color:var(--text-dim);padding:8px;overflow:auto;max-height:300px;background:var(--bg);border-radius:4px;white-space:pre-wrap;">${_escHtml(JSON.stringify(mem, null, 2))}</pre>`;
  html += `</details>`;

  content.innerHTML = html;
}

function _escHtml(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s);
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Upload memory snapshots for current session to server.
 * Called during auto-upload.
 */
async function _uploadMemorySnapshots() {
  const ss = getActiveSession();
  if (!ss || !ss.memorySnapshots?.length || !sessionId) return;
  try {
    await fetch(`/api/sessions/${sessionId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshots: ss.memorySnapshots }),
    });
  } catch {} // fire-and-forget
}
