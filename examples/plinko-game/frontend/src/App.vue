<template>
  <div class="min-h-screen bg-[#0b0f18] px-3 py-3 text-slate-100 sm:px-5">
    <div class="mx-auto w-full max-w-6xl">
      <header class="mb-3 flex h-14 items-center justify-between rounded-xl border border-white/5 bg-[#111826] px-3">
        <div class="flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-slate-400 transition hover:text-white"
            title="返回大厅"
            @click="exitToLobby"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          </button>
          <div class="min-w-0">
            <div class="truncate text-base font-bold text-white">Plinko</div>
            <div class="text-[11px] text-slate-500">休闲弹珠</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            :class="connected ? 'bg-emerald-400' : 'bg-red-500'"
            class="h-2 w-2 rounded-full"
            :title="connected ? '已连接' : '未连接'"
          ></span>
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
      <div v-if="sessionOver" role="alert" class="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">本局已结束。</div>
      <div v-if="errorBar" role="alert" class="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{{ errorBar }}</div>

      <main class="grid gap-3 lg:grid-cols-[310px_minmax(0,1fr)]">
        <section class="order-last rounded-xl border border-white/5 bg-[#111826] p-3 lg:order-none">
          <div class="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-black/25 p-1">
            <button
              type="button"
              :class="playMode === 'manual' ? 'bg-[#223047] text-white' : 'text-slate-500 hover:text-slate-300'"
              class="rounded-md py-2 text-sm font-semibold transition"
              @click="selectMode('manual')"
            >手动</button>
            <button
              type="button"
              :class="playMode === 'auto' ? 'bg-[#223047] text-white' : 'text-slate-500 hover:text-slate-300'"
              class="rounded-md py-2 text-sm font-semibold transition"
              @click="selectMode('auto')"
            >自动</button>
          </div>

          <label class="mb-1.5 block text-xs font-medium text-slate-500" for="bet">下注金额</label>
          <div class="mb-3 flex items-center rounded-lg border border-white/8 bg-[#172033]">
            <span class="px-3 text-xs text-slate-500">金币</span>
            <input
              id="bet"
              class="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-right font-semibold text-white outline-none"
              :value="bet"
              readonly
            >
          </div>
          <div class="mb-4 grid grid-cols-5 gap-1">
            <button
              v-for="amount in bets" :key="amount" type="button"
              :class="bet === amount ? 'border-[#38567f] bg-[#243653] text-white' : 'border-transparent bg-black/25 text-slate-500 hover:text-slate-200'"
              class="rounded-md border py-1.5 text-[11px] font-semibold transition"
              @click="bet=amount"
            >{{ amount }}</button>
          </div>

          <div class="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label class="mb-1.5 block text-xs font-medium text-slate-500" for="risk">风险</label>
              <select
                id="risk" v-model="risk" :disabled="configLocked"
                class="w-full rounded-lg border border-white/8 bg-[#172033] px-2 py-2.5 text-sm text-white outline-none focus:border-[#41618d] disabled:opacity-50"
              >
                <option v-for="level in risks" :key="level" :value="level">{{ riskLabel[level] }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-medium text-slate-500" for="rows">行数</label>
              <select
                id="rows" v-model.number="rows" :disabled="configLocked"
                class="w-full rounded-lg border border-white/8 bg-[#172033] px-2 py-2.5 text-sm text-white outline-none focus:border-[#41618d] disabled:opacity-50"
              >
                <option v-for="option in rowOptions" :key="option" :value="option">{{ option }} 行</option>
              </select>
            </div>
          </div>

          <div v-if="playMode === 'auto'" class="mb-3">
            <label class="mb-1.5 block text-xs font-medium text-slate-500" for="auto-count">投放次数</label>
            <select
              id="auto-count" v-model.number="autoCount" :disabled="autoRunning"
              class="w-full rounded-lg border border-white/8 bg-[#172033] px-2 py-2.5 text-sm text-white outline-none focus:border-[#41618d] disabled:opacity-50"
            >
              <option :value="10">10 次</option>
              <option :value="25">25 次</option>
              <option :value="50">50 次</option>
              <option :value="100">100 次</option>
            </select>
          </div>

          <div class="mb-3 flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-xs">
            <span class="text-slate-500">最高可赢</span>
            <span class="font-bold text-amber-200">{{ maxWin.toLocaleString('zh-CN') }}</span>
          </div>

          <div class="mb-3 grid grid-cols-2 gap-2">
            <div class="rounded-lg bg-black/25 px-3 py-2">
              <div class="text-[10px] text-slate-500">上局倍数</div>
              <div class="text-sm font-bold text-white">{{ lastResult ? multiplierText(lastResult.multiplier) : '--' }}</div>
            </div>
            <div class="rounded-lg bg-black/25 px-3 py-2">
              <div class="text-[10px] text-slate-500">上局返还</div>
              <div :class="lastResult && lastResult.win > lastResult.bet ? 'text-emerald-300' : 'text-white'" class="text-sm font-bold">{{ lastResult ? '+' + lastResult.win.toLocaleString('zh-CN') : '--' }}</div>
            </div>
          </div>

          <button
            v-if="playMode === 'manual'"
            type="button"
            :disabled="!canDrop"
            class="w-full rounded-lg bg-[#00e701] py-3 text-sm font-bold text-[#062012] transition enabled:hover:bg-[#19f025] enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            @click="drop"
          >投放弹珠</button>
          <button
            v-else
            type="button"
            :disabled="!canDrop && !autoRunning"
            :class="autoRunning ? 'bg-[#e63946] text-white enabled:hover:bg-[#ef4d59]' : 'bg-[#00e701] text-[#062012] enabled:hover:bg-[#19f025]'"
            class="w-full rounded-lg py-3 text-sm font-bold transition enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            @click="toggleAuto"
          >{{ autoRunning ? `停止 (${autoRemaining})` : '开始自动' }}</button>

          <p v-if="configLocked" class="mt-2 text-center text-[11px] text-slate-500">弹珠落定后可调整风险和行数</p>
        </section>

        <section class="order-first overflow-hidden rounded-xl border border-white/5 bg-[#0d1421] p-2 sm:p-3 lg:order-none">
          <div class="mb-2 flex h-9 items-center gap-1.5 overflow-hidden rounded-lg bg-black/25 px-2">
            <span class="shrink-0 text-[11px] text-slate-600">最近</span>
            <span
              v-for="item in recentResults" :key="item.roundId"
              :class="multiplierClass(item.multiplier)"
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
            >{{ multiplierText(item.multiplier) }}</span>
            <span v-if="recentResults.length === 0" class="text-[11px] text-slate-600">暂无记录</span>
          </div>
          <canvas ref="boardRef" class="block h-[44vh] min-h-[300px] w-full sm:h-[58vh] sm:min-h-[420px] lg:h-[min(66vh,620px)]" aria-label="Plinko 游戏区域"></canvas>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { notifyGameExit, requestHostGameConfig } from '@game-platform/frontend-sdk'
import { createPlinkoClient, type PlinkoInit, type PlinkoResult, type PlinkoRisk } from './game'

const riskLabel: Record<PlinkoRisk, string> = { low: '低', medium: '中', high: '高' }

const boardRef = ref<HTMLCanvasElement | null>(null)
const clientRef = ref<ReturnType<typeof createPlinkoClient> | null>(null)
const init = ref<PlinkoInit | null>(null)
const connected = ref(false)
const reconnecting = ref(false)
const connectionLost = ref(false)
const sessionOver = ref(false)
const configError = ref('')
const errorBar = ref('')
const myPlayerId = ref('')
const balance = ref<number | null>(null)
const balanceVersion = ref(0)
const rows = ref(16)
const risk = ref<PlinkoRisk>('medium')
const bet = ref(10)
const feed = ref<PlinkoResult[]>([])
const lastResult = ref<PlinkoResult | null>(null)
const spectating = ref(false)
const animating = ref(false)
const playMode = ref<'manual' | 'auto'>('manual')
const autoRunning = ref(false)
const autoRemaining = ref(0)
const autoCount = ref(10)
let autoTimer: number | undefined

const bets = computed(() => init.value?.rules.bets ?? [10, 50, 100, 500, 1000])
const risks = computed(() => init.value?.rules.risks ?? ['low', 'medium', 'high'] as PlinkoRisk[])
const rowOptions = computed(() => init.value?.rules.rows ?? [8, 12, 16])
const currentPayouts = computed(() => init.value?.rules.boards[`${risk.value}:${rows.value}`] ?? [])
const canDrop = computed(() => connected.value && !sessionOver.value && !configError.value && !spectating.value)
const configLocked = computed(() => animating.value)
const recentResults = computed(() => feed.value.slice(0, 10))
const maxWin = computed(() => Math.max(...currentPayouts.value, 0) * bet.value)

interface Ball {
  result: PlinkoResult
  start: number
  duration: number
}
let balls: Ball[] = []
let rafId = 0

function applyBalance(nextBalance: number, version: number): void {
  if (version > 0 && version < balanceVersion.value) return
  if (version > 0) balanceVersion.value = version
  balance.value = nextBalance
}

function raiseBalanceVersion(version: number): void {
  if (version > balanceVersion.value) balanceVersion.value = version
}

function translateError(message: string): string {
  const value = message.toLowerCase()
  if (value.includes('insufficient balance')) return '余额不足'
  if (value.includes('round')) return '下注失败，请重试'
  if (value.includes('invalid') || value.includes('无效')) return '下注参数无效'
  return message
}

function makeDropId(): string {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `d-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function selectMode(mode: 'manual' | 'auto'): void {
  // Leaving auto through the tab should also stop the running loop; otherwise
  // the manual button appears while drops continue in the background.
  if (mode === 'manual' && autoRunning.value) stopAuto()
  playMode.value = mode
}

function drop(): void {
  if (!canDrop.value || !clientRef.value) return
  if (balance.value !== null && balance.value < bet.value) {
    stopAuto()
    errorBar.value = '余额不足'
    return
  }
  errorBar.value = ''
  if (autoRunning.value) {
    autoRemaining.value--
    if (autoRemaining.value <= 0) {
      if (autoTimer) window.clearInterval(autoTimer)
      autoTimer = undefined
      autoRunning.value = false
    }
  }
  clientRef.value.sendAction('drop', { dropId: makeDropId(), rows: rows.value, risk: risk.value, bet: bet.value })
}

function startAuto(): void {
  if (!canDrop.value) return
  autoRemaining.value = autoCount.value
  autoRunning.value = true
  drop()
  autoTimer = window.setInterval(() => {
    if (autoRemaining.value <= 0 || !canDrop.value) {
      stopAuto()
      return
    }
    drop()
  }, 380)
}

function stopAuto(): void {
  if (autoTimer) window.clearInterval(autoTimer)
  autoTimer = undefined
  autoRunning.value = false
  autoRemaining.value = 0
}

function toggleAuto(): void {
  if (autoRunning.value) stopAuto()
  else startAuto()
}

function spawnBall(result: PlinkoResult): void {
  balls.push({ result, start: performance.now(), duration: 430 + result.rows * 62 })
  animating.value = true
  if (!rafId) rafId = requestAnimationFrame(renderFrame)
}

function renderFrame(now: number): void {
  const keepAlive: Ball[] = []
  for (const ball of balls) {
    if (now - ball.start < ball.duration + 140) keepAlive.push(ball)
  }
  balls = keepAlive
  animating.value = balls.length > 0
  drawBoard()
  if (balls.length) rafId = requestAnimationFrame(renderFrame)
  else rafId = 0
}

function multiplierClass(multiplier: number): string {
  if (multiplier >= 10) return 'bg-[#7f1d3a] text-[#ffb2c8]'
  if (multiplier >= 2) return 'bg-[#7c4a12] text-amber-200'
  if (multiplier >= 1) return 'bg-[#155e75] text-cyan-200'
  return 'bg-[#313d5f] text-slate-300'
}

function multiplierText(multiplier: number): string {
  return multiplier >= 1000 ? '1k' : `${multiplier}`
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function slotColor(multiplier: number): [string, string] {
  if (multiplier >= 10) return ['#e25477', '#8c1d3f']
  if (multiplier >= 2) return ['#f0a44a', '#96590f']
  if (multiplier >= 1) return ['#56b7d4', '#1c6480']
  return ['#8794b8', '#3b476c']
}

function drawBoard(): void {
  const canvas = boardRef.value
  if (!canvas) return
  const clientWidth = canvas.clientWidth
  const clientHeight = canvas.clientHeight
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const targetWidth = Math.max(1, Math.floor(clientWidth * dpr))
  const targetHeight = Math.max(1, Math.floor(clientHeight * dpr))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }
  const ctx = canvas.getContext('2d')
  if (!ctx || !clientWidth || !clientHeight) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, clientWidth, clientHeight)

  const n = rows.value
  const spacing = (clientWidth * .84) / n
  const boardTop = clientHeight * .06
  const boardBottom = clientHeight * .78
  const slotTop = clientHeight * .82
  const slotHeight = Math.min(36, clientHeight * .07)
  const pegRadius = Math.max(2, Math.min(4.4, spacing * .08))

  for (let r = 0; r < n; r++) {
    const count = r + 2
    const y = boardTop + ((r + 1) / n) * (boardBottom - boardTop)
    for (let j = 0; j < count; j++) {
      const x = clientWidth / 2 + (j - (r + 1) / 2) * spacing
      ctx.fillStyle = '#5d6b8a'
      ctx.beginPath()
      ctx.arc(x, y, pegRadius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const activeSlots = new Map<number, number>()
  for (const ball of balls) {
    const progress = Math.min(1, (performance.now() - ball.start) / ball.duration)
    if (ball.result.rows === n && progress > .84) {
      const intensity = (progress - .84) / .16
      activeSlots.set(ball.result.slot, Math.max(activeSlots.get(ball.result.slot) ?? 0, intensity))
    }
  }

  const payouts = currentPayouts.value
  const slotW = Math.min(spacing * .87, clientWidth / (n + 1.25))
  const fontSize = Math.max(8, Math.min(13, slotW / (n > 12 ? 4.4 : 3.5)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`
  payouts.forEach((multiplier, slot) => {
    const x = clientWidth / 2 + (slot - n / 2) * spacing - slotW / 2
    const [light, dark] = slotColor(multiplier)
    const gradient = ctx.createLinearGradient(0, slotTop, 0, slotTop + slotHeight)
    gradient.addColorStop(0, light)
    gradient.addColorStop(1, dark)
    ctx.fillStyle = gradient
    roundedRect(ctx, x, slotTop, slotW, slotHeight, Math.min(7, slotW / 3))
    ctx.fill()
    const active = activeSlots.get(slot) ?? 0
    if (active > 0) {
      ctx.fillStyle = `rgba(255,255,255,${.12 + active * .22})`
      roundedRect(ctx, x, slotTop, slotW, slotHeight, Math.min(7, slotW / 3))
      ctx.fill()
      ctx.strokeStyle = `rgba(255,255,255,${.25 + active * .5})`
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
    ctx.fillStyle = '#101521'
    ctx.fillText(multiplierText(multiplier), x + slotW / 2, slotTop + slotHeight / 2 + .5)
  })

  for (const ball of balls) {
    const result = ball.result
    const br = result.rows
    const bSpacing = (clientWidth * .84) / br
    const bTop = clientHeight * .06
    const bBottom = clientHeight * .78
    const progress = Math.min(1, (performance.now() - ball.start) / ball.duration)
    const points: Array<[number, number]> = [[clientWidth / 2, clientHeight * .015]]
    let rights = 0
    for (let r = 0; r < br; r++) {
      rights += result.path[r] ?? 0
      points.push([
        clientWidth / 2 + (rights - (r + 1) / 2) * bSpacing,
        bTop + ((r + 1) / br) * (bBottom - bTop),
      ])
    }
    points.push([
      clientWidth / 2 + (result.slot - br / 2) * bSpacing,
      slotTop + slotHeight / 2,
    ])

    const segment = progress * (points.length - 1)
    const index = Math.min(points.length - 2, Math.floor(segment))
    const local = segment - index
    const eased = index === points.length - 2 ? 1 - Math.pow(1 - local, 2.15) : local * local * (3 - 2 * local)
    const x0 = points[index][0]
    const y0 = points[index][1]
    const x1 = points[index + 1][0]
    const y1 = points[index + 1][1]
    const x = x0 + (x1 - x0) * eased
    const y = y0 + (y1 - y0) * eased
    const radius = Math.max(4.5, Math.min(9, spacing * .15))
    ctx.fillStyle = 'rgba(255,176,64,.16)'
    ctx.beginPath()
    ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2)
    ctx.fill()
    const body = ctx.createRadialGradient(x - radius * .25, y - radius * .3, radius * .15, x, y, radius)
    body.addColorStop(0, '#fff4d6')
    body.addColorStop(.5, '#ffaf3c')
    body.addColorStop(1, '#c96810')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
}

function exitToLobby(): void {
  notifyGameExit()
}

function mergeResultHistory(incoming: PlinkoResult[]): void {
  const byRound = new Map<string, PlinkoResult>()
  for (const item of incoming) if (item.roundId) byRound.set(item.roundId, item)
  for (const item of feed.value) if (item.roundId && !byRound.has(item.roundId)) byRound.set(item.roundId, item)
  feed.value = Array.from(byRound.values()).sort((a, b) => b.at - a.at).slice(0, 12)
}

onMounted(async () => {
  let config
  try {
    config = await requestHostGameConfig({ timeoutMs: 6000 })
  } catch {
    configError.value = '游戏加载失败，请从大厅重新进入'
    return
  }

  spectating.value = Boolean(config.spectate)
  const client = createPlinkoClient(config, {
    onInit(payload) {
      init.value = payload
      connected.value = true
      reconnecting.value = false
      connectionLost.value = false
      if (payload.playerId) myPlayerId.value = payload.playerId
      if (typeof payload.balance === 'number' && ((payload.version ?? 0) > 0 || payload.balanceKnown === true)) {
        applyBalance(payload.balance, payload.version ?? 0)
      }
      mergeResultHistory(payload.history || [])
      nextTick(drawBoard)
    },
    onResult(payload) {
      feed.value = [payload, ...feed.value].slice(0, 12)
      if (payload.playerId !== myPlayerId.value) return
      lastResult.value = payload
      if (payload.version) raiseBalanceVersion(payload.version)
      errorBar.value = ''
      spawnBall(payload)
    },
    onBalance(next, version) { applyBalance(next, version) },
    onError(message) {
      errorBar.value = translateError(message)
      stopAuto()
    },
    onDisconnect() {
      connected.value = false
      reconnecting.value = true
      connectionLost.value = false
      stopAuto()
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
      stopAuto()
    },
    onFinished() {
      sessionOver.value = true
      stopAuto()
    },
  })

  clientRef.value = client
  let disposed = false
  const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))
  const establishConnection = async () => {
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
  void establishConnection()
  nextTick(drawBoard)

  onBeforeUnmount(() => {
    disposed = true
    stopAuto()
    if (rafId) cancelAnimationFrame(rafId)
    window.removeEventListener('resize', drawBoard)
    ;(client as any).__plinkoDispose?.()
    client.disconnect()
  })
})

watch([rows, risk, currentPayouts], () => nextTick(drawBoard))
window.addEventListener('resize', drawBoard)
</script>
