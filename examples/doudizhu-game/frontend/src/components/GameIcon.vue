<!-- 游戏内统一图标：24×24 线性内联 SVG，仅收录扑克相关与功能类图标。
     用法：<GameIcon name="bomb" class="w-4 h-4 text-amber-300" /> -->
<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="path"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type IconName =
  | 'cards'      // 叠放的两张扑克（游戏标记）
  | 'bomb'       // 炸弹
  | 'crown'      // 地主/胜
  | 'coin'       // 金币（余额）
  | 'bot'        // AI
  | 'user'       // 玩家占位
  | 'clock'      // 倒计时
  | 'alert'      // 警示
  | 'exit'       // 离开/解散
  | 'wifi'       // 已连接
  | 'wifi-off'   // 连接断开
  | 'refresh'    // 再来一局
  | 'play'       // 开始
  | 'bulb';      // 提示

const ICONS: Record<IconName, string> = {
  cards:
    '<g transform="rotate(-9 9.5 12)"><rect x="3.6" y="5.4" width="10.4" height="13.6" rx="1.7"/></g>' +
    '<g transform="rotate(10 15 12)"><rect x="9.9" y="4.8" width="10.4" height="13.6" rx="1.7"/>' +
    '<path d="M15.1 9.6c1.06 1.35 2.65 2.2 2.65 3.7a1.85 1.85 0 0 1-2.65 1.62 1.85 1.85 0 0 1-2.65-1.62c0-1.5 1.59-2.35 2.65-3.7z" fill="currentColor" stroke="none"/></g>',
  bomb:
    '<circle cx="10.2" cy="14.2" r="6.4"/>' +
    '<path d="M14.6 9.9l2.1-2.1"/>' +
    '<path d="M18.4 2.6v2.2"/><path d="M21.9 6.1h-2.2"/><path d="M20.7 3.3l-1.5 1.5"/>',
  crown:
    '<path d="M4.2 17.5 3 8.2l4.9 3.4L12 5.2l4.1 6.4L21 8.2l-1.2 9.3z"/>' +
    '<path d="M5.5 20.6h13"/>',
  coin:
    '<circle cx="12" cy="12" r="8.6"/>' +
    '<path d="M9 8.6l3 3 3-3"/><path d="M12 11.6V17"/><path d="M9.4 14.2h5.2"/>',
  bot:
    '<rect x="4.5" y="8.6" width="15" height="11" rx="2.6"/>' +
    '<path d="M12 8.6V5.4"/><circle cx="12" cy="4.2" r="1.2"/>' +
    '<circle cx="9.1" cy="13.4" r="1.1" fill="currentColor" stroke="none"/>' +
    '<circle cx="14.9" cy="13.4" r="1.1" fill="currentColor" stroke="none"/>' +
    '<path d="M9.6 16.7h4.8"/>',
  user:
    '<circle cx="12" cy="8" r="3.6"/>' +
    '<path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/>',
  clock:
    '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4v4.8l3.1 1.9"/>',
  alert:
    '<path d="M10.3 4.5 2.9 17.4a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0z"/>' +
    '<path d="M12 9.6v4.2"/><path d="M12 17.2h.01"/>',
  exit:
    '<path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5"/>' +
    '<path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>',
  wifi:
    '<path d="M4 10.4a12.5 12.5 0 0 1 16 0"/><path d="M7.1 13.9a8 8 0 0 1 9.8 0"/>' +
    '<path d="M10.2 17.2a3.8 3.8 0 0 1 3.6 0"/><path d="M12 20.2h.01"/>',
  'wifi-off':
    '<path d="m3 4 18 16"/><path d="M8.7 16.2a4.6 4.6 0 0 1 6.6 0"/>' +
    '<path d="M5.3 12.4a9.8 9.8 0 0 1 3.2-2.2"/><path d="M15.6 10.3a9.8 9.8 0 0 1 3.1 2.1"/>' +
    '<path d="M2 8.6A15 15 0 0 1 6.8 5.9"/><path d="M17.2 5.9a15 15 0 0 1 4.8 2.7"/>' +
    '<path d="M12 20.2h.01"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/>' +
    '<path d="M21 3.2V8h-4.8"/>',
  play:
    '<path d="M8 5.4v13.2L19 12z" fill="currentColor" stroke="none"/>',
  bulb:
    '<path d="M9.6 17.6h4.8"/><path d="M10.3 20.6h3.4"/>' +
    '<path d="M12 3.4a6.1 6.1 0 0 1 3.5 11.1c-.7.5-1.1 1.3-1.3 2.1h-4.4c-.2-.8-.6-1.6-1.3-2.1A6.1 6.1 0 0 1 12 3.4z"/>',
};

const props = defineProps<{ name: IconName }>();
const path = computed(() => ICONS[props.name]);
</script>
