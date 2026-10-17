<template>
  <div class="min-h-screen bg-[#0b0f18] px-3 py-3 text-slate-100 sm:px-5">
    <div class="mx-auto w-full max-w-5xl">
      <header class="mb-3 flex h-14 items-center justify-between rounded-xl border border-white/5 bg-[#111826] px-3">
        <div class="flex min-w-0 items-center gap-2">
          <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-slate-400 transition hover:text-white" title="返回大厅" @click="exitToLobby">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          </button>
          <div class="min-w-0">
            <div class="truncate text-base font-bold text-white">2048</div>
            <div class="text-[11px] text-slate-500">数字合成</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span :class="connected ? 'bg-emerald-400' : 'bg-red-500'" class="h-2 w-2 rounded-full" :title="connected ? '已连接' : '未连接'"></span>
          <span v-if="spectating" class="rounded-md bg-white/10 px-2 py-1 text-[11px] text-slate-300">观战</span>
          <div class="rounded-lg border border-white/5 bg-[#172033] px-3 py-1.5 text-right" aria-live="polite">
            <div class="text-[10px] leading-3 text-slate-500">余额</div>
            <div class="text-sm font-bold text-white">{{ balance === null ? '--' : balance.toLocaleString('zh-CN') }}</div>
          </div>
        </div>
      </header>

      <div v-if="configError" role="alert" class="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{{ configError }}</div>
      <div v-if="reconnecting" role="alert" class="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">连接中，请稍候…</div>
      <div v-if="connectionLost" role="alert" class="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">连接已断开，请刷新页面。</div>
      <div v-if="sessionOver" role="alert" class="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">本局会话已结束。</div>
      <div v-if="errorBar" role="alert" class="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{{ errorBar }}</div>

      <main class="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section class="order-last rounded-xl border border-white/5 bg-[#111826] p-3 lg:order-none">
          <label class="mb-1.5 block text-xs font-medium text-slate-500">入场注档</label>
          <div class="mb-4 grid grid-cols-3 gap-1">
            <button
              v-for="amount in bets" :key="amount" type="button"
              :class="bet === amount ? 'border-[#38567f] bg-[#243653] text-white' : 'border-transparent bg-black/25 text-slate-500 hover:text-slate-200'"
              class="rounded-md border py-2 text-xs font-semibold transition"
              @click="bet=amount"
            >{{ amount }}</button>
          </div>

          <div class="mb-4 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-black/25 px-2 py-2">
              <div class="text-[10px] text-slate-500">分数</div>
              <div class="text-sm font-bold text-white">{{ currentGame?.score ?? 0 }}</div>
            </div>
            <div class="rounded-lg bg-black/25 px-2 py-2">
              <div class="text-[10px] text-slate-500">最高块</div>
              <div class="text-sm font-bold text-amber-200">{{ currentGame?.maxTile ?? 0 }}</div>
            </div>
            <div class="rounded-lg bg-black/25 px-2 py-2">
              <div class="text-[10px] text-slate-500">步数</div>
              <div class="text-sm font-bold text-white">{{ currentGame?.moves ?? 0 }}</div>
            </div>
          </div>

          <div class="mb-4 rounded-lg border border-white/5 bg-black/20 p-2">
            <div class="mb-1 px-1 text-[11px] font-semibold text-slate-500">达成返还</div>
            <div class="space-y-1">
              <div v-for="tier in tiers" :key="tier.maxTile" class="flex items-center justify-between rounded px-1.5 py-1 text-xs">
                <span :class="(currentGame?.maxTile ?? 0) >= tier.maxTile ? 'text-white' : 'text-slate-500'">{{ tier.maxTile }}</span>
                <span :class="(currentGame?.maxTile ?? 0) >= tier.maxTile ? 'text-emerald-300' : 'text-slate-400'">×{{ tier.multiplier }}</span>
              </div>
            </div>
          </div>

          <button
            v-if="phase === 'playing'"
            type="button"
            class="w-full rounded-lg bg-[#e63946] py-3 text-sm font-bold text-white transition hover:bg-[#ef4d59] active:translate-y-px"
            @click="confirming=true"
          >结束本局</button>
          <button
            v-else-if="phase === 'settling'"
            type="button"
            disabled
            class="w-full cursor-wait rounded-lg bg-white/8 py-3 text-sm font-bold text-slate-400"
          >结算中…</button>
          <button
            v-else
            type="button"
            :disabled="!canStart"
            class="w-full rounded-lg bg-[#00e701] py-3 text-sm font-bold text-[#062012] transition enabled:hover:bg-[#19f025] enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            @click="startGame"
          >{{ phase === 'over' ? '再来一局' : '开始游戏' }}</button>
          <p class="mt-2 text-center text-[11px] text-slate-500">方向键 / 滑动屏幕移动数字块</p>
        </section>

        <section class="order-first rounded-xl border border-white/5 bg-[#0d1421] p-3 lg:order-none">
          <div class="mx-auto w-full max-w-[560px]">
            <div class="board-surface relative overflow-hidden rounded-xl bg-[#bbada0] p-2 shadow-inner" aria-label="2048 棋盘" @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="pointerStart=null">
              <div class="grid aspect-square grid-cols-4 grid-rows-4 gap-2">
                <div v-for="index in 16" :key="index" class="rounded-md bg-[#cdc1b4]"></div>
              </div>

              <div class="pointer-events-none absolute inset-2">
                <div
                  v-for="tile in boardTiles" :key="tile.id"
                  class="absolute flex items-center justify-center rounded-md font-extrabold shadow-sm transition-all duration-100 ease-out"
                  :class="tile.state === 'merge' ? 'scale-105' : tile.state === 'spawn' ? 'scale-90' : 'scale-100'"
                  :style="tileStyle(tile)"
                >{{ tile.value }}</div>
              </div>

              <div v-if="phase !== 'playing'" class="absolute inset-0 flex items-center justify-center bg-[#0b0f18]/78 p-4 backdrop-blur-[2px]">
                <div class="w-full max-w-64 rounded-xl border border-white/10 bg-[#111826]/95 p-4 text-center">
                  <div class="text-lg font-bold text-white">{{ overlayTitle }}</div>
                  <div v-if="phase === 'over' && lastResult" class="mt-2 space-y-1 text-xs text-slate-400">
                    <div>最高数字：<span class="font-bold text-amber-200">{{ lastResult.maxTile }}</span></div>
                    <div>本局分数：<span class="font-bold text-white">{{ lastResult.score.toLocaleString('zh-CN') }}</span></div>
                    <div>返还：<span v-if="lastResult.committed" :class="lastResult.payout > 0 ? 'font-bold text-emerald-300' : 'font-bold text-slate-300'">{{ lastResult.payout }}</span><span v-else class="font-bold text-amber-300">结算处理中</span></div>
                  </div>
                  <button
                    v-if="!spectating && phase === 'settling'"
                    type="button" disabled
                    class="mt-3 w-full cursor-wait rounded-lg bg-white/8 py-2.5 text-sm font-bold text-slate-400"
                  >结算中…</button>
                  <button
                    v-else-if="!spectating"
                    type="button" :disabled="!canStart"
                    class="mt-3 w-full rounded-lg bg-[#00e701] py-2.5 text-sm font-bold text-[#062012] transition enabled:hover:bg-[#19f025] disabled:opacity-40"
                    @click="startGame"
                  >{{ phase === 'over' ? '再来一局' : '开始游戏' }}</button>
                  <div v-if="spectating" class="mt-3 text-xs text-slate-500">当前为观战模式</div>
                </div>
              </div>

              <div v-if="confirming" class="absolute inset-0 flex items-center justify-center bg-[#0b0f18]/80 p-4">
                <div class="w-full max-w-64 rounded-xl border border-white/10 bg-[#111826] p-4 text-center">
                  <div class="text-base font-bold text-white">结束本局？</div>
                  <p class="mt-1 text-xs text-slate-500">将按当前最高数字结算。</p>
                  <div class="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" class="rounded-lg bg-white/8 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/12" @click="confirming=false">取消</button>
                    <button type="button" class="rounded-lg bg-[#e63946] py-2 text-sm font-bold text-white transition hover:bg-[#ef4d59]" @click="giveUp">确认</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { notifyGameExit, requestHostGameConfig } from '@game-platform/frontend-sdk'
import {
  createGame2048Client,
  type CurrentGame,
  type Game2048Config,
  type Game2048Result,
  type Game2048State,
  type MoveDirection,
  type MovePayload,
} from './game'

interface Tile {
  id: number
  value: number
  index: number
  state: '' | 'merge' | 'spawn'
}

const clientRef = ref<ReturnType<typeof createGame2048Client> | null>(null)
const connected = ref(false)
const reconnecting = ref(false)
const connectionLost = ref(false)
const sessionOver = ref(false)
const spectating = ref(false)
const configError = ref('')
const errorBar = ref('')
const balance = ref<number | null>(null)
const balanceVersion = ref(0)
const phase = ref<'idle' | 'playing' | 'settling' | 'over'>('idle')
const rules = ref<Game2048Config>({ rows: 4, cols: 4, bets: [10, 50, 100], targetTile: 2048, tiers: [] })
const currentGame = ref<CurrentGame | null>(null)
const lastResult = ref<Game2048Result | null>(null)
const bet = ref(10)
const boardTiles = ref<Tile[]>([])
const confirming = ref(false)
let tileId = 0
let moveLock = false
let pendingMoveId = 0
let moveSerial = 0
let animationTimers: number[] = []

const bets = computed(() => rules.value.bets)
const tiers = computed(() => rules.value.tiers)
const canStart = computed(() => connected.value && !configError.value && !sessionOver.value && !spectating.value)
const overlayTitle = computed(() => {
  if (spectating.value) return '观战中'
  if (phase.value === 'settling') return '结算中'
  if (phase.value === 'over') return '本局结束'
  return '准备开始'
})

function later(callback: () => void, ms: number): void {
  const timer = window.setTimeout(() => {
    animationTimers = animationTimers.filter(id => id !== timer)
    callback()
  }, ms)
  animationTimers.push(timer)
}

function applyBalance(next: number, version: number): void {
  if (version > 0 && version < balanceVersion.value) return
  if (version > 0) balanceVersion.value = version
  balance.value = next
}

function raiseVersion(version?: number): void {
  if (version && version > balanceVersion.value) balanceVersion.value = version
}

function buildTiles(board: number[]): void {
  boardTiles.value = board
    .map((value, index) => ({ value, index }))
    .filter(item => item.value > 0)
    .map(item => ({ id: ++tileId, value: item.value, index: item.index, state: 'spawn' as const }))
  later(() => {
    boardTiles.value = boardTiles.value.map(tile => ({ ...tile, state: '' }))
  }, 120)
}

function applyTransition(payload: MovePayload): void {
  const transition = payload.transition
  const bySource = new Map(boardTiles.value.map(tile => [tile.index, tile]))
  for (const move of transition.moves) {
    const tile = bySource.get(move.from)
    if (tile) tile.index = move.to
  }
  boardTiles.value = boardTiles.value.map(tile => ({ ...tile }))

  later(() => {
    const mergeTargets = new Set(transition.merges.map(item => item.to))
    const movedTiles = boardTiles.value
    const next: Tile[] = []
    transition.afterMove.forEach((value, index) => {
      if (!value) return
      const merged = mergeTargets.has(index)
      const source = movedTiles.find(tile => tile.index === index && tile.value === value)
      next.push({
        id: merged ? ++tileId : source?.id ?? ++tileId,
        value,
        index,
        state: merged ? 'merge' : '',
      })
    })
    boardTiles.value = next

    later(() => {
      if (transition.spawn) {
        boardTiles.value = [...boardTiles.value, {
          id: ++tileId,
          value: transition.spawn.value,
          index: transition.spawn.index,
          state: 'spawn',
        }]
      }
      later(() => {
        boardTiles.value = boardTiles.value.map(tile => ({ ...tile, state: '' }))
        moveLock = false
      }, 110)
    }, 70)
  }, 105)
}

function tileAppearance(value: number): { bg: string; color: string; size: string } {
  const map: Record<number, { bg: string; color: string; size: string }> = {
    2: { bg: '#eee4da', color: '#776e65', size: 'clamp(24px, 8vw, 42px)' },
    4: { bg: '#ede0c8', color: '#776e65', size: 'clamp(24px, 8vw, 42px)' },
    8: { bg: '#f2b179', color: '#ffffff', size: 'clamp(24px, 8vw, 42px)' },
    16: { bg: '#f59563', color: '#ffffff', size: 'clamp(22px, 7.5vw, 38px)' },
    32: { bg: '#f67c5f', color: '#ffffff', size: 'clamp(22px, 7.5vw, 38px)' },
    64: { bg: '#f65e3b', color: '#ffffff', size: 'clamp(22px, 7.5vw, 38px)' },
    128: { bg: '#edcf72', color: '#ffffff', size: 'clamp(19px, 6.5vw, 34px)' },
    256: { bg: '#edcc61', color: '#ffffff', size: 'clamp(19px, 6.5vw, 34px)' },
    512: { bg: '#edc850', color: '#ffffff', size: 'clamp(19px, 6.5vw, 34px)' },
    1024: { bg: '#edc53f', color: '#ffffff', size: 'clamp(16px, 5.5vw, 29px)' },
    2048: { bg: '#edc22e', color: '#ffffff', size: 'clamp(16px, 5.5vw, 29px)' },
  }
  return map[value] ?? { bg: '#3c3a32', color: '#ffffff', size: 'clamp(15px, 5vw, 26px)' }
}

function tileStyle(tile: Tile): Record<string, string> {
  const row = Math.floor(tile.index / 4)
  const col = tile.index % 4
  const appearance = tileAppearance(tile.value)
  const unit = 'calc((100% - 24px) / 4)'
  return {
    left: `calc(${col} * (${unit} + 8px))`,
    top: `calc(${row} * (${unit} + 8px))`,
    width: unit,
    height: unit,
    background: appearance.bg,
    color: appearance.color,
    fontSize: appearance.size,
  }
}

function startGame(): void {
  if (!canStart.value || !clientRef.value || phase.value === 'playing' || phase.value === 'settling') return
  // No client balance precheck: the wallet's settlement result is authoritative.
  errorBar.value = ''
  confirming.value = false
  clientRef.value.sendAction('start_game', { bet: bet.value })
}

function giveUp(): void {
  confirming.value = false
  clientRef.value?.sendAction('give_up', {})
}

function move(direction: MoveDirection): void {
  if (phase.value !== 'playing' || moveLock || !clientRef.value) return
  const moveId = ++moveSerial
  pendingMoveId = moveId
  moveLock = true
  clientRef.value.sendAction('move', { direction, moveId })
  later(() => {
    if (pendingMoveId !== moveId) return
    pendingMoveId = 0
    moveLock = false
    clientRef.value?.sync()
  }, 1200)
}

function handleKey(event: KeyboardEvent): void {
  const map: Record<string, MoveDirection> = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
  }
  const direction = map[event.key]
  if (!direction || phase.value !== 'playing') return
  event.preventDefault()
  move(direction)
}

let pointerStart: { x: number; y: number } | null = null
function pointerDown(event: PointerEvent): void {
  pointerStart = { x: event.clientX, y: event.clientY }
}
function pointerUp(event: PointerEvent): void {
  if (!pointerStart || phase.value !== 'playing') return
  const dx = event.clientX - pointerStart.x
  const dy = event.clientY - pointerStart.y
  pointerStart = null
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
  if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left')
  else move(dy > 0 ? 'down' : 'up')
}

function applyState(state: Game2048State): void {
  if (state.config) rules.value = state.config
  if (state.phase) phase.value = state.phase
  if (state.game) {
    currentGame.value = state.game
    if (!moveLock) buildTiles(state.game.board)
  } else if (state.phase !== 'playing') {
    currentGame.value = null
  }
  if (state.lastResult) lastResult.value = state.lastResult
}

function exitToLobby(): void {
  notifyGameExit()
}

onMounted(async () => {
  window.addEventListener('keydown', handleKey)
  let config
  try {
    config = await requestHostGameConfig({ timeoutMs: 6000 })
  } catch {
    configError.value = '游戏加载失败，请从大厅重新进入'
    return
  }
  spectating.value = Boolean(config.spectate)
  const client = createGame2048Client(config, {
    onState(state) {
      connected.value = true
      reconnecting.value = false
      connectionLost.value = false
      applyState(state)
      if (typeof state.balance === 'number' && ((state.version ?? 0) > 0 || state.balanceKnown === true)) {
        applyBalance(state.balance, state.version ?? 0)
      }
    },
    onStart(payload) {
      phase.value = 'playing'
      lastResult.value = null
      currentGame.value = { no: payload.gameNo, playerId: payload.playerId, bet: payload.bet, board: payload.board, score: payload.score, moves: payload.moves, maxTile: payload.maxTile }
      buildTiles(payload.board)
      errorBar.value = ''
    },
    onMove(payload) {
      pendingMoveId = 0
      currentGame.value = {
        no: payload.gameNo,
        playerId: payload.playerId,
        bet: currentGame.value?.bet ?? bet.value,
        board: payload.board,
        score: payload.score,
        moves: payload.moves,
        maxTile: payload.maxTile,
      }
      applyTransition(payload)
      errorBar.value = ''
    },
    onSettling() {
      phase.value = 'settling'
      pendingMoveId = 0
      moveLock = true
    },
    onOver(result) {
      lastResult.value = result
      if (!result.committed) {
        phase.value = 'settling'
        clientRef.value?.sync()
        return
      }
      raiseVersion(result.version)
      later(() => {
        phase.value = 'over'
        moveLock = false
      }, 420)
    },
    onBalance(next, version) { applyBalance(next, version) },
    onError(message) {
      errorBar.value = message || '操作失败'
      pendingMoveId = 0
      moveLock = false
    },
    onDisconnect() {
      connected.value = false
      reconnecting.value = true
      connectionLost.value = false
    },
    onReconnect() {
      connected.value = true
      reconnecting.value = false
      connectionLost.value = false
      balanceVersion.value = 0
    },
    onReconnectFailed() {
      reconnecting.value = false
      connectionLost.value = true
    },
    onFinished() {
      sessionOver.value = true
    },
  })

  clientRef.value = client
  const syncWhenVisible = () => {
    if (document.visibilityState === 'visible' && client.isConnected()) client.sync()
  }
  document.addEventListener('visibilitychange', syncWhenVisible)
  let disposed = false
  const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))
  const establish = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (disposed) return
      try {
        reconnecting.value = true
        await client.connect()
        return
      } catch {
        if (attempt === 2) break
        await wait(1500)
      }
    }
    if (!disposed) {
      reconnecting.value = false
      connectionLost.value = true
      errorBar.value = '连接失败，请刷新页面重试'
    }
  }
  void establish()
  nextTick()

  onBeforeUnmount(() => {
    disposed = true
    window.removeEventListener('keydown', handleKey)
    document.removeEventListener('visibilitychange', syncWhenVisible)
    animationTimers.forEach(timer => window.clearTimeout(timer))
    ;(client as any).__game2048Dispose?.()
    client.disconnect()
  })
})
</script>
