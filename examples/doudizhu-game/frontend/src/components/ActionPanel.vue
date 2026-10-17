<template>
  <div class="flex items-center justify-center gap-3 min-h-14">
    <!-- 匹配阶段：等待补位 / 立即开局 -->
    <template v-if="phase === 'matching'">
      <div class="flex items-center gap-2 text-sm text-sky-200">
        <span class="flex gap-1">
          <span v-for="i in 3" :key="i" class="w-2 h-2 rounded-full bg-sky-400 animate-pulse" :style="{ animationDelay: i * 180 + 'ms' }"></span>
        </span>
        自动匹配中 <span class="font-bold text-sky-300">{{ matchedCount }}/3</span>
      </div>
      <button
        type="button"
        :disabled="busy"
        class="px-5 py-2.5 rounded-xl font-bold text-sm transition-all border border-slate-500 bg-slate-700 hover:bg-slate-600 text-slate-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="$emit('ready')"
      >
        AI 补位 · 立即开局
      </button>
    </template>

    <!-- 叫分阶段 -->
    <template v-else-if="phase === 'bidding'">
      <template v-if="myTurn">
        <button
          v-for="opt in bidOptions"
          :key="opt.score"
          :disabled="opt.disabled || busy"
          :class="[
            'px-5 py-2.5 rounded-xl font-bold text-sm transition-all border',
            opt.disabled || busy
              ? 'bg-slate-800/60 text-slate-600 border-slate-700/50 cursor-not-allowed'
              : opt.score === 0
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-100 border-slate-500 active:scale-95'
                : 'bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-900 border-amber-300 shadow-lg shadow-amber-500/30 active:scale-95',
          ]"
          @click="$emit('bid', opt.score)"
        >
          {{ opt.score === 0 ? '不叫' : opt.score + ' 分' }}
        </button>
      </template>
      <div v-else class="text-sm text-slate-400 animate-pulse">
        {{ turnName }} 正在叫分…
      </div>
    </template>

    <!-- 出牌阶段 -->
    <template v-else-if="phase === 'playing'">
      <template v-if="myTurn">
        <button
          :disabled="!canPass || busy"
          :class="[
            'px-5 py-2.5 rounded-xl font-bold text-sm transition-all border',
            canPass && !busy
              ? 'bg-slate-700 hover:bg-slate-600 text-slate-100 border-slate-500 active:scale-95'
              : 'bg-slate-800/60 text-slate-600 border-slate-700/50 cursor-not-allowed',
          ]"
          @click="$emit('pass')"
        >
          不出
        </button>
        <button
          :disabled="busy"
          :class="[
            'inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-sm transition-all border border-sky-400/60 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
          ]"
          @click="$emit('hint')"
        >
          <GameIcon name="bulb" class="w-4 h-4" />
          提示
        </button>
        <button
          :disabled="!canPlay || busy"
          :class="[
            'px-7 py-2.5 rounded-xl font-bold text-sm transition-all border',
            canPlay && !busy
              ? 'bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 text-white border-red-400 shadow-lg shadow-red-500/30 active:scale-95'
              : 'bg-slate-800/60 text-slate-600 border-slate-700/50 cursor-not-allowed',
          ]"
          @click="$emit('playSelected')"
        >
          出牌
        </button>
        <span v-if="canPlay && selectedHint" class="text-xs text-slate-400 self-center">
          {{ selectedHint }}
        </span>
        <span v-else-if="!canPlay" class="text-xs text-slate-500 self-center">
          {{ selectionHint }}
        </span>
      </template>
      <div v-else class="text-sm text-slate-400 animate-pulse">
        等待 {{ turnName }} 出牌…
      </div>
    </template>

    <!-- 结算/大厅：继续下一局（解散宽限期由结算浮层接管，不出按钮） -->
    <template v-else-if="phase === 'settle' || phase === 'lobby'">
      <button
        :disabled="!readyEnabled || busy"
        :class="[
          'inline-flex items-center justify-center gap-2 px-8 py-2.5 rounded-xl font-extrabold text-sm transition-all border',
            readyEnabled && !busy
            ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 hover:from-emerald-300 hover:to-emerald-500 text-slate-900 border-emerald-300 shadow-lg shadow-emerald-500/30 animate-glow active:scale-95'
            : 'bg-slate-800/60 text-slate-500 border-slate-700/50',
        ]"
        @click="$emit('ready')"
      >
        <GameIcon :name="phase === 'lobby' ? 'play' : 'refresh'" class="w-4 h-4" />
        {{ phase === 'lobby' ? '开始游戏' : '再来一局' }}
      </button>
      <span v-if="readyNote" class="text-xs text-slate-400">{{ readyNote }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DdzPhase } from '../types';
import { detectCombo } from '../cards';
import GameIcon from './GameIcon.vue';

const props = withDefaults(defineProps<{
  phase: DdzPhase;
  myTurn: boolean;
  turnName: string;
  bidScore: number;
  canPass: boolean;
  canPlay: boolean;
  selectedCards: number[];
  readyEnabled: boolean;
  readyNote: string;
  busy: boolean;
  /** 匹配相位：已坐进的真人数 */
  matchedCount?: number;
}>(), {
  matchedCount: 0,
});

defineEmits<{
  bid: [score: number];
  pass: [];
  hint: [];
  playSelected: [];
  ready: [];
}>();

const bidOptions = computed(() => [0, 1, 2, 3].map((score) => ({
  score,
  disabled: score !== 0 && score <= props.bidScore,
})));

const selectedHint = computed(() => {
  if (props.selectedCards.length === 0) return '';
  const c = detectCombo(props.selectedCards);
  return c ? typeLabel(c.type) : '';
});

const selectionHint = computed(() => {
  if (props.selectedCards.length === 0) return '点选手牌，或用提示';
  return '选的牌不构成能压过的牌型';
});

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    single: '单张', pair: '对子', trio: '三张',
    trio_single: '三带一', trio_pair: '三带二',
    straight: '顺子', pair_straight: '连对',
    plane: '飞机', plane_single: '飞机带单', plane_pair: '飞机带对',
    four_two_single: '四带二', four_two_pair: '四带两对',
    bomb: '炸弹', rocket: '王炸',
  };
  return map[t] || t;
}
</script>
