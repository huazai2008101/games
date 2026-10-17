// 象棋 —— 前端事件契约（与后端 game.ts 一一对应）
//
// 除 xq:sync 定向（含本人执子颜色/余额）与 xq:error 定向外，全部为广播且
// 携带完整公共快照 public —— 观战者与中途加入者零补发即可重建整张棋盘。
// 余额唯一事实源是平台 wallet:balance 版本化推送；xq:sync 里的 balance 只作
// 入场引导，客户端按 (balance, version) 水位线统一去乱序。

import type { Color, Piece } from './rules';

export type XqPhase =
  | 'matching' | 'lobby' | 'playing' | 'settle' | 'dissolving';

export interface SeatView {
  seat: number;
  id: string;
  /** 平台名册下发的展示名(玩家 username);空 = 回退 ID 展示。 */
  name?: string;
  bot: boolean;
  /** 空位：自动匹配等待真人补位（匹配超时才转 AI）。 */
  vacant?: boolean;
  ready: boolean;
  color: Color | null;
}

export interface MoveView {
  from: number;
  to: number;
}

export interface XqPublic {
  gameNo: number;
  phase: XqPhase;
  base: number;
  /** 当前行棋方颜色 */
  turn: Color;
  /** 当前行棋方座位 */
  turnSeat: number;
  /** 服务器 epoch ms：当前思考回合的截止时刻（客户端倒计时环）。 */
  turnEndsAt: number;
  /** 棋盘快照：90 格，索引 = y * 9 + x。 */
  board: (Piece | null)[];
  lastMove: MoveView | null;
  lastMovedSeat: number;
  moveCount: number;
  /** 当前行棋方是否被将军。 */
  inCheck: boolean;
  seats: SeatView[];
  scores: Record<string, number>;
  /** settle 相位：自动续局截止时刻（结算浮层倒计时）。 */
  nextAt?: number;
  /** dissolving 相位：解散宽限截止时刻（浮层倒计时）。 */
  dissolveAt?: number;
}

/** xq:sync 定向快照：公共快照 + 本人私有数据（观战者收不到，走广播流）。 */
export interface XqSync extends XqPublic {
  you: number;
  playerId: string;
  /** 本人执子颜色（观战/未开局为 null）。 */
  youColor: Color | null;
  balance?: number;
  version?: number;
  /** 结算阶段重连时恢复浮层所需的最近一局数据。 */
  handOver?: XqHandOver;
  settled?: XqSettled;
}

export interface XqHandOver {
  public: XqPublic;
  winner: number;
  draw: boolean;
  reason: 'checkmate' | 'stalemate' | 'resign' | 'no_capture_draw' | 'both_left_draw';
  finalBoard: (Piece | null)[];
}

export interface XqSettled {
  public: XqPublic;
  committed: boolean;
  deltas: Record<string, number>;
  scores: Record<string, number>;
  reason: string;
}

export type XqEndReason = XqHandOver['reason'];

export const END_REASON_LABEL: Record<XqEndReason, string> = {
  checkmate: '绝杀',
  stalemate: '困毙',
  resign: '认输',
  no_capture_draw: '双方无进取，判和',
  both_left_draw: '双方离席，判和',
};
