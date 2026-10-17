<!-- 玩家座位：头像 + 计时环 + 名称/庄家/剩牌 + 副露（弃牌河已移至中央牌池） -->
<template>
  <div class="flex flex-col items-center gap-1.5" :class="dir === 'top' ? 'w-60' : 'w-44'">
    <!-- 玩家信息卡 -->
    <div
      :class="[
        'relative w-full rounded-2xl border px-3 py-2 flex items-center gap-2.5 backdrop-blur-md transition-all duration-300',
        vacant ? 'border-dashed border-white/15 bg-slate-950/40 opacity-75' : '',
        isTurn
          ? 'border-amber-300/90 bg-slate-950/70 shadow-[0_0_22px_rgba(251,191,36,0.35)] -translate-y-0.5'
          : vacant
            ? ''
            : 'border-white/10 bg-slate-950/60',
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
            'w-10 h-10 rounded-full flex items-center justify-center relative ring-1 ring-white/10',
            vacant ? 'bg-slate-800/60 text-slate-500' : 'bg-slate-700/70 text-slate-200',
          ]"
          :style="!vacant && !seat.bot ? avatarStyle(seat.id) : {}"
        >
          <GameIcon v-if="vacant" name="user" class="w-5 h-5" />
          <GameIcon v-else-if="seat.bot" name="bot" class="w-6 h-6" />
          <span v-else class="text-base font-bold">{{ monogram(shortName) }}</span>
        </div>
      </div>

      <!-- 名字 / 身份 -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold text-slate-100 truncate">{{ shortName }}</span>
          <span
            v-if="isDealer"
            class="shrink-0 text-[10px] leading-none text-amber-200 border border-amber-300/60 bg-amber-500/15 rounded px-1 py-0.5"
            title="庄家"
          >庄</span>
          <span
            v-if="isTurn"
            class="shrink-0 text-[10px] leading-none text-amber-300/90 animate-pulse"
          >{{ remaining > 0 ? remaining + 's' : '' }}</span>
        </div>
        <div class="text-[11px] truncate" :class="vacant ? 'text-slate-500' : 'text-slate-400'">
          <span v-if="vacant" class="inline-flex items-center gap-1">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
            空位 · 匹配中
          </span>
          <span v-else-if="seat.bot" class="inline-flex items-center gap-1 text-slate-500">
            <GameIcon name="bot" class="w-3 h-3" />
            AI 托管
          </span>
          <span v-else class="inline-flex items-center gap-1">
            <GameIcon name="tile" class="w-3 h-3 text-slate-500" />
            {{ seat.count }} 张
          </span>
        </div>
      </div>
    </div>

    <!-- 副露 -->
    <div v-if="meldCount > 0" class="flex flex-wrap gap-1 justify-center w-full">
      <MeldGroup v-for="(m, i) in seat.melds" :key="i" :meld="m" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { SeatView } from '../types';
import { monogram, avatarStyle } from '../avatar';
import GameIcon from './GameIcon.vue';
import MeldGroup from './MeldGroup.vue';

const props = withDefaults(defineProps<{
  seat: SeatView;
  isTurn: boolean;
  turnEndsAt: number;
  isDealer: boolean;
  phase: string;
  /** 座位方位（仅影响卡片宽度） */
  dir?: 'top' | 'left' | 'right';
}>(), {
  dir: 'top',
});

const vacant = computed(() => !!props.seat.vacant);
const meldCount = computed(() => (props.seat.melds || []).length);

const shortName = computed(() => {
  if (props.seat.bot) return 'AI ' + props.seat.id.slice(-1);
  const chars = [...(props.seat.name || props.seat.id)];
  return chars.length > 10 ? chars.slice(0, 4).join('') + '…' + chars.slice(-4).join('') : chars.join('');
});

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

const TURN_TOTAL_MS = 30000;
const ringStyle = computed(() => {
  const frac = Math.min(1, Math.max(0.02, (props.turnEndsAt > 0 ? props.turnEndsAt - Date.now() : 0) / TURN_TOTAL_MS));
  const color = remaining.value <= 5 ? '#f87171' : '#fbbf24';
  return {
    background: `conic-gradient(${color} ${Math.max(2, frac * 360)}deg, rgba(255,255,255,0.06) 0deg)`,
    mask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
    WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px))',
  };
});
</script>
