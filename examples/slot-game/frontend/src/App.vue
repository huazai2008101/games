<template>
  <div class="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
    <!-- 游戏自带返回入口:通知宿主大厅导航返回(宿主协议 onlinegame:game:exit) -->
    <div class="w-full max-w-lg mb-2 flex justify-start">
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
    </div>
    <!-- Header -->
    <div class="w-full max-w-lg mb-6 text-center">
      <h1 class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-pink-400 to-purple-500">
        🎰 Lucky Slots
      </h1>
      <p class="text-gray-500 text-sm mt-1">连接状态：
        <span :class="connected ? 'text-green-400' : 'text-red-400'">
          {{ connected ? '已连接' : '未连接' }}
        </span>
      </p>
      <p v-if="configError" class="mt-2 text-sm text-red-300">
        {{ configError }}
      </p>
      <!-- Reconnecting banner: transient drop, auto-recovery in progress -->
      <div
        v-if="reconnecting"
        class="mt-2 text-sm bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-lg px-3 py-2"
      >
        ⚠️ 网络连接已断开，正在自动重连...
      </div>
      <!-- Terminal disconnect: reconnect attempts exhausted -->
      <div
        v-if="connectionLost"
        class="mt-2 text-sm bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg px-3 py-2"
      >
        ❌ 连接已断开，请刷新页面重新进入游戏
      </div>
      <!-- Session terminal state (platform session:finished / session:timeout) -->
      <div
        v-if="sessionOver"
        class="mt-2 text-sm bg-gray-500/10 text-gray-400 border border-gray-500/30 rounded-lg px-3 py-2"
      >
        🏁 本局会话已结束
      </div>
      <!-- Persistent error bar (balance errors, settlement failures, ...) -->
      <div
        v-if="errorBar"
        class="mt-2 text-sm bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg px-3 py-2"
      >
        ⚠️ {{ errorBar }}
      </div>
    </div>

    <!-- Machine Frame -->
    <div class="w-full max-w-lg bg-gradient-to-b from-gray-800 to-gray-900 border-2 border-gray-700 rounded-3xl p-6 shadow-2xl shadow-purple-900/20">
      <!-- Reels -->
      <div class="bg-gray-950 border-2 border-gray-600 rounded-2xl p-3 mb-4">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="(col, ci) in displayReels" :key="ci" class="flex flex-col gap-2">
            <div
              v-for="(symbol, ri) in col"
              :key="ri"
              :class="[
                'aspect-square flex items-center justify-center text-5xl rounded-xl transition-all duration-200',
                spinning ? 'bg-gray-800/50 animate-pulse' : 'bg-gray-800',
                isWinningCell(ri, ci) ? 'ring-2 ring-yellow-400 bg-yellow-400/10 scale-105' : '',
              ]"
            >
              {{ symbol }}
            </div>
          </div>
        </div>
      </div>

      <!-- Paylines & Payouts Info -->
      <div v-if="slotInit" class="flex flex-wrap gap-1 justify-center mb-4">
        <span
          v-for="(sym, i) in slotInit.symbols.slice(0, 4)"
          :key="i"
          class="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded"
        >
          {{ sym }} ×{{ slotInit.payouts[sym] }}
        </span>
        <span class="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
          7️⃣ ×{{ slotInit.payouts['7️⃣'] }}
        </span>
      </div>

      <!-- Balance & Win -->
      <div class="flex items-center justify-between mb-4 px-2">
        <div v-if="balance !== null" class="text-left">
          <div class="text-xs text-gray-500">余额</div>
          <div class="text-2xl font-bold text-white">{{ balance.toLocaleString('zh-CN') }}</div>
        </div>
        <div v-if="lastWin > 0" class="text-right animate-bounce">
          <div class="text-xs text-yellow-400">WIN!</div>
          <div class="text-2xl font-bold text-yellow-400">+{{ lastWin }}</div>
        </div>
      </div>

      <!-- Bet Selector -->
      <div class="flex items-center justify-center gap-2 mb-4">
        <button
          v-for="b in bets"
          :key="b"
          @click="bet = b"
          :class="[
            'px-4 py-2 rounded-lg text-sm font-semibold transition',
            bet === b
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
              : 'bg-gray-800 text-gray-400 hover:text-white',
          ]"
        >
          {{ b }}
        </button>
      </div>

      <!-- Spin Button -->
      <button
        @click="spin"
        :disabled="spinning || !connected || !myPlayerId || sessionOver"
        :class="[
          'w-full py-4 rounded-xl text-lg font-extrabold transition-all duration-200',
          spinning || !connected || !myPlayerId || sessionOver
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white hover:from-yellow-400 hover:to-orange-400 shadow-lg shadow-orange-500/25 active:scale-95',
        ]"
      >
        {{ sessionOver ? '🏁 会话已结束' : spinning ? '🎰 转动中...' : '🎰 SPIN' }}
      </button>
    </div>

    <!-- Room feed: every round arrives as one broadcast (slot:result) -->
    <div v-if="feed.length" class="w-full max-w-lg mt-4 bg-gray-900/60 border border-gray-800 rounded-2xl px-4 py-3">
      <div class="text-xs text-gray-500 mb-1">房间动态</div>
      <div
        v-for="(item, i) in feed"
        :key="item.roundId"
        :class="['text-xs flex justify-between gap-2', i === 0 ? 'text-gray-300' : 'text-gray-500']"
      >
        <span class="truncate">{{ item.playerId }} · 押 {{ item.bet }}</span>
        <span :class="item.win > 0 ? 'text-yellow-400 font-semibold' : ''">
          {{ item.win > 0 ? `+${item.win}` : '未中' }}
        </span>
      </div>
    </div>

    <!-- Win Notification -->
    <div
      v-if="showWinPopup"
      class="fixed top-1/4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-8 py-4 rounded-2xl text-2xl font-extrabold shadow-2xl z-50 animate-bounce"
    >
      🎉 +{{ lastWin }}!
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { requestHostGameConfig, notifyGameExit, type HostGameConfig } from '@game-platform/frontend-sdk';
import { createSlotClient, type SlotInit, type SlotResult } from './game';

const connected = ref(false);
const reconnecting = ref(false);
const connectionLost = ref(false);
const configError = ref('');
const errorBar = ref('');
// null = 尚未收到平台余额（slot:init 快照或 wallet:balance 推送），此时不展示。
const balance = ref<number | null>(null);
const myPlayerId = ref('');
const sessionOver = ref(false);
// Monotonic watermark of the last applied versioned balance — every balance
// source (slot:init snapshot, wallet:balance push) shares the
// (balance, version) contract. Older out-of-order pushes are dropped.
const lastBalanceVersion = ref(0);
const bet = ref(10);
const bets = [10, 20, 50, 100];
const spinning = ref(false);
// spin 结果丢失兜底定时器(见 spin() 内注释)
const spinWatchdog = ref<number | undefined>(undefined);
const lastWin = ref(0);
const showWinPopup = ref(false);
const winningLines = ref<number[]>([]);
// 房间开奖动态（slot:result 广播，含本人）：最新在前，最多保留 5 条。
const feed = ref<SlotResult[]>([]);

const slotInit = ref<SlotInit | null>(null);

// Display grid: 3 columns × 3 rows (transposed from backend's row-major)
const grid = ref<string[][]>([
  ['🍒', '🍋', '🍊'],
  ['🍇', '💎', '7️⃣'],
  ['🍒', '🍊', '🍋'],
]);

// Display as column-major for easier Vue rendering (each column is a reel)
const displayReels = computed(() => {
  const cols: string[][] = [[], [], []];
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      cols[c].push(grid.value[r][c]);
    }
  }
  return cols;
});

function isWinningCell(row: number, col: number): boolean {
  if (winningLines.value.length === 0) return false;
  const paylines = slotInit.value?.paylines || [];
  for (const li of winningLines.value) {
    const line = paylines[li];
    if (!line) continue;
    for (const [r, c] of line) {
      if (r === row && c === col) return true;
    }
  }
  return false;
}

function exitToLobby() {
  if (!notifyGameExit() && window.history.length > 1) window.history.back();
}

function spin() {
  if (spinning.value || !connected.value || !myPlayerId.value || sessionOver.value) return;
  spinning.value = true;
  winningLines.value = [];
  lastWin.value = 0;
  errorBar.value = '';

  // Quick shuffle animation
  let tick = 0;
  const interval = setInterval(() => {
    const g: string[][] = [];
    for (let r = 0; r < 3; r++) {
      const row: string[] = [];
      for (let c = 0; c < 3; c++) {
        const symbols = slotInit.value?.symbols || ['🍒','🍋','🍊','🍇','💎','7️⃣'];
        row.push(symbols[Math.floor(Math.random() * symbols.length)]);
      }
      g.push(row);
    }
    grid.value = g;
    tick++;
    if (tick > 10) {
      clearInterval(interval);
      // Send spin action to backend
      client.value?.sendAction('spin', { bet: bet.value });
      // 兜底:本人的 slot:result 若丢失(消息乱序/连接抖动),spinning 会永久
      // 卡住按钮。8s 无回包视为本轮无结果:解锁按钮并拉全量快照对账。
      spinWatchdog.value = window.setTimeout(() => {
        if (!spinning.value) return;
        spinning.value = false;
        errorBar.value = '本轮结果未收到,已为您同步最新状态;余额以服务端为准';
        client.value?.sync();
      }, 8000);
    }
  }, 80);
}

// 统一的余额应用入口：所有携带 (balance, version) 的推送都走这里，
// 版本号不大于水位线的乱序旧推送被丢弃（version=0 表示未知，直接应用）。
function applyBalance(bal: number, version: number) {
  if (version > 0 && version <= lastBalanceVersion.value) return;
  if (version > 0) lastBalanceVersion.value = version;
  balance.value = bal;
}

// Wallet/platform errors arrive as English internals; map the known ones to
// player-facing Chinese before showing the error bar.
function translateError(msg: string): string {
  const lower = String(msg).toLowerCase();
  if (lower.includes('insufficient balance')) return '余额不足，请充值或降低下注金额';
  if (lower.includes('round')) return '回合处理失败，请重试';
  // 房间模式：人数不足时先到的玩家 ready 会被引擎拒绝，属预期流程。
  if (lower.includes('players to ready')) return '等待其他玩家加入，人数足够后即可开始';
  return msg;
}

let client = ref<any>(null);

async function resolveGameConfig(): Promise<HostGameConfig> {
  return requestHostGameConfig();
}

onMounted(async () => {
  let config: HostGameConfig;
  try {
    config = await resolveGameConfig();
  } catch (error) {
    configError.value = error instanceof Error
      ? error.message
      : '无法获取游戏宿主配置';
    return;
  }

  const gc = createSlotClient(config, {
    onInit(data: SlotInit) {
      slotInit.value = data;
      connected.value = true;
      reconnecting.value = false;
      connectionLost.value = false;
      // 定向应答（state:sync）携带本人身份与余额；入场广播只带公共规则。
      if (data.playerId) myPlayerId.value = data.playerId;
      if (typeof data.balance === 'number') {
        applyBalance(data.balance, data.version ?? 0);
      }
      console.log('[UI] Slot initialized', data);
    },
    onResult(data: SlotResult) {
      // 唯一开奖广播：所有结果进房间动态；本人的那份额外驱动转轮 UI。
      feed.value = [data, ...feed.value].slice(0, 5);
      if (data.playerId !== myPlayerId.value) return;

      if (spinWatchdog.value) { clearTimeout(spinWatchdog.value); spinWatchdog.value = undefined; }
      spinning.value = false;
      grid.value = data.reels;
      lastWin.value = data.win;
      winningLines.value = data.winningLines;
      errorBar.value = ''; // a successful spin clears stale errors
      // 余额不随开奖到达：由平台 wallet:balance 版本化推送更新。
      if (data.win > 0) {
        showWinPopup.value = true;
        setTimeout(() => { showWinPopup.value = false; }, 2000);
      }
    },
    onError(msg: string) {
      spinning.value = false;
      if (spinWatchdog.value) { clearTimeout(spinWatchdog.value); spinWatchdog.value = undefined; }
      // Persistent in-UI error bar: alert() is silently blocked inside the
      // sandboxed game iframe (no allow-modals), so errors were invisible.
      errorBar.value = translateError(msg);
    },
    onBalance(bal: number, version: number) {
      applyBalance(bal, version);
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
      errorBar.value = ''; // recovered — clear stale connection errors
      // Events missed while offline are unknowable — accept the next push
      // (state:sync 已随重连发出，会用带版本号的快照重建水位线).
      lastBalanceVersion.value = 0;
    },
    onReconnectFailed() {
      reconnecting.value = false;
      connectionLost.value = true;
      spinning.value = false;
      if (spinWatchdog.value) { clearTimeout(spinWatchdog.value); spinWatchdog.value = undefined; }
    },
    onFinished() {
      // Platform terminal state (session:finished / session:timeout).
      spinning.value = false;
      if (spinWatchdog.value) { clearTimeout(spinWatchdog.value); spinWatchdog.value = undefined; }
      sessionOver.value = true;
    },
  });

  gc.connect();
  client.value = gc;
});

// Event-driven backstop: when the tab regains focus, pull a full snapshot from
// the engine. Covers "tab left open overnight + a pub/sub event was missed"
// with zero steady-state cost — no polling.
const handleVisibility = () => {
  if (document.visibilityState === 'visible' && client.value?.isConnected()) {
    client.value?.sync();
  }
};

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibility);
});

onUnmounted(() => {
  if (spinWatchdog.value) { clearTimeout(spinWatchdog.value); spinWatchdog.value = undefined; }
  document.removeEventListener('visibilitychange', handleVisibility);
  client.value?.disconnect();
});
</script>
