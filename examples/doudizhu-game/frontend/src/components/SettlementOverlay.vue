<template>
  <Transition name="overlay">
    <div
      v-if="visible"
      class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4"
    >
      <div class="w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden" :class="winBorder">
        <!-- 头部：胜负 -->
        <div :class="['px-6 pt-6 pb-5 text-center', winBg]">
          <div
            :class="[
              'mx-auto mb-3 w-16 h-16 rounded-full border-2 flex items-center justify-center -rotate-6 select-none',
              win ? 'border-amber-300/80 bg-amber-400/15 text-amber-300 shadow-[0_0_24px_rgba(251,191,36,0.35)]' : 'border-slate-500/70 bg-slate-700/30 text-slate-400',
            ]"
          >
            <span class="text-3xl font-black">{{ win ? '胜' : '负' }}</span>
          </div>
          <div class="text-3xl font-black text-white drop-shadow">
            {{ win ? '胜利' : '失败' }}
          </div>
          <div class="mt-1 text-sm text-white/80">
            第 {{ handNo }} 局 ·
            <span v-if="iAmLandlord">你当地主</span>
            <span v-else-if="mySeat >= 0">农民阵营</span>
            <span v-else>{{ landlordName }} 当地主</span>
            · {{ landlordWins ? '地主胜' : '农民胜' }}
          </div>
          <div
            v-if="spring"
            class="mt-2 inline-block bg-white/20 rounded-full px-4 py-1 text-sm font-bold text-amber-200 animate-glow"
          >
            {{ springType }} · 倍数翻倍
          </div>
        </div>

        <!-- 倍数明细 -->
        <div class="bg-slate-900 px-6 py-4 border-b border-slate-800">
          <div class="flex items-center justify-center gap-2 flex-wrap text-sm">
            <span class="text-slate-400">倍数</span>
            <span class="chip">叫分 ×{{ bidScore || 1 }}</span>
            <template v-if="bombCount > 0">
              <span class="chip inline-flex items-center gap-1">
                <GameIcon name="bomb" class="w-3.5 h-3.5" />
                炸弹 ×2<sup>{{ bombCount }}</sup>
              </span>
            </template>
            <span v-if="spring" class="chip !bg-amber-500/20 !text-amber-300">春天 ×2</span>
            <span class="text-amber-300 font-black text-lg">= ×{{ multiplier }}</span>
          </div>
          <div class="text-center text-xs text-slate-500 mt-1.5">
            底分 {{ base }} × 倍数 = 本局 {{ stake }} 金币/人
          </div>
        </div>

        <!-- 各家增减 -->
        <div class="bg-slate-900 px-6 py-4 space-y-2">
          <div
            v-for="p in playerResults"
            :key="p.id"
            class="flex items-center gap-3 rounded-xl bg-slate-800/60 px-3 py-2"
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
              <GameIcon v-if="p.landlord" name="crown" class="w-4 h-4 text-amber-400" />
            </span>
            <span
              :class="['font-mono font-bold', p.delta > 0 ? 'text-emerald-400' : p.delta < 0 ? 'text-red-400' : 'text-slate-500']"
            >
              {{ p.delta > 0 ? '+' + p.delta : p.delta }}
            </span>
          </div>
          <div v-if="!committed" class="text-xs text-red-400 text-center pt-1 inline-flex items-center gap-1 justify-center w-full">
            <GameIcon name="alert" class="w-3.5 h-3.5 shrink-0" />
            钱包结算未提交（余额不足或平台拒绝），本局金额记 0
          </div>
        </div>

        <!-- 亮牌 -->
        <div class="bg-slate-900/80 px-6 py-4 border-t border-slate-800">
          <div class="text-xs text-slate-500 mb-2">各家亮牌（发牌种子已揭示，可验证）</div>
          <div class="space-y-2.5">
            <div v-for="h in revealed" :key="h.seat" class="flex items-start gap-2">
              <span class="w-14 shrink-0 text-xs text-slate-400 pt-1.5 text-right leading-tight">
                {{ h.label }}<span v-if="h.count > 0" class="text-slate-600">·{{ h.count }}</span>
              </span>
              <div class="flex flex-wrap gap-1 flex-1 min-h-7 items-center">
                <template v-if="h.cards.length > 0">
                  <PlayingCard v-for="c in h.cards" :key="c" :card="c" variant="flat" class="reveal-anim" />
                </template>
                <span v-else-if="h.wentOut" class="text-xs text-emerald-400/80">已出完</span>
                <span v-else class="text-xs text-slate-600">—</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 继续 / 解散倒计时 -->
        <div class="bg-slate-900 px-6 py-5 text-center border-t border-slate-800">
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
import type { DdzHandOver, DdzPublic, DdzSettled } from '../types';
import { sortCardsAsc } from '../cards';
import { monogram, avatarStyle } from '../avatar';
import GameIcon from './GameIcon.vue';
import PlayingCard from './PlayingCard.vue';

const props = withDefaults(defineProps<{
  handOver: DdzHandOver | null;
  settled: DdzSettled | null;
  playerId: string;
  mySeat: number;
  /** 解散宽限：有玩家离席未归队，倒计时结束房间解散 */
  dissolving?: boolean;
  /** 实时公共快照（倒计时以实时 nextAt/dissolveAt 为准，非 handOver 冻结快照） */
  pub?: DdzPublic | null;
}>(), {
  dissolving: false,
  pub: null,
});

defineEmits<{ ready: [] }>();

const visible = computed(() => props.handOver !== null);

// 胜负按本人阵营判定：地主看地主胜负，农民看反方
const win = computed(() => (iAmLandlord.value ? landlordWins.value : !landlordWins.value));
const winBg = computed(() => (win.value
  ? 'bg-gradient-to-b from-emerald-500/40 to-transparent'
  : 'bg-gradient-to-b from-red-500/30 to-transparent'));
const winBorder = computed(() => (win.value ? 'border-emerald-500/50' : 'border-red-500/50'));

const iAmLandlord = computed(() => props.handOver?.public.landlordSeat === props.mySeat);
const landlordWins = computed(() => props.handOver?.landlordWins ?? false);
const spring = computed(() => props.handOver?.spring ?? false);
const springType = computed(() => (iAmLandlord.value ? '春天' : '反春'));
const handNo = computed(() => props.handOver?.public.handNo ?? 0);
const bidScore = computed(() => props.handOver?.bidScore ?? 0);
const bombCount = computed(() => props.handOver?.bombCount ?? 0);
const multiplier = computed(() => props.handOver?.multiplier ?? 1);
const base = computed(() => props.handOver?.public.base ?? 100);
const stake = computed(() => props.handOver?.stake ?? 0);
const committed = computed(() => props.settled?.committed ?? true);

function displayName(seat: { name?: string; id: string; bot?: boolean }): string {
  if (seat.bot) return seat.id.startsWith('bot:') ? 'AI 机器人' : 'AI 代打';
  const chars = [...(seat.name || seat.id)];
  return chars.length > 10 ? chars.slice(0, 4).join('') + '…' + chars.slice(-4).join('') : chars.join('');
}

const landlordName = computed(() => {
  const h = props.handOver;
  if (!h) return '';
  const seat = h.public.seats[h.public.landlordSeat];
  return seat ? displayName(seat) : '';
});

const playerResults = computed(() => {
  const s = props.settled;
  if (!s || !props.handOver) return [];
  return props.handOver.public.seats.map((seat) => ({
    id: seat.id,
    name: displayName(seat),
    bot: !!seat.bot,
    landlord: seat.role === 'landlord',
    delta: s.deltas[seat.id] ?? 0,
  }));
});

// 亮牌：升序（小→大）排列，观战者/未知座位回退按座位号展示
const revealed = computed(() => {
  const h = props.handOver;
  if (!h) return [];
  const labels = props.mySeat >= 0 ? ['我的手牌', '下家', '上家'] : ['', '', ''];
  return [0, 1, 2].map((offset) => {
    const seat = props.mySeat >= 0 ? (props.mySeat + offset) % 3 : offset;
    const view = h.public.seats[seat];
    const cards = sortCardsAsc(h.hands[seat] || []);
    return {
      seat,
      label: props.mySeat >= 0 ? labels[offset] : displayName(view),
      cards,
      count: cards.length,
      wentOut: !!view && view.count === 0 && (h.winner === seat),
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
</style>
