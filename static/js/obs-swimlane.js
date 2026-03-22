// Author: Mark Barney + Cascade (Claude Opus 4.6 thinking)
// Date: 2026-03-12
// PURPOSE: Swimlane and custom timeline rendering for Observatory page.
//   Renders agent timelines as swimlanes or orchestrator-centric custom view.
//   Handles data modeling (spawn groups, orchestrator segments), tooltips,
//   and event visualization. Uses agentColor() from reasoning.js.
// Depends on: reasoning.js (agentColor, agentBadge), obs-page.js (allEvents, state)

// ── Timeline: Data Model ──

// Build structured spawn groups from raw events
function buildSpawnGroups(events) {
  if (!events.length) return { orchSegments: [], spawnGroups: [], t0: 0, tMax: 1 };

  const t0 = events[0].elapsed_s || 0;
  const tMax = events[events.length - 1].elapsed_s || 1;

  // Build orchestrator segments — only the LLM thinking call
  const orchSegments = []; // { startT, endT, idle, evIdx, ev }
  let lastOrchEnd = t0;

  // Track active subagents with unique keys to handle overlapping same-type agents
  const activeAgents = {};  // key = unique id
  let spawnCounter = 0;
  const spawnGroups = []; // { orchSegIdx, agentType, color, startT, endT, events[] }

  for (let j = 0; j < events.length; j++) {
    const ev = events[j];
    const t = ev.elapsed_s || 0;

    if (ev.event === 'orchestrator_decide') {
      // Idle gap before this thinking call
      if (t > lastOrchEnd + 0.01) {
        orchSegments.push({ startT: lastOrchEnd, endT: t, idle: true, evIdx: -1, ev: null });
      }
      const endT = ev.duration_ms ? t + ev.duration_ms / 1000 : t + 0.2;
      orchSegments.push({ startT: t, endT, idle: false, evIdx: j, ev });
      lastOrchEnd = endT;
      continue;
    }

    if (ev.event === 'subagent_start') {
      const agentType = (ev.agent_type || 'agent').toLowerCase();
      const parentSegIdx = orchSegments.length > 0 ? orchSegments.length - 1 : -1;
      // Unique key so two agents of same type don't overwrite
      const uid = agentType + '_' + (spawnCounter++);
      activeAgents[uid] = {
        agentType,
        orchSegIdx: parentSegIdx,
        startT: t,
        events: [{ idx: j, ev }],
      };
      continue;
    }

    if (ev.event === 'subagent_report') {
      const agentType = (ev.agent_type || '').toLowerCase();
      // Find oldest active agent of this type (FIFO)
      const uid = Object.keys(activeAgents).find(k => activeAgents[k].agentType === agentType);
      if (uid) {
        const ag = activeAgents[uid];
        ag.events.push({ idx: j, ev });
        spawnGroups.push({
          orchSegIdx: ag.orchSegIdx,
          agentType,
          color: agentColor(agentType),
          startT: ag.startT,
          endT: t,
          events: ag.events,
        });
        delete activeAgents[uid];
      }
      continue;
    }

    // act / frame_tool — attach to the active agent matching this agent type
    const agent = (ev.agent || '').toLowerCase();
    if (agent) {
      const uid = Object.keys(activeAgents).find(k => activeAgents[k].agentType === agent);
      if (uid) {
        activeAgents[uid].events.push({ idx: j, ev });
      }
    }
  }

  // Close any still-active agents (no report yet)
  for (const [uid, ag] of Object.entries(activeAgents)) {
    spawnGroups.push({
      orchSegIdx: ag.orchSegIdx,
      agentType: ag.agentType,
      color: agentColor(ag.agentType),
      startT: ag.startT,
      endT: tMax,
      events: ag.events,
      active: true,
    });
  }

  // Trailing idle segment
  if (lastOrchEnd < tMax) {
    orchSegments.push({ startT: lastOrchEnd, endT: tMax, idle: true, evIdx: -1, ev: null });
  }

  return { orchSegments, spawnGroups, t0, tMax };
}

// ── Render chips (colored to match parent agent) ──
function renderChips(groupEvents, agentHex) {
  const chips = [];
  for (const { ev } of groupEvents) {
    if (ev.event === 'act' && ev.action) {
      const displayAction = typeof humanAction === 'function' ? humanAction(ev.action) : ev.action;
      chips.push(`<span class="chip" style="background:${hexToRgba(agentHex,0.18)};color:${agentHex};border:1px solid ${hexToRgba(agentHex,0.3)}" title="${escapeHtmlAttr(displayAction)}">${escapeHtmlAttr(displayAction)}</span>`);
    } else if (ev.event === 'frame_tool' && ev.tool) {
      chips.push(`<span class="chip" style="background:${hexToRgba(agentHex,0.12)};color:${agentHex};border:1px solid ${hexToRgba(agentHex,0.2)}" title="${escapeHtmlAttr(ev.tool)}">${escapeHtmlAttr(ev.tool)}</span>`);
    }
  }
  if (chips.length === 0) return '';
  const MAX_CHIPS = 8;
  if (chips.length > MAX_CHIPS) {
    const overflow = chips.length - MAX_CHIPS;
    const shown = chips.slice(0, MAX_CHIPS);
    shown.push(`<span class="chip more">+${overflow}</span>`);
    return shown.join('');
  }
  return chips.join('');
}

// ── Timeline mode toggle ──
function setTimelineMode(mode) {
  timelineMode = mode;
  document.getElementById('modeSwimlane').classList.toggle('active', mode === 'swimlane');
  document.getElementById('modeCustom').classList.toggle('active', mode === 'custom');
  renderTimeline();
}

// ── Swimlane renderer ──
// Each subagent spawn gets its own lane. Orchestrator is always lane 0.
// Labels are frozen on the left; tracks scroll horizontally.
function renderTimelineSwimlane() {
  if (allEvents.length === 0) return;

  const canvas = document.getElementById('timelineCanvas');
  const container = document.getElementById('timelineContainer');

  const t0 = allEvents[0].elapsed_s || 0;
  const tMax = allEvents[allEvents.length - 1].elapsed_s || 1;
  const duration = Math.max(tMax - t0, 1);

  const containerW = container.clientWidth - 90; // 80 label + 10 pad
  const basePxPerSec = Math.max(containerW / duration, 2);
  const pxPerSec = basePxPerSec * timelineZoom;
  const totalW = Math.max(Math.ceil(duration * pxPerSec), containerW);

  const { orchSegments, spawnGroups } = buildSpawnGroups(allEvents);

  // Build lanes: lane 0 = orchestrator, lanes 1+ = one per spawn group (in order)
  const lanes = []; // { label, color, blocks[] }

  // Lane 0: orchestrator
  const orchBlocks = [];
  for (let si = 0; si < orchSegments.length; si++) {
    const seg = orchSegments[si];
    orchBlocks.push({
      startT: seg.startT,
      endT: seg.endT,
      idle: seg.idle,
      orchIdx: si,
    });
  }
  lanes.push({ label: 'orchestrator', color: agentColor('orchestrator'), blocks: orchBlocks });

  // One lane per subagent spawn
  for (let si = 0; si < spawnGroups.length; si++) {
    const sg = spawnGroups[si];
    const blocks = [];

    // Background lifecycle span
    blocks.push({
      startT: sg.startT,
      endT: sg.endT,
      sgIdx: si,
      isSpan: true,
      color: sg.color,
      active: sg.active,
    });

    // Individual event blocks on top
    for (const { ev, idx } of sg.events) {
      if (ev.event === 'subagent_start' || ev.event === 'subagent_report') continue;
      const evT = ev.elapsed_s || 0;
      const evDur = ev.duration_ms ? ev.duration_ms / 1000 : 0;
      blocks.push({
        startT: evT,
        endT: evT + Math.max(evDur, 0.1),
        ev,
        evIdx: idx,
        isInner: true,
        color: sg.color,
      });
    }

    lanes.push({ label: sg.agentType, color: sg.color, blocks });
  }

  // Render: two-column layout (frozen labels | scrollable tracks)
  let labelsHtml = '';
  let tracksHtml = '';

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const c = lane.color;

    labelsHtml += `<div class="swimlane-label" style="color:${c}">${lane.label}</div>`;
    tracksHtml += `<div class="swimlane-row">`;

    for (const blk of lane.blocks) {
      const left = (blk.startT - t0) * pxPerSec;
      const w = Math.max((blk.endT - blk.startT) * pxPerSec, 4);

      if (i === 0) {
        // Orchestrator
        if (blk.idle) {
          tracksHtml += `<div class="event-block" style="left:${left}px;width:${w}px;background:${c};opacity:0.10"></div>`;
        } else {
          tracksHtml += `<div class="event-block" style="left:${left}px;width:${w}px;background:${c};opacity:0.7" data-orch-idx="${blk.orchIdx}"></div>`;
        }
      } else if (blk.isSpan) {
        const opacity = blk.active ? '0.25' : '0.15';
        tracksHtml += `<div class="event-block" style="left:${left}px;width:${w}px;background:${blk.color};opacity:${opacity};border-left:2px solid ${blk.color}" data-sg-idx="${blk.sgIdx}"></div>`;
      } else if (blk.isInner) {
        let opacity = '0.6';
        if (blk.ev?.event === 'frame_tool') opacity = '0.3';
        tracksHtml += `<div class="event-block" style="left:${left}px;width:${w}px;background:${blk.color};opacity:${opacity}" data-ev-idx="${blk.evIdx}"></div>`;
      }
    }

    tracksHtml += `</div>`;
  }

  const tracksCanvasW = totalW + 10;
  canvas.innerHTML =
    `<div class="swimlane-wrap">` +
      `<div class="swimlane-labels">${labelsHtml}</div>` +
      `<div class="swimlane-tracks-scroll" id="swimlaneScroll">` +
        `<div class="swimlane-tracks-canvas" style="width:${tracksCanvasW}px">${tracksHtml}</div>` +
      `</div>` +
    `</div>`;

  // Auto-scroll the tracks area
  if (timelineAutoScroll) {
    const scrollEl = document.getElementById('swimlaneScroll');
    if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth;
  }

  // Store data for tooltips
  canvas._orchSegments = orchSegments;
  canvas._spawnGroups = spawnGroups;

  // Attach hover events
  canvas.querySelectorAll('.event-block[data-orch-idx]').forEach(el => {
    el.addEventListener('mouseenter', showOrchTooltip);
    el.addEventListener('mouseleave', hideTooltip);
  });
  canvas.querySelectorAll('.event-block[data-sg-idx]').forEach(el => {
    el.addEventListener('mousemove', (e) => {
      const sgIdx = parseInt(e.target.dataset.sgIdx);
      const sg = spawnGroups[sgIdx];
      if (!sg) return;
      const rect = e.target.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      showProportionalTooltipForSG(sg, fraction, e);
    });
    el.addEventListener('mouseleave', hideTooltip);
  });
  canvas.querySelectorAll('.event-block[data-ev-idx]').forEach(el => {
    el.addEventListener('mouseenter', (e) => {
      const idx = parseInt(e.target.dataset.evIdx);
      const ev = allEvents[idx];
      if (!ev) return;
      showSimpleEventTooltip(ev, e);
    });
    el.addEventListener('mouseleave', hideTooltip);
  });
}

// Simple tooltip for individual events (used in swimlane view)
function showSimpleEventTooltip(ev, e) {
  const agent = ev.agent || ev.agent_type || '';
  const c = agentColor(agent);
  let html = `<div class="tt-agent" style="color:${c}">${agent || 'system'}</div>`;
  html += `<div>${ev.event}</div>`;
  if (ev.elapsed_s != null) html += `<div class="tt-dim">t = +${ev.elapsed_s.toFixed(1)}s</div>`;
  if (ev.duration_ms) html += `<div>Duration: ${ev.duration_ms}ms</div>`;
  if (ev.input_tokens) html += `<div>Tokens: ${fmtK(ev.input_tokens)} in / ${fmtK(ev.output_tokens || 0)} out</div>`;
  if (ev.action) html += `<div>Action: ${typeof humanAction === 'function' ? humanAction(ev.action) : ev.action}</div>`;
  if (ev.tool) html += `<div>Tool: ${ev.tool}</div>`;
  if (ev.reasoning) html += `<div style="max-width:300px;word-break:break-word;color:#aaa">${escapeHtmlAttr(ev.reasoning)}</div>`;
  if (ev.task) html += `<div style="max-width:300px;word-break:break-word;">Task: ${ev.task}</div>`;

  const tt = document.getElementById('tooltip');
  tt.innerHTML = html;
  tt.classList.add('visible');
  positionTooltip(tt, e);
}

// Proportional tooltip helper for spawn group (shared by both views)
function showProportionalTooltipForSG(sg, fraction, e) {
  const spanStart = sg.startT;
  const spanEnd = sg.endT;
  const spanDur = Math.max(spanEnd - spanStart, 0.01);
  const targetT = spanStart + fraction * spanDur;

  let bestEv = sg.events[0];
  let bestDist = Infinity;
  for (const entry of sg.events) {
    const et = entry.ev.elapsed_s || 0;
    const dist = Math.abs(et - targetT);
    if (dist < bestDist) { bestDist = dist; bestEv = entry; }
  }

  const ev = bestEv.ev;
  const c = sg.color;
  const agent = ev.agent || ev.agent_type || sg.agentType;
  const progressPct = Math.round(fraction * 100);
  const progressBar = `<div style="background:#1a1a24;border-radius:2px;height:4px;margin:4px 0;overflow:hidden"><div style="background:${c};height:100%;width:${progressPct}%;border-radius:2px"></div></div>`;

  let html = `<div class="tt-agent" style="color:${c}">${agent}</div>`;
  html += progressBar;
  html += `<div>${ev.event}</div>`;
  if (ev.action) html += `<div>Action: ${typeof humanAction === 'function' ? humanAction(ev.action) : ev.action}</div>`;
  if (ev.tool) html += `<div>Tool: ${ev.tool}</div>`;
  if (ev.reasoning) html += `<div style="max-width:300px;word-break:break-word;color:#aaa">${escapeHtmlAttr(ev.reasoning)}</div>`;
  if (ev.task) html += `<div style="max-width:300px;word-break:break-word;">Task: ${ev.task}</div>`;
  if (ev.summary) html += `<div style="max-width:300px;word-break:break-word;">Summary: ${ev.summary}</div>`;
  if (ev.elapsed_s != null) html += `<div class="tt-dim">t = +${ev.elapsed_s.toFixed(1)}s</div>`;
  if (ev.duration_ms) html += `<div>Duration: ${ev.duration_ms}ms</div>`;
  if (ev.input_tokens) html += `<div>Tokens: ${fmtK(ev.input_tokens)} in / ${fmtK(ev.output_tokens || 0)} out</div>`;

  const tt = document.getElementById('tooltip');
  tt.innerHTML = html;
  tt.classList.add('visible');
  positionTooltip(tt, e);
}

// ── Timeline rendering (dispatcher) ──
function renderTimeline() {
  if (allEvents.length === 0) return;

  if (timelineMode === 'swimlane') {
    renderTimelineSwimlane();
    return;
  }

  // Custom mode (orch bar + positioned blocks)
  const canvas = document.getElementById('timelineCanvas');
  const container = document.getElementById('timelineContainer');
  const containerW = container.clientWidth - 20;

  const { orchSegments, spawnGroups, t0, tMax } = buildSpawnGroups(allEvents);
  const duration = Math.max(tMax - t0, 0.1);

  // Compute canvas width based on zoom
  const baseW = Math.max(containerW, 400);
  const canvasW = Math.max(baseW * timelineZoom, containerW);
  canvas.style.width = canvasW + 'px';

  // Helper: time → percentage string
  const toPct = (t) => ((t - t0) / duration * 100).toFixed(4) + '%';
  const toW = (dt) => (dt / duration * 100).toFixed(4) + '%';

  // ── 1. Render orchestrator bar (only LLM thinking segments) ──
  let orchHtml = '<div class="orch-bar">';
  for (let i = 0; i < orchSegments.length; i++) {
    const seg = orchSegments[i];
    const left = toPct(seg.startT);
    const width = toW(Math.max(seg.endT - seg.startT, duration * 0.003));

    if (seg.idle) {
      orchHtml += `<div class="orch-segment idle" style="left:${left};width:${width}" data-orch-idx="${i}"></div>`;
    } else {
      // Only "thinking" label — spawning is shown by the subagent blocks below
      orchHtml += `<div class="orch-segment decide" style="left:${left};width:${width}" data-orch-idx="${i}">thinking</div>`;
    }
  }
  orchHtml += '</div>';

  // ── 2. Render subagent blocks with accurate time positioning ──
  // Row-pack: assign each spawn group to a row, stacking when time ranges overlap
  const sorted = spawnGroups.map((sg, i) => ({ ...sg, sgIdx: i }));
  sorted.sort((a, b) => a.startT - b.startT);

  const rows = []; // each row = array of { startT, endT }
  const rowAssignment = new Array(spawnGroups.length).fill(0);

  for (const sg of sorted) {
    let placed = false;
    for (let r = 0; r < rows.length; r++) {
      const overlaps = rows[r].some(blk => sg.startT < blk.endT && sg.endT > blk.startT);
      if (!overlaps) {
        rows[r].push({ startT: sg.startT, endT: sg.endT });
        rowAssignment[sg.sgIdx] = r;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([{ startT: sg.startT, endT: sg.endT }]);
      rowAssignment[sg.sgIdx] = rows.length - 1;
    }
  }

  const blockHeight = 28;
  const blockGap = 3;
  const connectorH = 8;
  const numRows = Math.max(rows.length, 1);
  const spawnContainerH = connectorH + numRows * (blockHeight + blockGap);

  let spawnHtml = `<div class="spawn-groups-container" style="height:${spawnContainerH}px">`;

  for (let i = 0; i < spawnGroups.length; i++) {
    const sg = spawnGroups[i];
    const row = rowAssignment[i];
    const bgAlpha = sg.active ? 0.25 : 0.15;
    const bgColor = sg.color;
    const chips = renderChips(sg.events, bgColor);

    // Accurate horizontal position: left and width from actual startT→endT
    const left = toPct(sg.startT);
    const width = toW(Math.max(sg.endT - sg.startT, duration * 0.005));
    const top = connectorH + row * (blockHeight + blockGap);

    // Connector line from orch bar down to this block
    const orchSeg = sg.orchSegIdx >= 0 && sg.orchSegIdx < orchSegments.length ? orchSegments[sg.orchSegIdx] : null;
    if (orchSeg) {
      const connLeft = toPct(orchSeg.startT + (orchSeg.endT - orchSeg.startT) / 2);
      spawnHtml += `<div class="spawn-connector" style="left:${connLeft};top:0;height:${top}px"></div>`;
    }

    spawnHtml += `<div class="subagent-block" style="left:${left};width:${width};top:${top}px;background:${hexToRgba(bgColor, bgAlpha)};border-left-color:${bgColor}" data-sg-idx="${i}">`;
    spawnHtml += `<span class="sa-label" style="color:${bgColor}">${sg.agentType}</span>`;
    if (chips) spawnHtml += `<span class="chips">${chips}</span>`;
    spawnHtml += `</div>`;
  }
  spawnHtml += '</div>';

  canvas.innerHTML = orchHtml + spawnHtml;

  // Auto-scroll timeline to right
  if (timelineAutoScroll) {
    container.scrollLeft = container.scrollWidth;
  }

  // ── Attach hover events ──
  canvas.querySelectorAll('.orch-segment.decide').forEach(el => {
    el.addEventListener('mouseenter', showOrchTooltip);
    el.addEventListener('mouseleave', hideTooltip);
  });
  canvas.querySelectorAll('.subagent-block').forEach(el => {
    el.addEventListener('mousemove', showProportionalTooltip);
    el.addEventListener('mouseleave', hideTooltip);
  });

  // Store parsed data for tooltip access
  canvas._spawnGroups = spawnGroups;
  canvas._orchSegments = orchSegments;
}

// ── Hex to rgba helper ──
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Orch segment tooltip ──
function showOrchTooltip(e) {
  const canvas = document.getElementById('timelineCanvas');
  const idx = parseInt(e.target.dataset.orchIdx);
  const seg = canvas._orchSegments?.[idx];
  if (!seg || !seg.ev) return;

  const ev = seg.ev;
  const c = agentColor('orchestrator');

  let html = `<div class="tt-agent" style="color:${c}">orchestrator</div>`;
  html += `<div>orchestrator_decide</div>`;
  if (ev.command) html += `<div>Command: ${ev.command}</div>`;
  if (ev.agent_type) html += `<div>Agent: ${ev.agent_type}</div>`;
  if (ev.task) html += `<div style="max-width:300px;word-break:break-word;">Task: ${ev.task}</div>`;
  if (ev.elapsed_s != null) html += `<div class="tt-dim">t = +${ev.elapsed_s.toFixed(1)}s</div>`;
  if (ev.duration_ms) html += `<div>Duration: ${ev.duration_ms}ms</div>`;
  if (ev.input_tokens) html += `<div>Tokens: ${fmtK(ev.input_tokens)} in / ${fmtK(ev.output_tokens || 0)} out</div>`;

  const tt = document.getElementById('tooltip');
  tt.innerHTML = html;
  tt.classList.add('visible');
  positionTooltip(tt, e);
}

// ── Proportional tooltip on subagent blocks (custom view) ──
function showProportionalTooltip(e) {
  const block = e.currentTarget;
  const canvas = document.getElementById('timelineCanvas');
  const sgIdx = parseInt(block.dataset.sgIdx);
  const sg = canvas._spawnGroups?.[sgIdx];
  if (!sg || !sg.events.length) return;
  const rect = block.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  showProportionalTooltipForSG(sg, fraction, e);
}

// ── Position tooltip near cursor ──
function positionTooltip(tt, e) {
  const pad = 12;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  // Keep within viewport
  const ttRect = tt.getBoundingClientRect();
  if (left + ttRect.width > window.innerWidth - 10) {
    left = e.clientX - ttRect.width - pad;
  }
  if (top + ttRect.height > window.innerHeight - 10) {
    top = e.clientY - ttRect.height - pad;
  }
  tt.style.left = Math.max(0, left) + 'px';
  tt.style.top = Math.max(0, top) + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').classList.remove('visible');
}

// ── Timeline zoom handler ──
function attachTimelineZoomHandler() {
  document.getElementById('timelineContainer').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();

    // In swimlane mode, the scrollable element is #swimlaneScroll, not the container
    const scrollEl = document.getElementById('swimlaneScroll') || document.getElementById('timelineContainer');
    const rect = scrollEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + scrollEl.scrollLeft;
    const fraction = mouseX / (scrollEl.scrollWidth || 1);

    const oldZoom = timelineZoom;
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    timelineZoom = Math.max(0.1, Math.min(100, timelineZoom * factor));
    timelineAutoScroll = false;
    document.getElementById('zoomLabel').textContent = timelineZoom.toFixed(1) + 'x';

    renderTimeline();

    // Keep mouse anchored to same point in timeline
    const newScrollEl = document.getElementById('swimlaneScroll') || document.getElementById('timelineContainer');
    const newMouseX = fraction * newScrollEl.scrollWidth;
    newScrollEl.scrollLeft = newMouseX - (e.clientX - rect.left);
  }, { passive: false });
}
