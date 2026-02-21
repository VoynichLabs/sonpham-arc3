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

- Actions 1-4 usually map to directional movement (up/right/down/left — varies by game).
- ACTION6 is a click action requiring x,y coordinates; try clicking distinct coloured objects.
- ACTION0 is RESET — use only as a last resort; it restarts the current level.
- Large uniform regions are typically background or walls, not interactive objects.
- Small, isolated coloured shapes are usually the player character or key items.
- Bars running along an edge (especially with a gradient) are typically progress/health/energy meters.
- If the grid appears unchanged after multiple different actions, try ACTION6 on distinct objects.

## Strategies

- Start by mapping each action to its observable effect before committing to a plan.
- Track which cells change after each action to build a cause-and-effect model.
- Completing a level often triggers a full or partial grid reset — note what persists.
- If stuck after 10+ moves with no level progress, try RESET and a completely different approach.

## ls20

## ft09

## vc33
