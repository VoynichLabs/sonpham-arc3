# Code Arena — AutoResearch for Code Optimization

**Date**: 2026-03-18
**Author**: Claude Opus 4.6
**Status**: DRAFT — awaiting approval

## Goal

Add a new **Code** page (`/code`) to the AutoResearch framework where LLM agents evolve code solutions to optimization challenges. Agents compete head-to-head on benchmarks — same inputs, faster correct solution wins — using the same ELO tournament system as the Games arena.

## Scope

### In Scope
- New page at `/code` (separate from `/arena`)
- 4 challenge categories at launch:
  1. **Sorting** — evolve sort functions, benchmark across input distributions
  2. **TSP** — evolve tour-finding heuristics on fixed city sets
  3. **Cache** — evolve eviction policies, benchmark on access traces
  4. **Assembly** — write WebAssembly Text Format (WAT) to solve problems, measure native execution time
- Reuse existing infrastructure: ELO system, evolution loop, LLM tool-calling, program.md versioning, leaderboard, AI Heartbeat
- All benchmarks run in-browser (Web Workers)
- Pairwise "matches": both agents run same benchmark → faster correct solution wins

### Out of Scope
- Server-side code execution (everything runs client-side)
- Model Training tab (future phase — needs GPU infrastructure)
- Design tab (future phase — needs vision model judging)
- Modifying the existing Games arena

## Architecture

### How "Matches" Work (Code vs Games)

In Games arena: two agents play a game → game engine determines winner.
In Code arena: two agents run the same benchmark → compare scores → better score wins.

```
Match(agentA, agentB, challenge, testSuite):
  scoreA = runBenchmark(agentA.code, testSuite)  // { correct: bool, timeMs: number }
  scoreB = runBenchmark(agentB.code, testSuite)  // { correct: bool, timeMs: number }

  if (!scoreA.correct && !scoreB.correct) → draw
  if (!scoreA.correct) → B wins
  if (!scoreB.correct) → A wins
  if (scoreA.timeMs < scoreB.timeMs) → A wins  // faster wins
  if (scoreB.timeMs < scoreA.timeMs) → B wins
  else → draw
```

Each benchmark runs multiple test cases. Total time = sum of all test case times. Correctness = all test cases must pass.

### Challenge Definitions

#### 1. Sorting (`sort`)

**Agent interface:**
```javascript
function sort(arr) {
  // arr: number[] (integers)
  // return: sorted number[] (ascending)
}
```

**Benchmark suite** (6 test cases, run 3 times each, take median):
| Test Case | Size | Distribution |
|-----------|------|-------------|
| Random | 10,000 | uniform random integers 0-999999 |
| Nearly Sorted | 10,000 | sorted then 1% swaps |
| Reversed | 10,000 | descending order |
| Many Duplicates | 10,000 | only 10 distinct values |
| Small | 100 | random |
| Large | 100,000 | random |

**Correctness**: output must be a sorted permutation of input.

**Seed data**: All test arrays are pre-generated with a fixed seed (deterministic). Stored as constants in the challenge definition.

#### 2. TSP (`tsp`)

**Agent interface:**
```javascript
function findTour(cities) {
  // cities: {x: number, y: number}[] — array of city coordinates
  // return: number[] — permutation of indices [0, 1, ..., n-1] representing tour order
}
```

**Benchmark suite** (4 fixed city sets):
| Test Case | Cities | Layout |
|-----------|--------|--------|
| Cluster | 50 | 5 clusters of 10 cities |
| Grid | 64 | 8x8 regular grid |
| Random | 100 | uniform random in 1000x1000 |
| Large | 200 | uniform random in 1000x1000 |

**Scoring**: `score = totalTourLength` (lower is better). No time component — pure quality. Both agents solve same cities → shorter tour wins.

**Correctness**: must visit every city exactly once (valid permutation).

#### 3. Cache Eviction (`cache`)

**Agent interface:**
```javascript
function createCache(capacity) {
  return {
    get(key) { /* return value or undefined */ },
    put(key, value) { /* store key-value, evict if over capacity */ }
  };
}
```

**Benchmark suite** (3 access traces, each 50,000 operations):
| Test Case | Pattern | Cache Size |
|-----------|---------|-----------|
| Zipf | Zipfian distribution (80/20 rule) | 100 |
| Scan | Sequential scan with periodic repeats | 200 |
| Working Set | Hot set (90%) + cold set (10%), set shifts every 5000 ops | 150 |

**Scoring**: `score = hitRate` (higher is better). Both agents replay same trace → higher hit rate wins.

**Correctness**: `get()` must return correct values for keys that were `put()` and not evicted.

#### 4. Assembly / WebAssembly (`wasm`)

**Agent interface:**
```wat
(module
  ;; Agent writes WAT (WebAssembly Text Format)
  ;; Module must export the required function

  ;; Example: fibonacci
  (func $fib (export "solve") (param $n i32) (result i32)
    ;; implementation here
  )
)
```

**Problems** (each is a separate sub-challenge, like snake variants):
| Problem | Export Signature | Description |
|---------|-----------------|-------------|
| `wasm_fib` | `(param i32) (result i32)` | Compute fibonacci(n) for n=0..40 |
| `wasm_sum` | `(param i32 i32) (result i32)` | Sum array of N integers (pointer + length) |
| `wasm_sort` | `(param i32 i32)` | Sort array of N integers in-place (pointer + length) |
| `wasm_prime` | `(param i32) (result i32)` | Count primes up to N |

**How WAT runs in browser:**
```javascript
const wasmModule = new WebAssembly.Module(wabt.parseWat('agent.wat', watCode).toBinary().buffer);
const instance = new WebAssembly.Instance(wasmModule, imports);
const result = instance.exports.solve(input);
```

Uses `wabt.js` (WebAssembly Binary Toolkit) to compile WAT → WASM in-browser. This is a well-maintained library (~300KB).

**Scoring**: Execution time (ms) across all test inputs. Lower wins.
**Correctness**: Output must match expected values for all test inputs.

### Reused Components (from Games Arena)

| Component | Reuse Strategy |
|-----------|---------------|
| `db_arena.py` | Same tables — challenges are just `game_id` values (e.g., `code_sort`, `code_tsp`) |
| `arena_research_service.py` | Extend `ARENA_GAME_IDS` with code challenge IDs, or create parallel `CODE_CHALLENGE_IDS` |
| ELO system | Identical — K=32/64, Glicko-2 approximation |
| Program.md | One per challenge, same versioning system |
| Leaderboard | Same table, same queries |
| AI Heartbeat | Same comment system, filtered by challenge_id |
| Evolution loop | Same LLM tool-calling loop, just different agent interface + validation |
| Agent validation | Different per challenge (syntax check, correctness test, timeout) |

### New Components

| Component | Description |
|-----------|-------------|
| `templates/code.html` | New page template (mirrors arena.html structure) |
| `static/js/code.js` | Challenge engines, benchmark runners, result visualization |
| `static/js/code-autoresearch.js` | Evolution loop adapted for code challenges |
| `server/arena_seeds/code_*.md` | Seed program.md files per challenge |
| Challenge definitions | Benchmark suites, correctness checkers, test data (constants in JS) |

### File Layout

```
templates/code.html              — Page template
static/js/code.js                — Challenge engines + benchmark runner
static/js/code-autoresearch.js   — Evolution + tournament for code challenges
server/arena_seeds/
  code_sort_program.md           — Sorting challenge program.md
  code_tsp_program.md            — TSP challenge program.md
  code_cache_program.md          — Cache challenge program.md
  code_wasm_fib_program.md       — WASM fibonacci program.md
  code_wasm_sort_program.md      — WASM sort program.md
  ...
```

### URL Routing

```
/code                    → code.html (main page)
/api/arena/research/<id> → same endpoints, challenge_id = "code_sort", "code_tsp", etc.
/api/arena/agents/<id>   → same endpoints
```

The existing arena API endpoints already work with arbitrary `game_id` strings. We just add new IDs prefixed with `code_`.

### UI Layout (Code Page)

Same 4-column layout as arena Auto Research view:

```
┌──────────────┬──────────────────────┬───────────────────┐
│ CHALLENGES   │  CENTER              │   LIVE BENCHMARKS │
│ (Left)       │  Program.md (top)    │   (Right 30%)     │
│              │  AI Heartbeat (bot)  │                   │
│ • Sorting    ├──────────────────────┤ • Benchmark viz   │
│ • TSP        │  LEADERBOARD         │ • Performance     │
│ • Cache      │  Rank|Agent|ELO|     │   chart (ms)      │
│ • WASM:Fib   │  Avg(ms)|Correct%   │ • ELO chart       │
│ • WASM:Sort  │                      │                   │
│ • WASM:Sum   │                      │                   │
│ • WASM:Prime │                      │                   │
└──────────────┴──────────────────────┴───────────────────┘
```

**Key differences from Games arena:**
- Leaderboard shows `Avg Time (ms)` instead of `W/L/D` (W/L/D still tracked for ELO, but avg benchmark time is the highlight metric)
- Live Benchmarks panel shows performance comparison visualization instead of game canvases
- Challenge sidebar uses simple list instead of game preview thumbnails

### Benchmark Runner Architecture

```javascript
// Run in Web Worker for isolation + timing
class BenchmarkRunner {
  constructor(challengeId) {
    this.challenge = CODE_CHALLENGES[challengeId];
    this.testSuite = this.challenge.generateTests(); // deterministic, seeded
  }

  runAgent(agentCode) {
    // Returns { correct: bool, totalMs: number, perTest: [{name, ms, correct}] }
    const fn = new Function('return ' + agentCode)();
    let totalMs = 0;
    const results = [];

    for (const test of this.testSuite) {
      const input = structuredClone(test.input); // fresh copy each run
      const start = performance.now();
      const output = fn(input);
      const elapsed = performance.now() - start;
      const correct = this.challenge.verify(test, output);
      totalMs += elapsed;
      results.push({ name: test.name, ms: elapsed, correct });
    }

    return { correct: results.every(r => r.correct), totalMs, perTest: results };
  }

  runMatch(codeA, codeB) {
    const a = this.runAgent(codeA);
    const b = this.runAgent(codeB);
    // Winner logic: correct > incorrect, then faster wins
    if (!a.correct && !b.correct) return { winner: 'draw' };
    if (!a.correct) return { winner: 'B', scoreA: a, scoreB: b };
    if (!b.correct) return { winner: 'A', scoreA: a, scoreB: b };
    if (Math.abs(a.totalMs - b.totalMs) < 0.5) return { winner: 'draw', scoreA: a, scoreB: b };
    return a.totalMs < b.totalMs
      ? { winner: 'A', scoreA: a, scoreB: b }
      : { winner: 'B', scoreA: a, scoreB: b };
  }
}
```

### WASM Compilation Pipeline

```javascript
// Load wabt.js (one-time, ~300KB)
const wabt = await WabtModule();

function compileWAT(watCode) {
  const module = wabt.parseWat('agent.wat', watCode);
  module.validate();
  const { buffer } = module.toBinary({ write_debug_names: false });
  const wasmModule = new WebAssembly.Module(buffer);
  // For memory-based problems (sort, sum), provide shared memory
  const memory = new WebAssembly.Memory({ initial: 10 }); // 640KB
  const instance = new WebAssembly.Instance(wasmModule, { env: { memory } });
  return instance;
}

function benchmarkWASM(instance, testCases) {
  let totalMs = 0;
  for (const test of testCases) {
    // Write input to WASM memory if needed
    if (test.inputArray) writeToMemory(instance, test.inputArray);
    const start = performance.now();
    const result = instance.exports.solve(...test.args);
    totalMs += performance.now() - start;
    // Verify correctness
  }
  return { totalMs, correct: allPassed };
}
```

### Evolution Prompt Adaptations

The LLM evolution cycle stays the same structure (read leaderboard → study top agents → create new agent) but the system prompt changes per challenge type:

**For JS challenges (sort/tsp/cache):**
- Agent interface is a JS function
- Tools: same (query_leaderboard, read_agent, create_agent, test_match)
- `test_match` runs benchmark comparison instead of game

**For WASM challenges:**
- Agent interface is WAT code
- System prompt includes WAT instruction reference
- Validation compiles WAT before accepting
- Additional tool: `compile_check(wat_code)` → reports compile errors without creating agent

## TODOs

### Phase 1: Infrastructure (reuse + extend)
- [ ] Add `code_*` challenge IDs to arena_research_service.py `ARENA_GAME_IDS` (or create parallel list)
- [ ] Create seed `program.md` files for each challenge
- [ ] Add `/code` route to `app.py` that renders `code.html`
- [ ] **Verify**: `/api/arena/research/code_sort` returns valid response

### Phase 2: Page Template
- [ ] Create `templates/code.html` — 4-column layout matching arena
- [ ] Challenge sidebar (left) with challenge list
- [ ] Program.md viewer + AI Heartbeat (center)
- [ ] Leaderboard with `Avg Time (ms)` column (center-right)
- [ ] Performance visualization panel (right)
- [ ] **Verify**: Page loads at `/code`, challenge tabs switch

### Phase 3: Challenge Engines
- [ ] Define `CODE_CHALLENGES` constant with all challenges + test suites
- [ ] Implement sorting benchmark (6 test cases, deterministic seed)
- [ ] Implement TSP benchmark (4 city sets, tour length scoring)
- [ ] Implement cache benchmark (3 access traces, hit rate scoring)
- [ ] Implement WASM benchmark pipeline (wabt.js compilation, memory management)
- [ ] Implement WASM fibonacci, sum, sort, prime-count sub-challenges
- [ ] **Verify**: Each challenge can run a simple baseline agent and produce correct scores

### Phase 4: Tournament + Evolution
- [ ] Create `static/js/code-autoresearch.js` — adapted evolution loop
- [ ] Benchmark-based match runner (replaces headless game runner)
- [ ] Agent validation per challenge type (JS syntax, WASM compilation, correctness, timeout)
- [ ] Swiss matchmaking (reuse from arena-autoresearch.js)
- [ ] ELO updates on match results
- [ ] **Verify**: Local auto-research runs, creates agents, updates ELO

### Phase 5: Visualization
- [ ] Performance comparison chart (bar chart: agent A vs B times per test case)
- [ ] Live benchmark panel (right column) — shows ongoing match results
- [ ] ELO chart (reuse from arena)
- [ ] **Verify**: Charts render correctly during tournament

### Phase 6: Polish
- [ ] Navigation between `/arena` and `/code` (top nav link)
- [ ] Theme support (dark/light, reuse from arena)
- [ ] Human play mode for code challenges (manual code submission + benchmark)
- [ ] **Verify**: Full flow works — select challenge → start research → agents evolve → leaderboard updates

## Docs / Changelog Touchpoints

- `CHANGELOG.md` — new entry for Code Arena page
- `CLAUDE.md` — add Code Arena section with challenge definitions + architecture notes
- This plan doc

## Open Questions

1. **wabt.js bundle size**: ~300KB gzipped. Acceptable? Or lazy-load only for WASM challenges?
2. **Benchmark determinism**: `performance.now()` varies by machine. Should we normalize times (relative ranking only, not absolute ms)?
3. **WASM memory safety**: Agents could write to arbitrary memory. Should we sandbox further or is the Web Worker + fixed memory sufficient?
4. **Challenge IDs**: Prefix with `code_` (e.g., `code_sort`) or use a separate namespace? Using `code_` prefix in the existing `arena_*` tables is simpler.
