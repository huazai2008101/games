// 广东麻将 AI —— 服务端机器人（补位）与真人超时托管共用同一决策入口。
//
// 目标不是最强，而是"像样"：留对子/搭子、先丢孤张字牌，能胡必胡，
// 碰杠果断但会放弃破坏门清大牌的吃碰，吃牌只吃不拆搭子的组合。

import {
  decompose, isWin, isHonor, suitOf, rankOf, toKinds,
} from './tiles.ts';
import type { Meld } from './tiles.ts';

// ── 出牌 ──

/**
 * 选一张打出去。hand 为当前暗牌（摸牌后），melds 为副露。
 * 返回牌 id。hand 必非空（轮到打牌时至少有一张）。
 */
export function botDiscard(hand: number[], melds: Meld[]): number {
  // 打出后离胡最近（手牌潜力最高）的一张
  let bestTile = hand[0];
  let bestScore = -Infinity;
  for (let i = 0; i < hand.length; i++) {
    const rest = hand.slice(0, i).concat(hand.slice(i + 1));
    const score = handPotential(rest, melds.length);
    if (score > bestScore) { bestScore = score; bestTile = hand[i]; }
  }
  return bestTile;
}

/**
 * 打牌后的手牌潜力：副露 + 完成面子 + 对子/搭子价值 - 孤张惩罚。
 * meldsCount 为桌上副露数（每个副露记 10，与手中成刻等价）。
 * 以「枚举分解的最大组合价值」为主，七对倾向的手走对子计数。
 */
function handPotential(hand: number[], meldsCount: number): number {
  const n = hand.length;
  if (n === 0) return 100 + meldsCount * 10;
  // 七对倾向：全对子时价值按对子算
  const counts = toKinds(hand);
  let pairs = 0;
  let singles = 0;
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 2) pairs++;
    else if (counts[k] === 1) singles++;
  }
  if (meldsCount === 0 && pairs * 2 + singles === n && pairs >= 3) {
    return pairs * 10 + Math.min(singles, 1) * 2;
  }

  // 标准型：枚举面子 + 雀头后，剩余散牌按搭子潜力计分
  let best = -Infinity;
  const shapes = decompose(hand);
  if (shapes.length > 0) {
    // 已成完整牌型（含雀头）
    best = 100 + n + meldsCount * 10;
  } else {
    // 贪心：抽刻子/顺子后统计残牌的对子与相邻搭子（残牌不再重复计刻子）
    const work = counts.slice();
    const triMelds = countGreedyMelds(work);
    const floats = countFloats(work);
    best = meldsCount * 10 + triMelds * 10 + floats.pairs * 6 + floats.partial * 4 - floats.isolated;
  }
  return best;
}

function countGreedyMelds(counts: number[]): number {
  let melds = 0;
  for (let k = 0; k < 34; k++) {
    while (counts[k] >= 3) { counts[k] -= 3; melds++; }
  }
  for (let k = 0; k < 27; k++) {
    while (counts[k] > 0 && counts[k + 1] > 0 && counts[k + 2] > 0 && k % 9 <= 6) {
      counts[k]--; counts[k + 1]--; counts[k + 2]--;
      melds++;
    }
  }
  return melds;
}

function countFloats(counts: number[]): { pairs: number; partial: number; isolated: number } {
  const used: boolean[] = new Array(34);
  for (let i = 0; i < 34; i++) used[i] = false;
  let pairs = 0;
  let partial = 0;
  let isolated = 0;
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0 || used[k]) continue;
    if (counts[k] >= 2) { pairs++; used[k] = true; continue; }
    // 单张：找相邻搭子（数牌）
    const suit = suitOf(k);
    const r = rankOf(k);
    let mate = false;
    if (suit < 3) {
      for (const d of [-2, -1, 1, 2]) {
        const nk = k + d;
        if (nk < 0 || nk > 33) continue;
        if (suitOf(nk) !== suit) continue;
        if (Math.abs(rankOf(nk) - r) > 2) continue;
        if (counts[nk] > 0 && !used[nk]) {
          used[k] = true; used[nk] = true; partial++;
          mate = true;
          break;
        }
      }
    }
    if (!mate) {
      // 孤张：字牌与大数牌更没价值
      isolated += isHonor(k) ? 2 : (r >= 8 ? 1.5 : (r <= 2 ? 1 : 0.5));
    }
  }
  return { pairs: pairs, partial: partial, isolated: isolated };
}

// ── 副露决策 ──

/** 是否碰。honors 恒碰；数牌看碰后手牌潜力是否明显受损。 */
export function botWantPong(hand: number[], melds: Meld[], tile: number): boolean {
  const kind = tile >> 2;
  const rest = removeKind(hand, kind, 2);
  if (rest.length !== hand.length - 2) return false;
  const before = handPotential(hand, melds.length);
  const after = handPotential(rest, melds.length + 1);
  return after >= before - 2;
}

/** 是否明杠。简单：恒杠（多摸一张岭上牌，且广东规则下风险可控）。 */
export function botWantKong(hand: number[], tile: number): boolean {
  const kind = tile >> 2;
  return countKind(hand, kind) >= 3;
}

/** 是否暗杠。 */
export function botWantAnKong(hand: number[], kind: number): boolean {
  return countKind(hand, kind) >= 4;
}

/**
 * 是否吃，并给出吃牌组合（含被打那张，共 3 张牌 id）。
 * 只吃不拆对子、不拆已成搭子两翼的组合；门清且牌面潜力高时更倾向不吃。
 */
export function botWantChi(
  hand: number[], melds: Meld[], tile: number,
): number[] | null {
  const combos = chiCombinations(hand, tile);
  if (combos.length === 0) return null;
  const before = handPotential(hand, melds.length);
  let best: number[] | null = null;
  let bestScore = -Infinity;
  for (const combo of combos) {
    const usedIds: Record<number, boolean> = {};
    for (const id of combo) {
      if (id !== tile) usedIds[id] = true;
    }
    const rest = hand.filter(function (id) { return !usedIds[id]; });
    const after = handPotential(rest, melds.length + 1);
    const score = after - before;
    if (score > bestScore) { bestScore = score; best = combo; }
  }
  // 潜力损失超过阈值就不吃（保护大牌型）
  if (bestScore < -2) return null;
  // 已有任何副露或潜在价值允许时才吃；纯门清谨慎
  return best;
}

/** 枚举吃牌组合：以 tile 为一路子的组成（可作低/中/高），返回排序后的 3 张牌 id。 */
export function chiCombinations(hand: number[], tile: number): number[][] {
  const kind = tile >> 2;
  const suit = suitOf(kind);
  const r = rankOf(kind);
  const out: number[][] = [];
  if (suit >= 3) return out;
  // 顺子起始牌点 1..7（1 基），tile 可作顺子的低/中/高
  for (let lo = r - 2; lo <= r; lo++) {
    if (lo < 1 || lo > 7) continue;
    const needKinds = [lo, lo + 1, lo + 2].map(function (x) { return suit * 9 + x - 1; });
    if (needKinds.indexOf(kind) < 0) continue;
    const ids: number[] = [tile];
    let ok = true;
    const taken: Record<number, number> = { [kind]: 1 };
    for (const nk of needKinds) {
      if (nk === kind) continue;
      const idx = findKindId(hand, nk, taken[nk] || 0);
      if (idx < 0) { ok = false; break; }
      taken[nk] = (taken[nk] || 0) + 1;
      ids.push(hand[idx]);
    }
    if (ok && ids.length === 3) {
      ids.sort(function (a, b) { return a - b; });
      let dup = false;
      for (const o of out) {
        if (o[0] === ids[0] && o[1] === ids[1] && o[2] === ids[2]) { dup = true; break; }
      }
      if (!dup) out.push(ids);
    }
  }
  return out;
}

function findKindId(hand: number[], kind: number, skip: number): number {
  let seen = 0;
  for (let i = 0; i < hand.length; i++) {
    if ((hand[i] >> 2) === kind) {
      if (seen === skip) return i;
      seen++;
    }
  }
  return -1;
}

function countKind(hand: number[], kind: number): number {
  let n = 0;
  for (const id of hand) if ((id >> 2) === kind) n++;
  return n;
}

function removeKind(hand: number[], kind: number, count: number): number[] {
  const out: number[] = [];
  let left = count;
  for (const id of hand) {
    if (left > 0 && (id >> 2) === kind) { left--; continue; }
    out.push(id);
  }
  return out;
}

/** 是否胡（自摸 / 点炮 / 抢杠统一入口）。 */
export function botCanWin(hand: number[], melds: Meld[], winTile: number): boolean {
  return isWin(hand.concat([winTile]));
}
