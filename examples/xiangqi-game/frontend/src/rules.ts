// 象棋 —— 前端规则副本（与后端 rules.ts 同语义，用于本地高亮合法落点与提示）
// 后端是权威判定：此处仅供交互预演，服务端仍会校验每一步。

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
function inBoard(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;
}
export function other(c: Color): Color {
  return c === 'r' ? 'b' : 'r';
}

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

function inPalace(c: Color, x: number, y: number): boolean {
  if (x < 3 || x > 5) return false;
  return c === 'r' ? y >= 7 : y <= 2;
}
function ownSide(c: Color, y: number): boolean {
  return c === 'r' ? y >= 5 : y <= 4;
}
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
        if (inPalace(c, x + d[0], y + d[1])) pushMove(out, from, x + d[0], y + d[1], board, c);
      }
      break;
    case 'A':
      for (const d of DIAG) {
        if (inPalace(c, x + d[0], y + d[1])) pushMove(out, from, x + d[0], y + d[1], board, c);
      }
      break;
    case 'B':
      for (const d of DIAG) {
        const nx = x + 2 * d[0];
        const ny = y + 2 * d[1];
        if (!inBoard(nx, ny) || !ownSide(c, ny)) continue;
        if (board[idx(x + d[0], y + d[1])]) continue;
        pushMove(out, from, nx, ny, board, c);
      }
      break;
    case 'N':
      for (const d of KNIGHT) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (!inBoard(nx, ny)) continue;
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
            if (!target) out.push({ from: from, to: idx(nx, ny) });
            else jumped = true;
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

function leavesSelfInCheck(board: (Piece | null)[], color: Color, move: Move): boolean {
  const saved = board[move.to];
  applyMove(board, move);
  const bad = isInCheck(board, color);
  board[move.from] = board[move.to];
  board[move.to] = saved;
  return bad;
}

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

/** 某棋子当前的全部合法落点（用于选中高亮）。 */
export function legalTargets(board: (Piece | null)[], color: Color, from: number): number[] {
  if (!board[from] || board[from]!.c !== color) return [];
  return genMovesFrom(board, from)
    .filter((m) => !leavesSelfInCheck(board, color, m))
    .map((m) => m.to);
}

export function isLegalMove(board: (Piece | null)[], color: Color, from: number, to: number): boolean {
  if (from < 0 || from >= CELL_COUNT || to < 0 || to >= CELL_COUNT) return false;
  const p = board[from];
  if (!p || p.c !== color) return false;
  let found = false;
  for (const m of genMovesFrom(board, from)) {
    if (m.to === to) { found = true; break; }
  }
  if (!found) return false;
  return !leavesSelfInCheck(board, color, { from: from, to: to });
}
