<!-- 对局者信息卡：头像 + 名称 + 执子颜色 + 行棋状态 -->
<template>
  <div
    :class="[
      'flex items-center gap-2.5 rounded-2xl border px-3 py-2 transition-all',
      isTurn
        ? 'border-amber-400/70 bg-amber-400/10 shadow-[0_0_16px_rgba(251,191,36,0.25)]'
        : 'border-white/10 bg-slate-900/60',
    ]"
  >
    <div class="relative">
      <div
        :class="[
          'w-10 h-10 rounded-full border flex items-center justify-center',
          vacant ? 'border-slate-600/60 text-slate-500' : isBot ? 'bg-slate-700/40 border-slate-500/50 text-slate-300' : 'border-white/10',
        ]"
        :style="!isBot && !vacant ? avatarStyle(id) : {}"
      >
        <GameIcon v-if="isBot" name="bot" class="w-6 h-6" />
        <GameIcon v-else-if="vacant" name="user" class="w-5 h-5" />
        <span v-else class="text-base font-bold">{{ monogram(displayName) }}</span>
      </div>
      <!-- 执子颜色徽标 -->
      <div
        :class="[
          'absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-slate-900 flex items-center justify-center text-[10px] font-bold',
          color === 'r' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-200',
        ]"
        :title="color === 'r' ? '执红先行' : '执黑'"
      >
        {{ color ? (color === 'r' ? '红' : '黑') : '?' }}
      </div>
    </div>
    <div class="leading-tight min-w-0">
      <div class="text-sm font-semibold truncate flex items-center gap-1.5">
        {{ displayName }}
        <span v-if="score !== undefined" class="text-[11px] font-mono" :class="score > 0 ? 'text-emerald-300' : score < 0 ? 'text-rose-300' : 'text-slate-400'">
          {{ score > 0 ? '+' : '' }}{{ score }}
        </span>
      </div>
      <div class="text-[11px] inline-flex items-center gap-1" :class="isTurn ? 'text-amber-300' : 'text-slate-400'">
        <template v-if="isTurn">思考中 <span v-if="remaining > 0" class="font-mono inline-flex items-center gap-0.5"><GameIcon name="clock" class="w-3 h-3" />{{ formatClock(remaining) }}</span></template>
        <template v-else-if="bot">AI 代打</template>
        <template v-else-if="vacant">等待匹配…</template>
        <template v-else>等待中</template>
      </div>
    </div>
    <!-- 行棋倒计时环 -->
    <div v-if="isTurn && remaining > 0" class="ml-auto shrink-0">
      <svg class="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(148,163,184,0.25)" stroke-width="3.5" />
        <circle
          cx="18" cy="18" r="15" fill="none"
          :stroke="remaining <= 30 ? '#f87171' : '#fbbf24'"
          stroke-width="3.5" stroke-linecap="round"
          :stroke-dasharray="`${(remaining / totalSecs) * 94.2} 94.2`"
        />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { monogram, avatarStyle } from '../avatar';
import GameIcon from './GameIcon.vue';

const props = defineProps<{
  name?: string;
  id: string;
  bot?: boolean;
  vacant?: boolean;
  color: 'r' | 'b' | null;
  isTurn: boolean;
  remaining: number;
  totalSecs: number;
  score?: number;
}>();

// 长时限（在线真人 5 分钟）显示 分:秒，短时限保持 秒。
const formatClock = (secs: number): string => {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const isBot = computed(() => !!props.bot);
const displayName = computed(() => {
  if (props.bot) return 'AI 代打';
  if (props.name) return props.name;
  return props.id.length > 10 ? props.id.slice(0, 4) + '…' + props.id.slice(-4) : props.id || '—';
});
</script>
