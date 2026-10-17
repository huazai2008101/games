<template>
  <div class="flex flex-col items-center gap-1.5 w-44">
    <!-- 出牌展示区 -->
    <div class="h-20 flex items-end justify-center w-full">
      <div v-if="played && played.length > 0" class="flex items-end -space-x-2.5">
        <PlayingCard v-for="(c, i) in played" :key="c + '-' + i" :card="c" size="xs" class="play-anim" :style="{ animationDelay: i * 30 + 'ms' }" />
      </div>
      <span
        v-else-if="passTag"
        class="text-xs text-slate-300 bg-slate-800/80 rounded-full px-3.5 py-1 border border-slate-600/60 backdrop-blur"
      >
        不要
      </span>
    </div>

    <!-- 玩家信息 -->
    <div
      :class="[
        'relative w-full rounded-2xl border px-3 py-2 flex items-center gap-2.5 backdrop-blur transition-all duration-300',
        vacant ? 'border-dashed border-white/15 bg-slate-900/40 opacity-70' : '',
        isTurn
          ? 'border-amber-400/90 bg-amber-500/10 shadow-lg shadow-amber-500/25 -translate-y-0.5'
          : vacant
            ? ''
            : 'border-white/10 bg-slate-900/70',
      ]"
    >
      <!-- 头像 + 计时环 -->
      <div class="relative shrink-0">
        <div
          v-if="isTurn && remaining > 0"
          class="absolute -inset-1 rounded-full"
          :style="ringStyle"
        ></div>
        <div
          :class="[
            'w-10 h-10 rounded-full flex items-center justify-center relative',
            vacant ? 'bg-slate-800/60 text-slate-500' : isTurn ? '' : 'bg-slate-700/70 text-slate-300',
          ]"
          :style="!vacant && !seat.bot ? avatarStyle(seat.id) : {}"
        >
          <GameIcon v-if="vacant" name="user" class="w-5 h-5" />
          <GameIcon v-else-if="seat.bot" name="bot" class="w-6 h-6" />
          <span v-else class="text-base font-bold">{{ monogram(shortName) }}</span>
        </div>
        <!-- 剩牌数 -->
        <div
          v-if="!vacant && inHand"
          :class="[
            'absolute -bottom-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center border',
            seat.count <= 2
              ? 'bg-red-500 border-red-300 text-white animate-pulse'
              : 'bg-slate-800 border-slate-500 text-slate-200',
          ]"
        >
          {{ seat.count }}
        </div>
      </div>

      <!-- 名字 / 身份 -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold text-slate-100 truncate">
            {{ shortName }}
          </span>
          <GameIcon v-if="isLandlord" name="crown" class="w-4 h-4 shrink-0 text-amber-300" title="地主" />
          <span
            v-if="isDealer && phase === 'bidding'"
            class="shrink-0 text-[10px] leading-none text-emerald-300 border border-emerald-400/40 rounded px-1 py-0.5"
          >先叫</span>
        </div>
        <div class="text-[11px] truncate" :class="vacant ? 'text-slate-500' : 'text-slate-400'">
          <span v-if="vacant" class="inline-flex items-center gap-1">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
            空位 · 匹配中
          </span>
          <span v-else-if="seat.bot" class="inline-flex items-center gap-1 text-slate-500">
            <GameIcon name="bot" class="w-3 h-3" />
            {{ seat.id.startsWith('bot:') ? 'AI 补位' : 'AI 代打' }}
          </span>
          <span v-else-if="seat.bid > 0 && phase === 'bidding'">叫了 {{ seat.bid }} 分</span>
          <span v-else-if="seat.bid === 0 && hasBid && phase === 'bidding'">不叫</span>
          <span v-else>{{ roleLabel }}</span>
        </div>
      </div>

      <!-- 身份徽标 -->
      <span
        v-if="roleChip"
        :class="[
          'shrink-0 text-[10px] font-bold rounded-md px-1.5 py-0.5 border',
          roleChip === '地主'
            ? 'text-amber-300 border-amber-400/50 bg-amber-500/15'
            : 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
        ]"
      >
        {{ roleChip }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { SeatView, DdzPhase } from '../types';
import { monogram, avatarStyle } from '../avatar';
import GameIcon from './GameIcon.vue';
import PlayingCard from './PlayingCard.vue';

const props = withDefaults(defineProps<{
  seat: SeatView;
  isTurn: boolean;
  turnEndsAt: number;
  isLandlord: boolean;
  isDealer: boolean;
  phase: DdzPhase;
  /** 出牌展示：null 表示该座位未出牌；空数组 = 过牌（显示"不要"）。 */
  played: number[] | null;
  passTag?: boolean;
  /** 该座位本轮叫分是否已行动（区分"不叫"与"还没轮到"）。 */
  hasBid?: boolean;
}>(), {
  passTag: false,
  hasBid: false,
});

const vacant = computed(() => !!props.seat.vacant);

const shortName = computed(() => {
  if (props.seat.bot) return 'AI ' + props.seat.id.slice(-1);
  // 优先平台名册的昵称/用户名(超过 10 个字符时截断),缺失回退短 ID
  const chars = [...(props.seat.name || props.seat.id)];
  return chars.length > 10 ? chars.slice(0, 4).join('') + '…' + chars.slice(-4).join('') : chars.join('');
});

const roleLabel = computed(() =>
  props.isLandlord ? '地主' : props.seat.role === 'farmer' ? '农民' : '等待中',
);

const roleChip = computed(() => {
  if (props.isLandlord) return '地主';
  if (props.seat.role === 'farmer') return '农民';
  return '';
});

/** 手牌数是否已有意义（发牌后） */
const inHand = computed(() => props.phase === 'bidding' || props.phase === 'playing' || props.phase === 'settle');

// 倒计时环（0.5s 粒度即可，ring 不需要丝滑）
const remaining = ref(0);
let timer: number | undefined;
function tick() {
  remaining.value = Math.max(0, Math.ceil((props.turnEndsAt - Date.now()) / 1000));
}
function startTick() {
  if (timer !== undefined) clearInterval(timer);
  tick();
  timer = window.setInterval(tick, 500);
}
watch(() => [props.isTurn, props.turnEndsAt], startTick);
onMounted(startTick);
onUnmounted(() => timer !== undefined && clearInterval(timer));

const ringStyle = computed(() => {
  const total = props.phase === 'bidding' ? 15 : 25;
  const frac = Math.min(1, Math.max(0.02, remaining.value / total));
  const color = remaining.value <= 5 ? '#f87171' : '#fbbf24';
  return {
    background: `conic-gradient(${color} ${frac * 360}deg, rgba(255,255,255,0.06) 0deg)`,
    mask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
    WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
  };
});
</script>

<style scoped>
.play-anim {
  animation: pop-in 0.25s ease-out both;
}
</style>
