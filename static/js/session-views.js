// ═══════════════════════════════════════════════════════════════════════════
// SESSION VIEWS — App routing and session browsing/resumption UI
// ═══════════════════════════════════════════════════════════════════════════
//
// This module handles all session view routing and rendering:
// - Session resumption: resumeSession(), branchFromStep(), branchHere()
// - App view routing: showAppView(), _routeFromHash() — play, browse, menu, leaderboards, etc.
// - Menu view: showMenuView(), renderMenuSessions(), menuResume()
// - Browse view: loadBrowseView(), loadBrowseHuman(), loadBrowseAI(), loadBrowseMy()
// - Prompts tab: _humanizePromptName(), _getPromptSections(), renderPromptsTab(), etc.
// - Session browsing: buildSessionRow(), browseReplay(), browseResume(), browseDeleteLocal()
//
// Dependencies:
// - fetchJSON(), gameShortName(), renderGrid(), startGame(), updateUI() (from ui.js)
// - currentUser, currentState, currentGrid, sessionId, moveHistory, stepCount (from state.js)
// - sessions, activeSessionId, getActiveSession(), registerSession(), saveSessionToState(), renderSessionTabs(), updateEmptyAppState() (from ui.js globals)
// - loadSessionHistory() (from session-replay.js)
// - renderRestoredReasoning() (from session-persistence.js)
// - getLocalSessionData() (from session-storage.js)
// - getPrompt(), buildReasoningGroupHTML(), annotateCoordRefs(), scrollReasoningToBottom() (from llm.js)
// ═══════════════════════════════════════════════════════════════════════════

async function resumeSession(sid) {
  // Guard: don't overwrite an active session that already has a loaded grid
  if (sessionId === sid && currentGrid && stepCount > 0) return;

  // Track whether session was already registered — used to detect close-during-resume
  const _wasRegistered = sessions.has(sid);

  try {
    let data = await fetchJSON('/api/sessions/resume', { session_id: sid });
    if (data.error) {
      // Server doesn't have this session — try localStorage fallback
      const localData = getLocalSessionData(sid);
      if (localData && localData.steps && localData.steps.length > 0) {
        console.log(`[resumeSession] Server 404, restoring ${sid} from localStorage (${localData.steps.length} steps)`);
        // Re-upload to server so future resumes work
        const reimportPayload = { session: localData.session, steps: localData.steps };
        fetch('/api/sessions/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reimportPayload),
        }).catch(() => {});
        // Retry resume after re-import
        await new Promise(r => setTimeout(r, 500));
        data = await fetchJSON('/api/sessions/resume', { session_id: sid });
        if (data.error) {
          // Still failed — start fresh with the game from localStorage
          console.warn(`[resumeSession] Re-import failed for ${sid}, starting fresh`);
          const gameId = localData.session?.game_id;
          if (gameId) {
            // Remove the dead session and let the user start fresh
            sessions.delete(sid);
            saveSessionIndex();
            renderSessionTabs();
          }
          return;
        }
      } else {
        // No local data either — session is truly gone
        console.warn(`[resumeSession] Session ${sid} not found in server or localStorage`);
        sessions.delete(sid);
        saveSessionIndex();
        renderSessionTabs();
        updateEmptyAppState();
        return;
      }
    }

    // Guard: if session was registered before the await but got closed while server was replaying, abort
    if (_wasRegistered && !sessions.has(sid)) {
      console.log('[resumeSession] Session was closed during server replay, aborting.');
      return;
    }

    // Set up client state for live play
    sessionId = sid;
    stepCount = data.resumed_step_count || 0;
    autoPlaying = false;
    _cachedCompactSummary = '';
    _compactSummaryAtCall = 0;
    _compactSummaryAtStep = 0;
    undoStack = [];
    syncStepCounter = 0;

    // Rebuild moveHistory, sessionStepsBuffer, llmObservations, and token totals from step history
    moveHistory = [];
    sessionStepsBuffer = [];
    llmObservations = [];
    llmCallCount = 0;
    turnCounter = 0;
    sessionTotalTokens = { input: 0, output: 0, cost: 0 };
    const steps = data.steps || [];
    let _rebuildPlanRemaining = 0;
    for (const s of steps) {
      // Rebuild turnIds: LLM leader starts new turn, followers inherit, human gets own turn
      const llm = s.llm_response;
      if (llm && llm.parsed) {
        turnCounter++;
        _rebuildPlanRemaining = ((llm.parsed.plan && Array.isArray(llm.parsed.plan)) ? llm.parsed.plan.length : 1) - 1;
      } else if (_rebuildPlanRemaining > 0) {
        _rebuildPlanRemaining--;
      } else {
        turnCounter++; // human action
      }
      const _turnId = turnCounter;
      // Rebuild moveHistory (with per-step game stats from server replay)
      moveHistory.push({
        step: s.step_num,
        action: s.action,
        result_state: s.result_state || 'NOT_FINISHED',
        levels: s.levels_completed || 0,
        grid: s.grid || null,
        change_map: s.change_map || null,
        turnId: _turnId,
        observation: llm?.parsed?.observation || '',
        reasoning: llm?.parsed?.reasoning || '',
      });
      // Rebuild sessionStepsBuffer
      sessionStepsBuffer.push({
        step_num: s.step_num,
        action: s.action,
        data: s.data || {},
        grid: s.grid || null,
        change_map: s.change_map || null,
        llm_response: s.llm_response || null,
        timestamp: s.timestamp || 0,
      });
      // Rebuild llmObservations from LLM responses
      if (llm && llm.parsed) {
        llmCallCount++;
        llmObservations.push({
          step: s.step_num,
          observation: llm.parsed.observation || '',
          reasoning: llm.parsed.reasoning || '',
          action: llm.parsed.action,
          analysis: llm.parsed.analysis || '',
        });
      }
      // Rebuild sessionTotalTokens from LLM usage
      if (llm && llm.usage) {
        const inputTok = llm.usage.input_tokens || llm.usage.prompt_tokens || 0;
        const outputTok = llm.usage.output_tokens || llm.usage.completion_tokens || 0;
        sessionTotalTokens.input += inputTok;
        sessionTotalTokens.output += outputTok;
        const model = llm.model || data.model || '';
        const prices = TOKEN_PRICES[model] || null;
        if (prices) {
          sessionTotalTokens.cost += (inputTok * prices[0] + outputTok * prices[1]) / 1_000_000;
        }
      }
    }

    // If no token data from llm_response (e.g. Agent Spawn), rebuild from timeline events
    if (sessionTotalTokens.input === 0 && sessionTotalTokens.output === 0 && data.timeline) {
      for (const ev of data.timeline) {
        if (ev.input_tokens) sessionTotalTokens.input += ev.input_tokens;
        if (ev.output_tokens) sessionTotalTokens.output += ev.output_tokens;
        if (ev.cost) sessionTotalTokens.cost += ev.cost;
      }
      // Count LLM calls from timeline: each sub_act and orch_think/delegate is a call
      if (llmCallCount === 0) {
        for (const ev of data.timeline) {
          if (['as_sub_act', 'as_sub_tool', 'as_sub_report', 'as_orch_think', 'as_orch_delegate'].includes(ev.type)) {
            llmCallCount++;
          }
        }
      }
    }
    sessionStartTime = Date.now() / 1000;

    // Close replay if open
    closeReplay();

    updateUI(data);
    updateUndoBtn();

    // Show controls
    document.getElementById('emptyState').style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('transportBar').style.display = 'block';
    initLiveScrubber();
    liveScrubUpdate();

    // Highlight the matching game card in the sidebar
    if (data.game_id) {
      document.querySelectorAll('.game-card').forEach(c => {
        c.classList.toggle('active', c.dataset.gameId === data.game_id);
      });
    }

    if ((data.available_actions || []).includes(6)) {
      action6Mode = true;
      canvas.style.cursor = 'crosshair';
    }

    // Switch to Agent tab
    switchTopTab('agent');

    // Log the resume event
    logSessionEvent('resumed', stepCount, {});

    // ── Restore settings from session history ──
    // Find model + scaffolding from LLM responses or timeline events
    let _resumeModel = data.model || '';
    let _resumeScaffolding = 'linear';
    for (let i = steps.length - 1; i >= 0; i--) {
      const llm = steps[i].llm_response;
      if (llm) {
        if (llm.model) _resumeModel = llm.model;
        if (llm.scaffolding) _resumeScaffolding = llm.scaffolding;
        break;
      }
    }
    // Switch scaffolding UI to match session's scaffolding (if it's a known type)
    if (SCAFFOLDING_SCHEMAS[_resumeScaffolding] && _resumeScaffolding !== activeScaffoldingType) {
      switchScaffolding(_resumeScaffolding);
    }
    // Set model select to match session's model
    if (_resumeModel) {
      await loadModels();
      const _msel = document.getElementById('modelSelect');
      if (_msel && [..._msel.options].some(o => o.value === _resumeModel)) {
        _msel.value = _resumeModel;
      }
    }

    // ── Multi-session: register resumed session ──
    if (!sessions.has(sid)) {
      const s = new SessionState(sid);
      registerSession(sid, s);
    }
    activeSessionId = sid;

    // Rebuild timelineEvents from step history (or use saved timeline)
    const _tlSs = sessions.get(sid);
    if (_tlSs) {
      _tlSs.timelineEvents = data.timeline || _rebuildTimelineFromSteps(steps);
      // Rebuild obs events from timeline for observatory display
      _tlSs._obsEvents = [];
      const _tl = _tlSs.timelineEvents;
      const _tlStart = _tl.length ? (_tl[0].timestamp || 0) : 0;
      for (const ev of _tl) {
        const agentType = ev.agent_type || ev.current_agent || 'orchestrator';
        const obsEvent = ev.type?.startsWith('as_') ? ev.type.replace('as_', '') : (ev.type || '');
        const obsData = { event: obsEvent, agent: agentType.toLowerCase() };
        if (ev.timestamp) {
          const d = new Date(ev.timestamp);
          obsData.t = d.toISOString();
          obsData.elapsed_s = (ev.timestamp - _tlStart) / 1000;
        }
        if (ev.model) obsData.model = ev.model;
        if (ev.duration_ms) obsData.duration_ms = ev.duration_ms;
        if (ev.input_tokens) obsData.input_tokens = ev.input_tokens;
        if (ev.output_tokens) obsData.output_tokens = ev.output_tokens;
        if (ev.cost) obsData.cost = ev.cost;
        if (ev.task || ev.summary) obsData.summary = ev.task || ev.summary;
        if (ev.reasoning) obsData.reasoning = ev.reasoning;
        if (ev.response) obsData.response = ev.response;
        if (ev.findings != null) obsData.findings = ev.findings;
        if (ev.hypotheses != null) obsData.hypotheses = ev.hypotheses;
        if (ev.action_name) obsData.action_name = ev.action_name;
        if (ev.tool_name) obsData.tool_name = ev.tool_name;
        if (ev.step_num != null) obsData.step_num = ev.step_num;
        _tlSs._obsEvents.push(obsData);
      }
      // Enrich moveHistory from timeline events (for legacy sessions where llm_response was NULL)
      if (moveHistory.length && _tl.length) {
        const tlByStep = {};
        for (const ev of _tl) {
          if (ev.step_num != null && (ev.reasoning || ev.action_name || ev.agent_type)) {
            tlByStep[ev.step_num] = ev;
          }
        }
        for (const h of moveHistory) {
          if (!h.observation && !h.reasoning && tlByStep[h.step]) {
            const ev = tlByStep[h.step];
            h.observation = ev.action_name ? `[${ev.agent_type || 'agent'}] ${ev.action_name}` : '';
            h.reasoning = ev.reasoning || '';
          }
        }
        // Also backfill sessionStepsBuffer so renderRestoredReasoning sees LLM groups (not "Human")
        for (const sb of sessionStepsBuffer) {
          if (!sb.llm_response && tlByStep[sb.step_num]) {
            const ev = tlByStep[sb.step_num];
            sb.llm_response = {
              parsed: {
                observation: ev.action_name ? `[${ev.agent_type || 'agent'}] ${ev.action_name}` : '',
                reasoning: ev.reasoning || '',
                action: sb.action,
                data: sb.data || {},
              },
              model: ev.model || _resumeModel || '',
              scaffolding: 'agent_spawn',
              usage: (ev.input_tokens || ev.output_tokens) ? { input_tokens: ev.input_tokens || 0, output_tokens: ev.output_tokens || 0 } : null,
              call_duration_ms: ev.duration_ms || null,
            };
          }
        }
      }
      // Store original settings for branch-on-change detection
      _tlSs._originalSettings = { model: _resumeModel, scaffolding_type: _resumeScaffolding };
      // Compute elapsed time from timeline timestamps (don't tick from now)
      if (_tl.length >= 2) {
        const t0 = _tl[0].timestamp || 0;
        const tN = _tl[_tl.length - 1].timestamp || 0;
        _tlSs._obsElapsedFixed = (tN - t0) / 1000;
      } else {
        _tlSs._obsElapsedFixed = 0;
      }
      // Session was loaded from server, so all steps are already uploaded
      _tlSs._lastUploadedStep = stepCount;
    }

    // Rebuild reasoning panel (after timeline enrichment so Agent Spawn steps show as LLM groups)
    renderRestoredReasoning(sessionStepsBuffer, `Session resumed at step ${stepCount} (${llmCallCount} prior LLM calls, ${sessionTotalTokens.input + sessionTotalTokens.output} tokens restored)`, 'var(--green)');

    saveSessionToState();
    renderSessionTabs();
    saveSessionIndex();
    updatePanelBlur();
    updateGameListLock();

    // Persist enriched steps back to DB so future resumes don't need re-enrichment
    if (sessionStepsBuffer.some(s => s.llm_response && !steps.find(orig => orig.step_num === s.step_num && orig.llm_response))) {
      autoUploadSession();
    }

    // Enter observability view so user sees the grid + scrubber
    enterObsMode(_tlSs || getActiveSession());
  } catch (e) {
    alert('Resume failed: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION BRANCHING (client-side)
// ═══════════════════════════════════════════════════════════════════════════

async function branchFromStep(stepNum) {
  // Branch the current live session at a given step number
  if (!sessionId) return;
  if (!confirm(`Branch from step ${stepNum}? This creates a new session from that point.`)) return;
  try {
    const data = await fetchJSON('/api/sessions/branch', {
      parent_session_id: sessionId,
      step_num: stepNum,
    });
    if (data.error) { alert(data.error); return; }

    const parentId = sessionId;
    sessionId = data.session_id;
    stepCount = stepNum;
    undoStack = [];
    syncStepCounter = 0;
    _cachedCompactSummary = '';
    _compactSummaryAtCall = 0;
    _compactSummaryAtStep = 0;
    autoPlaying = false;

    // Rebuild state from returned steps (same as resume)
    moveHistory = [];
    sessionStepsBuffer = [];
    llmObservations = [];
    llmCallCount = 0;
    turnCounter = 0;
    sessionTotalTokens = { input: 0, output: 0, cost: 0 };
    const steps = data.steps || [];
    let _rebuildPlanRemaining = 0;
    for (const s of steps) {
      const llm = s.llm_response;
      if (llm && llm.parsed) {
        turnCounter++;
        _rebuildPlanRemaining = ((llm.parsed.plan && Array.isArray(llm.parsed.plan)) ? llm.parsed.plan.length : 1) - 1;
      } else if (_rebuildPlanRemaining > 0) {
        _rebuildPlanRemaining--;
      } else {
        turnCounter++;
      }
      const _turnId = turnCounter;
      moveHistory.push({
        step: s.step_num,
        action: s.action,
        result_state: s.result_state || 'NOT_FINISHED',
        levels: s.levels_completed || 0,
        grid: s.grid || null,
        change_map: s.change_map || null,
        turnId: _turnId,
        observation: llm?.parsed?.observation || '',
        reasoning: llm?.parsed?.reasoning || '',
      });
      sessionStepsBuffer.push({
        step_num: s.step_num,
        action: s.action,
        data: s.data || {},
        grid: s.grid || null,
        change_map: s.change_map || null,
        llm_response: s.llm_response || null,
        timestamp: s.timestamp || 0,
      });
      if (llm && llm.parsed) {
        llmCallCount++;
        llmObservations.push({
          step: s.step_num,
          observation: llm.parsed.observation || '',
          reasoning: llm.parsed.reasoning || '',
          action: llm.parsed.action,
          analysis: llm.parsed.analysis || '',
        });
      }
      if (llm && llm.usage) {
        const inputTok = llm.usage.input_tokens || llm.usage.prompt_tokens || 0;
        const outputTok = llm.usage.output_tokens || llm.usage.completion_tokens || 0;
        sessionTotalTokens.input += inputTok;
        sessionTotalTokens.output += outputTok;
        const model = llm.model || '';
        const prices = TOKEN_PRICES[model] || null;
        if (prices) {
          sessionTotalTokens.cost += (inputTok * prices[0] + outputTok * prices[1]) / 1_000_000;
        }
      }
    }
    sessionStartTime = Date.now() / 1000;

    updateUI(data);
    updateUndoBtn();

    if ((data.available_actions || []).includes(6)) {
      action6Mode = true;
      canvas.style.cursor = 'crosshair';
    }

    logSessionEvent('branch_created', stepNum, { parent_session_id: parentId });
    switchTopTab('agent');

    // Render reasoning trace from parent steps
    renderRestoredReasoning(steps,
      `Branched from step ${stepNum} (${llmCallCount} prior LLM calls, $${sessionTotalTokens.cost.toFixed(3)} cost)`,
      'var(--purple)');

    // ── Multi-session: register branch session ──
    const bs = new SessionState(data.session_id);
    bs.gameId = data.game_id || currentState.game_id || '';
    bs.status = data.state || 'NOT_FINISHED';
    registerSession(data.session_id, bs);

    // Rebuild timelineEvents from step history
    bs.timelineEvents = _rebuildTimelineFromSteps(steps);

    saveSessionToState();
    renderSessionTabs();
    saveSessionIndex();
    updatePanelBlur();
    updateGameListLock();
  } catch (e) {
    alert('Branch failed: ' + e.message);
  }
}

async function branchHere() {
  if (!replayData || !replayData.session) return;
  const scrubber = document.getElementById('replayScrubber');
  const stepNum = parseInt(scrubber.value);
  const parentId = replayData.session.id;

  try {
    const data = await fetchJSON('/api/sessions/branch', {
      parent_session_id: parentId,
      step_num: stepNum,
    });
    if (data.error) { alert(data.error); return; }

    // Transition from replay to live play
    sessionId = data.session_id;
    stepCount = stepNum;
    undoStack = [];
    syncStepCounter = 0;
    _cachedCompactSummary = '';
    _compactSummaryAtCall = 0;
    _compactSummaryAtStep = 0;
    autoPlaying = false;
    replayData = null;

    // Rebuild state from returned steps
    moveHistory = [];
    sessionStepsBuffer = [];
    llmObservations = [];
    llmCallCount = 0;
    turnCounter = 0;
    sessionTotalTokens = { input: 0, output: 0, cost: 0 };
    const steps = data.steps || [];
    let _rebuildPlanRemaining = 0;
    for (const s of steps) {
      const llm = s.llm_response;
      if (llm && llm.parsed) {
        turnCounter++;
        _rebuildPlanRemaining = ((llm.parsed.plan && Array.isArray(llm.parsed.plan)) ? llm.parsed.plan.length : 1) - 1;
      } else if (_rebuildPlanRemaining > 0) {
        _rebuildPlanRemaining--;
      } else {
        turnCounter++;
      }
      const _turnId = turnCounter;
      moveHistory.push({
        step: s.step_num, action: s.action,
        result_state: s.result_state || 'NOT_FINISHED',
        levels: s.levels_completed || 0,
        grid: s.grid || null, change_map: s.change_map || null,
        turnId: _turnId,
        observation: llm?.parsed?.observation || '',
        reasoning: llm?.parsed?.reasoning || '',
      });
      sessionStepsBuffer.push({
        step_num: s.step_num, action: s.action, data: s.data || {},
        grid: s.grid || null, change_map: s.change_map || null,
        llm_response: s.llm_response || null, timestamp: s.timestamp || 0,
      });
      if (llm && llm.parsed) {
        llmCallCount++;
        llmObservations.push({
          step: s.step_num, observation: llm.parsed.observation || '',
          reasoning: llm.parsed.reasoning || '', action: llm.parsed.action,
          analysis: llm.parsed.analysis || '',
        });
      }
      if (llm && llm.usage) {
        const inTok = llm.usage.input_tokens || llm.usage.prompt_tokens || 0;
        const outTok = llm.usage.output_tokens || llm.usage.completion_tokens || 0;
        sessionTotalTokens.input += inTok;
        sessionTotalTokens.output += outTok;
        const prices = TOKEN_PRICES[llm.model || ''] || null;
        if (prices) sessionTotalTokens.cost += (inTok * prices[0] + outTok * prices[1]) / 1_000_000;
      }
    }
    sessionStartTime = Date.now() / 1000;

    // Hide replay bar, show controls
    document.getElementById('replayBar').style.display = 'none';
    document.getElementById('replayReasoningPanel').style.display = 'none';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('transportBar').style.display = 'block';
    initLiveScrubber();

    updateUI(data);
    updateUndoBtn();

    if ((data.available_actions || []).includes(6)) {
      action6Mode = true;
      canvas.style.cursor = 'crosshair';
    }

    // Log the branch event on the new session
    logSessionEvent('branch_created', stepNum, { parent_session_id: parentId });

    // Switch to Agent tab and render reasoning trace
    switchTopTab('agent');
    renderRestoredReasoning(steps,
      `Branched from replay at step ${stepNum} (${llmCallCount} prior LLM calls)`,
      'var(--purple)');

    // ── Multi-session: register branch session ──
    const bs = new SessionState(data.session_id);
    bs.gameId = data.game_id || '';
    bs.status = data.state || 'NOT_FINISHED';
    registerSession(data.session_id, bs);

    // Rebuild timelineEvents from step history
    bs.timelineEvents = _rebuildTimelineFromSteps(steps);

    saveSessionToState();
    renderSessionTabs();
    saveSessionIndex();
    updatePanelBlur();
    updateGameListLock();
  } catch (e) {
    alert('Branch failed: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY TAB (system prompt + hard memory editing)
// ═══════════════════════════════════════════════════════════════════════════

// ── Prompt section helpers (scaffolding-specific prompts from window.PROMPTS) ──

function _humanizePromptName(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _getPromptSections(schemaId) {
  const sections = _PROMPT_SECTION_MAP[schemaId] || ['shared'];
  const result = [];
  for (const section of sections) {
    const prompts = window.PROMPTS[section];
    if (!prompts) continue;
    for (const name of Object.keys(prompts).sort()) {
      result.push({ section, name, label: _humanizePromptName(name) });
    }
  }
  return result;
}

function _savePromptField(textarea) {
  const key = textarea.dataset.promptKey; // format: section.name
  if (!key) return;
  const [section, name] = key.split('.');
  const defaultVal = (window.PROMPTS[section] && window.PROMPTS[section][name]) || '';
  const lsKey = 'arc_prompt.' + key;
  if (textarea.value === defaultVal) {
    localStorage.removeItem(lsKey);
  } else {
    localStorage.setItem(lsKey, textarea.value);
  }
}

function _populatePromptFields() {
  document.querySelectorAll('textarea[data-prompt-key]').forEach(ta => {
    ta.value = getPrompt(ta.dataset.promptKey);
  });
}

// Which runtime fields each scaffold gets in the Prompts tab
const _PROMPTS_TAB_FEATURES = {
  linear:           { compact: true,  interrupt: false },
  linear_interrupt: { compact: true,  interrupt: true  },
  rlm:              { compact: false, interrupt: false },
  three_system:     { compact: false, interrupt: true  },
  two_system:       { compact: false, interrupt: true  },
};

function renderPromptsTab() {
  const container = document.getElementById('promptsTabBody');
  if (!container) return;
  const schemaId = localStorage.getItem('arc_scaffolding_type') || 'linear';
  const features = _PROMPTS_TAB_FEATURES[schemaId] || { compact: false, interrupt: false };
  const promptSections = _getPromptSections(schemaId);
  let html = '';
  for (const { section, name, label } of promptSections) {
    const key = `${section}.${name}`;
    html += `<div class="mem-section"><label>${label}</label>`;
    html += `<textarea data-prompt-key="${key}" rows="6" placeholder="${key}..."`;
    html += ` onblur="_savePromptField(this)"></textarea></div>`;
  }
  // Runtime fields (read-only, auto-generated) — only shown for relevant scaffolds
  if (features.compact) {
    html += '<div class="mem-section"><label>Compact Summary <span style="font-size:10px;color:var(--text-dim);text-transform:none;">(auto-generated)</span></label>';
    html += '<textarea id="memoryCompactSummary" rows="3" readonly placeholder="No compact summary yet." style="opacity:0.8;"></textarea></div>';
  }
  if (features.interrupt) {
    html += '<div class="mem-section"><label>Interrupt Result <span style="font-size:10px;color:var(--text-dim);text-transform:none;">(auto-generated)</span></label>';
    html += '<textarea id="memoryInterruptResult" rows="2" readonly placeholder="—" style="opacity:0.8;"></textarea></div>';
  }
  html += '<div style="font-size:9px;color:var(--dim);margin-top:4px;font-style:italic;">Edits to prompt templates auto-save to your browser on blur.</div>';
  container.innerHTML = html;
  _populatePromptFields();
  // Restore runtime fields
  const compactEl = document.getElementById('memoryCompactSummary');
  if (compactEl && _cachedCompactSummary) compactEl.value = _cachedCompactSummary;
}

// ═══════════════════════════════════════════════════════════════════════════
// BROWSE SESSIONS VIEW
// ═══════════════════════════════════════════════════════════════════════════

let _browseActive = false;
let _menuActive = false;
let _currentView = 'human';  // tracks which top-level view is active (default: human)
let _browseGlobalCache = null;  // cache server sessions
let _browseGameFilter = null;   // currently selected game filter (game_id prefix)

// Hash-to-view mapping
const _VIEW_HASHES = { agent: 'play', human: 'human', sessions: 'browse', leaderboards: 'leaderboard', contributors: 'contributors', feedback: 'feedback' };
const _VIEW_TO_HASH = { play: 'agent', human: 'human', browse: 'sessions', leaderboard: 'leaderboards', contributors: 'contributors', feedback: 'feedback' };

function showAppView(view, skipHash) {
  // Update URL hash (unless called from hashchange handler)
  if (!skipHash) {
    const hash = _VIEW_TO_HASH[view] || 'human';
    if (location.hash !== '#' + hash) history.replaceState(null, '', '#' + hash);
  }

  _currentView = view;
  document.querySelectorAll('.top-nav .nav-link').forEach(l => l.classList.remove('active'));
  const links = document.querySelectorAll('.top-nav .nav-link');
  const browseView = document.getElementById('browseView');
  const sessionHost = document.getElementById('sessionViewHost');
  const tabBar = document.getElementById('sessionTabBar');
  const emptyApp = document.getElementById('emptyAppState');
  const menuView = document.getElementById('menuView');
  const humanView = document.getElementById('humanView');
  const leaderboardView = document.getElementById('leaderboardView');
  const contributorsView = document.getElementById('contributorsView');
  const feedbackView = document.getElementById('feedbackView');

  const sidebar = document.getElementById('gameSidebar');
  const outerLayout = document.getElementById('outerLayout');

  // Auto-pause human session when navigating away
  if (view !== 'human' && typeof _humanRecording !== 'undefined' && _humanRecording && !_humanPaused) {
    humanTogglePause();
  }

  // Hide everything first
  outerLayout.style.display = 'none';
  browseView.style.display = 'none';
  if (humanView) humanView.style.display = 'none';
  if (leaderboardView) leaderboardView.style.display = 'none';
  if (contributorsView) contributorsView.style.display = 'none';
  if (feedbackView) feedbackView.style.display = 'none';
  tabBar.style.display = 'none';
  emptyApp.style.display = 'none';
  menuView.classList.remove('visible');

  // Highlight nav link by href (no brittle index assumptions)
  const _navHighlight = hash => document.querySelector(`.top-nav a[href="#${hash}"]`)?.classList.add('active');
  if (view === 'browse') {
    _navHighlight('sessions');
    _browseActive = true;
    _menuActive = false;
    browseView.style.display = 'flex';
    loadBrowseView();
  } else if (view === 'human') {
    _navHighlight('human');
    _browseActive = false;
    _menuActive = false;
    if (humanView) {
      humanView.style.display = 'flex';
      if (typeof initHumanView === 'function') initHumanView();
    }
  } else if (view === 'leaderboard') {
    _navHighlight('leaderboards');
    _browseActive = false;
    _menuActive = false;
    if (leaderboardView) {
      leaderboardView.style.display = 'flex';
      if (typeof initLeaderboard === 'function') initLeaderboard();
    }
  } else if (view === 'contributors') {
    _navHighlight('contributors');
    _browseActive = false;
    _menuActive = false;
    if (contributorsView) {
      contributorsView.style.display = 'flex';
      if (typeof loadContributors === 'function') loadContributors();
    }
  } else if (view === 'feedback') {
    _navHighlight('feedback');
    _browseActive = false;
    _menuActive = false;
    if (feedbackView) {
      feedbackView.style.display = 'flex';
      if (typeof loadFeedback === 'function') loadFeedback();
    }
  } else {
    // Default: agent / play
    _navHighlight('agent');
    _browseActive = false;
    outerLayout.style.display = '';
    tabBar.style.display = 'flex';
    if (_menuActive) {
      menuView.classList.add('visible');
      sessionHost.style.display = 'none';
      sidebar.style.display = 'none';
    } else {
      menuView.classList.remove('visible');
      sidebar.style.display = '';
      updateEmptyAppState();
      if (sessions.size > 0) sessionHost.style.display = '';
      // Lazy-resume: if active session hasn't been loaded from server yet, resume now
      if (activeSessionId && !activeSessionId.startsWith('pending_')) {
        const _s = sessions.get(activeSessionId);
        if (_s && !_s.currentGrid) resumeSession(activeSessionId);
      }
    }
  }
}

// Route from URL hash on page load and back/forward navigation
function _routeFromHash() {
  const hash = location.hash.replace('#', '');
  const view = _VIEW_HASHES[hash];
  if (view) showAppView(view, true);
}
window.addEventListener('hashchange', _routeFromHash);

// ── Menu view ─────────────────────────────────────────────────────────────

function showMenuView() {
  _menuActive = true;
  _browseActive = false;
  // Save current session state
  if (activeSessionId && sessions.has(activeSessionId)) saveSessionToState();
  // Hide game layout, show menu (do NOT detach — just hide the host)
  const menuView = document.getElementById('menuView');
  const sessionHost = document.getElementById('sessionViewHost');
  const emptyApp = document.getElementById('emptyAppState');
  const browseView = document.getElementById('browseView');
  menuView.classList.add('visible');
  sessionHost.style.display = 'none';
  emptyApp.style.display = 'none';
  browseView.style.display = 'none';
  const sidebar = document.getElementById('gameSidebar');
  if (sidebar) sidebar.style.display = 'none';
  // Highlight Play nav link
  document.querySelectorAll('.top-nav .nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.top-nav .nav-link')[0]?.classList.add('active');
  renderMenuSessions();
  renderSessionTabs();
}

function renderMenuSessions() {
  const container = document.getElementById('menuSessionList');
  if (!container) return;
  const saved = getLocalSessions();
  if (!saved.length) {
    container.innerHTML = '<div class="menu-empty">No saved sessions yet. Start a new session to play!</div>';
    return;
  }
  container.innerHTML = '';
  for (const s of saved) {
    const row = document.createElement('div');
    row.className = 'menu-session-row';
    const gameName = s.game_id || s.id?.slice(0, 8) || '?';
    const steps = s.steps || 0;
    const result = s.result || 'NOT_FINISHED';
    const badgeClass = 'ms-badge-' + result.replace(/\s/g, '_');
    const date = s.created_at ? new Date(s.created_at * 1000).toLocaleDateString() : '';
    const liveTag = s.live_mode ? ' <span class="live-tag" style="font-size:9px;padding:1px 4px;">LIVE</span>' : '';
    row.innerHTML = `
      <span class="ms-game">${gameName}${liveTag}</span>
      <span class="ms-steps">${steps} steps</span>
      <span class="ms-badge ${badgeClass}">${result.replace(/_/g, ' ')}</span>
      <span class="ms-date">${date}</span>
      <button class="ms-resume" onclick="event.stopPropagation(); menuResume('${s.id}');">Resume</button>`;
    container.appendChild(row);
  }
}

function menuResume(sid) {
  _menuActive = false;
  document.getElementById('menuView').classList.remove('visible');
  showAppView('play');
  browseResume(sid);
}

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
