// 写实麻将牌面 SVG 生成器 —— 象牙白塑料牌面、书法刻印与多色花纹：
//   风牌/万数字 = 墨色楷体金边；萬/中 = 朱红；發 = 竹绿；白板蓝框；
//   筒 = 墨色外缘 + 金绿红套色的同心环点阵（一筒为大圆环纹）；
//   条 = 绿芯金边双节竹纹（五索中柱为朱红）；
//   幺鸡（一条）= 绿红双色工笔线描雀鸟；牌背墨绿压纹。
//   字符笔画轮廓来自 glyphStrokes.ts（hanzi-writer-data，真实楷体字形）。
// viewBox 统一 60×76（宽高比 ≈ 0.79，贴近真实麻将牌面 3:4～4:5 的矮壮比例），
// 由 MahjongTile.vue 按 xs/sm/md 缩放。

import { GLYPHS } from './glyphStrokes';

export const TILE_VIEWBOX = '0 0 60 76';

const INK = '#111820';    // 墨黑（风牌 / 万数字 / 筒环）
const INK_D = '#030608';
const RED = '#d31d27';    // 朱红（萬 / 中 / 筒环 / 幺鸡红点）
const RED_D = '#87131d';
const GREEN = '#188044';  // 竹绿（竹节 / 發 / 幺鸡）
const GREEN_D = '#07502f';
const BLUE = '#1d4f9c';   // 靛蓝（白板框）
const BLUE_D = '#12356b';
const GOLD = '#c3943d';
const GOLD_LIGHT = '#f0d58b';
const IVORY = '#fffaf0';

const DARKEN: Record<string, string> = {
  [INK]: INK_D, [RED]: RED_D, [GREEN]: GREEN_D, [BLUE]: BLUE_D,
};

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WINDS = ['東', '南', '西', '北'];

/** 多层套色刻字：楷体笔画轮廓、暖金色细边和深色压印阴影。 */
function glyph(cx: number, cy: number, size: number, ch: string, color: string): string {
  const paths = GLYPHS[ch];
  if (!paths) return '';
  const s = size / 100;
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  return (
    `<g transform="translate(${(cx - size / 2).toFixed(1)} ${(cy - size / 2).toFixed(1)}) scale(${s.toFixed(3)})" stroke-linejoin="round">` +
    `<g fill="none" stroke="${GOLD}" stroke-width="4.1" opacity="0.92">${body}</g>` +
    `<g fill="none" stroke="${DARKEN[color]}" stroke-width="2.2">${body}</g>` +
    `<g fill="${color}" stroke="${DARKEN[color]}" stroke-width="0.65">${body}</g>` +
    `<g fill="none" stroke="${GOLD_LIGHT}" stroke-width="0.48" opacity="0.76">${body}</g>` +
    `</g>`
  );
}

/** 花瓣环：内半径圆周上鼓起 n 个花瓣至外半径（一筒内圈纹样） */
function petalRing(cx: number, cy: number, rOut: number, rIn: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (Math.PI * 2 * i) / n - Math.PI / 2;
    const aMid = a0 + Math.PI / n;
    const a1 = a0 + (Math.PI * 2) / n;
    const bx = cx + Math.cos(a0) * rIn, by = cy + Math.sin(a0) * rIn;
    const px = cx + Math.cos(aMid) * rOut, py = cy + Math.sin(aMid) * rOut;
    const nx = cx + Math.cos(a1) * rIn, ny = cy + Math.sin(a1) * rIn;
    if (i === 0) pts.push(`M ${bx.toFixed(2)} ${by.toFixed(2)}`);
    pts.push(`Q ${px.toFixed(2)} ${py.toFixed(2)} ${nx.toFixed(2)} ${ny.toFixed(2)}`);
  }
  pts.push('Z');
  return pts.join(' ');
}

/** 同心环筒纹：墨色压边、金线、彩色内环与深色圆心。 */
function ringDot(cx: number, cy: number, r: number, accent = GREEN): string {
  const inner = accent === RED ? GREEN : RED;
  return (
    `<g fill="none" stroke-linecap="round">` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.96).toFixed(2)}" stroke="${INK_D}" stroke-width="${(r * 0.28).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.81).toFixed(2)}" stroke="${GOLD}" stroke-width="${(r * 0.12).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.64).toFixed(2)}" stroke="${accent}" stroke-width="${(r * 0.18).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.43).toFixed(2)}" stroke="${inner}" stroke-width="${(r * 0.13).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.20).toFixed(2)}" fill="${INK}" stroke="${GOLD_LIGHT}" stroke-width="${(r * 0.055).toFixed(2)}"/>` +
    `<path d="M ${cx - r * 0.56} ${cy - r * 0.53} A ${r * 0.78} ${r * 0.78} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.78}" stroke="${GOLD_LIGHT}" stroke-width="${(r * 0.055).toFixed(2)}" opacity="0.9"/>` +
    `</g>`
  );
}

/** 一筒：大圆环纹 —— 墨色外圈 + 金绿花瓣环 + 红色内芯。 */
function bigRing(cx: number, cy: number, r: number): string {
  return (
    `<g fill="none">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${INK_D}" stroke-width="${(r * 0.16).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.86).toFixed(2)}" stroke="${GOLD}" stroke-width="${(r * 0.075).toFixed(2)}"/>` +
    `<path d="${petalRing(cx, cy, r * 0.76, r * 0.60, 12)}" stroke="${GREEN}" stroke-width="${(r * 0.12).toFixed(2)}"/>` +
    `<path d="${petalRing(cx, cy, r * 0.66, r * 0.58, 12)}" stroke="${GOLD_LIGHT}" stroke-width="${(r * 0.045).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.49).toFixed(2)}" stroke="${RED}" stroke-width="${(r * 0.11).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.32).toFixed(2)}" stroke="${INK}" stroke-width="${(r * 0.09).toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.19).toFixed(2)}" fill="${RED}" stroke="${GOLD_LIGHT}" stroke-width="${(r * 0.045).toFixed(2)}"/>` +
    `</g>`
  );
}

/** 竹节：双节竹纹，深色压边、暖金轮廓和绿/红色珐琅内线。 */
function stick(x: number, y: number, len: number, color = GREEN): string {
  const w = 6.7;
  const loop = len * 0.53;
  const gap = len * 0.43;
  const x0 = (x - w / 2).toFixed(1);
  const y1 = (y + gap).toFixed(1);
  const loopText = loop.toFixed(1);
  const xText = x.toFixed(1);
  const yText = y.toFixed(1);
  const leg = (stroke: string, width: number, dx = 0, fill = 'none', opacity = 1) =>
    `<g fill="${fill}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}" stroke-linecap="round">` +
    `<rect x="${(Number(x0) + dx).toFixed(1)}" y="${yText}" width="${w}" height="${loopText}" rx="${(w / 2).toFixed(1)}"/>` +
    `<rect x="${(Number(x0) + dx).toFixed(1)}" y="${y1}" width="${w}" height="${loopText}" rx="${(w / 2).toFixed(1)}"/>` +
    `</g>`;
  return (
    `<g>` +
    leg(INK_D, 3.2, 0.35, '#d9d0b5', 0.72) +
    leg(GOLD, 2.75) +
    leg(GREEN_D, 2.15) +
    leg(color, 1.42) +
    leg(GOLD_LIGHT, 0.47, -0.12, 'none', 0.92) +
    `<path d="M ${xText} ${yText} Q ${(x + 1.1).toFixed(1)} ${(y + len * 0.18).toFixed(1)} ${xText} ${(y + len * 0.38).toFixed(1)} M ${xText} ${(y + len * 0.58).toFixed(1)} Q ${(x - 1).toFixed(1)} ${(y + len * 0.79).toFixed(1)} ${xText} ${(y + len).toFixed(1)}" fill="none" stroke="${IVORY}" stroke-width="0.42" opacity="0.9"/>` +
    `<path d="M ${(x - 1.45).toFixed(1)} ${(y + len * 0.49).toFixed(1)} Q ${xText} ${(y + len * 0.53).toFixed(1)} ${(x + 1.45).toFixed(1)} ${(y + len * 0.49).toFixed(1)}" fill="none" stroke="${GOLD_LIGHT}" stroke-width="0.7"/>` +
    `</g>`
  );
}

/** 幺鸡（一条）：绿红双色工笔线描雀鸟 —— 红冠红眼、绿身叠翼、长尾下垂 */
function bird(): string {
  const G = GREEN;
  const R = RED;
  return (
    `<g transform="translate(30 42) scale(1.55 1.17) translate(-30 -42)" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    // 顶冠（红）
    `<path d="M25.6 11.6 C25 9.9 26.3 8.9 27.2 10 M28.7 9.7 C29.3 8.4 30.9 9 30.6 10.7" stroke="${R}"/>` +
    // 头（绿圆）
    `<circle cx="27.2" cy="16.4" r="4.9" stroke="${G}"/>` +
    // 喙（绿楔形）+ 眼（红）
    `<path d="M22.5 14.9 L17.4 16.6 L22.7 18.7" stroke="${G}"/>` +
    `<circle cx="28.8" cy="15.6" r="1" fill="${R}" stroke="none"/>` +
    // 背线（头右经背到尾根）
    `<path d="M31.9 14.8 C36 17 38.4 21.5 38.5 26.5 C38.6 30.5 37.6 35 35.2 39" stroke="${G}"/>` +
    // 翼（覆羽叶形 + 内羽线，绿）
    `<path d="M31.3 21.2 C36.1 22.6 38.6 27.2 38 32.8 C33.7 31.2 31.1 26.6 31.3 21.2 Z" stroke="${G}"/>` +
    `<path d="M33.4 24.2 C35.7 26.2 36.9 28.9 37.1 31.4" stroke="${G}"/>` +
    // 胸腹线（喙下经胸到腹底，绿）
    `<path d="M23.3 19.9 C20.7 24.3 20.7 29.4 23 33.4 C24.7 36.4 27.3 38.7 30.4 40.1" stroke="${G}"/>` +
    // 长尾（双线向左下收尖：绿 + 红）
    `<path d="M31.2 40.6 C25.4 47.5 20.4 55.3 17 63.2" stroke="${G}"/>` +
    `<path d="M35.2 39 C29.8 46.4 25.2 54.6 22.2 63.8 L17 63.2" stroke="${G}"/>` +
    `<path d="M33.4 40 C28.6 46.6 24.6 53.6 21.8 60.8" stroke="${R}"/>` +
    // 足（双足三爪，绿）
    `<g stroke="${G}">` +
    `<path d="M26.8 40.8 L25.6 53.4"/>` +
    `<path d="M31.2 41.2 L32.2 53.4"/>` +
    `<path d="M25.6 53.4 L22.7 55.9 M25.6 53.4 L27.8 56"/>` +
    `<path d="M32.2 53.4 L29.9 56 M32.2 53.4 L35 55.9"/>` +
    `</g>` +
    `</g>`
  );
}

function dotTile(rank: number): string {
  const g: string[] = [];
  const D = (x: number, y: number, r = 8, accent = ((x + y) % 2 === 0 ? GREEN : RED)) =>
    g.push(ringDot(x, y, r, accent));
  switch (rank) {
    case 1:
      g.push(bigRing(30, 42, 19));
      break;
    case 2:
      D(30, 24, 9, GREEN); D(30, 60, 9, RED);
      break;
    case 3:
      D(18, 22, 8.4, GREEN); D(30, 42, 8.4, RED); D(42, 62, 8.4, GREEN);
      break;
    case 4:
      D(20, 26, 8.4, RED); D(40, 26, 8.4, GREEN); D(20, 58, 8.4, GREEN); D(40, 58, 8.4, RED);
      break;
    case 5:
      D(20, 24, 8, GREEN); D(40, 24, 8, RED);
      D(30, 42, 8.6, INK);
      D(20, 60, 8, RED); D(40, 60, 8, GREEN);
      break;
    case 6:
      for (const [i, y] of [20, 42, 64].entries()) {
        D(20, y, 8, i === 1 ? RED : GREEN);
        D(40, y, 8, i === 1 ? GREEN : RED);
      }
      break;
    case 7:
      D(17, 15, 7, GREEN); D(30, 27, 7, RED); D(43, 39, 7, GREEN);
      D(20, 58, 7, RED); D(40, 58, 7, GREEN); D(20, 71.5, 7, GREEN); D(40, 71.5, 7, RED);
      break;
    case 8:
      for (const [i, y] of [14, 32.7, 51.3, 70].entries()) {
        D(20, y, 7.8, i % 2 ? RED : GREEN);
        D(40, y, 7.8, i % 2 ? GREEN : RED);
      }
      break;
    case 9:
      for (const [i, y] of [19, 42, 65].entries()) {
        D(16, y, 7, i === 1 ? RED : GREEN);
        D(30, y, 7, INK);
        D(44, y, 7, i === 1 ? GREEN : RED);
      }
      break;
  }
  return g.join('');
}

function bamTile(rank: number): string {
  if (rank === 1) return bird();
  const g: string[] = [];
  const S = (x: number, y: number, len: number, color?: string) => g.push(stick(x, y, len, color));
  switch (rank) {
    case 2:
      // 双柱并排（贯穿上下）
      S(20, 10, 64); S(40, 10, 64);
      break;
    case 3:
      // 上一柱 + 下两柱
      S(30, 8, 26); S(19, 40, 36); S(41, 40, 36);
      break;
    case 4:
      // 二乘二
      S(20, 11, 28); S(40, 11, 28);
      S(20, 45, 28); S(40, 45, 28);
      break;
    case 5:
      // 四角绿 + 中柱红（传统五索红心）
      S(18, 9, 26); S(42, 9, 26);
      S(30, 29, 26, RED);
      S(18, 49, 26); S(42, 49, 26);
      break;
    case 6:
      // 二乘三
      for (const y of [9, 34, 59]) { S(20, y, 17); S(40, y, 17); }
      break;
    case 7:
      // 顶一柱 + 下二乘三
      S(30, 7, 19);
      for (const y of [31, 48, 65]) { S(20, y, 13); S(40, y, 13); }
      break;
    case 8:
      // 二乘四
      for (const y of [7, 25, 43, 61]) { S(20, y, 14); S(40, y, 14); }
      break;
    case 9:
      // 三乘三
      for (const y of [9, 34, 59]) { S(14, y, 17); S(30, y, 17); S(46, y, 17); }
      break;
  }
  return g.join('');
}

function honorTile(rank: number): string {
  switch (rank) {
    case 1: case 2: case 3: case 4:
      // 风牌：黑色实心楷字
      return glyph(30, 42, 48, WINDS[rank - 1], INK);
    case 5:
      return glyph(30, 43, 54, '中', RED);
    case 6:
      return glyph(30, 42, 50, '發', GREEN);
    default:
      // 白板：蓝色双线方框
      return (
        `<rect x="16" y="17" width="28" height="50" rx="2" fill="none" stroke="${BLUE}" stroke-width="3"/>` +
        `<rect x="21.5" y="22.5" width="17" height="39" rx="1" fill="none" stroke="${BLUE}" stroke-width="1.2" opacity="0.55"/>`
      );
  }
}

/** 34 种牌种 → 刻面内容（不含牌体） */
export function tileFaceInner(kind: number): string {
  const suit = Math.floor(kind / 9);
  const rank = (kind % 9) + 1;
  switch (suit) {
    case 0:
      return glyph(30, 20, 27, NUMERALS[rank - 1], INK) + glyph(30, 57, 42, '萬', RED);
    case 1:
      return dotTile(rank);
    case 2:
      return bamTile(rank);
    default:
      return honorTile(rank);
  }
}

/** 牌背刻纹（墨绿压边 + 菱形暗纹） */
export function tileBackInner(): string {
  return (
    `<rect x="5" y="5" width="50" height="74" rx="5" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.4"/>` +
    `<rect x="9" y="9" width="42" height="66" rx="3.5" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>` +
    `<g transform="rotate(45 30 42)">` +
    `<rect x="21" y="33" width="18" height="18" rx="2.5" fill="none" stroke="rgba(224,242,230,0.4)" stroke-width="1.6"/>` +
    `<rect x="26" y="38" width="8" height="8" rx="1.5" fill="rgba(224,242,230,0.28)"/>` +
    `</g>` +
    `<path d="M12 74 L48 10" stroke="rgba(255,255,255,0.07)" stroke-width="6"/>` +
    `<path d="M20 76 L54 16" stroke="rgba(0,0,0,0.12)" stroke-width="6"/>`
  );
}
