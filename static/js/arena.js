// Author: Claude Opus 4.6
// Date: 2026-03-14 09:30
// PURPOSE: ARC Arena — Agent vs Agent game engine, AI strategies, match runner,
//   and UI controller. Manages the three-column layout with side panels (agent
//   settings → observatory logs) and center panel (game selection → match canvas).
//   Currently implements Snake Battle as the first AI vs AI game.
// SRP/DRY check: Pass — self-contained arena module, no overlap with main app JS

/* ═══════════════════════════════════════════════════════════════════════════
   ARC3 Color Palette & Constants
   ═══════════════════════════════════════════════════════════════════════════ */

const ARC3 = [
  '#FFFFFF', '#CCCCCC', '#999999', '#666666', '#333333', '#000000',
  '#E53AA3', '#FF7BCC', '#F93C31', '#1E93FF', '#88D8F1', '#FFDC00',
  '#FF851B', '#921231', '#4FCC30', '#A356D6'
];

const C = {
  BG: 5, WALL: 3, FOOD: 11,
  A_HEAD: 9, A_BODY: 10,
  B_HEAD: 8, B_BODY: 12,
};

const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
const DIR_NAME = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const OPPOSITE = [2, 3, 0, 1];

function mulberry32(seed) {
  let a = seed | 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}


/* ═══════════════════════════════════════════════════════════════════════════
   Snake Game Engine
   ═══════════════════════════════════════════════════════════════════════════ */

class SnakeGame {
  constructor(config = {}) {
    this.W = config.width || 20;
    this.H = config.height || 20;
    this.maxTurns = config.maxTurns || 200;
    this.seed = config.seed || 42;
    this.rng = mulberry32(this.seed);
    this.turn = 0;
    this.over = false;
    this.winner = null;

    const midY = this.H >> 1;
    this.snakeA = {
      body: [[4, midY], [3, midY], [2, midY]],
      dir: DIR.RIGHT, alive: true, score: 0,
    };
    this.snakeB = {
      body: [[this.W - 5, midY], [this.W - 4, midY], [this.W - 3, midY]],
      dir: DIR.LEFT, alive: true, score: 0,
    };
    this.food = this._spawnFood();
  }

  _spawnFood() {
    const occupied = new Set();
    for (const [x, y] of this.snakeA.body) occupied.add(`${x},${y}`);
    for (const [x, y] of this.snakeB.body) occupied.add(`${x},${y}`);
    const cands = [];
    for (let y = 1; y < this.H - 1; y++)
      for (let x = 1; x < this.W - 1; x++)
        if (!occupied.has(`${x},${y}`)) cands.push([x, y]);
    if (!cands.length) return null;
    return cands[Math.floor(this.rng() * cands.length)];
  }

  getGrid() {
    const grid = Array.from({ length: this.H }, () => Array(this.W).fill(C.BG));
    for (let x = 0; x < this.W; x++) { grid[0][x] = C.WALL; grid[this.H - 1][x] = C.WALL; }
    for (let y = 0; y < this.H; y++) { grid[y][0] = C.WALL; grid[y][this.W - 1] = C.WALL; }
    if (this.food) grid[this.food[1]][this.food[0]] = C.FOOD;
    const drawSnake = (snake, headColor, bodyColor) => {
      if (!snake.alive) return;
      for (let i = snake.body.length - 1; i >= 1; i--)
        grid[snake.body[i][1]][snake.body[i][0]] = bodyColor;
      grid[snake.body[0][1]][snake.body[0][0]] = headColor;
    };
    drawSnake(this.snakeA, C.A_HEAD, C.A_BODY);
    drawSnake(this.snakeB, C.B_HEAD, C.B_BODY);
    return grid;
  }

  getAIState() {
    const snap = s => ({
      head: [...s.body[0]], body: s.body.map(p => [...p]),
      dir: s.dir, alive: s.alive, score: s.score, length: s.body.length,
    });
    return {
      width: this.W, height: this.H, turn: this.turn, maxTurns: this.maxTurns,
      food: this.food ? [...this.food] : null,
      snakeA: snap(this.snakeA), snakeB: snap(this.snakeB),
    };
  }

  step(moveA, moveB) {
    if (this.over) return;
    this.turn++;

    // Prevent 180-degree reversal
    if (moveA === OPPOSITE[this.snakeA.dir]) moveA = this.snakeA.dir;
    if (moveB === OPPOSITE[this.snakeB.dir]) moveB = this.snakeB.dir;
    this.snakeA.dir = moveA;
    this.snakeB.dir = moveB;

    const [ax, ay] = this.snakeA.body[0];
    const nax = ax + DX[moveA], nay = ay + DY[moveA];
    const [bx, by] = this.snakeB.body[0];
    const nbx = bx + DX[moveB], nby = by + DY[moveB];

    let aDead = false, bDead = false;

    // Wall collision
    if (nax <= 0 || nax >= this.W - 1 || nay <= 0 || nay >= this.H - 1) aDead = true;
    if (nbx <= 0 || nbx >= this.W - 1 || nby <= 0 || nby >= this.H - 1) bDead = true;

    // Head-on collision
    if (nax === nbx && nay === nby) { aDead = true; bDead = true; }

    // Body collisions (self + opponent)
    const inBody = (x, y, body) => body.some(([px, py]) => px === x && py === y);
    if (inBody(nax, nay, this.snakeA.body)) aDead = true;
    if (inBody(nax, nay, this.snakeB.body)) aDead = true;
    if (inBody(nbx, nby, this.snakeB.body)) bDead = true;
    if (inBody(nbx, nby, this.snakeA.body)) bDead = true;

    if (aDead) this.snakeA.alive = false;
    if (bDead) this.snakeB.alive = false;

    let ateA = false, ateB = false;
    if (this.snakeA.alive) {
      this.snakeA.body.unshift([nax, nay]);
      if (this.food && nax === this.food[0] && nay === this.food[1]) {
        ateA = true; this.snakeA.score++;
      } else this.snakeA.body.pop();
    }
    if (this.snakeB.alive) {
      this.snakeB.body.unshift([nbx, nby]);
      if (this.food && nbx === this.food[0] && nby === this.food[1]) {
        ateB = true; this.snakeB.score++;
      } else this.snakeB.body.pop();
    }
    if (ateA || ateB) this.food = this._spawnFood();

    // Determine winner
    if (!this.snakeA.alive && !this.snakeB.alive) { this.over = true; this.winner = 'draw'; }
    else if (!this.snakeA.alive) { this.over = true; this.winner = 'B'; }
    else if (!this.snakeB.alive) { this.over = true; this.winner = 'A'; }
    else if (this.turn >= this.maxTurns) {
      this.over = true;
      if (this.snakeA.score > this.snakeB.score) this.winner = 'A';
      else if (this.snakeB.score > this.snakeA.score) this.winner = 'B';
      else this.winner = 'draw';
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   AI Strategies
   ═══════════════════════════════════════════════════════════════════════════ */

function manhattan(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }

function isSafe(x, y, state, me, other) {
  if (x <= 0 || x >= state.width - 1 || y <= 0 || y >= state.height - 1) return false;
  for (const [bx, by] of me.body) if (bx === x && by === y) return false;
  for (const [bx, by] of other.body) if (bx === x && by === y) return false;
  return true;
}

function floodFill(startX, startY, state, me, other, limit) {
  let count = 0;
  const visited = new Set([`${startX},${startY}`]);
  const queue = [[startX, startY]];
  while (queue.length && count < limit) {
    const [cx, cy] = queue.shift();
    count++;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      const key = `${nx},${ny}`;
      if (!visited.has(key) && isSafe(nx, ny, state, me, other)) {
        visited.add(key); queue.push([nx, ny]);
      }
    }
  }
  return count;
}

function evaluateMoves(state, player) {
  const me = player === 'A' ? state.snakeA : state.snakeB;
  const other = player === 'A' ? state.snakeB : state.snakeA;
  const [hx, hy] = me.head;
  const moves = [];
  for (let d = 0; d < 4; d++) {
    const nx = hx + DX[d], ny = hy + DY[d];
    const safe = isSafe(nx, ny, state, me, other);
    const foodDist = state.food ? manhattan([nx, ny], state.food) : 999;
    const oppDist = manhattan([nx, ny], other.head);
    const space = safe ? floodFill(nx, ny, state, me, other, 40) : 0;
    moves.push({ dir: d, safe, foodDist, oppDist, space, nx, ny });
  }
  return { moves, me, other };
}

// Greedy: chase food, avoid walls
function greedyAI(state, player) {
  const { moves, me } = evaluateMoves(state, player);
  const lines = moves.map(m =>
    `  ${DIR_NAME[m.dir]}: ${m.safe ? `safe, food ${m.foodDist}` : 'BLOCKED'}`
  );
  const safe = moves.filter(m => m.safe);
  if (!safe.length) {
    return { move: me.dir, reasoning: lines.join('\n') + `\nTrapped! Going ${DIR_NAME[me.dir]}` };
  }
  safe.sort((a, b) => a.foodDist - b.foodDist);
  return {
    move: safe[0].dir,
    reasoning: lines.join('\n') + `\n=> ${DIR_NAME[safe[0].dir]} (nearest food)`,
  };
}

// Aggressive: hunt opponent when longer, feed when shorter
function aggressiveAI(state, player) {
  const { moves, me, other } = evaluateMoves(state, player);
  const lines = moves.map(m =>
    `  ${DIR_NAME[m.dir]}: ${m.safe ? `safe, food ${m.foodDist}, opp ${m.oppDist}` : 'BLOCKED'}`
  );
  const safe = moves.filter(m => m.safe);
  if (!safe.length) {
    return { move: me.dir, reasoning: lines.join('\n') + `\nTrapped!` };
  }
  const hunt = me.length > other.length;
  if (hunt) {
    safe.sort((a, b) => a.oppDist - b.oppDist);
    return {
      move: safe[0].dir,
      reasoning: `HUNT mode (len ${me.length} vs ${other.length})\n` +
        lines.join('\n') + `\n=> ${DIR_NAME[safe[0].dir]} (chase opponent)`,
    };
  }
  safe.sort((a, b) => a.foodDist - b.foodDist);
  return {
    move: safe[0].dir,
    reasoning: `FEED mode (len ${me.length} vs ${other.length})\n` +
      lines.join('\n') + `\n=> ${DIR_NAME[safe[0].dir]} (nearest food)`,
  };
}

// Cautious: prefer open space, avoid traps
function cautiousAI(state, player) {
  const { moves, me } = evaluateMoves(state, player);
  const lines = moves.map(m =>
    `  ${DIR_NAME[m.dir]}: ${m.safe ? `safe, food ${m.foodDist}, space ${m.space}` : 'BLOCKED'}`
  );
  const safe = moves.filter(m => m.safe);
  if (!safe.length) {
    return { move: me.dir, reasoning: lines.join('\n') + `\nTrapped!` };
  }
  safe.sort((a, b) => {
    if (b.space !== a.space) return b.space - a.space;
    return a.foodDist - b.foodDist;
  });
  return {
    move: safe[0].dir,
    reasoning: `CAUTIOUS (prefer space)\n` +
      lines.join('\n') + `\n=> ${DIR_NAME[safe[0].dir]} (space ${safe[0].space})`,
  };
}

const AI_STRATEGIES = {
  greedy:     { name: 'Greedy',     fn: greedyAI,     desc: 'Chases food directly',
                personality: { aggression: 20, caution: 40, greed: 90 } },
  aggressive: { name: 'Aggressive', fn: aggressiveAI, desc: 'Hunts when longer, feeds when shorter',
                personality: { aggression: 80, caution: 30, greed: 50 } },
  cautious:   { name: 'Cautious',   fn: cautiousAI,   desc: 'Prefers open spaces, avoids traps',
                personality: { aggression: 10, caution: 95, greed: 40 } },
};


/* ═══════════════════════════════════════════════════════════════════════════
   Chess960 (Fischer Random) Game Engine
   ═══════════════════════════════════════════════════════════════════════════ */

const KING = 1, QUEEN = 2, ROOK = 3, BISHOP = 4, KNIGHT = 5, PAWN = 6;
const PIECE_CHAR = { [KING]:'K',[QUEEN]:'Q',[ROOK]:'R',[BISHOP]:'B',[KNIGHT]:'N',[PAWN]:'' };
const PIECE_UNICODE = {
  1:'\u2654', 2:'\u2655', 3:'\u2656', 4:'\u2657', 5:'\u2658', 6:'\u2659',
  [-1]:'\u265A', [-2]:'\u265B', [-3]:'\u265C', [-4]:'\u265D', [-5]:'\u265E', [-6]:'\u265F',
};
const PIECE_VAL = { [KING]:20000,[QUEEN]:900,[ROOK]:500,[BISHOP]:330,[KNIGHT]:320,[PAWN]:100 };

// Piece-square tables (white perspective, index = row*8+col, row 0 = rank 8)
const PST_PAWN = [0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0];
const PST_KNIGHT = [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50];
const PST_BISHOP = [-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,10,10,10,10,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20];
const PST_ROOK = [0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0];
const PST_QUEEN = [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20];
const PST_KING = [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20];
const PST = { [PAWN]:PST_PAWN,[KNIGHT]:PST_KNIGHT,[BISHOP]:PST_BISHOP,[ROOK]:PST_ROOK,[QUEEN]:PST_QUEEN,[KING]:PST_KING };

const KNIGHT_OFFSETS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_OFFSETS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIAG_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const STRAIGHT_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

function sqName(r, c) { return String.fromCharCode(97 + c) + (8 - r); }

class ChessGame {
  constructor(config = {}) {
    this.board = Array.from({length: 8}, () => Array(8).fill(0));
    this.turn = 'w';
    this.ply = 0;
    this.maxPly = (config.maxMoves || 80) * 2;
    this.over = false;
    this.winner = null;
    this.lastMove = null;
    this.enPassant = null;
    this.halfmoveClock = 0;
    this._setupFischerRandom(config.seed || 42);
  }

  _setupFischerRandom(seed) {
    const rng = mulberry32(seed);
    const rank = Array(8).fill(0);
    // Bishops on opposite-colored squares
    const light = [0,2,4,6], dark = [1,3,5,7];
    rank[light[Math.floor(rng()*4)]] = BISHOP;
    rank[dark[Math.floor(rng()*4)]] = BISHOP;
    // Queen on a remaining square
    let rem = []; for (let i=0;i<8;i++) if(!rank[i]) rem.push(i);
    let idx = Math.floor(rng()*rem.length);
    rank[rem[idx]] = QUEEN; rem.splice(idx,1);
    // Two knights
    idx = Math.floor(rng()*rem.length); rank[rem[idx]] = KNIGHT; rem.splice(idx,1);
    idx = Math.floor(rng()*rem.length); rank[rem[idx]] = KNIGHT; rem.splice(idx,1);
    // Remaining 3: Rook, King, Rook (king between rooks)
    rank[rem[0]] = ROOK; rank[rem[1]] = KING; rank[rem[2]] = ROOK;
    // Place on board
    for (let c = 0; c < 8; c++) {
      this.board[7][c] = rank[c];       // white back rank
      this.board[6][c] = PAWN;           // white pawns
      this.board[0][c] = -rank[c];       // black back rank
      this.board[1][c] = -PAWN;          // black pawns
    }
  }

  getBoard() { return this.board.map(r => [...r]); }

  _pseudoLegalMoves() {
    const moves = [];
    const sign = this.turn === 'w' ? 1 : -1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p * sign <= 0) continue;
        const t = Math.abs(p);
        if (t === PAWN) {
          const dir = sign > 0 ? -1 : 1;
          const startRow = sign > 0 ? 6 : 1;
          const promoRow = sign > 0 ? 0 : 7;
          const nr = r + dir;
          if (nr >= 0 && nr < 8 && this.board[nr][c] === 0) {
            if (nr === promoRow) moves.push({f:[r,c],t:[nr,c],pr:QUEEN});
            else {
              moves.push({f:[r,c],t:[nr,c],pr:null});
              if (r === startRow && this.board[r+2*dir][c] === 0)
                moves.push({f:[r,c],t:[r+2*dir,c],pr:null});
            }
          }
          for (const dc of [-1,1]) {
            const nc = c+dc;
            if (nc<0||nc>=8) continue;
            if (this.board[nr][nc]*sign < 0) {
              moves.push({f:[r,c],t:[nr,nc],pr:nr===promoRow?QUEEN:null});
            }
            if (this.enPassant && this.enPassant[0]===nr && this.enPassant[1]===nc) {
              moves.push({f:[r,c],t:[nr,nc],pr:null,ep:true});
            }
          }
        }
        if (t === KNIGHT) {
          for (const [dr,dc] of KNIGHT_OFFSETS) {
            const nr=r+dr,nc=c+dc;
            if (nr<0||nr>=8||nc<0||nc>=8||this.board[nr][nc]*sign>0) continue;
            moves.push({f:[r,c],t:[nr,nc],pr:null});
          }
        }
        if (t === BISHOP || t === QUEEN) {
          for (const [dr,dc] of DIAG_DIRS) this._slide(r,c,dr,dc,sign,moves);
        }
        if (t === ROOK || t === QUEEN) {
          for (const [dr,dc] of STRAIGHT_DIRS) this._slide(r,c,dr,dc,sign,moves);
        }
        if (t === KING) {
          for (const [dr,dc] of KING_OFFSETS) {
            const nr=r+dr,nc=c+dc;
            if (nr<0||nr>=8||nc<0||nc>=8||this.board[nr][nc]*sign>0) continue;
            moves.push({f:[r,c],t:[nr,nc],pr:null});
          }
        }
      }
    }
    return moves;
  }

  _slide(r,c,dr,dc,sign,moves) {
    let nr=r+dr,nc=c+dc;
    while (nr>=0&&nr<8&&nc>=0&&nc<8) {
      if (this.board[nr][nc]*sign > 0) break;
      moves.push({f:[r,c],t:[nr,nc],pr:null});
      if (this.board[nr][nc] !== 0) break;
      nr+=dr; nc+=dc;
    }
  }

  _isAttacked(r, c, byColor) {
    const s = byColor === 'w' ? 1 : -1;
    // Knights
    for (const [dr,dc] of KNIGHT_OFFSETS) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<8&&nc>=0&&nc<8&&this.board[nr][nc]===s*KNIGHT) return true;
    }
    // Pawns (attack FROM byColor's perspective)
    const pd = byColor === 'w' ? 1 : -1;
    for (const dc of [-1,1]) {
      const pr=r+pd,pc=c+dc;
      if (pr>=0&&pr<8&&pc>=0&&pc<8&&this.board[pr][pc]===s*PAWN) return true;
    }
    // King
    for (const [dr,dc] of KING_OFFSETS) {
      const nr=r+dr,nc=c+dc;
      if (nr>=0&&nr<8&&nc>=0&&nc<8&&this.board[nr][nc]===s*KING) return true;
    }
    // Diagonal (bishop/queen)
    for (const [dr,dc] of DIAG_DIRS) {
      let nr=r+dr,nc=c+dc;
      while (nr>=0&&nr<8&&nc>=0&&nc<8) {
        const p=this.board[nr][nc];
        if (p!==0) { if (p===s*BISHOP||p===s*QUEEN) return true; break; }
        nr+=dr;nc+=dc;
      }
    }
    // Straight (rook/queen)
    for (const [dr,dc] of STRAIGHT_DIRS) {
      let nr=r+dr,nc=c+dc;
      while (nr>=0&&nr<8&&nc>=0&&nc<8) {
        const p=this.board[nr][nc];
        if (p!==0) { if (p===s*ROOK||p===s*QUEEN) return true; break; }
        nr+=dr;nc+=dc;
      }
    }
    return false;
  }

  _isInCheck(color) {
    const kp = color === 'w' ? KING : -KING;
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (this.board[r][c]===kp) {
      return this._isAttacked(r, c, color === 'w' ? 'b' : 'w');
    }
    return true;
  }

  makeMove(move) {
    const saved = {
      cap: this.board[move.t[0]][move.t[1]],
      ep: this.enPassant ? [...this.enPassant] : null,
      hc: this.halfmoveClock,
    };
    const [fr,fc] = move.f, [tr,tc] = move.t;
    const piece = this.board[fr][fc];
    const sgn = piece > 0 ? 1 : -1;
    const apt = Math.abs(piece);
    this.halfmoveClock = (apt === PAWN || this.board[tr][tc] !== 0) ? 0 : this.halfmoveClock + 1;
    if (move.ep) this.board[fr][tc] = 0;
    this.enPassant = (apt === PAWN && Math.abs(fr-tr) === 2) ? [(fr+tr)/2, fc] : null;
    this.board[tr][tc] = move.pr ? sgn * move.pr : piece;
    this.board[fr][fc] = 0;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.ply++;
    return saved;
  }

  unmakeMove(move, saved) {
    const [fr,fc] = move.f, [tr,tc] = move.t;
    const piece = this.board[tr][tc];
    const sgn = piece > 0 ? 1 : -1;
    this.board[fr][fc] = move.pr ? sgn * PAWN : piece;
    this.board[tr][tc] = saved.cap;
    if (move.ep) this.board[fr][tc] = -sgn * PAWN;
    this.enPassant = saved.ep;
    this.halfmoveClock = saved.hc;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.ply--;
  }

  getLegalMoves() {
    const pseudo = this._pseudoLegalMoves();
    const legal = [];
    const movingColor = this.turn;
    for (const m of pseudo) {
      const s = this.makeMove(m);
      if (!this._isInCheck(movingColor)) legal.push(m);
      this.unmakeMove(m, s);
    }
    return legal;
  }
}

function chessMoveNotation(board, move) {
  const piece = board[move.f[0]][move.f[1]];
  const t = Math.abs(piece);
  const cap = board[move.t[0]][move.t[1]] !== 0 || move.ep;
  const dest = sqName(move.t[0], move.t[1]);
  if (t === PAWN) {
    let n = cap ? sqName(move.f[0],move.f[1])[0]+'x'+dest : dest;
    if (move.pr) n += '=Q';
    return n;
  }
  return PIECE_CHAR[t] + (cap ? 'x' : '') + dest;
}


/* ═══════════════════════════════════════════════════════════════════════════
   Chess AI
   ═══════════════════════════════════════════════════════════════════════════ */

function chessEval(game) {
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = game.board[r][c];
    if (p === 0) continue;
    const t = Math.abs(p), sgn = p > 0 ? 1 : -1;
    const pstIdx = sgn > 0 ? r*8+c : (7-r)*8+c;
    score += sgn * (PIECE_VAL[t] + (PST[t] ? PST[t][pstIdx] : 0));
  }
  return score;
}

function chessMinimax(game, depth, alpha, beta, maximizing) {
  if (depth === 0) return chessEval(game);
  const moves = game.getLegalMoves();
  if (moves.length === 0) {
    return game._isInCheck(game.turn) ? (maximizing ? -99999 : 99999) : 0;
  }
  // Order: captures first for better pruning
  moves.sort((a, b) => {
    const ca = game.board[a.t[0]][a.t[1]] !== 0 ? 1 : 0;
    const cb = game.board[b.t[0]][b.t[1]] !== 0 ? 1 : 0;
    return cb - ca;
  });
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const s = game.makeMove(m);
      best = Math.max(best, chessMinimax(game, depth-1, alpha, beta, false));
      game.unmakeMove(m, s);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const s = game.makeMove(m);
      best = Math.min(best, chessMinimax(game, depth-1, alpha, beta, true));
      game.unmakeMove(m, s);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function chessAI(game, depth) {
  const moves = game.getLegalMoves();
  if (!moves.length) return null;
  const maximizing = game.turn === 'w';
  const candidates = [];
  for (const m of moves) {
    const notation = chessMoveNotation(game.board, m);
    const s = game.makeMove(m);
    const score = chessMinimax(game, depth-1, -Infinity, Infinity, !maximizing);
    game.unmakeMove(m, s);
    candidates.push({ move: m, score, notation });
  }
  candidates.sort((a,b) => maximizing ? b.score-a.score : a.score-b.score);
  const best = candidates[0];
  const top = candidates.slice(0, 3);
  const lines = top.map((c,i) =>
    `  ${i+1}. ${c.notation}: ${c.score>0?'+':''}${c.score}`
  );
  return {
    move: best.move,
    notation: best.notation,
    reasoning: `Depth ${depth} search\n${lines.join('\n')}\n=> ${best.notation} (${best.score>0?'+':''}${best.score})`,
  };
}

function chessTacticianAI(game) { return chessAI(game, 3); }
function chessPositionalAI(game) { return chessAI(game, 2); }

const CHESS_STRATEGIES = {
  tactician:  { name: 'Tactician',  fn: chessTacticianAI, desc: 'Deep search (depth 3), finds combinations',
                personality: { aggression: 70, caution: 40, greed: 60 } },
  positional: { name: 'Positional', fn: chessPositionalAI, desc: 'Balanced search (depth 2), solid play',
                personality: { aggression: 30, caution: 70, greed: 40 } },
};


/* ═══════════════════════════════════════════════════════════════════════════
   Chess Rendering
   ═══════════════════════════════════════════════════════════════════════════ */

function renderChessFrame(ctx, frame, size) {
  const sq = size / 8;
  const board = frame.board;
  const lm = frame.lastMove; // [fr,fc,tr,tc] or null

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = (r + c) % 2 === 0;
      let highlight = lm && ((r===lm[0]&&c===lm[1])||(r===lm[2]&&c===lm[3]));
      ctx.fillStyle = highlight
        ? (isLight ? '#F6F669' : '#BACA2B')
        : (isLight ? ARC3[0] : ARC3[2]);
      ctx.fillRect(c*sq, r*sq, sq, sq);

      const piece = board[r][c];
      if (piece !== 0) {
        const ch = PIECE_UNICODE[piece];
        ctx.font = `${sq * 0.78}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Shadow for contrast
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillText(ch, c*sq+sq/2+1, r*sq+sq/2+1);
        // Piece
        ctx.fillStyle = piece > 0 ? '#FFFFFF' : '#111111';
        ctx.fillText(ch, c*sq+sq/2, r*sq+sq/2);
      }
    }
  }
  // File/rank labels
  ctx.font = `bold ${sq*0.18}px monospace`;
  ctx.textBaseline = 'bottom';
  for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (7+c)%2===0 ? ARC3[2] : ARC3[0];
    ctx.textAlign = 'left';
    ctx.fillText(String.fromCharCode(97+c), c*sq+2, size-2);
  }
  ctx.textBaseline = 'top';
  for (let r = 0; r < 8; r++) {
    ctx.fillStyle = (r)%2===0 ? ARC3[2] : ARC3[0];
    ctx.textAlign = 'right';
    ctx.fillText(String(8-r), sq-2, r*sq+2);
  }
}

function renderChessPreview(canvas, config) {
  const game = new ChessGame(config);
  const board = game.getBoard();
  const size = 120;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const sq = size / 8;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r+c)%2===0 ? ARC3[0] : ARC3[2];
    ctx.fillRect(c*sq, r*sq, sq, sq);
    const p = board[r][c];
    if (p !== 0) {
      ctx.font = `${sq*0.75}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = p > 0 ? '#FFFFFF' : '#111111';
      ctx.fillText(PIECE_UNICODE[p], c*sq+sq/2, r*sq+sq/2);
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   Chess Match Runner (turn-based: alternating white/black)
   ═══════════════════════════════════════════════════════════════════════════ */

function runChessMatch(config, strategyA, strategyB) {
  const game = new ChessGame(config);
  const fnW = CHESS_STRATEGIES[strategyA].fn;
  const fnB = CHESS_STRATEGIES[strategyB].fn;
  const history = [];

  history.push({
    turn: 0, board: game.getBoard(), lastMove: null,
    agentA: null, agentB: null, winner: null,
    scoreA: 0, scoreB: 0,
  });

  while (!game.over) {
    const isWhite = game.turn === 'w';
    const fn = isWhite ? fnW : fnB;
    const result = fn(game);

    if (!result) {
      game.over = true;
      game.winner = game._isInCheck(game.turn) ? (isWhite ? 'B' : 'A') : 'draw';
    } else {
      const notation = result.notation;
      game.makeMove(result.move);
      game.lastMove = [result.move.f[0], result.move.f[1], result.move.t[0], result.move.t[1]];

      // Check end conditions
      const opponentMoves = game.getLegalMoves();
      if (opponentMoves.length === 0) {
        game.over = true;
        game.winner = game._isInCheck(game.turn) ? (isWhite ? 'A' : 'B') : 'draw';
      }
      if (game.halfmoveClock >= 100) { game.over = true; game.winner = 'draw'; }
      if (game.ply >= game.maxPly) { game.over = true; game.winner = 'draw'; }

      // Material count for score display
      let matW = 0, matB = 0;
      for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
        const p = game.board[r][c];
        if (p > 0 && Math.abs(p) !== KING) matW += PIECE_VAL[p];
        if (p < 0 && Math.abs(p) !== KING) matB += PIECE_VAL[-p];
      }

      // Check/checkmate suffix
      let suffix = '';
      if (game.over && game.winner !== 'draw') suffix = '#';
      else if (!game.over && game._isInCheck(game.turn)) suffix = '+';

      history.push({
        turn: game.ply,
        board: game.getBoard(),
        lastMove: game.lastMove,
        agentA: isWhite ? { move: notation + suffix, reasoning: result.reasoning } : null,
        agentB: !isWhite ? { move: notation + suffix, reasoning: result.reasoning } : null,
        winner: game.winner,
        scoreA: Math.round(matW / 100),
        scoreB: Math.round(matB / 100),
      });
    }
  }
  return history;
}


/* ═══════════════════════════════════════════════════════════════════════════
   Available Games
   ═══════════════════════════════════════════════════════════════════════════ */

const ARENA_GAMES = [
  {
    id: 'snake',
    title: 'Snake Battle',
    desc: 'Two AI snakes compete for food on a shared grid. Eat to grow, avoid walls and each other.',
    tags: ['Strategy', '2-Player'],
    config: { width: 20, height: 20, maxTurns: 200, seed: 42 },
    strategies: AI_STRATEGIES,
  },
  {
    id: 'chess960',
    title: 'Fischer Random Chess',
    desc: 'Chess960 — back rank pieces are shuffled. Full chess rules with randomized openings.',
    tags: ['Chess', 'Turn-based'],
    config: { maxMoves: 80, seed: 42 },
    strategies: CHESS_STRATEGIES,
  },
];


/* ═══════════════════════════════════════════════════════════════════════════
   Match Runner
   ═══════════════════════════════════════════════════════════════════════════ */

function runMatch(config, strategyA, strategyB) {
  const game = new SnakeGame(config);
  const fnA = AI_STRATEGIES[strategyA].fn;
  const fnB = AI_STRATEGIES[strategyB].fn;
  const history = [];

  const snapSnake = s => ({ alive: s.alive, score: s.score, body: s.body.map(p => [...p]) });

  // Turn 0: initial state
  history.push({
    turn: 0, grid: game.getGrid(),
    snakeA: snapSnake(game.snakeA), snakeB: snapSnake(game.snakeB),
    food: game.food ? [...game.food] : null,
    agentA: null, agentB: null, winner: null,
  });

  while (!game.over) {
    const aiState = game.getAIState();
    const resultA = fnA(aiState, 'A');
    const resultB = fnB(aiState, 'B');
    game.step(resultA.move, resultB.move);
    history.push({
      turn: game.turn, grid: game.getGrid(),
      snakeA: snapSnake(game.snakeA), snakeB: snapSnake(game.snakeB),
      food: game.food ? [...game.food] : null,
      agentA: { move: DIR_NAME[resultA.move], reasoning: resultA.reasoning },
      agentB: { move: DIR_NAME[resultB.move], reasoning: resultB.reasoning },
      winner: game.winner,
    });
  }
  return history;
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI State
   ═══════════════════════════════════════════════════════════════════════════ */

const Arena = {
  mode: 'setup',          // 'setup' | 'match'
  selectedGame: 'snake',
  history: null,
  currentStep: 0,
  playing: false,
  playTimer: null,
  canvas: null,
  ctx: null,
};


/* ═══════════════════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════════════════ */

function initArena() {
  Arena.canvas = document.getElementById('arenaCanvas');
  Arena.ctx = Arena.canvas.getContext('2d');

  // Render game card previews
  for (const game of ARENA_GAMES) {
    const preview = document.getElementById(`preview-${game.id}`);
    if (preview) renderPreview(preview, game);
  }

  // Wire up scrubber
  document.getElementById('arenaScrubber').addEventListener('input', e => {
    scrubTo(parseInt(e.target.value));
  });

  // Wire up speed changes during playback
  document.getElementById('arenaSpeed').addEventListener('change', () => {
    if (Arena.playing) { stopPlayback(); startPlayback(); }
  });

  // Wire up strategy selects to update descriptions and personality bars
  document.getElementById('stratA').addEventListener('change', e => {
    updateStrategyInfo('A', e.target.value);
  });
  document.getElementById('stratB').addEventListener('change', e => {
    updateStrategyInfo('B', e.target.value);
  });

  updateThemeBtn();
}

function renderPreview(canvas, game) {
  if (game.id === 'chess960') {
    renderChessPreview(canvas, game.config);
    return;
  }
  const snakeGame = new SnakeGame(game.config);
  const grid = snakeGame.getGrid();
  const size = 120;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cellW = size / snakeGame.W, cellH = size / snakeGame.H;
  for (let y = 0; y < snakeGame.H; y++)
    for (let x = 0; x < snakeGame.W; x++) {
      ctx.fillStyle = ARC3[grid[y][x]];
      ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
    }
}


/* ═══════════════════════════════════════════════════════════════════════════
   View Transitions
   ═══════════════════════════════════════════════════════════════════════════ */

function selectGameCard(el, gameId) {
  document.querySelectorAll('.arena-game-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  Arena.selectedGame = gameId;
  // Populate strategy selects for this game's strategies
  const game = ARENA_GAMES.find(g => g.id === gameId);
  if (game && game.strategies) {
    const keys = Object.keys(game.strategies);
    for (const side of ['stratA', 'stratB']) {
      const sel = document.getElementById(side);
      sel.innerHTML = '';
      keys.forEach((k, i) => {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = game.strategies[k].name;
        if ((side === 'stratA' && i === 0) || (side === 'stratB' && i === (keys.length > 1 ? 1 : 0)))
          opt.selected = true;
        sel.appendChild(opt);
      });
      updateStrategyInfo(side === 'stratA' ? 'A' : 'B', sel.value);
    }
  }
}

function enterMatchMode() {
  Arena.mode = 'match';

  // Hide settings, show logs
  document.getElementById('settingsA').style.display = 'none';
  document.getElementById('settingsB').style.display = 'none';
  document.getElementById('logA').classList.add('visible');
  document.getElementById('logB').classList.add('visible');

  // Hide game selection, show match area
  document.getElementById('gameSelectArea').classList.add('hidden');
  document.getElementById('matchArea').classList.add('visible');
}

function enterSetupMode() {
  Arena.mode = 'setup';
  stopPlayback();
  hideWinnerOverlay();

  // Show settings, hide logs
  document.getElementById('settingsA').style.display = '';
  document.getElementById('settingsB').style.display = '';
  document.getElementById('logA').classList.remove('visible');
  document.getElementById('logB').classList.remove('visible');

  // Show game selection, hide match area
  document.getElementById('gameSelectArea').classList.remove('hidden');
  document.getElementById('matchArea').classList.remove('visible');

  // Reset scores in sidebar
  document.getElementById('sbScoreA').textContent = '0';
  document.getElementById('sbScoreB').textContent = '0';

  // Clear logs
  document.getElementById('logA').innerHTML = '';
  document.getElementById('logB').innerHTML = '';
  Arena.history = null;
}

function backToSetup() {
  enterSetupMode();
}

function restartMatch() {
  enterSetupMode();
}


/* ═══════════════════════════════════════════════════════════════════════════
   Match Start
   ═══════════════════════════════════════════════════════════════════════════ */

function startMatch() {
  const game = ARENA_GAMES.find(g => g.id === Arena.selectedGame);
  if (!game) return;

  const strategyA = document.getElementById('stratA').value;
  const strategyB = document.getElementById('stratB').value;
  const config = {
    ...game.config,
    seed: parseInt(document.getElementById('cfgSeed').value) || 42,
    maxTurns: parseInt(document.getElementById('cfgMaxTurns').value) || 200,
  };

  // Switch to match mode
  enterMatchMode();

  // Update topbar
  document.getElementById('arenaGameTitle').textContent = game.title;

  // Run the full match (dispatch by game type)
  if (game.id === 'chess960') {
    Arena.history = runChessMatch(config, strategyA, strategyB);
  } else {
    Arena.history = runMatch(config, strategyA, strategyB);
  }
  Arena.currentStep = 0;

  // Build reasoning logs
  buildLogEntries();

  // Set up scrubber
  const maxStep = Arena.history.length - 1;
  document.getElementById('arenaScrubber').max = maxStep;
  document.getElementById('arenaScrubber').value = 0;

  // Render initial frame
  renderStep(0);
  updateMatchStatus('playing', 'Playing');

  // Start auto-play
  startPlayback();
}


/* ═══════════════════════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════════════════════ */

function renderStep(step) {
  if (!Arena.history || step >= Arena.history.length) return;
  Arena.currentStep = step;

  const frame = Arena.history[step];
  const canvasSize = 512;
  Arena.canvas.width = canvasSize;
  Arena.canvas.height = canvasSize;

  // Game-specific rendering
  if (Arena.selectedGame === 'chess960') {
    renderChessFrame(Arena.ctx, frame, canvasSize);
  } else {
    // Snake grid rendering
    const grid = frame.grid;
    const gridH = grid.length, gridW = grid[0].length;
    const cellW = canvasSize / gridW, cellH = canvasSize / gridH;
    for (let y = 0; y < gridH; y++)
      for (let x = 0; x < gridW; x++) {
        Arena.ctx.fillStyle = ARC3[grid[y][x]];
        Arena.ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
      }
    Arena.ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    Arena.ctx.lineWidth = 0.5;
    for (let x = 0; x <= gridW; x++) {
      Arena.ctx.beginPath(); Arena.ctx.moveTo(x*cellW,0); Arena.ctx.lineTo(x*cellW,canvasSize); Arena.ctx.stroke();
    }
    for (let y = 0; y <= gridH; y++) {
      Arena.ctx.beginPath(); Arena.ctx.moveTo(0,y*cellH); Arena.ctx.lineTo(canvasSize,y*cellH); Arena.ctx.stroke();
    }
  }

  // Update scrubber position
  document.getElementById('arenaScrubber').value = step;
  document.getElementById('scrubLabel').textContent = `Turn ${frame.turn}`;

  // Update scores (generic: use scoreA/scoreB if present, else snake-specific)
  const sA = frame.scoreA !== undefined ? frame.scoreA : (frame.snakeA ? frame.snakeA.score : 0);
  const sB = frame.scoreB !== undefined ? frame.scoreB : (frame.snakeB ? frame.snakeB.score : 0);
  document.getElementById('sbScoreA').textContent = sA;
  document.getElementById('sbScoreB').textContent = sB;
  document.getElementById('sbScoreAMatch').textContent = sA;
  document.getElementById('sbScoreBMatch').textContent = sB;
  updateTurnInfo(frame.turn, Arena.history[Arena.history.length - 1].turn);

  // Highlight + scroll reasoning logs
  highlightLogEntry(step);

  // Winner overlay on final step
  if (step === Arena.history.length - 1 && frame.winner) {
    showWinnerOverlay(frame.winner, sA, sB);
    const statusClass = frame.winner === 'A' ? 'win-a' : frame.winner === 'B' ? 'win-b' : 'draw';
    const statusText = frame.winner === 'draw' ? 'Draw!' : `Agent ${frame.winner} Wins!`;
    updateMatchStatus(statusClass, statusText);
  } else {
    hideWinnerOverlay();
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   Reasoning Logs
   ═══════════════════════════════════════════════════════════════════════════ */

function buildLogEntries() {
  const logA = document.getElementById('logA');
  const logB = document.getElementById('logB');
  logA.innerHTML = '';
  logB.innerHTML = '';

  for (let i = 0; i < Arena.history.length; i++) {
    const frame = Arena.history[i];
    // Handle both simultaneous (snake) and turn-based (chess) games
    if (frame.agentA) logA.appendChild(createLogEntry(i, frame.turn, frame.agentA, C.A_HEAD));
    if (frame.agentB) logB.appendChild(createLogEntry(i, frame.turn, frame.agentB, C.B_HEAD));
  }
}

function createLogEntry(stepIndex, turn, agentData, colorIndex) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.dataset.step = stepIndex;
  entry.innerHTML =
    `<div class="log-entry-turn">Turn ${turn}</div>` +
    `<div class="log-entry-move" style="color:${ARC3[colorIndex]}">${escHtml(agentData.move)}</div>` +
    `<div class="log-entry-reasoning">${escHtml(agentData.reasoning)}</div>`;
  entry.addEventListener('click', () => { stopPlayback(); scrubTo(stepIndex); });
  return entry;
}

function highlightLogEntry(step) {
  document.querySelectorAll('.log-entry.active').forEach(el => el.classList.remove('active'));

  const activeA = document.querySelector(`#logA .log-entry[data-step="${step}"]`);
  const activeB = document.querySelector(`#logB .log-entry[data-step="${step}"]`);
  if (activeA) {
    activeA.classList.add('active');
    activeA.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (activeB) {
    activeB.classList.add('active');
    activeB.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ═══════════════════════════════════════════════════════════════════════════
   Scrubber & Playback
   ═══════════════════════════════════════════════════════════════════════════ */

function scrubTo(step) {
  step = Math.max(0, Math.min(step, (Arena.history?.length || 1) - 1));
  renderStep(step);
}

function startPlayback() {
  if (Arena.playing || !Arena.history) return;
  Arena.playing = true;
  document.getElementById('arenaPlayBtn').textContent = 'Pause';
  const speed = parseInt(document.getElementById('arenaSpeed').value) || 200;

  Arena.playTimer = setInterval(() => {
    if (Arena.currentStep >= Arena.history.length - 1) {
      stopPlayback();
      return;
    }
    scrubTo(Arena.currentStep + 1);
  }, speed);
}

function stopPlayback() {
  Arena.playing = false;
  if (Arena.playTimer) { clearInterval(Arena.playTimer); Arena.playTimer = null; }
  document.getElementById('arenaPlayBtn').textContent = 'Play';
}

function arenaPlayPause() {
  if (Arena.playing) stopPlayback();
  else startPlayback();
}

function arenaStepBack() {
  stopPlayback();
  scrubTo(Arena.currentStep - 1);
}

function arenaStepForward() {
  stopPlayback();
  scrubTo(Arena.currentStep + 1);
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function updateStrategyInfo(agent, strategyKey) {
  const game = ARENA_GAMES.find(g => g.id === Arena.selectedGame);
  const strategies = game ? game.strategies : AI_STRATEGIES;
  const strat = strategies[strategyKey];
  if (!strat) return;

  document.getElementById(`stratDesc${agent}`).textContent = strat.desc;

  // Update personality bars
  const panel = document.getElementById(`personality${agent}`);
  const fills = panel.querySelectorAll('.stat-fill');
  fills[0].style.width = strat.personality.aggression + '%';
  fills[1].style.width = strat.personality.caution + '%';
  fills[2].style.width = strat.personality.greed + '%';
}

function updateTurnInfo(current, total) {
  document.getElementById('turnInfo').textContent = `Turn ${current} / ${total}`;
}

function updateMatchStatus(cls, text) {
  const el = document.getElementById('matchStatus');
  el.className = 'match-status ' + cls;
  el.textContent = text;
}

function showWinnerOverlay(winner, scoreA, scoreB) {
  const overlay = document.getElementById('winnerOverlay');
  const textEl = document.getElementById('winnerText');
  const subEl = document.getElementById('winnerSub');

  if (winner === 'draw') {
    textEl.textContent = 'Draw!';
    textEl.style.color = ARC3[15]; // purple
  } else if (winner === 'A') {
    textEl.textContent = 'Agent A Wins!';
    textEl.style.color = ARC3[C.A_HEAD];
  } else {
    textEl.textContent = 'Agent B Wins!';
    textEl.style.color = ARC3[C.B_HEAD];
  }
  subEl.textContent = `Score: ${scoreA} - ${scoreB}`;
  overlay.classList.add('show');
}

function hideWinnerOverlay() {
  document.getElementById('winnerOverlay').classList.remove('show');
}


/* ═══════════════════════════════════════════════════════════════════════════
   Theme
   ═══════════════════════════════════════════════════════════════════════════ */

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? null : 'light';
  if (next) {
    html.setAttribute('data-theme', next);
    localStorage.setItem('arc-theme', next);
  } else {
    html.removeAttribute('data-theme');
    localStorage.removeItem('arc-theme');
  }
  updateThemeBtn();
}

function updateThemeBtn() {
  const btn = document.getElementById('themeToggle');
  if (btn) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btn.textContent = isLight ? '\u263E' : '\u2600';
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   Keyboard Shortcuts
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  if (Arena.mode !== 'match' || !Arena.history) return;

  if (e.key === ' ' || e.key === 'k') { e.preventDefault(); arenaPlayPause(); }
  if (e.key === 'ArrowLeft' || e.key === 'j') { e.preventDefault(); arenaStepBack(); }
  if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); arenaStepForward(); }
  if (e.key === 'Home') { e.preventDefault(); stopPlayback(); scrubTo(0); }
  if (e.key === 'End') { e.preventDefault(); stopPlayback(); scrubTo(Arena.history.length - 1); }
  if (e.key === 'Escape') { backToSetup(); }
});


/* ═══════════════════════════════════════════════════════════════════════════
   Bootstrap
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', initArena);
