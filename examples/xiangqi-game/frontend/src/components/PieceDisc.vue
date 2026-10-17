<!-- 棋子：木质圆盘 + 阳刻汉字 -->
<template>
  <div
    :class="[
      'piece-disc piece-font relative flex items-center justify-center rounded-full aspect-square w-full',
      piece.c === 'r' ? 'text-red-700' : 'text-slate-800',
    ]"
  >
    <span class="font-bold leading-none select-none" :style="{ fontSize: fontSize }">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Piece } from '../rules';

const props = defineProps<{
  piece: Piece;
  /** 相对字号（CSS 长度，基于棋盘容器等比缩放），如 '4.2cqw' */
  fontSize?: string;
}>();

const RED = ['帅', '仕', '相', '马', '车', '炮', '兵'];
const BLACK = ['将', '士', '象', '马', '车', '炮', '卒'];
const ORDER: Record<string, number> = { K: 0, A: 1, B: 2, N: 3, R: 4, C: 5, P: 6 };

const label = computed(() => {
  const names = props.piece.c === 'r' ? RED : BLACK;
  return names[ORDER[props.piece.t]];
});
</script>
