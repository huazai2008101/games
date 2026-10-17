<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- ── 顶栏 ── -->
    <header class="h-12 shrink-0 flex items-center justify-between px-4 bg-slate-900/85 border-b border-white/10 z-10">
      <div class="flex items-center gap-2.5">
        <!-- 游戏自带返回入口：通知宿主大厅导航返回（宿主协议 onlinegame:game:exit） -->
        <button
          type="button"
          class="flex items-center gap-1 px-2.5 py-1 rounded-full border border-white/15 border-solid text-xs text-slate-300 hover:text-white hover:border-white/40 hover:bg-white/5 transition"
          title="返回大厅"
          @click="exitToLobby"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          返回大厅
        </button>
        <GameIcon name="piece" class="w-6 h-6 text-red-500" />
        <span class="font-extrabold tracking-wide bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent">
          中国象棋
        </span>
        <template v-if="pub">
          <span class="chip">第 {{ pub.gameNo }} 局</span>
          <span class="chip">底分 {{ pub.base }}</span>
          <span v-if="youColor" class="chip !text-amber-300 !border-amber-500/40 !bg-amber-500/10">
            我执{{ youColor === 'r' ? '红' : '黑' }}
          </span>
        </template>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="spectate" class="chip !text-sky-300 !border-sky-500/40 !bg-sky-500/10">观战</span>
        <div v-if="balance !== null" class="text-right leading-tight">
          <div class="text-[10px] text-slate-500">余额</div>
          <div class="text-sm font-bold text-amber-300 font-mono inline-flex items-center gap-1">
            <GameIcon name="coin" class="w-3.5 h-3.5" />
            {{ balance.toLocaleString('zh-CN') }}
          </div>
        </div>
        <span :class="['w-2 h-2 rounded-full', connected ? 'bg-emerald-400' : 'bg-red-500']" :title="connected ? '已连接' : '未连接'"></span>
      </div>
    </header>

    <!-- 配置错误（无法从宿主获取连接配置） -->
    <div v-if="configError" class="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <GameIcon name="piece" class="w-12 h-12 text-slate-600" />
      <p class="text-slate-400 text-sm max-w-sm">{{ configError }}</p>
      <p class="text-slate-600 text-xs">本页面需由平台大厅以 iframe 方式加载并下发连接配置。</p>
    </div>

    <template v-else>
      <!-- ── 棋枰 ── -->
      <main class="relative flex-1 bg-felt overflow-hidden">
        <!-- 对手（上） -->
        <div class="absolute top-3 left-1/2 -translate-x-1/2 w-64 z-10">
          <PlayerCard
            v-if="opponentSeat"
            :id="opponentSeat.id"
            :name="opponentSeat.name"
            :bot="opponentSeat.bot"
            :vacant="opponentSeat.vacant"
            :color="opponentSeat.color"
            :is-turn="isSeatTurn(opponentSeat.seat)"
            :remaining="seatRemaining"
            :total-secs="MOVE_TURN_SECS"
            :score="seatScore(opponentSeat.id)"
          />
          <div v-else class="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-slate-900/40 px-3 py-2.5 text-sm text-slate-400">
            <span class="w-2 h-2 rounded-full bg-emerald-300 animate-bounce"></span>
            等待对手入座…
          </div>
        </div>

        <!-- 棋盘 -->
        <div class="absolute inset-0 flex items-center justify-center px-3 pt-14 pb-2">
          <BoardView
            v-if="pub && pub.board.length === 90"
            :board="pub.board"
            :my-color="youColor"
            :selected="selected"
            :targets="targets"
            :last-move="pub.lastMove"
            :check-cell="checkCell"
            :dimmed="!!handOver || dissolving"
            @cell-click="onCellClick"
          />
        </div>

        <!-- 中央提示 -->
        <div class="absolute top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none text-center">
          <Transition name="fade">
            <div v-if="banner" class="rounded-full border px-4 py-1.5 text-sm font-bold tracking-widest backdrop-blur"
              :class="bannerClass">
              {{ banner }}
            </div>
          </Transition>
        </div>

        <!-- 对局动态 -->
        <div v-if="feed.length" class="absolute bottom-2.5 left-3 w-64 bg-slate-950/50 border border-white/10 rounded-xl px-3 py-2 backdrop-blur">
          <div class="text-[10px] text-slate-500 mb-1">对局动态</div>
          <div v-for="(f, i) in feed" :key="f.t + '-' + i" :class="['text-[11px] leading-5 break-words', i === 0 ? 'text-slate-300' : 'text-slate-500']">
            {{ f.text }}
          </div>
        </div>

        <!-- 重连横幅 -->
        <div v-if="reconnecting" class="absolute top-2 right-2 text-xs bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 rounded-lg px-3 py-1.5 z-20 inline-flex items-center gap-1.5">
          <GameIcon name="wifi" class="w-3.5 h-3.5" />
          连接中断，正在重连…
        </div>
        <div v-if="connectionLost" class="absolute top-2 right-2 text-xs bg-red-500/15 text-red-300 border border-red-500/30 rounded-lg px-3 py-1.5 z-20 inline-flex items-center gap-1.5">
          <GameIcon name="wifi-off" class="w-3.5 h-3.5" />
          连接已断开，请刷新页面
        </div>
      </main>

      <!-- ── 我的信息 + 操作 ── -->
      <section class="shrink-0 bg-slate-900/90 border-t border-white/10">
        <div class="h-1 bg-slate-800">
          <div
            class="h-full bg-gradient-to-r from-amber-400 to-red-500 transition-all duration-500"
            :style="{ width: myTurn ? myRemainingPct + '%' : '0%' }"
          ></div>
        </div>
        <div class="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2.5 min-w-56">
            <PlayerCard
              v-if="mySeatView"
              :id="mySeatView.id"
              :name="mySeatView.name"
              :bot="mySeatView.bot"
              :color="mySeatView.color"
              :is-turn="myTurn"
              :remaining="myRemaining"
              :total-secs="MOVE_TURN_SECS"
              :score="seatScore(mySeatView.id)"
            />
            <div v-else class="text-sm text-slate-400">等待入座…</div>
          </div>

          <div class="flex-1 flex justify-center min-w-56">
            <ActionPanel
              v-if="pub && !spectate"
              :phase="pub.phase"
              :my-turn="myTurn"
              :turn-name="turnSeatName"
              :ready-enabled="readyEnabled"
              :ready-note="readyNote"
              :busy="actionPending"
              @ready="ready"
              @resign="askResign"
            />
            <div v-else-if="pub && spectate" class="text-sm text-slate-400">
              {{ banner || '观战中' }}
            </div>
          </div>

          <div class="min-w-56 text-right text-[11px] text-slate-500">
            <span v-if="pub && pub.phase === 'playing'">第 {{ Math.floor(pub.moveCount / 2) + 1 }} 回合 · {{ pub.turn === 'r' ? '红' : '黑' }}方行棋</span>
          </div>
        </div>
      </section>
    </template>

    <!-- 房间已解散/会话终止（平台 session:finished 或终态后的终点态） -->
    <div v-if="sessionDissolved" class="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur flex items-center justify-center p-4">
      <div class="text-center max-w-sm w-full rounded-3xl border border-white/10 bg-slate-900/80 px-8 py-10">
        <div class="mx-auto mb-3 w-16 h-16 rounded-full bg-slate-700/30 border border-slate-500/60 flex items-center justify-center">
          <GameIcon :name="endedIcon" class="w-8 h-8 text-slate-400" />
        </div>
        <div class="text-xl font-bold text-slate-100">{{ endedTitle }}</div>
        <p class="mt-2 text-sm text-slate-400">{{ endedText }}</p>
        <button
          type="button"
          class="mt-6 w-full py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 shadow-lg shadow-orange-500/25 active:scale-95 transition"
          @click="exitToLobby"
        >
          返回大厅
        </button>
      </div>
    </div>

    <!-- 认输确认弹窗 -->
    <Transition name="fade">
      <div v-if="resignAsk" class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="w-full max-w-xs rounded-2xl border border-white/10 bg-slate-900/95 px-6 py-6 text-center shadow-2xl">
          <div class="mx-auto mb-2 w-14 h-14 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center">
            <GameIcon name="flag" class="w-7 h-7 text-rose-300" />
          </div>
          <div class="text-lg font-bold text-slate-100">确定认输吗？</div>
          <p class="mt-1.5 text-xs text-slate-400">认输将判负并立即结算本局。</p>
          <div class="mt-5 flex gap-2.5">
            <button
              type="button"
              class="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/15 text-slate-300 hover:bg-white/5 transition"
              @click="resignAsk = false"
            >
              再想想
            </button>
            <button
              type="button"
              class="flex-1 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25 active:scale-95 transition"
              @click="confirmResign"
            >
              认输
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 退出确认弹窗（对局进行中） -->
    <Transition name="fade">
      <div v-if="exitAsk" class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="w-full max-w-xs rounded-2xl border border-white/10 bg-slate-900/95 px-6 py-6 text-center shadow-2xl">
          <div class="mx-auto mb-2 w-14 h-14 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
            <GameIcon name="exit" class="w-7 h-7 text-amber-300" />
          </div>
          <div class="text-lg font-bold text-slate-100">确定退出对局吗？</div>
          <p class="mt-1.5 text-xs text-slate-400">退出后你的座位将由 AI 代打下完本局；若双方都退出，本局按和棋结算。</p>
          <div class="mt-5 flex gap-2.5">
            <button
              type="button"
              class="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/15 text-slate-300 hover:bg-white/5 transition"
              @click="exitAsk = false"
            >
              继续对局
            </button>
            <button
              type="button"
              class="flex-1 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25 active:scale-95 transition"
              @click="doExitToLobby"
            >
              退出
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 错误 toast -->
    <Transition name="fade">
      <div
        v-if="errorToast"
        class="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-red-950/90 border border-red-500/50 text-red-200 text-sm rounded-xl px-4 py-2 shadow-lg inline-flex items-center gap-1.5"
      >
        <GameIcon name="alert" class="w-4 h-4 shrink-0" />
        {{ errorToast }}
      </div>
    </Transition>

    <!-- 对局事件提醒 toast（对手离席等） -->
    <Transition name="fade">
      <div
        v-if="infoToast"
        class="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-amber-950/90 border border-amber-500/50 text-amber-200 text-sm rounded-xl px-4 py-2 shadow-lg"
      >
        {{ infoToast }}
      </div>
    </Transition>

    <!-- 结算浮层 -->
    <SettlementOverlay
      :hand-over="handOver"
      :settled="settled"
      :my-seat="mySeat"
      :my-delta="myDelta"
      :my-score="myScore"
      :dissolving="dissolving"
      :pub="pub"
      @ready="ready"
      @exit="exitToLobby"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { requestHostGameConfig, notifyGameExit, type HostGameConfig } from '@game-platform/frontend-sdk';
import {
  createXiangqiClient,
  type XqHandOver,
  type XqSettled,
  type XqSync,
} from './game';
import type { XqPublic, SeatView } from './types';
import { legalTargets, xOf, yOf, type Color, type Piece } from './rules';
import BoardView from './components/BoardView.vue';
import PlayerCard from './components/PlayerCard.vue';
import ActionPanel from './components/ActionPanel.vue';
import SettlementOverlay from './components/SettlementOverlay.vue';
import GameIcon from './components/GameIcon.vue';

const MOVE_TURN_SECS = 60;

// 吃子注记用：被吃棋子按其颜色取名
const PIECE_LABELS: Record<string, Record<string, string>> = {
  r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

// ── 连接状态 ──
const connected = ref(false);
const reconnecting = ref(false);
const connectionLost = ref(false);
const configError = ref('');
const errorToast = ref('');
let toastTimer: number | undefined;
function showError(msg: string) {
  errorToast.value = translateError(msg);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { errorToast.value = ''; }, 3500);
}

// 离席/和棋等对局事件提醒（琥珀色，区别于错误 toast）
const infoToast = ref('');
let infoToastTimer: number | undefined;
function showInfo(msg: string) {
  infoToast.value = msg;
  if (infoToastTimer) clearTimeout(infoToastTimer);
  infoToastTimer = window.setTimeout(() => { infoToast.value = ''; }, 4000);
}

// ── 平台级自动匹配等待态 ──
const sessionPlayers = ref(0);
const matchWaiting = ref(false);
const sessionDissolved = ref(false);
/** 会话终点态：dissolved=正常解散，error=引擎异常，timeout=会话超时。 */
const endedReason = ref<'dissolved' | 'error' | 'timeout'>('dissolved');
const endedIcon = computed(() => ({ dissolved: 'exit', error: 'alert', timeout: 'clock' } as const)[endedReason.value]);
const endedTitle = computed(() =>
  ({ dissolved: '房间已解散', error: '对局已终止', timeout: '会话已超时' }[endedReason.value]));
const endedText = computed(() =>
  ({
    dissolved: '有玩家离席后未归队，本局结束后房间自动解散，避免空位重开。',
    error: '游戏引擎异常导致对局终止。返回大厅后可重新匹配开局。',
    timeout: '会话长时间无活动已被平台回收。返回大厅后可重新匹配开局。',
  }[endedReason.value]));

/** 会话进入终态：无法恢复，展示终点浮层让玩家退出重匹配。 */
function endSession(reason: 'dissolved' | 'error' | 'timeout') {
  endedReason.value = reason;
  sessionDissolved.value = true;
}

function translateError(msg: string): string {
  const lower = String(msg).toLowerCase();
  if (lower.includes('insufficient balance')) return '余额不足，请充值后再战';
  const m = lower.match(/need at least (\d+) players to ready(?:\s*\((\d+)\/(\d+)\))?/);
  if (m) {
    matchWaiting.value = true;
    return '人数未满，自动匹配中…';
  }
  return msg;
}

// ── 余额（水位线去乱序） ──
// null = 尚未收到平台 wallet:balance，此时顶栏不展示余额。
const balance = ref<number | null>(null);
const lastBalanceVersion = ref(0);
function applyBalance(bal: number, version: number) {
  if (version > 0 && version <= lastBalanceVersion.value) return;
  if (version > 0) lastBalanceVersion.value = version;
  balance.value = bal;
}

// ── 棋局状态 ──
const pub = ref<XqPublic | null>(null);
const myPlayerId = ref('');
const spectate = ref(false);
const handOver = ref<XqHandOver | null>(null);
const settled = ref<XqSettled | null>(null);
const selected = ref(-1);
const targets = ref<number[]>([]);
const feed = ref<Array<{ t: number; text: string }>>([]);

const mySeat = computed(() => {
  if (spectate.value) return -1;
  return pub.value?.seats.find((s) => s.id === myPlayerId.value)?.seat ?? -1;
});
const mySeatView = computed<SeatView | null>(() => {
  const p = pub.value;
  if (!p) return null;
  return p.seats.find((s) => s.id === myPlayerId.value) ?? p.seats[mySeat.value] ?? null;
});
const opponentSeat = computed<SeatView | null>(() => {
  const p = pub.value;
  if (!p) return null;
  const opp = mySeat.value >= 0 ? 1 - mySeat.value : 1;
  return p.seats[opp] ?? null;
});
const youColor = computed<Color | null>(() => {
  const s = mySeatView.value;
  return (s && s.color) || null;
});
const dissolving = computed(() => pub.value?.phase === 'dissolving');
const myTurn = computed(() => {
  const p = pub.value;
  return !!p && p.phase === 'playing' && p.turnSeat === mySeat.value;
});
const isSeatTurn = (seat: number) => {
  const p = pub.value;
  return !!p && p.phase === 'playing' && p.turnSeat === seat;
};
const turnSeatName = computed(() => {
  const p = pub.value;
  if (!p || p.turnSeat < 0) return '';
  const s = p.seats[p.turnSeat];
  if (!s) return '';
  if (s.bot) return 'AI';
  return s.id === myPlayerId.value ? '你' : displayName(s);
});

function seatScore(id: string): number | undefined {
  if (!pub.value || !(id in pub.value.scores)) return undefined;
  return pub.value.scores[id];
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 4) + '…' + id.slice(-4) : id;
}
function displayName(s: { name?: string; id: string }): string {
  return s.name || shortId(s.id);
}
function nameOf(seat: number): string {
  const s = pub.value?.seats[seat];
  if (!s) return '?';
  if (s.bot) return 'AI';
  if (s.id === myPlayerId.value) return '你';
  return displayName(s);
}

// ── 将军提示（被将军方的帅/将位置） ──
const checkCell = computed(() => {
  const p = pub.value;
  if (!p || p.phase !== 'playing' || !p.inCheck) return -1;
  return findKing(p.board, p.turn);
});
function findKing(board: (Piece | null)[], c: Color): number {
  for (let i = 0; i < board.length; i++) {
    const piece = board[i];
    if (piece && piece.c === c && piece.t === 'K') return i;
  }
  return -1;
}

// ── 中央横幅 ──
const banner = computed(() => {
  const p = pub.value;
  if (!p) return '';
  if (p.phase === 'matching') return '自动匹配中…';
  if (p.phase === 'lobby') return p.seats.some((s) => s.ready) ? '等待开局…' : '';
  if (p.phase === 'playing') {
    if (p.inCheck) return `将军！${p.turnSeat === mySeat.value ? '请应将' : ''}`;
    return '';
  }
  return '';
});
const bannerClass = computed(() => {
  const p = pub.value;
  if (p?.phase === 'playing' && p.inCheck) {
    return 'border-rose-500/60 bg-rose-950/70 text-rose-200 animate-pulse';
  }
  return 'border-amber-400/50 bg-slate-900/80 text-amber-200';
});

// ── 棋盘交互 ──
function onCellClick(cell: number) {
  const p = pub.value;
  if (!p || p.phase !== 'playing' || !myTurn.value || actionPending.value || spectate.value) return;
  const piece = p.board[cell];

  // 已选中且点击合法落点 → 走子
  if (selected.value >= 0 && targets.value.includes(cell)) {
    submitAction('move', { from: selected.value, to: cell });
    selected.value = -1;
    targets.value = [];
    return;
  }
  // 点自己的棋子 → 选中并高亮合法落点
  if (piece && piece.c === youColor.value) {
    if (selected.value === cell) {
      selected.value = -1;
      targets.value = [];
      return;
    }
    selected.value = cell;
    targets.value = legalTargets(p.board, youColor.value!, cell);
    return;
  }
  // 其他点击 → 取消选中
  selected.value = -1;
  targets.value = [];
}

// 防止重复提交：直到服务端广播确认前按钮保持忙态。
const actionPending = ref(false);
let actionPendingTimer: number | undefined;
function clearActionPending() {
  actionPending.value = false;
  if (actionPendingTimer) {
    clearTimeout(actionPendingTimer);
    actionPendingTimer = undefined;
  }
}
function submitAction(action: string, payload: any): boolean {
  if (!client || actionPending.value) return false;
  actionPending.value = true;
  actionPendingTimer = window.setTimeout(clearActionPending, 3000);
  client.sendAction(action, payload);
  return true;
}

function ready() {
  submitAction('ready_hand', {});
}
const resignAsk = ref(false);
function askResign() {
  resignAsk.value = true;
}
function confirmResign() {
  resignAsk.value = false;
  submitAction('resign', {});
}

const readyEnabled = computed(() => {
  const p = pub.value;
  return !!p && (p.phase === 'lobby' || p.phase === 'settle' || p.phase === 'matching') && !actionPending.value && !spectate.value;
});
const readyNote = computed(() => {
  const p = pub.value;
  if (!p || p.phase !== 'settle') return '';
  return '15 秒后自动开始下一局';
});

// ── 我的倒计时 ──
const myRemaining = ref(0);
const myRemainingPct = computed(() => Math.min(100, (myRemaining.value / MOVE_TURN_SECS) * 100));
const seatRemaining = ref(0);

// ── 漂移看门狗（与斗地主一致的主动对账） ──
let lastEventAt = Date.now();
let driftSyncTurnKey = '';
function touchEvent() { lastEventAt = Date.now(); }
function reconcile(reason: string) {
  touchEvent();
  if (client?.isConnected()) {
    console.warn('[Xiangqi] drift detected, reconciling:', reason);
    client.sync();
  }
}

let tickTimer: number | undefined;
function tick() {
  const p = pub.value;
  const calc = () => Math.max(0, Math.ceil(((p?.turnEndsAt ?? 0) - Date.now()) / 1000));
  if (!p || p.phase !== 'playing') {
    myRemaining.value = 0;
    seatRemaining.value = 0;
  } else {
    seatRemaining.value = calc();
    myRemaining.value = myTurn.value ? calc() : 0;
    if (myTurn.value && p.turnEndsAt && Date.now() > p.turnEndsAt + 3000) {
      const turnKey = `${p.gameNo}:${p.moveCount}:${p.turnSeat}`;
      if (turnKey !== driftSyncTurnKey) {
        driftSyncTurnKey = turnKey;
        reconcile(`turn deadline passed (${turnKey})`);
      }
    }
  }
  if (document.visibilityState === 'visible' && Date.now() - lastEventAt > 30000) {
    reconcile('no broadcast for 30s');
  }
}

// ── 广播 → 状态 ──
function note(text: string) {
  feed.value = [{ t: Date.now(), text }, ...feed.value].slice(0, 8);
}
function cellLabel(cell: number): string {
  return `(${xOf(cell) + 1},${yOf(cell) + 1})`;
}

function onBroadcast(action: string, data: any) {
  touchEvent();
  matchWaiting.value = false;
  if (data?.public) pub.value = data.public as XqPublic;
  switch (action) {
    case 'xq:init':
      sessionDissolved.value = false;
      break;
    case 'xq:player_joined':
      note(`${data.public?.seats?.[data.seat]?.name || '新玩家'} 匹配入座`);
      break;
    case 'xq:match_filled':
      note(
        data.reason === 'full'
          ? '匹配成功，自动开局'
          : data.reason === 'skip'
            ? '跳过等待，AI 补位开局'
            : '匹配超时，AI 补位开局',
      );
      break;
    case 'xq:player_return': {
      const s = data.public?.seats?.[data.seat];
      if (data.seat === mySeat.value) client?.sync();
      note(`${s?.name || '玩家'} 归队，恢复操控`);
      break;
    }
    case 'xq:start':
      selected.value = -1;
      targets.value = [];
      clearActionPending();
      handOver.value = null;
      settled.value = null;
      note(`—— 第 ${data.public.gameNo} 局开始：${nameOf(0)} 执红先行 ——`);
      break;
    case 'xq:ready':
      note(`${nameOf(data.seat)} 准备就绪`);
      if (data.seat === mySeat.value) {
        clearActionPending();
        handOver.value = null;
        settled.value = null;
      }
      break;
    case 'xq:move': {
      if (data.seat === mySeat.value) {
        clearActionPending();
        selected.value = -1;
        targets.value = [];
      }
      const pieceName = data.color === 'r' ? '红' : '黑';
      const moveDesc = data.notation || `${cellLabel(data.from)} → ${cellLabel(data.to)}`;
      const cap = data.captured ? ` 吃${PIECE_LABELS[data.color === 'r' ? 'b' : 'r']?.[data.capturedType as string] ?? '子'}` : '';
      note(`${nameOf(data.seat)}（${pieceName}）${moveDesc}${cap}`);
      if (data.check) note(`将军！${nameOf(1 - data.seat)} 被将军`);
      break;
    }
    case 'xq:resign':
      note(`${nameOf(data.seat)} 认输`);
      break;
    case 'xq:hand_over': {
      clearActionPending();
      selected.value = -1;
      targets.value = [];
      handOver.value = data as XqHandOver;
      const result = data.draw
        ? '和棋'
        : (data.public?.seats?.[data.winner]?.color === 'r' ? '红方胜' : '黑方胜');
      note(`—— 第 ${data.public.gameNo} 局结束：${result} ——`);
      if (data.reason === 'both_left_draw') note('双方均已离席，本局按和棋结算');
      break;
    }
    case 'xq:settled':
      clearActionPending();
      settled.value = data as XqSettled;
      pub.value = data.public;
      break;
    case 'xq:bot_takeover': {
      const s = data.public?.seats?.[data.seat];
      if (s) note(`${s.name || nameOf(data.seat)} 离席，AI 代打`);
      if (data.seat !== mySeat.value && !spectate.value && data.public?.phase === 'playing') {
        showInfo('对手已离席，本局由 AI 代打继续');
      }
      break;
    }
    case 'xq:session_end':
      clearActionPending();
      note(data.reason === 'all_gone' ? '全员离席，房间解散' : '有玩家离席，本局结束后房间解散');
      break;
  }
}

// ── 结算视图数据 ──
const myDelta = computed<number | null>(() => {
  const s = settled.value;
  if (!s || !myPlayerId.value) return null;
  if (!(myPlayerId.value in s.deltas)) return null;
  return s.deltas[myPlayerId.value];
});
const myScore = computed(() => {
  const s = settled.value;
  if (!s || !myPlayerId.value || !(myPlayerId.value in s.scores)) return 0;
  return s.scores[myPlayerId.value];
});

// ── SDK 接入 ──
let client: ReturnType<typeof createXiangqiClient> | null = null;

onMounted(async () => {
  tickTimer = window.setInterval(tick, 500);
  document.addEventListener('visibilitychange', onVisibility);

  let config: HostGameConfig;
  try {
    config = await requestHostGameConfig();
  } catch (error) {
    configError.value = error instanceof Error ? error.message : '无法获取游戏宿主配置';
    return;
  }
  spectate.value = !!config.spectate;

  client = createXiangqiClient(config, {
    onSync(data: XqSync) {
      touchEvent();
      clearActionPending();
      matchWaiting.value = false;
      pub.value = data;
      if (data.playerId) myPlayerId.value = data.playerId;
      handOver.value = data.handOver ?? null;
      settled.value = data.settled ?? null;
      selected.value = -1;
      targets.value = [];
      if (typeof data.balance === 'number') applyBalance(data.balance, data.version ?? 0);
      connected.value = true;
      reconnecting.value = false;
      connectionLost.value = false;
    },
    onBroadcast,
    onSession(playerCount: number, state: string) {
      touchEvent();
      if (playerCount >= 0) sessionPlayers.value = playerCount;
      if (state === 'ready' || state === 'playing' || state === 'started') {
        matchWaiting.value = false;
      }
      // 会话终态（引擎异常/超时/解散）：引擎已不存在，任何等待都是死局，
      // 必须给出终点浮层而不是让玩家永远停在"思考中"。
      if (state === 'error') endSession('error');
      else if (state === 'timeout') endSession('timeout');
      else if (state === 'finished') endSession('dissolved');
    },
    onBalance(bal: number, version: number) {
      touchEvent();
      applyBalance(bal, version);
    },
    onError(error: string) {
      touchEvent();
      clearActionPending();
      showError(error);
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
      lastBalanceVersion.value = 0;
    },
    onReconnectFailed() {
      reconnecting.value = false;
      connectionLost.value = true;
    },
    onFinished() {
      touchEvent();
      clearActionPending();
      endSession('dissolved');
    },
  });
  client.connect();
});

function onVisibility() {
  if (document.visibilityState === 'visible' && client?.isConnected()) {
    client.sync();
  }
}

// 游戏自带返回按钮：对局进行中先弹确认（退出 = 离席，AI 代打；
// 双方都退出则和棋收尾），其余场景直接返回大厅。
const exitAsk = ref(false);
function exitToLobby() {
  const p = pub.value;
  const s = p?.seats[mySeat.value];
  if (p && p.phase === 'playing' && !spectate.value && s && !s.bot) {
    exitAsk.value = true;
    return;
  }
  doExitToLobby();
}
function doExitToLobby() {
  exitAsk.value = false;
  if (!notifyGameExit() && window.history.length > 1) window.history.back();
}

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  document.removeEventListener('visibilitychange', onVisibility);
  client?.disconnect();
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.chip {
  @apply text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300 whitespace-nowrap;
}
</style>
