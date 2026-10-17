<!-- 结算浮层：胜负 + 钱包变动 + 自动续局倒计时 -->
<template>
  <Transition name="pop">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div class="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/95 px-8 py-8 text-center shadow-2xl">
        <!-- 结果 -->
        <div
          :class="[
            'mx-auto mb-3 w-16 h-16 rounded-full border-2 flex items-center justify-center -rotate-6 select-none',
            sealClass,
          ]"
        >
          <span v-if="sealChar" class="text-3xl font-black">{{ sealChar }}</span>
          <GameIcon v-else name="piece" class="w-8 h-8" />
        </div>
        <div class="text-2xl font-black tracking-widest" :class="resultClass">{{ resultTitle }}</div>
        <div class="mt-1.5 text-sm text-slate-400">{{ reasonLabel }}</div>

        <!-- 我的变动 -->
        <div v-if="myDelta !== null" class="mt-5 flex items-center justify-center gap-6">
          <div>
            <div class="text-[11px] text-slate-500 mb-0.5">本局变动</div>
            <div class="text-xl font-bold font-mono" :class="myDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'">
              {{ myDelta > 0 ? '+' : '' }}{{ myDelta }}
            </div>
          </div>
          <div class="w-px h-9 bg-white/10"></div>
          <div>
            <div class="text-[11px] text-slate-500 mb-0.5">累计战绩</div>
            <div class="text-xl font-bold font-mono text-amber-300">
              {{ myScore > 0 ? '+' : '' }}{{ myScore }}
            </div>
          </div>
        </div>
        <div v-if="!committed" class="mt-3 text-xs text-yellow-300/90 inline-flex items-center gap-1 justify-center w-full">
          <GameIcon name="alert" class="w-3.5 h-3.5 shrink-0" />
          本局结算未完成，金额未计入
        </div>

        <!-- 续局倒计时 / 解散提示 -->
        <div class="mt-6 text-xs text-slate-400">
          <template v-if="dissolving">有玩家离席，{{ countdown }}s 后未归队房间将解散</template>
          <template v-else-if="countdown > 0">{{ countdown }}s 后自动开始下一局</template>
          <template v-else>等待玩家准备…</template>
        </div>

        <button
          type="button"
          class="mt-4 w-full py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 shadow-lg shadow-orange-500/25 active:scale-95 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          :disabled="dissolving"
          @click="$emit('ready')"
        >
          <GameIcon name="refresh" class="w-4 h-4" />
          再来一局
        </button>
        <button
          type="button"
          class="mt-2 w-full py-2.5 rounded-xl text-sm font-semibold border border-white/15 text-slate-400 hover:text-white hover:border-white/40 transition"
          @click="$emit('exit')"
        >
          返回大厅
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { XqHandOver, XqPublic, XqSettled } from '../types';
import { END_REASON_LABEL } from '../types';
import GameIcon from './GameIcon.vue';

const props = defineProps<{
  handOver: XqHandOver | null;
  settled: XqSettled | null;
  mySeat: number;
  /** 我的本局金币变动（未结算为 null）。 */
  myDelta: number | null;
  /** 我的累计战绩。 */
  myScore: number;
  dissolving: boolean;
  pub: XqPublic | null;
}>();

defineEmits<{
  (e: 'ready'): void;
  (e: 'exit'): void;
}>();

const visible = computed(() => !!props.handOver || props.dissolving);

const resultTitle = computed(() => {
  const h = props.handOver;
  if (!h) return '对局结束';
  if (h.draw) return '和棋';
  if (props.mySeat < 0) return h.winner === 0 ? '红方胜' : '黑方胜';
  return h.winner === props.mySeat ? '胜 利' : '惜 败';
});
const resultClass = computed(() => {
  const h = props.handOver;
  if (!h) return 'text-slate-200';
  if (h.draw || props.mySeat < 0) return 'text-slate-200';
  return h.winner === props.mySeat ? 'text-amber-300' : 'text-slate-300';
});
// 结果印章：胜 / 负 / 和（观战与未决局回退棋子印记）
const sealChar = computed(() => {
  const h = props.handOver;
  if (!h) return '';
  if (h.draw) return '和';
  if (props.mySeat < 0) return '';
  return h.winner === props.mySeat ? '胜' : '负';
});
const sealClass = computed(() => {
  const h = props.handOver;
  if (!h || h.draw || props.mySeat < 0) {
    return 'border-slate-500/70 bg-slate-700/30 text-slate-300';
  }
  return h.winner === props.mySeat
    ? 'border-amber-300/80 bg-amber-400/15 text-amber-300 shadow-[0_0_24px_rgba(251,191,36,0.35)]'
    : 'border-slate-500/70 bg-slate-700/30 text-slate-400';
});
const reasonLabel = computed(() => {
  const h = props.handOver;
  if (!h) return '';
  return END_REASON_LABEL[h.reason] || h.reason;
});
const committed = computed(() => props.settled?.committed ?? true);

const myDelta = computed<number | null>(() => props.myDelta);
const myScore = computed(() => props.myScore);

// ── 倒计时 ──
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => { now.value = Date.now(); }, 500);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
const countdown = computed(() => {
  const p = props.pub;
  if (!p) return 0;
  const target = props.dissolving ? p.dissolveAt : p.nextAt;
  if (!target) return 0;
  return Math.max(0, Math.ceil((target - now.value) / 1000));
});
</script>

<style scoped>
.pop-enter-active {
  transition: opacity 0.25s ease;
}
.pop-enter-active > div {
  animation: pop-in 0.3s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}
.pop-enter-from {
  opacity: 0;
}
@keyframes pop-in {
  0% { transform: scale(0.7); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
