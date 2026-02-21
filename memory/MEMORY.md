# ARC-AGI-3 Agent — Hard Memory
# ─────────────────────────────────────────────────────────────────────────────
# This file is read at the start of every game and injected into the agent's
# context.  The agent (and the post-game reflector) can append new bullets here
# as it learns rules, strategies, and game-specific knowledge.
#
# Format:  one bullet per fact.  Keep bullets short (≤ 120 chars).
# Sections:  ## General  /  ## <game_id>  /  ## Strategies
# ─────────────────────────────────────────────────────────────────────────────

## General

### Action Mappings (universal across all games)
- ACTION1 = Move UP (or equivalent upward/north action)
- ACTION2 = Move RIGHT (or equivalent rightward/east action)
- ACTION3 = Move DOWN (or equivalent downward/south action)
- ACTION4 = Move LEFT (or equivalent westward/west action)
- ACTION5 = Context-dependent (cycle, toggle, interact, confirm — varies by game)
- ACTION6 = CLICK at (x, y) coordinates — used for selecting, placing, or interacting with specific cells
- ACTION7 = Context-dependent (secondary interact, rotate, swap — varies by game)
- ACTION0 = RESET — restarts the current level. Use only as last resort or help optimize the goal.

### Game Mechanics
- States: NOT_FINISHED (playing), WIN (all levels done), GAME_OVER (failed)
- Completing a level often triggers a grid reset — note what persists vs resets
- You can lose by running out of lives, energy, moves, or time-based counters

## Strategies

- The goal is to finish the game (WIN) in the fewest steps possible
- If no visible changes occur from an action, try a different action or approach
- Pay attention to color changes — they often signal progress or state transitions

## ls20

## ft09

## vc33
