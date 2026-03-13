// Author: Mark Barney + Cascade (Claude Opus 4.6 thinking)
// Date: 2026-03-11 13:47
// PURPOSE: UI interaction handlers for ARC-AGI-3 web UI. Provides collapsible section
//   toggling, compact settings, grid rendering wrappers (renderGrid, renderGridWithChanges
//   delegating to grid-renderer.js), keyboard/mouse input handling, canvas click-to-act,
//   cell info tooltips, navigation buttons, and DOM manipulation helpers. Modified in
//   Phase 3 to extract pure grid rendering to rendering/grid-renderer.js.
//
// PHASE 24 (2026-03-12): Modularized UI into focused files:
//   - ui-models.js: Model selector, BYOK keys, model caps
//   - ui-tokens.js: Token display, context limits, compact settings
//   - ui-grid.js: Grid rendering, canvas interaction, coord tooltips
//   This file now owns: core UI init, event listeners, game logic, actions, API calls
//
// SRP/DRY check: Pass — pure rendering in grid-renderer.js; focused module separation; this file owns init and interaction logic
// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSIBLE SECTIONS (tab switching extracted to ui-tabs.js)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// GRAPHICS LISTENERS (grid rendering functions extracted to ui-grid.js)
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('changeOpacity').addEventListener('input', (e) => {
  document.getElementById('changeOpacityVal').textContent = e.target.value + '%';
  redrawGrid();
});
document.getElementById('showChanges').addEventListener('change', redrawGrid);
document.getElementById('changeColor').addEventListener('input', redrawGrid);

function showTransportDesc(text) {
  document.getElementById('transportDesc').textContent = text;
}
function clearTransportDesc() {
  document.getElementById('transportDesc').textContent = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CAPABILITIES → auto-disable image toggle
// Moved to ui-models.js: getSelectedModel(), getModelInfo(), updateAllByokKeys(), updateModelCaps()
// ═══════════════════════════════════════════════════════════════════════════

function updateModelEta() { /* removed — countdown/ETA disabled */ }

// ═══════════════════════════════════════════════════════════════════════════
// RENDERING
// Moved to ui-grid.js: renderGrid(), renderGridWithChanges()
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATE TOOLTIP & HIGHLIGHT
// Moved to ui-grid.js: drawCanvasHover(), drawCellHighlights(), highlightCellsOnCanvas(), 
// clearCellHighlights(), annotateCoordRefs(), cellsFromCoordRef(), and associated listeners
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

async function fetchJSON(url, body, signal) {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: signal || undefined,
  });
  return r.json();
}

const _ARC_FOUNDATION_GAMES = ['ls20', 'vc33', 'ft09', 'lp85'];
function gameSource(gameId) {
  const short = (gameId || '').split('-')[0].toLowerCase();
  return _ARC_FOUNDATION_GAMES.includes(short) ? 'ARC Prize Foundation' : 'ARC Observatory';
}
function gameDevTag(gameId) {
  const short = (gameId || '').split('-')[0].toLowerCase();
  if (_ARC_FOUNDATION_GAMES.includes(short)) return '';
  return '<span class="dev-tag" title="The game is currently iterating through feedback before released and open-sourced">staging</span>';
}

async function loadGames() {
  let games = await fetchJSON('/api/games');
  // Hide "Find the Difference" on the online/global server for now
  // prod filtering handled server-side via HIDDEN_GAMES
  const el = document.getElementById('gameList');
  el.innerHTML = '';
  const foundation = games.filter(g => _ARC_FOUNDATION_GAMES.includes(g.game_id.split('-')[0].toLowerCase()));
  const observatory = games.filter(g => !_ARC_FOUNDATION_GAMES.includes(g.game_id.split('-')[0].toLowerCase()));
  const sortByTitle = (a, b) => ((a.title || a.game_id).localeCompare(b.title || b.game_id));
  foundation.sort(sortByTitle);
  observatory.sort(sortByTitle);
  _renderGameGroup(el, 'ARC Prize Foundation', foundation, g => startGame(g.game_id));
  _renderGameGroup(el, 'ARC Observatory', observatory, g => startGame(g.game_id));
}

function _renderGameGroup(el, label, games, onClick) {
  if (!games.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'game-group';
  const header = document.createElement('div');
  header.className = 'game-group-header';
  header.innerHTML = `<span class="game-group-arrow">&#9662;</span> ${_esc(label)} <span class="game-group-count">${games.length}</span>`;
  header.onclick = () => {
    wrap.classList.toggle('collapsed');
    header.querySelector('.game-group-arrow').innerHTML = wrap.classList.contains('collapsed') ? '&#9656;' : '&#9662;';
  };
  wrap.appendChild(header);
  const list = document.createElement('div');
  list.className = 'game-group-list';
  games.forEach(g => {
    const div = document.createElement('div');
    div.className = 'game-card';
    const shortName = g.title || g.game_id.split('-')[0].toUpperCase();
    const tag = gameDevTag(g.game_id);
    const liveTag = (g.tags || []).includes('live') ? ' <span class="live-tag">LIVE</span>' : '';
    const gameLabel = g.game_id.split('-')[0].toUpperCase();
    div.innerHTML = `<div class="title">${shortName}${tag ? ' ' + tag : ''}${liveTag}</div><div class="game-id-label">${gameLabel}</div>`;
    div.dataset.gameId = g.game_id;
    div.onclick = () => onClick(g);
    list.appendChild(div);
  });
  wrap.appendChild(list);
  el.appendChild(wrap);
}

function gameShortName(gameId) {
  return (gameId || '').split('-')[0].toUpperCase();
}

async function startGame(gameId) {
  // Block game change if current session already has moves
  const cur = getActiveSession();
  if (cur && cur.stepCount > 0) return;

  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.game-card').forEach(c => {
    if (c.dataset.gameId === gameId) c.classList.add('active');
  });

  // Pyodide mode: run game entirely client-side. Server mode: run entirely server-side.
  let data;
  if (FEATURES.pyodide_game) {
    _pyodideGameActive = true;
    _pyodideGameSessionId = activeSessionId;
    try {
      data = await pyodideStartGame(gameId);
      console.log('[PyodideGame] Game started client-side:', gameId);
    } catch (err) {
      _pyodideGameActive = false;
      alert('Game engine failed to load: ' + err.message);
      return;
    }
  } else {
    _pyodideGameActive = false;
    data = await fetchJSON('/api/start', { game_id: gameId });
  }
  if (data.error) { alert(data.error); return; }

  sessionId = data.session_id;
  stepCount = 0;
  llmCallCount = 0;
  turnCounter = 0;
  _cachedCompactSummary = '';
  _compactSummaryAtCall = 0;
  _compactSummaryAtStep = 0;
  moveHistory = [];
  undoStack = [];
  sessionStepsBuffer = [];
  sessionStartTime = Date.now() / 1000;
  syncStepCounter = 0;
  llmObservations = [];
  sessionTotalTokens = { input: 0, output: 0, cost: 0 };
  autoPlaying = false;
  updateUI(data);
  updateUndoBtn();

  if ((data.available_actions || []).includes(6)) { action6Mode = true; canvas.style.cursor = 'crosshair'; }
  document.getElementById('emptyState').style.display = 'none';
  canvas.style.display = 'block';
  document.getElementById('controls').style.display = 'flex';
  document.getElementById('transportBar').style.display = 'block';
  document.getElementById('reasoningContent').innerHTML =
    '<div class="empty-state" style="height:auto;font-size:12px;">Game started. Press Agent Autoplay to let the agent play, or use the controls to play yourself.</div>';

  // ── Multi-session: reuse current tab when switching games (no moves yet) ──
  const curSession = getActiveSession();
  if (curSession && curSession.stepCount === 0) {
    // Reuse the current tab — just swap the session ID
    const oldId = activeSessionId;
    sessions.delete(oldId);
    curSession.sessionId = data.session_id;
    curSession.gameId = gameShortName(gameId);
    curSession.status = data.state || 'NOT_FINISHED';
    curSession.createdAt = Date.now() / 1000;
    curSession.callDurations = [];
    curSession.tabLabel = '';
    sessions.set(data.session_id, curSession);
    activeSessionId = data.session_id;
    // Update Pyodide ownership to match the new session ID
    if (_pyodideGameSessionId === oldId) _pyodideGameSessionId = data.session_id;
  } else if (!curSession) {
    // No active session at all (first load)
    const s = new SessionState(data.session_id);
    s.gameId = gameShortName(gameId);
    s.status = data.state || 'NOT_FINISHED';
    s.createdAt = Date.now() / 1000;
    registerSession(data.session_id, s);
  } else {
    // Active session has moves — create a new tab
    saveSessionToState();
    detachSessionView(activeSessionId);
    const s = new SessionState(data.session_id);
    s.gameId = gameShortName(gameId);
    s.status = data.state || 'NOT_FINISHED';
    s.createdAt = Date.now() / 1000;
    sessions.set(data.session_id, s);
    activeSessionId = data.session_id;
    attachSessionView(data.session_id);
    // Re-apply DOM writes on the fresh view
    document.getElementById('emptyState').style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('transportBar').style.display = 'block';
    document.getElementById('reasoningContent').innerHTML =
      '<div class="empty-state" style="height:auto;font-size:12px;">Game started. Press Agent Autoplay to let the agent play, or use the controls to play yourself.</div>';
    renderSessionTabs();
    saveSessionIndex();
  }
  renderSessionTabs();
  saveSessionIndex();
  updatePanelBlur();
  updateGameListLock();

  // Blink the Agent Autoplay button to guide the user
  const autoBtn = document.getElementById('autoPlayBtn');
  if (autoBtn) autoBtn.classList.add('btn-blink');

  // Initialize live scrubber
  initLiveScrubber();
}

function updateUI(data) {
  previousGrid = currentGrid;
  currentState = data;
  currentGrid = data.grid;
  currentChangeMap = data.change_map || null;
  // If viewing historical step via either scrubber, don't render live grid
  const _inObsMode = isObsModeActive();
  const _scrubPaused = _inObsMode ? !_obsScrubLive : !_liveScrubMode;
  if (_scrubPaused) {
    if (!_inObsMode) _liveScrubLiveGrid = data.grid;
  } else if (currentChangeMap && currentChangeMap.change_count > 0 && document.getElementById('showChanges').checked) {
    renderGridWithChanges(data.grid, currentChangeMap);
  } else {
    renderGrid(data.grid);
  }
  if (_inObsMode) obsScrubUpdate();
  else liveScrubUpdate();
  const titleEl = document.getElementById('gameTitle');
  titleEl.textContent = gameShortName(data.game_id) || 'Game';
  // Show "Local" badge when running via Pyodide
  const existingBadge = titleEl.parentElement.querySelector('.pyodide-badge');
  if (existingBadge) existingBadge.remove();
  if (_pyodideGameActive) {
    const badge = document.createElement('span');
    badge.className = 'pyodide-badge';
    badge.style.cssText = 'display:inline-block;background:#4FCC30;color:#000;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:6px;vertical-align:middle;';
    badge.textContent = 'Local';
    titleEl.parentElement.insertBefore(badge, titleEl.nextSibling);
  }
  const statusEl = document.getElementById('gameStatus');
  statusEl.textContent = data.state; statusEl.className = 'status status-' + data.state;
  document.getElementById('levelInfo').textContent = `Level ${data.levels_completed}/${data.win_levels}`;
  const ci = currentChangeMap?.change_count > 0 ? ` | ${currentChangeMap.change_count} cells` : '';
  document.getElementById('stepCounter').textContent = `Step ${stepCount}${ci}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showNoChangeIfSame(prevGrid, newGrid) {
  const el = document.getElementById('noChangeMsg');
  if (prevGrid && JSON.stringify(newGrid) === prevGrid) {
    el.textContent = 'no state change';
    el.className = 'no-change-flash';
    el.style.display = '';
    setTimeout(() => { el.style.display = 'none'; }, 2000);
  } else {
    el.style.display = 'none';
  }
}

function toggleHumanLock() {
  humanLocked = !humanLocked;
  const ctrl = document.getElementById('controls');
  const btn = document.getElementById('interveneBtn');
  if (humanLocked) {
    ctrl.classList.add('locked');
    btn.classList.remove('active');
    btn.innerHTML = '&#128274; Intervene as Human';
  } else {
    ctrl.classList.remove('locked');
    btn.classList.add('active');
    btn.innerHTML = '&#128275; Controls Unlocked';
  }
}

function lockHumanControls() {
  humanLocked = true;
  const ctrl = document.getElementById('controls');
  const btn = document.getElementById('interveneBtn');
  if (ctrl) ctrl.classList.add('locked');
  if (btn) { btn.classList.remove('active'); btn.innerHTML = '&#128274; Intervene as Human'; }
}

function lockSettings() {
  // Grey out settings controls but keep the scaffold diagram visible (it shows live call status)
  const body = document.getElementById('settingsBody');
  if (body) { body.style.opacity = '0.5'; body.style.pointerEvents = 'none'; }
  const scaffSelect = document.getElementById('scaffoldingSelect');
  if (scaffSelect) scaffSelect.disabled = true;
  const sidebar = document.getElementById('gameSidebar');
  if (sidebar) sidebar.classList.add('locked');
}

function unlockSettings() {
  const body = document.getElementById('settingsBody');
  if (body) { body.style.opacity = ''; body.style.pointerEvents = ''; }
  const scaffSelect = document.getElementById('scaffoldingSelect');
  if (scaffSelect) scaffSelect.disabled = false;
  updateGameListLock();  // re-evaluate — may stay locked if session in progress
}

function logHumanAction(actionId, actionData, changeMap, turnId) {
  const content = document.getElementById('reasoningContent');
  if (content.querySelector('.empty-state')) content.innerHTML = '';
  const entry = document.createElement('div');
  entry.className = 'reasoning-entry';
  if (turnId) entry.setAttribute('data-turn-id', turnId);
  const ci = changeMap?.change_count > 0 ? ` | ${changeMap.change_count} cells changed` : '';
  const coordStr = actionData?.x !== undefined ? ` at (${actionData.x}, ${actionData.y})` : '';
  entry.innerHTML = `
    <button class="branch-btn" onclick="branchFromStep(${stepCount})" title="Branch from step ${stepCount}">&#8627; branch</button>
    <div class="step-label" style="color:var(--yellow);">Step ${stepCount} — Human</div>
    <div class="action-rec" style="color:var(--yellow);">\u2192 Action ${actionId} (${ACTION_NAMES[actionId] || '?'})${coordStr}${ci}</div>`;
  content.appendChild(entry);
  annotateCoordRefs(entry);
  scrollReasoningToBottom();
}

async function doAction(actionId, isClick) {
  if (humanLocked) return;
  if (!sessionId) return;
  if (isClick || actionId === 6) {
    action6Mode = true; canvas.style.cursor = 'crosshair'; canvas.title = 'Click grid for ACTION6';
    return;
  }
  // Save undo snapshot
  turnCounter++;
  const currentTurnId = turnCounter;
  undoStack.push({
    grid: currentState.grid ? currentState.grid.map(r => [...r]) : [],
    state: currentState.state,
    levels_completed: currentState.levels_completed,
    stepCount: stepCount,
    turnId: currentTurnId,
  });
  stepCount++;
  const prevGrid = currentState.grid ? JSON.stringify(currentState.grid) : null;
  const data = await gameStep(sessionId, actionId, {}, {session_cost: sessionTotalTokens.cost});
  if (data.error) { undoStack.pop(); alert(data.error); return; }
  moveHistory.push({ step: stepCount, action: actionId, result_state: data.state, levels: data.levels_completed, grid: data.grid, change_map: data.change_map, turnId: currentTurnId });
  recordStepForPersistence(actionId, {}, data.grid, data.change_map, null, null, { levels_completed: data.levels_completed, result_state: data.state });
  logHumanAction(actionId, {}, data.change_map, currentTurnId);
  updateUI(data);
  showNoChangeIfSame(prevGrid, data.grid);
  updateUndoBtn();
  checkSessionEndAndUpload();
}

canvas.addEventListener('click', async (e) => {
  if (humanLocked) return;
  if (!action6Mode || !sessionId) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * 64 / canvas.clientWidth);
  const y = Math.floor((e.clientY - rect.top) * 64 / canvas.clientHeight);
  // Save undo snapshot
  turnCounter++;
  const currentTurnId = turnCounter;
  undoStack.push({
    grid: currentState.grid ? currentState.grid.map(r => [...r]) : [],
    state: currentState.state,
    levels_completed: currentState.levels_completed,
    stepCount: stepCount,
    turnId: currentTurnId,
  });
  stepCount++;
  const prevGrid = currentState.grid ? JSON.stringify(currentState.grid) : null;
  const data = await gameStep(sessionId, 6, { x, y }, {session_cost: sessionTotalTokens.cost});
  if (data.error) { undoStack.pop(); alert(data.error); return; }
  moveHistory.push({ step: stepCount, action: 6, result_state: data.state, x, y, levels: data.levels_completed, grid: data.grid, change_map: data.change_map, turnId: currentTurnId });
  recordStepForPersistence(6, { x, y }, data.grid, data.change_map, null, null, { levels_completed: data.levels_completed, result_state: data.state });
  logHumanAction(6, { x, y }, data.change_map, currentTurnId);
  updateUI(data);
  showNoChangeIfSame(prevGrid, data.grid);
  updateUndoBtn();
  checkSessionEndAndUpload();
  action6Mode = (data.available_actions || []).includes(6);
  if (!action6Mode) canvas.style.cursor = 'default';
});

document.addEventListener('keydown', (e) => {
  if (!sessionId) return;
  if (humanLocked) return;
  // Don't capture keyboard when user is interacting with inputs/settings
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const map = {'ArrowUp':1,'ArrowDown':2,'ArrowLeft':3,'ArrowRight':4,'w':1,'s':2,'a':3,'d':4,'z':5,'x':7,'r':0};
  if (map[e.key] !== undefined) { e.preventDefault(); doAction(map[e.key]); }
});

// ═══════════════════════════════════════════════════════════════════════════
// WARN BEFORE LEAVING (active session protection)
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener('beforeunload', (e) => {
  // Warn if any session has steps in progress
  const hasActiveSession = sessionId && stepCount > 0 && currentState.state === 'NOT_FINISHED';
  const hasAutoplay = autoPlaying;
  if (hasActiveSession || hasAutoplay) {
    e.preventDefault();
    // Modern browsers ignore custom text but require returnValue to be set
    e.returnValue = '';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// REASONING MODE HELPERS
// Moved to ui-tokens.js: getCompactSettings(), checkInterrupt(), buildCompactContext(), 
// manualCompact(), and associated helpers
// ═══════════════════════════════════════════════════════════════════════════

// ── Session event logging ──────────────────────────────────────────────
function logSessionEvent(eventType, stepNum, data = {}) {
  if (!sessionId) return;
  fetchJSON(`/api/sessions/${sessionId}/event`, {
    event_type: eventType,
    step_num: stepNum,
    data: data,
  }).catch(() => {});  // fire and forget
}
