# RGB Harness — Plan Doc

**Date**: 2026-03-15
**Author**: Claude Opus 4.6
**Status**: Approved

## Background

The [RGB Agent](https://github.com/alexisfox7/RGB-Agent) by alexisfox7 achieves the lowest publicly reported action count (1,069) on all three ARC-AGI-3 preview games. Its key insight: give the LLM **Read**, **Grep**, and **Bash** (Python) tools so it can read the game's source code, search for patterns, and run Python to simulate/compute moves.

Architecture:
- **Analyzer** — an LLM with R/G/B tools reads a *prompt log file* and outputs a strategic briefing + JSON action plan
- **Action Queue** — drains actions one per step with zero LLM calls; flushes on score change
- **Files** — a running text file of all observations, actions, board states, and analyzer notes (shown in Observatory "Files" panel)

## Scope

### In
- New `rgb` scaffolding type in the harness dropdown
- Analyzer model select + settings (plan size, thinking level, max tokens)
- Client-side Read/Grep/Bash tool implementations (Pyodide-based)
- Files panel in Observatory (vertical split of the memory panel area)
- Action queue logic (batch action plans, score-change flush)
- Game log file construction (prompt log the analyzer reads)
- Save/resume support (game log + queue state in session)

### Out
- Docker sandbox (the original RGB uses Docker; we use Pyodide)
- OpenCode integration (we call the LLM directly)
- Server-side changes (all client-side)
- Batch runner integration (web UI only for now)

## Architecture

### How It Works (Client-Side Adaptation)

```
┌─────────────────────────────────────────────────────┐
│  RGB Harness (scaffolding-rgb.js)                   │
│                                                      │
│  1. Build game log (text file in memory)             │
│  2. Call Analyzer LLM with Read/Grep/Bash tools      │
│     - Read: reads the game log text                  │
│     - Grep: searches the game log for patterns       │
│     - Bash: runs Python via Pyodide                  │
│  3. Parse [PLAN] + [ACTIONS] from response           │
│  4. Load actions into ActionQueue                    │
│  5. Drain queue one action per step (no LLM calls)   │
│  6. On queue empty or score change → re-fire analyzer│
│                                                      │
│  Files panel rendered live in Observatory              │
└─────────────────────────────────────────────────────┘
```

### Key Difference from Original

The original RGB Agent runs OpenCode in a Docker container with real filesystem access. Our adaptation:
- **Game log** is an in-memory string (not a real file), but presented to the LLM as if it were a file path
- **Read tool** returns the game log contents (or a slice of it)
- **Grep tool** searches the game log with regex
- **Bash tool** executes Python via Pyodide (same infrastructure as existing REPL)
- Tool use is **text-based** (works with ALL providers — Gemini, Groq, Mistral, LM Studio, etc.) — no native tool_use dependency

### Modules Touched

| File | Change |
|------|--------|
| `static/js/config/scaffolding-schemas.js` | Add `rgb` schema entry |
| `static/js/scaffolding-rgb.js` | **NEW** — RGB harness runner |
| `static/js/scaffolding.js` | Add RGB model select population + restore |
| `static/js/llm.js` | Add `rgb` branch in `askLLM()` |
| `static/js/observatory/obs-memory.js` | Add RGB files extraction |
| `templates/index.html` | Add `<script>` for scaffolding-rgb.js; add Files panel HTML |
| `static/css/main.css` | Files panel styles |
| `CHANGELOG.md` | Entry for RGB harness |

### Files Panel (Observatory)

Current layout of `obs-reasoning-wrap`:
```
┌─────────────────────┬──────────────────┐
│  Reasoning Log      │  Agent Memory    │
│  (55%)              │  (45%)           │
└─────────────────────┴──────────────────┘
```

New layout — split the Memory panel vertically:
```
┌─────────────────────┬──────────────────┐
│                     │  Agent Memory    │
│  Reasoning Log      │  (top half)      │
│  (55%)              ├──────────────────┤
│                     │  Files           │
│                     │  (bottom half)   │
└─────────────────────┴──────────────────┘
```

The Files panel shows the running prompt log (the "file" the analyzer reads) — board states, actions, scores, analyzer notes. Scrolls to bottom on each update. Visible for all scaffoldings (for non-RGB, stays empty/hidden).

### Tool Implementation (Text-Based — Universal Provider Support)

Tools are implemented as **text-based tool calling** in the prompt, so they work with every model provider (Gemini, Groq, Mistral, LM Studio, Anthropic, OpenAI, etc.). No native `tool_use` API dependency.

The LLM is instructed to call tools using XML-style tags in its response:

```
<tool_call>
<name>read</name>
<input>{"file_path": "/workspace/game_log.txt"}</input>
</tool_call>
```

We parse these from the response text, execute them, and append results:

```
<tool_result>
<name>read</name>
<output>... file contents ...</output>
</tool_result>
```

**Available tools:**
- `read` — return `gameLog` string (or slice by offset/limit)
- `grep` — apply regex to `gameLog`, return matching lines with line numbers
- `bash` — run Python via `runPyodide()`, return output

### LLM Call Format

Multi-turn conversation within a single `askLLM` call:
1. System prompt (tool definitions + instructions) + user prompt (with file path reference)
2. LLM responds with `<tool_call>` blocks
3. We parse and execute tools, build result text
4. Append assistant response + tool results, send follow-up
5. Repeat until LLM returns text with [ACTIONS] (max iterations capped)
6. Parse [PLAN] and [ACTIONS], load queue

### Action Queue

Client-side port of `action_queue.py`:
- `RGBActionQueue` class with `load()`, `pop()`, `checkScore()`, `clear()`
- Parses `[ACTIONS]` JSON: `{"plan": [{"action": "ACTION1"}, ...], "reasoning": "..."}`
- Flushes on score change (level solved)
- When empty, triggers re-analysis

## TODOs

### Phase 1: Schema + Scaffolding Shell
1. Add `rgb` entry to `SCAFFOLDING_SCHEMAS` in `scaffolding-schemas.js`
2. Create `scaffolding-rgb.js` with `askLLMRgb()` shell function
3. Wire into `askLLM()` in `llm.js`
4. Wire model selects in `scaffolding.js` (`_populateAllModelSelects` + restore)
5. Add `<script>` tag in `index.html`
6. **Verify**: scaffolding dropdown shows "RGB (Read-Grep-Bash)", model select populates

### Phase 2: Game Log + Action Queue
1. Implement `RGBGameLog` class — builds prompt log text from game state
2. Implement `RGBActionQueue` class — parse/drain/flush logic
3. Implement Read/Grep/Bash tool execution functions
4. **Verify**: game log builds correctly from manual game steps

### Phase 3: Analyzer Loop
1. Implement `askLLMRgb()` — full analyzer conversation loop with text-based tool calling
2. Text-based tool format (`<tool_call>` / `<tool_result>`) works with ALL providers
3. Parse [PLAN] and [ACTIONS] from analyzer response
4. Integration with existing `askLLM()` flow (tokens, timing, reasoning entry)
5. **Verify**: run with ls20, confirm analyzer reads log, outputs plan, queue drains

### Phase 4: Observatory Files Panel
1. Add Files panel HTML to `index.html` (split memory panel vertically)
2. Add CSS for the split layout
3. Wire `obsFilesUpdate()` — render file contents in panel
4. Wire scrubber — files panel reflects state at scrubbed position
5. Update `MemoryStateTracker` to handle RGB scaffolding type
6. **Verify**: Observatory shows files updating live during autoplay

### Phase 5: Polish + Save/Resume
1. Serialize game log + queue state into session for save/resume
2. Handle edge cases: game over auto-reset, action validation, timeout
3. Add reasoning entries for analyzer calls and queue drain steps
4. **Verify**: full run on ls20 end-to-end, save, resume, Observatory replay

## Docs / Changelog Touchpoints

- `CHANGELOG.md` — new entry for RGB harness feature
- `CLAUDE.md` — update scaffolding list if needed
- This plan doc — mark as completed
