import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Loads the exact goja IIFE bundle and exercises terminal wallet retries.
 * The fake platform follows the SDK contract: operations only take effect when
 * endRound commits, fair reveal precedes round closure, and timers are manual.
 */
function createPlatform() {
  const timers = new Map()
  let timerId = 0
  let roundId = 0
  let balanceVersion = 0
  let fairSeq = 0
  let failBeginRound = 0
  let failEndRound = 0
  const current = { id: 0, active: false, wallet: [], results: [] }
  const platform = {
    events: [],
    committedRounds: [],
    balance: 100,
    failFairIndexes: new Set(),
    fair: new Map(),
    players: [{ id: 'p1', name: 'Player' }],
    broadcast(event, data) { platform.events.push({ scope: 'all', event, data }) },
    sendTo(playerId, event, data) { platform.events.push({ scope: playerId, event, data }) },
    getGameState() { return undefined },
    setGameState() {},
    getPlayers() { return platform.players },
    isPlayerOnline() { return true },
    getBalance() { return platform.balance },
    getBalanceVersion() { return balanceVersion },
    beginFairRound(seedId) {
      const seed = `seed-${++fairSeq}`
      platform.fair.set(seedId, { seed, commitment: `commit-${seed}`, revealed: false })
      platform.events.push({ scope: 'all', event: 'fair:commitment', data: { seedId, commitment: `commit-${seed}` } })
      return `commit-${seed}`
    },
    getFairRandom(seedId, index) {
      if (platform.failFairIndexes.has(index)) return false
      const n = ((fairSeq * 1103515245 + index * 12345) % 2147483648) / 2147483648
      return (n + 0.5) % 1
    },
    revealFairRound(seedId) {
      const entry = platform.fair.get(seedId)
      if (!entry || entry.revealed) return false
      entry.revealed = true
      return { seed: entry.seed, commitment: entry.commitment, draws: 0 }
    },
    log() {},
    setTimeout(callback, delay) {
      const id = ++timerId
      timers.set(id, { callback, delay })
      return id
    },
    setInterval() { return 0 },
    clearTimer(id) { timers.delete(id) },
    fireTimer(id) {
      const timer = timers.get(id)
      assert.ok(timer, `timer ${id} exists`)
      timers.delete(id)
      timer.callback()
    },
    timerIds() { return [...timers.keys()] },
    failNextBeginRound() { failBeginRound++ },
    failNextEndRound() { failEndRound++ },
    beginRound() {
      if (failBeginRound > 0) {
        failBeginRound--
        return ''
      }
      current.id = ++roundId
      current.active = true
      current.wallet = []
      current.results = []
      return `round-${current.id}`
    },
    endRound() {
      if (!current.active) return false
      if (failEndRound > 0) {
        failEndRound--
        current.active = false
        current.wallet = []
        current.results = []
        return false
      }
      for (const op of current.wallet) {
        platform.balance += op.amount
        balanceVersion++
      }
      platform.committedRounds.push({ id: current.id, wallet: current.wallet, results: current.results })
      current.active = false
      return true
    },
    lastRoundError() { return failEndRound > 0 || failBeginRound > 0 ? 'injected failure' : '' },
    deductBalance(playerId, amount, description) {
      if (!current.active) return false
      current.wallet.push({ playerId, amount: -amount, description: String(description?.description || description) })
      return true
    },
    rewardBalance(playerId, amount, description) {
      if (!current.active) return false
      current.wallet.push({ playerId, amount, description: String(description?.description || description) })
      return true
    },
    recordResult(playerId, result, scoreDelta, meta) {
      if (!current.active) return false
      current.results.push({ playerId, result, scoreDelta, meta })
      return true
    },
  }
  return platform
}

function loadGame(platform) {
  const code = readFileSync(new URL('./backend/dist/game.js', import.meta.url), 'utf8')
  const context = { platform, console: { log() {} } }
  vm.createContext(context)
  vm.runInContext(code, context)
  assert.equal(typeof context.onInit, 'function')
  return context
}

function events(platform, name) {
  return platform.events.filter(item => item.event === name)
}

// 1. Transient endRound failure retains the run, retries, then publishes once.
{
  const platform = createPlatform()
  const game = loadGame(platform)
  game.onInit()
  game.onAction('p1', 'start_game', { bet: 10 })
  assert.equal(platform.balance, 90)
  assert.equal(events(platform, 'g2048:start').length, 1)

  platform.failNextEndRound()
  game.onAction('p1', 'give_up', {})
  assert.equal(events(platform, 'g2048:settling').length, 1)
  assert.equal(events(platform, 'g2048over').length, 0)
  assert.equal(events(platform, 'g2048:over').length, 0)
  assert.deepEqual(platform.timerIds().length, 1)

  platform.fireTimer(platform.timerIds()[0])
  assert.equal(events(platform, 'g2048:over').length, 1)
  assert.equal(events(platform, 'g2048:over')[0].data.committed, true)
  assert.equal(platform.committedRounds.length, 2)
}

// 2. Transient beginRound failure follows the same retaining/retry path.
{
  const platform = createPlatform()
  const game = loadGame(platform)
  game.onInit()
  game.onAction('p1', 'start_game', { bet: 10 })
  platform.failNextBeginRound()
  game.onAction('p1', 'give_up', {})
  assert.equal(events(platform, 'g2048:over').length, 0)
  platform.fireTimer(platform.timerIds()[0])
  assert.equal(events(platform, 'g2048:over')[0].data.committed, true)
}

// 3. Mid-game fair draw failure enters refund settlement and restores stake.
{
  const platform = createPlatform()
  const game = loadGame(platform)
  game.onInit()
  game.onAction('p1', 'start_game', { bet: 10 })
  assert.equal(platform.balance, 90)
  // Initial board consumes fair indexes 0..3; the next spawn draw fails.
  platform.failFairIndexes.add(4)
  platform.failNextEndRound()
  game.onAction('p1', 'move', { direction: 'left', moveId: 1 })
  assert.equal(events(platform, 'g2048:settling')[0].data.refund, true)
  assert.equal(events(platform, 'g2048:over').length, 0)
  assert.equal(platform.balance, 90)
  platform.fireTimer(platform.timerIds()[0])
  const over = events(platform, 'g2048:over')[0].data
  assert.equal(over.refunded, true)
  assert.equal(over.committed, true)
  assert.equal(platform.balance, 100)
  const refund = platform.committedRounds.at(-1).wallet[0]
  assert.equal(refund.amount, 10)
  assert.equal(refund.description, '2048 refund:random_error')
}

console.log('2048 terminal wallet state machine audit passed (settle retry, begin retry, random refund).')
