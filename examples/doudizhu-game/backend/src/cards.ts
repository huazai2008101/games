// 斗地主牌型引擎 —— 牌编码、牌型识别、比较、合法出牌枚举（提示/AI 共用）。
//
// 牌编码（0..53）：
//   0..51   普通牌：rankIndex * 4 + suit，suit 0..3 = ♦ ♣ ♥ ♠
//   52      小王（黑），53 大王（红）
//
// 权值 value（用于比较大小）：
//   3..10 → 3..10，J/Q/K/A → 11..14，2 → 15，小王 → 16，大王 → 17。
//   顺子/连对/飞机只允许 3..A（value 3..14），2 与王不可入顺。

export const DECK_SIZE = 54;

export const VALUE_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = ['♦', '♣', '♥', '♠'];

export const COMBO = {
  SINGLE: 'single',
  PAIR: 'pair',
  TRIO: 'trio',
  TRIO_SINGLE: 'trio_single',
  TRIO_PAIR: 'trio_pair',
  STRAIGHT: 'straight',
  PAIR_STRAIGHT: 'pair_straight',
  PLANE: 'plane',
  PLANE_SINGLE: 'plane_single',
  PLANE_PAIR: 'plane_pair',
  FOUR_TWO_SINGLE: 'four_two_single',
  FOUR_TWO_PAIR: 'four_two_pair',
  BOMB: 'bomb',
  ROCKET: 'rocket',
} as const;

export type ComboType = typeof COMBO[keyof typeof COMBO];

export interface Combo {
  type: ComboType;
  /** 主牌权值：顺子取最高牌，飞机取最高三张，炸弹取四张权值，王炸 17。 */
  value: number;
  /** 牌张数；跟牌时必须与上家一致（炸弹/王炸除外）。 */
  size: number;
  cards: number[];
}

/** 生成一整副 54 张牌（已洗好的数组由 game 层负责）。 */
export function fullDeck(): number[] {
  const deck: number[] = [];
  for (let i = 0; i < DECK_SIZE; i++) deck.push(i);
  return deck;
}

export function cardValue(id: number): number {
  if (id === 52) return 16;
  if (id === 53) return 17;
  return Math.floor(id / 4) + 3;
}

/** 0..12 的 rankIndex 对应的权值（3..15）。 */
export function rankIndexValue(rankIndex: number): number {
  return rankIndex + 3;
}

export function cardLabel(id: number): string {
  if (id === 52) return '小王';
  if (id === 53) return '大王';
  return VALUE_LABELS[Math.floor(id / 4)] + SUITS[id % 4];
}

export function sortCardsDesc(cards: number[]): number[] {
  // 权值降序，同权值按 id 降序（大牌在前，UI 直接使用）。
  return cards.slice().sort((a, b) => (cardValue(b) - cardValue(a)) || (b - a));
}

/** 按 value 分桶：value → 该权值的牌 id 数组（升序）。 */
export function countByValue(cards: number[]): Record<number, number[]> {
  const buckets: Record<number, number[]> = {};
  for (let i = 0; i < cards.length; i++) {
    const v = cardValue(cards[i]);
    if (!buckets[v]) buckets[v] = [];
    buckets[v].push(cards[i]);
  }
  return buckets;
}

function bucketsSortedAsc(buckets: Record<number, number[]>): number[] {
  const values: number[] = [];
  for (const k in buckets) values.push(Number(k));
  values.sort((a, b) => a - b);
  return values;
}

function combo(type: ComboType, value: number, cards: number[]): Combo {
  return { type: type, value: value, size: cards.length, cards: sortCardsDesc(cards) };
}

/**
 * 识别一手牌的牌型；不合法返回 null。
 * 翅膀（三带一/二、飞机带单/对、四带二）尽量宽容：只要结构上成立即认可。
 */
export function detectCombo(cards: number[]): Combo | null {
  const n = cards.length;
  if (n === 0) return null;
  const buckets = countByValue(cards);
  const values = bucketsSortedAsc(buckets);

  // 王炸
  if (n === 2 && buckets[16] && buckets[17]) return combo(COMBO.ROCKET, 17, cards);
  // 火箭之外不允许双王成对
  if (n === 2 && (buckets[16] || buckets[17])) return null;
  if (n === 2) {
    const v = values[0];
    if (buckets[v].length === 2) return combo(COMBO.PAIR, v, cards);
    return null;
  }
  if (n === 1) return combo(COMBO.SINGLE, values[0], cards);
  if (n === 3) {
    if (values.length === 1) return combo(COMBO.TRIO, values[0], cards);
    return null;
  }
  if (n === 4) {
    // 炸弹 / 三带一
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (buckets[v].length === 4) return combo(COMBO.BOMB, v, cards);
    }
    if (values.length === 2) {
      const a = values[0], b = values[1];
      if (buckets[a].length === 3 || buckets[b].length === 3) {
        const trioV = buckets[a].length === 3 ? a : b;
        return combo(COMBO.TRIO_SINGLE, trioV, cards);
      }
    }
    return null;
  }

  // 纯顺子（≥5，3..A）
  if (isConsecutive(values) && values[values.length - 1] <= 14) {
    // 每个权值恰好 1 张
    let allSingles = true;
    for (let i = 0; i < values.length; i++) {
      if (buckets[values[i]].length !== 1) { allSingles = false; break; }
    }
    if (allSingles && n >= 5) return combo(COMBO.STRAIGHT, values[values.length - 1], cards);
  }

  // 连对（≥3 对，3..A）
  if (values.length >= 3 && values[values.length - 1] <= 14 && n === values.length * 2) {
    let allPairs = true;
    for (let i = 0; i < values.length; i++) {
      if (buckets[values[i]].length !== 2) { allPairs = false; break; }
    }
    if (allPairs && isConsecutive(values)) {
      return combo(COMBO.PAIR_STRAIGHT, values[values.length - 1], cards);
    }
  }

  // 四带二（两单或两对）
  let quad = -1;
  for (let i = 0; i < values.length; i++) {
    if (buckets[values[i]].length === 4) { quad = values[i]; break; }
  }
  if (quad >= 0) {
    const rest: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] === quad) continue;
      const b = buckets[values[i]];
      for (let j = 0; j < b.length; j++) rest.push(b[j]);
    }
    if (n === 6 && rest.length === 2) return combo(COMBO.FOUR_TWO_SINGLE, quad, cards);
    if (n === 8 && rest.length === 4) {
      const rb = countByValue(rest);
      const rv = bucketsSortedAsc(rb);
      let pairs = 0;
      for (let i = 0; i < rv.length; i++) pairs += Math.floor(rb[rv[i]].length / 2);
      if (pairs === 2) return combo(COMBO.FOUR_TWO_PAIR, quad, cards);
    }
  }

  // 三带一 / 三带二（剩余情况：4 张已被上面处理）
  if (n === 5 && values.length === 2) {
    const a = values[0], b = values[1];
    if (buckets[a].length === 3 && buckets[b].length === 2) return combo(COMBO.TRIO_PAIR, a, cards);
    if (buckets[b].length === 3 && buckets[a].length === 2) return combo(COMBO.TRIO_PAIR, b, cards);
  }

  // 飞机（纯 / 带单 / 带对）
  const plane = detectPlane(cards, buckets, values, n);
  if (plane) return plane;

  return null;
}

function isConsecutive(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

/** 飞机识别：纯飞机 3n、带单 4n、带对 5n；三张主体必须为连续 3..A。 */
function detectPlane(
  cards: number[],
  buckets: Record<number, number[]>,
  values: number[],
  n: number,
): Combo | null {
  // 收集可作为三张主体的权值（3..A 且 count>=3）
  const trioValues: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v >= 3 && v <= 14 && buckets[v].length >= 3) trioValues.push(v);
  }
  if (trioValues.length < 2) return null;

  // 枚举所有长度 ≥2 的连续段
  const runs: number[][] = [];
  for (let start = 0; start < trioValues.length - 1; start++) {
    const run = [trioValues[start]];
    for (let i = start + 1; i < trioValues.length; i++) {
      if (trioValues[i] === run[run.length - 1] + 1) {
        run.push(trioValues[i]);
      } else {
        break;
      }
    }
    if (run.length >= 2) runs.push(run);
  }

  // n 由总张数反推；优先纯飞机（3n），其次带单（4n）、带对（5n）
  const variants: Array<{ wing: number; kind: ComboType }> = [
    { wing: 3, kind: COMBO.PLANE },
    { wing: 4, kind: COMBO.PLANE_SINGLE },
    { wing: 5, kind: COMBO.PLANE_PAIR },
  ];
  for (let vi = 0; vi < variants.length; vi++) {
    const per = variants[vi].wing;
    if (n % per !== 0) continue;
    const need = n / per;
    if (need < 2) continue;
    // 找能提供 need 个连续三张的最高段
    for (let ri = runs.length - 1; ri >= 0; ri--) {
      const run = runs[ri];
      if (run.length < need) continue;
      for (let end = run.length; end >= need; end--) {
        const chosen = run.slice(end - need, end);
        const used: Record<number, boolean> = {};
        for (let i = 0; i < chosen.length; i++) used[chosen[i]] = true;
        // 剩余牌作为翅膀
        const rest: number[] = [];
        for (let i = 0; i < values.length; i++) {
          const v = values[i];
          const b = buckets[v];
          const take = used[v] ? Math.max(0, b.length - 3) : b.length;
          for (let j = 0; j < take; j++) rest.push(b[j]);
        }
        if (rest.length !== need * (per - 3)) continue;
        if (per === 3) {
          return combo(COMBO.PLANE, chosen[chosen.length - 1], cards);
        }
        if (per === 4) {
          // 翅膀为任意 need 张单牌（王炸拆开的王也算单）
          return combo(COMBO.PLANE_SINGLE, chosen[chosen.length - 1], cards);
        }
        // 带对：剩余牌需能组成 need 个对（王炸不能成对）
        const rb = countByValue(rest);
        const rv = bucketsSortedAsc(rb);
        let pairs = 0;
        let ok = true;
        for (let i = 0; i < rv.length; i++) {
          if (rb[rv[i]].length % 2 !== 0) { ok = false; break; }
          if (rv[i] >= 16) { ok = false; break; }
          pairs += rb[rv[i]].length / 2;
        }
        if (ok && pairs === need) {
          return combo(COMBO.PLANE_PAIR, chosen[chosen.length - 1], cards);
        }
      }
    }
  }
  return null;
}

/** a 是否压过 b；b 为 null（自由出牌）时只要牌型合法即可。 */
export function beats(a: Combo, b: Combo | null): boolean {
  if (!b) return true;
  if (a.type === COMBO.ROCKET) return true;
  if (b.type === COMBO.ROCKET) return false;
  if (a.type === COMBO.BOMB) {
    if (b.type === COMBO.BOMB) return a.value > b.value;
    return true;
  }
  if (b.type === COMBO.BOMB) return false;
  return a.type === b.type && a.size === b.size && a.value > b.value;
}

/** 校验 hand 中出的 cards 是否为合法（且能压过 last）的一次出牌。 */
export function validatePlay(hand: number[], cards: number[], last: Combo | null): Combo | null {
  if (cards.length === 0) return null;
  const present: Record<number, boolean> = {};
  const selected: Record<number, boolean> = {};
  for (let i = 0; i < hand.length; i++) present[hand[i]] = true;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    // 牌 ID 是实体牌而不是点数；同一张牌重复提交不能被识别成对子/三张。
    if (!isFinite(card) || Math.floor(card) !== card || card < 0 || card >= DECK_SIZE) return null;
    if (!present[card] || selected[card]) return null;
    selected[card] = true;
  }
  const c = detectCombo(cards);
  if (!c) return null;
  if (!beats(c, last)) return null;
  return c;
}

// ── 合法出牌枚举（AI 与客户端提示共用）──

function removeCards(hand: number[], cards: number[]): number[] {
  const rest = hand.slice();
  for (let i = 0; i < cards.length; i++) {
    const idx = rest.indexOf(cards[i]);
    if (idx >= 0) rest.splice(idx, 1);
  }
  return rest;
}

function trioRunsFrom(buckets: Record<number, number[]>): Array<{ lo: number; hi: number }> {
  // 连续三张段（3..A，count>=3）
  const values: number[] = [];
  for (const k in buckets) {
    const v = Number(k);
    if (v >= 3 && v <= 14 && buckets[k].length >= 3) values.push(v);
  }
  values.sort((a, b) => a - b);
  const runs: Array<{ lo: number; hi: number }> = [];
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    if (j > i) runs.push({ lo: values[i], hi: values[j] });
    i = j + 1;
  }
  return runs;
}

/** 找到一组“最小”的翅膀：从 rest 中挑 count 张（单）或 count 个对（对），保护炸弹与王。 */
function pickWings(rest: number[], count: number, asPairs: boolean): number[] | null {
  const buckets = countByValue(rest);
  const values = bucketsSortedAsc(buckets);
  if (!asPairs) {
    // 单牌翅膀：按权值升序逐张取（王留到最后；整炸弹拆散放最后）
    const picked: number[] = [];
    const order: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (buckets[v].length === 4) continue; // 炸弹不动
      for (let j = 0; j < buckets[v].length; j++) order.push(buckets[v][j]);
    }
    for (let i = 0; i < values.length; i++) {
      if (buckets[values[i]].length === 4) {
        for (let j = 0; j < 4; j++) order.push(buckets[values[i]][j]);
      }
    }
    if (order.length < count) return null;
    for (let i = 0; i < count; i++) picked.push(order[i]);
    return picked;
  }
  // 对牌翅膀：每个权值取一对（王炸不能成对；炸弹保护不拆）
  const picked: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v >= 16) continue;
    const b = buckets[v];
    const take = b.length === 4 ? 1 : Math.floor(b.length / 2);
    for (let p = 0; p < take && picked.length < count * 2; p++) {
      picked.push(b[p * 2], b[p * 2 + 1]);
    }
    if (picked.length >= count * 2) break;
  }
  if (picked.length < count * 2) return null;
  return picked;
}

/**
 * 枚举手牌的全部合法出牌（不含 pass）。
 * 翅膀型（三带/飞机带/四带二）每组主体只生成一组代表性翅膀（最小牌），供
 * AI 与“提示”使用；对手出牌的精确校验走 detectCombo，不受影响。
 */
export function findPlays(hand: number[], last: Combo | null): Combo[] {
  const out: Combo[] = [];
  const buckets = countByValue(hand);
  const values = bucketsSortedAsc(buckets);

  const push = (c: Combo | null) => { if (c && beats(c, last)) out.push(c); };

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const b = buckets[v];
    push(combo(COMBO.SINGLE, v, [b[0]]));
    if (b.length >= 2) push(combo(COMBO.PAIR, v, [b[0], b[1]]));
    if (b.length >= 3) push(combo(COMBO.TRIO, v, [b[0], b[1], b[2]]));
    if (b.length === 4) push(combo(COMBO.BOMB, v, b.slice()));
  }
  if (buckets[16] && buckets[17]) {
    push(combo(COMBO.ROCKET, 17, [buckets[16][0], buckets[17][0]]));
  }

  // 顺子
  for (let len = 5; len <= 12; len++) {
    for (let lo = 3; lo + len - 1 <= 14; lo++) {
      let ok = true;
      const cards: number[] = [];
      for (let v = lo; v < lo + len; v++) {
        if (!buckets[v]) { ok = false; break; }
        cards.push(buckets[v][0]);
      }
      if (ok) push(combo(COMBO.STRAIGHT, lo + len - 1, cards));
    }
  }

  // 连对
  for (let len = 3; len <= 10; len++) {
    for (let lo = 3; lo + len - 1 <= 14; lo++) {
      let ok = true;
      const cards: number[] = [];
      for (let v = lo; v < lo + len; v++) {
        if (!buckets[v] || buckets[v].length < 2) { ok = false; break; }
        cards.push(buckets[v][0], buckets[v][1]);
      }
      if (ok) push(combo(COMBO.PAIR_STRAIGHT, lo + len - 1, cards));
    }
  }

  // 纯飞机
  const runs = trioRunsFrom(buckets);
  for (let ri = 0; ri < runs.length; ri++) {
    for (let lo = runs[ri].lo; lo <= runs[ri].hi; lo++) {
      for (let len = 2; lo + len - 1 <= runs[ri].hi; len++) {
        const cards: number[] = [];
        for (let v = lo; v < lo + len; v++) {
          cards.push(buckets[v][0], buckets[v][1], buckets[v][2]);
        }
        push(combo(COMBO.PLANE, lo + len - 1, cards));
      }
    }
  }

  // 带翅膀的牌型：每组主体 + 最小翅膀（代表解）
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const b = buckets[v];
    if (b.length >= 3) {
      const trio = [b[0], b[1], b[2]];
      const rest = removeCards(hand, trio);
      const w1 = pickWings(rest, 1, false);
      if (w1) push(combo(COMBO.TRIO_SINGLE, v, trio.concat(w1)));
      const p1 = pickWings(rest, 1, true);
      if (p1) push(combo(COMBO.TRIO_PAIR, v, trio.concat(p1)));
    }
    if (b.length === 4) {
      const quad = b.slice();
      const rest = removeCards(hand, quad);
      const w2 = pickWings(rest, 2, false);
      if (w2) push(combo(COMBO.FOUR_TWO_SINGLE, v, quad.concat(w2)));
      const p2 = pickWings(rest, 2, true);
      if (p2) push(combo(COMBO.FOUR_TWO_PAIR, v, quad.concat(p2)));
    }
  }

  // 飞机带单/带对
  for (let ri = 0; ri < runs.length; ri++) {
    for (let lo = runs[ri].lo; lo <= runs[ri].hi; lo++) {
      for (let len = 2; lo + len - 1 <= runs[ri].hi; len++) {
        if (len > 3) continue; // 组合爆炸控制：AI 只考虑 ≤3 段主体
        const trio: number[] = [];
        for (let v = lo; v < lo + len; v++) trio.push(buckets[v][0], buckets[v][1], buckets[v][2]);
        const rest = removeCards(hand, trio);
        const w1 = pickWings(rest, len, false);
        if (w1) push(combo(COMBO.PLANE_SINGLE, lo + len - 1, trio.concat(w1)));
        const w2 = pickWings(rest, len, true);
        if (w2) push(combo(COMBO.PLANE_PAIR, lo + len - 1, trio.concat(w2)));
      }
    }
  }

  out.sort((a, b) => (a.size - b.size) || (a.value - b.value));
  return out;
}

/**
 * 手牌战力评估（0..20+），用于 AI 叫分与托管选择。
 */
export function handStrength(cards: number[]): number {
  const buckets = countByValue(cards);
  let s = 0;
  if (buckets[17]) s += 5;
  if (buckets[16]) s += 3;
  if (buckets[16] && buckets[17]) s += 3; // 王炸加成
  const values = bucketsSortedAsc(buckets);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const c = buckets[v].length;
    if (c === 4) s += 8; // 炸弹
    if (v === 15) s += 2 * Math.min(c, 2);
    if (v === 14) s += 1 * Math.min(c, 2);
  }
  return s;
}
