// 消消乐端到端冒烟 —— 走真实 WS 协议打完整会话。
//
// 前置：backend 与 frontend 已构建，mock-server 已启动（npm start）。
// 运行：node smoke.mjs   （在 devserver 目录；另开终端先 npm start）
//
// 覆盖：连接 → 自动开局（mm:init）→ state:sync（mm:sync 余额）→ start_game
// （扣费推送 + mm:start）→ 20 步交换（mm:swap 步骤流 + 回放一致性）→
// mm:game_over（星级/派奖）→ 钱包终值守恒 → /status 对局记录（recordResult）。

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const WS_URL = process.env.SMOKE_WS_URL || 'ws://localhost:9998';
const BET = Number.parseInt(process.env.SMOKE_BET || '50', 10) || 50;

const board = await import(pathToFileURL(join(here, '../backend/src/board.ts')).href);
const { findAnyMove, hasAnyMatch } = board;

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
  } catch (e) {
    failed++;
    console.error('  ✗', name, '—', e.message);
  }
}

function applySteps(steps, boardIn) {
  const b = boardIn.slice();
  for (const s of steps) {
    if (s.t === 'swap') {
      const t = b[s.a]; b[s.a] = b[s.b]; b[s.b] = t;
    } else if (s.t === 'clear') {
      for (const cell of s.cells) b[cell] = -1;
      for (const cr of s.creations) b[cr.cell] = cr.tile;
    } else if (s.t === 'fall') {
      for (const m of s.moves) { b[m.to] = b[m.from]; b[m.from] = -1; }
      for (const sp of s.spawns) b[sp.cell] = sp.tile;
    } else if (s.t === 'shuffle') {
      for (let i = 0; i < b.length; i++) b[i] = s.board[i];
    }
  }
  return b;
}

const ws = new WebSocket(`${WS_URL}/?ticket=smoke&gameId=mm`);
const received = [];
let balance = null;
let balanceVersion = 0;
const waiters = [];
let done = false;

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'event' && msg.action === 'wallet:balance') {
    balance = msg.payload.balance;
    balanceVersion = msg.payload.version;
  }
  received.push(msg);
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i](msg)) waiters.splice(i, 1);
  }
});

function waitFor(pred, label, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const hit = received.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => {
      const i = waiters.indexOf(fn);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('等待超时: ' + label));
    }, timeoutMs);
    const fn = (msg) => {
      if (pred(msg)) {
        clearTimeout(timer);
        resolve(msg);
        return true;
      }
      return false;
    };
    waiters.push(fn);
  });
}

const events = (name) => received.filter((m) => m.type === 'event' && m.action === name).map((m) => m.payload);
const systems = (name) => received.filter((m) => m.type === 'system' && m.action === name).map((m) => m.payload);

async function main() {
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  console.log(`冒烟开始：${WS_URL}（注 ${BET}）`);

  await waitFor((m) => m.action === 'session:joined', 'session:joined');
  await waitFor((m) => m.action === 'mm:init', 'mm:init');
  test('quick 单人：连接即开局（session:started）', () => {
    assert.ok(systems('session:started').length >= 1);
    const init = events('mm:init').pop();
    assert.equal(init.config.cols, 8);
    assert.equal(init.config.moves, 20);
  });

  ws.send(JSON.stringify({ type: 'system', action: 'state:sync', payload: {}, timestamp: Date.now(), seq: 1 }));
  await waitFor((m) => m.action === 'mm:sync', 'mm:sync');
  test('state:sync：本人快照（playerId/余额/版本）', () => {
    const sync = events('mm:sync').pop();
    assert.equal(sync.playerId, 'p1');
    assert.equal(typeof sync.balance, 'number');
    assert.equal(sync.phase, 'idle');
  });

  ws.send(JSON.stringify({ type: 'action', action: 'start_game', payload: { bet: BET }, timestamp: Date.now(), seq: 2 }));
  await waitFor((m) => m.action === 'mm:start', 'mm:start');
  test('start_game：扣费推送 + 合法棋盘 + 承诺', () => {
    assert.equal(balance, 5000 - BET);
    const start = events('mm:start').pop();
    assert.equal(start.bet, BET);
    assert.equal(start.board.length, 64);
    assert.equal(hasAnyMatch(start.board), false);
    assert.ok(findAnyMove(start.board));
    assert.ok(start.commitment.length >= 16);
  });

  let boardNow = events('mm:start').pop().board.slice();
  let lastSwap = null;
  for (let step = 0; step < 20; step++) {
    const mv = findAnyMove(boardNow);
    assert.ok(mv, '死局应由服务端洗牌兜底');
    const before = events('mm:swap').length;
    ws.send(JSON.stringify({ type: 'action', action: 'swap', payload: { a: mv.a, b: mv.b }, timestamp: Date.now(), seq: 3 + step }));
    await waitFor((m) => m.action === 'mm:swap' && events('mm:swap').length > before, `第 ${step + 1} 步 mm:swap`);
    lastSwap = events('mm:swap').pop();
    assert.deepEqual(applySteps(lastSwap.steps, boardNow), lastSwap.board, `第 ${step + 1} 步回放不一致`);
    boardNow = lastSwap.board.slice();
    await waitFor((m) => m.action === 'mm:game_over', '终局', 1500).catch(() => null);
    if (events('mm:game_over').length > 0) break;
  }

  await waitFor((m) => m.action === 'mm:game_over', 'mm:game_over');
  test('20 步终局：星级/派奖与档位一致，钱包守恒', () => {
    const over = events('mm:game_over').pop();
    assert.equal(over.reason, 'moves_used');
    assert.equal(over.score, lastSwap.score);
    const tiers = events('mm:init').pop().config.tiers;
    let stars = 0, mult = 0;
    for (const t of tiers) if (over.score >= t.min) { stars = t.star; mult = t.mult; }
    assert.equal(over.stars, stars);
    assert.equal(over.payout, Math.floor(BET * mult));
    assert.equal(over.committed, true);
    assert.equal(balance, 5000 - BET + over.payout);
    assert.ok(balanceVersion >= 2, '钱包版本至少推进 2 次（扣费+派奖）');
  });

  const status = await fetch(WS_URL.replace(/^ws:/, 'http:') + '/status').then((r) => r.json());
  test('对局记录：结算回合登记一条，净变动与 win/lose 一致', () => {
    const over = events('mm:game_over').pop();
    const recs = status.records.filter((r) => r.playerId === 'p1');
    assert.equal(recs.length, 1, '一局恰好一条对局记录');
    assert.equal(recs[0].scoreDelta, over.payout - BET);
    assert.equal(recs[0].result, over.payout > BET ? 'win' : 'lose');
  });

  console.log(failed === 0 ? '\n冒烟通过 ✅' : `\n${failed} 项失败 ❌`);
  ws.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('冒烟失败：', e.message);
  process.exit(1);
});
