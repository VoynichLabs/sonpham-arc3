import numpy as np
from arcengine import ARCBaseGame, Camera, Level, RenderableUserDisplay

IMG_W, IMG_H = 30, 62
DIV_START, RIGHT_START = 30, 34
HEADER_H = 2
TOLERANCE = 3


def draw_house(img):
    img[:, :] = 9        # sky (blue)
    img[42:, :] = 2      # ground (green)
    img[28:42, 8:22] = 4 # house (yellow)
    img[22:28, 10:20] = 2 # roof (green)
    img[24:28, 12:18] = 7 # roof accent (orange)
    img[30:38, 12:16] = 0 # window left (black)
    img[30:38, 16:20] = 0 # window right (black)
    img[35:42, 14:18] = 6 # door (magenta)
    img[28:42, 23:27] = 3 # tree trunk (dark)
    img[20:30, 21:29] = 2 # tree leaves (green)
    img[2:6, 24:28] = 11  # sun (yellow)


def draw_ocean(img):
    img[:, :] = 9        # water (blue)
    img[50:, :] = 11     # sandy bottom (yellow)
    img[55:, :] = 4      # deep sand (orange-ish yellow4)
    img[30:38, 5:14] = 12 # fish 1 (red)
    img[32:36, 14:16] = 12
    img[20:28, 18:27] = 6 # fish 2 (magenta)
    img[22:26, 27:29] = 6
    img[45:55, 3:6] = 2  # seaweed (green)
    img[40:55, 8:11] = 2
    img[48:58, 22:25] = 14 # coral (lime)
    img[50:60, 15:18] = 14
    img[15:18, 10:12] = 0 # bubbles (black dots)
    img[10:13, 20:22] = 0


def draw_space(img):
    img[:, :] = 0        # black sky
    for sy, sx in [(5,5),(8,25),(12,15),(3,20),(18,8),(6,28),(15,2),(20,27)]:
        img[sy:sy+1, sx:sx+1] = 15  # stars (white)
    img[25:40, 10:25] = 8  # planet (azure)
    img[28:37, 13:22] = 9  # planet surface
    img[24:26, 5:30] = 3   # planet ring
    img[5:20, 22:27] = 5   # rocket body (gray)
    img[3:5, 23:26] = 12   # rocket tip (red)
    img[20:23, 21:23] = 7  # rocket flame left (orange)
    img[20:23, 25:27] = 7  # rocket flame right
    img[45:55, 2:14] = 15  # moon (white)
    img[47:53, 4:12] = 3   # moon shadow (dark gray)


def draw_forest(img):
    img[:, :] = 9        # sky (blue)
    img[45:, :] = 2      # ground (green)
    img[25:45, 2:8] = 3  # tree trunk 1
    img[10:26, 0:12] = 2 # tree 1 canopy
    img[28:45, 20:26] = 3 # tree trunk 2
    img[12:29, 17:29] = 2 # tree 2 canopy
    img[38:45, 14:17] = 7  # mushroom stem (orange)
    img[34:39, 12:20] = 12 # mushroom cap (red)
    img[42:45, 10:13] = 11 # flower 1 (yellow)
    img[42:45, 25:28] = 14 # flower 2 (lime)
    img[48:62, 6:20] = 9  # river (blue)
    img[2:5, 20:26] = 11  # sun (yellow)


def draw_city(img):
    img[:, :] = 9        # sky (blue)
    img[50:, :] = 3      # road (dark gray)
    img[25:50, 2:14] = 3  # building 1 (dark gray)
    img[15:50, 16:28] = 3  # building 2 (dark gray)
    for wy in range(27, 49, 6):
        img[wy:wy+4, 4:7] = 11   # windows b1 (yellow)
        img[wy:wy+4, 9:12] = 11
    for wy in range(17, 49, 6):
        img[wy:wy+4, 18:21] = 11 # windows b2 (yellow)
        img[wy:wy+4, 23:26] = 11
    img[53:60, 3:12] = 12  # car (red)
    img[54:58, 12:14] = 12
    img[4:10, 5:15] = 15   # cloud 1 (white)
    img[3:8, 20:28] = 15   # cloud 2 (white)


SCENES = [draw_house, draw_ocean, draw_space, draw_forest, draw_city]

DIFFS = [
    [(9, 25, 12), (26, 5, 12), (14, 35, 9), (15, 55, 12), (15, 16, 8)],   # L1: was (15,55,2) same as ground
    [(14, 28, 6), (24, 12, 12), (5, 50, 12), (20, 57, 8), (15, 18, 11)],
    [(15, 20, 8), (27, 5, 11), (5, 40, 12), (20, 50, 9), (10, 10, 9)],
    [(5, 30, 8), (15, 52, 8), (25, 8, 12), (10, 45, 12), (20, 35, 11)],   # L4: was (25,8,9) same as sky
    [(10, 30, 12), (20, 50, 9), (5, 10, 12), (26, 20, 8), (15, 5, 11)],   # L5: was (5,10,9) same as sky
]

levels = [
    Level(sprites=[], grid_size=(64, 64), data={"i": i}, name=f"Level {i+1}")
    for i in range(5)
]


class FdDisplay(RenderableUserDisplay):
    def __init__(self, game: "Fd01"):
        self.game = game

    def render_interface(self, frame: np.ndarray) -> np.ndarray:
        g = self.game
        # Left panel
        frame[HEADER_H:, :IMG_W] = g.base_img
        # Blue divider
        frame[HEADER_H:, DIV_START:RIGHT_START] = 9
        # Right panel: copy base then apply diffs
        frame[HEADER_H:, RIGHT_START:RIGHT_START + IMG_W] = g.base_img
        for dx, dy, rc in g.diffs:
            r0 = HEADER_H + max(0, dy - 1)
            r1 = HEADER_H + min(IMG_H, dy + 3)
            c0l = max(0, dx - 1)
            c1l = min(IMG_W, dx + 3)
            c0r = RIGHT_START + c0l
            c1r = RIGHT_START + c1l
            frame[r0:r1, c0r:c1r] = rc
        # Green outlines for found diffs
        for i, (dx, dy, rc) in enumerate(g.diffs):
            if g.found[i]:
                for panel_x in [dx, RIGHT_START + dx]:
                    fr = HEADER_H + dy
                    # top/bottom border rows
                    for row in [max(HEADER_H, fr - 2), min(63, fr + 3)]:
                        c0 = max(0, panel_x - 2)
                        c1 = min(63, panel_x + 4)
                        frame[row, c0:c1] = 14
                    # left/right border cols
                    r0 = max(HEADER_H, fr - 2)
                    r1 = min(64, fr + 4)
                    for col in [max(0, panel_x - 2), min(63, panel_x + 3)]:
                        frame[r0:r1, col] = 14
        # Progress bar: rows 0-1, 5 segments of 12px each (with 2px gap)
        for seg in range(5):
            color = 11 if g.found[seg] else 3
            c0 = seg * 13
            c1 = c0 + 11
            frame[0:2, c0:c1] = color
        return frame


class Fd01(ARCBaseGame):
    def __init__(self):
        self.display = FdDisplay(self)
        self.base_img = np.zeros((IMG_H, IMG_W), dtype=np.int16)
        self.diffs = DIFFS[0]
        self.found = [False] * 5
        super().__init__(
            "fd01",
            levels,
            Camera(0, 0, 64, 64, 0, 0, [self.display]),
            False,
            1,
            [6],
        )

    def on_set_level(self, level: Level) -> None:
        i = self.level_index
        self.base_img = np.zeros((IMG_H, IMG_W), dtype=np.int16)
        SCENES[i](self.base_img)
        self.diffs = DIFFS[i]
        self.found = [False] * 5

    def step(self) -> None:
        if self.action.id.value == 6:
            cx = self.action.data.get("x", 0)
            cy = self.action.data.get("y", 0)
            iy = cy - HEADER_H
            if cy >= HEADER_H and iy < IMG_H:
                if cx < IMG_W:
                    ix = cx
                elif RIGHT_START <= cx < RIGHT_START + IMG_W:
                    ix = cx - RIGHT_START
                else:
                    self.complete_action()
                    return
                for i, (dx, dy, _) in enumerate(self.diffs):
                    if not self.found[i] and abs(ix - dx) <= TOLERANCE and abs(iy - dy) <= TOLERANCE:
                        self.found[i] = True
                        break
                if all(self.found):
                    self.next_level()
        self.complete_action()
