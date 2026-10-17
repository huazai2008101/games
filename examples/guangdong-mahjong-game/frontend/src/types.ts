// 广东麻将 —— 前端事件契约（与后端 game.ts 一一对应，详见 README）
//
// 除 mj:sync / mj:hand / mj:error 定向外，全部为广播且携带完整公共快照 public。
// 本人手牌经 mj:hand（增量）/ mj:sync（全量）定向下发。

export type MjPhase =
  | 'matching' | 'lobby' | 'playing' | 'settle' | 'dissolving';

export type MeldType = 'chi' | 'pong' | 'mkong' | 'akong' | 'bkong';

export interface Meld {
  type: MeldType;
  tiles: number[];
  from?: number;
}

export interface SeatView {
  seat: number;
  id: string;
  /** 平台名册下发的展示名(玩家 username);空 = 回退 ID 展示。 */
  name?: string;
  bot: boolean;
  /** 空位：自动匹配等待真人补位（匹配超时才转 AI）。 */
  vacant?: boolean;
  ready: boolean;
  count: number;
  melds: Meld[];
  river: number[];
}

export interface ClaimView {
  from: number;
  tile: number;
  endsAt: number;
  rob: boolean;
}

export interface MjPublic {
  handNo: number;
  phase: MjPhase;
  base: number;
  fanCap: number;
  dealer: number;
  /** 当前行动座位（选择窗期间为 -1）。 */
  turn: number;
  /** discard = 轮到打牌；claim = 吃碰杠胡选择窗。 */
  action: 'discard' | 'claim';
  turnEndsAt: number;
  wallCount: number;
  claim?: ClaimView;
  seats: SeatView[];
  scores: Record<string, number>;
  /** settle 相位：自动续局截止时刻（结算浮层倒计时）。 */
  nextAt?: number;
  /** dissolving 相位：解散宽限截止时刻（浮层倒计时）。 */
  dissolveAt?: number;
}

/** mj:sync / mj:hand 定向快照：公共快照 + 本人私有数据。 */
export interface MjSync extends MjPublic {
  you: number;
  playerId: string;
  /** 本人暗牌（升序）。 */
  hand: number[];
  /** 刚摸的牌（-1 = 无，如碰/吃后的打牌轮）。 */
  drawn: number;
  balance?: number;
  version?: number;
  /** 结算阶段重连时恢复浮层所需的最近一局数据。 */
  handOver?: MjHandOver;
  settled?: MjSettled;
}

export interface MjHandOver {
  draw: boolean;
  dealer?: number;
  winner?: number;
  loser?: number;
  selfDraw?: boolean;
  winTile?: number;
  rob?: boolean;
  fan?: number;
  fanDetail?: string[];
  stake?: number;
  hands: number[][];
  melds: Meld[][];
}

export interface MjSettled {
  committed: boolean;
  deltas: Record<string, number>;
  scores: Record<string, number>;
}
