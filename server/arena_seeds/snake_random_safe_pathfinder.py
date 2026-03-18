# Author: Claude Opus 4.6
# Date: 2026-03-18 22:00
# PURPOSE: Safe pathfinder benchmark agent for Snake Random Maps arena.
#   BFS to food + virtual snake simulation + flood-fill safety check.
#   Only commits to a food path if the snake can reach its own tail after eating (escape route).
#   Falls back to tail-chase, then flood-fill space maximization.
#   Adapted from Hawstein/snake-ai and chuyangliu/snake greedy solver.
# SRP/DRY check: Pass — standalone agent, no shared deps

"""Safe Pathfinder agent for Snake Random Maps — BFS + escape-route verification + tail chase."""

from collections import deque


def get_move(state):
    head = tuple(state['my_snake'][0])
    my_snake = [tuple(s) for s in state['my_snake']]
    w, h = state['grid_size']
    enemy = set(map(tuple, state['enemy_snake']))
    walls = set(map(tuple, state.get('walls', [])))
    food = [tuple(f) for f in state['food']]

    dirs = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}

    def in_bounds(x, y):
        return 0 < x < w - 1 and 0 < y < h - 1

    body_set = set(my_snake)
    occupied = body_set | enemy | walls

    # Safe moves from head
    safe = {}
    for m, (dx, dy) in dirs.items():
        nx, ny = head[0] + dx, head[1] + dy
        if in_bounds(nx, ny) and (nx, ny) not in occupied:
            safe[m] = (nx, ny)

    if not safe:
        return state.get('my_direction', 'UP')

    # BFS shortest path: returns (first_move, path_list) to target, or None
    def bfs_path(start, targets, obstacles):
        target_set = set(targets)
        visited = {start}
        queue = deque([(start, None, [])])  # (pos, first_move, path)
        while queue:
            (cx, cy), first, path = queue.popleft()
            for m, (dx, dy) in dirs.items():
                nx, ny = cx + dx, cy + dy
                if (nx, ny) in visited:
                    continue
                if not in_bounds(nx, ny) or (nx, ny) in obstacles:
                    continue
                visited.add((nx, ny))
                fm = first if first else m
                new_path = path + [(nx, ny)]
                if (nx, ny) in target_set:
                    return fm, new_path
                queue.append(((nx, ny), fm, new_path))
        return None

    # Simulate eating: given a path to food, compute the virtual snake body after eating
    def virtual_snake_after_eating(path_to_food):
        # Snake moves along path: head goes to food, body follows, +1 growth
        vsnake = list(my_snake)
        for pos in path_to_food:
            vsnake.insert(0, pos)
            # Don't pop tail on the last step (food eaten = grow by 1)
        # Pop len(path)-1 tail segments (normal movement for non-food steps)
        pops = len(path_to_food) - 1
        for _ in range(pops):
            if len(vsnake) > 1:
                vsnake.pop()
        return vsnake

    # Check if virtual snake can reach its own tail (escape route exists)
    def can_reach_tail(vsnake):
        if len(vsnake) < 2:
            return True
        vhead = vsnake[0]
        vtail = vsnake[-1]
        vbody = set(vsnake[1:])  # exclude head, include tail (will move away)
        obstacles = vbody | enemy | walls
        # Tail will move, so it's actually reachable — remove it from obstacles
        obstacles.discard(vtail)
        visited = {vhead}
        queue = deque([vhead])
        while queue:
            cx, cy = queue.popleft()
            for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                nx, ny = cx + dx, cy + dy
                if (nx, ny) == vtail:
                    return True
                if (nx, ny) not in visited and in_bounds(nx, ny) and (nx, ny) not in obstacles:
                    visited.add((nx, ny))
                    queue.append((nx, ny))
        return False

    # Try each food by distance — find a safe one
    food_by_dist = sorted(food, key=lambda f: abs(f[0] - head[0]) + abs(f[1] - head[1]))

    for target in food_by_dist:
        result = bfs_path(head, [target], occupied)
        if result is None:
            continue
        first_move, path = result
        if first_move not in safe:
            continue
        # Simulate eating and check escape route
        vsnake = virtual_snake_after_eating(path)
        if can_reach_tail(vsnake):
            return first_move

    # Fallback: chase own tail (longest path to stay alive)
    tail = my_snake[-1]
    # Tail will move next turn, so it's reachable — use occupied minus tail
    tail_obstacles = occupied - {tail}
    tail_result = bfs_path(head, [tail], tail_obstacles)
    if tail_result and tail_result[0] in safe:
        return tail_result[0]

    # Last resort: pick safe move with most flood-fill reachable cells
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

    return max(safe.keys(), key=lambda m: flood_count(safe[m]))
