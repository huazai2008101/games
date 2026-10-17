// 斗地主 —— 前端事件契约（与后端 game.ts 一一对应）
//
// 除 ddz:sync 定向（含本人手牌/余额）与 ddz:error 定向外，全部为广播且携带
// 完整公共快照 public —— 观战者与中途加入者零补发即可重建整张牌桌。
// 余额唯一事实源是平台 wallet:balance 版本化推送；ddz:sync 里的 balance 只作
// 入场引导，客户端按 (balance, version) 水位线统一去乱序。

export type DdzPhase =
  | 'matching' | 'lobby' | 'bidding' | 'playing' | 'settle' | 'dissolving';

export type ComboType =
  | 'single' | 'pair' | 'trio' | 'trio_single' | 'trio_pair'
  | 'straight' | 'pair_straight'
  | 'plane' | 'plane_single' | 'plane_pair'
  | 'four_two_single' | 'four_two_pair'
  | 'bomb' | 'rocket';

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
  bid: number;
  role: 'landlord' | 'farmer' | null;
  played: number[] | null;
}

export interface LastPlayView {
  seat: number;
  cards: number[];
  comboType: ComboType | null;
}

export interface DdzPublic {
  handNo: number;
  phase: DdzPhase;
  base: number;
  dealer: number;
  bidScore: number;
  /** 本局已完成叫分的座位数：座位 s 已行动 ⇔ (s - dealer + 3) % 3 < bidActed。 */
  bidActed: number;
  turn: number;
  /** 服务器 epoch ms：当前思考回合的截止时刻（客户端倒计时环）。 */
  turnEndsAt: number;
  landlordSeat: number;
  bombCount: number;
  multiplier: number;
  bottomShown: boolean;
  bottom: number[];
  lastPlay: LastPlayView | null;
  passStreak: number;
  remain: number[];
  seats: SeatView[];
  scores: Record<string, number>;
  redealCount: number;
  /** settle 相位：自动续局截止时刻（结算浮层倒计时）。 */
  nextAt?: number;
  /** dissolving 相位：解散宽限截止时刻（浮层倒计时）。 */
  dissolveAt?: number;
}

/** ddz:sync 定向快照：公共快照 + 本人私有数据（观战者收不到，走广播流）。 */
export interface DdzSync extends DdzPublic {
  you: number;
  playerId: string;
  hand: number[];
  balance?: number;
  version?: number;
  /** 结算阶段重连时恢复浮层所需的最近一局数据。 */
  handOver?: DdzHandOver;
  settled?: DdzSettled;
}

export interface DdzHandOver {
  public: DdzPublic;
  winner: number;
  landlordWins: boolean;
  spring: boolean;
  bombCount: number;
  bidScore: number;
  multiplier: number;
  stake: number;
  hands: number[][];
}

export interface DdzSettled {
  public: DdzPublic;
  committed: boolean;
  deltas: Record<string, number>;
  scores: Record<string, number>;
  spring: boolean;
}
