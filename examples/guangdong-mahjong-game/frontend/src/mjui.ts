// 麻将前端本地选项推导（服务端仍是权威校验方）：
// 吃/碰/杠/胡能否动作、吃牌多解组合枚举 —— 与 backend/src/ai.ts 中
// chiCombinations 同一套规则的前端副本，两端必须同步！

import { isWin, suitOf, rankOf, type Meld } from './tiles';

export function countKind(hand: number[], kind: number): number {
  let n = 0;
  for (const id of hand) if ((id >> 2) === kind) n++;
  return n;
}

/** 能否胡（点炮/抢杠：暗牌 + 被打的牌；自摸：暗牌已含胡张）。 */
export function canWinOn(hand: number[], tile: number): boolean {
  return isWin(hand.concat([tile]));
}

export function canSelfWin(hand: number[]): boolean {
  return isWin(hand);
}

/** 能否碰。 */
export function canPong(hand: number[], tile: number): boolean {
  return countKind(hand, tile >> 2) >= 2;
}

/** 能否明杠。 */
export function canKongOn(hand: number[], tile: number): boolean {
  return countKind(hand, tile >> 2) >= 3;
}

/** 能否暗杠：返回可杠的实体牌 id（同种 4 张中的第一张）。 */
export function anKongTiles(hand: number[]): number[] {
  const out: number[] = [];
  const seen: Record<number, boolean> = {};
  for (const id of hand) {
    const k = id >> 2;
    if (seen[k]) continue;
    if (countKind(hand, k) >= 4) { out.push(id); seen[k] = true; }
  }
  return out;
}

/** 能否补杠：返回可补的实体牌 id（对应副露为碰）。 */
export function buKongTiles(hand: number[], melds: Meld[]): number[] {
  const out: number[] = [];
  for (const m of melds) {
    if (m.type !== 'pong') continue;
    const k = m.tiles[0] >> 2;
    const id = hand.find((t) => (t >> 2) === k);
    if (id !== undefined) out.push(id);
  }
  return out;
}

/** 枚举吃牌组合（仅上家）：每个组合为 3 张实体牌 id（含被打的那张）。 */
export function chiCombinations(hand: number[], tile: number): number[][] {
  const kind = tile >> 2;
  const suit = suitOf(kind);
  const r = rankOf(kind);
  const out: number[][] = [];
  if (suit >= 3) return out;
  // 顺子起始牌点 1..7（1 基），tile 可作顺子的低/中/高
  for (let lo = r - 2; lo <= r; lo++) {
    if (lo < 1 || lo > 7) continue;
    const needKinds = [lo, lo + 1, lo + 2].map((x) => suit * 9 + x - 1);
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
      ids.sort((a, b) => a - b);
      if (!out.some((o) => o[0] === ids[0] && o[1] === ids[1] && o[2] === ids[2])) {
        out.push(ids);
      }
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
