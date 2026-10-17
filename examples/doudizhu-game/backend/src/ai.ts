// 斗地主 AI —— 服务端机器人（补位）与玩家超时托管共用同一决策入口。
//
// 设计目标不是最强，而是"像样"：能识别牌力叫分、出牌不拆炸弹、农民会
// 配合队友（不无脑压对家）、能抓住剩牌收尾机会。

import { COMBO, findPlays, handStrength } from './cards.ts';
import type { Combo } from './cards.ts';

/** AI 叫分：0 = 不叫；阈值凭牌力（炸弹/王/2/A 的加权）。minBid 为当前已被叫的最高分。 */
export function botBid(hand: number[], minBid: number): number {
  const s = handStrength(hand);
  let bid = 0;
  if (s >= 14) bid = 3;
  else if (s >= 9) bid = 2;
  else if (s >= 5) bid = 1;
  if (bid <= minBid) return 0;
  return bid;
}

export interface BotContext {
  seat: number;
  /** 当前地主的座位；叫分阶段为 -1。 */
  landlordSeat: number;
  /** 最近一次出牌者的座位；-1 = 自由出牌。 */
  leaderSeat: number;
  /** 各家剩余张数。 */
  remain: number[];
}

/**
 * AI 出牌：返回要出的牌，空数组 = 过。
 * hand 为当前手牌；last 为需压过的牌型（null = 自由出牌）。
 */
export function botPlay(hand: number[], last: Combo | null, ctx: BotContext): number[] {
  const plays = findPlays(hand, last);
  if (plays.length === 0) return [];
  if (!last) return leadPlay(hand, plays, ctx);
  return followPlay(hand, last, plays, ctx);
}

// ── 自由出牌（先手 / 两家都过后的新一轮）──

function leadPlay(hand: number[], plays: Combo[], ctx: BotContext): number[] {
  // 一步成牌直接打完
  for (let i = 0; i < plays.length; i++) {
    if (plays[i].size === hand.length) return plays[i].cards;
  }

  const bombs: Combo[] = [];
  const normals: Combo[] = [];
  for (let i = 0; i < plays.length; i++) {
    const t = plays[i].type;
    if (t === COMBO.BOMB || t === COMBO.ROCKET) bombs.push(plays[i]);
    else normals.push(plays[i]);
  }
  const pool = normals.length > 0 ? normals : plays;

  // 评分选牌：偏好出小牌、长牌型（多甩牌）
  let best: Combo | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    let score = -p.value * 2 + p.size * 1.5;
    // 单牌：2/A 尽量留着掌控节奏
    if (p.type === COMBO.SINGLE && p.value >= 14) score -= 4;
    // 带翅膀优于裸三张（多送一张牌）
    if (p.type === COMBO.TRIO_SINGLE || p.type === COMBO.TRIO_PAIR) score += 1;
    // 炸弹不主动打（除非手里只剩炸弹类）
    if (normals.length > 0 && bombs.indexOf(p) >= 0) score -= 100;
    // 农民视角：队友快走完时送单牌
    if (ctx.landlordSeat >= 0 && ctx.landlordSeat !== ctx.seat) {
      const mate = 3 - ctx.seat - ctx.landlordSeat;
      if (ctx.remain[mate] <= 2) {
        if (p.type === COMBO.SINGLE) score += 2;
        else score -= 2;
      }
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best ? best.cards : pool[0].cards;
}

// ── 跟牌 ──

function followPlay(hand: number[], last: Combo, plays: Combo[], ctx: BotContext): number[] {
  // 能一手打完直接出（包括压队友 —— 赢下这局优先）
  for (let i = 0; i < plays.length; i++) {
    if (plays[i].size === hand.length) return plays[i].cards;
  }

  const iAmLandlord = ctx.landlordSeat === ctx.seat;
  const bombs: Combo[] = [];
  const normals: Combo[] = [];
  for (let i = 0; i < plays.length; i++) {
    const t = plays[i].type;
    if (t === COMBO.BOMB || t === COMBO.ROCKET) bombs.push(plays[i]);
    else normals.push(plays[i]);
  }

  // 队友出的牌：不压，除非能走完（上面已处理）或要拦地主
  const mateLead = !iAmLandlord && ctx.landlordSeat >= 0
    && ctx.leaderSeat >= 0 && ctx.leaderSeat !== ctx.seat && ctx.leaderSeat !== ctx.landlordSeat;
  if (mateLead) {
    if (ctx.remain[ctx.landlordSeat] <= 1 && bombs.length > 0) return bombs[0].cards;
    return [];
  }

  // 常规跟牌：选最小能压过的非炸弹
  if (normals.length > 0) {
    const pick = pickFollow(normals, last, ctx, iAmLandlord);
    if (pick) return pick;
  }
  if (bombs.length > 0 && useBomb(ctx, iAmLandlord)) return bombs[0].cards;
  return [];
}

/** 从能压过的非炸弹里挑一手：不浪费大牌，对手告急时适度拦截。 */
function pickFollow(
  normals: Combo[], last: Combo, ctx: BotContext, iAmLandlord: boolean,
): number[] | null {
  const threat = threatSeat(ctx, iAmLandlord);
  const urgent = threat >= 0 && ctx.remain[threat] <= 2;
  let best: Combo | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < normals.length; i++) {
    const p = normals[i];
    let score = p.value;
    // 压单牌避免直接动用 2/王
    if (last.type === COMBO.SINGLE && p.value >= 15) score += 10;
    // 长牌型跟牌更有价值
    if (p.size >= 2) score -= 0.5;
    if (urgent) score -= 3;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  // 只剩用王压小单牌这一种且对手不急 → 放弃跟牌
  if (best && last.type === COMBO.SINGLE && best.value >= 16 && !urgent) return null;
  return best ? best.cards : null;
}

function useBomb(ctx: BotContext, iAmLandlord: boolean): boolean {
  if (!iAmLandlord && ctx.remain[ctx.landlordSeat] <= 3) return true;
  if (iAmLandlord) {
    for (let i = 0; i < 3; i++) {
      if (i !== ctx.seat && ctx.remain[i] <= 2) return true;
    }
  }
  return false;
}

function threatSeat(ctx: BotContext, iAmLandlord: boolean): number {
  if (iAmLandlord) {
    // 对地主而言，剩牌最少的农民是威胁
    let t = -1;
    for (let i = 0; i < 3; i++) {
      if (i === ctx.seat || i === ctx.landlordSeat) continue;
      if (t < 0 || ctx.remain[i] < ctx.remain[t]) t = i;
    }
    return t;
  }
  return ctx.landlordSeat;
}
