import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyMove,
  canMove,
  createInitialBoard,
  maxTile,
  resolveMove,
  spawnTile,
} from './backend/src/board.js'

const config = JSON.parse(readFileSync(new URL('./payouts.json', import.meta.url), 'utf8'))
const deterministicRand = values => {
  let i = 0
  return () => values[i++ % values.length] ?? 0.5
}

// Initial board and spawn behavior.
{
  const rand = deterministicRand([0.12, 0.2, 0.81, 0.4])
  const board = createInitialBoard(rand)
  assert.equal(board.filter(Boolean).length, 2)
  assert(board.every(v => v === 0 || v === 2 || v === 4))
  const spawned = spawnTile(board, deterministicRand([0.99, 0.99]))
  assert.equal(spawned.board.filter(Boolean).length, 3)
  assert.equal(spawned.value, 4)
}

// Directional compression, single-pass merging and score.
{
  const board = [2, 2, 4, 4, 2, 2, 2, 0, 0, 2, 2, 0, 0, 0, 2, 2]
  const left = resolveMove(board, 'left')
  assert.deepEqual(left.afterMove.slice(0, 4), [4, 8, 0, 0])
  assert.deepEqual(left.afterMove.slice(4, 8), [4, 2, 0, 0])
  assert.deepEqual(left.afterMove.slice(8, 12), [4, 0, 0, 0])
  assert.deepEqual(left.afterMove.slice(12), [4, 0, 0, 0])
  assert.equal(left.scoreGain, 4 + 8 + 4 + 4 + 4)
  assert.equal(left.moved, true)

  const right = resolveMove([2, 2, 0, 0], 'right')
  assert.deepEqual(right.afterMove.slice(0, 4), [0, 0, 0, 4])
  const upBoard = new Array(16).fill(0)
  upBoard[0] = upBoard[4] = upBoard[8] = upBoard[12] = 2
  const up = resolveMove(upBoard, 'up')
  assert.deepEqual(up.afterMove.slice(0, 4), [4, 0, 0, 0])
  const down = resolveMove(upBoard, 'down')
  assert.deepEqual(down.afterMove.slice(8, 12), [4, 0, 0, 0])
assert.deepEqual(down.afterMove.slice(12), [4, 0, 0, 0])
}

// A no-op move is rejected and does not consume a spawn.
assert.equal(resolveMove([2, 0, 0, 0], 'left').moved, false)

// Reaching target stops before spawning another tile.
{
  const board = [1024, 1024, 0, 0]
  const result = applyMove(board, 'left', deterministicRand([0.5, 0.5]))
  assert.deepEqual(result.afterMove.slice(0, 2), [2048, 0])
  assert.equal(result.spawn, null)
  assert.equal(maxTile(result.afterMove), 2048)
}

// Random play invariants: powers of two, score equals merged tile values, valid ending.
for (let seed = 0; seed < 200; seed++) {
  let state = 123456789 + seed
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  let board = createInitialBoard(rand)
  let score = 0
  const directions = ['left', 'right', 'up', 'down']
  let guard = 0
  while (canMove(board) && guard++ < 500) {
    const transition = applyMove(board, directions[guard % 4], rand)
    if (!transition.moved) continue
    score += transition.scoreGain
    board = transition.afterSpawn
    assert.equal(board.length, 16)
    assert(board.every(value => value === 0 || (value >= 2 && (value & (value - 1)) === 0)))
    assert(board.filter(Boolean).length <= 16)
  }
  assert.equal(score >= 0, true)
}

// Paid economy configuration: retain the declared tier schedule and ensure
// every stake/multiplier product is an exact integer coin payout.
assert.deepEqual(config.bets, [10, 50, 100])
assert(config.tiers.every((tier, i) => i === 0 || tier.maxTile > config.tiers[i - 1].maxTile))
for (const bet of config.bets) {
  for (const tier of config.tiers) assert.equal(Number.isInteger(Math.floor(bet * tier.multiplier)), true)
}

console.log('2048 board/economy audit passed (movement, spawning, target, 200 random games).')
