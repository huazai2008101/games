<!-- 操作面板：准备 / 行棋 / 认输 -->
<template>
  <div class="flex items-center justify-center gap-2.5 flex-wrap">
    <!-- 匹配中 / 大厅 / 结算：准备 -->
    <template v-if="phase !== 'playing'">
      <button
        type="button"
        class="px-8 py-2.5 rounded-xl font-bold text-slate-900 bg-gradient-to-r from-amber-400 to-orange-500 shadow-lg shadow-orange-500/25 active:scale-95 transition disabled:opacity-50 disabled:pointer-events-none"
        :disabled="!readyEnabled || busy"
        @click="$emit('ready')"
      >
        {{ phase === 'settle' ? '再来一局' : phase === 'matching' ? '立即开局（AI 补位）' : '准备开局' }}
      </button>
      <span v-if="readyNote" class="text-xs text-slate-400">{{ readyNote }}</span>
    </template>

    <!-- 行棋中 -->
    <template v-else>
      <template v-if="myTurn">
        <div class="text-sm font-bold text-amber-300 animate-pulse tracking-wider">轮到你走棋</div>
        <button
          type="button"
          class="px-4 py-2 rounded-xl text-sm font-semibold border border-rose-500/50 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 transition"
          @click="$emit('resign')"
        >
          认输
        </button>
      </template>
      <template v-else>
        <div class="text-sm text-slate-300">
          等待 <span class="text-amber-300 font-semibold">{{ turnName }}</span> 落子…
        </div>
        <button
          type="button"
          class="px-4 py-2 rounded-xl text-sm font-semibold border border-white/15 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 active:scale-95 transition"
          @click="$emit('resign')"
        >
          认输
        </button>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  phase: string;
  myTurn: boolean;
  turnName: string;
  readyEnabled: boolean;
  readyNote?: string;
  busy: boolean;
}>();

defineEmits<{
  (e: 'ready'): void;
  (e: 'resign'): void;
}>();
</script>
