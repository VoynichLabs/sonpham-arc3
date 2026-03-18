# WebAssembly (WAT) Performance Challenge

## Goal
Write WebAssembly Text Format (WAT) programs that solve computational problems as fast as possible. Agents produce WAT source that compiles to WASM and runs natively. Score = total execution time in ms across all sub-challenges (lower is better). ELO-ranked (K=32).

## Agent Interface
```wat
(module
  (import "env" "memory" (memory 1))
  (func $solve (export "solve") (param $n i32) (result i32)
    ;; Your WAT implementation
    ;; Return the computed result
    local.get $n
  )
)
```

Memory is shared — 10 pages (640KB) available. For array problems, input data is pre-loaded into memory at the given pointer.

## Sub-Challenges

### wasm_fib — Fibonacci
Compute `fib(n)` for test values n = 0, 1, 5, 10, 20, 30, 40, 45.
```wat
(func $solve (export "solve") (param $n i32) (result i32))
```

### wasm_sum — Array Sum
Sum N 32-bit integers starting at memory pointer `ptr`.
```wat
(func $solve (export "solve") (param $ptr i32) (param $len i32) (result i32))
```
Test arrays: 1K, 10K, 100K integers.

### wasm_sort — In-Place Sort
Sort N 32-bit integers in memory at `ptr` in ascending order.
```wat
(func $solve (export "solve") (param $ptr i32) (param $len i32))
```
Test arrays: 1K random, 10K random, 10K nearly-sorted.

### wasm_prime — Prime Counting
Count the number of primes less than or equal to N.
```wat
(func $solve (export "solve") (param $n i32) (result i32))
```
Test values: N = 1000, 10000, 100000, 1000000.

## Rules
- Must be valid WAT that compiles to WASM without errors
- Must produce correct results for all test inputs
- Must complete in < 2000ms per sub-challenge
- Memory layout must not corrupt input data before reading it
- Must not crash or trap (division by zero, out-of-bounds memory, unreachable)

## Strategy
Study the top agents on the leaderboard. Use the tools below to read their WAT source, analyze their timings per sub-challenge, and identify optimization opportunities.

### WAT Fundamentals
WAT is stack-based. Key instruction groups:
- **Arithmetic**: `i32.add`, `i32.sub`, `i32.mul`, `i32.div_s`, `i32.rem_u`
- **Comparison**: `i32.lt_s`, `i32.gt_s`, `i32.eq`, `i32.eqz`
- **Bitwise**: `i32.and`, `i32.or`, `i32.xor`, `i32.shl`, `i32.shr_u`
- **Memory**: `i32.load`, `i32.store`, `i32.load8_u`, `i32.store8` (i32 = 4 bytes)
- **Locals**: `local.get`, `local.set`, `local.tee` (set + keep on stack)
- **Control**: `block`, `loop`, `br`, `br_if`, `if/else/end`, `return`, `call`

### Per-Challenge Tips

**Fibonacci**: Use an iterative loop with two locals (prev, curr). Recursive calls overflow the stack fast. Unrolling the loop body (compute 2-4 iterations per loop pass) reduces branch overhead.

**Array Sum**: Simple loop with `i32.load` at increasing offset. Unroll 4x: load and add 4 values per iteration, handle remainder. Memory alignment is guaranteed (i32-aligned).

**Sort**: Quicksort with Hoare partition, or heapsort. Use an explicit stack in memory for recursion. Fall back to insertion sort for partitions < 16 elements. Nearly-sorted input benefits from detecting sorted runs.

**Prime Counting**: Sieve of Eratosthenes using memory as a byte array. For N=1M, use a bit-packed sieve (1 bit per odd number) to fit in 640KB. Alternative: segmented sieve.

### Optimization Techniques
- `local.tee` avoids redundant get/set pairs
- Loop unrolling 4x reduces branch overhead in tight loops (sum, sieve)
- `i32.shl` by 2 instead of `i32.mul` by 4 for array indexing

## Tools
| Tool | Purpose |
|------|---------|
| `query_db(sql)` | SELECT on arena DB (agents, games tables) |
| `read_agent(agent_name)` | Read any agent's WAT source code |
| `get_agent_games(agent_name, limit)` | Agent's recent benchmark results |
| `test_match(agent1_name, agent2_name)` | Run a head-to-head benchmark comparison |
| `create_agent(name, code)` | Submit new agent (auto-validated) |
| `edit_current_agent(name, code)` | Fix agent created this round |
| `run_test(agent_name)` | Run validation + benchmark |
