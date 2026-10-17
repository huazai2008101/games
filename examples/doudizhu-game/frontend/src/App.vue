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
        <GameIcon name="cards" class="w-6 h-6 text-amber-300" />
        <span class="font-extrabold tracking-wide bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent">
          斗地主
        </span>
        <template v-if="pub">
          <span class="chip">第 {{ pub.handNo }} 局</span>
          <span class="chip">底分 {{ pub.base }}</span>
          <span class="chip !text-amber-300 !border-amber-500/40 !bg-amber-500/10">倍数 ×{{ pub.multiplier }}</span>
          <span v-if="pub.bombCount > 0" class="chip inline-flex items-center gap-1 !text-red-300 !border-red-500/40 !bg-red-500/10">
            <GameIcon name="bomb" class="w-3 h-3" />
            ×2<sup>{{ pub.bombCount }}</sup>
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
      <GameIcon name="cards" class="w-12 h-12 text-slate-600" />
      <p class="text-slate-400 text-sm max-w-sm">{{ configError }}</p>
      <p class="text-slate-600 text-xs">本页面需由平台大厅以 iframe 方式加载并下发连接配置。</p>
    </div>

    <template v-else>
      <!-- ── 牌桌 ── -->
      <main :class="['relative flex-1 table-felt overflow-hidden', shaking ? 'animate-shake' : '']">
        <!-- 底牌区 -->
        <div class="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 z-10">
          <div class="flex gap-1.5">
            <template v-if="bottomShown && pub && pub.bottom.length === 3">
              <PlayingCard v-for="(c, i) in pub.bottom" :key="c" :card="c" size="sm" class="animate-pop-in" :style="{ animationDelay: i * 120 + 'ms' }" />
            </template>
            <template v-else-if="pub && pub.phase !== 'lobby'">
              <PlayingCard v-for="i in 3" :key="i" :card="null" size="sm" />
            </template>
          </div>
          <span class="text-[10px] text-emerald-200/60 tracking-widest">{{ bottomShown ? '底牌' : '隐藏底牌' }}</span>
        </div>

        <!-- 上家（左） -->
        <div class="absolute left-4 top-[32%] -translate-y-1/2">
          <PlayerSeat
            v-if="leftSeat"
            :seat="leftSeat"
            :is-turn="isSeatTurn(leftSeat.seat)"
            :turn-ends-at="pub?.turnEndsAt ?? 0"
            :is-landlord="leftSeat.seat === pub?.landlordSeat"
            :is-dealer="leftSeat.seat === pub?.dealer"
            :phase="pub?.phase ?? 'lobby'"
            :played="lastAction[leftSeat.seat]?.cards ?? null"
            :pass-tag="lastAction[leftSeat.seat]?.pass ?? false"
            :has-bid="seatHasBid(leftSeat.seat)"
          />
        </div>

        <!-- 下家（右） -->
        <div class="absolute right-4 top-[32%] -translate-y-1/2">
          <PlayerSeat
            v-if="rightSeat"
            :seat="rightSeat"
            :is-turn="isSeatTurn(rightSeat.seat)"
            :turn-ends-at="pub?.turnEndsAt ?? 0"
            :is-landlord="rightSeat.seat === pub?.landlordSeat"
            :is-dealer="rightSeat.seat === pub?.dealer"
            :phase="pub?.phase ?? 'lobby'"
            :played="lastAction[rightSeat.seat]?.cards ?? null"
            :pass-tag="lastAction[rightSeat.seat]?.pass ?? false"
            :has-bid="seatHasBid(rightSeat.seat)"
          />
        </div>

        <!-- 中央提示 -->
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div class="text-center -mt-8">
            <div v-if="centerTitle" class="text-2xl font-black tracking-widest drop-shadow-lg"
              :class="myTurn ? 'text-amber-300 animate-pulse' : 'text-emerald-100/80'">
              {{ centerTitle }}
            </div>
            <div v-if="centerSub" class="mt-1 text-xs text-emerald-100/50">{{ centerSub }}</div>
            <Transition name="fade">
              <div v-if="bombFx" class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <GameIcon name="bomb" class="w-24 h-24 text-amber-400 drop-shadow-[0_0_24px_rgba(251,191,36,0.8)] animate-pop-in" />
              </div>
            </Transition>
          </div>
        </div>

        <!-- 平台级自动匹配等待（引擎尚未开局：人数不足） -->
        <div v-if="matchWaiting && !pub" class="absolute inset-0 flex items-center justify-center">
          <div class="text-center">
            <div class="flex items-center justify-center gap-1.5 mb-3">
              <span v-for="i in 3" :key="i" class="w-2.5 h-2.5 rounded-full bg-emerald-300/80 animate-bounce" :style="{ animationDelay: i * 150 + 'ms' }"></span>
            </div>
            <div class="text-lg font-bold text-emerald-100/90 tracking-widest">自动匹配中…</div>
            <div class="mt-1 text-xs text-emerald-100/50">
              {{ matchWaitingText }}
            </div>
          </div>
        </div>

        <!-- 对局动态 -->
        <div v-if="feed.length" class="absolute bottom-3 left-4 w-64 bg-slate-950/50 border border-white/10 rounded-xl px-3 py-2 backdrop-blur">
          <div class="text-[10px] text-slate-500 mb-1">对局动态</div>
          <div v-for="(f, i) in feed" :key="f.t + '-' + i" :class="['text-[11px] leading-5 break-words', i === 0 ? 'text-slate-300' : 'text-slate-500']">
            {{ f.text }}
          </div>
        </div>

        <!-- 重连横幅 -->
        <div v-if="reconnecting" class="absolute top-2 right-2 text-xs bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
          <GameIcon name="wifi" class="w-3.5 h-3.5" />
          连接中断，正在重连…
        </div>
        <div v-if="connectionLost" class="absolute top-2 right-2 text-xs bg-red-500/15 text-red-300 border border-red-500/30 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
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
        <div class="px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
          <!-- 我的信息 -->
          <div class="flex items-center gap-2.5 min-w-40">
            <div class="relative">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center"
                :style="avatarStyle(myPlayerId)"
              >
                <span class="text-base font-bold">{{ monogram(myName) }}</span>
              </div>
              <GameIcon v-if="iAmLandlord" name="crown" class="absolute -top-2 -right-2 w-5 h-5 text-amber-300 animate-stamp drop-shadow" />
            </div>
            <div class="leading-tight">
              <div class="text-sm font-semibold flex items-center gap-1.5">
                {{ myName }}
                <span
                  v-if="myRoleChip"
                  :class="[
                    'text-[10px] font-bold rounded-md px-1.5 py-0.5 border',
                    myRoleChip === '地主'
                      ? 'text-amber-300 border-amber-400/50 bg-amber-500/15'
                      : 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
                  ]"
                >{{ myRoleChip }}</span>
              </div>
              <div class="text-[11px] text-slate-400">
                剩 <span :class="['font-bold', hand.length <= 2 ? 'text-red-400' : 'text-slate-200']">{{ hand.length }}</span> 张
                <span v-if="myTurn && myRemaining > 0" class="text-amber-300 ml-1 inline-flex items-center gap-0.5">
                  <GameIcon name="clock" class="w-3 h-3" />
                  {{ myRemaining }}s
                </span>
              </div>
            </div>
          </div>

          <!-- 操作区 -->
          <div class="flex-1 flex justify-center">
            <ActionPanel
              v-if="pub && !spectate && pub.phase !== 'settle'"
              :phase="pub.phase"
              :my-turn="myTurn"
              :turn-name="turnSeatName"
              :bid-score="pub.bidScore"
              :can-pass="canPass"
              :can-play="canPlay"
              :selected-cards="selected"
              :ready-enabled="readyEnabled"
              :ready-note="readyNote"
              :busy="actionPending"
              :matched-count="matchedCount"
              @bid="bid"
              @pass="pass"
              @hint="hint"
              @play-selected="playSelected"
              @ready="ready"
            />
            <div v-else-if="pub && spectate" class="text-sm text-slate-400">
              {{ centerTitle || '观战中' }}
            </div>
          </div>

          <!-- 右侧留白（对称） -->
          <div class="min-w-40 text-right">
            <span v-if="pub && pub.phase === 'playing'" class="text-[11px] text-slate-500">
              {{ passStreakHint }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── 手牌 ── -->
      <section class="shrink-0 hand-dock bg-gradient-to-b from-slate-900 to-slate-950 border-t border-black/50">
        <div class="hand-scroll overflow-x-auto overflow-y-hidden px-4 pt-5 pb-4 min-h-[7.75rem] flex items-end justify-center">
          <div class="flex items-end mx-auto" :class="hand.length > 15 ? '-space-x-8' : '-space-x-6'">
            <div
              v-for="(c, i) in hand"
              :key="c + '-' + dealKey"
              class="cursor-pointer transition-transform duration-150"
              role="button"
              tabindex="0"
              :aria-label="cardLabel(c)"
              :aria-pressed="isSelected(c)"
              :class="isSelected(c) ? '-translate-y-4' : 'hover:-translate-y-1.5'"
              :style="dealAnim ? { animation: `deal-in 0.3s ease-out both`, animationDelay: i * 35 + 'ms' } : {}"
              @click="toggleCard(c)"
              @keydown.enter.prevent="toggleCard(c)"
            >
              <PlayingCard :card="c" size="md" :selected="isSelected(c)" />
            </div>
            <div v-if="hand.length === 0 && pub?.phase === 'playing'" class="text-slate-500 text-sm">
              手牌已出完
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- 房间已解散（平台 session:finished 后的终点态） -->
    <div v-if="sessionDissolved" class="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur flex items-center justify-center p-4">
      <div class="text-center max-w-sm w-full rounded-3xl border border-white/10 bg-slate-900/80 px-8 py-10">
        <div class="mx-auto mb-3 w-16 h-16 rounded-full bg-slate-700/30 border border-slate-500/60 flex items-center justify-center">
          <GameIcon name="exit" class="w-8 h-8 text-slate-400" />
        </div>
        <div class="text-xl font-bold text-slate-100">房间已解散</div>
        <p class="mt-2 text-sm text-slate-400">有玩家离席后未归队，本局结束后房间自动解散，避免空位重开。</p>
        <button
          type="button"
          class="mt-6 w-full py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 shadow-lg shadow-orange-500/25 active:scale-95 transition"
          @click="exitToLobby"
        >
          返回大厅
        </button>
      </div>
    </div>

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

    <!-- 结算浮层 -->
    <SettlementOverlay
      :hand-over="handOver"
      :settled="settled"
      :player-id="myPlayerId"
      :my-seat="mySeat"
      :dissolving="dissolving"
      :pub="pub"
      @ready="ready"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { requestHostGameConfig, notifyGameExit, type HostGameConfig } from '@game-platform/frontend-sdk';
import {
  createDoudizhuClient,
  type DdzHandOver,
  type DdzSettled,
  type DdzSync,
} from './game';
import type { DdzPublic, SeatView } from './types';
import { cardLabel, countByValue, detectCombo, findPlays, sortCardsDesc, VALUE_LABELS, validatePlay, type ComboType } from './cards';
import { monogram, avatarStyle } from './avatar';
import PlayerSeat from './components/PlayerSeat.vue';
import ActionPanel from './components/ActionPanel.vue';
import PlayingCard from './components/PlayingCard.vue';
import SettlementOverlay from './components/SettlementOverlay.vue';
import GameIcon from './components/GameIcon.vue';

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

// ── 平台级自动匹配等待态 ──
// quick 模式人数不足时 ready 被平台拒绝（"need at least N players to ready"），
// 据此进入匹配等待视图；引擎开局（首条游戏快照/广播）即解除。
const sessionPlayers = ref(0);
const matchWaiting = ref(false);
const matchHave = ref(0);
const matchNeed = ref(0);
const sessionDissolved = ref(false);

const matchWaitingText = computed(() => {
  if (matchHave.value > 0 && matchNeed.value > 0) return `已匹配 ${matchHave.value}/${matchNeed.value} 人，满足开局人数后自动组建房间`;
  return sessionPlayers.value > 0 ? `当前 ${sessionPlayers.value} 人排队，满足开局人数后自动组建房间` : '正在加入匹配队列…';
});

function translateError(msg: string): string {
  const lower = String(msg).toLowerCase();
  if (lower.includes('insufficient balance')) return '余额不足，请充值后再战';
  const m = lower.match(/need at least (\d+) players to ready(?:\s*\((\d+)\/(\d+)\))?/);
  if (m) {
    matchNeed.value = Number(m[1]);
    matchHave.value = Number(m[2] || '0');
    matchWaiting.value = true;
    return '人数未满，自动匹配中…';
  }
  if (lower.includes('不合法') || lower.includes('压不过')) return msg;
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

// ── 牌局状态 ──
const pub = ref<DdzPublic | null>(null);
const hand = ref<number[]>([]);
const myPlayerId = ref('');
const spectate = ref(false);
const handOver = ref<DdzHandOver | null>(null);
const settled = ref<DdzSettled | null>(null);
const selected = ref<number[]>([]);
const dealKey = ref(0);
const dealAnim = ref(false);
const shaking = ref(false);
const bombFx = ref(false);
const feed = ref<Array<{ t: number; text: string }>>([]);

/** 座位最近一次动作：出牌内容或过牌标记（用于座位出牌展示与"不要"标签）。 */
type SeatAction = { cards: number[]; pass: boolean } | null;
const lastAction = ref<SeatAction[]>([null, null, null]);

const mySeat = computed(() => {
  if (spectate.value) return -1;
  return pub.value?.seats.find((s) => s.id === myPlayerId.value)?.seat ?? -1;
});
const leftSeat = computed<SeatView | null>(() => seatAt(+2));
const rightSeat = computed<SeatView | null>(() => seatAt(+1));
function seatAt(offset: number): SeatView | null {
  const p = pub.value;
  if (!p) return null;
  if (mySeat.value < 0) return p.seats[(p.dealer + offset) % 3];
  return p.seats[(mySeat.value + offset) % 3];
}

const iAmLandlord = computed(() => mySeat.value >= 0 && pub.value?.landlordSeat === mySeat.value);
const iAmFarmer = computed(() => {
  const p = pub.value;
  return mySeat.value >= 0 && p !== null && p.landlordSeat >= 0 && p.landlordSeat !== mySeat.value;
});
const bottomShown = computed(() => pub.value?.bottomShown ?? false);
const dissolving = computed(() => pub.value?.phase === 'dissolving');
const matchedCount = computed(() => (pub.value ? pub.value.seats.filter((s) => !s.bot).length : 0));
const myRoleChip = computed(() => {
  if (iAmLandlord.value) return '地主';
  if (iAmFarmer.value) return '农民';
  return '';
});

function isSeatTurn(seat: number): boolean {
  const p = pub.value;
  if (!p) return false;
  return p.turn === seat && (p.phase === 'bidding' || p.phase === 'playing');
}
/** 叫分阶段该座位是否已行动：按 dealer 起的轮转次序推导。 */
function seatHasBid(seat: number): boolean {
  const p = pub.value;
  if (!p || p.phase !== 'bidding') return false;
  return ((seat - p.dealer + 3) % 3) < p.bidActed;
}
const myTurn = computed(() => isSeatTurn(mySeat.value));
const turnSeatName = computed(() => {
  const p = pub.value;
  if (!p || p.turn < 0) return '';
  const s = p.seats[p.turn];
  if (!s) return '';
  if (s.bot) return 'AI';
  return s.id === myPlayerId.value ? '你' : displayName(s);
});

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 4) + '…' + id.slice(-4) : id;
}
const myName = computed(() => {
  const me = pub.value?.seats.find((s) => s.id === myPlayerId.value);
  return (me && me.name) || (myPlayerId.value ? shortId(myPlayerId.value) : '我');
});

// ── 中央提示 ──
const centerTitle = computed(() => {
  const p = pub.value;
  if (!p) return '';
  if (p.phase === 'matching') return '自动匹配中';
  if (p.phase === 'lobby') {
    const readyCount = p.seats.filter((s) => s.ready).length;
    return readyCount > 0 ? '等待开局…' : '等待玩家就绪';
  }
  if (p.phase === 'bidding') return myTurn.value ? '轮到你叫分' : '叫地主';
  if (p.phase === 'playing') {
    if (myTurn.value) return pub.value?.lastPlay ? '轮到你出牌' : '你先出牌';
    return '';
  }
  return '';
});
const centerSub = computed(() => {
  const p = pub.value;
  if (!p) return '';
  if (p.phase === 'matching') return `已就座 ${matchedCount.value}/3 · 满员自动开局，空位 15s 后由 AI 补位`;
  if (p.phase === 'bidding' && p.bidScore > 0) return `当前最高叫分：${p.bidScore}`;
  if (p.phase === 'playing' && turnSeatName.value) return `${turnSeatName.value} 思考中`;
  return '';
});
const passStreakHint = computed(() => {
  const p = pub.value;
  if (!p || !p.lastPlay) return '';
  return `${seatLabel(p.lastPlay.seat)} 刚出牌，两家不要则由 TA 重新领出`;
});
function seatLabel(seat: number): string {
  if (seat === mySeat.value) return '你';
  if (mySeat.value >= 0) return seat === (mySeat.value + 1) % 3 ? '下家' : '上家';
  return '玩家';
}

// ── 手牌交互 ──
function isSelected(c: number): boolean {
  return selected.value.includes(c);
}
function toggleCard(c: number) {
  if (spectate.value || actionPending.value) return;
  const idx = selected.value.indexOf(c);
  if (idx >= 0) selected.value.splice(idx, 1);
  else selected.value.push(c);
}

const lastComboForMe = computed(() => {
  const p = pub.value;
  if (!p || p.phase !== 'playing') return null;
  if (!p.lastPlay || p.lastPlay.cards.length === 0) return null;
  if (p.lastPlay.seat === mySeat.value) return null; // 自己领出
  return detectCombo(p.lastPlay.cards);
});
const canPass = computed(() => !!pub.value && myTurn.value && pub.value.phase === 'playing' && lastComboForMe.value !== null);
const canPlay = computed(() => {
  const p = pub.value;
  if (!p || !myTurn.value || p.phase !== 'playing' || selected.value.length === 0) return false;
  return validatePlay(hand.value, selected.value, lastComboForMe.value) !== null;
});

// 防止双击/重复提交：保留选牌直到服务端广播确认，失败时玩家仍可直接重试。
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

function playSelected() {
  if (!canPlay.value || !submitAction('play', { cards: [...selected.value].sort((a, b) => b - a) })) return;
}
function pass() {
  if (!canPass.value || !submitAction('play', { cards: [] })) return;
}
function bid(score: number) {
  submitAction('bid', { score });
}

// 提示：循环枚举所有能压过的牌组
let hintIdx = 0;
function hint() {
  const p = pub.value;
  if (!p || !myTurn.value || p.phase !== 'playing' || actionPending.value) return;
  const plays = findPlays(hand.value, lastComboForMe.value);
  if (plays.length === 0) {
    if (lastComboForMe.value) showError('要不起，点「不出」过牌');
    return;
  }
  const play = plays[hintIdx % plays.length];
  hintIdx++;
  selected.value = [...play.cards];
}

function ready() {
  submitAction('ready_hand', {});
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
const myRemainingPct = computed(() => {
  const total = pub.value?.phase === 'bidding' ? 15 : 25;
  return Math.min(100, (myRemaining.value / total) * 100);
});

// ── 漂移看门狗 ──
// 广播是唯一事实源，但标签页被浏览器节流/系统瞬时时，客户端可能在连接
// 仍显示"已连接"的情况下静默漏掉若干条广播，视图落后数个回合且不自愈
// （visibilitychange 只在隐藏→可见时触发）。这里做两级主动对账：
//   1) 回合漂移：轮到自己却已越过服务端截止时间 3s 仍无状态更新；
//   2) 全局静默：可见状态下超过 30s 未收到任何广播（对局中每手牌都有
//      广播，30s 静默即为漏消息）。
// 命中即发 state:sync 拉全量快照；每个回合漂移只对账一次，避免时钟
// 偏差导致重复触发。
let lastEventAt = Date.now();
let driftSyncTurnKey = '';
function touchEvent() { lastEventAt = Date.now(); }
function reconcile(reason: string) {
  touchEvent();
  if (client?.isConnected()) {
    console.warn('[Doudizhu] drift detected, reconciling:', reason);
    client.sync();
  }
}

let tickTimer: number | undefined;
function tick() {
  const p = pub.value;
  if (!p || !myTurn.value) {
    myRemaining.value = 0;
  } else {
    myRemaining.value = Math.max(0, Math.ceil((p.turnEndsAt - Date.now()) / 1000));
    if (p.turnEndsAt && Date.now() > p.turnEndsAt + 3000) {
      const turnKey = `${p.handNo}:${p.phase}:${p.turn}`;
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
function nameOf(seat: number): string {
  const s = pub.value?.seats[seat];
  if (!s) return '?';
  if (s.bot) return 'AI';
  if (s.id === myPlayerId.value) return '你';
  return displayName(s);
}

/** 动态里的身份注记：地主已确定时给行牌者标注（地主），农民不再重复标注。 */
function roleTag(seat: number): string {
  const p = pub.value;
  if (!p || p.landlordSeat < 0) return '';
  return p.landlordSeat === seat ? '（地主）' : '';
}

function valueLabel(v: number): string {
  if (v === 16) return '小王';
  if (v === 17) return '大王';
  return VALUE_LABELS[v - 3];
}

/** 牌型中文短句（动态用）：点出牌型与关键牌点，如「顺子 3~7」「三带一（K）」。 */
function comboDesc(type: ComboType | null, cards: number[]): string {
  if (!type) return `${cards.length} 张牌`;
  const buckets = countByValue(cards);
  const vals = [...buckets.keys()].sort((a, b) => a - b);
  const label = valueLabel;
  const range = (vs: number[]) => (vs.length > 1 ? `${label(vs[0])}~${label(vs[vs.length - 1])}` : label(vs[0]));
  const trioVals = vals.filter((v) => buckets.get(v)!.length >= 3);
  const quadVal = vals.find((v) => buckets.get(v)!.length === 4);
  switch (type) {
    case 'single': return `单张 ${cardLabel(cards[0])}`;
    case 'pair': return `对${label(vals[0])}`;
    case 'trio': return `三张${label(vals[0])}`;
    case 'trio_single': return `三带一（${label(trioVals[0])}）`;
    case 'trio_pair': return `三带对（${label(trioVals[0])}）`;
    case 'straight': return `顺子 ${range(vals)}`;
    case 'pair_straight': return `连对 ${range(vals)}`;
    case 'plane': return `飞机 ${range(trioVals)}`;
    case 'plane_single': return `飞机（${range(trioVals)}）带单`;
    case 'plane_pair': return `飞机（${range(trioVals)}）带对`;
    case 'four_two_single': return `四带二（${label(quadVal!)}）`;
    case 'four_two_pair': return `四带两对（${label(quadVal!)}）`;
    case 'bomb': return `炸弹（${label(vals[0])}）`;
    case 'rocket': return '王炸';
  }
}

/** 展示名优先用平台名册的 username,缺失时回退短 ID。 */
function displayName(s: { name?: string; id: string }): string {
  return s.name || shortId(s.id);
}

function onBroadcast(action: string, data: any) {
  touchEvent();
  matchWaiting.value = false; // 引擎已在发广播 → 匹配等待结束
  if (data?.public) pub.value = data.public as DdzPublic;
  switch (action) {
    case 'ddz:init':
      sessionDissolved.value = false; // 新房间开启（解散后重新匹配成功）
      if (data.public?.phase === 'matching') note('自动匹配开启，等待玩家入座');
      break;
    case 'ddz:player_joined':
      note(`${data.public?.seats?.[data.seat]?.name || '新玩家'} 匹配入座`);
      break;
    case 'ddz:match_filled':
      note(
        data.reason === 'full'
          ? '匹配成功，自动开局'
          : data.reason === 'skip'
            ? '跳过等待，AI 补位开局'
            : '匹配超时，AI 补位开局',
      );
      break;
    case 'ddz:player_return': {
      const s = data.public?.seats?.[data.seat];
      if (data.seat === mySeat.value) client?.sync(); // 归队即对账（离席期间 AI 代打可能落后）
      note(`${s?.name || '玩家'} 归队，恢复操控`);
      break;
    }
    case 'ddz:deal':
      lastAction.value = [null, null, null];
      selected.value = [];
      hand.value = [];
      clearActionPending();
      handOver.value = null;
      settled.value = null;
      dealKey.value++;
      dealAnim.value = true;
      note(`—— 第 ${data.public.handNo} 局开始：${nameOf(data.public.dealer)} 先叫地主 ——`);
      break;
    case 'ddz:ready':
      note(`${nameOf(data.seat)} 准备就绪`);
      if (data.seat === mySeat.value) {
        clearActionPending();
        handOver.value = null;
        settled.value = null;
      }
      break;
    case 'ddz:bid':
      note(data.score > 0 ? `${nameOf(data.seat)} 叫 ${data.score} 分` : `${nameOf(data.seat)} 不叫`);
      if (data.seat === mySeat.value) clearActionPending();
      break;
    case 'ddz:landlord':
      note(`${nameOf(data.seat)} 以 ${data.bid} 分成为地主，收入 3 张底牌`);
      break;
    case 'ddz:play': {
      // 自己的出牌要从手牌数组即时移除（广播是手牌的唯一增量来源，
      // ddz:sync 只在入场/重连时拉取）
      if (data.seat === mySeat.value && Array.isArray(data.cards) && data.cards.length > 0) {
        const played = new Set(data.cards);
        hand.value = hand.value.filter((c) => !played.has(c));
      }
      if (data.seat === mySeat.value) {
        clearActionPending();
        selected.value = [];
      }
      const act: SeatAction = data.cards.length > 0
        ? { cards: data.cards, pass: false }
        : { cards: [], pass: true };
      lastAction.value = lastAction.value.map((v, i) => (i === data.seat ? act : v));
      if (data.cards.length === 0) {
        note(`${nameOf(data.seat)}${roleTag(data.seat)} 不要`);
      } else if (data.bomb) {
        note(`${nameOf(data.seat)}${roleTag(data.seat)} 打出 ${comboDesc(data.comboType ?? detectCombo(data.cards)?.type ?? null, data.cards)}`);
        triggerBombFx();
      } else {
        note(`${nameOf(data.seat)}${roleTag(data.seat)} 出 ${comboDesc(data.comboType ?? detectCombo(data.cards)?.type ?? null, data.cards)}`);
      }
      break;
    }
    case 'ddz:redeal':
      note('无人叫地主，重新发牌');
      break;
    case 'ddz:hand_over':
      clearActionPending();
      handOver.value = data as DdzHandOver;
      note(`—— 第 ${data.public.handNo} 局结束：${data.landlordWins ? '地主胜' : '农民胜'}${data.spring ? '（春天）' : ''} ——`);
      break;
    case 'ddz:settled':
      clearActionPending();
      settled.value = data as DdzSettled;
      pub.value = data.public;
      break;
    case 'ddz:bot_takeover': {
      const s = data.public?.seats?.[data.seat];
      if (s) note(`${s.name || nameOf(data.seat)} 离席，AI 代打`);
      break;
    }
    case 'ddz:session_end':
      clearActionPending();
      note(data.reason === 'all_gone' ? '全员离席，房间解散' : '有玩家离席，本局结束后房间解散');
      break;
  }
}

function triggerBombFx() {
  shaking.value = true;
  bombFx.value = true;
  setTimeout(() => { shaking.value = false; }, 500);
  setTimeout(() => { bombFx.value = false; }, 900);
}

// ── SDK 接入 ──
let client: ReturnType<typeof createDoudizhuClient> | null = null;

onMounted(async () => {
  tickTimer = window.setInterval(tick, 500);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);

  let config: HostGameConfig;
  try {
    config = await requestHostGameConfig();
  } catch (error) {
    configError.value = error instanceof Error ? error.message : '无法获取游戏宿主配置';
    return;
  }
  spectate.value = !!config.spectate;

  client = createDoudizhuClient(config, {
    onSync(data: DdzSync) {
      touchEvent();
      clearActionPending();
      matchWaiting.value = false;
      pub.value = data;
      if (data.playerId) myPlayerId.value = data.playerId;
      handOver.value = data.handOver ?? null;
      settled.value = data.settled ?? null;
      lastAction.value = [null, null, null];
      if (data.lastPlay) {
        lastAction.value[data.lastPlay.seat] = {
          cards: data.lastPlay.cards,
          pass: false,
        };
      }
      if (Array.isArray(data.hand)) {
        hand.value = sortCardsDesc(data.hand);
        dealAnim.value = false;
      }
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
        matchWaiting.value = false; // 会话已开局，退出匹配等待视图
      }
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
      lastBalanceVersion.value = 0; // 重连后以带版本号的快照重建水位线
    },
    onReconnectFailed() {
      reconnecting.value = false;
      connectionLost.value = true;
    },
    onFinished() {
      // 平台 session:finished：房间已解散（离席未归队/全员离席/超时）
      touchEvent();
      clearActionPending();
      sessionDissolved.value = true;
    },
  });
  client.connect();
});

function onKey(e: KeyboardEvent) {
  if (spectate.value) return;
  if (e.key === 'Enter' && canPlay.value) { playSelected(); e.preventDefault(); }
  else if (e.key === 'h' || e.key === 'H') hint();
  else if (e.key === 'p' || e.key === 'P') pass();
}

function onVisibility() {
  if (document.visibilityState === 'visible' && client?.isConnected()) {
    client.sync(); // 恢复可见时向引擎对账全量快照
  }
}

// 游戏自带返回按钮：通知宿主大厅导航返回；独立预览（无宿主）时退回浏览器历史。
function exitToLobby() {
  if (!notifyGameExit() && window.history.length > 1) window.history.back();
}

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  document.removeEventListener('keydown', onKey);
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
.hand-dock {
  box-shadow: inset 0 12px 24px -18px rgba(0, 0, 0, 0.9);
}
</style>
