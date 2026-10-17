// 广东麻将 —— 牌张模型 / 胡牌判定 / 番型计分（服务端权威）
//
// 牌 id：0..135，每 4 张同种牌连续编号：
//   万 0..35   筒 36..71   条 72..107   字 108..135
// 34 种"牌种"kind = id >> 2；字牌种序：东南西北中发白。
// 前端 src/tiles.ts 为同一套规则的前端副本（选项推导/提示），两端必须同步！

export const WALL_SIZE = 136;
export const HAND_SIZE = 13;

export const SUIT_WAN = 0;
export const SUIT_TONG = 1;
export const SUIT_BAM = 2;
export const SUIT_ZHI = 3;

export function suitOf(kind: number): number {
  return Math.floor(kind / 9);
}
/** 数牌 1..9；字牌 1..7（东南西北中发白）。 */
export function rankOf(kind: number): number {
  return (kind % 9) + 1;
}
export function isHonor(kind: number): boolean {
  return kind >= 27;
}

export const KIND_LABELS: string[] = [
  '一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条',
  '东风', '南风', '西风', '北风', '红中', '发财', '白板',
];

export function kindLabel(kind: number): string {
  return KIND_LABELS[kind] || '?';
}

export function fullWall(): number[] {
  const wall: number[] = [];
  for (let i = 0; i < WALL_SIZE; i++) wall.push(i);
  return wall;
}

export function sortTiles(tiles: number[]): number[] {
  return tiles.slice().sort(function (a, b) { return a - b; });
}

export function toKinds(tiles: number[]): number[] {
  const counts = new Array<number>(34);
  for (let i = 0; i < 34; i++) counts[i] = 0;
  for (let i = 0; i < tiles.length; i++) counts[tiles[i] >> 2]++;
  return counts;
}

// ── 胡牌判定 ──
// 暗牌 + 胡牌张一起判定「若干面子 + 雀头」。有杠时暗牌不是 14 张
//（每杠相对标准型少 1 张暗牌），故按 (n-2) % 3 === 0 泛化。
// 枚举全部分解以便番型评估（对对胡/一条龙等需要具体牌型结构）。

export interface WinShape {
  pair: number;                       // 雀头牌种
  melds: Array<{ kind: 'pong' | 'chi'; value: number }>; // value：刻=牌种，顺=起始牌种
}

/** 暗牌的全部「面子 + 雀头」分解（n 张，(n-2)%3===0）。 */
export function decompose(tiles: number[]): WinShape[] {
  const n = tiles.length;
  const shapes: WinShape[] = [];
  if (n < 2 || (n - 2) % 3 !== 0) return shapes;
  const meldCount = (n - 2) / 3;
  const counts = toKinds(tiles);
  const melds: Array<{ kind: 'pong' | 'chi'; value: number }> = [];

  function search(remaining: number, startKind: number): void {
    if (remaining === 0) {
      shapes.push({ pair: -1, melds: melds.slice() });
      return;
    }
    for (let k = startKind; k < 34; k++) {
      if (counts[k] === 0) continue;
      // 刻子
      if (counts[k] >= 3) {
        counts[k] -= 3;
        melds.push({ kind: 'pong', value: k });
        search(remaining - 1, k);
        melds.pop();
        counts[k] += 3;
      }
      // 顺子（仅数牌，且 8/9 不能做起始）
      const suit = suitOf(k);
      if (suit < 3 && rankOf(k) <= 7 && counts[k + 1] > 0 && counts[k + 2] > 0) {
        counts[k]--; counts[k + 1]--; counts[k + 2]--;
        melds.push({ kind: 'chi', value: k });
        search(remaining - 1, k);
        melds.pop();
        counts[k]++; counts[k + 1]++; counts[k + 2]++;
      }
      return; // 最小牌种必须被消化，否则此路不通
    }
  }

  for (let p = 0; p < 34; p++) {
    if (counts[p] >= 2) {
      counts[p] -= 2;
      const before = shapes.length;
      search(meldCount, 0);
      for (let i = before; i < shapes.length; i++) shapes[i].pair = p;
      counts[p] += 2;
    }
  }
  return shapes;
}

export function isSevenPairs(tiles: number[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = toKinds(tiles);
  for (let k = 0; k < 34; k++) {
    if (counts[k] !== 0 && counts[k] !== 2) return false;
  }
  return true;
}

/** 是否胡牌（标准型或七对）。tiles = 暗牌 + 胡牌张。 */
export function isWin(tiles: number[]): boolean {
  if (tiles.length < 2 || tiles.length % 3 !== 2) return false;
  if (tiles.length === 14 && isSevenPairs(tiles)) return true;
  return decompose(tiles).length > 0;
}

// ── 听牌 ──
/** 摸哪些牌种能胡（打牌提示用）。 */
export function waitingKinds(hand13: number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < 34; k++) {
    if (isWin(hand13.concat([k * 4]))) out.push(k);
  }
  return out;
}

// ── 番型计分 ──
// 基础鸡胡 1 番起，加法累计，8 番封顶。

export const FAN_CAP = 8;

export interface Meld {
  type: 'chi' | 'pong' | 'mkong' | 'akong' | 'bkong';
  tiles: number[];
  from?: number;   // 供牌者（chi/pong/mkong）
}

export interface WinContext {
  selfDraw: boolean;   // 自摸（false = 点炮）
  melds: Meld[];       // 胡牌者的副露
  lastTile: boolean;   // 海底/河底（牌墙最后一张）
  kongDraw: boolean;   // 胡的是杠后岭上补牌
  robKong: boolean;    // 抢杠胡
}

export interface FanResult {
  fan: number;
  details: string[];
}

export function evalFan(hand14: number[], ctx: WinContext): FanResult {
  const details: string[] = [];
  let fan = 1;
  details.push('鸡胡 1番');

  // 与胡牌型相关的结构牌张 = 暗牌 + 副露明牌
  let structural = hand14.slice();
  for (const m of ctx.melds) structural = structural.concat(m.tiles);
  const kinds = toKinds(structural);

  const suitsSeen: Record<number, boolean> = {};
  let honorSeen = false;
  for (let k = 0; k < 34; k++) {
    if (kinds[k] === 0) continue;
    if (isHonor(k)) honorSeen = true;
    else suitsSeen[suitOf(k)] = true;
  }
  const suitCount = Object.keys(suitsSeen).length;

  const sevenPairs = ctx.melds.length === 0 && isSevenPairs(hand14);
  if (sevenPairs) {
    fan += 3;
    details.push('七对子 +3');
  }

  // 清一色 / 混一色 / 字一色
  if (suitCount === 1 && !honorSeen) {
    fan += 4;
    details.push('清一色 +4');
  } else if (suitCount === 1 && honorSeen) {
    fan += 2;
    details.push('混一色 +2');
  } else if (suitCount === 0 && honorSeen) {
    fan += 6;
    details.push('字一色 +6');
  }

  // 一条龙：同花色 1..9 各至少一张
  for (const s of [0, 1, 2]) {
    let dragon = true;
    for (let r = 0; r < 9; r++) {
      if (kinds[s * 9 + r] === 0) { dragon = false; break; }
    }
    if (dragon) {
      fan += 2;
      details.push('一条龙 +2');
      break;
    }
  }

  // 对对胡：手牌全为刻/雀 + 副露全为刻杠（七对另计，不叠加）
  if (!sevenPairs) {
    let allTriplets = true;
    for (const m of ctx.melds) {
      if (m.type === 'chi') { allTriplets = false; break; }
    }
    if (allTriplets) {
      for (const shape of decompose(hand14)) {
        let ok = true;
        for (const m of shape.melds) {
          if (m.kind !== 'pong') { ok = false; break; }
        }
        if (ok) {
          fan += 1;
          details.push('对对胡 +1');
          break;
        }
      }
    }
  }

  // 门前清：无吃碰明杠副露（暗杠不算破门）
  let concealed = true;
  for (const m of ctx.melds) {
    if (m.type !== 'akong') { concealed = false; break; }
  }
  if (concealed) {
    fan += 1;
    details.push('门前清 +1');
  }

  if (ctx.selfDraw) { fan += 1; details.push('自摸 +1'); }
  if (ctx.kongDraw) { fan += 1; details.push('杠上开花 +1'); }
  if (ctx.robKong) { fan += 1; details.push('抢杠胡 +1'); }
  if (ctx.lastTile) {
    fan += 1;
    details.push(ctx.selfDraw ? '海底捞月 +1' : '河底捞月 +1');
  }

  if (fan > FAN_CAP) {
    fan = FAN_CAP;
    details.push('8番封顶');
  }
  return { fan: fan, details: details };
}
