<!-- 麻将牌：仿真实塑料牌 —— 立体牌体 + 刻面 SVG（刻面生成见 tileFace.ts），
     宽高比 60×76 ≈ 0.79，贴近真实牌面的矮壮比例 -->
<template>
  <div
    :class="[
      'relative select-none leading-none mj-tile',
      selected ? 'mj-selected' : '',
      sizeClass,
    ]"
    role="img"
    :aria-label="back ? '牌背' : label"
  >
    <svg :viewBox="VIEWBOX" class="absolute inset-0 w-full h-full block" aria-hidden="true">
      <defs>
        <linearGradient id="mj-face-g" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.48" stop-color="#fffef9" />
          <stop offset="1" stop-color="#eee9db" />
        </linearGradient>
        <linearGradient id="mj-back-g" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stop-color="#12805f" />
          <stop offset="0.5" stop-color="#0c6549" />
          <stop offset="1" stop-color="#07452f" />
        </linearGradient>
        <filter id="mj-engrave" x="-10%" y="-10%" width="120%" height="120%">
          <!-- 刻痕：把图案右下偏移的余边填成暖褐暗影，叠回原图之下 -->
          <feOffset in="SourceAlpha" dx="1.3" dy="1.7" result="off" />
          <feComposite in="off" in2="SourceAlpha" operator="out" result="edge" />
          <feFlood flood-color="rgba(92,62,26,0.6)" result="shade-color" />
          <feComposite in="shade-color" in2="edge" operator="in" result="shade" />
          <feMerge>
            <feMergeNode in="shade" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <!-- 牌体：圆角面 + 底缘厚度 + 顶部高光 -->
      <path :d="bodyPath" :fill="back ? 'url(#mj-back-g)' : 'url(#mj-face-g)'" />
      <path
        :d="bodyPath"
        fill="none"
        :stroke="back ? 'rgba(0,0,0,0.45)' : 'rgba(116,108,91,0.48)'"
        stroke-width="1.15"
      />
      <!-- 牌面内侧的浅色倒角，让白面像略高出牌体的釉面 -->
      <path
        v-if="!back"
        d="M7 3.5 H53 Q56.2 3.5 56.2 6.7 V63.4 Q56.2 69.1 50.4 70.1 Q30 72.1 9.6 70.1 Q3.8 69.1 3.8 63.4 V6.7 Q3.8 3.5 7 3.5 Z"
        fill="none"
        stroke="rgba(255,255,255,0.78)"
        stroke-width="0.7"
      />
      <path
        v-if="!back"
        d="M5.3 7 Q5.3 4.8 7.5 4.8 H52.5"
        fill="none"
        stroke="rgba(210,202,183,0.42)"
        stroke-width="0.65"
        stroke-linecap="round"
      />
      <path
        d="M8 3.2 Q30 1.6 52 3.2"
        fill="none"
        :stroke="back ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.9)'"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <path
        d="M4 68 Q30 73.2 56 68"
        fill="none"
        :stroke="back ? 'rgba(0,0,0,0.4)' : 'rgba(138,136,126,0.45)'"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <!-- 刻面按 60×84 版心设计，整体绕中心等比压缩到 76 高，图案不变形 -->
      <g
        v-if="back"
        v-html="backInner"
        transform="translate(30 38) scale(0.9048) translate(-30 -42)"
      ></g>
      <g
        v-else
        v-html="faceInner"
        filter="url(#mj-engrave)"
        transform="translate(30 38) scale(0.9048) translate(-30 -42)"
      ></g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { KIND_LABELS } from '../tiles';
import { TILE_VIEWBOX, tileFaceInner, tileBackInner } from './tileFace';

const props = withDefaults(defineProps<{
  /** 0..135 的牌 id；null = 牌背 */
  tile: number | null;
  size?: 'xs' | 'sm' | 'md';
  selected?: boolean;
}>(), {
  size: 'md',
  selected: false,
});

const VIEWBOX = TILE_VIEWBOX;
const backInner = tileBackInner();

const back = computed(() => props.tile === null);
const kind = computed(() => (props.tile === null ? -1 : props.tile >> 2));
const faceInner = computed(() => (props.tile === null ? '' : tileFaceInner(kind.value)));
const label = computed(() => (props.tile === null ? '' : KIND_LABELS[kind.value] || ''));

// 牌体路径：几乎满铺视框（视觉宽高比 ≈0.79），上缘略窄、底部微外扩的立体牌形
const bodyPath = 'M5.5 1 L54.5 1 Q59.2 1 59.2 6 L59.2 64.5 Q59.2 72 52 73.2 Q30 75.2 8 73.2 Q0.8 72 0.8 64.5 L0.8 6 Q0.8 1 5.5 1 Z';

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'w-7 h-[2.22rem]';
    case 'sm': return 'w-9 h-[2.85rem]';
    default: return 'w-12 h-[3.8rem]';
  }
});
</script>

<style scoped>
.mj-tile {
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.36));
}
.mj-selected {
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 6px rgba(252, 211, 77, 0.9));
}
</style>
