<!-- 中央牌池：四方位弃牌河（左右两侧横向侧躺，仿真实牌桌视角）+ 局信息胶囊 -->
<template>
  <div class="relative pointer-events-none select-none w-[min(660px,66vw)] h-[min(370px,50vh)]">
    <!-- 桌心区域 -->
    <div class="absolute inset-0 rounded-[30px] border border-emerald-200/10 bg-black/15 shadow-[inset_0_0_50px_rgba(0,0,0,0.35)]"></div>

    <!-- 对家弃牌（上） -->
    <div class="absolute top-2 inset-x-0 flex justify-center">
      <div class="flex flex-col gap-[3px] items-start">
        <div v-for="(row, r) in chunk(topRiver, 7)" :key="'t' + r" class="flex gap-[3px]">
          <MahjongTile
            v-for="(t, i) in row"
            :key="t + '-' + i"
            :tile="t"
            size="xs"
            :class="isLast('top', topRiver, r, i) ? 'tile-last' : ''"
          />
        </div>
      </div>
    </div>

    <!-- 我方弃牌（下） -->
    <div class="absolute bottom-2 inset-x-0 flex justify-center">
      <div class="flex flex-col-reverse gap-[3px] items-start">
        <div v-for="(row, r) in chunk(bottomRiver, 7)" :key="'b' + r" class="flex gap-[3px]">
          <MahjongTile
            v-for="(t, i) in row"
            :key="t + '-' + i"
            :tile="t"
            size="xs"
            :class="isLast('bottom', bottomRiver, r, i) ? 'tile-last' : ''"
          />
        </div>
      </div>
    </div>

    <!-- 上家弃牌（左，侧躺朝向牌桌） -->
    <div class="absolute left-2 top-1/2 -translate-y-1/2 flex gap-[3px]">
      <div v-for="(col, c) in chunk(leftRiver, 6)" :key="'l' + c" class="flex flex-col gap-[3px]">
        <div v-for="(t, i) in col" :key="t + '-' + i" class="w-[2.45rem] h-7 flex items-center justify-center">
          <div class="rotate-90">
            <MahjongTile :tile="t" size="xs" :class="isLastFlat('left', leftRiver, c, i) ? 'tile-last' : ''" />
          </div>
        </div>
      </div>
    </div>

    <!-- 下家弃牌（右，侧躺朝向牌桌：镜像旋转，最新牌靠中央） -->
    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex flex-row-reverse gap-[3px]">
      <div v-for="(col, c) in chunk(rightRiver, 6)" :key="'r' + c" class="flex flex-col gap-[3px]">
        <div v-for="(t, i) in col" :key="t + '-' + i" class="w-[2.45rem] h-7 flex items-center justify-center">
          <div class="-rotate-90">
            <MahjongTile :tile="t" size="xs" :class="isLastFlat('right', rightRiver, c, i) ? 'tile-last' : ''" />
          </div>
        </div>
      </div>
    </div>

    <!-- 中央信息胶囊 -->
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
      <div class="flex items-center gap-1.5 text-[11px]">
        <span class="pool-chip">第 {{ handNo }} 局</span>
        <span class="pool-chip">余 {{ wallCount }} 张</span>
        <span class="pool-chip">底分 {{ base }}</span>
      </div>
      <div
        v-if="title"
        class="text-xl font-black tracking-[0.3em] drop-shadow-lg whitespace-nowrap"
        :class="highlight ? 'text-amber-300 [text-shadow:0_0_18px_rgba(252,211,77,0.6)]' : 'text-emerald-50/85'"
      >
        {{ title }}
      </div>
      <div v-if="sub" class="text-[11px] text-emerald-100/55 whitespace-nowrap">{{ sub }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MahjongTile from './MahjongTile.vue';

const props = withDefaults(defineProps<{
  /** 四方位弃牌河（旧 → 新），已按观察者方位重排 */
  top?: number[];
  left?: number[];
  right?: number[];
  bottom?: number[];
  /** 最近打出的牌（用于高亮） */
  lastTile?: number;
  lastDir?: 'top' | 'left' | 'right' | 'bottom' | '';
  handNo?: number;
  wallCount?: number;
  base?: number;
  title?: string;
  sub?: string;
  /** 中央标题是否高亮（轮到我行动） */
  highlight?: boolean;
}>(), {
  top: () => [],
  left: () => [],
  right: () => [],
  bottom: () => [],
  lastTile: -1,
  lastDir: '',
  handNo: 0,
  wallCount: 0,
  base: 0,
  title: '',
  sub: '',
  highlight: false,
});

// 河位容量控制：超过只保留最近的牌，保证中央区不溢出
const MAX_FLAT = 14;
const MAX_SIDE = 12;
const topRiver = computed(() => props.top.slice(-MAX_FLAT));
const bottomRiver = computed(() => props.bottom.slice(-MAX_FLAT));
const leftRiver = computed(() => props.left.slice(-MAX_SIDE));
const rightRiver = computed(() => props.right.slice(-MAX_SIDE));

/** 按每行 n 张切块 */
function chunk(arr: number[], n: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < arr.length; i += n) rows.push(arr.slice(i, i + n));
  return rows;
}

function isLast(dir: string, river: number[], rowIdx: number, i: number): boolean {
  if (props.lastDir !== dir || props.lastTile < 0 || river.length === 0) return false;
  return river[river.length - 1] === riverAt(river, rowIdx, i);
}
function riverAt(river: number[], rowIdx: number, i: number): number {
  const rows = chunk(river, 7);
  return rows[rowIdx]?.[i] ?? -1;
}
function isLastFlat(dir: string, river: number[], colIdx: number, i: number): boolean {
  if (props.lastDir !== dir || props.lastTile < 0 || river.length === 0) return false;
  const cols = chunk(river, 6);
  return river[river.length - 1] === (cols[colIdx]?.[i] ?? -1);
}
</script>

<style scoped>
.pool-chip {
  @apply px-2 py-0.5 rounded-full border border-emerald-200/15 bg-black/30 text-emerald-50/75 whitespace-nowrap;
}
.tile-last {
  transform: scale(1.18);
  filter: drop-shadow(0 0 5px rgba(252, 211, 77, 0.95)) drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5));
}
</style>
