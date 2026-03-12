// Author: Mark Barney + Cascade (Claude Opus 4.6 thinking)
// Date: 2026-03-12 17:38
// PURPOSE: Token budget and context limit UI for ARC-AGI-3. Provides getCompactSettings(),
// onContextLimitUnitChange(), spinContextLimit(), getContextTokenLimit(),
// getSelectedModelContextWindow(). Extracted from ui.js in Phase 24 modularization.
// Load order: after ui-models.js; before ui.js.
// ═══════════════════════════════════════════════════════════════════════════

function getCompactSettings() {
  const enabledEl = document.getElementById('compactContext');
  if (!enabledEl) return { enabled: false, after: null, contextLimitUnit: 'tokens', contextLimitVal: 64000, compactOnLevel: false };
  const enabled = enabledEl.checked;
  const afterVal = document.getElementById('compactAfter')?.value;
  const after = afterVal ? parseInt(afterVal) : null;  // null = disabled
  const unit = document.getElementById('contextLimitUnit')?.value || 'tokens';
  const rawVal = parseInt(document.getElementById('compactContextPct')?.value) || 64000;
  const compactOnLevel = document.getElementById('compactOnLevel')?.checked ?? true;
  return { enabled, after, contextLimitUnit: unit, contextLimitVal: rawVal, compactOnLevel };
}

function onContextLimitUnitChange() {
  const unit = document.getElementById('contextLimitUnit').value;
  const input = document.getElementById('compactContextPct');
  if (unit === 'pct') {
    input.value = 60;
  } else {
    input.value = 32000;
  }
}

// Spin context limit: dir=1 up, dir=-1 down
function spinContextLimit(dir) {
  const unit = document.getElementById('contextLimitUnit').value;
  const input = document.getElementById('compactContextPct');
  const val = parseInt(input.value) || 0;
  if (unit === 'tokens') {
    input.value = dir > 0 ? Math.min(val * 2, 2000000) : Math.max(Math.floor(val / 2), 1000);
  } else {
    input.value = dir > 0 ? Math.min(val + 5, 99) : Math.max(val - 5, 1);
  }
}

function getContextTokenLimit(compact, contextWindow) {
  if (compact.contextLimitUnit === 'tokens') return compact.contextLimitVal;
  return Math.floor(contextWindow * compact.contextLimitVal / 100);
}

function getSelectedModelContextWindow() {
  const model = getSelectedModel();
  const info = modelsData.find(m => m.name === model);
  return (info && info.context_window) || 128000;
}

function trimHistoryForTokens(history, maxTokens) {
  // If history fits within budget, return as-is.
  // Otherwise drop grid snapshots from older steps, keeping last 5 with grids.
  const KEEP_GRIDS = 5;
  if (!history || history.length <= KEEP_GRIDS) return history;

  // Estimate token cost of full history with grids
  let totalChars = 0;
  for (const h of history) {
    totalChars += 60; // step line overhead
    if (h.grid) totalChars += h.grid.length * 30; // rough RLE per row
  }
  const est = Math.ceil(totalChars / 4);
  if (est <= maxTokens) return history; // fits, keep all

  // Strip grids from older entries, keep last KEEP_GRIDS with grids
  return history.map((h, i) => {
    if (i >= history.length - KEEP_GRIDS) return h;
    const { grid, ...rest } = h;
    return rest;
  });
}
