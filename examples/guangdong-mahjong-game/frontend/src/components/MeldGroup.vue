<!-- 副露组：吃/碰/明杠横排；暗杠首尾扣置；补杠第四张侧躺压在刻子上 -->
<template>
  <div
    class="relative flex rounded-md overflow-visible border border-amber-900/40 bg-slate-950/55 p-0.5 gap-[1px] shadow-md"
    :title="label"
  >
    <template v-if="meld.tiles.length > 0">
      <MahjongTile v-for="(t, ti) in tiles" :key="ti" :tile="t" size="xs" />
      <div
        v-if="meld.type === 'bkong' && meld.tiles.length === 4"
        class="absolute -top-2 w-10 h-7 flex items-center justify-center"
        :style="{ left: BKONG_LEFT + 'px' }"
      >
        <div class="rotate-90 drop-shadow-lg"><MahjongTile :tile="meld.tiles[3]" size="xs" /></div>
      </div>
    </template>
    <div v-else class="w-20 flex items-center justify-center text-[10px] text-slate-500">暗杠</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Meld } from '../types';
import { kindLabel } from '../tiles';
import MahjongTile from './MahjongTile.vue';

const props = defineProps<{ meld: Meld }>();

// xs 牌宽 28px：侧牌中心对准第 3 张（索引 2）中心
const BKONG_LEFT = 2 * 28 + 14 - 20;

/** 暗杠：首尾扣置（背面）+ 中间亮牌，呈真实暗杠摆法 */
const tiles = computed<Array<number | null>>(() => {
  const m = props.meld;
  if (m.type === 'akong') {
    return m.tiles.map((t, i) => (i === 0 || i === 3 ? null : t));
  }
  return m.tiles.slice(0, 3);
});

const label = computed(() => {
  const m = props.meld;
  const head = { chi: '吃', pong: '碰', mkong: '明杠', akong: '暗杠', bkong: '补杠' }[m.type];
  return head + ' ' + m.tiles.map((t) => kindLabel(t >> 2)).join(' ');
});
</script>
