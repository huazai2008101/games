<!-- 操作面板：匹配/开局/续局准备 + 打牌 + 吃碰杠胡选择窗（雀魂式大按钮 + 牌面预览） -->
<template>
  <div class="flex items-center justify-center gap-3 min-h-16 flex-wrap action-pop">
    <!-- 匹配阶段：等待补位 / 立即开局 -->
    <template v-if="phase === 'matching'">
      <div class="flex items-center gap-2 text-sm text-sky-200">
        <span class="flex gap-1">
          <span v-for="i in 3" :key="i" class="w-2 h-2 rounded-full bg-sky-400 animate-pulse" :style="{ animationDelay: i * 180 + 'ms' }"></span>
        </span>
        自动匹配中 <span class="font-bold text-sky-300">{{ matchedCount }}/4</span>
      </div>
      <button
        type="button"
        :disabled="busy"
        class="act-btn from-sky-500 to-sky-700 border-sky-300/70 text-white shadow-sky-500/30"
        @click="$emit('ready')"
      >
        AI 补位 · 立即开局
      </button>
    </template>

    <!-- 行牌：轮到我打牌 -->
    <template v-else-if="myDiscard">
      <button
        v-if="selfWin"
        type="button"
        :disabled="busy"
        class="act-btn act-win !px-7"
        @click="$emit('win')"
      >
        <span class="text-lg leading-none">胡</span>
        <span class="text-[11px] font-medium opacity-90">自摸</span>
      </button>
      <button
        v-for="t in anKongOptions"
        :key="'an' + t"
        type="button"
        :disabled="busy"
        class="act-btn from-amber-500 to-amber-700 border-amber-300/70 text-amber-50 shadow-amber-500/30"
        @click="$emit('kong', { kind: 'an', tile: t })"
      >
        <span class="inline-flex gap-0.5 -ml-1"><MahjongTile :tile="t" size="xs" /></span>
        <span class="text-lg leading-none">杠</span>
      </button>
      <button
        v-for="t in buKongOptions"
        :key="'bu' + t"
        type="button"
        :disabled="busy"
        class="act-btn from-amber-500 to-amber-700 border-amber-300/70 text-amber-50 shadow-amber-500/30"
        @click="$emit('kong', { kind: 'bu', tile: t })"
      >
        <span class="inline-flex gap-0.5 -ml-1"><MahjongTile :tile="t" size="xs" /></span>
        <span class="text-lg leading-none">补杠</span>
      </button>
      <button
        type="button"
        :disabled="!selectedTile || busy"
        :class="[
          'act-btn !px-8',
          selectedTile && !busy
            ? 'from-red-500 to-red-700 border-red-300/80 text-white shadow-red-500/40 animate-glow'
            : 'from-slate-700 to-slate-800 border-slate-600/50 text-slate-500 shadow-none cursor-not-allowed',
        ]"
        @click="$emit('discard', selectedTile)"
      >
        <span class="text-lg leading-none">打出</span>
        <span v-if="selectedTile" class="inline-flex -mr-2 ml-1"><MahjongTile :tile="selectedTile" size="xs" /></span>
      </button>
      <span class="text-xs text-slate-400/80 self-center">
        {{ selectedTile ? '再点「打出」或双击手牌' : '点选手牌，双击直接打出' }}
      </span>
    </template>

    <!-- 吃碰杠胡选择窗 -->
    <template v-else-if="claiming">
      <div class="text-xs text-amber-200/90 self-center inline-flex items-center gap-1.5 mr-1 claim-tip">
        <GameIcon name="clock" class="w-3.5 h-3.5" />
        {{ rob ? '可抢杠' : '他家打出' }}
        <span class="inline-flex ml-0.5 claim-tile"><MahjongTile :tile="claimTile" size="xs" /></span>
      </div>
      <button
        v-if="canWin"
        type="button"
        :disabled="busy"
        class="act-btn act-win !px-7"
        @click="$emit('win')"
      >
        <span class="text-lg leading-none">胡</span>
        <span class="text-[10px] font-medium opacity-80">W</span>
      </button>
      <button
        v-if="canKong"
        type="button"
        :disabled="busy"
        class="act-btn from-amber-500 to-amber-700 border-amber-300/70 text-amber-50 shadow-amber-500/30"
        @click="$emit('kong', { kind: 'ming' })"
      >
        <span class="text-lg leading-none">杠</span>
      </button>
      <button
        v-if="canPongClaim"
        type="button"
        :disabled="busy"
        class="act-btn from-emerald-500 to-emerald-700 border-emerald-300/70 text-emerald-50 shadow-emerald-500/30"
        @click="$emit('pong')"
      >
        <span class="text-lg leading-none">碰</span>
      </button>
      <button
        v-for="(combo, i) in chiOptions"
        :key="'chi' + i"
        type="button"
        :disabled="busy"
        class="act-btn from-sky-500 to-sky-700 border-sky-300/70 text-sky-50 shadow-sky-500/30"
        @click="$emit('chi', { tiles: combo })"
      >
        <span class="inline-flex gap-0.5 -ml-1">
          <MahjongTile v-for="t in combo" :key="t" :tile="t" size="xs" />
        </span>
        <span class="text-lg leading-none">吃</span>
      </button>
      <button
        type="button"
        :disabled="busy"
        class="act-btn from-slate-600 to-slate-800 border-white/20 text-slate-200 shadow-black/30"
        @click="$emit('pass')"
      >
        <span class="text-lg leading-none">过</span>
        <span class="text-[10px] font-medium opacity-70">P</span>
      </button>
    </template>

    <!-- 等待他人 -->
    <template v-else-if="phase === 'playing'">
      <div class="text-sm text-emerald-100/70 animate-pulse tracking-wide">{{ waitingText }}</div>
    </template>

    <!-- 结算/大厅：继续下一局（解散宽限期由结算浮层接管，不出按钮） -->
    <template v-else-if="phase === 'settle' || phase === 'lobby'">
      <button
        :disabled="!readyEnabled || busy"
        :class="[
          'act-btn !px-9',
          readyEnabled && !busy
            ? 'from-emerald-400 to-emerald-600 border-emerald-200/80 text-slate-900 shadow-emerald-500/40 animate-glow'
            : 'from-slate-700 to-slate-800 border-slate-600/50 text-slate-500 shadow-none cursor-not-allowed',
        ]"
        @click="$emit('ready')"
      >
        <GameIcon :name="phase === 'lobby' ? 'play' : 'refresh'" class="w-4 h-4" />
        <span class="text-lg leading-none">{{ phase === 'lobby' ? '开始游戏' : '再来一局' }}</span>
      </button>
      <span v-if="readyNote" class="text-xs text-slate-400 self-center">{{ readyNote }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import GameIcon from './GameIcon.vue';
import MahjongTile from './MahjongTile.vue';

withDefaults(defineProps<{
  phase: string;
  /** 轮到我打牌 */
  myDiscard: boolean;
  /** 我是否处于选择窗且有权动作 */
  claiming: boolean;
  claimTile: number;
  rob: boolean;
  canWin: boolean;
  canKong: boolean;
  canPongClaim: boolean;
  chiOptions: number[][];
  selfWin: boolean;
  anKongOptions: number[];
  buKongOptions: number[];
  selectedTile: number | null;
  waitingText: string;
  readyEnabled: boolean;
  readyNote: string;
  busy: boolean;
  matchedCount?: number;
}>(), {
  matchedCount: 0,
});

defineEmits<{
  ready: [];
  discard: [tile: number | null];
  chi: [payload: { tiles: number[] }];
  pong: [];
  kong: [payload: { kind: 'ming' | 'an' | 'bu'; tile?: number }];
  win: [];
  pass: [];
}>();
</script>

<style scoped>
/* 大按钮基底：渐变面 + 亮边 + 投影 + 按压反馈 */
.act-btn {
  @apply inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl font-extrabold text-sm
    border bg-gradient-to-b transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
    shadow-lg;
}
.act-win {
  @apply from-red-500 to-red-700 border-red-300/80 text-white shadow-red-500/40;
  box-shadow: 0 6px 20px rgba(220, 38, 38, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.act-btn:not(.act-win) {
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.action-pop {
  animation: pop-in 0.22s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}
.claim-tip {
  @apply bg-black/40 border border-amber-300/20 rounded-lg px-2 py-1;
}
.claim-tile {
  filter: drop-shadow(0 0 6px rgba(252, 211, 77, 0.7));
}
</style>
