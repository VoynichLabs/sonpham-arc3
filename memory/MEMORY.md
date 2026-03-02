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

## ls20-cb3b57cc
- The failure of simple sequential and repetitive inputs suggests the puzzle requires a specific, non-obvious combination of actions or interaction with the grid state to solve.
- Repeatedly spamming a single action (such as ACTION1 or ACTION3) is ineffective for advancing past level 0.
- Cycling sequentially through ACTION1, ACTION2, ACTION3, and ACTION4 does not trigger level progression.
- Advancing levels in this game likely requires a specific, possibly longer, sequence or combination of these actions, or an action not present in the observed history.
- The game state remains 'NOT_FINISHED' and 'levels=0' after any of the observed actions, indicating no immediate progress towards level completion.
- ACTION1, ACTION2, ACTION3, and ACTION4, when executed individually or in the observed short sequences, do not advance the level counter.
- The description for ACTION2 is 'explore', which does not clearly indicate its direct effect on blocks or targets.
- Activating Type A and Type B targets, as observed repeatedly in this run, does not automatically advance levels; a specific condition or sequence is likely required to complete a level.
- ACTION1 teleports a Type 1 block (color 3, 3x5) to a new row, and the log suggests it activates Type B targets.
- ACTION3 teleports a Type 2 block 2 columns to the right, consistently activating Type A targets.
- Type 2 block teleports 2 columns right, activates Type A target & potentially Type C.
- ACTION4 moves the player (white object) left.
- ACTION3 moves the player (white object) down.
- ACTION2 moves the player (white object) right and may change light gray cells.
- ACTION1 moves the player (white object) up.
- No levels were advanced in this run, as 'levels' consistently remained at 0.
- ACTION4 moves a light gray object left, interacts with adjacent cells, or discovers a rule.
- ACTION3 moves light gray objects (e.g., '1' cells) down and may affect '0' cells.
- ACTION2 appears to be an exploration action.
- ACTION1 may move a white/light gray object up or discover a rule.
- Simply moving the player up or down does not advance levels or complete the game.
- ACTION2 is a distinct action, not primarily for vertical movement.
- ACTION3 moves the player (white object) downwards.
- ACTION1 moves the player (white/light gray object) upwards.
- There is a 'yellow bar' that may change when the white L-shape moves, suggesting it's an interactive element or a target.
- ACTION4 moves the white L-shape left.
- ACTION3 moves the white L-shape down.
- ACTION2 moves the white L-shape right.

- ACTION1 moves the white L-shape up.

## fd01-00000001
- ACTION6, when used consecutively, does not change the game state from NOT_FINISHED.
- The game 'fd01-00000001' requires completing 5 levels.
- Repeatedly executing ACTION6 (5 times) does not lead to game completion.
- Repeatedly executing ACTION6 (5 times) does not advance any levels.
- Repeatedly using ACTION6 for at least 20 steps does not alter the game state or level count from 0.
- ACTION6 does not lead to a 'FINISHED' state in this game.
- ACTION6 does not advance the level in this game.
- ACTION6 consistently results in the game state remaining NOT_FINISHED.
- Repeatedly using ACTION6 does not lead to game completion.
- ACTION6 does not advance the current level.
- The descriptions from ACTION6 can highlight different features of the grid, from small 2x2 blocks to large 6x6 blocks.
- Repeated use of ACTION6 does not advance the level in the initial stages of the game.
- ACTION6 provides details about the colors, sizes, and locations of blocks present on the grid.
- ACTION6 is an observation action that describes the current state of the grid.
- Clicking the left 6x6 Green block (8,55) shifts a 2x4 Green segment into the adjacent Gray area within the right 6x6 Green block (44,55).
- Clicking on the left 6x6 Green block at (9,56) cycles the internal 2x4 segments of the right 6x6 Green block between Green (14) and Gray (2).
- Clicking a cell within a 6x6 green block toggles the 4x4 central region of the *other* 6x6 green block between solid green and having a gray square.
- The game consists of 5 levels, as indicated by '0/5'.
- A top bar with alternating dark gray and white segments is present, likely indicating progress or status.
- The game features a consistent blue background (color 9).
- Clicking on red elements appears to be a key interaction or objective.
- Progressing through levels likely requires actions other than ACTION6, or a different application of it.
- The game grid consistently contains several distinct 4x4 colored blocks (e.g., yellow, red, magenta, orange, green).
- ACTION6 does not advance levels in this game, as 5 consecutive uses resulted in 0 levels advanced.
- Repeatedly using ACTION6 does not advance the current level in this game.
- ACTION6 provides a textual description of the current grid state, often detailing its regions or specific rows.
- The goal is to replicate patterns from the left side of the grid to the right side using ACTION6 (CLICK).
- The game's objective involves completing 5 levels, and the grids are characterized by arrangements of 4x4 colored blocks.
- ACTION6 does not appear to modify the grid or advance the level, as 5 consecutive uses resulted in no level progression (0/5 levels).
- ACTION6 provides a textual description of the current grid, specifically mentioning the presence of 4x4 colored blocks.
- Clicking on background cells does not make progress. Must interact with the colored 4x4 blocks.
- The game starts at level 0, and ACTION6 alone does not seem to change this initial level.
- Game grids are described as complex arrangements of colored blocks, frequently featuring Blue (9), Gray (2), and DarkGray (4).
- ACTION6 does not appear to advance levels or complete the game within the initial 5 steps.
- The White (0) and Magenta (6) blocks embedded in DarkGray (4) structures are likely the primary interactive 'buttons' or 'targets'.
- ACTION6 is an observation action that describes the grid's features (colors, blocks, walls) but does not advance levels or game state.
- The grid contains distinct 4x4 colored blocks (e.g., Yellow (11), Red (8), LightMagenta (13)) which are key elements.
- DarkGray (9), VeryDarkGray (4), and Gray (2) are used as walls or dividers within the grid.
- The game environment is a maze-like structure.
- Clicking on 4x4 colored blocks seems to be the primary interaction. Need to identify all such blocks and click them.
- To progress in 'fd01-00000001', actions other than ACTION6 are necessary, as ACTION6 is purely descriptive and does not change the game state or level.
- Repeatedly using ACTION6 in 'fd01-00000001' does not advance levels; the game remains at level 0.
- ACTION6 in 'fd01-00000001' describes the grid content, specifically identifying 4x2 yellow (11) and 4x2 red (8) rectangles.
- Clicking 4x2 yellow (11) and red (8) rectangles seems to be the objective. I should find and click all of them.
- Clicking on background elements does not progress the level. Yellow (11) and Red (8) 4x2 rectangles seem to be interactive targets.
- Different grid sections contain different visual elements, like patterns in the top and specific objects (e.g., green) in the bottom.
- Executing ACTION6 does not advance the game's level counter.
- The grid in this game is large and structured into distinct sections, such as a top (rows 0-1) and bottom (rows 55-60) region.
- ACTION6 generates a textual description of the current grid's layout and contents.
- Maroon (14) blocks are interactive elements. Clicking them might change the grid state or progress the level.
- Clicking Maroon (14) blocks in the bottom section changes the pattern of blocks in the top display (rows 0-1). Each Maroon block likely controls a segment of the top display.
- Green 4x4 block is likely the player. Clicking it might activate or move it. Other colored blocks are potential targets/items.
- Advancing levels in 'fd01-00000001' requires actions other than ACTION6.
- Repeated use of ACTION6 does not progress the game or complete any levels in 'fd01-00000001'.
- ACTION6 in 'fd01-00000001' is a descriptive action that provides information about the grid's contents (e.g., colored blocks, their sizes, and colors) without altering the grid state or advancing levels.

- Clicking a Green block (14) in the bottom section changes DarkGray blocks (3) in the top section to Yellow (11) and transforms the Green blocks (14) into a Green/Gray (14/2) pattern.

## ft09-9ab2447a
- None of the observed actions (ACTION1-ACTION6) appear to be the correct initial step to advance from level 0.
- Repeatedly applying ACTION5 does not advance the level or finish the game.
- Actions ACTION1, ACTION2, ACTION3, ACTION4, ACTION5, and ACTION6 individually do not complete level 0.
- Actions 3, 4, and 6, as used in the initial steps, did not lead to level completion, suggesting they are either basic movement/interaction or require a specific sequence/context to advance.
- The game grid is characterized by a symmetrical maze-like structure.
- Blue (9) and Red (8) blocks are prominent interactive elements within the maze.
- Black (5) blocks consistently function as static walls, forming the maze structure.
- Player is a 2x1 yellow (11) block. Movement actions (1-4) move the player. Goal is to navigate the maze.
- Yellow (11) block at (63,60) is likely the player or a cursor. It reacts to directional inputs or interactions with the main grid. The goal might involve manipulating the red (8) and blue (9) blocks or the patterns within them.
- Player is yellow (11). Movement actions (1-4) move the player. Goal likely involves navigating the maze.
- White blocks (0) are interactable. Orange bar (12) is likely the target. Movement actions might be used after clicking.
- Small gray (2) and white (0) blocks are likely interactive elements. Try clicking them with ACTION6.
- The game grids consistently feature 6x6 blocks of red (8) and blue (9) as primary elements on a black (5) background.
- Using ACTION6 repeatedly does not advance the level or finish the game.
- ACTION6 is an observation action that describes the grid's visual composition, specifically mentioning 6x6 blocks of red (8) and blue (9) on a black (5) background.
- Clicking on the white (0) or gray (2) parts of the 'eye' patterns within the 6x6 red/blue blocks seems to be the primary interaction.
- Clicking on specific cells within 2x2/0x2/8x2 patterns seems to be the primary interaction. These patterns are likely switches or state-changing elements.

- Small gray/white patterns within red blocks are likely interactive elements. Clicking on them might change their state or move them.
