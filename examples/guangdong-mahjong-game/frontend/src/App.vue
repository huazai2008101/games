<template>
  <div :class="['relative h-full overflow-hidden table-felt', shaking ? 'animate-shake' : '']">
    <!-- ── 顶栏（悬浮于牌桌之上） ── -->
    <header class="absolute top-0 inset-x-0 h-11 shrink-0 z-30 flex items-center justify-between px-3 bg-gradient-to-b from-slate-950/85 via-slate-950/50 to-transparent">
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
        <GameIcon name="tile" class="w-5 h-5 text-red-400" />
        <span class="font-extrabold tracking-wide bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent text-sm">
          广东麻将
        </span>
        <template v-if="pub">
          <span class="chip">第 {{ pub.handNo }} 局</span>
          <span class="chip">底分 {{ pub.base }}</span>
          <span class="chip">{{ fanCapLabel }}</span>
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
    <div v-if="configError" class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <GameIcon name="tile" class="w-12 h-12 text-slate-600" />
      <p class="text-slate-400 text-sm max-w-sm">{{ configError }}</p>
      <p class="text-slate-600 text-xs">本页面需由平台大厅以 iframe 方式加载并下发连接配置。</p>
    </div>

    <template v-else>
      <!-- ── 对家（上） ── -->
      <div class="absolute top-12 left-1/2 -translate-x-1/2 z-10">
        <PlayerSeat
          v-if="topSeat"
          :seat="topSeat"
          dir="top"
          :is-turn="isSeatTurn(topSeat.seat)"
          :turn-ends-at="pub?.turnEndsAt ?? 0"
          :is-dealer="topSeat.seat === pub?.dealer"
          :phase="pub?.phase ?? 'lobby'"
        />
        <div v-else class="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-slate-950/40 px-3 py-2.5 text-sm text-slate-400 w-60">
          <span class="w-2 h-2 rounded-full bg-emerald-300 animate-bounce"></span>
          等待玩家入座…
        </div>
      </div>

      <!-- ── 上家（左）/ 下家（右） ── -->
      <div class="absolute left-2 top-[36%] -translate-y-1/2 z-10">
        <PlayerSeat
          v-if="leftSeat"
          :seat="leftSeat"
          dir="left"
          :is-turn="isSeatTurn(leftSeat.seat)"
          :turn-ends-at="pub?.turnEndsAt ?? 0"
          :is-dealer="leftSeat.seat === pub?.dealer"
          :phase="pub?.phase ?? 'lobby'"
        />
      </div>
      <div class="absolute right-2 top-[36%] -translate-y-1/2 z-10">
        <PlayerSeat
          v-if="rightSeat"
          :seat="rightSeat"
          dir="right"
          :is-turn="isSeatTurn(rightSeat.seat)"
          :turn-ends-at="pub?.turnEndsAt ?? 0"
          :is-dealer="rightSeat.seat === pub?.dealer"
          :phase="pub?.phase ?? 'lobby'"
        />
      </div>

      <!-- ── 中央牌池：四方位弃牌河 + 局信息 ── -->
      <div class="absolute inset-x-0 top-[13%] bottom-[27%] z-[5] flex items-center justify-center">
        <CenterPool
          :top="poolRivers.top"
          :left="poolRivers.left"
          :right="poolRivers.right"
          :bottom="poolRivers.bottom"
          :last-tile="lastDiscard?.tile ?? -1"
          :last-dir="lastDiscardDir"
          :hand-no="pub?.handNo ?? 0"
          :wall-count="pub?.wallCount ?? 0"
          :base="pub?.base ?? 0"
          :title="centerTitle"
          :sub="centerSub"
          :highlight="myDiscard || claiming"
        />
      </div>

      <!-- ── 吃/碰/杠 印章动效（出现在行动者方位） ── -->
      <Transition name="fade">
        <div v-if="stampFx" class="absolute z-20 pointer-events-none" :class="stampPosClass">
          <div
            class="w-20 h-20 rounded-2xl border-4 flex items-center justify-center animate-stamp shadow-2xl"
            :class="stampStyleClass"
          >
            <span class="text-4xl font-black tracking-wide">{{ stampFx.text }}</span>
          </div>
        </div>
      </Transition>

      <!-- ── 胡牌特效 ── -->
      <Transition name="fade">
        <div v-if="winFx" class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div class="w-32 h-32 rounded-3xl border-4 border-amber-300 bg-red-700/90 flex items-center justify-center animate-stamp shadow-[0_0_70px_rgba(220,38,38,0.9)]">
            <span class="text-7xl font-black text-amber-200">胡</span>
          </div>
        </div>
      </Transition>

      <!-- 平台级自动匹配等待（引擎尚未开局：人数不足） -->
      <div v-if="matchWaiting && !pub" class="absolute inset-0 z-10 flex items-center justify-center">
        <div class="text-center">
          <div class="flex items-center justify-center gap-1.5 mb-3">
            <span v-for="i in 4" :key="i" class="w-2.5 h-2.5 rounded-full bg-emerald-300/80 animate-bounce" :style="{ animationDelay: i * 150 + 'ms' }"></span>
          </div>
          <div class="text-lg font-bold text-emerald-100/90 tracking-widest">自动匹配中…</div>
          <div class="mt-1 text-xs text-emerald-100/50">
            {{ matchWaitingText }}
          </div>
        </div>
      </div>

      <!-- 对局动态（只显示最近 4 条，避免盖住左家座位卡） -->
      <div v-if="feed.length" class="absolute left-3 top-12 w-56 z-10 bg-slate-950/45 border border-white/10 rounded-xl px-3 py-2 backdrop-blur-sm pointer-events-none">
        <div class="text-[10px] text-slate-500 mb-1">对局动态</div>
        <div v-for="(f, i) in feed.slice(0, 4)" :key="f.t + '-' + i" :class="['text-[11px] leading-5 break-words', i === 0 ? 'text-slate-300' : 'text-slate-500']">
          {{ f.text }}
        </div>
      </div>

      <!-- 重连横幅 -->
      <div v-if="reconnecting" class="absolute top-12 right-3 text-xs bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 rounded-lg px-3 py-1.5 z-20 inline-flex items-center gap-1.5">
        <GameIcon name="wifi" class="w-3.5 h-3.5" />
        连接中断，正在重连…
      </div>
      <div v-if="connectionLost" class="absolute top-12 right-3 text-xs bg-red-500/15 text-red-300 border border-red-500/30 rounded-lg px-3 py-1.5 z-20 inline-flex items-center gap-1.5">
        <GameIcon name="wifi-off" class="w-3.5 h-3.5" />
        连接已断开，请刷新页面
      </div>

      <!-- ── 底部：操作面板 + 我的信息 + 副露 + 手牌 ── -->
      <section class="absolute bottom-0 inset-x-0 z-20">
        <!-- 操作面板（悬浮于手牌上方） -->
        <div class="flex justify-center mb-2">
          <ActionPanel
            v-if="pub && !spectate && pub.phase !== 'settle'"
            :phase="pub.phase"
            :my-discard="myDiscard"
            :claiming="claiming"
            :claim-tile="claimTile"
            :rob="claimRob"
            :can-win="claimCanWin"
            :can-kong="claimCanKong"
            :can-pong-claim="claimCanPong"
            :chi-options="claimChiOptions"
            :self-win="selfWin"
            :an-kong-options="anKongOptions"
            :bu-kong-options="buKongOptions"
            :selected-tile="selected"
            :waiting-text="waitingText"
            :ready-enabled="readyEnabled"
            :ready-note="readyNote"
            :busy="actionPending"
            :matched-count="matchedCount"
            @discard="discardTile"
            @chi="doChi"
            @pong="doPong"
            @kong="doKong"
            @win="doWin"
            @pass="doPass"
            @ready="ready"
          />
          <div v-else-if="pub && spectate" class="text-xs text-slate-300 bg-black/45 border border-white/10 px-4 py-1.5 rounded-full backdrop-blur">
            {{ centerTitle || '观战中' }}
          </div>
        </div>

        <!-- 手牌台面 -->
        <div class="hand-dock relative bg-gradient-to-b from-slate-950/20 via-slate-950/70 to-slate-950/90 border-t border-white/10">
          <!-- 出牌倒计时细条 -->
          <div class="absolute top-0 inset-x-0 h-[3px] bg-slate-800/60">
            <div
              class="h-full bg-gradient-to-r from-amber-400 to-red-500 transition-all duration-500"
              :style="{ width: myDiscard ? myRemainingPct + '%' : '0%' }"
            ></div>
          </div>

          <!-- 我的信息（左下角） -->
          <div class="absolute left-3 bottom-2.5 z-10 flex items-center gap-2.5">
            <div class="relative">
              <div
                v-if="myRemaining > 0"
                class="absolute -inset-1 rounded-full"
                :style="myRingStyle"
              ></div>
              <div class="w-10 h-10 rounded-full flex items-center justify-center ring-1 ring-white/15" :style="avatarStyle(myPlayerId)">
                <span class="text-base font-bold">{{ monogram(myName) }}</span>
              </div>
              <span
                v-if="iAmDealer"
                class="absolute -top-2 -right-2 text-[10px] leading-none text-amber-200 border border-amber-300/60 bg-slate-950 rounded px-1 py-0.5"
              >庄</span>
            </div>
            <div class="leading-tight">
              <div class="text-sm font-semibold">{{ myName }}</div>
              <div class="text-[11px] text-slate-400 inline-flex items-center gap-1">
                <template v-if="myDiscard && myRemaining > 0">
                  <GameIcon name="clock" class="w-3 h-3 text-amber-300" />
                  <span class="text-amber-300">{{ myRemaining }}s 内打出</span>
                </template>
                <template v-else-if="claiming">
                  <GameIcon name="clock" class="w-3 h-3 text-amber-300" />
                  <span class="text-amber-300">{{ claimRemaining }}s 内选择</span>
                </template>
                <template v-else>等待中</template>
              </div>
            </div>
          </div>

          <!-- 我的副露（左下上方） -->
          <div v-if="myMelds.length" class="absolute left-3 bottom-16 z-10 flex flex-wrap gap-1.5 max-w-[24vw]">
            <MeldGroup v-for="(m, i) in myMelds" :key="i" :meld="m" />
          </div>

          <!-- 手牌 -->
          <div class="hand-scroll overflow-x-auto overflow-y-hidden px-4 pt-2.5 pb-3 min-h-[5.6rem]">
            <div class="flex items-end justify-start md:justify-center min-w-max mx-auto gap-[2px]">
              <div
                v-for="(c, i) in handTiles"
                :key="c + '-' + dealKey"
                class="relative cursor-pointer transition-transform duration-150 shrink-0 z-0"
                role="button"
                tabindex="0"
                :aria-label="tileName(c)"
                :aria-pressed="isSelected(c)"
                :class="[
                  c === drawn ? 'ml-6' : '',
                  isSelected(c) ? '-translate-y-4 z-10' : 'hover:-translate-y-2 hover:z-10',
                ]"
                :style="dealAnim ? { animation: 'deal-in 0.3s ease-out both', animationDelay: i * 30 + 'ms' } : {}"
                @click="toggleTile(c)"
                @dblclick="quickDiscard(c)"
                @keydown.enter.prevent="toggleTile(c)"
              >
                <MahjongTile :tile="c" size="md" :selected="isSelected(c)" />
                <!-- 刚摸的牌：底部琥珀光点 -->
                <div v-if="c === drawn" class="absolute -bottom-2 inset-x-0 flex justify-center">
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.95)]"></span>
                </div>
              </div>
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
  createMahjongClient,
  type MjHandOver,
  type MjSettled,
  type MjSync,
} from './game';
import type { MjPublic, SeatView } from './types';
import { kindLabel, sortTiles } from './tiles';
import { canWinOn, canSelfWin, canPong, canKongOn, anKongTiles, buKongTiles, chiCombinations } from './mjui';
import { monogram, avatarStyle } from './avatar';
import PlayerSeat from './components/PlayerSeat.vue';
import ActionPanel from './components/ActionPanel.vue';
import MahjongTile from './components/MahjongTile.vue';
import CenterPool from './components/CenterPool.vue';
import MeldGroup from './components/MeldGroup.vue';
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
const sessionPlayers = ref(0);
const matchWaiting = ref(false);
const sessionDissolved = ref(false);

const matchWaitingText = computed(() => {
  return sessionPlayers.value > 0
    ? `当前 ${sessionPlayers.value} 人排队，满 4 人自动组建房间`
    : '正在加入匹配队列…';
});

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

// ── 牌局状态 ──
const pub = ref<MjPublic | null>(null);
const hand = ref<number[]>([]);
const drawn = ref(-1);
const myPlayerId = ref('');
const spectate = ref(false);
const handOver = ref<MjHandOver | null>(null);
const settled = ref<MjSettled | null>(null);
const selected = ref<number | null>(null);
const dealKey = ref(0);
const dealAnim = ref(false);
const shaking = ref(false);
const winFx = ref(false);
const feed = ref<Array<{ t: number; text: string }>>([]);

const mySeat = computed(() => {
  if (spectate.value) return -1;
  return pub.value?.seats.find((s) => s.id === myPlayerId.value)?.seat ?? -1;
});
const leftSeat = computed<SeatView | null>(() => seatAt(+3));
const rightSeat = computed<SeatView | null>(() => seatAt(+1));
const topSeat = computed<SeatView | null>(() => seatAt(+2));
function seatAt(offset: number): SeatView | null {
  const p = pub.value;
  if (!p) return null;
  if (mySeat.value < 0) return p.seats[(p.dealer + offset) % 4];
  return p.seats[(mySeat.value + offset) % 4];
}

const dissolving = computed(() => pub.value?.phase === 'dissolving');
const matchedCount = computed(() => (pub.value ? pub.value.seats.filter((s) => !s.bot).length : 0));
const iAmDealer = computed(() => mySeat.value >= 0 && pub.value?.dealer === mySeat.value);
const myMelds = computed(() => pub.value?.seats[mySeat.value]?.melds ?? []);
const fanCapLabel = computed(() => (pub.value ? `${pub.value.fanCap} 番封顶` : '鸡平胡'));

function isSeatTurn(seat: number): boolean {
  const p = pub.value;
  if (!p) return false;
  return p.phase === 'playing' && p.turn === seat && p.action === 'discard';
}

const myTurn = computed(() => isSeatTurn(mySeat.value));
// 打牌轮 = 轮到我行动（摸牌后的打牌与碰/吃后的打牌都算；后者 drawn=-1）
const myDiscard = computed(() => myTurn.value);
const selfWin = computed(() => myDiscard.value && drawn.value >= 0 && hand.value.length > 0 && canSelfWin(hand.value));

// ── 中央牌池：方位弃牌河 ──
const poolRivers = computed(() => ({
  bottom: seatAt(0)?.river ?? [],
  right: seatAt(1)?.river ?? [],
  top: seatAt(2)?.river ?? [],
  left: seatAt(3)?.river ?? [],
}));
type PoolDir = 'top' | 'left' | 'right' | 'bottom';
function dirOfSeat(seat: number): PoolDir | '' {
  if (!pub.value || seat < 0) return '';
  if (seatAt(0)?.seat === seat) return 'bottom';
  if (seatAt(1)?.seat === seat) return 'right';
  if (seatAt(2)?.seat === seat) return 'top';
  if (seatAt(3)?.seat === seat) return 'left';
  return '';
}

// 最近打出的牌（中央河内高亮；被吃/碰/杠或新开局后清除）
const lastDiscard = ref<{ seat: number; tile: number } | null>(null);
const lastDiscardDir = computed<PoolDir | ''>(() => (lastDiscard.value ? dirOfSeat(lastDiscard.value.seat) : ''));

// ── 吃/碰/杠 印章动效 ──
type StampFx = { text: string; kind: 'chi' | 'pong' | 'kong'; dir: PoolDir };
const stampFx = ref<StampFx | null>(null);
let stampTimer: number | undefined;
function triggerStamp(kind: StampFx['kind'], text: string, seat: number) {
  const dir = dirOfSeat(seat);
  if (!dir) return;
  if (stampTimer) clearTimeout(stampTimer);
  stampFx.value = { text, kind, dir };
  stampTimer = window.setTimeout(() => { stampFx.value = null; }, 1200);
}
const STAMP_POS: Record<PoolDir, string> = {
  top: 'top-[15%] left-1/2 -translate-x-1/2',
  bottom: 'bottom-[31%] left-1/2 -translate-x-1/2',
  left: 'left-[15%] top-[44%]',
  right: 'right-[15%] top-[44%]',
};
const STAMP_STYLE: Record<StampFx['kind'], string> = {
  chi: 'border-sky-300 bg-sky-600/90 text-white',
  pong: 'border-emerald-300 bg-emerald-600/90 text-white',
  kong: 'border-amber-300 bg-amber-500/95 text-slate-900',
};
const stampPosClass = computed(() => (stampFx.value ? STAMP_POS[stampFx.value.dir] : ''));
const stampStyleClass = computed(() => (stampFx.value ? STAMP_STYLE[stampFx.value.kind] : ''));

// ── 选择窗 ──
const claiming = computed(() => {
  const p = pub.value;
  if (!p || p.action !== 'claim' || !p.claim) return false;
  return !!claimCan.value;
});
const claimTile = computed(() => pub.value?.claim?.tile ?? -1);
const claimRob = computed(() => !!pub.value?.claim?.rob);
const claimCan = computed(() => {
  const p = pub.value;
  const c = p?.claim;
  if (!p || !c || mySeat.value < 0 || mySeat.value === c.from) return false;
  if (c.rob) return canWinOn(hand.value, c.tile);
  return canWinOn(hand.value, c.tile) || canPong(hand.value, c.tile) || canKongOn(hand.value, c.tile) || claimChiOptions.value.length > 0;
});
const claimCanWin = computed(() => {
  const c = pub.value?.claim;
  return !!c && mySeat.value !== c.from && canWinOn(hand.value, c.tile);
});
const claimCanKong = computed(() => {
  const c = pub.value?.claim;
  return !!c && !c.rob && mySeat.value !== c.from && canKongOn(hand.value, c.tile);
});
const claimCanPong = computed(() => {
  const c = pub.value?.claim;
  return !!c && !c.rob && mySeat.value !== c.from && canPong(hand.value, c.tile) && !canKongOn(hand.value, c.tile);
});
const claimChiOptions = computed(() => {
  const p = pub.value;
  const c = p?.claim;
  if (!p || !c || c.rob || mySeat.value < 0) return [];
  if (mySeat.value !== (c.from + 1) % 4) return [];
  return chiCombinations(hand.value, c.tile);
});
const anKongOptions = computed(() => (myDiscard.value && drawn.value >= 0 ? anKongTiles(hand.value) : []));
const buKongOptions = computed(() => (myDiscard.value && drawn.value >= 0 ? buKongTiles(hand.value, myMelds.value) : []));

const waitingText = computed(() => {
  const p = pub.value;
  if (!p) return '';
  if (p.action === 'claim') return '等待各家选择…';
  const name = seatName(p.turn);
  return `等待 ${name} 打牌…`;
});

function seatName(seat: number): string {
  const p = pub.value;
  const s = p?.seats[seat];
  if (!s) return '—';
  if (s.bot) return 'AI';
  if (s.id === myPlayerId.value) return '你';
  return displayName(s);
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 4) + '…' + id.slice(-4) : id;
}
function displayName(s: { name?: string; id: string }): string {
  return s.name || shortId(s.id);
}
const myName = computed(() => {
  const me = pub.value?.seats.find((s) => s.id === myPlayerId.value);
  return (me && me.name) || (myPlayerId.value ? shortId(myPlayerId.value) : '我');
});
function tileName(id: number): string {
  return kindLabel(id >> 2);
}

// ── 中央提示 ──
const centerTitle = computed(() => {
  const p = pub.value;
  if (!p) return '';
  if (p.phase === 'matching') return '自动匹配中';
  if (p.phase === 'lobby') {
    const readyCount = p.seats.filter((s) => s.ready).length;
    return readyCount > 0 ? '等待开局…' : '等待玩家就绪';
  }
  if (p.phase === 'playing') {
    if (claiming.value) return pub.value?.claim?.rob ? '可抢杠胡' : '请选择 吃碰杠胡';
    if (myDiscard.value) return '轮到你打牌';
    return '';
  }
  return '';
});
const centerSub = computed(() => {
  const p = pub.value;
  if (!p) return '';
  if (p.phase === 'matching') return `已就座 ${matchedCount.value}/4 · 满员自动开局，空位 20s 后由 AI 补位`;
  if (p.phase === 'playing' && p.action === 'discard' && !myDiscard.value) {
    return `${seatName(p.turn)} 思考中`;
  }
  return '';
});

// ── 手牌交互 ──
const handTiles = computed(() => sortTiles(hand.value));
function isSelected(c: number): boolean {
  return selected.value === c;
}
function toggleTile(c: number) {
  if (spectate.value || actionPending.value) return;
  selected.value = selected.value === c ? null : c;
}
/** 双击手牌直接打出 */
function quickDiscard(c: number) {
  if (spectate.value || actionPending.value || !myDiscard.value) return;
  selected.value = c;
  discardTile(c);
}
function discardTile(tile: number | null) {
  if (tile === null) return;
  submitAction('discard', { tile });
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

function doChi(payload: { tiles: number[] }) {
  submitAction('chi', payload);
}
function doPong() {
  submitAction('pong', {});
}
function doKong(payload: { kind: 'ming' | 'an' | 'bu'; tile?: number }) {
  submitAction('kong', payload);
}
function doWin() {
  submitAction('win', {});
}
function doPass() {
  submitAction('pass', {});
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
const claimRemaining = ref(0);
const myRemainingPct = computed(() => Math.min(100, (myRemaining.value / 30) * 100));
const myRingStyle = computed(() => {
  const frac = Math.min(1, Math.max(0.02, myRemaining.value / 30));
  const color = myRemaining.value <= 5 ? '#f87171' : '#fbbf24';
  return {
    background: `conic-gradient(${color} ${Math.max(2, frac * 360)}deg, rgba(255,255,255,0.06) 0deg)`,
    mask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
    WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
  };
});

// ── 漂移看门狗 ──
let lastEventAt = Date.now();
let driftSyncTurnKey = '';
function touchEvent() { lastEventAt = Date.now(); }
function reconcile(reason: string) {
  touchEvent();
  if (client?.isConnected()) {
    console.warn('[Mahjong] drift detected, reconciling:', reason);
    client.sync();
  }
}

let tickTimer: number | undefined;
function tick() {
  const p = pub.value;
  if (!p || p.phase !== 'playing') {
    myRemaining.value = 0;
    claimRemaining.value = 0;
  } else {
    const calc = () => Math.max(0, Math.ceil(((p.turnEndsAt ?? 0) - Date.now()) / 1000));
    claimRemaining.value = p.action === 'claim' ? calc() : 0;
    myRemaining.value = myDiscard.value ? calc() : 0;
    if (myDiscard.value && p.turnEndsAt && Date.now() > p.turnEndsAt + 3000) {
      const turnKey = `${p.handNo}:${p.phase}:${p.turn}:${p.action}`;
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
  return seatName(seat);
}

function onBroadcast(action: string, data: any) {
  touchEvent();
  matchWaiting.value = false; // 引擎已在发广播 → 匹配等待结束
  if (data?.public) pub.value = data.public as MjPublic;
  switch (action) {
    case 'mj:init':
      sessionDissolved.value = false; // 新房间开启（解散后重新匹配成功）
      break;
    case 'mj:player_joined':
      note(`${data.public?.seats?.[data.seat]?.name || '新玩家'} 匹配入座`);
      break;
    case 'mj:match_filled':
      note(
        data.reason === 'full'
          ? '匹配成功，自动开局'
          : data.reason === 'skip'
            ? '跳过等待，AI 补位开局'
            : '匹配超时，AI 补位开局',
      );
      break;
    case 'mj:player_return': {
      const s = data.public?.seats?.[data.seat];
      if (data.seat === mySeat.value) client?.sync(); // 归队即对账（离席期间 AI 代打可能落后）
      note(`${s?.name || '玩家'} 归队，恢复操控`);
      break;
    }
    case 'mj:deal':
      selected.value = null;
      hand.value = [];
      drawn.value = -1;
      lastDiscard.value = null;
      clearActionPending();
      handOver.value = null;
      settled.value = null;
      dealKey.value++;
      dealAnim.value = true;
      note(`—— 第 ${data.public.handNo} 局开始，庄家：${nameOf(data.public.dealer)} ——`);
      break;
    case 'mj:ready':
      note(`${nameOf(data.seat)} 准备就绪`);
      if (data.seat === mySeat.value) {
        clearActionPending();
        handOver.value = null;
        settled.value = null;
      }
      break;
    case 'mj:draw':
      // 摸牌不进动态（每回合都有，噪音）；自己摸牌时手牌区有高亮标记
      break;
    case 'mj:discard':
      lastDiscard.value = { seat: data.seat, tile: data.tile };
      if (data.seat === mySeat.value) {
        clearActionPending();
        selected.value = null;
        if (hand.value.includes(data.tile)) {
          hand.value = hand.value.filter((c) => c !== data.tile);
        }
        drawn.value = -1;
      } else {
        // 他家打出后，我的刚摸标记作废（轮转推进）
        drawn.value = -1;
      }
      break;
    case 'mj:chi':
      note(`${nameOf(data.seat)} 吃 ${data.tiles.map((t: number) => kindLabel(t >> 2)).join('')}`);
      lastDiscard.value = null;
      triggerStamp('chi', '吃', data.seat);
      if (data.seat === mySeat.value) clearActionPending();
      break;
    case 'mj:pong':
      note(`${nameOf(data.seat)} 碰 ${kindLabel(data.tile >> 2)}`);
      lastDiscard.value = null;
      triggerStamp('pong', '碰', data.seat);
      if (data.seat === mySeat.value) clearActionPending();
      break;
    case 'mj:kong': {
      const label = { ming: '明杠', an: '暗杠', bu: '补杠' }[data.kind as 'ming' | 'an' | 'bu'] || '杠';
      if (data.robbing) {
        note(`${nameOf(data.seat)} 补杠 ${kindLabel(data.tile >> 2)}，可抢杠`);
      } else {
        note(`${nameOf(data.seat)} ${label} ${kindLabel(data.tile >> 2)}`);
        lastDiscard.value = null;
        triggerStamp('kong', '杠', data.seat);
        triggerShake();
      }
      if (data.seat === mySeat.value) clearActionPending();
      break;
    }
    case 'mj:hand_over':
      clearActionPending();
      lastDiscard.value = null;
      handOver.value = data as MjHandOver;
      if (data.draw) {
        note(`—— 第 ${data.public.handNo} 局流局，庄家 ${nameOf(data.dealer)} 连庄 ——`);
      } else {
        note(`—— 第 ${data.public.handNo} 局结束：${nameOf(data.winner)} 胡 ${data.fan} 番 ——`);
        triggerWinFx();
      }
      break;
    case 'mj:settled':
      clearActionPending();
      settled.value = data as MjSettled;
      pub.value = data.public;
      break;
    case 'mj:bot_takeover': {
      const s = data.public?.seats?.[data.seat];
      if (s) note(`${s.name || nameOf(data.seat)} 离席，AI 托管`);
      break;
    }
    case 'mj:session_end':
      clearActionPending();
      note(data.reason === 'all_gone' ? '全员离席，房间解散' : '有玩家离席，本局结束后房间解散');
      break;
  }
}

function triggerShake() {
  shaking.value = true;
  setTimeout(() => { shaking.value = false; }, 500);
}
function triggerWinFx() {
  winFx.value = true;
  setTimeout(() => { winFx.value = false; }, 1600);
}

// ── SDK 接入 ──
let client: ReturnType<typeof createMahjongClient> | null = null;

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

  client = createMahjongClient(config, {
    onSync(data: MjSync) {
      touchEvent();
      clearActionPending();
      matchWaiting.value = false;
      pub.value = data;
      if (data.playerId) myPlayerId.value = data.playerId;
      handOver.value = data.handOver ?? null;
      settled.value = data.settled ?? null;
      if (Array.isArray(data.hand)) {
        hand.value = sortTiles(data.hand);
        dealAnim.value = false;
      }
      drawn.value = data.drawn ?? -1;
      if (typeof data.balance === 'number') applyBalance(data.balance, data.version ?? 0);
      connected.value = true;
      reconnecting.value = false;
      connectionLost.value = false;
    },
    onHand(data: MjSync) {
      touchEvent();
      // 载荷与 mj:sync 同构（public 平铺）；兼容嵌套格式兜底
      const payload = data as any;
      const flat: MjSync = payload.public
        ? { ...payload.public, hand: payload.hand, drawn: payload.drawn }
        : data;
      pub.value = flat;
      if (Array.isArray(flat.hand)) hand.value = sortTiles(flat.hand);
      drawn.value = flat.drawn ?? -1;
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
  if (e.key === 'Enter' && myDiscard.value && selected.value !== null) { discardTile(selected.value); e.preventDefault(); }
  else if ((e.key === 'p' || e.key === 'P') && claiming.value) doPass();
  else if ((e.key === 'w' || e.key === 'W') && (claimCanWin.value || selfWin.value)) doWin();
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
  if (stampTimer) clearTimeout(stampTimer);
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
  box-shadow: 0 -18px 40px -22px rgba(0, 0, 0, 0.9);
}
</style>
