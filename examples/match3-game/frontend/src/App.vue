<template>
  <div ref="wrapRef" class="relative h-full w-full bg-gradient-to-b from-[#1b1f33] to-[#111420] flex flex-col items-center overflow-y-auto">

    <!-- ── 共享 SVG 渐变定义（宝石/金属/炸弹/金币） ── -->
    <svg width="0" height="0" class="absolute" aria-hidden="true">
      <defs>
        <linearGradient v-for="(c, i) in GEM_COLORS" :id="'m3-g' + i" :key="i" x1="0.1" y1="0" x2="0.35" y2="1">
          <stop offset="0" :stop-color="c.light" />
          <stop offset="0.55" :stop-color="c.base" />
          <stop offset="1" :stop-color="c.dark" />
        </linearGradient>
        <linearGradient id="m3-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.5" stop-color="#d7dbe6" />
          <stop offset="1" stop-color="#a7aec2" />
        </linearGradient>
        <radialGradient id="m3-bomb" cx="0.35" cy="0.28" r="0.95">
          <stop offset="0" stop-color="#4a5070" />
          <stop offset="1" stop-color="#141a30" />
        </radialGradient>
        <radialGradient id="m3-gloss" cx="0.5" cy="0.4" r="0.75">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="1" stop-color="#ffe9f2" stop-opacity="0.55" />
        </radialGradient>
        <radialGradient id="m3-coin" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stop-color="#ffe9a3" />
          <stop offset="0.6" stop-color="#ffc93c" />
          <stop offset="1" stop-color="#d98a0b" />
        </radialGradient>
      </defs>
    </svg>

    <!-- ── 顶栏：余额 / 状态 / 返回 ── -->
    <div class="relative w-full max-w-md px-4 pt-3 flex items-center justify-between">
      <div class="flex items-center gap-1.5 bg-black/30 rounded-lg pl-1.5 pr-3 py-1.5 border border-white/10">
        <CoinIcon class="w-[18px] h-[18px]" />
        <span class="text-white font-bold tabular-nums text-sm">{{ balanceDisplay }}</span>
      </div>
      <div class="text-[11px] flex items-center gap-1.5 text-slate-400">
        <span class="inline-block w-1.5 h-1.5 rounded-full" :class="connected ? 'bg-emerald-500' : 'bg-slate-600'"></span>
        {{ connected ? '已连接' : '未连接' }}
      </div>
      <button
        class="flex items-center text-[12px] text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2.5 py-1.5 transition active:scale-95"
        @click="exitToLobby"
      >
        <ChevronLeftIcon class="w-3.5 h-3.5" />返回大厅
      </button>
    </div>

    <!-- ── 标题 ── -->
    <div class="relative mt-3 flex items-center gap-2.5">
      <div class="w-5 h-5 -rotate-12 opacity-90"><GemTile :code="1" /></div>
      <h1 class="text-[22px] leading-none font-black text-white tracking-[0.15em]">宝石消消乐</h1>
      <div class="w-5 h-5 rotate-12 opacity-90"><GemTile :code="3" /></div>
    </div>

    <!-- ── 状态横幅 ── -->
    <div class="relative w-full max-w-md px-4 mt-2.5 space-y-1.5">
      <div v-if="reconnecting" class="flex items-center gap-2 text-xs bg-white/5 text-slate-300 border border-white/10 rounded-lg px-3 py-2">
        <WifiOffIcon class="w-4 h-4 shrink-0" />网络波动，正在重连…
      </div>
      <div v-if="connectionLost" class="flex items-center gap-2 text-xs bg-red-500/10 text-red-300 border border-red-500/25 rounded-lg px-3 py-2">
        <AlertIcon class="w-4 h-4 shrink-0" />连接已断开，请刷新页面
      </div>
      <div v-if="sessionOver" class="flex items-center gap-2 text-xs bg-white/5 text-slate-300 border border-white/10 rounded-lg px-3 py-2">
        <FlagIcon class="w-4 h-4 shrink-0" />会话已结束
      </div>
      <div v-if="configError" class="flex items-center gap-2 text-xs bg-red-500/10 text-red-300 border border-red-500/25 rounded-lg px-3 py-2">
        <AlertIcon class="w-4 h-4 shrink-0" />{{ configError }}
      </div>
      <div v-if="errorToast" class="flex items-center gap-2 text-xs bg-red-500/10 text-red-300 border border-red-500/25 rounded-lg px-3 py-2">
        <AlertIcon class="w-4 h-4 shrink-0" />{{ errorToast }}
      </div>
    </div>

    <!-- ── HUD：步数 / 分数进度 ── -->
    <div class="relative w-full max-w-md px-4 mt-2.5 flex items-center gap-3.5">
      <div class="shrink-0 w-[60px] h-[60px] rounded-xl bg-black/30 border border-white/10 flex flex-col items-center justify-center gap-0.5"
           :class="{ 'moves-low': phase === 'playing' && movesLeft <= 3 }">
        <div class="flex items-center gap-1" :class="phase === 'playing' && movesLeft <= 3 ? 'text-red-400' : 'text-slate-400'">
          <SwapIcon class="w-3 h-3" /><span class="text-[10px] font-semibold">步数</span>
        </div>
        <div class="text-white font-black tabular-nums leading-none text-lg">{{ Math.max(0, movesLeft) }}</div>
      </div>
      <div class="flex-1">
        <div class="flex justify-between items-end mb-1.5">
          <span class="text-[10px] tracking-[0.2em] text-slate-400 font-semibold">分数</span>
          <span :key="score" class="num-pop text-xl font-black text-white tabular-nums leading-none">{{ score }}</span>
        </div>
        <div class="relative h-3 bg-black/40 rounded-full border border-white/10">
          <div class="absolute inset-y-0 left-0 rounded-full bg-amber-400 transition-all duration-500"
               :style="{ width: progressPct + '%' }"></div>
          <div v-for="(tier, i) in starMarks" :key="i"
               class="absolute -top-[7px] -translate-x-1/2"
               :style="{ left: tier.pct + '%' }">
            <StarIcon class="w-[21px] h-[21px]" :lit="score >= tier.min" />
          </div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-500 mt-1 tabular-nums px-0.5">
          <span v-for="(tier, i) in starMarks" :key="i">{{ tier.min }}</span>
        </div>
      </div>
    </div>

    <!-- ── 棋盘 ── -->
    <div class="relative mt-3 shrink-0" :style="{ width: boardPx + 'px', height: boardPx + 'px' }">
      <div class="absolute -inset-[6px] rounded-[26px] bg-[#0d1020] border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"></div>
      <div ref="boardRef" class="absolute top-0 left-0" style="width: 448px; height: 448px"
           :style="{ transform: `scale(${boardScale})`, transformOrigin: 'top left' }">
        <!-- 格位底坑：明暗交错 + 内阴影 -->
        <div class="absolute rounded-[12px]"
             v-for="i in 64" :key="'bg' + i"
             :class="(Math.floor((i - 1) / 8) + ((i - 1) % 8)) % 2 === 0 ? 'bg-black/20' : 'bg-black/35'"
             :style="{ left: ((i - 1) % 8) * 56 + 2 + 'px', top: Math.floor((i - 1) / 8) * 56 + 2 + 'px', width: '52px', height: '52px', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.4)' }"></div>

        <!-- 宝石 -->
        <div v-for="t in tiles" :key="t.id"
             class="tile"
             :class="{
               selected: selected === t.cell && !animating,
               popping: t.popping,
               'swap-anim': true,
               'drop-in': t.preRow !== undefined,
             }"
             :style="tileStyle(t)"
             :data-tile-id="t.id"
             @pointerdown.prevent="onTilePointerDown($event, t.cell)">
          <div class="tile-face">
            <GemTile :code="t.code" />
          </div>
        </div>

        <!-- 特殊块触发光效 -->
        <div v-for="b in blasts" :key="'bl' + b.id" class="blast-cell"
             :style="{ left: colOf(b.cell) * 56 + 2 + 'px', top: rowOf(b.cell) * 56 + 2 + 'px' }"></div>

        <!-- 浮动得分 -->
        <div v-for="f in floats" :key="'fl' + f.id" class="float-text"
             :class="f.big ? 'big text-[22px]' : 'text-[17px] text-white'"
             :style="{ top: rowOf(f.cell) * 56 + 4 + 'px' }">
          {{ f.text }}
        </div>

        <!-- 洗牌提示 -->
        <div v-if="shuffling" class="absolute inset-0 z-30 flex items-center justify-center bg-[#0d1020]/75 rounded-3xl">
          <div class="flex items-center gap-2 text-slate-200 text-sm font-bold tracking-wider">
            <ShuffleIcon class="w-5 h-5" />无可消除 · 重新洗牌
          </div>
        </div>

        <!-- 未开局占位：特殊块图例 -->
        <div v-if="phase === 'idle' && tiles.length === 0" class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5">
          <div class="flex gap-8">
            <div class="flex flex-col items-center gap-1.5">
              <div class="w-10 h-10"><GemTile :code="10" /></div>
              <span class="text-[10px] text-slate-400">四连 · 火箭</span>
            </div>
            <div class="flex flex-col items-center gap-1.5">
              <div class="w-10 h-10"><GemTile :code="30" /></div>
              <span class="text-[10px] text-slate-400">L / T · 炸弹</span>
            </div>
            <div class="flex flex-col items-center gap-1.5">
              <div class="w-10 h-10"><GemTile :code="40" /></div>
              <span class="text-[10px] text-slate-400">五连 · 彩虹球</span>
            </div>
          </div>
          <div class="text-slate-300 text-sm font-semibold">选择入场费，开始对局</div>
        </div>
      </div>
    </div>

    <!-- ── 底栏操作 ── -->
    <div class="relative w-full max-w-md px-4 mt-4 pb-4">
      <div v-if="phase === 'playing'" class="flex gap-2">
        <button
          @click="giveUp"
          :disabled="animating || !!pending || sessionOver"
          :class="[
            'flex items-center justify-center gap-1.5 flex-1 py-3 rounded-xl text-sm font-semibold border transition active:scale-95',
            animating || pending || sessionOver
              ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
              : 'bg-white/5 text-slate-300 border-white/15 hover:bg-white/10',
          ]">
          <FlagIcon class="w-4 h-4" />提前结算
        </button>
      </div>
      <div v-else class="space-y-2.5">
        <div class="flex items-center justify-center gap-2.5">
          <span class="text-xs text-slate-400 font-semibold">入场费</span>
          <button v-for="b in bets" :key="b" @click="bet = b"
                  :class="[
                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold border transition active:scale-95',
                    bet === b
                      ? 'bg-amber-400 text-[#2a1a00] border-amber-300'
                      : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10',
                  ]">
            <CoinIcon class="w-[15px] h-[15px]" :dim="bet !== b" />{{ b }}
          </button>
        </div>
        <button @click="startGame"
                :disabled="!connected || sessionOver"
                :class="[
                  'flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-base font-bold tracking-[0.2em] transition-all duration-150 active:scale-[0.98]',
                  !connected || sessionOver
                    ? 'bg-white/5 text-white/30 cursor-not-allowed'
                    : 'bg-amber-400 hover:bg-amber-300 text-[#2a1a00]',
                ]">
          <PlayIcon class="w-4 h-4" />
          {{ sessionOver ? '会话已结束' : phase === 'over' ? '再来一局' : '开始游戏' }}
        </button>
        <div class="text-center text-[11px] text-slate-500 tabular-nums">
          600 分回半注 · 1200 分 ×1.2 · 2600 分 ×2 · 4200 分 ×4
        </div>
      </div>
    </div>

    <!-- ── 终局浮层 ── -->
    <div v-if="gameOver" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div class="relative w-full max-w-[290px] rounded-2xl border border-white/12 bg-[#1c2136] px-6 pt-6 pb-6 text-center shadow-[0_20px_50px_rgba(0,0,0,0.55)]">
        <div class="text-xs tracking-[0.25em] text-slate-400 font-semibold">{{ overTitle }}</div>

        <div class="flex justify-center gap-4 my-5">
          <div v-for="i in 3" :key="i" class="star" :class="i <= gameOver.stars ? 'lit' : 'unlit'"
               :style="{ animationDelay: i <= gameOver.stars ? (i * 0.22) + 's' : '0s' }">
            <StarIcon class="w-12 h-12" :lit="i <= gameOver.stars" />
          </div>
        </div>

        <div class="text-[42px] leading-none font-black text-white tabular-nums">
          {{ gameOver.score }}<span class="text-base text-slate-400 ml-1 font-semibold">分</span>
        </div>
        <div class="payout-chip mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-base font-bold border"
             :class="gameOver.payout > 0
               ? 'bg-amber-400 text-[#2a1a00] border-amber-300'
               : 'bg-white/5 text-slate-400 border-white/10'">
          <CoinIcon class="w-[17px] h-[17px]" :dim="gameOver.payout <= 0" />
          {{ gameOver.payout > 0 ? `+${gameOver.payout}` : '未达奖励线' }}
        </div>
        <div v-if="!gameOver.committed" class="mt-2 text-xs text-red-300">奖励结算失败，请联系平台</div>
        <button v-if="!sessionOver" @click="gameOver = null"
                class="mt-6 w-full py-3 rounded-xl font-bold tracking-[0.2em] bg-amber-400 hover:bg-amber-300 text-[#2a1a00] transition active:scale-[0.98]">
          再来一局
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h } from 'vue';
import { requestHostGameConfig, notifyGameExit, type HostGameConfig } from '@game-platform/frontend-sdk';
import { createMatch3Client } from './game';
import GemTile from './GemTile.vue';
import {
  rowOf, colOf, GEM_COLORS,
  type Step, type SwapData, type SyncData, type StartData, type GameOverData, type GameConfig,
} from './types';

// ── 功能图标（线性 SVG，currentColor） ──
const icon = (paths: ReturnType<typeof h>[]) => (props: { class?: string }) =>
  h('svg', { viewBox: '0 0 24 24', class: props.class, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, paths);
const solid = (paths: ReturnType<typeof h>[]) => (props: { class?: string }) =>
  h('svg', { viewBox: '0 0 24 24', class: props.class, fill: 'currentColor' }, paths);

const ChevronLeftIcon = icon([h('path', { d: 'M15 5l-7 7 7 7' })]);
const PlayIcon = solid([h('path', { d: 'M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z' })]);
const FlagIcon = icon([h('path', { d: 'M6 21V4' }), h('path', { d: 'M6 4h11l-2.5 4L17 12H6z', fill: 'currentColor', stroke: 'none' })]);
const ShuffleIcon = icon([
  h('path', { d: 'M16 4h4.5v4.5' }),
  h('path', { d: 'M3.5 19.5 20.5 4.5' }),
  h('path', { d: 'M16 20h4.5v-4.5' }),
  h('path', { d: 'M14 14.5l6.5 6' }),
  h('path', { d: 'M3.5 4.5l6 5.5' }),
]);
const WifiOffIcon = icon([
  h('path', { d: 'M2 8.8a15.5 15.5 0 0 1 5-3.3M13.5 5.2a15.5 15.5 0 0 1 8.5 3.6' }),
  h('path', { d: 'M5.5 12.5a10.5 10.5 0 0 1 3.2-2.2M15.5 10.5a10.5 10.5 0 0 1 3 2' }),
  h('path', { d: 'M9 15.8a5.5 5.5 0 0 1 6 0' }),
  h('circle', { cx: 12, cy: 19.5, r: 1.3, fill: 'currentColor', stroke: 'none' }),
  h('path', { d: 'M3 3l18 18' }),
]);
const AlertIcon = icon([h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 7.5V13' }), h('circle', { cx: 12, cy: 16.5, r: 0.6, fill: 'currentColor', stroke: 'none' })]);
const SwapIcon = solid([h('path', { d: 'M7.5 3.5 11 7H8.4v6h-1.8V7H4zM16.5 20.5 13 17h2.6v-6h1.8v6H20z' })]);
const CoinIcon = (props: { dim?: boolean; class?: string }) =>
  h('svg', { viewBox: '0 0 24 24', class: props.class }, [
    h('circle', { cx: 12, cy: 12, r: 10, fill: 'url(#m3-coin)', stroke: '#8a5606', 'stroke-width': 1.5, opacity: props.dim ? 0.55 : 1 }),
    h('circle', { cx: 12, cy: 12, r: 6.5, fill: 'none', stroke: '#b8770e', 'stroke-width': 1.5, opacity: props.dim ? 0.55 : 1 }),
    h('path', { d: 'M9 7.5c1.8 1.6 4.2 1.6 6 0', stroke: '#fff3cf', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', opacity: 0.9 }),
  ]);
const StarIcon = (props: { lit?: boolean; class?: string }) =>
  h('svg', { viewBox: '0 0 24 24', class: props.class }, [
    h('path', {
      d: 'M12 1.8l3.1 6.5 7.1.9-5.2 4.9 1.4 7L12 17.7l-6.4 3.4 1.4-7L1.8 9.2l7.1-.9z',
      fill: props.lit ? 'url(#m3-coin)' : '#2c3050',
      stroke: props.lit ? '#a06a08' : '#3a3f63',
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  ]);

// ── 常量（与棋盘几何一致）──
const STEP = 56;

// ── 连接与状态 ──
const connected = ref(false);
const reconnecting = ref(false);
const connectionLost = ref(false);
const configError = ref('');
const sessionOver = ref(false);
const errorToast = ref('');
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const myPlayerId = ref('');
const balance = ref<number | string>('--');
const lastBalanceVersion = ref(0);

const phase = ref<'idle' | 'playing' | 'over'>('idle');
const config = ref<GameConfig | null>(null);
const score = ref(0);
const movesLeft = ref(0);
const bet = ref(10);
const bets = computed(() => config.value?.bets ?? [10, 50, 100]);
const gameOver = ref<GameOverData | null>(null);

// 分数进度条：满格 = 最高档（3★），★ 标记落在各档位比例处
const progressPct = computed(() => {
  const tiers = config.value?.tiers ?? [];
  if (tiers.length === 0) return 0;
  const top = tiers[tiers.length - 1].min;
  return Math.min(100, Math.round((score.value / top) * 100));
});
const starMarks = computed(() => {
  const tiers = config.value?.tiers ?? [];
  if (tiers.length === 0) return [];
  const top = tiers[tiers.length - 1].min;
  return tiers.map((t) => ({ min: t.min, pct: Math.round((t.min / top) * 100) }));
});

// ── 棋盘 ──
interface Tile { id: number; code: number; cell: number; popping?: boolean; preRow?: number }
const tiles = ref<Tile[]>([]);
let tileSeq = 0;
const selected = ref(-1);
const pending = ref<{ a: number; b: number } | null>(null);
const animating = ref(false);
const shuffling = ref(false);
let playChain: Promise<void> = Promise.resolve();
let pendingOver: GameOverData | null = null;

interface FloatText { id: number; text: string; cell: number; big: boolean }
const floats = ref<FloatText[]>([]);
let floatSeq = 0;
interface Blast { id: number; cell: number }
const blasts = ref<Blast[]>([]);

// ── 棋盘缩放（响应式） ──
const wrapRef = ref<HTMLElement | null>(null);
const boardRef = ref<HTMLElement | null>(null);
const boardScale = ref(1);
const boardPx = computed(() => Math.round(448 * boardScale.value));

function tileStyle(t: Tile): Record<string, string> {
  const row = t.preRow !== undefined ? t.preRow : rowOf(t.cell);
  const tf = `translate(${colOf(t.cell) * STEP}px, ${row * STEP}px)`;
  return { transform: tf, '--tf': tf };
}

// ── 工具 ──
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function tileAt(cell: number): Tile | undefined {
  return tiles.value.find((t) => t.cell === cell && !t.popping);
}
function isAdjacent(a: number, b: number): boolean {
  return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) === 1;
}
function applyBalance(bal: number, version: number) {
  if (version > 0 && version <= lastBalanceVersion.value) return;
  if (version > 0) lastBalanceVersion.value = version;
  balance.value = bal;
}
const balanceDisplay = computed(() => (typeof balance.value === 'number' ? balance.value.toLocaleString() : balance.value));
function showToast(msg: string) {
  errorToast.value = msg;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { errorToast.value = ''; }, 3500);
}
function translateError(msg: string): string {
  const lower = String(msg).toLowerCase();
  if (lower.includes('insufficient balance')) return '余额不足，请降低入场费';
  return msg;
}

// ── 棋盘重建（开局 / 同步 / 洗牌对账） ──
function buildBoard(board: number[], cascade: boolean) {
  const fresh: Tile[] = [];
  if (!cascade) {
    for (let i = 0; i < 64; i++) fresh.push({ id: ++tileSeq, code: board[i], cell: i });
    tiles.value = fresh;
    return;
  }
  // 整列从上方落下入场
  const byCol = new Map<number, number[]>();
  for (let i = 0; i < 64; i++) {
    const c = colOf(i);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(i);
  }
  for (const cells of byCol.values()) {
    const m = cells.length;
    cells.forEach((cell, i) => {
      fresh.push({ id: ++tileSeq, code: board[cell], cell, preRow: i - m });
    });
  }
  tiles.value = fresh;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const t of tiles.value) t.preRow = undefined;
  }));
}

function reconcileFrom(board: number[]) {
  const byCell = new Map<number, Tile>();
  for (const t of tiles.value) if (!t.popping) byCell.set(t.cell, t);
  const out: Tile[] = [];
  for (let i = 0; i < 64; i++) {
    const t = byCell.get(i);
    if (t) {
      t.code = board[i];
      t.preRow = undefined;
      out.push(t);
    } else {
      out.push({ id: ++tileSeq, code: board[i], cell: i });
    }
  }
  tiles.value = out;
}

// ── 步骤流播放（服务端权威步骤 → 客户端逐帧动画） ──
async function playSteps(steps: Step[], skipFirstSwap: boolean) {
  let first = true;
  for (const s of steps) {
    if (s.t === 'swap') {
      if (first && skipFirstSwap) { first = false; continue; }
      const ta = tileAt(s.a), tb = tileAt(s.b);
      if (ta) ta.cell = s.b;
      if (tb) tb.cell = s.a;
      await delay(180);
    } else if (s.t === 'clear') {
      showBlasts(s);
      for (const cell of s.cells) {
        const t = tileAt(cell);
        if (t) t.popping = true;
      }
      for (const cr of s.creations) {
        const t = tileAt(cr.cell);
        if (t) t.code = cr.tile;
      }
      addFloat(s);
      score.value += s.gain;
      await delay(310);
      tiles.value = tiles.value.filter((t) => !t.popping);
      await delay(50);
    } else if (s.t === 'fall') {
      for (const m of s.moves) {
        const t = tileAt(m.from);
        if (t) t.cell = m.to;
      }
      spawnTiles(s.spawns);
      await delay(360);
    } else if (s.t === 'shuffle') {
      shuffling.value = true;
      await delay(420);
      reconcileFrom(s.board);
      await delay(260);
      shuffling.value = false;
    }
    first = false;
  }
}

function spawnTiles(spawns: { cell: number; tile: number }[]) {
  if (spawns.length === 0) return;
  const byCol = new Map<number, { cell: number; tile: number }[]>();
  for (const sp of spawns) {
    const c = colOf(sp.cell);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(sp);
  }
  const fresh: Tile[] = [];
  for (const list of byCol.values()) {
    const m = list.length;
    list.forEach((sp, i) => {
      fresh.push({ id: ++tileSeq, code: sp.tile, cell: sp.cell, preRow: rowOf(sp.cell) - m + i });
    });
  }
  tiles.value.push(...fresh);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const t of fresh) t.preRow = undefined;
  }));
}

function showBlasts(s: Extract<Step, { t: 'clear' }>) {
  const cells: number[] = [];
  for (const tr of s.triggered) {
    if (tr.kind === 1) {
      const r = rowOf(tr.cell);
      for (let c = 0; c < 8; c++) cells.push(r * 8 + c);
    } else if (tr.kind === 2) {
      const c = colOf(tr.cell);
      for (let r = 0; r < 8; r++) cells.push(r * 8 + c);
    } else if (tr.kind === 3) {
      const r = rowOf(tr.cell), c = colOf(tr.cell);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) cells.push(nr * 8 + nc);
      }
    } else if (tr.kind === 4) {
      for (let i = 0; i < 64; i++) cells.push(i);
    }
  }
  const batch = cells.map((cell) => ({ id: ++floatSeq, cell }));
  blasts.value.push(...batch);
  setTimeout(() => {
    const ids = new Set(batch.map((b) => b.id));
    blasts.value = blasts.value.filter((b) => !ids.has(b.id));
  }, 380);
}

function addFloat(s: Extract<Step, { t: 'clear' }>) {
  const anchor = s.cells[Math.floor(s.cells.length / 2)] ?? 27;
  const text = s.chain >= 2 ? `+${s.gain} 连击 ×${s.mult}` : `+${s.gain}`;
  const f: FloatText = { id: ++floatSeq, text, cell: anchor, big: s.chain >= 2 };
  floats.value.push(f);
  setTimeout(() => { floats.value = floats.value.filter((x) => x.id !== f.id); }, 980);
}

// ── 交互 ──
let drag: { cell: number; x: number; y: number; consumed: boolean } | null = null;

function onTilePointerDown(e: PointerEvent, cell: number) {
  drag = { cell, x: e.clientX, y: e.clientY, consumed: false };
}
function onWindowPointerMove(e: PointerEvent) {
  if (!drag || drag.consumed) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const cellPx = STEP * boardScale.value;
  if (Math.abs(dx) < cellPx * 0.35 && Math.abs(dy) < cellPx * 0.35) return;
  // 拖动方向 → 目标相邻格
  let target = -1;
  const r = rowOf(drag.cell), c = colOf(drag.cell);
  if (Math.abs(dx) > Math.abs(dy)) target = dx > 0 ? (c < 7 ? drag.cell + 1 : -1) : (c > 0 ? drag.cell - 1 : -1);
  else target = dy > 0 ? (r < 7 ? drag.cell + 8 : -1) : (r > 0 ? drag.cell - 8 : -1);
  drag.consumed = true;
  if (target >= 0) trySwap(drag.cell, target);
  selected.value = -1;
}
function onWindowPointerUp() {
  if (!drag) return;
  if (!drag.consumed) {
    const cell = drag.cell;
    if (phase.value !== 'playing' || animating.value || pending.value) { drag = null; return; }
    if (selected.value === cell) {
      selected.value = -1;
    } else if (selected.value >= 0 && isAdjacent(selected.value, cell)) {
      trySwap(selected.value, cell);
      selected.value = -1;
    } else {
      selected.value = cell;
    }
  }
  drag = null;
}

function trySwap(a: number, b: number) {
  if (phase.value !== 'playing' || animating.value || pending.value || !connected.value || sessionOver.value) return;
  if (!isAdjacent(a, b)) return;
  selected.value = -1;
  // 乐观交换：先动 UI，等服务器 mm:swap / mm:error
  const ta = tileAt(a), tb = tileAt(b);
  if (ta) ta.cell = b;
  if (tb) tb.cell = a;
  pending.value = { a, b };
  client.value?.sendAction('swap', { a, b });
}

function bounceBack() {
  const p = pending.value;
  pending.value = null;
  if (!p) return;
  const ta = tileAt(p.a), tb = tileAt(p.b);
  // 已经交换过：换回来 + 抖动
  if (ta) ta.cell = p.a;
  if (tb) tb.cell = p.b;
  const moved = tiles.value.filter((t) => t.cell === p.a || t.cell === p.b);
  for (const t of moved) {
    const el = boardRef.value?.querySelector(`[data-tile-id="${t.id}"]`);
    el?.classList.add('bounce');
    setTimeout(() => el?.classList.remove('bounce'), 340);
  }
}

function startGame() {
  if (!connected.value || sessionOver.value) return;
  if (phase.value === 'playing') return;
  gameOver.value = null;
  errorToast.value = '';
  client.value?.sendAction('start_game', { bet: bet.value });
}

function giveUp() {
  if (phase.value !== 'playing' || animating.value || pending.value) return;
  client.value?.sendAction('give_up', {});
}

function exitToLobby() {
  // 非 iframe 宿主（独立打开/本地直开 dev 端口）时退回浏览器历史
  if (!notifyGameExit() && window.history.length > 1) window.history.back();
}

// ── SDK 回调装配 ──
const client = ref<any>(null);
let gameOverTimer: ReturnType<typeof setTimeout> | null = null;

function onSyncData(data: SyncData) {
  connected.value = true;
  if (data.config) config.value = data.config;
  if (data.playerId) myPlayerId.value = data.playerId;
  if (typeof data.balance === 'number') applyBalance(data.balance, data.version ?? 0);
  phase.value = data.phase;
  if (!bets.value.includes(bet.value)) bet.value = bets.value[0];
  if (data.game && !animating.value && !pending.value) {
    score.value = data.game.score;
    movesLeft.value = data.game.movesLeft;
    bet.value = data.game.bet;
    reconcileFrom(data.game.board);
  }
  if (data.phase === 'over' && data.lastResult) {
    if (!gameOver.value) gameOver.value = data.lastResult;
  }
}

function onSwapData(data: SwapData) {
  if (data.playerId && myPlayerId.value && data.playerId !== myPlayerId.value) return;
  // 本地无棋盘（观战加入/长时间失联）：跳过步骤动画，直接以广播快照重建
  if (tiles.value.length === 0) {
    reconcileFrom(data.board);
    score.value = data.score;
    movesLeft.value = data.movesLeft;
    return;
  }
  const skipSwap = !!pending.value &&
    data.steps.length > 0 && data.steps[0].t === 'swap' &&
    (data.steps[0] as Extract<Step, { t: 'swap' }>).a === pending.value.a &&
    (data.steps[0] as Extract<Step, { t: 'swap' }>).b === pending.value.b;
  pending.value = null;
  playChain = playChain.then(async () => {
    animating.value = true;
    selected.value = -1;
    try {
      await playSteps(data.steps, skipSwap);
    } finally {
      reconcileFrom(data.board);
      score.value = data.score;
      movesLeft.value = data.movesLeft;
      animating.value = false;
      if (pendingOver) {
        const over = pendingOver;
        pendingOver = null;
        applyGameOver(over);
      }
    }
  });
}

function applyGameOver(data: GameOverData) {
  gameOver.value = data;
  phase.value = 'over';
}

function onGameOverData(data: GameOverData) {
  if (data.playerId && myPlayerId.value && data.playerId !== myPlayerId.value) return;
  if (animating.value) { pendingOver = data; return; }
  // 稍等片刻让最后的消除画面停留
  if (gameOverTimer) clearTimeout(gameOverTimer);
  gameOverTimer = setTimeout(() => applyGameOver(data), 650);
}

const overTitle = computed(() => {
  if (!gameOver.value) return '';
  const reasons: Record<string, string> = {
    moves_used: '步数用尽',
    give_up: '已提前结算',
    leave: '离席结算',
    session_end: '会话结束',
  };
  return reasons[gameOver.value.reason] ?? '本局结束';
});

const handleVisibility = () => {
  // 事件驱动对账：页面恢复可见时拉全量快照，零稳态成本（无轮询）
  if (document.visibilityState === 'visible' && client.value?.isConnected()) {
    client.value?.sync();
  }
};

onMounted(async () => {
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  document.addEventListener('visibilitychange', handleVisibility);
  observeSize();

  let cfg: HostGameConfig;
  try {
    cfg = await requestHostGameConfig();
  } catch (error) {
    configError.value = error instanceof Error ? error.message : '无法获取游戏宿主配置';
    return;
  }

  const gc = createMatch3Client(cfg, {
    onSync: onSyncData,
    onInit() { connected.value = true; },
    onStart(data: StartData) {
      phase.value = 'playing';
      gameOver.value = null;
      score.value = 0;
      movesLeft.value = data.movesLeft;
      bet.value = data.bet;
      selected.value = -1;
      pending.value = null;
      pendingOver = null;
      animating.value = false;
      buildBoard(data.board, true);
    },
    onSwap: onSwapData,
    onGameOver: onGameOverData,
    onBalance: applyBalance,
    onError(msg: string) {
      showToast(translateError(msg));
      if (pending.value) bounceBack();
    },
    onDisconnect() {
      connected.value = false;
      reconnecting.value = true;
      connectionLost.value = false;
    },
    onReconnect() {
      connected.value = true;
      reconnecting.value = false;
      connectionLost.value = false;
      errorToast.value = '';
      lastBalanceVersion.value = 0;
    },
    onReconnectFailed() {
      reconnecting.value = false;
      connectionLost.value = true;
    },
    onFinished() {
      sessionOver.value = true;
    },
  });

  gc.connect();
  client.value = gc;
});

function observeSize() {
  const update = () => {
    const w = wrapRef.value?.clientWidth ?? 448;
    const maxBoard = Math.min(w - 16, 448, (window.innerHeight - 330));
    boardScale.value = Math.max(0.5, Math.min(1, maxBoard / 448));
  };
  update();
  window.addEventListener('resize', update);
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  document.removeEventListener('visibilitychange', handleVisibility);
  client.value?.disconnect();
});
</script>
