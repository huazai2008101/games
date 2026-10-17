<template>
  <!-- 块面 SVG：每色一个专属切工形状（形状+颜色双重区分），
       特殊块（火箭/炸弹/彩虹球）独立造型；渐变引用 App.vue 根部的共享 defs -->
  <svg viewBox="0 0 100 100" class="w-full h-full" :class="{ 'm3-spin': kind === 4 }">
    <!-- 🌈 彩虹球：六色风火轮 + 白芯 -->
    <g v-if="kind === 4">
      <circle cx="50" cy="50" r="42" fill="#ffffff" opacity="0.10" />
      <path d="M50,50 L50,14 A36,36 0 0 1 81.2,32 Z" fill="#ff5a6e" />
      <path d="M50,50 L81.2,32 A36,36 0 0 1 81.2,68 Z" fill="#ffb437" />
      <path d="M50,50 L81.2,68 A36,36 0 0 1 50,86 Z" fill="#37c966" />
      <path d="M50,50 L50,86 A36,36 0 0 1 18.8,68 Z" fill="#3d9bf5" />
      <path d="M50,50 L18.8,68 A36,36 0 0 1 18.8,32 Z" fill="#9a5cf0" />
      <path d="M50,50 L18.8,32 A36,36 0 0 1 50,14 Z" fill="#ff6ba9" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3" />
      <circle cx="50" cy="50" r="14" fill="url(#m3-gloss)" />
      <ellipse cx="39" cy="33" rx="13" ry="8" fill="#ffffff" opacity="0.55" />
    </g>

    <!-- 🚀 火箭：金属弹身 + 双向箭羽（竖火箭整体旋转 90°） -->
    <g v-else-if="kind === 1 || kind === 2" :transform="kind === 2 ? 'rotate(90 50 50)' : undefined">
      <rect x="7" y="34" width="86" height="32" rx="16" fill="url(#m3-metal)" stroke="#596074" stroke-width="3" />
      <rect x="12" y="38.5" width="76" height="8" rx="4" fill="#ffffff" opacity="0.55" />
      <rect x="44" y="25" width="12" height="10" rx="3" :fill="p.light" :stroke="p.rim" stroke-width="2" />
      <rect x="44" y="65" width="12" height="10" rx="3" :fill="p.light" :stroke="p.rim" stroke-width="2" />
      <circle cx="50" cy="50" r="13" :fill="`url(#m3-g${color})`" :stroke="p.rim" stroke-width="3" />
      <circle cx="50" cy="50" r="5.5" fill="#ffffff" opacity="0.7" />
      <path d="M31,41.5 L20,50 L31,58.5" fill="none" :stroke="p.dark" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M39,44 L30.5,50 L39,56" fill="none" :stroke="p.light" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M69,41.5 L80,50 L69,58.5" fill="none" :stroke="p.dark" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M61,44 L69.5,50 L61,56" fill="none" :stroke="p.light" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    </g>

    <!-- 💣 炸弹：曜黑弹体 + 本色环 + 引信火花 -->
    <g v-else-if="kind === 3">
      <circle cx="50" cy="55" r="32" fill="url(#m3-bomb)" stroke="#0b0e1c" stroke-width="3" />
      <circle cx="50" cy="55" r="24" fill="none" :stroke="p.light" stroke-width="5.5" opacity="0.95" />
      <circle cx="50" cy="55" r="24" fill="none" :stroke="p.dark" stroke-width="2" opacity="0.5" transform="translate(0,2)" />
      <path d="M50,23 Q53,13 62,9" fill="none" stroke="#caa46a" stroke-width="4.5" stroke-linecap="round" />
      <circle cx="63" cy="8" r="6" fill="#ffd25e" />
      <circle cx="63" cy="8" r="11" fill="#ffd25e" opacity="0.3" />
      <ellipse cx="40" cy="43" rx="11" ry="7" fill="#ffffff" opacity="0.32" />
    </g>

    <!-- 普通宝石：按颜色专属切工 -->
    <g v-else>
      <!-- 红：圆形明亮式 -->
      <g v-if="color === 0">
        <circle cx="50" cy="50" r="38" :fill="`url(#m3-g0)`" :stroke="p.rim" stroke-width="3.5" />
        <circle cx="50" cy="50" r="27" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="3" />
        <path d="M50,23 L68,50 L50,77 L32,50 Z" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2.5" />
        <ellipse cx="39" cy="34" rx="15" ry="10" fill="#ffffff" opacity="0.5" />
      </g>
      <!-- 黄：钻石切工 -->
      <g v-else-if="color === 1">
        <polygon points="50,7 91,50 50,93 9,50" :fill="`url(#m3-g1)`" :stroke="p.rim" stroke-width="3.5" stroke-linejoin="round" />
        <polygon points="50,29 71,50 50,71 29,50" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2.5" stroke-linejoin="round" />
        <path d="M50,29 L29,50 M50,29 L71,50 M29,50 L50,71 M71,50 L50,71" stroke="#ffffff" stroke-opacity="0.15" stroke-width="2" />
        <circle cx="40" cy="35" r="8" fill="#ffffff" opacity="0.5" />
      </g>
      <!-- 绿：祖母绿切工（切角矩形） -->
      <g v-else-if="color === 2">
        <path d="M18,31 L31,18 H69 L82,31 V69 L69,82 H31 L18,69 Z" :fill="`url(#m3-g2)`" :stroke="p.rim" stroke-width="3.5" stroke-linejoin="round" />
        <rect x="30" y="30" width="40" height="40" rx="4" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2.5" />
        <ellipse cx="38" cy="33" rx="12" ry="8" fill="#ffffff" opacity="0.45" />
      </g>
      <!-- 蓝：六边形蓝宝 -->
      <g v-else-if="color === 3">
        <polygon points="50,7 88,28.5 88,71.5 50,93 12,71.5 12,28.5" :fill="`url(#m3-g3)`" :stroke="p.rim" stroke-width="3.5" stroke-linejoin="round" />
        <polygon points="50,22 75,36.5 75,63.5 50,78 25,63.5 25,36.5" fill="none" stroke="#ffffff" stroke-opacity="0.26" stroke-width="2.5" stroke-linejoin="round" />
        <ellipse cx="38" cy="33" rx="13" ry="8" fill="#ffffff" opacity="0.48" />
      </g>
      <!-- 紫：星形紫晶 -->
      <g v-else>
        <path d="M50,8 L61,36 L90,38 L68,56 L75,85 L50,69 L25,85 L32,56 L10,38 L39,36 Z"
              :fill="`url(#m3-g4)`" :stroke="p.rim" stroke-width="3.5" stroke-linejoin="round" />
        <path d="M50,26 L56,44 L75,45 L60,57 L65,75 L50,64 L35,75 L40,57 L25,45 L44,44 Z"
              fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2" stroke-linejoin="round" />
        <circle cx="42" cy="36" r="6" fill="#ffffff" opacity="0.5" />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { colorOf, kindOf, GEM_COLORS } from './types';

const props = defineProps<{ code: number }>();

const color = computed(() => colorOf(props.code));
const kind = computed(() => kindOf(props.code));
const p = computed(() => GEM_COLORS[color.value >= 0 ? color.value : 0]);
</script>
