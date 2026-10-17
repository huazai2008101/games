// 斗地主牌型引擎（前端副本）—— 与 backend/src/cards.ts 保持同一套规则：
// 用于本地出牌校验与"提示"枚举；服务端仍是权威校验方。
// 修改规则时必须两端同步！

export const DECK_SIZE = 54;
export const VALUE_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = ['♦', '♣', '♥', '♠'] as const;

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
  value: number;
  size: number;
  cards: number[];
}

export function fullDeck(): number[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => i);
}

export function cardValue(id: number): number {
  if (id === 52) return 16;
  if (id === 53) return 17;
  return Math.floor(id / 4) + 3;
}

export function cardLabel(id: number): string {
  if (id === 52) return '小王';
  if (id === 53) return '大王';
  return VALUE_LABELS[Math.floor(id / 4)] + SUITS[id % 4];
}

export function isRedCard(id: number): boolean {
  if (id === 53) return true;
  if (id === 52) return false;
  const suit = id % 4; // 0=♦ 1=♣ 2=♥ 3=♠
  return suit === 0 || suit === 2;
}

export function sortCardsDesc(cards: number[]): number[] {
  return cards.slice().sort((a, b) => (cardValue(b) - cardValue(a)) || (b - a));
}

/** 亮牌/展示用升序（小→大，符合实体牌持牌习惯）。 */
export function sortCardsAsc(cards: number[]): number[] {
  return cards.slice().sort((a, b) => (cardValue(a) - cardValue(b)) || (a - b));
}

export function countByValue(cards: number[]): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (const c of cards) {
    const v = cardValue(c);
    const arr = buckets.get(v);
    if (arr) arr.push(c);
    else buckets.set(v, [c]);
  }
  return buckets;
}

function bucketsSortedAsc(b: Map<number, number[]>): number[] {
  return [...b.keys()].sort((x, y) => x - y);
}

function combo(type: ComboType, value: number, cards: number[]): Combo {
  return { type, value, size: cards.length, cards: sortCardsDesc(cards) };
}

export function detectCombo(cards: number[]): Combo | null {
  const n = cards.length;
  if (n === 0) return null;
  const buckets = countByValue(cards);
  const values = bucketsSortedAsc(buckets);

  if (n === 2 && buckets.has(16) && buckets.has(17)) return combo(COMBO.ROCKET, 17, cards);
  if (n === 2 && (buckets.has(16) || buckets.has(17))) return null;
  if (n === 2) {
    return buckets.get(values[0])!.length === 2 ? combo(COMBO.PAIR, values[0], cards) : null;
  }
  if (n === 1) return combo(COMBO.SINGLE, values[0], cards);
  if (n === 3) {
    return values.length === 1 ? combo(COMBO.TRIO, values[0], cards) : null;
  }
  if (n === 4) {
    for (const v of values) {
      if (buckets.get(v)!.length === 4) return combo(COMBO.BOMB, v, cards);
    }
    if (values.length === 2) {
      const a = buckets.get(values[0])!.length;
      const b = buckets.get(values[1])!.length;
      if (a === 3 || b === 3) {
        const trioV = a === 3 ? values[0] : values[1];
        return combo(COMBO.TRIO_SINGLE, trioV, cards);
      }
    }
    return null;
  }

  if (isConsecutive(values) && values[values.length - 1] <= 14) {
    const allSingles = values.every((v) => buckets.get(v)!.length === 1);
    if (allSingles && n >= 5) return combo(COMBO.STRAIGHT, values[values.length - 1], cards);
  }

  if (values.length >= 3 && values[values.length - 1] <= 14 && n === values.length * 2) {
    const allPairs = values.every((v) => buckets.get(v)!.length === 2);
    if (allPairs && isConsecutive(values)) {
      return combo(COMBO.PAIR_STRAIGHT, values[values.length - 1], cards);
    }
  }

  const quad = values.find((v) => buckets.get(v)!.length === 4);
  if (quad !== undefined) {
    const rest: number[] = [];
    for (const v of values) {
      if (v === quad) continue;
      rest.push(...buckets.get(v)!);
    }
    if (n === 6 && rest.length === 2) return combo(COMBO.FOUR_TWO_SINGLE, quad, cards);
    if (n === 8 && rest.length === 4) {
      const rb = countByValue(rest);
      let pairs = 0;
      let ok = true;
      for (const [, arr] of rb) {
        if (arr.length % 2 !== 0) { ok = false; break; }
        pairs += arr.length / 2;
      }
      if (ok && pairs === 2) return combo(COMBO.FOUR_TWO_PAIR, quad, cards);
    }
  }

  if (n === 5 && values.length === 2) {
    const [a, b] = values;
    if (buckets.get(a)!.length === 3 && buckets.get(b)!.length === 2) return combo(COMBO.TRIO_PAIR, a, cards);
    if (buckets.get(b)!.length === 3 && buckets.get(a)!.length === 2) return combo(COMBO.TRIO_PAIR, b, cards);
  }

  return detectPlane(cards, buckets, values, n);
}

function isConsecutive(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

function detectPlane(
  cards: number[],
  buckets: Map<number, number[]>,
  values: number[],
  n: number,
): Combo | null {
  const trioValues = values.filter((v) => v >= 3 && v <= 14 && buckets.get(v)!.length >= 3);
  if (trioValues.length < 2) return null;

  const runs: number[][] = [];
  for (let start = 0; start < trioValues.length - 1; start++) {
    const run = [trioValues[start]];
    for (let i = start + 1; i < trioValues.length; i++) {
      if (trioValues[i] === run[run.length - 1] + 1) run.push(trioValues[i]);
      else break;
    }
    if (run.length >= 2) runs.push(run);
  }

  const variants: Array<{ per: number; kind: ComboType }> = [
    { per: 3, kind: COMBO.PLANE },
    { per: 4, kind: COMBO.PLANE_SINGLE },
    { per: 5, kind: COMBO.PLANE_PAIR },
  ];
  for (const { per, kind } of variants) {
    if (n % per !== 0) continue;
    const need = n / per;
    if (need < 2) continue;
    for (let ri = runs.length - 1; ri >= 0; ri--) {
      const run = runs[ri];
      if (run.length < need) continue;
      for (let end = run.length; end >= need; end--) {
        const chosen = run.slice(end - need, end);
        const used = new Set(chosen);
        const rest: number[] = [];
        for (const v of values) {
          const b = buckets.get(v)!;
          const take = used.has(v) ? Math.max(0, b.length - 3) : b.length;
          for (let j = 0; j < take; j++) rest.push(b[j]);
        }
        if (rest.length !== need * (per - 3)) continue;
        if (per === 3) return combo(COMBO.PLANE, chosen[chosen.length - 1], cards);
        if (per === 4) return combo(COMBO.PLANE_SINGLE, chosen[chosen.length - 1], cards);
        const rb = countByValue(rest);
        let pairs = 0;
        let ok = true;
        for (const [v, arr] of rb) {
          if (arr.length % 2 !== 0 || v >= 16) { ok = false; break; }
          pairs += arr.length / 2;
        }
        if (ok && pairs === need) return combo(COMBO.PLANE_PAIR, chosen[chosen.length - 1], cards);
      }
    }
  }
  return null;
}

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

export function validatePlay(hand: number[], cards: number[], last: Combo | null): Combo | null {
  if (cards.length === 0) return null;
  const present = new Set(hand);
  const selected = new Set<number>();
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c >= DECK_SIZE || !present.has(c) || selected.has(c)) return null;
    selected.add(c);
  }
  const c = detectCombo(cards);
  if (!c) return null;
  return beats(c, last) ? c : null;
}

function removeCards(hand: number[], cards: number[]): number[] {
  const rest = hand.slice();
  for (const c of cards) {
    const idx = rest.indexOf(c);
    if (idx >= 0) rest.splice(idx, 1);
  }
  return rest;
}

function trioRunsFrom(buckets: Map<number, number[]>): Array<{ lo: number; hi: number }> {
  const values = [...buckets.entries()]
    .filter(([v, arr]) => v >= 3 && v <= 14 && arr.length >= 3)
    .map(([v]) => v)
    .sort((a, b) => a - b);
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

function pickWings(rest: number[], count: number, asPairs: boolean): number[] | null {
  const buckets = countByValue(rest);
  const values = bucketsSortedAsc(buckets);
  if (!asPairs) {
    const picked: number[] = [];
    const order: number[] = [];
    for (const v of values) {
      const b = buckets.get(v)!;
      if (b.length === 4) continue;
      order.push(...b);
    }
    for (const v of values) {
      const b = buckets.get(v)!;
      if (b.length === 4) order.push(...b);
    }
    if (order.length < count) return null;
    for (let i = 0; i < count; i++) picked.push(order[i]);
    return picked;
  }
  const picked: number[] = [];
  for (const v of values) {
    if (v >= 16) continue;
    const b = buckets.get(v)!;
    const take = b.length === 4 ? 1 : Math.floor(b.length / 2);
    for (let p = 0; p < take && picked.length < count * 2; p++) {
      picked.push(b[p * 2], b[p * 2 + 1]);
    }
    if (picked.length >= count * 2) break;
  }
  return picked.length < count * 2 ? null : picked;
}

export function findPlays(hand: number[], last: Combo | null): Combo[] {
  const out: Combo[] = [];
  const buckets = countByValue(hand);
  const values = bucketsSortedAsc(buckets);
  const push = (c: Combo | null) => { if (c && beats(c, last)) out.push(c); };

  for (const v of values) {
    const b = buckets.get(v)!;
    push(combo(COMBO.SINGLE, v, [b[0]]));
    if (b.length >= 2) push(combo(COMBO.PAIR, v, [b[0], b[1]]));
    if (b.length >= 3) push(combo(COMBO.TRIO, v, [b[0], b[1], b[2]]));
    if (b.length === 4) push(combo(COMBO.BOMB, v, b.slice()));
  }
  if (buckets.has(16) && buckets.has(17)) {
    push(combo(COMBO.ROCKET, 17, [buckets.get(16)![0], buckets.get(17)![0]]));
  }

  for (let len = 5; len <= 12; len++) {
    for (let lo = 3; lo + len - 1 <= 14; lo++) {
      const cards: number[] = [];
      let ok = true;
      for (let v = lo; v < lo + len; v++) {
        const b = buckets.get(v);
        if (!b) { ok = false; break; }
        cards.push(b[0]);
      }
      if (ok) push(combo(COMBO.STRAIGHT, lo + len - 1, cards));
    }
  }

  for (let len = 3; len <= 10; len++) {
    for (let lo = 3; lo + len - 1 <= 14; lo++) {
      const cards: number[] = [];
      let ok = true;
      for (let v = lo; v < lo + len; v++) {
        const b = buckets.get(v);
        if (!b || b.length < 2) { ok = false; break; }
        cards.push(b[0], b[1]);
      }
      if (ok) push(combo(COMBO.PAIR_STRAIGHT, lo + len - 1, cards));
    }
  }

  const runs = trioRunsFrom(buckets);
  for (const run of runs) {
    for (let lo = run.lo; lo <= run.hi; lo++) {
      for (let len = 2; lo + len - 1 <= run.hi; len++) {
        const cards: number[] = [];
        for (let v = lo; v < lo + len; v++) {
          const b = buckets.get(v)!;
          cards.push(b[0], b[1], b[2]);
        }
        push(combo(COMBO.PLANE, lo + len - 1, cards));
      }
    }
  }

  for (const v of values) {
    const b = buckets.get(v)!;
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

  for (const run of runs) {
    for (let lo = run.lo; lo <= run.hi; lo++) {
      for (let len = 2; lo + len - 1 <= run.hi; len++) {
        if (len > 3) continue;
        const trio: number[] = [];
        for (let v = lo; v < lo + len; v++) {
          const b = buckets.get(v)!;
          trio.push(b[0], b[1], b[2]);
        }
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
