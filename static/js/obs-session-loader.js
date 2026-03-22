// Author: Mark Barney + Cascade (Claude Opus 4.6 thinking)
// Date: 2026-03-12
// PURPOSE: Session browser, fetch, load, and replay for Observatory page.
//   Allows users to browse saved sessions, filter by game/model/result, load
//   historical session data, display replay metadata, and return to live mode.
// Depends on: obs-page.js (allEvents, state, resetState, renderNewEvents, renderTimeline, renderGameGrid, etc.)

// ── Session Browser ──

let replayMode = false;
let allSessions = [];

function toggleSessionBrowser() {
  const overlay = document.getElementById('sessionOverlay');
  const visible = overlay.classList.toggle('visible');
  document.getElementById('browseBtn').classList.toggle('active', visible);
  if (visible) fetchSessionList();
}

async function fetchSessionList() {
  try {
    // Try both sources and merge (file-based + central DB)
    const [fileRes, dbRes] = await Promise.allSettled([
      fetch('/api/sessions/browse'),
      fetch('/api/sessions/list-for-obs'),
    ]);
    const seen = new Set();
    allSessions = [];
    for (const res of [fileRes, dbRes]) {
      if (res.status === 'fulfilled' && res.value.ok) {
        const data = await res.value.json();
        for (const s of (data.sessions || [])) {
          if (!seen.has(s.id)) { seen.add(s.id); allSessions.push(s); }
        }
      }
    }
    allSessions.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    // Populate model filter dropdown
    const models = [...new Set(allSessions.map(s => s.model).filter(Boolean))].sort();
    const modelSelect = document.getElementById('filterModel');
    const curModel = modelSelect.value;
    modelSelect.innerHTML = '<option value="">All models</option>';
    for (const m of models) {
      modelSelect.innerHTML += `<option value="${escapeHtmlAttr(m)}">${escapeHtmlAttr(m.replace(/^(gemini|claude|groq|mistral|ollama)\//, ''))}</option>`;
    }
    modelSelect.value = curModel;

    applySessionFilters();
  } catch (e) {
    console.error('Failed to fetch sessions:', e);
  }
}

function applySessionFilters() {

  const gameFilter = (document.getElementById('filterGame').value || '').toLowerCase();
  const resultFilter = document.getElementById('filterResult').value;
  const modelFilter = document.getElementById('filterModel').value;

  const filtered = allSessions.filter(s => {
    if (gameFilter && !(s.game_id || '').toLowerCase().includes(gameFilter)) return false;
    if (resultFilter && s.result !== resultFilter) return false;
    if (modelFilter && s.model !== modelFilter) return false;
    return true;
  });

  const tbody = document.getElementById('sessionListBody');
  document.getElementById('sessionCount').textContent = `${filtered.length} of ${allSessions.length}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#555;padding:20px">No sessions found</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const s of filtered) {
    const tr = document.createElement('tr');
    const result = (s.result || '').toUpperCase();
    const badgeClass = result.includes('WON') || result.includes('WIN') || result.includes('COMPLETE') ? 'won'
      : result.includes('LOST') || result.includes('FAIL') || result.includes('DEAD') ? 'lost' : 'other';
    const date = s.created_at ? new Date(s.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    const cost = s.total_cost ? '$' + s.total_cost.toFixed(3) : '--';
    tr.innerHTML = `
      <td style="color:#e0e0e0;font-weight:500">${escapeHtmlAttr(s.game_id || '')}</td>
      <td>${escapeHtmlAttr((s.model || '').replace(/^(gemini|claude|groq|mistral|ollama)\//, ''))}</td>
      <td>${s.steps || 0}</td>
      <td>${s.levels || 0}</td>
      <td><span class="result-badge ${badgeClass}">${escapeHtmlAttr(s.result || 'N/A')}</span></td>
      <td>${cost}</td>
      <td style="color:#666">${date}</td>
    `;
    tr.addEventListener('click', () => loadSession(s.id, s.game_id));
    tbody.appendChild(tr);
  }
}

async function loadSession(sessionId, gameId) {
  // Close browser
  document.getElementById('sessionOverlay').classList.remove('visible');
  document.getElementById('browseBtn').classList.remove('active');

  // Stop live polling
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  replayMode = true;

  // Reset state
  resetState();
  setConn(false);
  document.getElementById('connStatus').textContent = 'REPLAY';
  document.getElementById('connStatus').className = 'conn';
  document.getElementById('connStatus').style.color = '#3b82f6';
  document.getElementById('replayBadge').textContent = `[${gameId || sessionId.slice(0, 8)}]`;

  // Fetch reconstructed obs events
  try {
    const r = await fetch(`/api/sessions/${sessionId}/obs-events`);
    if (!r.ok) { console.error('Failed to load session obs events'); return; }
    const data = await r.json();
    if (data.events && data.events.length > 0) {
      data.events.forEach(normalizeEvent);
      allEvents = data.events;

      // Compute status summary from events
      let totalIn = 0, totalOut = 0, totalCost = 0, totalCalls = 0, maxStep = 0;
      let model = '';
      for (const ev of allEvents) {
        if (ev.input_tokens) totalIn += ev.input_tokens;
        if (ev.output_tokens) totalOut += ev.output_tokens;
        if (ev.cost) totalCost += ev.cost;
        if (ev.event === 'llm_call' || ev.event === 'orchestrator_decide') { totalCalls++; if (ev.model) model = ev.model; }
        if (ev.step_num != null && ev.step_num > maxStep) maxStep = ev.step_num;
        trackEventTokens(ev);
      }

      // Populate status bar
      document.getElementById('sGame').textContent = gameId || '--';
      document.getElementById('sState').textContent = 'REPLAY';
      document.getElementById('sStep').textContent = maxStep;
      document.getElementById('sCalls').textContent = totalCalls;
      document.getElementById('sTokens').textContent = `${fmtK(totalIn)} / ${fmtK(totalOut)}`;
      if (totalCost > 0) {
        document.getElementById('sCost').textContent = '$' + totalCost.toFixed(3);
      }
      const elapsed = allEvents.length > 0 ? allEvents[allEvents.length - 1].elapsed_s || 0 : 0;
      if (elapsed < 60) {
        document.getElementById('sElapsed').textContent = `${Math.round(elapsed)}s`;
      } else {
        document.getElementById('sElapsed').textContent = `${(elapsed / 60).toFixed(1)}m`;
      }
      document.getElementById('sAgent').textContent = model || '--';

      // Render
      renderNewEvents(allEvents);
      renderTimeline();

      // Show first grid if available
      const firstGrid = allEvents.find(ev => ev.grid && ev.grid.length > 0);
      if (firstGrid) {
        currentGrid = firstGrid.grid;
        renderGameGrid(firstGrid.grid);
      }
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
}

function returnToLive() {
  replayMode = false;
  resetState();
  document.getElementById('replayBadge').textContent = '';
  document.getElementById('connStatus').style.color = '';
  poll();
}
