// Author: Claude Opus 4.6
// Date: 2026-03-14 23:00
// PURPOSE: Leaderboard rendering — AI and Human best performances as tables.
//   Shows highest levels reached per game and lowest steps to reach that level.
//   Drill-down shows top 20 attempts per game with version info.
//   Depends on fetchJSON (ui.js), _esc (human-social.js).
// SRP/DRY check: Pass — single module for leaderboard rendering.

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD — AI and Human best performances (separate tables)
// ═══════════════════════════════════════════════════════════════════════════

let _lbLoaded = false;
let _lbData = [];

function initLeaderboard() {
  if (!_lbLoaded) {
    _lbLoaded = true;
    _loadLeaderboard();
  }
}

async function _loadLeaderboard() {
  const aiBody = document.getElementById('lbAiBody');
  const humanBody = document.getElementById('lbHumanBody');
  aiBody.innerHTML = '<tr><td colspan="6" class="lb-loading">Loading...</td></tr>';
  humanBody.innerHTML = '<tr><td colspan="7" class="lb-loading">Loading...</td></tr>';

  try {
    const data = await fetchJSON('/api/leaderboard');
    _lbData = data.leaderboard || [];
  } catch {
    aiBody.innerHTML = '<tr><td colspan="6" class="lb-loading">Failed to load.</td></tr>';
    humanBody.innerHTML = '<tr><td colspan="7" class="lb-loading">Failed to load.</td></tr>';
    return;
  }

  if (!_lbData.length) {
    aiBody.innerHTML = '<tr><td colspan="6" class="lb-loading">No sessions yet.</td></tr>';
    humanBody.innerHTML = '<tr><td colspan="7" class="lb-loading">No sessions yet.</td></tr>';
    return;
  }

  _renderLeaderboardTables();
}

function _renderLeaderboardTables() {
  const aiBody = document.getElementById('lbAiBody');
  const humanBody = document.getElementById('lbHumanBody');
  aiBody.innerHTML = '';
  humanBody.innerHTML = '';

  // Sort: highest levels first, then fewest steps
  const aiEntries = _lbData.filter(r => r.ai).sort((a, b) => {
    const al = a.ai.levels || 0, bl = b.ai.levels || 0;
    if (bl !== al) return bl - al;
    return (a.ai.steps || 9999) - (b.ai.steps || 9999);
  });
  const humanEntries = _lbData.filter(r => r.human).sort((a, b) => {
    const al = a.human.levels || 0, bl = b.human.levels || 0;
    if (bl !== al) return bl - al;
    return (a.human.steps || 9999) - (b.human.steps || 9999);
  });

  for (const row of aiEntries) {
    const tr = document.createElement('tr');
    tr.className = 'lb-row';
    tr.onclick = () => openLbDrilldown(row.game_id);
    const ai = row.ai;
    const gameCode = (ai.game_id || row.game_id || '').split('-')[0];
    const ver = _lbVerDisplay(ai.game_version);
    const date = _lbDateStr(ai.created_at);
    tr.innerHTML = `
      <td class="lb-game-name">${gameCode.toUpperCase()}<span class="lb-ver">${ver}</span></td>
      <td>${_resultBadge(ai.result)}</td>
      <td class="lb-td-levels">${ai.levels || 0}</td>
      <td class="lb-td-steps">${ai.steps || 0}</td>
      <td class="lb-model" title="${ai.model || ''}">${_shortModel(ai.model || '')}</td>
      <td class="lb-td-date">${date}</td>`;
    aiBody.appendChild(tr);
  }

  if (!aiEntries.length) {
    aiBody.innerHTML = '<tr><td colspan="6" class="lb-loading">No AI attempts yet.</td></tr>';
  }

  for (const row of humanEntries) {
    const tr = document.createElement('tr');
    tr.className = 'lb-row';
    tr.onclick = () => openLbDrilldown(row.game_id);
    const h = row.human;
    const gameCode = (h.game_id || row.game_id || '').split('-')[0];
    const ver = _lbVerDisplay(h.game_version);
    const dur = h.duration_seconds ? _lbFormatDuration(h.duration_seconds) : '\u2014';
    const author = h.author || '\u2014';
    const date = _lbDateStr(h.created_at);
    tr.innerHTML = `
      <td class="lb-game-name">${gameCode.toUpperCase()}<span class="lb-ver">${ver}</span></td>
      <td>${_resultBadge(h.result)}</td>
      <td class="lb-td-levels">${h.levels || 0}</td>
      <td class="lb-td-steps">${h.steps || 0}</td>
      <td class="lb-td-duration">${dur}</td>
      <td class="lb-author" title="${_esc(author)}">${_esc(author)}</td>
      <td class="lb-td-date">${date}</td>`;
    humanBody.appendChild(tr);
  }

  if (!humanEntries.length) {
    humanBody.innerHTML = '<tr><td colspan="7" class="lb-loading">No human attempts yet.</td></tr>';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function _resultBadge(result) {
  if (result === 'WIN') return '<span class="lb-badge lb-badge-win">WIN</span>';
  if (result === 'GAME_OVER') return '<span class="lb-badge lb-badge-lose">LOST</span>';
  return '<span class="lb-badge lb-badge-progress">...</span>';
}

function _shortModel(model) {
  if (!model) return '\u2014';
  const parts = model.split('/');
  const name = parts[parts.length - 1];
  return name.length > 20 ? name.slice(0, 18) + '\u2026' : name;
}

function _lbFormatDuration(secs) {
  if (!secs || secs <= 0) return '\u2014';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function _lbVerDisplay(ver) {
  if (!ver || ver === 'unknown') return '';
  return ' v' + (parseInt(ver, 10) || ver);
}

function _lbDateStr(ts) {
  if (!ts) return '\u2014';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Drill-down ──────────────────────────────────────────────────────────

async function openLbDrilldown(gameId) {
  document.querySelector('.lb-tables-wrap').style.display = 'none';
  const drill = document.getElementById('lbDrilldown');
  drill.style.display = '';
  document.getElementById('lbDrillTitle').textContent = gameId.toUpperCase() + ' \u2014 Top Attempts';

  const aiBody = document.getElementById('lbDrillAI');
  const humanBody = document.getElementById('lbDrillHuman');
  aiBody.innerHTML = '<tr><td colspan="7" class="lb-loading">Loading...</td></tr>';
  humanBody.innerHTML = '<tr><td colspan="8" class="lb-loading">Loading...</td></tr>';

  try {
    const data = await fetchJSON(`/api/leaderboard/${encodeURIComponent(gameId)}`);
    _renderDrillTable(aiBody, data.ai || [], 'ai');
    _renderDrillTable(humanBody, data.human || [], 'human');
  } catch {
    aiBody.innerHTML = '<tr><td colspan="7">Failed to load</td></tr>';
    humanBody.innerHTML = '<tr><td colspan="8">Failed to load</td></tr>';
  }
}

function _renderDrillTable(tbody, rows, type) {
  const colSpan = type === 'ai' ? 7 : 8;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="lb-loading">No ${type === 'ai' ? 'AI' : 'human'} attempts yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const result = _resultBadge(r.result);
    const date = _lbDateStr(r.created_at);
    const gameCode = (r.game_id || '').split('-')[0];
    const ver = _lbVerDisplay(r.game_version);
    if (type === 'ai') {
      const model = _shortModel(r.model || '');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${gameCode.toUpperCase()}<span class="lb-ver">${ver}</span></td>
        <td>${result}</td>
        <td class="lb-td-levels">${r.levels || 0}</td>
        <td class="lb-td-steps">${r.steps || 0}</td>
        <td class="lb-model" title="${r.model || ''}">${model}</td>
        <td class="lb-td-date">${date}</td>`;
    } else {
      const dur = r.duration_seconds ? _lbFormatDuration(r.duration_seconds) : '\u2014';
      const author = r.author || '\u2014';
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${gameCode.toUpperCase()}<span class="lb-ver">${ver}</span></td>
        <td>${result}</td>
        <td class="lb-td-levels">${r.levels || 0}</td>
        <td class="lb-td-steps">${r.steps || 0}</td>
        <td class="lb-td-duration">${dur}</td>
        <td class="lb-author" title="${_esc(author)}">${_esc(author)}</td>
        <td class="lb-td-date">${date}</td>`;
    }
    tbody.appendChild(tr);
  });
}

function closeLbDrilldown() {
  document.getElementById('lbDrilldown').style.display = 'none';
  document.querySelector('.lb-tables-wrap').style.display = '';
}

function refreshLeaderboard() {
  _lbLoaded = false;
  _loadLeaderboard();
}
