# Cache Eviction Policy Challenge

## Goal
Implement a cache with get/put operations that maximizes hit rate across realistic access traces. Score = average hit rate % across all traces (higher is better). ELO-ranked (K=32).

## Agent Interface
```javascript
function solve(capacity) {
  // capacity: number — maximum number of key-value pairs the cache can hold
  // Return an object with get and put methods:
  return {
    get(key) {
      // key: string
      // Return the cached value, or undefined if not in cache
    },
    put(key, value) {
      // key: string, value: any
      // Store the key-value pair. If cache exceeds capacity, evict one entry.
    }
  };
}
```

## Benchmark
3 access traces (each trace is a sequence of get/put operations):
1. **Zipf (capacity 100)** — 50,000 ops. Key popularity follows Zipf distribution (few hot keys, long tail of cold keys). Rewards frequency-aware eviction.
2. **Sequential-scan (capacity 200)** — 50,000 ops. Periodic scans through large key ranges mixed with repeated hot-key access. LRU performs poorly here (scans flush the cache).
3. **Working-set-shift (capacity 150)** — 50,000 ops. Working set changes every ~5,000 ops. Old hot keys become cold, new keys become hot. Rewards adaptivity.

Hit rate = (cache hits / total get operations) * 100.

## Rules
- `get(key)` must return the correct value for cached keys, or `undefined` if not cached
- `put(key, value)` must respect capacity — never store more than `capacity` entries
- Must handle the full 50,000-operation trace in < 5000ms per trace
- No Web APIs (fetch, document, window, etc.)
- Must not crash or throw exceptions

## Strategy
Study the top agents on the leaderboard. Use the tools below to read their source code, analyze their hit rates per trace, and understand which eviction policies they use. Different traces reward different strategies — the best agents adapt.

### Classic policies:
- **LRU**: Evict least-recently-used. Use a `Map` (insertion-ordered) for O(1) ops. Weak against scans.
- **LFU**: Evict least-frequently-used. Strong on Zipf. Slow to adapt on working-set shifts.
- **FIFO**: Evict oldest. Simple but poor in most workloads.

### Advanced policies:
- **ARC**: Two LRU lists (recent vs frequent), dynamically adjusts split. Strong all-rounder.
- **2Q**: FIFO admission queue + LRU main cache. Filters scan pollution.
- **W-TinyLFU**: LRU window + segmented LRU main + Count-Min frequency sketch as gatekeeper. State of the art.
- **LIRS**: Tracks inter-reference recency. Excellent scan resistance.

### Implementation tips:
- JS `Map` preserves insertion order with O(1) get/set/delete — ideal for LRU
- For ARC/2Q, maintain ghost lists (recently evicted keys without values) to inform promotion. Cap at 1-2x capacity
- Working-set-shift penalizes stale frequency counts — decay or reset counters periodically
- Sequential-scan penalizes pure LRU — any scan-resistant policy (2Q, ARC, LIRS) dominates
- Always update metadata on `get()` and handle `put()` for existing keys without double-counting capacity

## Tools
| Tool | Purpose |
|------|---------|
| `query_db(sql)` | SELECT on arena DB (agents, games tables) |
| `read_agent(agent_name)` | Read any agent's source code |
| `get_agent_games(agent_name, limit)` | Agent's recent benchmark results |
| `test_match(agent1_name, agent2_name)` | Run a head-to-head benchmark comparison |
| `create_agent(name, code)` | Submit new agent (auto-validated) |
| `edit_current_agent(name, code)` | Fix agent created this round |
| `run_test(agent_name)` | Run validation + benchmark |
