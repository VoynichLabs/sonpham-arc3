// ═══════════════════════════════════════════════════════════════════════════
// SESSION STORAGE — Pure localStorage/sessionStorage operations
// ═══════════════════════════════════════════════════════════════════════════
// 
// This module handles all localStorage-based session persistence:
// - getLocalSessions(), saveLocalSessionIndex(), saveLocalSession()
// - getLocalSessionData(), deleteLocalSession()
// - formatDuration() utility
// 
// No external dependencies. Pure utility functions for local session management.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY DATA (shared mutable state)
// ═══════════════════════════════════════════════════════════════════════════

let replayData = null; // { session, steps }

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL SESSION STORAGE (localStorage-based, per-user)
// ═══════════════════════════════════════════════════════════════════════════

const LOCAL_SESSIONS_KEY = 'arc_sessions_index';
const LOCAL_SESSION_PREFIX = 'arc_session_data:';
const MAX_LOCAL_SESSIONS = 50;

function getLocalSessions() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SESSIONS_KEY) || '[]');
  } catch { return []; }
}

function saveLocalSessionIndex(sessions) {
  // Keep only the most recent MAX_LOCAL_SESSIONS
  const trimmed = sessions.slice(0, MAX_LOCAL_SESSIONS);
  localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(trimmed));
  // Clean up data for sessions that fell off
  if (sessions.length > MAX_LOCAL_SESSIONS) {
    for (const s of sessions.slice(MAX_LOCAL_SESSIONS)) {
      localStorage.removeItem(LOCAL_SESSION_PREFIX + s.id);
    }
  }
}

function saveLocalSession(sessionMeta, steps) {
  // Update index (newest first)
  const sessions = getLocalSessions().filter(s => s.id !== sessionMeta.id);
  sessions.unshift(sessionMeta);
  saveLocalSessionIndex(sessions);
  // Save full session data (steps with grids)
  try {
    localStorage.setItem(LOCAL_SESSION_PREFIX + sessionMeta.id,
      JSON.stringify({ session: sessionMeta, steps }));
  } catch (e) {
    // localStorage full — remove oldest sessions to make space
    const idx = getLocalSessions();
    if (idx.length > 5) {
      const removed = idx.pop();
      localStorage.removeItem(LOCAL_SESSION_PREFIX + removed.id);
      saveLocalSessionIndex(idx);
      try {
        localStorage.setItem(LOCAL_SESSION_PREFIX + sessionMeta.id,
          JSON.stringify({ session: sessionMeta, steps }));
      } catch {}
    }
  }
}

function getLocalSessionData(sid) {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SESSION_PREFIX + sid));
  } catch { return null; }
}

function deleteLocalSession(sid) {
  const sessions = getLocalSessions().filter(s => s.id !== sid);
  saveLocalSessionIndex(sessions);
  localStorage.removeItem(LOCAL_SESSION_PREFIX + sid);
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m > 60) return `${Math.floor(m / 60)}h${m % 60}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
