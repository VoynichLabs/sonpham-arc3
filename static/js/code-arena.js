// Author: Claude Opus 4.6
// Date: 2026-03-18 23:00
// PURPOSE: Code Arena — AutoResearch for code optimization challenges.
//   Challenge types: Sorting, TSP, Cache Eviction, WebAssembly.
//   Agents write JavaScript (or WAT for WASM challenges) that solve optimization problems.
//   Pairwise matches: both agents run the same benchmark, faster correct solution wins.
//   Reuses arena API endpoints with code_* prefixed game IDs.
//   Evolution loop adapted from arena-autoresearch.js with benchmark-based evaluation.
// SRP/DRY check: Pass — reuses callLLM() from scaffolding.js, arena API from app.py

/* ═══════════════════════════════════════════════════════════════════════════
   Seeded RNG (Mulberry32) — deterministic benchmark data
   ═══════════════════════════════════════════════════════════════════════════ */

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Challenge Definitions
   ═══════════════════════════════════════════════════════════════════════════ */

const CODE_CHALLENGES = {};

// ── Sorting ──────────────────────────────────────────────────────────────

CODE_CHALLENGES.code_sort = {
  id: 'code_sort',
  title: 'Sorting',
  icon: '\u{1F4CA}',
  desc: 'Evolve fast sorting algorithms. Beat Array.sort().',
  metric: 'ms',
  metricLabel: 'Total ms',
  lowerIsBetter: true,
  agentFnName: 'solve',

  generateTests() {
    const rng = mulberry32(42);
    const randArr = (n) => Array.from({length: n}, () => Math.floor(rng() * 1000000));

    const random10k = randArr(10000);
    const nearlySorted10k = [...random10k].sort((a, b) => a - b);
    // Swap 1% of elements
    for (let i = 0; i < 100; i++) {
      const a = Math.floor(rng() * 10000), b = Math.floor(rng() * 10000);
      [nearlySorted10k[a], nearlySorted10k[b]] = [nearlySorted10k[b], nearlySorted10k[a]];
    }
    const reversed10k = [...random10k].sort((a, b) => b - a);
    const dupes10k = Array.from({length: 10000}, () => Math.floor(rng() * 10));
    const small100 = randArr(100);
    const large100k = randArr(100000);

    return [
      { name: 'Random 10K', input: random10k },
      { name: 'Nearly Sorted 10K', input: nearlySorted10k },
      { name: 'Reversed 10K', input: reversed10k },
      { name: 'Many Duplicates 10K', input: dupes10k },
      { name: 'Small 100', input: small100 },
      { name: 'Large 100K', input: large100k },
    ];
  },

  verify(test, output) {
    if (!Array.isArray(output)) return false;
    if (output.length !== test.input.length) return false;
    const sorted = [...test.input].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (output[i] !== sorted[i]) return false;
    }
    return true;
  },

  runAgent(code, tests) {
    try {
      const fn = new Function(code + '\nreturn solve;')();
      let totalMs = 0;
      const perTest = [];
      for (const test of tests) {
        const input = [...test.input]; // fresh copy
        const start = performance.now();
        const output = fn(input);
        const elapsed = performance.now() - start;
        const correct = this.verify(test, output);
        totalMs += elapsed;
        perTest.push({ name: test.name, ms: elapsed, correct });
      }
      return { correct: perTest.every(r => r.correct), totalMs, perTest };
    } catch (e) {
      return { correct: false, totalMs: Infinity, perTest: [], error: e.message };
    }
  },
};

// ── TSP ──────────────────────────────────────────────────────────────────

CODE_CHALLENGES.code_tsp = {
  id: 'code_tsp',
  title: 'TSP',
  icon: '\u{1F5FA}',
  desc: 'Evolve shortest-tour heuristics for Traveling Salesman.',
  metric: 'length',
  metricLabel: 'Tour Length',
  lowerIsBetter: true,
  agentFnName: 'solve',

  generateTests() {
    const rng = mulberry32(123);

    // Cluster: 5 clusters of 10 cities
    const cluster50 = [];
    for (let c = 0; c < 5; c++) {
      const cx = rng() * 800 + 100, cy = rng() * 800 + 100;
      for (let i = 0; i < 10; i++) {
        cluster50.push({ x: cx + (rng() - 0.5) * 100, y: cy + (rng() - 0.5) * 100 });
      }
    }

    // Grid: 8x8
    const grid64 = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      grid64.push({ x: c * 120 + 60, y: r * 120 + 60 });
    }

    // Random 100
    const random100 = Array.from({length: 100}, () => ({ x: rng() * 1000, y: rng() * 1000 }));

    // Large 200
    const large200 = Array.from({length: 200}, () => ({ x: rng() * 1000, y: rng() * 1000 }));

    return [
      { name: 'Cluster 50', input: cluster50 },
      { name: 'Grid 64', input: grid64 },
      { name: 'Random 100', input: random100 },
      { name: 'Large 200', input: large200 },
    ];
  },

  verify(test, output) {
    if (!Array.isArray(output)) return false;
    if (output.length !== test.input.length) return false;
    const seen = new Set(output);
    if (seen.size !== output.length) return false;
    for (const idx of output) {
      if (typeof idx !== 'number' || idx < 0 || idx >= test.input.length || !Number.isInteger(idx)) return false;
    }
    return true;
  },

  _tourLength(cities, tour) {
    let len = 0;
    for (let i = 0; i < tour.length; i++) {
      const a = cities[tour[i]], b = cities[tour[(i + 1) % tour.length]];
      len += Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }
    return len;
  },

  runAgent(code, tests) {
    try {
      const fn = new Function(code + '\nreturn solve;')();
      let totalScore = 0;
      const perTest = [];
      for (const test of tests) {
        const input = test.input.map(c => ({...c})); // fresh copy
        const start = performance.now();
        const output = fn(input);
        const elapsed = performance.now() - start;
        const correct = this.verify(test, output);
        const tourLen = correct ? this._tourLength(test.input, output) : Infinity;
        totalScore += tourLen;
        perTest.push({ name: test.name, ms: elapsed, correct, score: Math.round(tourLen) });
      }
      return { correct: perTest.every(r => r.correct), totalMs: totalScore, perTest };
    } catch (e) {
      return { correct: false, totalMs: Infinity, perTest: [], error: e.message };
    }
  },
};

// ── Cache Eviction ───────────────────────────────────────────────────────

CODE_CHALLENGES.code_cache = {
  id: 'code_cache',
  title: 'Cache',
  icon: '\u{1F4BE}',
  desc: 'Evolve cache eviction policies. Beat LRU.',
  metric: 'hit%',
  metricLabel: 'Hit Rate',
  lowerIsBetter: false,
  agentFnName: 'solve',

  generateTests() {
    const rng = mulberry32(777);
    const OPS = 50000;

    // Zipf distribution (80/20)
    function zipfTrace(n, keyRange) {
      const trace = [];
      for (let i = 0; i < n; i++) {
        // Zipf: lower keys are much more common
        const r = rng();
        const key = Math.floor(Math.pow(r, 2) * keyRange);
        trace.push({ op: rng() < 0.7 ? 'get' : 'put', key: `k${key}`, value: i });
      }
      return trace;
    }

    // Sequential scan with periodic repeats
    function scanTrace(n, keyRange) {
      const trace = [];
      let seq = 0;
      for (let i = 0; i < n; i++) {
        if (rng() < 0.15) {
          // Revisit a recent key
          const back = Math.floor(rng() * 20) + 1;
          trace.push({ op: 'get', key: `k${Math.max(0, seq - back)}`, value: i });
        } else {
          trace.push({ op: rng() < 0.4 ? 'put' : 'get', key: `k${seq % keyRange}`, value: i });
          seq++;
        }
      }
      return trace;
    }

    // Working set shift
    function workingSetTrace(n, keyRange) {
      const trace = [];
      let hotStart = 0;
      const hotSize = Math.floor(keyRange * 0.3);
      for (let i = 0; i < n; i++) {
        if (i > 0 && i % 5000 === 0) hotStart = Math.floor(rng() * (keyRange - hotSize));
        const isHot = rng() < 0.9;
        const key = isHot
          ? hotStart + Math.floor(rng() * hotSize)
          : Math.floor(rng() * keyRange);
        trace.push({ op: rng() < 0.5 ? 'put' : 'get', key: `k${key}`, value: i });
      }
      return trace;
    }

    return [
      { name: 'Zipf (cap=100)', input: { capacity: 100, trace: zipfTrace(OPS, 1000) } },
      { name: 'Scan (cap=200)', input: { capacity: 200, trace: scanTrace(OPS, 2000) } },
      { name: 'Working Set (cap=150)', input: { capacity: 150, trace: workingSetTrace(OPS, 1500) } },
    ];
  },

  verify(test, output) {
    // output is { hits, total } from the benchmark runner
    return typeof output === 'object' && typeof output.hits === 'number' && typeof output.total === 'number';
  },

  runAgent(code, tests) {
    try {
      const fn = new Function(code + '\nreturn solve;')();
      let totalHitRate = 0;
      const perTest = [];

      for (const test of tests) {
        const { capacity, trace } = test.input;
        const cache = fn(capacity);
        if (!cache || typeof cache.get !== 'function' || typeof cache.put !== 'function') {
          perTest.push({ name: test.name, ms: 0, correct: false, score: 0 });
          continue;
        }

        let hits = 0, gets = 0;
        const start = performance.now();
        for (const op of trace) {
          if (op.op === 'put') {
            cache.put(op.key, op.value);
          } else {
            const val = cache.get(op.key);
            gets++;
            if (val !== undefined) hits++;
          }
        }
        const elapsed = performance.now() - start;
        const hitRate = gets > 0 ? (hits / gets) * 100 : 0;
        totalHitRate += hitRate;
        perTest.push({ name: test.name, ms: elapsed, correct: true, score: hitRate.toFixed(1) + '%' });
      }

      // For cache, higher hit rate is better. We use totalHitRate as the score.
      // To fit the "lower is better" match comparison, we invert: score = 300 - totalHitRate
      return {
        correct: perTest.every(r => r.correct),
        totalMs: 300 - totalHitRate, // inverted so lower = better
        perTest,
        displayScore: (totalHitRate / perTest.length).toFixed(1) + '% avg hit rate',
      };
    } catch (e) {
      return { correct: false, totalMs: Infinity, perTest: [], error: e.message };
    }
  },
};

// ── WASM Challenges ──────────────────────────────────────────────────────

const WASM_CHALLENGES = {
  code_wasm_fib: {
    id: 'code_wasm_fib',
    title: 'WASM: Fibonacci',
    icon: '\u{1F9EC}',
    desc: 'Write WAT to compute fibonacci(n) blazingly fast.',
    exportName: 'solve',
    needsMemory: false,
    generateTests() {
      // fibonacci expected values
      const fib = [0, 1];
      for (let i = 2; i <= 45; i++) fib[i] = fib[i-1] + fib[i-2];
      const testInputs = [0, 1, 5, 10, 20, 30, 35, 40, 45];
      return testInputs.map(n => ({ name: `fib(${n})`, args: [n], expected: fib[n] }));
    },
  },
  code_wasm_sum: {
    id: 'code_wasm_sum',
    title: 'WASM: Array Sum',
    icon: '\u{1F4DD}',
    desc: 'Write WAT to sum an integer array from memory.',
    exportName: 'solve',
    needsMemory: true,
    generateTests() {
      const rng = mulberry32(555);
      const sizes = [100, 1000, 10000, 100000];
      return sizes.map(n => {
        const arr = Array.from({length: n}, () => Math.floor(rng() * 1000));
        const expected = arr.reduce((s, v) => s + v, 0);
        return { name: `sum(${n})`, array: arr, expected };
      });
    },
  },
  code_wasm_sort: {
    id: 'code_wasm_sort',
    title: 'WASM: Sort',
    icon: '\u{1F501}',
    desc: 'Write WAT to sort an integer array in memory.',
    exportName: 'solve',
    needsMemory: true,
    generateTests() {
      const rng = mulberry32(666);
      const sizes = [100, 1000, 5000];
      return sizes.map(n => {
        const arr = Array.from({length: n}, () => Math.floor(rng() * 100000));
        const expected = [...arr].sort((a, b) => a - b);
        return { name: `sort(${n})`, array: arr, expected };
      });
    },
  },
  code_wasm_prime: {
    id: 'code_wasm_prime',
    title: 'WASM: Primes',
    icon: '\u{1F522}',
    desc: 'Write WAT to count primes up to N.',
    exportName: 'solve',
    needsMemory: true,
    generateTests() {
      // Precomputed prime counts
      const primeCounts = { 100: 25, 1000: 168, 10000: 1229, 100000: 9592, 1000000: 78498 };
      return Object.entries(primeCounts).map(([n, count]) => ({
        name: `primes(${n})`, args: [parseInt(n)], expected: count,
      }));
    },
  },
};

// Register WASM challenges as CODE_CHALLENGES with a unified runner
for (const [id, wc] of Object.entries(WASM_CHALLENGES)) {
  CODE_CHALLENGES[id] = {
    id: wc.id,
    title: wc.title,
    icon: wc.icon,
    desc: wc.desc,
    metric: 'ms',
    metricLabel: 'Total ms',
    lowerIsBetter: true,
    agentFnName: null, // WAT, not JS
    isWasm: true,

    generateTests: wc.generateTests,

    verify(test, output) {
      if (test.expected !== undefined) return output === test.expected;
      if (test.array && Array.isArray(test.expected)) {
        if (!Array.isArray(output) || output.length !== test.expected.length) return false;
        return test.expected.every((v, i) => output[i] === v);
      }
      return false;
    },

    runAgent(watCode, tests) {
      // WASM compilation + benchmark
      try {
        if (typeof WebAssembly === 'undefined') {
          return { correct: false, totalMs: Infinity, perTest: [], error: 'WebAssembly not supported' };
        }

        // For now, WASM challenges require wabt.js for WAT→WASM compilation.
        // If wabt is not loaded, we parse a simplified binary or return an error.
        if (typeof _wabtModule === 'undefined') {
          return { correct: false, totalMs: Infinity, perTest: [],
            error: 'WAT compilation not available yet. WASM challenges coming soon.' };
        }

        const module = _wabtModule.parseWat('agent.wat', watCode);
        module.validate();
        const { buffer } = module.toBinary({ write_debug_names: false });
        const wasmModule = new WebAssembly.Module(buffer);
        const memory = wc.needsMemory ? new WebAssembly.Memory({ initial: 256 }) : undefined;
        const imports = wc.needsMemory ? { env: { memory } } : {};
        const instance = new WebAssembly.Instance(wasmModule, imports);
        const solve = instance.exports[wc.exportName];

        let totalMs = 0;
        const perTest = [];

        for (const test of tests) {
          let result;
          const start = performance.now();

          if (test.args) {
            result = solve(...test.args);
          } else if (test.array) {
            // Write array to memory
            const view = new Int32Array(memory.buffer);
            const ptr = 0; // start of memory
            test.array.forEach((v, i) => { view[i] = v; });
            solve(ptr, test.array.length);
            // Read back (for sort, result is in memory; for sum, result is return value)
            if (Array.isArray(test.expected)) {
              result = Array.from(view.slice(0, test.expected.length));
            } else {
              result = solve(ptr, test.array.length);
            }
          }

          const elapsed = performance.now() - start;
          const correct = this.verify(test, result);
          totalMs += elapsed;
          perTest.push({ name: test.name, ms: elapsed, correct });
        }

        return { correct: perTest.every(r => r.correct), totalMs, perTest };
      } catch (e) {
        return { correct: false, totalMs: Infinity, perTest: [], error: e.message };
      }
    },
  };
}

// Global: wabt module (lazy-loaded)
let _wabtModule = undefined;


/* ═══════════════════════════════════════════════════════════════════════════
   Agent Interfaces (for LLM evolution prompts)
   ═══════════════════════════════════════════════════════════════════════════ */

const CODE_AGENT_INTERFACE = {
  code_sort: `function solve(arr) {
  // arr: number[] (integers, may be large — up to 100K elements)
  // Sort ascending. You may sort in-place and return arr, or return a new array.
  // Return: sorted number[]
  arr.sort((a, b) => a - b);
  return arr;
}`,
  code_tsp: `function solve(cities) {
  // cities: {x: number, y: number}[] — array of city coordinates (50-200 cities)
  // Find the shortest tour visiting all cities exactly once.
  // Return: number[] — permutation of indices [0..n-1] representing tour order
  return cities.map((_, i) => i); // trivial: visit in order
}`,
  code_cache: `function solve(capacity) {
  // Create and return a cache with the given max capacity.
  // Return: { get(key): value|undefined, put(key, value): void }
  const map = new Map();
  return {
    get(key) { const v = map.get(key); if (v !== undefined) { map.delete(key); map.set(key, v); } return v; },
    put(key, value) { map.delete(key); map.set(key, value); if (map.size > capacity) map.delete(map.keys().next().value); }
  };
}`,
  code_wasm_fib: `(module
  (func $solve (export "solve") (param $n i32) (result i32)
    (local $a i32) (local $b i32) (local $i i32) (local $tmp i32)
    (local.set $a (i32.const 0))
    (local.set $b (i32.const 1))
    (local.set $i (i32.const 0))
    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $tmp (i32.add (local.get $a) (local.get $b)))
        (local.set $a (local.get $b))
        (local.set $b (local.get $tmp))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $a)
  )
)`,
  code_wasm_sum: `(module
  (import "env" "memory" (memory 1))
  (func $solve (export "solve") (param $ptr i32) (param $len i32) (result i32)
    (local $sum i32) (local $i i32)
    (local.set $sum (i32.const 0))
    (local.set $i (i32.const 0))
    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $sum (i32.add (local.get $sum)
          (i32.load (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 4))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $sum)
  )
)`,
  code_wasm_sort: `(module
  (import "env" "memory" (memory 1))
  (func $solve (export "solve") (param $ptr i32) (param $len i32)
    ;; Implement an in-place sort of $len i32 values starting at $ptr
    ;; Bubble sort baseline (slow but correct)
    (local $i i32) (local $j i32) (local $a i32) (local $b i32) (local $ai i32) (local $bi i32)
    ;; ... your optimized sort here
  )
)`,
  code_wasm_prime: `(module
  (import "env" "memory" (memory 16))
  (func $solve (export "solve") (param $n i32) (result i32)
    ;; Count primes up to $n using sieve of Eratosthenes
    ;; Use memory as a byte array for the sieve
    (local $count i32) (local $i i32) (local $j i32)
    ;; ... your implementation here
    (local.get $count)
  )
)`,
};


/* ═══════════════════════════════════════════════════════════════════════════
   Local Research State
   ═══════════════════════════════════════════════════════════════════════════ */

const CRLocal = {
  running: false,
  challengeId: null,
  config: null,
  agents: [],
  games: [],
  generation: 0,
  conversation: [],
  stopRequested: false,
  evoTimer: null,
  tournamentTimer: null,
  programMd: '',
  benchmarkCache: null,  // cached test suite for current challenge
};

// UI state (mirrors arena.js AR object)
const CR = {
  selectedGame: null,
  pollTimer: null,
  localRunning: false,
  lbAgents: [],
};


/* ═══════════════════════════════════════════════════════════════════════════
   Agent Validation
   ═══════════════════════════════════════════════════════════════════════════ */

function crValidateAgent(code, challengeId) {
  const errors = [];
  const challenge = CODE_CHALLENGES[challengeId];
  if (!challenge) { errors.push('Unknown challenge'); return { passed: false, errors }; }

  if (challenge.isWasm) {
    // Basic WAT validation — full validation needs wabt.js
    if (!code.includes('(module') || !code.includes('(func')) {
      errors.push('WAT must contain (module and (func');
      return { passed: false, errors };
    }
    return { passed: true, errors: [] };
  }

  // JS validation
  try {
    new Function(code + '\n; typeof solve === "function" ? solve : null;');
  } catch (e) {
    errors.push(`Syntax error: ${e.message}`);
    return { passed: false, errors };
  }

  const forbidden = ['fetch(', 'XMLHttpRequest', 'import(', 'require(',
    'eval(', 'document.', 'window.location', 'localStorage', 'sessionStorage',
    'WebSocket', 'Worker(', 'navigator.', 'process.'];
  for (const pat of forbidden) {
    if (code.includes(pat)) errors.push(`Forbidden pattern: ${pat}`);
  }
  if (errors.length) return { passed: false, errors };

  try {
    const fn = new Function(code + '\nreturn typeof solve === "function";');
    if (!fn()) {
      errors.push('No solve function found');
      return { passed: false, errors };
    }
  } catch (e) {
    errors.push(`Runtime error: ${e.message}`);
    return { passed: false, errors };
  }

  return { passed: true, errors: [] };
}


/* ═══════════════════════════════════════════════════════════════════════════
   Benchmark Runner — Pairwise Matches
   ═══════════════════════════════════════════════════════════════════════════ */

function crGetTests(challengeId) {
  if (CRLocal.benchmarkCache && CRLocal.benchmarkCache.id === challengeId) {
    return CRLocal.benchmarkCache.tests;
  }
  const challenge = CODE_CHALLENGES[challengeId];
  if (!challenge) return [];
  const tests = challenge.generateTests();
  CRLocal.benchmarkCache = { id: challengeId, tests };
  return tests;
}

function crRunMatch(challengeId, codeA, codeB) {
  const challenge = CODE_CHALLENGES[challengeId];
  if (!challenge) return { winner: 'draw' };

  const tests = crGetTests(challengeId);
  const a = challenge.runAgent(codeA, tests);
  const b = challenge.runAgent(codeB, tests);

  const result = { scoreA: a, scoreB: b };

  if (!a.correct && !b.correct) { result.winner = 'draw'; return result; }
  if (!a.correct) { result.winner = 'B'; return result; }
  if (!b.correct) { result.winner = 'A'; return result; }

  // Both correct — compare scores (lower totalMs is better for all challenges)
  const tolerance = challenge.lowerIsBetter ? 0.5 : 0.001;
  if (Math.abs(a.totalMs - b.totalMs) < tolerance) { result.winner = 'draw'; return result; }

  if (challenge.lowerIsBetter) {
    result.winner = a.totalMs < b.totalMs ? 'A' : 'B';
  } else {
    result.winner = a.totalMs > b.totalMs ? 'A' : 'B';
  }
  return result;
}


/* ═══════════════════════════════════════════════════════════════════════════
   Tournament Runner (Swiss matchmaking, ELO updates)
   ═══════════════════════════════════════════════════════════════════════════ */

function crRunTournamentRound(challengeId, agents, matchCount = 10) {
  if (agents.length < 2) return [];

  const results = [];
  for (let m = 0; m < matchCount && !CRLocal.stopRequested; m++) {
    // Swiss matchmaking: pair agents by ELO with random jitter
    const sorted = [...agents].sort((a, b) => b.elo - a.elo);
    let i1 = Math.floor(Math.random() * Math.min(sorted.length, 5));
    let i2 = i1;
    while (i2 === i1) i2 = Math.floor(Math.random() * sorted.length);
    const a1 = sorted[i1], a2 = sorted[i2];

    // Skip if ELO gap too large (unless provisional)
    if (Math.abs(a1.elo - a2.elo) > 400 && a1.gamesPlayed >= 20 && a2.gamesPlayed >= 20) continue;

    try {
      const result = crRunMatch(challengeId, a1.code, a2.code);
      const winner = result.winner;

      a1.gamesPlayed++;
      a2.gamesPlayed++;

      if (winner === 'A') { a1.wins++; a2.losses++; }
      else if (winner === 'B') { a2.wins++; a1.losses++; }
      else { a1.draws++; a2.draws++; }

      // ELO update
      const eloResult = winner === 'A' ? 1 : winner === 'B' ? 0 : 0.5;
      const K1 = a1.gamesPlayed < 20 ? 64 : 32;
      const K2 = a2.gamesPlayed < 20 ? 64 : 32;
      const e1 = 1 / (1 + Math.pow(10, (a2.elo - a1.elo) / 400));
      const e2 = 1 - e1;
      a1.elo += K1 * (eloResult - e1);
      a2.elo += K2 * ((1 - eloResult) - e2);

      results.push({
        agent1: a1.name, agent2: a2.name,
        winner: winner === 'A' ? a1.name : winner === 'B' ? a2.name : 'Draw',
        scoreA: result.scoreA, scoreB: result.scoreB,
      });
    } catch (e) {
      console.warn('Tournament match error:', e);
    }
  }
  return results;
}


/* ═══════════════════════════════════════════════════════════════════════════
   Evolution — LLM Tool-Calling Loop
   ═══════════════════════════════════════════════════════════════════════════ */

const CR_EVOLUTION_TOOLS_DESC = `
You have these tools available. To use one, write a tool_call block:

<tool_call>
{"name": "tool_name", "args": {"key": "value"}}
</tool_call>

Available tools:

1. **query_leaderboard** — Get current agent rankings with benchmark scores
   Args: none

2. **read_agent** — Read an agent's source code
   Args: {"agent_name": "name"}

3. **create_agent** — Create a new agent. Code will be validated and benchmarked.
   Args: {"name": "unique_name", "code": "function solve(...) { ... }"}

4. **test_match** — Run a benchmark comparison between two agents
   Args: {"agent1_name": "name1", "agent2_name": "name2"}

After each tool call, I'll respond with the result. You can make multiple tool calls across rounds.
Create ONE strong agent per generation. Study top agents first, then create a faster/better solution.
`;

async function crRunEvolutionCycle(challengeId, model) {
  const challenge = CODE_CHALLENGES[challengeId];
  if (!challenge) return;

  const gen = CRLocal.generation;
  CRLocal.generation++;
  crLog('info', `--- Generation ${gen} ---`);

  const programMd = CRLocal.programMd || `Create optimized ${challenge.title} agents that win benchmark comparisons.`;
  const agentInterface = CODE_AGENT_INTERFACE[challengeId] || '';
  const isWasm = challenge.isWasm;

  const systemPrompt = `You are an AI code optimizer. Your job is to create ${isWasm ? 'WebAssembly Text Format (WAT)' : 'JavaScript'} solutions that outperform existing agents on benchmarks.

${programMd}

## Agent Interface for ${challenge.title}
\`\`\`${isWasm ? 'wat' : 'javascript'}
${agentInterface}
\`\`\`

## Benchmark
${challenge.desc}
Metric: ${challenge.metricLabel} (${challenge.lowerIsBetter ? 'lower is better' : 'higher is better'})

## Rules
- Your agent must define a \`${challenge.agentFnName || 'solve'}\` function${isWasm ? ' exported from a (module)' : ''}
${isWasm ? '- Must be valid WAT (WebAssembly Text Format)' : '- No fetch, eval, document, localStorage, or other browser APIs'}
- Must produce correct results for all test cases
- Optimize for speed — the faster correct solution wins

${CR_EVOLUTION_TOOLS_DESC}`;

  const top = [...CRLocal.agents].sort((a, b) => b.elo - a.elo).slice(0, 5);
  let userPrompt = `Generation ${gen}.\n`;
  if (top.length) {
    userPrompt += 'Current leaderboard:\n';
    top.forEach((a, i) => {
      userPrompt += ` #${i + 1} ${a.name} ELO=${Math.round(a.elo)} W/L/D=${a.wins}/${a.losses}/${a.draws}\n`;
    });
    if (top[0]) {
      userPrompt += `\nBest agent code (${top[0].name}):\n\`\`\`${isWasm ? 'wat' : 'javascript'}\n${top[0].code}\n\`\`\`\n`;
    }
  } else {
    userPrompt += 'No agents yet — create the first one!\n';
  }
  userPrompt += `\nCreate ONE agent with a unique name like 'gen${gen}_optimizer'. Focus on speed and correctness.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const createdThisRound = new Set();
  const maxRounds = 6;

  for (let round = 0; round < maxRounds; round++) {
    if (CRLocal.stopRequested) break;
    crLog('info', `  LLM round ${round + 1}/${maxRounds}...`);

    let response;
    try {
      response = await callLLM(messages, model, {
        maxTokens: parseInt(CRLocal.config?.maxTokens || 8192),
      });
    } catch (e) {
      crLog('error', `LLM call failed: ${e.message}`);
      break;
    }

    if (typeof response !== 'string') {
      crLog('error', 'LLM returned non-string response');
      break;
    }

    crLog('llm', response.substring(0, 300) + (response.length > 300 ? '...' : ''));

    const toolCallMatch = response.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (!toolCallMatch) {
      messages.push({ role: 'assistant', content: response });
      break;
    }

    let toolCall;
    try {
      toolCall = JSON.parse(toolCallMatch[1]);
    } catch (e) {
      crLog('error', `Invalid tool call JSON: ${e.message}`);
      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'user', content: '<tool_result>\n{"error": "Invalid JSON in tool_call block"}\n</tool_result>' });
      continue;
    }

    const toolResult = crHandleToolCall(toolCall.name, toolCall.args || {}, challengeId, createdThisRound);
    crLog('tool', `${toolCall.name} → ${toolResult.substring(0, 200)}${toolResult.length > 200 ? '...' : ''}`);

    messages.push({ role: 'assistant', content: response });
    messages.push({ role: 'user', content: `<tool_result>\n${toolResult}\n</tool_result>` });
  }

  crLog('info', `Generation ${gen} complete. ${createdThisRound.size} agent(s) created.`);
}

function crHandleToolCall(name, args, challengeId, createdThisRound) {
  if (name === 'query_leaderboard') {
    const sorted = [...CRLocal.agents].sort((a, b) => b.elo - a.elo);
    if (!sorted.length) return JSON.stringify({ agents: [], message: 'No agents yet.' });
    return JSON.stringify(sorted.map((a, i) => ({
      rank: i + 1, name: a.name, elo: Math.round(a.elo),
      wins: a.wins, losses: a.losses, draws: a.draws, games: a.gamesPlayed,
    })));
  }

  if (name === 'read_agent') {
    const agent = CRLocal.agents.find(a => a.name === args.agent_name);
    if (!agent) return JSON.stringify({ error: `Agent '${args.agent_name}' not found` });
    return agent.code;
  }

  if (name === 'create_agent') {
    const agentName = args.name || '';
    const code = args.code || '';

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(agentName)) {
      return JSON.stringify({ error: 'Invalid name. Use letters, digits, underscores only.' });
    }

    const validation = crValidateAgent(code, challengeId);
    if (!validation.passed) {
      return JSON.stringify({ error: 'Validation failed', details: validation.errors });
    }

    // Quick benchmark
    const challenge = CODE_CHALLENGES[challengeId];
    const tests = crGetTests(challengeId);
    const benchResult = challenge.runAgent(code, tests);

    if (!benchResult.correct) {
      return JSON.stringify({
        error: 'Agent produced incorrect results',
        details: benchResult.perTest?.filter(t => !t.correct).map(t => t.name),
        errorMsg: benchResult.error,
      });
    }

    const existing = CRLocal.agents.find(a => a.name === agentName);
    if (existing) {
      existing.code = code;
      existing.generation = CRLocal.generation;
    } else {
      CRLocal.agents.push({
        name: agentName, code, generation: CRLocal.generation,
        elo: 1000, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
      });
    }
    createdThisRound.add(agentName);

    // Run a quick test match against best agent
    let testNote = '';
    if (CRLocal.agents.length >= 2) {
      const best = [...CRLocal.agents].sort((a, b) => b.elo - a.elo).find(a => a.name !== agentName);
      if (best) {
        const matchResult = crRunMatch(challengeId, code, best.code);
        testNote = `Test match vs ${best.name}: ${matchResult.winner === 'A' ? 'WIN' : matchResult.winner === 'B' ? 'LOSS' : 'DRAW'}`;
      }
    }

    return JSON.stringify({
      created: true,
      benchmark: {
        totalMs: benchResult.totalMs.toFixed(2),
        perTest: benchResult.perTest,
        displayScore: benchResult.displayScore,
      },
      testNote,
    });
  }

  if (name === 'test_match') {
    const a1 = CRLocal.agents.find(a => a.name === args.agent1_name);
    const a2 = CRLocal.agents.find(a => a.name === args.agent2_name);
    if (!a1) return JSON.stringify({ error: `Agent '${args.agent1_name}' not found` });
    if (!a2) return JSON.stringify({ error: `Agent '${args.agent2_name}' not found` });

    const result = crRunMatch(challengeId, a1.code, a2.code);
    return JSON.stringify({
      winner: result.winner === 'A' ? a1.name : result.winner === 'B' ? a2.name : 'Draw',
      scoreA: result.scoreA?.perTest,
      scoreB: result.scoreB?.perTest,
    });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

function crLog(level, msg) {
  const time = new Date().toLocaleTimeString();
  const prefix = { info: 'INFO', error: 'ERR', llm: 'LLM', tool: 'TOOL' }[level] || level;
  console.log(`[CodeArena ${prefix}] ${msg}`);

  // Append to status bar
  const statusEl = document.getElementById('arStatusText');
  if (statusEl && level === 'info') {
    statusEl.textContent = msg;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   Auto Research Loop (evolution + tournament interleaved)
   ═══════════════════════════════════════════════════════════════════════════ */

async function crStartLocalResearch() {
  const challengeId = CR.selectedGame;
  if (!challengeId) return;

  const model = document.getElementById('arLocalModel')?.value;
  const apiKey = document.getElementById('arLocalKey')?.value;
  const maxTokens = document.getElementById('arLocalTokens')?.value || '8192';

  if (!model) { alert('Select a model'); return; }
  if (!apiKey) { alert('Enter API key'); return; }

  // Store the API key for callLLM (in-memory only)
  if (typeof window._byokKeys === 'undefined') window._byokKeys = {};
  const provider = model.split('/')[0];
  window._byokKeys[provider] = apiKey;
  // Also store on the scaffolding key manager if it exists
  if (typeof _setByokKey === 'function') _setByokKey(provider, apiKey);

  CRLocal.running = true;
  CRLocal.challengeId = challengeId;
  CRLocal.stopRequested = false;
  CRLocal.config = { model, apiKey, maxTokens };
  CRLocal.benchmarkCache = null; // regenerate tests for this challenge

  crCloseLocalDialog();
  crLog('info', `Starting local research for ${challengeId} with ${model}`);

  // Update start/stop button
  crUpdateResearchButton();

  // Seed tournament: run 30 initial matches if we have agents
  if (CRLocal.agents.length >= 2) {
    crLog('info', 'Seeding tournament (30 matches)...');
    const results = crRunTournamentRound(challengeId, CRLocal.agents, 30);
    crLog('info', `Seed tournament: ${results.length} matches completed.`);
    crRenderLeaderboard();
  }

  // Main loop: alternate evolution and tournament
  while (CRLocal.running && !CRLocal.stopRequested) {
    // Evolution cycle
    try {
      await crRunEvolutionCycle(challengeId, model);
    } catch (e) {
      crLog('error', `Evolution error: ${e.message}`);
    }

    // Tournament round
    if (CRLocal.agents.length >= 2) {
      const results = crRunTournamentRound(challengeId, CRLocal.agents, 20);
      crLog('info', `Tournament: ${results.length} matches. ${CRLocal.agents.length} agents.`);

      // Submit top agents to community
      crSubmitTopAgents(challengeId);
    }

    crRenderLeaderboard();
    crRenderLiveBenchmarks();

    // Brief pause between generations
    if (!CRLocal.stopRequested) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  CRLocal.running = false;
  crUpdateResearchButton();
  crLog('info', 'Local research stopped.');
}

function crStopLocalResearch() {
  CRLocal.stopRequested = true;
  CRLocal.running = false;
  crUpdateResearchButton();
}

async function crSubmitTopAgents(challengeId) {
  // Submit the top agent to the server leaderboard
  const top = [...CRLocal.agents].sort((a, b) => b.elo - a.elo)[0];
  if (!top) return;

  try {
    await fetch(`/api/arena/agents/${challengeId}/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `offline_${top.name}`,
        code: top.code,
        provider: CRLocal.config?.model?.split('/')[0] || 'unknown',
        model: CRLocal.config?.model || 'unknown',
      }),
    });
  } catch (e) {
    // Silent fail — offline submission is best-effort
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — Challenge Sidebar
   ═══════════════════════════════════════════════════════════════════════════ */

const _CHALLENGE_IDS_JS = ['code_sort', 'code_tsp', 'code_cache'];
const _CHALLENGE_IDS_WASM = ['code_wasm_fib', 'code_wasm_sum', 'code_wasm_sort', 'code_wasm_prime'];
const _ALL_CHALLENGE_IDS = [..._CHALLENGE_IDS_JS, ..._CHALLENGE_IDS_WASM];

function crBuildChallengeTabs() {
  const container = document.getElementById('arGameTabs');
  if (!container) return;
  container.innerHTML = '';

  // JS challenges
  for (const id of _CHALLENGE_IDS_JS) {
    const ch = CODE_CHALLENGES[id];
    if (!ch) continue;
    const tab = _crCreateTab(ch);
    container.appendChild(tab);
  }

  // WASM group
  const wasmHeader = document.createElement('div');
  wasmHeader.className = 'ar-game-tab has-subtabs' + (_CHALLENGE_IDS_WASM.includes(CR.selectedGame) ? ' active' : '');
  wasmHeader.dataset.game = 'wasm';

  const mainRow = document.createElement('div');
  mainRow.className = 'ar-game-tab-main';
  mainRow.style.cursor = 'pointer';

  const meta = document.createElement('div');
  meta.className = 'ar-game-tab-meta';
  const title = document.createElement('div');
  title.className = 'ar-game-tab-title';
  title.textContent = '\u{1F9EC} Assembly (WAT)';
  meta.appendChild(title);
  const desc = document.createElement('div');
  desc.className = 'ar-game-tab-desc';
  desc.textContent = 'WebAssembly challenges';
  meta.appendChild(desc);
  mainRow.appendChild(meta);
  wasmHeader.appendChild(mainRow);

  // WASM sub-tabs
  const subBar = document.createElement('div');
  subBar.className = 'ar-snake-subtabs';
  for (const id of _CHALLENGE_IDS_WASM) {
    const ch = CODE_CHALLENGES[id];
    if (!ch) continue;
    const subBtn = document.createElement('button');
    subBtn.className = 'ar-snake-sub' + (CR.selectedGame === id ? ' active' : '');
    subBtn.textContent = ch.title.replace('WASM: ', '');
    subBtn.onclick = (e) => { e.stopPropagation(); crSelectChallenge(id); };
    subBar.appendChild(subBtn);
  }
  wasmHeader.appendChild(subBar);
  mainRow.onclick = () => crSelectChallenge(_CHALLENGE_IDS_WASM[0]);
  container.appendChild(wasmHeader);
}

function _crCreateTab(challenge) {
  const tab = document.createElement('div');
  tab.className = 'ar-game-tab' + (CR.selectedGame === challenge.id ? ' active' : '');
  tab.dataset.game = challenge.id;

  const mainRow = document.createElement('div');
  mainRow.className = 'ar-game-tab-main';
  mainRow.style.cursor = 'pointer';

  const meta = document.createElement('div');
  meta.className = 'ar-game-tab-meta';
  const title = document.createElement('div');
  title.className = 'ar-game-tab-title';
  title.textContent = `${challenge.icon} ${challenge.title}`;
  meta.appendChild(title);
  const desc = document.createElement('div');
  desc.className = 'ar-game-tab-desc';
  desc.textContent = challenge.desc;
  meta.appendChild(desc);
  mainRow.appendChild(meta);
  tab.appendChild(mainRow);

  tab.onclick = () => crSelectChallenge(challenge.id);
  return tab;
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — Challenge Selection & Data Loading
   ═══════════════════════════════════════════════════════════════════════════ */

async function crSelectChallenge(challengeId) {
  CR.selectedGame = challengeId;
  CRLocal.benchmarkCache = null; // reset cached tests

  crBuildChallengeTabs(); // re-render to update active state
  crRenderLeaderboard();

  // Show loading
  const loading = document.getElementById('arLoadingOverlay');
  if (loading) loading.style.display = 'flex';

  // Fetch community data
  try {
    const res = await fetch(`/api/arena/research/${challengeId}`);
    const data = await res.json();

    // Program.md
    CRLocal.programMd = data.program?.content || '';
    const viewer = document.getElementById('arProgramView');
    if (viewer) {
      viewer.innerHTML = CRLocal.programMd
        ? `<pre style="white-space:pre-wrap;font-size:12px;line-height:1.5;color:var(--text);">${_escHtml(CRLocal.programMd)}</pre>`
        : '<div class="ar-no-data">No program.md yet</div>';
    }

    // Leaderboard
    if (data.leaderboard && data.leaderboard.length) {
      CR.lbAgents = data.leaderboard;
      crRenderLeaderboard();
    }

    // Agent count
    const countEl = document.getElementById('arAgentCount');
    if (countEl) countEl.textContent = `${data.agent_count || 0} agents`;

    // Load heartbeat comments
    crFetchHeartbeat(challengeId);

    crLog('info', `Selected: ${CODE_CHALLENGES[challengeId]?.title || challengeId}`);
  } catch (e) {
    crLog('error', `Failed to load data: ${e.message}`);
  } finally {
    if (loading) loading.style.display = 'none';
  }

  crUpdateResearchButton();
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — Leaderboard
   ═══════════════════════════════════════════════════════════════════════════ */

function crRenderLeaderboard() {
  const tbody = document.getElementById('arLeaderboardBody');
  if (!tbody) return;

  // Merge local + community agents
  const allAgents = [];
  if (CR.lbAgents) {
    for (const a of CR.lbAgents) {
      allAgents.push({ ...a, source: 'community' });
    }
  }
  for (const a of CRLocal.agents) {
    allAgents.push({
      name: a.name, elo: Math.round(a.elo),
      wins: a.wins, losses: a.losses, draws: a.draws,
      games_played: a.gamesPlayed, contributor: 'local',
      source: 'local', code: a.code,
    });
  }

  allAgents.sort((a, b) => b.elo - a.elo);

  tbody.innerHTML = '';
  allAgents.slice(0, 50).forEach((a, i) => {
    const tr = document.createElement('tr');
    if (a.source === 'local') tr.style.background = 'rgba(79,204,48,0.08)';

    const tdRank = document.createElement('td');
    tdRank.textContent = i + 1;
    tr.appendChild(tdRank);

    const tdName = document.createElement('td');
    const nameLink = document.createElement('a');
    nameLink.textContent = a.name;
    nameLink.href = '#';
    nameLink.style.color = 'var(--accent)';
    nameLink.onclick = (e) => { e.preventDefault(); crShowAgentCode(a); };
    tdName.appendChild(nameLink);
    tr.appendChild(tdName);

    const tdElo = document.createElement('td');
    tdElo.textContent = Math.round(a.elo);
    tr.appendChild(tdElo);

    const tdScore = document.createElement('td');
    tdScore.textContent = a.avgMs ? `${a.avgMs.toFixed(1)}` : '-';
    tdScore.style.fontSize = '11px';
    tr.appendChild(tdScore);

    const tdWLD = document.createElement('td');
    tdWLD.textContent = `${a.wins || 0}/${a.losses || 0}/${a.draws || 0}`;
    tdWLD.style.fontSize = '11px';
    tr.appendChild(tdWLD);

    const tdBy = document.createElement('td');
    tdBy.textContent = a.contributor || a.source;
    tdBy.style.fontSize = '11px';
    tdBy.style.maxWidth = '60px';
    tdBy.style.overflow = 'hidden';
    tdBy.style.textOverflow = 'ellipsis';
    tr.appendChild(tdBy);

    const tdActions = document.createElement('td');
    const codeBtn = document.createElement('button');
    codeBtn.className = 'ar-btn ar-btn-sm';
    codeBtn.textContent = 'Code';
    codeBtn.onclick = () => crShowAgentCode(a);
    tdActions.appendChild(codeBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

function crShowAgentCode(agent) {
  const modal = document.getElementById('arCodeModal');
  const title = document.getElementById('arCodeModalTitle');
  const code = document.getElementById('arCodeModalCode');
  if (!modal || !title || !code) return;

  title.textContent = `${agent.name} — ELO ${Math.round(agent.elo)}`;
  code.textContent = agent.code || '(no code available)';
  if (typeof hljs !== 'undefined') hljs.highlightElement(code);
  modal.style.display = 'flex';
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — AI Heartbeat
   ═══════════════════════════════════════════════════════════════════════════ */

async function crFetchHeartbeat(challengeId) {
  const list = document.getElementById('arHeartbeatList');
  if (!list) return;

  try {
    const res = await fetch(`/api/arena/comments/${challengeId}`);
    const data = await res.json();
    const comments = data.comments || [];

    if (!comments.length) {
      list.innerHTML = '<div class="ar-no-data" style="padding:20px;text-align:center;">No messages yet. Start the conversation!</div>';
      return;
    }

    list.innerHTML = '';
    for (const c of comments) {
      const div = document.createElement('div');
      div.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;';
      div.innerHTML = `<strong style="color:var(--accent);">${_escHtml(c.username || 'anon')}</strong>
        <span style="color:var(--text-dim);font-size:10px;margin-left:6px;">${new Date(c.created_at).toLocaleString()}</span>
        <div style="margin-top:4px;color:var(--text);white-space:pre-wrap;">${_escHtml(c.content)}</div>`;
      list.appendChild(div);
    }
    list.scrollTop = list.scrollHeight;
  } catch (e) {
    list.innerHTML = '<div class="ar-no-data">Failed to load messages</div>';
  }
}

async function crPostHeartbeat() {
  const challengeId = CR.selectedGame;
  if (!challengeId) return;
  const textarea = document.getElementById('arHeartbeatText');
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) return;

  try {
    await fetch(`/api/arena/comments/${challengeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, comment_type: 'general' }),
    });
    textarea.value = '';
    crFetchHeartbeat(challengeId);
  } catch (e) {
    crLog('error', `Failed to post: ${e.message}`);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — Live Benchmark Visualization
   ═══════════════════════════════════════════════════════════════════════════ */

function crRenderLiveBenchmarks() {
  // Show recent match results as bar charts in the 4 live canvas slots
  const recentMatches = CRLocal.games.slice(-4);

  for (let i = 0; i < 4; i++) {
    const canvas = document.getElementById(`arLive${i}`);
    const info = document.getElementById(`arLiveInfo${i}`);
    if (!canvas || !info) continue;

    if (i >= recentMatches.length) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      info.textContent = '';
      continue;
    }

    const match = recentMatches[i];
    _crRenderBenchmarkBar(canvas, match);
    info.textContent = `${match.agent1} vs ${match.agent2}: ${match.winner}`;
    info.style.fontSize = '10px';
  }
}

function _crRenderBenchmarkBar(canvas, match) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!match.scoreA?.perTest || !match.scoreB?.perTest) return;

  const tests = match.scoreA.perTest;
  const barW = Math.floor(w / (tests.length * 2 + 1));
  const maxMs = Math.max(
    ...tests.map(t => t.ms),
    ...match.scoreB.perTest.map(t => t.ms),
    0.1
  );

  for (let i = 0; i < tests.length; i++) {
    const x = (i * 2 + 0.5) * barW;
    const hA = (tests[i].ms / maxMs) * (h - 20);
    const hB = (match.scoreB.perTest[i]?.ms / maxMs) * (h - 20);

    // Agent A bar (blue)
    ctx.fillStyle = '#1E93FF';
    ctx.fillRect(x, h - 15 - hA, barW - 2, hA);

    // Agent B bar (red/orange)
    ctx.fillStyle = '#FF851B';
    ctx.fillRect(x + barW, h - 15 - hB, barW - 2, hB);

    // Label
    ctx.fillStyle = '#888';
    ctx.font = '8px monospace';
    ctx.fillText(tests[i].name.substring(0, 6), x, h - 3);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — Research Button & Dialog
   ═══════════════════════════════════════════════════════════════════════════ */

function crUpdateResearchButton() {
  const statusBar = document.getElementById('arStatusBar');
  if (!statusBar) return;

  // Remove old button if any
  let btn = document.getElementById('crResearchBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'crResearchBtn';
    btn.className = 'ar-btn';
    btn.style.cssText = 'margin-left:auto;font-size:11px;padding:2px 12px;';
    statusBar.appendChild(btn);
  }

  if (CRLocal.running) {
    btn.textContent = 'Stop Research';
    btn.className = 'ar-btn';
    btn.style.background = 'var(--red)';
    btn.style.color = '#fff';
    btn.onclick = crStopLocalResearch;
  } else {
    btn.textContent = 'Start Local Research';
    btn.className = 'ar-btn ar-btn-primary';
    btn.style.background = '';
    btn.style.color = '';
    btn.onclick = crOpenLocalDialog;
  }
}

function crOpenLocalDialog() {
  if (!CR.selectedGame) { alert('Select a challenge first'); return; }

  const dialog = document.getElementById('arLocalDialog');
  const titleEl = document.getElementById('arLocalDialogTitle');
  const challenge = CODE_CHALLENGES[CR.selectedGame];
  if (titleEl && challenge) titleEl.textContent = `Local Research: ${challenge.title}`;

  // Populate model selector
  const modelSelect = document.getElementById('arLocalModel');
  if (modelSelect && modelSelect.options.length <= 1) {
    modelSelect.innerHTML = '';
    const models = [
      { value: 'gemini/gemini-2.5-flash', label: 'Gemini 2.5 Flash (free)' },
      { value: 'gemini/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'groq/llama-3.3-70b-versatile', label: 'Groq Llama 3.3 70B (free)' },
      { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { value: 'mistral/mistral-small-latest', label: 'Mistral Small (free)' },
    ];
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      modelSelect.appendChild(opt);
    }
  }

  if (dialog) dialog.style.display = 'flex';
}

function crCloseLocalDialog() {
  const dialog = document.getElementById('arLocalDialog');
  if (dialog) dialog.style.display = 'none';
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI — Program.md Version Switching
   ═══════════════════════════════════════════════════════════════════════════ */

async function crSwitchProgramVersion(versionId) {
  if (!versionId || !CR.selectedGame) return;
  try {
    const res = await fetch(`/api/arena/program-version/${versionId}`);
    const data = await res.json();
    if (data.content) {
      CRLocal.programMd = data.content;
      const viewer = document.getElementById('arProgramView');
      if (viewer) {
        viewer.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;line-height:1.5;color:var(--text);">${_escHtml(data.content)}</pre>`;
      }
    }
  } catch (e) {
    crLog('error', `Failed to load program version: ${e.message}`);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════════════ */

function _escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


/* ═══════════════════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  crBuildChallengeTabs();
  crUpdateResearchButton();

  // Auto-select first challenge
  const firstChallenge = _ALL_CHALLENGE_IDS[0];
  if (firstChallenge) crSelectChallenge(firstChallenge);
});
