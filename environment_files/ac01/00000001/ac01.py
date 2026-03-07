"""ARCeption — Play ARC-1/ARC-2 puzzles inside the ARC-AGI-3 engine.

10 levels of increasing difficulty. Each level is an ARC puzzle.
Click cells to paint them, pick colors from the palette, then submit.
Two tries per level.
"""

from arcengine import ARCBaseGame, Camera, GameAction, Level, Sprite
from arcengine.enums import ActionInput

# ── ARC color (0-9) → engine palette index ─────────────────────────────
ARC_TO_ENGINE = {
    0: 5,   # black
    1: 9,   # blue
    2: 8,   # red
    3: 14,  # green
    4: 11,  # yellow
    5: 2,   # grey
    6: 6,   # fuschia/magenta
    7: 12,  # orange
    8: 10,  # teal/cyan
    9: 13,  # brown/maroon
}

ENGINE_BG = 4       # charcoal — used as background for the grid border
ENGINE_GRID_BG = 5  # black — cell background (ARC 0)
ENGINE_WHITE = 0    # white — for UI elements
ENGINE_LGRAY = 1    # light gray — palette highlight
ENGINE_DGRAY = 3    # dark gray — grid lines

# ── All 10 puzzles ──────────────────────────────────────────────────────
# Each puzzle: { "train": [{"input": grid, "output": grid}, ...],
#                "test":  [{"input": grid, "output": grid}] }
# We only use the first test example per puzzle.

PUZZLES = [
    # L1: Gravity shift down (3x3) — 25ff71a9
    {
        "name": "Gravity",
        "id": "25ff71a9",
        "desc": "Shift the pattern down by one row",
        "train": [
            {"input": [[1,1,1],[0,0,0],[0,0,0]], "output": [[0,0,0],[1,1,1],[0,0,0]]},
            {"input": [[0,0,0],[1,1,1],[0,0,0]], "output": [[0,0,0],[0,0,0],[1,1,1]]},
            {"input": [[0,1,0],[1,1,0],[0,0,0]], "output": [[0,0,0],[0,1,0],[1,1,0]]},
            {"input": [[0,2,2],[0,0,2],[0,0,0]], "output": [[0,0,0],[0,2,2],[0,0,2]]},
        ],
        "test": {"input": [[2,0,0],[2,0,0],[0,0,0]], "output": [[0,0,0],[2,0,0],[2,0,0]]},
    },
    # L2: 180-degree rotation (3x3) — 6150a2bd
    {
        "name": "Rotate 180",
        "id": "6150a2bd",
        "desc": "Rotate the grid 180 degrees",
        "train": [
            {"input": [[3,3,8],[3,7,0],[5,0,0]], "output": [[0,0,5],[0,7,3],[8,3,3]]},
            {"input": [[5,5,2],[1,0,0],[0,0,0]], "output": [[0,0,0],[0,0,1],[2,5,5]]},
        ],
        "test": {"input": [[6,3,5],[6,8,0],[4,0,0]], "output": [[0,0,4],[0,8,6],[5,3,6]]},
    },
    # L3: 180 rotation variant (3x3) — 3c9b0459
    {
        "name": "Flip",
        "id": "3c9b0459",
        "desc": "Rotate the entire grid 180 degrees",
        "train": [
            {"input": [[2,2,1],[2,1,2],[2,8,1]], "output": [[1,8,2],[2,1,2],[1,2,2]]},
            {"input": [[9,2,4],[2,4,4],[2,9,2]], "output": [[2,9,2],[4,4,2],[4,2,9]]},
            {"input": [[8,8,8],[5,5,8],[8,5,5]], "output": [[5,5,8],[8,5,5],[8,8,8]]},
            {"input": [[3,2,9],[9,9,9],[2,3,3]], "output": [[3,3,2],[9,9,9],[9,2,3]]},
        ],
        "test": {"input": [[6,4,4],[6,6,4],[4,6,7]], "output": [[7,6,4],[4,6,6],[4,4,6]]},
    },
    # L4: Transpose (3x3) — 74dd1130
    {
        "name": "Transpose",
        "id": "74dd1130",
        "desc": "Transpose rows and columns",
        "train": [
            {"input": [[2,2,1],[1,5,1],[5,2,2]], "output": [[2,1,5],[2,5,2],[1,1,2]]},
            {"input": [[2,2,5],[6,2,2],[5,5,5]], "output": [[2,6,5],[2,2,5],[5,2,5]]},
            {"input": [[9,9,5],[5,5,8],[5,8,9]], "output": [[9,5,5],[9,5,8],[5,8,9]]},
            {"input": [[2,6,6],[2,1,1],[2,6,2]], "output": [[2,2,2],[6,1,6],[6,1,2]]},
        ],
        "test": {"input": [[9,3,4],[9,4,4],[9,3,4]], "output": [[9,9,9],[3,4,3],[4,4,4]]},
    },
    # L5: Color replace 6→2 (4x4) — b1948b0a
    {
        "name": "Recolor",
        "id": "b1948b0a",
        "desc": "Replace one color with another",
        "train": [
            {"input": [[6,6,7,6],[6,6,7,7],[7,7,6,7]], "output": [[2,2,7,2],[2,2,7,7],[7,7,2,7]]},
            {"input": [[7,7,7,6],[6,6,7,6],[7,7,6,7],[7,6,7,7],[7,6,7,6],[6,6,6,7]], "output": [[7,7,7,2],[2,2,7,2],[7,7,2,7],[7,2,7,7],[7,2,7,2],[2,2,2,7]]},
        ],
        "test": {"input": [[6,7,7,6],[6,7,6,7],[7,7,7,6],[7,6,7,6]], "output": [[2,7,7,2],[2,7,2,7],[7,7,7,2],[7,2,7,2]]},
    },
    # L6: Gravity sort — each column's non-zero values sink (5x5) — 1e0a9b12
    {
        "name": "Sink",
        "id": "1e0a9b12",
        "desc": "Non-zero values sink to the bottom",
        "train": [
            {"input": [[0,4,0,9],[0,0,0,0],[0,4,6,0],[1,0,0,0]], "output": [[0,0,0,0],[0,0,0,0],[0,4,0,0],[1,4,6,9]]},
            {"input": [[0,0,0,0,0,9],[0,0,0,8,0,0],[0,0,0,0,0,0],[4,0,0,0,0,0],[4,0,7,8,0,0],[4,0,7,0,0,0]], "output": [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[4,0,0,0,0,0],[4,0,7,8,0,0],[4,0,7,8,0,9]]},
            {"input": [[0,0,0,1,0],[0,3,0,0,0],[0,3,0,1,2],[6,0,0,0,0],[0,3,0,0,0]], "output": [[0,0,0,0,0],[0,0,0,0,0],[0,3,0,0,0],[0,3,0,1,0],[6,3,0,1,2]]},
        ],
        "test": {"input": [[0,2,0,4,3],[5,0,0,0,0],[0,0,6,0,0],[5,2,0,4,0],[5,0,0,0,0]], "output": [[0,0,0,0,0],[0,0,0,0,0],[5,0,0,0,0],[5,2,0,4,0],[5,2,6,4,3]]},
    },
    # L7: Fill the L-shaped gap with color 1 (7x7) — 3aa6fb7a
    {
        "name": "Fill Gap",
        "id": "3aa6fb7a",
        "desc": "Fill the missing corner of each L-shape",
        "train": [
            {"input": [[0,0,0,0,0,0,0],[0,8,0,0,0,0,0],[0,8,8,0,0,0,0],[0,0,0,0,8,8,0],[0,0,0,0,0,8,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]],
             "output": [[0,0,0,0,0,0,0],[0,8,1,0,0,0,0],[0,8,8,0,0,0,0],[0,0,0,0,8,8,0],[0,0,0,0,1,8,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]]},
            {"input": [[0,0,0,0,8,8,0],[0,0,0,0,0,8,0],[0,0,8,0,0,0,0],[0,0,8,8,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,8,0,0],[0,0,0,8,8,0,0]],
             "output": [[0,0,0,0,8,8,0],[0,0,0,0,1,8,0],[0,0,8,1,0,0,0],[0,0,8,8,0,0,0],[0,0,0,0,0,0,0],[0,0,0,1,8,0,0],[0,0,0,8,8,0,0]]},
        ],
        "test": {"input": [[0,0,0,0,0,8,8],[8,8,0,0,0,0,8],[8,0,0,0,0,0,0],[0,0,0,8,0,0,0],[0,0,0,8,8,0,0],[0,8,0,0,0,0,0],[8,8,0,0,0,0,0]],
                 "output": [[0,0,0,0,0,8,8],[8,8,0,0,0,1,8],[8,1,0,0,0,0,0],[0,0,0,8,1,0,0],[0,0,0,8,8,0,0],[1,8,0,0,0,0,0],[8,8,0,0,0,0,0]]},
    },
    # L8: Diagonal tiling (7x7) — 05269061
    {
        "name": "Tile",
        "id": "05269061",
        "desc": "Tile the diagonal pattern across the grid",
        "train": [
            {"input": [[2,8,3,0,0,0,0],[8,3,0,0,0,0,0],[3,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]],
             "output": [[2,8,3,2,8,3,2],[8,3,2,8,3,2,8],[3,2,8,3,2,8,3],[2,8,3,2,8,3,2],[8,3,2,8,3,2,8],[3,2,8,3,2,8,3],[2,8,3,2,8,3,2]]},
            {"input": [[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,1],[0,0,0,0,0,1,2],[0,0,0,0,1,2,4],[0,0,0,1,2,4,0],[0,0,1,2,4,0,0]],
             "output": [[2,4,1,2,4,1,2],[4,1,2,4,1,2,4],[1,2,4,1,2,4,1],[2,4,1,2,4,1,2],[4,1,2,4,1,2,4],[1,2,4,1,2,4,1],[2,4,1,2,4,1,2]]},
        ],
        "test": {"input": [[0,1,0,0,0,0,2],[1,0,0,0,0,2,0],[0,0,0,0,2,0,0],[0,0,0,2,0,0,0],[0,0,2,0,0,0,0],[0,2,0,0,0,0,4],[2,0,0,0,0,4,0]],
                 "output": [[2,1,4,2,1,4,2],[1,4,2,1,4,2,1],[4,2,1,4,2,1,4],[2,1,4,2,1,4,2],[1,4,2,1,4,2,1],[4,2,1,4,2,1,4],[2,1,4,2,1,4,2]]},
    },
    # L9: Stamp crosses around colored dots (9x9) — 0ca9ddb6
    {
        "name": "Stamp",
        "id": "0ca9ddb6",
        "desc": "Surround each colored dot with a cross pattern",
        "train": [
            {"input": [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,2,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]],
             "output": [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,4,0,4,0,0,0,0,0],[0,0,2,0,0,0,0,0,0],[0,4,0,4,0,0,0,0,0],[0,0,0,0,0,0,7,0,0],[0,0,0,0,0,7,1,7,0],[0,0,0,0,0,0,7,0,0],[0,0,0,0,0,0,0,0,0]]},
            {"input": [[0,0,0,8,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,2,0,0],[0,0,1,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,0,0],[0,2,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]],
             "output": [[0,0,0,8,0,0,0,0,0],[0,0,0,0,0,4,0,4,0],[0,0,7,0,0,0,2,0,0],[0,7,1,7,0,4,0,4,0],[0,0,7,0,0,0,0,0,0],[0,0,0,0,0,0,7,0,0],[4,0,4,0,0,7,1,7,0],[0,2,0,0,0,0,7,0,0],[4,0,4,0,0,0,0,0,0]]},
        ],
        "test": {"input": [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,0,0],[0,0,2,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,8,0,0,0],[0,0,0,0,0,0,0,0,0],[0,6,0,0,0,0,0,2,0],[0,0,0,0,0,0,0,0,0]],
                 "output": [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,7,0,0],[0,4,0,4,0,7,1,7,0],[0,0,2,0,0,0,7,0,0],[0,4,0,4,0,0,0,0,0],[0,0,0,0,0,8,0,0,0],[0,0,0,0,0,0,4,0,4],[0,6,0,0,0,0,0,2,0],[0,0,0,0,0,0,4,0,4]]},
    },
    # L10: Color blocks by nearest header (10x10) — ddf7fa4f
    {
        "name": "Headers",
        "id": "ddf7fa4f",
        "desc": "Replace grey blocks with the nearest header color",
        "train": [
            {"input": [[0,0,2,0,0,6,0,0,0,8],[0,0,0,0,0,0,0,0,0,0],[0,0,0,0,5,5,5,5,0,0],[0,0,0,0,5,5,5,5,0,0],[0,5,5,0,5,5,5,5,0,0],[0,5,5,0,5,5,5,5,0,0],[0,5,5,0,0,0,0,0,0,0],[0,5,5,0,0,0,0,5,5,5],[0,5,5,0,0,0,0,5,5,5],[0,0,0,0,0,0,0,5,5,5]],
             "output": [[0,0,2,0,0,6,0,0,0,8],[0,0,0,0,0,0,0,0,0,0],[0,0,0,0,6,6,6,6,0,0],[0,0,0,0,6,6,6,6,0,0],[0,2,2,0,6,6,6,6,0,0],[0,2,2,0,6,6,6,6,0,0],[0,2,2,0,0,0,0,0,0,0],[0,2,2,0,0,0,0,8,8,8],[0,2,2,0,0,0,0,8,8,8],[0,0,0,0,0,0,0,8,8,8]]},
            {"input": [[0,1,0,0,0,4,0,0,7,0],[0,0,0,0,0,0,0,0,0,0],[5,5,5,5,0,0,0,5,5,5],[5,5,5,5,0,0,0,5,5,5],[5,5,5,5,0,0,0,5,5,5],[5,5,5,5,0,0,0,5,5,5],[0,0,0,0,0,0,0,0,0,0],[0,0,0,5,5,5,5,0,0,0],[0,0,0,5,5,5,5,0,0,0],[0,0,0,0,0,0,0,0,0,0]],
             "output": [[0,1,0,0,0,4,0,0,7,0],[0,0,0,0,0,0,0,0,0,0],[1,1,1,1,0,0,0,7,7,7],[1,1,1,1,0,0,0,7,7,7],[1,1,1,1,0,0,0,7,7,7],[1,1,1,1,0,0,0,7,7,7],[0,0,0,0,0,0,0,0,0,0],[0,0,0,4,4,4,4,0,0,0],[0,0,0,4,4,4,4,0,0,0],[0,0,0,0,0,0,0,0,0,0]]},
        ],
        "test": {"input": [[3,0,0,0,6,0,0,0,9,0],[0,0,0,0,0,0,0,0,0,0],[0,0,5,5,5,5,5,0,5,5],[0,0,5,5,5,5,5,0,5,5],[0,0,5,5,5,5,5,0,5,5],[0,0,5,5,5,5,5,0,5,5],[0,0,0,0,0,0,0,0,5,5],[5,5,5,5,0,0,0,0,5,5],[5,5,5,5,0,0,0,0,5,5],[0,0,0,0,0,0,0,0,0,0]],
                 "output": [[3,0,0,0,6,0,0,0,9,0],[0,0,0,0,0,0,0,0,0,0],[0,0,6,6,6,6,6,0,9,9],[0,0,6,6,6,6,6,0,9,9],[0,0,6,6,6,6,6,0,9,9],[0,0,6,6,6,6,6,0,9,9],[0,0,0,0,0,0,0,0,9,9],[3,3,3,3,0,0,0,0,9,9],[3,3,3,3,0,0,0,0,9,9],[0,0,0,0,0,0,0,0,0,0]]},
    },
]

# ── Layout constants ────────────────────────────────────────────────────
# Camera viewport is 64x64 pixels.
# Layout:
#   Left area: training example display (scrollable with arrows)
#   Right area: test puzzle input + answer grid + color palette
#
# We use a camera grid of 64x64 and draw everything as sprites.

CELL = 3          # pixels per cell for main grids
PALETTE_CELL = 3  # pixels per palette swatch
GRID_GAP = 1      # gap between grid border and content


def _arc_color(c):
    """Convert ARC color value to engine palette index."""
    return ARC_TO_ENGINE.get(c, 5)


def _make_cell_sprite(name, color, x, y, size=CELL):
    """Create a single-color square sprite."""
    px = [[color] * size for _ in range(size)]
    return Sprite(
        pixels=px,
        name=name,
        visible=True,
        collidable=True,
        tags=[name, "sys_click"],
        layer=2,
        x=x, y=y,
    )


def _make_grid_sprites(grid, prefix, ox, oy, cell_size=CELL, clickable=False):
    """Render a 2D ARC grid as sprites. Returns list of sprites."""
    sprites = []
    rows = len(grid)
    cols = len(grid[0])
    for r in range(rows):
        for c in range(cols):
            color = _arc_color(grid[r][c])
            name = f"{prefix}_{r}_{c}"
            tags = [name]
            if clickable:
                tags.append("sys_click")
            px = [[color] * cell_size for _ in range(cell_size)]
            s = Sprite(
                pixels=px,
                name=name,
                visible=True,
                collidable=True,
                tags=tags,
                layer=2,
                x=ox + c * cell_size,
                y=oy + r * cell_size,
            )
            sprites.append(s)
    return sprites


def _build_level(level_idx):
    """Build a Level for the given puzzle index.

    Layout (64x64 viewport):
    ┌──────────────────────────────────────────────────────────────────┐
    │ Row 0-1: header area (arrows for train nav, tries indicator)    │
    │ Row 2+: left half = train example (in→out, stacked)            │
    │         right half = test input (top) + answer grid (bottom)    │
    │ Bottom row: color palette (10 swatches)                        │
    └──────────────────────────────────────────────────────────────────┘
    """
    puzzle = PUZZLES[level_idx]
    test_in = puzzle["test"]["input"]
    test_out = puzzle["test"]["output"]
    rows = len(test_in)
    cols = len(test_in[0])

    # Determine cell size based on grid dimensions to fit the canvas
    # We need to fit: test input grid + answer grid stacked vertically
    # Plus palette at bottom, plus header at top
    # Available height: ~58 pixels (64 - 3 header - 3 palette)
    # Available width for right side: ~30 pixels
    avail_h = 54  # pixels for grids
    avail_w = 28  # pixels for right half

    # For the answer grid area, compute cell size
    cell = min(avail_w // cols, (avail_h // 2 - 2) // rows, 6)
    cell = max(cell, 2)  # minimum 2px per cell

    # Training example cell size (left half, ~30 px wide)
    train = puzzle["train"][0]
    t_rows_in = len(train["input"])
    t_cols_in = len(train["input"][0])
    t_rows_out = len(train["output"])
    t_cols_out = len(train["output"][0])
    max_t_cols = max(t_cols_in, t_cols_out)
    max_t_rows = t_rows_in + t_rows_out + 1  # +1 for gap
    t_cell = min(28 // max_t_cols, avail_h // max_t_rows, 6)
    t_cell = max(t_cell, 2)

    all_sprites = []

    # ── Left/Right arrows for training example navigation ───────────
    # Left arrow at (0, 0)
    left_arrow = Sprite(
        pixels=[[ENGINE_LGRAY, ENGINE_LGRAY, ENGINE_LGRAY],
                [ENGINE_LGRAY, ENGINE_DGRAY, ENGINE_LGRAY],
                [ENGINE_LGRAY, ENGINE_LGRAY, ENGINE_LGRAY]],
        name="arrow_left",
        visible=True, collidable=True,
        tags=["arrow_left", "sys_click"],
        layer=5, x=0, y=0,
    )
    # Right arrow at (6, 0)
    right_arrow = Sprite(
        pixels=[[ENGINE_LGRAY, ENGINE_LGRAY, ENGINE_LGRAY],
                [ENGINE_LGRAY, ENGINE_DGRAY, ENGINE_LGRAY],
                [ENGINE_LGRAY, ENGINE_LGRAY, ENGINE_LGRAY]],
        name="arrow_right",
        visible=True, collidable=True,
        tags=["arrow_right", "sys_click"],
        layer=5, x=6, y=0,
    )
    all_sprites.extend([left_arrow, right_arrow])

    # ── Submit button (top right) ───────────────────────────────────
    submit_btn = Sprite(
        pixels=[[14, 14, 14, 14, 14],
                [14, 0, 0, 0, 14],
                [14, 14, 14, 14, 14]],
        name="submit",
        visible=True, collidable=True,
        tags=["submit", "sys_click"],
        layer=5, x=55, y=0,
    )
    all_sprites.append(submit_btn)

    # ── Tries indicators (top center-right) ─────────────────────────
    for t_idx in range(2):
        tries_dot = Sprite(
            pixels=[[8, 8], [8, 8]],
            name=f"tries_{t_idx}",
            visible=True, collidable=False,
            tags=[f"tries_{t_idx}"],
            layer=5, x=46 + t_idx * 4, y=0,
        )
        all_sprites.append(tries_dot)

    # ── Divider line ────────────────────────────────────────────────
    div_pixels = [[ENGINE_DGRAY]] * 60
    divider = Sprite(
        pixels=div_pixels,
        name="divider",
        visible=True, collidable=False,
        tags=["divider"],
        layer=1, x=31, y=4,
    )
    all_sprites.append(divider)

    # ── Training examples (left side) ───────────────────────────────
    # We pre-render the first training example. Others are shown via
    # on_set_level and step() by swapping sprite visibility.
    # For simplicity, we create sprites for ALL training examples but
    # only show the current one.
    for ex_idx, example in enumerate(puzzle["train"]):
        visible = (ex_idx == 0)
        in_grid = example["input"]
        out_grid = example["output"]
        in_rows = len(in_grid)
        in_cols = len(in_grid[0])
        out_rows = len(out_grid)
        out_cols = len(out_grid[0])

        # Compute cell size for this example
        ex_max_cols = max(in_cols, out_cols)
        ex_max_rows = in_rows + out_rows + 1
        ex_cell = min(28 // ex_max_cols, 56 // ex_max_rows, 6)
        ex_cell = max(ex_cell, 2)

        # Center horizontally in left half (0-30)
        in_width = in_cols * ex_cell
        out_width = out_cols * ex_cell
        in_ox = max(0, (30 - in_width) // 2)
        out_ox = max(0, (30 - out_width) // 2)

        # Input starts at y=5
        in_oy = 5
        # Arrow/separator between input and output
        sep_y = in_oy + in_rows * ex_cell + 1
        # Output starts after separator
        out_oy = sep_y + 2

        # Create input grid sprites
        for r in range(in_rows):
            for c in range(in_cols):
                color = _arc_color(in_grid[r][c])
                sname = f"train_{ex_idx}_in_{r}_{c}"
                px = [[color] * ex_cell for _ in range(ex_cell)]
                s = Sprite(
                    pixels=px, name=sname,
                    visible=visible, collidable=False,
                    tags=[sname, f"train_{ex_idx}"],
                    layer=2, x=in_ox + c * ex_cell, y=in_oy + r * ex_cell,
                )
                all_sprites.append(s)

        # Separator arrow (small down indicator)
        sep_sprite = Sprite(
            pixels=[[ENGINE_DGRAY, ENGINE_WHITE, ENGINE_DGRAY]],
            name=f"train_{ex_idx}_sep",
            visible=visible, collidable=False,
            tags=[f"train_{ex_idx}_sep", f"train_{ex_idx}"],
            layer=2, x=14, y=sep_y,
        )
        all_sprites.append(sep_sprite)

        # Create output grid sprites
        for r in range(out_rows):
            for c in range(out_cols):
                color = _arc_color(out_grid[r][c])
                sname = f"train_{ex_idx}_out_{r}_{c}"
                px = [[color] * ex_cell for _ in range(ex_cell)]
                s = Sprite(
                    pixels=px, name=sname,
                    visible=visible, collidable=False,
                    tags=[sname, f"train_{ex_idx}"],
                    layer=2, x=out_ox + c * ex_cell, y=out_oy + r * ex_cell,
                )
                all_sprites.append(s)

    # ── Test input (right side, top) ────────────────────────────────
    # Center in right half (33-63)
    test_width = cols * cell
    test_ox = 33 + max(0, (30 - test_width) // 2)
    test_oy = 5
    for r in range(rows):
        for c in range(cols):
            color = _arc_color(test_in[r][c])
            sname = f"test_in_{r}_{c}"
            px = [[color] * cell for _ in range(cell)]
            s = Sprite(
                pixels=px, name=sname,
                visible=True, collidable=False,
                tags=[sname, "test_in"],
                layer=2, x=test_ox + c * cell, y=test_oy + r * cell,
            )
            all_sprites.append(s)

    # Separator between test input and answer
    test_sep_y = test_oy + rows * cell + 1
    test_sep = Sprite(
        pixels=[[ENGINE_DGRAY, ENGINE_WHITE, ENGINE_DGRAY]],
        name="test_sep",
        visible=True, collidable=False,
        tags=["test_sep"],
        layer=2, x=test_ox + test_width // 2 - 1, y=test_sep_y,
    )
    all_sprites.append(test_sep)

    # ── Answer grid (right side, bottom) ────────────────────────────
    ans_oy = test_sep_y + 2
    for r in range(rows):
        for c in range(cols):
            # Start all black (ARC 0)
            color = _arc_color(0)
            sname = f"ans_{r}_{c}"
            px = [[color] * cell for _ in range(cell)]
            s = Sprite(
                pixels=px, name=sname,
                visible=True, collidable=True,
                tags=[sname, "ans_cell", "sys_click"],
                layer=2, x=test_ox + c * cell, y=ans_oy + r * cell,
            )
            all_sprites.append(s)

    # ── Color palette (bottom) ──────────────────────────────────────
    # 10 ARC colors (0-9) as clickable swatches
    pal_y = 60  # near bottom
    pal_ox = 33 + max(0, (30 - 10 * 3) // 2)
    for i in range(10):
        color = _arc_color(i)
        sname = f"pal_{i}"
        px = [[color] * PALETTE_CELL for _ in range(PALETTE_CELL)]
        s = Sprite(
            pixels=px, name=sname,
            visible=True, collidable=True,
            tags=[sname, "palette", "sys_click"],
            layer=3, x=pal_ox + i * 3, y=pal_y,
        )
        all_sprites.append(s)

    # ── Palette selection indicator ─────────────────────────────────
    sel_indicator = Sprite(
        pixels=[[ENGINE_WHITE] * PALETTE_CELL],
        name="pal_sel",
        visible=True, collidable=False,
        tags=["pal_sel"],
        layer=4, x=pal_ox, y=pal_y + PALETTE_CELL,
    )
    all_sprites.append(sel_indicator)

    # ── Result overlay (hidden initially) ───────────────────────────
    # Green check or red X shown after submission
    check_sprite = Sprite(
        pixels=[[14, 5, 14], [5, 14, 5], [14, 5, 14]],
        name="result_ok",
        visible=False, collidable=False,
        tags=["result_ok"],
        layer=10, x=45, y=28,
    )
    cross_sprite = Sprite(
        pixels=[[8, 5, 8], [5, 8, 5], [8, 5, 8]],
        name="result_fail",
        visible=False, collidable=False,
        tags=["result_fail"],
        layer=10, x=45, y=28,
    )
    all_sprites.extend([check_sprite, cross_sprite])

    grid_w = max(cols * cell + 34, 64)
    grid_h = 64

    return Level(
        sprites=all_sprites,
        grid_size=(grid_w, grid_h),
        name=f"Level {level_idx + 1}: {puzzle['name']}",
        data={
            "puzzle_idx": level_idx,
            "rows": rows,
            "cols": cols,
            "cell": cell,
            "test_ox": test_ox,
            "test_oy": test_oy,
            "ans_oy": ans_oy,
            "pal_ox": pal_ox,
            "num_train": len(puzzle["train"]),
        },
    )


# ── Build all 10 levels ────────────────────────────────────────────────
levels = [_build_level(i) for i in range(10)]


class Ac01(ARCBaseGame):
    def __init__(self) -> None:
        self.selected_color = 0  # ARC color index (0-9)
        self.current_train_idx = 0
        self.tries_left = 2
        self.answer_grid = []  # 2D list of ARC color values

        camera = Camera(
            x=0, y=0,
            width=64, height=64,
            background=4,    # charcoal
            letter_box=4,
        )

        super().__init__(
            game_id="ac01",
            levels=levels,
            camera=camera,
            debug=False,
            win_score=1,
            available_actions=[6],  # click-only
        )

    def on_set_level(self, level) -> None:
        puzzle_idx = self.current_level.get_data("puzzle_idx")
        puzzle = PUZZLES[puzzle_idx]
        rows = self.current_level.get_data("rows")
        cols = self.current_level.get_data("cols")

        self.selected_color = 0
        self.current_train_idx = 0
        self.tries_left = 2
        self.answer_grid = [[0] * cols for _ in range(rows)]

        # Reset result overlays
        for s in self.current_level.get_sprites_by_tag("result_ok"):
            s.set_visible(False)
        for s in self.current_level.get_sprites_by_tag("result_fail"):
            s.set_visible(False)

        # Reset tries indicators
        for t in range(2):
            for s in self.current_level.get_sprites_by_tag(f"tries_{t}"):
                s.color_remap(None, 8)  # red = has try

        # Show first training example, hide others
        num_train = self.current_level.get_data("num_train")
        for ex_idx in range(num_train):
            vis = (ex_idx == 0)
            for s in self.current_level.get_sprites_by_tag(f"train_{ex_idx}"):
                s.set_visible(vis)

    def _show_train_example(self, idx):
        """Show training example at index, hide others."""
        num_train = self.current_level.get_data("num_train")
        if idx < 0 or idx >= num_train:
            return
        self.current_train_idx = idx
        for ex_idx in range(num_train):
            vis = (ex_idx == idx)
            for s in self.current_level.get_sprites_by_tag(f"train_{ex_idx}"):
                s.set_visible(vis)

    def _paint_cell(self, r, c, arc_color):
        """Paint an answer cell with the given ARC color."""
        cell = self.current_level.get_data("cell")
        engine_color = _arc_color(arc_color)
        self.answer_grid[r][c] = arc_color

        # Update the sprite pixels
        tag = f"ans_{r}_{c}"
        for s in self.current_level.get_sprites_by_tag(tag):
            s.color_remap(None, engine_color)

    def _update_palette_indicator(self):
        """Move the palette selection indicator under the selected color."""
        pal_ox = self.current_level.get_data("pal_ox")
        for s in self.current_level.get_sprites_by_tag("pal_sel"):
            s.set_position(pal_ox + self.selected_color * 3, 60 + PALETTE_CELL)

    def _check_answer(self):
        """Check if the answer grid matches the expected output."""
        puzzle_idx = self.current_level.get_data("puzzle_idx")
        expected = PUZZLES[puzzle_idx]["test"]["output"]
        return self.answer_grid == expected

    def _use_try(self):
        """Consume a try and update the indicator."""
        idx = 2 - self.tries_left
        self.tries_left -= 1
        for s in self.current_level.get_sprites_by_tag(f"tries_{idx}"):
            s.color_remap(None, ENGINE_DGRAY)

    def step(self) -> None:
        if self.action.id != GameAction.ACTION6:
            self.complete_action()
            return

        x = self.action.data.get("x", 0)
        y = self.action.data.get("y", 0)

        # Find what was clicked by checking sprite tags
        clicked_sprites = []
        for s in self.current_level.get_sprites():
            if not s.is_visible or not s.is_collidable:
                continue
            sx, sy = s.x, s.y
            sw, sh = s.width, s.height
            if sx <= x < sx + sw and sy <= y < sy + sh:
                clicked_sprites.append(s)

        handled = False

        for s in clicked_sprites:
            tag = s.tags[0] if s.tags else ""

            # ── Arrow navigation ────────────────────────────────────
            if tag == "arrow_left":
                self._show_train_example(self.current_train_idx - 1)
                handled = True
                break

            if tag == "arrow_right":
                self._show_train_example(self.current_train_idx + 1)
                handled = True
                break

            # ── Palette selection ───────────────────────────────────
            if tag.startswith("pal_"):
                parts = tag.split("_")
                if len(parts) == 2 and parts[1].isdigit():
                    self.selected_color = int(parts[1])
                    self._update_palette_indicator()
                    handled = True
                    break

            # ── Answer cell painting ────────────────────────────────
            if tag.startswith("ans_"):
                parts = tag.split("_")
                if len(parts) == 3:
                    r, c = int(parts[1]), int(parts[2])
                    self._paint_cell(r, c, self.selected_color)
                    handled = True
                    break

            # ── Submit button ───────────────────────────────────────
            if tag == "submit":
                if self.tries_left <= 0:
                    self.complete_action()
                    return

                if self._check_answer():
                    # Show success
                    for rs in self.current_level.get_sprites_by_tag("result_ok"):
                        rs.set_visible(True)
                    for rs in self.current_level.get_sprites_by_tag("result_fail"):
                        rs.set_visible(False)
                    self._use_try()
                    self.next_level()
                else:
                    self._use_try()
                    if self.tries_left <= 0:
                        # Out of tries — show failure and lose
                        for rs in self.current_level.get_sprites_by_tag("result_fail"):
                            rs.set_visible(True)
                        self.lose()
                    else:
                        # Show brief failure indicator
                        for rs in self.current_level.get_sprites_by_tag("result_fail"):
                            rs.set_visible(True)

                handled = True
                break

        self.complete_action()
