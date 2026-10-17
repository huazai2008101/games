// 象棋 AI —— alpha-beta 剪枝 + 节点预算（goja 引擎内运行，必须保证耗时可控）
//
// 平台 goja 沙箱对单次脚本/定时器回调有 2s 硬时限（engine_actor.go
// engineScriptTimeout，超时直接 Interrupt 并把会话置为 error）。goja 是解释
// 执行，比 Node 慢 1~2 个数量级：每个搜索节点要算一遍 legalMoves（含模拟
// 走子 + 将军检测，约万次级运算），4000 节点在 Node 里 <100ms，在 goja 里
// 实测会超过 2s —— 象棋上线首日"开局 60 秒后对局终止"即由此而来。
// 因此：节点预算压到 320、根节点最多评估 12 步（吃子优先排序后截断），
// 最坏 ≈320 节点 ≈ 数百万次运算，留出足够安全余量。lastBotSearchNodes
// 供仿真测试钉住最坏情况预算（test/simulate.mjs）。

import {
  CELL_COUNT,
  PIECE_VALUES,
  type Color,
  type Move,
  type Piece,
} from './rules.ts';
import { legalMoves, applyMove, xOf, yOf, other } from './rules.ts';

// 节点预算按 goja 2s 硬时限反推(见文件头),不得为棋力贸然调大。
// 深层子树会在预算检查前多跑一整层走法(≤44 节点),260+44=304,
// 测试钉住最坏不超过 320。
const NODE_BUDGET = 260;
/** 根节点最多评估的走法数（排序后截断，吃子/高价值走法优先）。 */
const ROOT_MOVE_CAP = 12;
const MATE = 100000;

/** 最近一次 botMove 实际搜索的节点数（仿真测试用，钉住 goja 预算契约）。 */
export let lastBotSearchNodes = 0;

function pieceBonus(p: Piece, i: number): number {
  const x = xOf(i);
  const y = yOf(i);
  let bonus = 0;
  if (p.t === 'P') {
    const advanced = p.c === 'r' ? 9 - y : y;
    if (advanced >= 5) bonus += 20;               // 过河
    if (advanced >= 5 && x >= 2 && x <= 6) bonus += 10;
    if (advanced >= 7) bonus += 25;               // 逼近宫城
  } else if (p.t === 'N' || p.t === 'C') {
    // 中路偏优
    bonus += (4 - Math.abs(x - 4)) * 3;
  } else if (p.t === 'K') {
    // 主帅贴边略安全
    if (x === 4) bonus += 8;
  }
  return bonus;
}

function evaluate(board: (Piece | null)[], forColor: Color): number {
  let score = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const p = board[i];
    if (!p) continue;
    const v = PIECE_VALUES[p.t] + pieceBonus(p, i);
    score += p.c === forColor ? v : -v;
  }
  return score;
}

interface Ctx {
  nodes: number;
  budget: number;
}

function orderedMoves(board: (Piece | null)[], color: Color): Move[] {
  const moves = legalMoves(board, color);
  const scored: Array<{ m: Move; s: number }> = [];
  for (const m of moves) {
    const target = board[m.to];
    const s = target ? PIECE_VALUES[target.t] * 10 - PIECE_VALUES[board[m.from]!.t] : 0;
    scored.push({ m: m, s: s });
  }
  scored.sort(function (a, b) { return b.s - a.s; });
  return scored.map(function (e) { return e.m; });
}

function search(ctx: Ctx, board: (Piece | null)[], color: Color, depth: number, alpha: number, beta: number): number {
  ctx.nodes++;
  if (ctx.nodes > ctx.budget) return evaluate(board, color);
  if (depth === 0) return evaluate(board, color);

  const moves = orderedMoves(board, color);
  if (moves.length === 0) {
    // 无子可动：困毙/绝杀，当前行棋方输
    return -MATE + (3 - depth);
  }
  let best = -Infinity;
  for (const m of moves) {
    const saved = board[m.to];
    applyMove(board, m);
    const score = -search(ctx, board, other(color), depth - 1, -beta, -alpha);
    board[m.from] = board[m.to];
    board[m.to] = saved;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface BotContext {
  /** 己方颜色 */
  color: Color;
  /** 是否正被将军（用于避免无谓送将的兜底提示，不参与搜索） */
  inCheck?: boolean;
}

/** 选一步：深度 2 alpha-beta；异常/超预算时回退贪吃子 → 随机合法步。 */
export function botMove(board: (Piece | null)[], color: Color): Move | null {
  const ordered = orderedMoves(board, color);
  if (ordered.length === 0) return null;
  if (ordered.length === 1) return ordered[0];
  // 根节点截断：排序后只评估前 ROOT_MOVE_CAP 步，其余直接取序位最优
  const moves = ordered.length > ROOT_MOVE_CAP ? ordered.slice(0, ROOT_MOVE_CAP) : ordered;

  let bestMove = moves[0];
  let bestScore = -Infinity;
  const ctx: Ctx = { nodes: 0, budget: NODE_BUDGET };
  try {
    for (const m of moves) {
      const saved = board[m.to];
      applyMove(board, m);
      const score = -search(ctx, board, other(color), 1, -Infinity, Infinity);
      board[m.from] = board[m.to];
      board[m.to] = saved;
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
      if (ctx.nodes > ctx.budget) break;
    }
  } catch (e) {
    lastBotSearchNodes = ctx.nodes;
    // 搜索异常：回退贪吃子
    return greedyOrRandom(board, ordered);
  }
  lastBotSearchNodes = ctx.nodes;
  return bestMove;
}

function greedyOrRandom(board: (Piece | null)[], moves: Move[]): Move {
  let best: Move | null = null;
  let bestV = -1;
  for (const m of moves) {
    const t = board[m.to];
    const v = t ? PIECE_VALUES[t.t] : 0;
    if (v > bestV) { bestV = v; best = m; }
  }
  if (best) return best;
  return moves[Math.floor(Math.random() * moves.length)];
}
