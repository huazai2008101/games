// Run with: npm --prefix examples/plinko-game/backend test
// Reads the same JSON payout source imported by the goja game bundle; no experimental Node flags are required.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const payoutTables = JSON.parse(readFileSync(new URL('./payouts.json', import.meta.url), 'utf8'))
const RISK_LEVELS = ['low', 'medium', 'high']
const ROW_OPTIONS = [8, 12, 16]
function expandPayouts(compact, rows) {
  const result = [...compact]
  for (let i = compact.length - 2; i >= 0; i--) result.push(compact[i])
  return result
}

const binomial = (n, k) => {
  let result = 1
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
  return Math.round(result)
}

for (const risk of RISK_LEVELS) {
  for (const rows of ROW_OPTIONS) {
    const compact = payoutTables[risk][rows]
    assert.equal(compact.length, Math.ceil((rows + 1) / 2), `table shape ${risk}/${rows}`)
    const payouts = expandPayouts(compact, rows)
    assert.equal(payouts.length, rows + 1)
    let expected = 0
    for (let slot = 0; slot < payouts.length; slot++) {
      expected += binomial(rows, slot) * payouts[slot]
    }
    const rtp = expected / 2 ** rows
    assert.ok(rtp >= 0.985 && rtp <= 0.995, `${risk}/${rows} RTP out of range: ${rtp}`)
    console.log(`${risk.padEnd(6)} ${String(rows).padStart(2)} rows  RTP ${(rtp * 100).toFixed(4)}%`)
  }
}
console.log('Plinko payout audit passed (9/9 configurations).')
