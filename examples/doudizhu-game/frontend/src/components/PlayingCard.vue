<template>
  <!-- 扑克牌：纯 CSS 绘制。card=null 渲染牌背；variant=flat 渲染横排小牌（亮牌清单用） -->
  <div
    v-if="variant === 'flat' && card !== null"
    :class="[
      'inline-flex items-center gap-0.5 rounded-md border bg-gradient-to-b from-white to-slate-100 shadow-sm select-none font-card leading-none px-1.5 h-7',
      isRed ? 'text-rose-600 border-rose-200/70' : 'text-slate-800 border-slate-300/80',
    ]"
  >
    <span class="text-[13px] font-bold">{{ rank }}</span>
    <span class="text-[11px]">{{ suit }}</span>
  </div>
  <div
    v-else-if="card === null"
    :class="[sizeClass, 'rounded-lg border border-slate-900/70 shadow-md card-back relative overflow-hidden']"
  >
    <div class="absolute inset-1 rounded-md border border-white/25"></div>
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="w-5 h-5 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-white/80" :class="centerSize">♠</div>
    </div>
    <div class="absolute inset-0 opacity-[0.07] card-back-sheen"></div>
  </div>
  <div
    v-else
    :class="[
      sizeClass,
      'relative rounded-lg border bg-gradient-to-b from-white to-slate-50 shadow-md select-none font-card',
      isRed ? 'text-rose-600' : 'text-slate-800',
      selected ? 'border-amber-400 shadow-lg shadow-amber-400/40' : 'border-slate-300/90',
    ]"
  >
    <!-- 左上角 rank + suit -->
    <div class="absolute left-1 top-0.5 leading-none flex flex-col items-center">
      <span :class="rankClass">{{ rank }}</span>
      <span :class="suitSmallClass">{{ suit }}</span>
    </div>
    <!-- 中央大花色 / 王 -->
    <div class="absolute inset-0 flex items-center justify-center">
      <template v-if="isJoker">
        <span
          :class="[sizeClass === 'w-10 h-14' || sizeClass === 'w-9 h-13' ? 'text-[9px]' : 'text-xs', 'font-black tracking-widest leading-tight text-center', card === 53 ? 'text-rose-600' : 'text-slate-800']"
          :style="{ writingMode: 'vertical-rl' }"
        >JOKER</span>
        <span :class="['absolute', sizeClass === 'w-14 h-20' ? 'text-lg bottom-1' : 'text-xs bottom-0.5']">{{ card === 53 ? '☀' : '☾' }}</span>
      </template>
      <template v-else>
        <span :class="centerSuitClass">{{ suit }}</span>
      </template>
    </div>
    <!-- 右下角倒置 rank -->
    <div v-if="!isJoker" class="absolute right-1 bottom-0.5 leading-none rotate-180 flex flex-col items-center">
      <span :class="rankClass">{{ rank }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VALUE_LABELS, SUITS, isRedCard } from '../cards';

const props = withDefaults(defineProps<{
  /** 0..53 的牌 id；null = 牌背 */
  card: number | null;
  size?: 'xs' | 'sm' | 'md';
  selected?: boolean;
  /** classic = 竖排牌面；flat = 横排小牌（结算亮牌清单） */
  variant?: 'classic' | 'flat';
}>(), {
  size: 'md',
  selected: false,
  variant: 'classic',
});

const isJoker = computed(() => props.card !== null && props.card >= 52);
const isRed = computed(() => props.card !== null && isRedCard(props.card));
const rank = computed(() => {
  if (props.card === null) return '';
  if (props.card >= 52) return '王';
  return VALUE_LABELS[Math.floor(props.card / 4)];
});
const suit = computed(() => (props.card !== null && props.card < 52 ? SUITS[props.card % 4] : ''));

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'w-9 h-13';
    case 'sm': return 'w-10 h-14';
    default: return 'w-14 h-20';
  }
});
const rankClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'text-[11px] font-bold';
    case 'sm': return 'text-xs font-bold';
    default: return 'text-base font-bold';
  }
});
const suitSmallClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'text-[9px]';
    case 'sm': return 'text-[10px]';
    default: return 'text-sm';
  }
});
const centerSuitClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'text-lg opacity-80';
    case 'sm': return 'text-xl opacity-80';
    default: return 'text-3xl opacity-80';
  }
});
const centerSize = computed(() => (props.size === 'md' ? 'text-xl' : 'text-sm'));
</script>

<style scoped>
.card-back {
  background:
    repeating-linear-gradient(45deg, #1e3a5f 0 6px, #24466e 6px 12px);
}
.card-back-sheen {
  background: radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.9), transparent 60%);
}
.h-13 {
  height: 3.25rem;
}
</style>
