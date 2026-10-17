<!-- 棋盘：楠木底 + SVG 楚河汉界网格 + 等比定位棋子 -->
<template>
  <div
    ref="boardEl"
    class="relative w-full max-w-[560px] mx-auto board-wood rounded-2xl"
    :style="{ containerType: 'inline-size' }"
    @click="onBoardClick"
  >
    <div class="relative w-full" style="aspect-ratio: 9 / 10">
      <!-- 网格 -->
      <svg class="absolute inset-0 w-full h-full" viewBox="0 0 900 1000" aria-hidden="true">
        <g stroke="#7a4a1d" stroke-width="3" stroke-linecap="round" opacity="0.85">
          <!-- 横线 10 条 -->
          <line v-for="y in 10" :key="'h' + y" :x1="50" :y1="50 + (y - 1) * 100" :x2="850" :y2="50 + (y - 1) * 100" />
          <!-- 外侧两条竖线贯通 -->
          <line x1="50" y1="50" x2="50" y2="950" />
          <line x1="850" y1="50" x2="850" y2="950" />
          <!-- 中间 7 列在楚河汉界断开 -->
          <template v-for="x in 7" :key="'v' + x">
            <line :x1="50 + x * 100" y1="50" :x2="50 + x * 100" y2="450" />
            <line :x1="50 + x * 100" y1="550" :x2="50 + x * 100" y2="950" />
          </template>
          <!-- 九宫斜线 -->
          <line x1="350" y1="50" x2="550" y2="250" />
          <line x1="550" y1="50" x2="350" y2="250" />
          <line x1="350" y1="750" x2="550" y2="950" />
          <line x1="550" y1="750" x2="350" y2="950" />
        </g>
        <!-- 外框 -->
        <rect x="38" y="38" width="824" height="924" fill="none" stroke="#7a4a1d" stroke-width="4" opacity="0.7" rx="6" />
        <!-- 炮位/兵位标记 -->
        <g fill="#7a4a1d" opacity="0.65">
          <template v-for="p in marks" :key="'m' + p.x + '-' + p.y">
            <g v-if="p.x > 0" :transform="`translate(${50 + p.x * 100 - 22} ${50 + p.y * 100})`">
              <path :d="markPath" />
            </g>
            <g v-if="p.x < 8" :transform="`translate(${50 + p.x * 100 + 22} ${50 + p.y * 100})`">
              <path :d="markPath" transform="scale(-1,1)" />
            </g>
          </template>
        </g>
        <!-- 楚河汉界 -->
        <text x="265" y="535" class="river-font" font-size="72" fill="#8a5a28" opacity="0.85" text-anchor="middle">楚 河</text>
        <text x="635" y="535" class="river-font" font-size="72" fill="#8a5a28" opacity="0.85" text-anchor="middle">漢 界</text>
      </svg>

      <!-- 上一步痕迹 -->
      <div
        v-if="lastMove"
        v-for="(cell, i) in [lastMove.from, lastMove.to]"
        :key="'lm' + i"
        class="absolute w-[6%] h-[6%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/40 border-2 border-emerald-600/50 pointer-events-none"
        :style="posStyle(cell)"
      ></div>

      <!-- 棋子 -->
      <div
        v-for="(piece, cell) in boardCells"
        :key="'p' + cell"
        class="absolute w-[8.6%] -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out"
        :class="[
          piece ? '' : 'hidden',
          selected === cell ? 'z-20 scale-110' : 'z-10',
          selected === cell ? 'drop-shadow-[0_0_12px_rgba(250,204,21,0.9)]' : '',
          checkCell === cell ? 'check-pulse rounded-full' : '',
        ]"
        :style="posStyle(displayCell(cell))"
      >
        <!-- 空格子必须跳过渲染:PieceDisc 直接解引用 piece.c,null 会崩掉整个渲染树 -->
        <PieceDisc v-if="piece" :piece="piece" font-size="4.6cqw" />
      </div>

      <!-- 选中光环 -->
      <div
        v-if="selected >= 0"
        class="absolute w-[9.4%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-amber-400 ring-2 ring-amber-300/60 animate-pulse pointer-events-none z-0"
        :style="posStyle(displayCell(selected))"
      ></div>

      <!-- 合法落点 -->
      <template v-for="t in targets" :key="'t' + t">
        <div
          v-if="boardCells[t]"
          class="absolute w-[9.6cqw] h-[9.6cqw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-rose-500/90 ring-2 ring-rose-400/50 pointer-events-none z-30"
          :style="posStyle(displayCell(t))"
        ></div>
        <div
          v-else
          class="absolute w-[3.4cqw] h-[3.4cqw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600/85 shadow-[0_0_8px_rgba(16,185,129,0.8)] pointer-events-none z-30"
          :style="posStyle(displayCell(t))"
        ></div>
      </template>

      <!-- 胜负遮罩下的棋盘提亮（结算时降饱和） -->
      <div
        v-if="dimmed"
        class="absolute inset-0 rounded-2xl bg-slate-950/45 backdrop-grayscale pointer-events-none z-40 transition-opacity duration-500"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Piece } from '../rules';
import { BOARD_W, BOARD_H, xOf, yOf } from '../rules';
import PieceDisc from './PieceDisc.vue';

const props = defineProps<{
  board: (Piece | null)[];
  /** 观看者执子颜色：黑方观看时棋盘上下翻转 */
  myColor: 'r' | 'b' | null;
  selected: number;
  targets: number[];
  lastMove: { from: number; to: number } | null;
  checkCell: number;
  dimmed?: boolean;
}>();

const emit = defineEmits<{
  (e: 'cellClick', cell: number): void;
}>();

const boardEl = ref<HTMLElement | null>(null);

const boardCells = computed(() => props.board);

/** 炮位/兵位的四角标记 */
const marks = (() => {
  const pts: Array<{ x: number; y: number }> = [];
  for (const x of [1, 7]) pts.push({ x, y: 2 }, { x, y: 7 });
  for (const x of [0, 2, 4, 6, 8]) pts.push({ x, y: 3 }, { x, y: 6 });
  return pts;
})();
const markPath = 'M0 0 L0 -12 M0 0 L-12 0';

/** 观看者视角坐标：黑方上下左右翻转。 */
function displayCell(cell: number): number {
  if (props.myColor !== 'b') return cell;
  return (BOARD_H - 1 - yOf(cell)) * BOARD_W + (BOARD_W - 1 - xOf(cell));
}

function posStyle(cell: number): Record<string, string> {
  const x = xOf(cell);
  const y = yOf(cell);
  return {
    left: ((50 + x * 100) / 900) * 100 + '%',
    top: ((50 + y * 100) / 1000) * 100 + '%',
  };
}

/** 点击命中最近交叉点（容差 0.45 格）。 */
function onBoardClick(e: MouseEvent): void {
  const el = boardEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * 900;
  const py = ((e.clientY - rect.top) / rect.height) * 1000;
  const gx = Math.round((px - 50) / 100);
  const gy = Math.round((py - 50) / 100);
  if (gx < 0 || gx > 8 || gy < 0 || gy > 9) return;
  const dx = Math.abs(px - (50 + gx * 100));
  const dy = Math.abs(py - (50 + gy * 100));
  if (dx > 45 || dy > 45) return;
  // 反变换回棋盘坐标
  const cell = props.myColor === 'b'
    ? (BOARD_H - 1 - gy) * BOARD_W + (BOARD_W - 1 - gx)
    : gy * BOARD_W + gx;
  emit('cellClick', cell);
}
</script>

<style scoped>
.river-font {
  font-family: 'Kaiti SC', 'STKaiti', KaiTi, 'Noto Serif SC', serif;
  letter-spacing: 14px;
}
</style>
