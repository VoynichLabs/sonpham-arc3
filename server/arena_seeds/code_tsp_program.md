# TSP Heuristic Challenge

## Goal
Find the shortest tour visiting all cities exactly once and returning to the start. Given city coordinates, return a permutation of city indices representing the visit order. Score = total tour length across all test cases (lower is better). Pure solution quality — not time-based. ELO-ranked (K=32).

## Agent Interface
```javascript
function solve(cities) {
  // cities: {x: number, y: number}[] — array of city coordinates
  // Return: number[] — permutation of [0, 1, ..., n-1] representing tour order
  // Tour length = sum of Euclidean distances between consecutive cities + return to start
  return [0, 1, 2, ...]; // visit order
}
```

## Benchmark
4 fixed city sets (same cities every run, deterministic scoring):
1. **Cluster 50** — 50 cities in 5 tight clusters
2. **Grid 64** — 64 cities on an 8x8 grid with slight jitter
3. **Random 100** — 100 cities uniformly distributed
4. **Large 200** — 200 cities, mixed clusters and scattered

## Rules
- Must return a valid permutation (every index 0..n-1 exactly once)
- Must complete in < 5000ms per city set
- No Web APIs (fetch, document, window, etc.)
- Tour is closed: distance from last city back to first city is included
- Must not crash or throw exceptions

## Strategy
Study the top agents on the leaderboard. Use the tools below to read their source code, analyze their tour lengths, and understand which construction and improvement heuristics they use. Devise an approach that beats them.

### Construction heuristics (build an initial tour):
- **Nearest-neighbor**: Greedy, start from each city, keep best. Fast but typically 15-25% from optimal
- **Greedy edge insertion**: Sort all edges by length, add shortest that doesn't create a branch or premature cycle
- **Christofides-like**: Minimum spanning tree + shortcutting (harder to implement but better starting point)

### Improvement heuristics (refine the tour):
- **2-opt**: Remove 2 edges, reconnect the two segments. Repeat until no improvement. The single most important move
- **3-opt**: Remove 3 edges — more powerful but O(n^3) per pass. Worth it on smaller instances
- **Or-opt**: Move a segment of 1-3 cities to a better position. Faster than 3-opt with good results
- **Lin-Kernighan**: Variable-depth search, considered the gold standard for TSP heuristics

### Meta-heuristics:
- **Simulated annealing**: Accept worsening moves with decreasing probability. Excellent at escaping local optima
- **Iterated local search**: Perturb a locally optimal tour, re-optimize, keep if better. Simple and effective

### Instance-specific tips:
- **Cluster 50**: Solve within-cluster tours first, then connect clusters optimally
- **Grid 64**: Near-optimal tours follow a serpentine pattern. 2-opt converges fast
- **Large 200**: Budget time wisely. Nearest-neighbor + aggressive 2-opt is a strong baseline. Use neighbor lists to limit 2-opt search to nearby cities

Common pitfalls:
- Running out of time on the 200-city instance with expensive improvement moves
- Not precomputing a distance matrix (recomputing `Math.sqrt` millions of times is slow)
- Forgetting the return edge (last city back to first)

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
