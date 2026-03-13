// ═══════════════════════════════════════════════════════════════════════════
// SESSION VIEWS — GRID (Browse sessions view)
// ═══════════════════════════════════════════════════════════════════════════
//
// This module handles browsing and filtering sessions:
// - loadBrowseView(): Initialize browse columns
// - _loadBrowseGameList(): Load and render game sidebar with filtering
// - _browseSelectGame(), clearBrowseGameFilter(): Game filtering
// - loadBrowseHuman(), loadBrowseAI(), loadBrowseMy(): Load filtered session columns
// - buildSessionRow(): Render individual session rows
// - browseReplay(), browseResume(), browseDeleteLocal(): Session actions
//
// State:
// - _browseGlobalCache: Cached server sessions (global)
// - _browseGameFilter: Currently selected game filter (game_id prefix)
//
// Dependencies:
// - fetchJSON(), gameShortName(), formatDuration() (from ui.js)
// - currentUser (from state.js)
// - getLocalSessions() (from session-storage.js)
// - showAppView() (from session-views.js)
// - resumeSession() (from session-views-history.js)
// - _browseActive (shared state from session-views.js)
// ═══════════════════════════════════════════════════════════════════════════

let _browseGlobalCache = null;  // cache server sessions
let _browseGameFilter = null;   // currently selected game filter (game_id prefix)

function loadBrowseView() {
  _loadBrowseGameList();
  _loadBrowseColumns();
}

// ── Game sidebar ─────────────────────────────────────────────────────────

async function _loadBrowseGameList() {
  const el = document.getElementById('browseGameList');
  if (el.children.length > 1) return; // already loaded
  try {
    let games = await fetchJSON('/api/games');
    if (MODE === 'prod') games = games.filter(g => g.game_id !== 'fd01-00000001');
    el.innerHTML = '';
    const foundation = games.filter(g => _ARC_FOUNDATION_GAMES.includes(g.game_id.split('-')[0].toLowerCase()));
    const observatory = games.filter(g => !_ARC_FOUNDATION_GAMES.includes(g.game_id.split('-')[0].toLowerCase()));
    const sortByTitle = (a, b) => ((a.title || a.game_id).localeCompare(b.title || b.game_id));
    foundation.sort(sortByTitle);
    observatory.sort(sortByTitle);
    _renderGameGroup(el, 'ARC Prize Foundation', foundation, g => _browseSelectGame(g.game_id));
    _renderGameGroup(el, 'ARC Observatory', observatory, g => _browseSelectGame(g.game_id));
  } catch { el.innerHTML = '<div class="browse-empty" style="padding:12px;">Failed to load games.</div>'; }
}

function _browseSelectGame(gameId) {
  // Extract short prefix for filtering (e.g. "ls20-cb3b57cc" → "ls20")
  const prefix = gameId.split('-')[0].toLowerCase();
  _browseGameFilter = prefix;

  // Highlight in sidebar
  document.querySelectorAll('#browseGameList .game-card').forEach(c => {
    const cid = (c.dataset.gameId || '').split('-')[0].toLowerCase();
    c.classList.toggle('active', cid === prefix);
  });

  // Show clear button
  document.getElementById('browseFilterClear').style.display = '';

  _loadBrowseColumns();
}

function clearBrowseGameFilter() {
  _browseGameFilter = null;
  document.querySelectorAll('#browseGameList .game-card').forEach(c => c.classList.remove('active'));
  document.getElementById('browseFilterClear').style.display = 'none';
  _loadBrowseColumns();
}

function _matchesGameFilter(s) {
  if (!_browseGameFilter) return true;
  const sid = (s.game_id || '').split('-')[0].toLowerCase();
  return sid === _browseGameFilter;
}

function _loadBrowseColumns() {
  loadBrowseHuman();
  loadBrowseAI();
  loadBrowseMy();
}

// ── Human Sessions column ────────────────────────────────────────────────

async function loadBrowseHuman() {
  const el = document.getElementById('browseHumanList');
  const countEl = document.getElementById('browseHumanCount');
  el.innerHTML = '<div class="browse-empty">Loading...</div>';
  try {
    const data = await fetchJSON('/api/sessions?player_type=human');
    let sessions = (data.sessions || []).filter(s => (s.steps || 0) >= 1);
    if (MODE === 'prod') sessions = sessions.filter(s => s.game_id !== 'fd01-00000001');
    sessions = sessions.filter(_matchesGameFilter);
    countEl.textContent = sessions.length ? `(${sessions.length})` : '';
    if (!sessions.length) {
      el.innerHTML = `<div class="browse-empty">${_browseGameFilter ? 'No human sessions for this game.' : 'No human sessions yet.'}</div>`;
      return;
    }
    el.innerHTML = '';
    for (const s of sessions) el.appendChild(buildSessionRow(s));
  } catch (e) {
    el.innerHTML = `<div class="browse-empty">Error: ${e.message}</div>`;
  }
}

// ── AI Sessions column ───────────────────────────────────────────────────

async function loadBrowseAI() {
  const el = document.getElementById('browseAIList');
  const countEl = document.getElementById('browseAICount');
  el.innerHTML = '<div class="browse-empty">Loading...</div>';
  try {
    const data = await fetchJSON('/api/sessions?player_type=agent');
    let sessions = (data.sessions || []).filter(s => (s.steps || 0) >= 5);
    if (MODE === 'prod') sessions = sessions.filter(s => s.game_id !== 'fd01-00000001');
    sessions = sessions.filter(_matchesGameFilter);
    countEl.textContent = sessions.length ? `(${sessions.length})` : '';
    if (!sessions.length) {
      el.innerHTML = `<div class="browse-empty">${_browseGameFilter ? 'No AI sessions for this game.' : 'No AI sessions with 5+ steps yet.'}</div>`;
      return;
    }
    el.innerHTML = '';
    for (const s of sessions) el.appendChild(buildSessionRow(s));
  } catch (e) {
    el.innerHTML = `<div class="browse-empty">Error: ${e.message}</div>`;
  }
}

// ── My Sessions column ──────────────────────────────────────────────────

async function loadBrowseMy() {
  const el = document.getElementById('browseMyList');
  const countEl = document.getElementById('browseMyCount');

  // If logged in, fetch user's sessions from server
  if (currentUser) {
    el.innerHTML = '<div class="browse-empty">Loading...</div>';
    try {
      const data = await fetchJSON('/api/sessions?mine=1');
      const serverSessions = data.sessions || [];
      // Merge with local sessions (dedup by id)
      const localSessions = getLocalSessions();
      const byId = {};
      for (const s of serverSessions) byId[s.id] = s;
      for (const s of localSessions) { if (!byId[s.id]) byId[s.id] = s; }
      let merged = Object.values(byId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      merged = merged.filter(_matchesGameFilter);
      countEl.textContent = merged.length ? `(${merged.length})` : '';
      if (!merged.length) {
        el.innerHTML = `<div class="browse-empty">${_browseGameFilter ? 'No sessions for this game.' : 'No sessions yet.'}</div>`;
        return;
      }
      el.innerHTML = '';
      for (const s of merged) el.appendChild(buildSessionRow(s));
    } catch (e) {
      el.innerHTML = `<div class="browse-empty">Error: ${e.message}</div>`;
    }
    return;
  }

  // Not logged in — show local-only sessions
  let localSessions = getLocalSessions().filter(_matchesGameFilter);
  countEl.textContent = localSessions.length ? `(${localSessions.length})` : '';
  if (!localSessions.length) {
    el.innerHTML = `<div class="browse-empty">${_browseGameFilter ? 'No local sessions for this game.' : 'Log in to see sessions across devices, or play a game.'}</div>`;
    return;
  }
  el.innerHTML = '';
  for (const s of localSessions) {
    el.appendChild(buildSessionRow(s, true));
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────

async function fetchAllSessions(forceRefresh) {
  if (_browseGlobalCache && !forceRefresh) return _browseGlobalCache;
  const data = await fetchJSON('/api/sessions');
  let serverSessions = data.sessions || [];
  // Merge localStorage sessions (dedup)
  if (MODE === 'prod') {
    const byId = {};
    for (const s of serverSessions) byId[s.id] = s;
    for (const s of getLocalSessions()) { if (!byId[s.id]) byId[s.id] = s; }
    serverSessions = Object.values(byId);
  }
  serverSessions.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  _browseGlobalCache = serverSessions;
  return serverSessions;
}

function buildSessionRow(s, isLocal) {
  const div = document.createElement('div');
  div.className = 'session-row';
  const date = new Date((s.created_at || 0) * 1000);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const result = s.result || 'NOT_FINISHED';
  const resultClass = `s-result-${result}`;
  const branchHtml = s.parent_session_id
    ? `<span class="s-branch">&#8627; branch@${s.branch_at_step || '?'}</span>` : '';
  const isHuman = s.player_type === 'human';
  const isLive = s.live_mode === 1 || s.live_mode === true;
  const durationStr = (s.duration_seconds || s.duration) ? formatDuration(s.duration_seconds || s.duration) : '';
  let metaParts;
  if (isHuman) {
    metaParts = [
      isLive ? 'LIVE' : null,
      `${s.steps || 0} steps`,
      durationStr,
      dateStr,
    ].filter(Boolean).join(' \u00b7 ');
  } else {
    const costStr = (s.total_cost || s.cost || 0) > 0
      ? `$${(s.total_cost || s.cost || 0).toFixed(4)}` : '';
    metaParts = [
      `${s.steps || 0} steps`,
      s.model || '',
      costStr,
      dateStr,
    ].filter(Boolean).join(' \u00b7 ');
  }

  div.innerHTML = `
    ${branchHtml}
    <span class="s-game">${gameShortName(s.game_id) || '?'}</span>
    ${isLive ? '<span class="live-tag" style="font-size:9px;padding:1px 4px;">LIVE</span>' : ''}
    <span class="s-result ${resultClass}">${result}</span>
    ${isHuman ? '' : `<span class="s-model">${s.model || '\u2014'}</span>`}
    <span class="s-meta">${metaParts}</span>
    <span class="s-actions">
      <button class="btn" onclick="event.stopPropagation(); window.open('/share?id=${s.id}','_blank');">Shareable Replay</button>
      ${result === 'NOT_FINISHED' ? `<button class="btn btn-primary" onclick="event.stopPropagation(); browseResume('${s.id}');">&#9654; Resume playing</button>` : ''}
      ${isLocal ? `<button class="btn btn-danger" onclick="event.stopPropagation(); browseDeleteLocal('${s.id}', this);">Delete</button>` : ''}
    </span>`;
  return div;
}

function browseReplay(sid) {
  showAppView('play');
  loadReplay(sid);
}

function browseResume(sid) {
  showAppView('play');
  // Create a new session tab for this resume
  if (!sessions.has(sid)) {
    // Detach current session if any
    if (activeSessionId && sessions.has(activeSessionId)) {
      saveSessionToState();
      detachSessionView(activeSessionId);
    }
    const s = new SessionState(sid);
    sessions.set(sid, s);
    activeSessionId = sid;
    attachSessionView(sid);
    renderSessionTabs();
  } else {
    switchSession(sid);
  }
  resumeSession(sid);
}

function browseDeleteLocal(sid, btn) {
  if (!confirm('Delete this local session?')) return;
  deleteLocalSession(sid);
  const row = btn.closest('.session-row');
  if (row) row.remove();
}
