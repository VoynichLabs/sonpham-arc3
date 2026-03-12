// Author: Mark Barney + Cascade (Claude Opus 4.6 thinking)
// Date: 2026-03-12
// PURPOSE: Observatory scrubber slider and historical grid display.
//   Allows users to navigate through historical grid states via a scrubber slider,
//   display paused/historical mode status, and switch between live and historical
//   grid viewing. Updates grid info, banner, and log row selection.
// Depends on: obs-page.js (allEvents, state), obs-swimlane.js (renderTimeline)

// Build an index of event indices that have grids
function _getGridEventIndices() {
  const indices = [];
  for (let i = 0; i < allEvents.length; i++) {
    if (allEvents[i] && allEvents[i].grid && allEvents[i].grid.length > 0) {
      indices.push(i);
    }
  }
  return indices;
}

function obsScrubUpdate() {
  const gridIndices = _getGridEventIndices();
  const total = gridIndices.length;
  const slider = document.getElementById('obsScrubSlider');
  if (!slider) return;
  slider.max = Math.max(0, total - 1);
  if (!frozenGrid) {
    // Live mode — snap to end
    slider.value = Math.max(0, total - 1);
    document.getElementById('obsScrubLabel').textContent = `Step ${total} / ${total}`;
    const dot = document.getElementById('obsScrubDot');
    dot.className = 'obs-scrubber-dot is-live';
    dot.innerHTML = '&#9679; LIVE';
    document.getElementById('obsScrubBanner').style.display = 'none';
  } else {
    // Historical — find current position in gridIndices
    const pos = gridIndices.indexOf(selectedEventIdx);
    const displayPos = pos >= 0 ? pos + 1 : '?';
    document.getElementById('obsScrubLabel').textContent = `Step ${displayPos} / ${total}`;
  }
}

function obsScrubShow(sliderVal) {
  const gridIndices = _getGridEventIndices();
  const idx = parseInt(sliderVal);
  if (idx < 0 || idx >= gridIndices.length) return;
  const evIdx = gridIndices[idx];
  const ev = allEvents[evIdx];
  if (!ev || !ev.grid) return;

  // Set frozen/historical state
  selectedEventIdx = evIdx;
  frozenGrid = ev.grid;
  currentGrid = ev.grid;
  renderGameGrid(ev.grid);

  // Update grid info
  const infoEl = document.getElementById('gridInfo');
  const step = ev.step ?? '?';
  const agent = ev.agent || ev.agent_type || '';
  const label = humanAction(ev.action) || ev.event || '';
  infoEl.textContent = `Step ${step} | ${label}${agent ? ' (' + agent + ')' : ''}`;

  // Update mode label
  document.getElementById('gridModeLabel').classList.add('active');

  // Highlight matching log row
  const tbody = document.getElementById('logBody');
  tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
  const matchRow = tbody.querySelector(`tr[data-ev-idx="${evIdx}"]`);
  if (matchRow) matchRow.classList.add('selected');

  // Update scrubber UI
  const dot = document.getElementById('obsScrubDot');
  dot.className = 'obs-scrubber-dot is-historical';
  dot.innerHTML = '&#9679; PAUSED';
  document.getElementById('obsScrubLabel').textContent = `Step ${idx + 1} / ${gridIndices.length}`;
  const banner = document.getElementById('obsScrubBanner');
  banner.style.display = 'flex';
  document.getElementById('obsScrubBannerText').textContent = `Viewing step ${step}`;
}

function obsScrubReturnToLive() {
  selectedEventIdx = -1;
  frozenGrid = null;
  document.getElementById('gridModeLabel').classList.remove('active');
  // Deselect log rows
  document.getElementById('logBody').querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
  // Restore live grid
  if (currentGrid) renderGameGrid(currentGrid);
  // Update scrubber
  obsScrubUpdate();
}

// Bind slider events
function attachScrubberSliderHandler() {
  const slider = document.getElementById('obsScrubSlider');
  if (!slider) return;
  slider.oninput = function() {
    const gridIndices = _getGridEventIndices();
    const idx = parseInt(this.value);
    if (idx >= gridIndices.length - 1 && !frozenGrid) {
      obsScrubReturnToLive();
    } else {
      obsScrubShow(idx);
    }
  };
}
