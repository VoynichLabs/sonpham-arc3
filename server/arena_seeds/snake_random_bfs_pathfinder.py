# Author: Claude Opus 4.6
# Date: 2026-03-18 22:00
# PURPOSE: BFS pathfinder benchmark agent for Snake Random Maps arena.
#   Finds shortest BFS path to nearest reachable food, treating walls + enemy + self as obstacles.
#   Falls back to flood-fill space maximization when no food is reachable.
#   Adapted from chuyangliu/snake greedy solver (MIT license).
# SRP/DRY check: Pass — standalone agent, no shared deps

"""BFS Pathfinder agent for Snake Random Maps — shortest path to food, flood-fill fallback."""

from collections import deque


def get_move(state):
    head = state['my_snake'][0]
    w, h = state['grid_size']
    body = set(map(tuple, state['my_snake']))
    enemy = set(map(tuple, state['enemy_snake']))
    walls = set(map(tuple, state.get('walls', [])))
    food = [tuple(f) for f in state['food']]
    occupied = body | enemy | walls

    dirs = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}

    def in_bounds(x, y):
        return 0 < x < w - 1 and 0 < y < h - 1

    # Safe moves from head
    safe = {}
    for m, (dx, dy) in dirs.items():
        nx, ny = head[0] + dx, head[1] + dy
        if in_bounds(nx, ny) and (nx, ny) not in occupied:
            safe[m] = (nx, ny)

    if not safe:
        return state.get('my_direction', 'UP')

    # BFS from head to find nearest reachable food
    food_set = set(food)
    if food_set:
        visited = {tuple(head)}
        queue = deque([(tuple(head), None)])  # (pos, first_move)
        while queue:
            (cx, cy), first = queue.popleft()
            for m, (dx, dy) in dirs.items():
                nx, ny = cx + dx, cy + dy
                if (nx, ny) in visited:
                    continue
                if not in_bounds(nx, ny) or (nx, ny) in occupied:
                    continue
                visited.add((nx, ny))
                fm = first if first else m
                if (nx, ny) in food_set and fm in safe:
                    return fm
                queue.append(((nx, ny), fm))

    # Fallback: pick safe move with most flood-fill reachable cells
    def flood_count(start):
        vis = {start}
        q = deque([start])
        count = 0
        while q:
            cx, cy = q.popleft()
            count += 1
            for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                nx, ny = cx + dx, cy + dy
                if (nx, ny) not in vis and in_bounds(nx, ny) and (nx, ny) not in occupied:
                    vis.add((nx, ny))
                    q.append((nx, ny))
        return count

    best_move = max(safe.keys(), key=lambda m: flood_count(safe[m]))
    return best_move
