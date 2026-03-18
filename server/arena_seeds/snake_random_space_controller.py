# Author: Claude Opus 4.6
# Date: 2026-03-18 22:00
# PURPOSE: Space controller benchmark agent for Snake Random Maps arena.
#   Flood-fill territory maximization + enemy cut-off strategy.
#   Scores moves by reachable area, food accessibility, and enemy space denial.
#   When ahead on length: play conservatively (maximize own space).
#   When behind: play aggressively (minimize enemy space, cut corridors).
# SRP/DRY check: Pass — standalone agent, no shared deps

"""Space Controller agent for Snake Random Maps — territory control + enemy space denial."""

from collections import deque


def get_move(state):
    head = tuple(state['my_snake'][0])
    my_snake = [tuple(s) for s in state['my_snake']]
    w, h = state['grid_size']
    enemy_list = [tuple(s) for s in state['enemy_snake']]
    enemy_set = set(enemy_list)
    walls = set(map(tuple, state.get('walls', [])))
    food = set(tuple(f) for f in state['food'])
    my_len = len(my_snake)
    enemy_len = len(enemy_list)

    dirs = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}

    def in_bounds(x, y):
        return 0 < x < w - 1 and 0 < y < h - 1

    body_set = set(my_snake)
    occupied = body_set | enemy_set | walls

    # Safe moves from head
    safe = {}
    for m, (dx, dy) in dirs.items():
        nx, ny = head[0] + dx, head[1] + dy
        if in_bounds(nx, ny) and (nx, ny) not in occupied:
            safe[m] = (nx, ny)

    if not safe:
        return state.get('my_direction', 'UP')

    if len(safe) == 1:
        return next(iter(safe))

    # Flood fill returning (cell_count, food_count)
    def flood_fill(start, obstacles):
        vis = {start}
        q = deque([start])
        cells = 0
        foods = 0
        while q:
            cx, cy = q.popleft()
            cells += 1
            if (cx, cy) in food:
                foods += 1
            for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                nx, ny = cx + dx, cy + dy
                if (nx, ny) not in vis and in_bounds(nx, ny) and (nx, ny) not in obstacles:
                    vis.add((nx, ny))
                    q.append((nx, ny))
        return cells, foods

    # Enemy head (for space denial calculation)
    enemy_head = enemy_list[0] if enemy_list else None

    # Determine play style: conservative when ahead, aggressive when behind
    aggressive = my_len < enemy_len

    best_move = None
    best_score = -999999

    for m, pos in safe.items():
        # My reachable space from this move
        my_cells, my_foods = flood_fill(pos, occupied)

        score = my_cells * 3 + my_foods * 10

        # Enemy space denial: compute how much space enemy has if we move here
        if enemy_head and aggressive:
            # After we move to pos, occupied changes: old tail frees up, new pos is occupied
            # Approximate: just add pos to occupied for enemy's perspective
            enemy_obstacles = occupied | {pos}
            enemy_cells, _ = flood_fill(enemy_head, enemy_obstacles)
            # Reward moves that shrink enemy space
            score += (200 - enemy_cells) * 2

        # Proximity to nearest food (tiebreaker)
        if food:
            nearest_food_dist = min(abs(pos[0] - fx) + abs(pos[1] - fy) for fx, fy in food)
            score -= nearest_food_dist

        # Avoid moves that trap us in small areas
        if my_cells < my_len + 2:
            score -= 500  # heavily penalize getting trapped

        if score > best_score:
            best_score = score
            best_move = m

    return best_move
