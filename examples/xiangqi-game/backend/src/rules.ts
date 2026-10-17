// 象棋 —— 规则引擎（后端与前端共用同一套判定语义；后端为权威实现）
//
// 棋盘：9 列 × 10 行，索引 = y * 9 + x，x∈[0,8]，y∈[0,9]。
// 红方在下（y=7..9 为阵地），黑方在上；红先行。
//
// 覆盖：七类棋子走法（含蹩马腿、塞象眼、过河兵横走、炮翻山吃子）、
// 九宫/河界约束、将帅照面（飞将）、将军/应将、绝杀与困毙（无子可动即负）。

export type Color = 'r' | 'b';
export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';

export interface Piece {
  c: Color;
  t: PieceType;
}

export interface Move {
  from: number;
  to: number;
}

export const BOARD_W = 9;
export const BOARD_H = 10;
export const CELL_COUNT = BOARD_W * BOARD_H;

export const PIECE_VALUES: Record<PieceType, number> = {
  K: 10000,
  R: 900,
  C: 450,
  N: 400,
  B: 200,
  A: 200,
  P: 100,
};

const ORTH: number[][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG: number[][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT: number[][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export function idx(x: number, y: number): number {
  return y * BOARD_W + x;
}

export function xOf(i: number): number {
  return i % BOARD_W;
}

export function yOf(i: number): number {
  return Math.floor(i / BOARD_W);
}

export function inBoard(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;
}

export function other(c: Color): Color {
  return c === 'r' ? 'b' : 'r';
}

/** 初始局面：红在下先行。 */
export function initialBoard(): (Piece | null)[] {
  const board: (Piece | null)[] = new Array(CELL_COUNT).fill(null);
  const back: PieceType[] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
  for (let x = 0; x < 9; x++) {
    board[idx(x, 0)] = { c: 'b', t: back[x] };
    board[idx(x, 9)] = { c: 'r', t: back[x] };
  }
  board[idx(1, 2)] = { c: 'b', t: 'C' };
  board[idx(7, 2)] = { c: 'b', t: 'C' };
  board[idx(1, 7)] = { c: 'r', t: 'C' };
  board[idx(7, 7)] = { c: 'r', t: 'C' };
  for (let x = 0; x < 9; x += 2) {
    board[idx(x, 3)] = { c: 'b', t: 'P' };
    board[idx(x, 6)] = { c: 'r', t: 'P' };
  }
  return board;
}

export function cloneBoard(board: (Piece | null)[]): (Piece | null)[] {
  return board.slice();
}

function inPalace(c: Color, x: number, y: number): boolean {
  if (x < 3 || x > 5) return false;
  return c === 'r' ? y >= 7 : y <= 2;
}

function ownSide(c: Color, y: number): boolean {
  return c === 'r' ? y >= 5 : y <= 4;
}

/** 已越河（对红为 y<=4，对黑为 y>=5）。 */
function crossedRiver(c: Color, y: number): boolean {
  return c === 'r' ? y <= 4 : y >= 5;
}

function sameSide(a: Piece | null, c: Color): boolean {
  return !!a && a.c === c;
}

function pushMove(out: Move[], from: number, x: number, y: number, board: (Piece | null)[], c: Color): void {
  if (!inBoard(x, y)) return;
  const target = board[idx(x, y)];
  if (sameSide(target, c)) return;
  out.push({ from: from, to: idx(x, y) });
}

/** 伪合法走法（不含自将校验）。 */
function genMovesFrom(board: (Piece | null)[], from: number): Move[] {
  const piece = board[from];
  if (!piece) return [];
  const x = xOf(from);
  const y = yOf(from);
  const c = piece.c;
  const out: Move[] = [];

  switch (piece.t) {
    case 'K':
      for (const d of ORTH) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (inPalace(c, nx, ny)) pushMove(out, from, nx, ny, board, c);
      }
      break;
    case 'A':
      for (const d of DIAG) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (inPalace(c, nx, ny)) pushMove(out, from, nx, ny, board, c);
      }
      break;
    case 'B':
      for (const d of DIAG) {
        const nx = x + 2 * d[0];
        const ny = y + 2 * d[1];
        if (!inBoard(nx, ny) || !ownSide(c, ny)) continue;
        // 塞象眼
        if (board[idx(x + d[0], y + d[1])]) continue;
        pushMove(out, from, nx, ny, board, c);
      }
      break;
    case 'N':
      for (const d of KNIGHT) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (!inBoard(nx, ny)) continue;
        // 蹩马腿：先直一步的方向
        const legX = x + (Math.abs(d[0]) > Math.abs(d[1]) ? Math.sign(d[0]) : 0);
        const legY = y + (Math.abs(d[1]) > Math.abs(d[0]) ? Math.sign(d[1]) : 0);
        if (board[idx(legX, legY)]) continue;
        pushMove(out, from, nx, ny, board, c);
      }
      break;
    case 'R':
      for (const d of ORTH) {
        let nx = x + d[0];
        let ny = y + d[1];
        while (inBoard(nx, ny)) {
          const target = board[idx(nx, ny)];
          if (!target) {
            out.push({ from: from, to: idx(nx, ny) });
          } else {
            if (target.c !== c) out.push({ from: from, to: idx(nx, ny) });
            break;
          }
          nx += d[0];
          ny += d[1];
        }
      }
      break;
    case 'C':
      for (const d of ORTH) {
        let nx = x + d[0];
        let ny = y + d[1];
        let jumped = false;
        while (inBoard(nx, ny)) {
          const target = board[idx(nx, ny)];
          if (!jumped) {
            if (!target) {
              out.push({ from: from, to: idx(nx, ny) });
            } else {
              jumped = true;
            }
          } else if (target) {
            if (target.c !== c) out.push({ from: from, to: idx(nx, ny) });
            break;
          }
          nx += d[0];
          ny += d[1];
        }
      }
      break;
    case 'P': {
      const fwd = c === 'r' ? -1 : 1;
      pushMove(out, from, x, y + fwd, board, c);
      if (crossedRiver(c, y)) {
        pushMove(out, from, x - 1, y, board, c);
        pushMove(out, from, x + 1, y, board, c);
      }
      break;
    }
  }
  return out;
}

function findKing(board: (Piece | null)[], c: Color): number {
  for (let i = 0; i < CELL_COUNT; i++) {
    const p = board[i];
    if (p && p.c === c && p.t === 'K') return i;
  }
  return -1;
}

/** 将帅是否照面（飞将）。 */
export function kingsFacing(board: (Piece | null)[]): boolean {
  const rk = findKing(board, 'r');
  const bk = findKing(board, 'b');
  if (rk < 0 || bk < 0) return false;
  if (xOf(rk) !== xOf(bk)) return false;
  const x = xOf(rk);
  const y0 = Math.min(yOf(rk), yOf(bk));
  const y1 = Math.max(yOf(rk), yOf(bk));
  for (let y = y0 + 1; y < y1; y++) {
    if (board[idx(x, y)]) return false;
  }
  return true;
}

/** color 方是否被将军（含飞将照面视为受将）。 */
export function isInCheck(board: (Piece | null)[], color: Color): boolean {
  const k = findKing(board, color);
  if (k < 0) return true;
  const enemy = other(color);
  for (let i = 0; i < CELL_COUNT; i++) {
    const p = board[i];
    if (!p || p.c !== enemy) continue;
    const moves = genMovesFrom(board, i);
    for (const m of moves) {
      if (m.to === k) return true;
    }
  }
  return kingsFacing(board);
}

export function applyMove(board: (Piece | null)[], move: Move): void {
  board[move.to] = board[move.from];
  board[move.from] = null;
}

/** 走一步后 color 是否仍安全（不被将军/不照面）。 */
function leavesSelfInCheck(board: (Piece | null)[], color: Color, move: Move): boolean {
  const saved = board[move.to];
  applyMove(board, move);
  const bad = isInCheck(board, color);
  board[move.from] = board[move.to];
  board[move.to] = saved;
  return bad;
}

/** color 方所有合法走法（空 = 被绝杀或困毙，判负）。 */
export function legalMoves(board: (Piece | null)[], color: Color): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const p = board[i];
    if (!p || p.c !== color) continue;
    const moves = genMovesFrom(board, i);
    for (const m of moves) {
      if (!leavesSelfInCheck(board, color, m)) out.push(m);
    }
  }
  return out;
}

export function isLegalMove(board: (Piece | null)[], color: Color, from: number, to: number): boolean {
  if (from < 0 || from >= CELL_COUNT || to < 0 || to >= CELL_COUNT) return false;
  const p = board[from];
  if (!p || p.c !== color) return false;
  const moves = genMovesFrom(board, from);
  let found = false;
  for (const m of moves) {
    if (m.to === to) { found = true; break; }
  }
  if (!found) return false;
  return !leavesSelfInCheck(board, color, { from: from, to: to });
}

export function attacked(board: (Piece | null)[], color: Color): boolean {
  return isInCheck(board, color);
}
