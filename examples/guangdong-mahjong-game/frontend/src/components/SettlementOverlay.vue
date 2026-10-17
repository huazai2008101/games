<!-- 结算浮层：胡牌（番型明细 + 各家增减 + 四家亮牌）或流局 + 自动续局倒计时 -->
<template>
  <Transition name="overlay">
    <div
      v-if="visible"
      class="fixed inset-0 z-40 flex overflow-hidden bg-slate-950/75 backdrop-blur-sm p-4"
    >
      <div class="m-auto w-full max-w-xl max-h-full rounded-3xl border shadow-2xl overflow-hidden flex flex-col" :class="winBorder">
        <!-- 头部：胜负 -->
        <div :class="['px-6 pt-6 pb-5 text-center', headBg]">
          <template v-if="!isDraw">
            <div
              class="mx-auto mb-3 w-16 h-16 rounded-full border-2 flex items-center justify-center -rotate-6 select-none"
              :class="win ? 'border-amber-300/80 bg-amber-400/15 text-amber-300 shadow-[0_0_24px_rgba(251,191,36,0.35)]' : 'border-slate-500/70 bg-slate-700/30 text-slate-400'"
            >
              <span class="text-3xl font-black">{{ win ? '胜' : '负' }}</span>
            </div>
            <div class="text-3xl font-black text-white drop-shadow">
              {{ winText }}
            </div>
            <div class="mt-1 text-sm text-white/80">
              第 {{ handNo }} 局 · {{ winnerName }} {{ selfDraw ? '自摸' : (rob ? '抢杠胡' : '胡牌') }}
              <template v-if="!selfDraw && !rob">（{{ loserName }} 点炮）</template>
              <template v-else-if="rob">（{{ loserName }} 补杠被抢）</template>
            </div>
          </template>
          <template v-else>
            <div class="mx-auto mb-3 w-16 h-16 rounded-full border-2 flex items-center justify-center -rotate-6 select-none border-sky-300/70 bg-sky-400/10 text-sky-200">
              <span class="text-3xl font-black">和</span>
            </div>
            <div class="text-3xl font-black text-white drop-shadow">流局</div>
            <div class="mt-1 text-sm text-white/80">第 {{ handNo }} 局 · 牌墙摸完，无人胡牌（庄家连庄）</div>
          </template>
        </div>

        <!-- 番型明细 / 结算金额 -->
        <div class="bg-slate-900 px-6 py-4 border-b border-slate-800">
          <template v-if="!isDraw">
            <div class="flex items-center justify-center gap-2 flex-wrap text-sm">
              <span v-for="d in fanDetail" :key="d" class="chip">{{ d }}</span>
              <span class="text-amber-300 font-black text-lg">共 {{ fan }} 番</span>
            </div>
            <div class="text-center text-xs text-slate-500 mt-1.5">
              底分 {{ base }} × {{ fan }} 番 = {{ stake }} 金币（{{ selfDraw ? '三家各付' : rob ? '补杠者独付' : '点炮者独付' }}）
            </div>
          </template>
          <div v-else class="text-center text-sm text-slate-400">流局不计分，庄家连庄继续下一局</div>
        </div>

        <!-- 各家增减（AI 不进钱包，显示 —） -->
        <div class="bg-slate-900 px-6 py-4 space-y-1.5 shrink-0">
          <div
            v-for="p in playerResults"
            :key="p.id"
            class="flex items-center gap-3 rounded-xl bg-slate-800/60 px-3 py-1.5"
          >
            <span
              class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              :style="p.bot ? {} : avatarStyle(p.id)"
            >
              <GameIcon v-if="p.bot" name="bot" class="w-5 h-5 text-slate-400" />
              <span v-else class="text-sm font-bold">{{ monogram(p.name) }}</span>
            </span>
            <span class="flex-1 text-sm text-slate-200 truncate inline-flex items-center gap-1.5">
              {{ p.name }}
              <span v-if="p.dealer" class="text-[10px] leading-none text-amber-300 border border-amber-400/50 rounded px-1 py-0.5">庄</span>
            </span>
            <span
              v-if="p.bot && p.delta === 0"
              class="font-mono font-bold text-slate-600" title="AI 不参与钱包结算"
            >—</span>
            <span
              v-else
              :class="['font-mono font-bold', p.delta > 0 ? 'text-emerald-400' : p.delta < 0 ? 'text-red-400' : 'text-slate-500']"
            >
              {{ p.delta > 0 ? '+' + p.delta : p.delta }}
            </span>
          </div>
          <div v-if="hasBots" class="text-[11px] text-slate-500 text-center pt-0.5">AI 牌桌输赢不计入钱包</div>
          <div v-if="!committed" class="text-xs text-red-400 text-center pt-1 inline-flex items-center gap-1 justify-center w-full">
            <GameIcon name="alert" class="w-3.5 h-3.5 shrink-0" />
            钱包结算未提交（余额不足或平台拒绝），本局金额记 0
          </div>
        </div>

        <!-- 亮牌（内部滚动，保证头部与按钮常驻可见） -->
        <div class="bg-slate-900/80 px-6 py-3 border-t border-slate-800 flex-1 min-h-0 overflow-y-auto reveal-scroll">
          <div class="text-xs text-slate-500 mb-1.5">四家亮牌（发牌种子已揭示，可验证）</div>
          <div class="space-y-2">
            <div v-for="h in revealed" :key="h.seat" class="flex items-start gap-2">
              <span class="w-14 shrink-0 text-xs text-slate-400 pt-1.5 text-right leading-tight">
                {{ h.label }}<span v-if="h.isWinner" class="text-amber-300 ml-0.5">胡</span>
              </span>
              <div class="flex-1 min-h-7">
                <div class="flex flex-wrap gap-1 items-center">
                  <template v-if="h.hand.length > 0">
                    <MahjongTile v-for="c in h.hand" :key="c" :tile="c" size="xs" class="reveal-anim" />
                  </template>
                  <span v-else class="text-xs text-slate-600">—</span>
                  <!-- 副露与暗牌同行排布，压缩高度 -->
                  <div
                    v-for="(m, i) in h.melds"
                    :key="'m' + i"
                    class="ml-1"
                  >
                    <div class="flex rounded overflow-hidden border border-amber-900/30 p-0.5 gap-[1px] bg-slate-900/70">
                      <MahjongTile v-for="t in meldFaceTiles(m)" :key="t === null ? 'b' + i : t" :tile="t" size="xs" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 继续 / 解散倒计时 -->
        <div class="bg-slate-900 px-6 py-4 text-center border-t border-slate-800 shrink-0">
          <template v-if="dissolving">
            <div class="text-sm text-amber-300 font-semibold inline-flex items-center gap-1.5 justify-center w-full">
              <GameIcon name="alert" class="w-4 h-4 shrink-0" />
              有玩家离席，房间即将解散
            </div>
            <div class="mt-1 text-xs text-slate-400">
              离席玩家 {{ dissolveSeconds }}s 内归队可继续对局，逾期房间解散
            </div>
            <div class="mt-3 h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-amber-400 to-red-500 transition-all duration-1000"
                :style="{ width: dissolvePct + '%' }"
              ></div>
            </div>
          </template>
          <template v-else>
            <button
              class="w-full py-3 rounded-xl font-extrabold bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-900 shadow-lg shadow-orange-500/25 active:scale-95 transition inline-flex items-center justify-center gap-2"
              @click="$emit('ready')"
            >
              <GameIcon name="refresh" class="w-4 h-4" />
              再来一局 · {{ autoSeconds }}s 后自动开始
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Meld } from '../types';
import type { MjHandOver, MjPublic, MjSettled } from '../types';
import { monogram, avatarStyle } from '../avatar';
import GameIcon from './GameIcon.vue';
import MahjongTile from './MahjongTile.vue';

const props = withDefaults(defineProps<{
  handOver: MjHandOver | null;
  settled: MjSettled | null;
  playerId: string;
  mySeat: number;
  /** 解散宽限：有玩家离席未归队，倒计时结束房间解散 */
  dissolving?: boolean;
  /** 实时公共快照（倒计时以实时 nextAt/dissolveAt 为准，非 handOver 冻结快照） */
  pub?: MjPublic | null;
}>(), {
  dissolving: false,
  pub: null,
});

defineEmits<{ ready: [] }>();

const visible = computed(() => props.handOver !== null);
const isDraw = computed(() => !!props.handOver?.draw);

const win = computed(() => props.handOver?.winner === props.mySeat);
const headBg = computed(() => {
  if (isDraw.value) return 'bg-gradient-to-b from-sky-500/30 to-transparent';
  return win.value
    ? 'bg-gradient-to-b from-emerald-500/40 to-transparent'
    : 'bg-gradient-to-b from-red-500/30 to-transparent';
});
const winBorder = computed(() => {
  if (isDraw.value) return 'border-sky-500/50';
  return win.value ? 'border-emerald-500/50' : 'border-red-500/50';
});

const handNo = computed(() => props.pub?.handNo ?? 0);

const winnerName = computed(() => seatName(props.handOver?.winner ?? -1));
const loserName = computed(() => seatName(props.handOver?.loser ?? -1));
const selfDraw = computed(() => !!props.handOver?.selfDraw);
const rob = computed(() => !!props.handOver?.rob);
const winText = computed(() => {
  if (win.value) return '胜利';
  return isDraw.value ? '流局' : '失败';
});

function seatName(seat: number): string {
  if (seat < 0) return '—';
  const view = props.pub?.seats[seat];
  if (!view) return '座位 ' + (seat + 1);
  if (view.bot) return view.id.startsWith('bot:') ? 'AI 机器人' : 'AI 代打';
  const chars = [...(view.name || view.id)];
  return chars.length > 10 ? chars.slice(0, 4).join('') + '…' + chars.slice(-4).join('') : chars.join('');
}

const fan = computed(() => props.handOver?.fan ?? 0);
const fanDetail = computed(() => props.handOver?.fanDetail ?? []);
const stake = computed(() => props.handOver?.stake ?? 0);
const base = computed(() => props.pub?.base ?? 100);
const committed = computed(() => props.settled?.committed ?? true);
const hasBots = computed(() => props.pub?.seats.some((s) => s.bot) ?? false);

/** 亮牌区副露全部明示（终局揭示，含暗杠四张） */
function meldFaceTiles(m: Meld): number[] {
  return m.tiles;
}

const playerResults = computed(() => {
  const s = props.settled;
  const pub = props.pub;
  if (!pub) return [];
  return pub.seats.map((seat) => ({
    id: seat.id,
    name: seatName(seat.seat),
    bot: !!seat.bot,
    dealer: pub.dealer === seat.seat,
    delta: s ? (s.deltas[seat.id] ?? 0) : 0,
  }));
});

// 亮牌：胡牌者的暗牌并上胡张展示
const revealed = computed(() => {
  const h = props.handOver;
  if (!h) return [];
  return h.hands.map((hand, seat) => {
    const isWinner = !isDraw.value && h.winner === seat;
    let tiles = hand;
    if (isWinner && !h.selfDraw && h.winTile !== undefined) tiles = hand.concat([h.winTile]).sort((a, b) => a - b);
    return {
      seat,
      label: seat === props.mySeat ? '我的暗牌' : seatName(seat),
      hand: tiles,
      melds: (h.melds?.[seat] || []) as Meld[],
      isWinner,
    };
  });
});

// 自动继续倒计时：以服务端实时 nextAt 为准（未知时回退 15s，纯展示）
const autoSeconds = ref(15);
let interval: number | undefined;
function nextDeadlineSec(): number {
  const nextAt = props.pub?.nextAt;
  if (nextAt && nextAt > 0) return Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
  return 15;
}
watch(visible, (v) => {
  if (v) {
    autoSeconds.value = nextDeadlineSec();
    if (interval) clearInterval(interval);
    interval = window.setInterval(() => {
      autoSeconds.value = nextDeadlineSec();
    }, 500);
  } else if (interval) {
    clearInterval(interval);
    interval = undefined;
  }
});
onUnmounted(() => interval !== undefined && clearInterval(interval));

// 解散倒计时（dissolveAt 取实时公共快照）
const dissolveSeconds = ref(10);
const dissolvePct = computed(() => Math.max(0, Math.min(100, (dissolveSeconds.value / 10) * 100)));
watch(() => props.dissolving, (v) => {
  if (v) {
    if (interval) clearInterval(interval);
    const tick = () => {
      const at = props.pub?.dissolveAt;
      dissolveSeconds.value = at && at > 0 ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : Math.max(0, dissolveSeconds.value - 1);
    };
    tick();
    interval = window.setInterval(tick, 250);
  } else if (interval) {
    clearInterval(interval);
    interval = undefined;
  }
}, { immediate: true });
</script>

<style scoped>
.chip {
  @apply bg-slate-800 text-slate-300 rounded-full px-2.5 py-0.5 text-xs;
}
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.25s ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.reveal-anim {
  animation: pop-in 0.18s ease-out both;
}
.reveal-scroll::-webkit-scrollbar {
  width: 5px;
}
.reveal-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.35);
  border-radius: 3px;
}
</style>
