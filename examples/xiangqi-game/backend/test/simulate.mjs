// 象棋后端回归 —— 直接驱动打包产物 dist/game.js。
//
// 覆盖三块：
//   1. rules.ts / ai.ts 单元测试（Node 原生 TS 类型剥离直载源码）：
//      初始合法步数、飞将、马腿/象眼/炮架、过河兵、绝杀识别、AI 走法合法性
//   2. mock platform（虚拟时钟 / 钱包）上跑完整会话：
//      场景 A：1 真人挂机 + 1 机器人 → AI 托管打完整局并结算
//      场景 B：2 真人（AI 策略代打）打完整局，校验结算守恒
//      场景 C：非法走子被拒（xq:error）+ 认输流程与钱包流转
//
// 运行：npm test（Node ≥ 22.18，内置 TS 类型剥离）

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));

// ── 1. rules.ts / ai.ts 单元测试 ──
const rules = await import(pathToFileURL(join(here, '../src/rules.ts')).href);
const ai = await import(pathToFileURL(join(here, '../src/ai.ts')).href);

const { idx, initialBoard, legalMoves, isLegalMove, kingsFacing, isInCheck, other, applyMove } = rules;

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

function emptyBoard() {
  return new Array(90).fill(null);
}

console.log('rules.ts 规则引擎:');
test('初始局面双方各 44 个合法步', () => {
  const b = initialBoard();
  assert.equal(legalMoves(b, 'r').length, 44);
  assert.equal(legalMoves(b, 'b').length, 44);
});

test('初始局面无将军、兵不能横走', () => {
  const b = initialBoard();
  assert.equal(isInCheck(b, 'r'), false);
  // 红兵 (0,6) 不能横走到 (1,6)
  assert.equal(isLegalMove(b, 'r', idx(0, 6), idx(1, 6)), false);
  assert.equal(isLegalMove(b, 'r', idx(0, 6), idx(0, 5)), true);
});

test('马走日 + 蹩马腿', () => {
  const b = emptyBoard();
  b[idx(0, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  b[idx(1, 9)] = { c: 'r', t: 'N' };
  b[idx(2, 7)] = null;
  assert.equal(isLegalMove(b, 'r', idx(1, 9), idx(2, 7)), true);
  assert.equal(isLegalMove(b, 'r', idx(1, 9), idx(3, 7)), false); // 不走日
  b[idx(1, 8)] = { c: 'r', t: 'P' }; // 蹩向上跳的马腿
  assert.equal(isLegalMove(b, 'r', idx(1, 9), idx(2, 7)), false);
});

test('象走田 + 塞象眼 + 不过河', () => {
  const b = emptyBoard();
  b[idx(0, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  b[idx(2, 9)] = { c: 'r', t: 'B' };
  assert.equal(isLegalMove(b, 'r', idx(2, 9), idx(4, 7)), true);
  assert.equal(isLegalMove(b, 'r', idx(2, 9), idx(0, 7)), true);
  b[idx(3, 8)] = { c: 'r', t: 'A' }; // 塞象眼
  assert.equal(isLegalMove(b, 'r', idx(2, 9), idx(4, 7)), false);
  assert.equal(isLegalMove(b, 'r', idx(2, 9), idx(4, 5)), false); // 过河
});

test('炮平移不吃、翻山才吃', () => {
  const b = emptyBoard();
  b[idx(4, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  b[idx(4, 4)] = { c: 'r', t: 'C' };
  b[idx(4, 0)] = { c: 'b', t: 'K' };
  assert.equal(isLegalMove(b, 'r', idx(4, 4), idx(4, 0)), false); // 无炮架
  b[idx(4, 2)] = { c: 'r', t: 'P' }; // 炮架
  assert.equal(isLegalMove(b, 'r', idx(4, 4), idx(4, 0)), true);
  assert.equal(isLegalMove(b, 'r', idx(4, 4), idx(4, 3)), true); // 平移空位
  assert.equal(isLegalMove(b, 'r', idx(4, 4), idx(4, 2)), false); // 吃自己炮架
});

test('将帅照面（飞将）：同线无遮挡即将军', () => {
  const b = emptyBoard();
  b[idx(4, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  assert.equal(kingsFacing(b), true);
  b[idx(4, 5)] = { c: 'r', t: 'P' };
  assert.equal(kingsFacing(b), false);
});

test('不能走出照面 / 送将', () => {
  const b = emptyBoard();
  b[idx(4, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  // 黑帅沿 4 列走仍在照面线上 → 非法；横移离开 → 合法
  assert.equal(isLegalMove(b, 'b', idx(4, 0), idx(4, 1)), false);
  assert.equal(isLegalMove(b, 'b', idx(4, 0), idx(3, 0)), true);
});

test('绝杀识别：双车错杀无子可动', () => {
  const b = emptyBoard();
  b[idx(4, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  b[idx(4, 5)] = { c: 'r', t: 'R' }; // 沿 4 列将军
  b[idx(0, 0)] = { c: 'r', t: 'R' }; // 锁 0 行
  assert.equal(isInCheck(b, 'b'), true);
  // 黑帅可逃 (3,0)/(5,0)？均被 0 行车锁 → 但 (5,0) 也被锁，无合法步
  assert.equal(legalMoves(b, 'b').length, 0);
  // 抽掉底线车后可以逃
  b[idx(0, 0)] = null;
  assert.ok(legalMoves(b, 'b').length > 0);
});

test('过河兵横走、未过河不能', () => {
  const b = emptyBoard();
  b[idx(0, 0)] = { c: 'b', t: 'K' };
  b[idx(4, 9)] = { c: 'r', t: 'K' };
  b[idx(4, 3)] = { c: 'r', t: 'P' }; // 已过河
  assert.equal(isLegalMove(b, 'r', idx(4, 3), idx(3, 3)), true);
  assert.equal(isLegalMove(b, 'r', idx(4, 3), idx(4, 2)), true);
  b[idx(4, 6)] = { c: 'r', t: 'P' }; // 未过河
  assert.equal(isLegalMove(b, 'r', idx(4, 6), idx(3, 6)), false);
});

test('AI 输出的走法恒合法', () => {
  for (let seed = 0; seed < 3; seed++) {
    const b = initialBoard();
    let color = 'r';
    for (let ply = 0; ply < 6; ply++) {
      const m = ai.botMove(b, color);
      assert.ok(m, 'AI 必须找到合法步');
      assert.equal(isLegalMove(b, color, m.from, m.to), true);
      applyMove(b, m);
      color = other(color);
    }
  }
});

// goja 沙箱对单次定时器回调有 2s 硬时限(见 ai.ts 文件头)。此用例在搜索
// 最重的局面(开局,合法步最多)钉住节点预算契约:一旦有人调大预算导致
// goja 下可能超时,这里会先红。
test('AI 最坏局面节点数不超 goja 安全预算', () => {
  assert.ok(ai.lastBotSearchNodes !== undefined, 'ai.ts 须导出 lastBotSearchNodes');
  const b = initialBoard();
  ai.botMove(b, 'r');
  assert.ok(
    ai.lastBotSearchNodes > 0 && ai.lastBotSearchNodes <= 320,
    `开局最坏节点数 ${ai.lastBotSearchNodes} 超出 320 预算,goja 下有超时风险`,
  );
});

// ── 2. mock platform ──

function createPlatform(playerIds, balances) {
  const events = [];
  const priv = {};
  const conns = new Set(playerIds);
  const wallet = new Map(Object.entries(balances));
  const walletVersion = new Map(Object.keys(balances).map((k) => [k, 0]));
  const logs = [];
  const roster = playerIds.map((id) => ({ id, name: 'name-' + id }));
  let roundQueue = null;
  let lastError = '';
  let vnow = 0;
  let timerSeq = 0;
  let finishCount = 0;
  const timers = new Map();
  const env = { stopped: false };
  const state = new Map();

  const api = {
    broadcast(event, data) { events.push({ event, data }); },
    sendTo(playerId, event, data) {
      if (!conns.has(playerId)) return;
      if (!priv[playerId]) priv[playerId] = [];
      priv[playerId].push({ event, data });
    },
    getGameState(k) { return state.get(k); },
    setGameState(k, v) { state.set(k, v); },
    getPlayers() { return roster.map((r) => ({ id: r.id, name: r.name })); },
    isPlayerOnline(pid) { return conns.has(pid); },
    finishSession() { finishCount++; },
    reopenSession() {},
    random() { return Number(randomBytes(8).readBigUInt64LE() >> 11n) / Number(1n << 53n); },
    beginFairRound() { return false; },
    getFairRandom() { return false; },
    revealFairRound() { return false; },
    log(...args) { logs.push(args.join(' ')); },
    setTimeout(fn, ms) { timerSeq++; timers.set(timerSeq, { at: vnow + ms, fn }); return timerSeq; },
    setInterval() { return 0; },
    clearTimer(id) { timers.delete(id); },
    recordResult(pid, result, scoreDelta = 0, meta = '') {
      if (!roundQueue) return false;
      (env.recordedResults ||= []).push({ round: roundQueue ? 'open' : '', pid, result, scoreDelta, meta });
      return true;
    },
    beginRound() {
      if (roundQueue) return '';
      roundQueue = [];
      return 'round-' + timerSeq;
    },
    deductBalance(pid, amount) {
      if (!roundQueue) return false;
      roundQueue.push({ pid, amount: -amount });
      return true;
    },
    rewardBalance(pid, amount) {
      if (!roundQueue) return false;
      roundQueue.push({ pid, amount: +amount });
      return true;
    },
    endRound() {
      if (!roundQueue) return false;
      const q = roundQueue; roundQueue = null;
      for (const { pid, amount } of q) {
        if ((wallet.get(pid) || 0) + amount < 0) { lastError = 'insufficient balance'; return false; }
      }
      for (const { pid, amount } of q) {
        wallet.set(pid, (wallet.get(pid) || 0) + amount);
        walletVersion.set(pid, (walletVersion.get(pid) || 0) + 1);
      }
      for (const { pid } of q) {
        api.sendTo(pid, 'wallet:balance', { balance: wallet.get(pid), version: walletVersion.get(pid), source: 'round' });
      }
      return true;
    },
    getRoundId() { return roundQueue ? 'round' : ''; },
    lastRoundError() { return lastError; },
    getBalance(pid) { return wallet.get(pid) || 0; },
    getBalanceVersion(pid) { return walletVersion.get(pid) || 0; },
  };

  env.drain = function (maxSteps = 200000) {
    let steps = 0;
    while (!env.stopped && timers.size > 0 && steps++ < maxSteps) {
      let bestId = 0, bestAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at < bestAt) { bestAt = t.at; bestId = id; }
      }
      if (!bestId) break;
      const t = timers.get(bestId);
      timers.delete(bestId);
      vnow = t.at;
      t.fn();
    }
    assert.ok(env.stopped || steps < maxSteps, '定时器未收敛（疑似死循环）');
  };
  env.stop = function () { env.stopped = true; timers.clear(); };
  env.api = api;
  env.events = events;
  env.priv = priv;
  env.logs = logs;
  env.wallet = wallet;
  env.leave = function (pid) {
    conns.delete(pid);
    game && game.onPlayerLeave && game.onPlayerLeave(pid);
  };
  env.join = function (pid, name) {
    conns.add(pid);
    if (!roster.some((r) => r.id === pid)) roster.push({ id: pid, name: name || ('name-' + pid) });
    game && game.onPlayerJoin && game.onPlayerJoin(pid, name || ('name-' + pid));
  };
  env.finishCount = () => finishCount;
  return env;
}

function loadBundle(env) {
  globalThis.platform = env.api;
  const code = readFileSync(join(here, '../dist/game.js'), 'utf8');
  new Function(code)();
  return {
    onInit: globalThis.onInit,
    onAction: globalThis.onAction,
    onSync: globalThis.onSync,
    onFinish: globalThis.onFinish,
    onPlayerJoin: globalThis.onPlayerJoin,
    onPlayerLeave: globalThis.onPlayerLeave,
  };
}

function collect(events, name) {
  return events.filter((e) => e.event === name).map((e) => e.data);
}

function latestPublic(env) {
  const all = env.events.filter((e) => e.data && e.data.public).map((e) => e.data.public);
  return all[all.length - 1];
}

let game = null;

console.log('集成场景 A：1 真人（挂机托管）+ 1 机器人');
{
  const env = createPlatform(['p1'], { p1: 5000 });
  game = loadBundle(env);
  game.onInit();

  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'xq:settled') env.stop();
  })(env.api.broadcast);

  game.onAction('p1', 'ready_hand', {});
  env.drain();

  const starts = collect(env.events, 'xq:start');
  const moves = collect(env.events, 'xq:move');
  const over = collect(env.events, 'xq:hand_over');
  const settled = collect(env.events, 'xq:settled');

  test('匹配超时 AI 补位后开局，座位 0 执红先行', () => {
    assert.equal(starts.length, 1);
    assert.equal(starts[0].colors[0], 'r');
    assert.equal(starts[0].colors[1], 'b');
  });
  test('对局完成且步数合理（>10 步）', () => {
    assert.equal(over.length, 1);
    assert.ok(moves.length > 10, 'moves=' + moves.length);
  });
  test('结算提交成功，终局快照带 finalBoard', () => {
    assert.equal(settled.length, 1);
    assert.equal(settled[0].committed, true);
    assert.equal(over[0].finalBoard.length, 90);
  });
  test('每步广播携带合法 board 快照且红黑交替', () => {
    const pubs = env.events.filter((e) => e.event === 'xq:move' && e.data.public);
    let expect = 'r';
    for (const m of pubs) {
      assert.equal(m.data.color, expect, '行棋方应红黑交替');
      expect = other(expect);
    }
  });
  test('每步 xq:move 携带中式记谱 notation', () => {
    // 普通式 [棋子][纵线][平/进/退][目的]；同线同种用 前/后 消歧式 [前/后][棋子][动词][目的]
    // 字符类需含双方棋子:帅/将 仕/士 相/象 马 车 炮 兵/卒
    const re = /^(?:[前後后]?[帅将士仕相象马车炮兵卒][一二三四五六七八九\d]|[前后][帅将士仕相象马车炮兵卒])[平进退][一二三四五六七八九\d]$/;
    for (const m of collect(env.events, 'xq:move')) {
      assert.ok(re.test(m.notation), `notation=${m.notation}`);
    }
  });
  test('sync 携带执子颜色与余额', () => {
    const sync = env.priv['p1'].filter((m) => m.event === 'xq:sync').pop();
    assert.equal(sync.data.youColor, 'r');
    assert.equal(typeof sync.data.balance, 'number');
  });
}

console.log('集成场景 B：2 真人（AI 策略代打）打完整局');
{
  const env = createPlatform(['p1', 'p2'], { p1: 3000, p2: 3000 });
  game = loadBundle(env);
  game.onInit();

  const pending = new Set();
  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'xq:settled') { env.stop(); return; }
    if (event !== 'xq:move' && event !== 'xq:start') return;
    const pub = data.public;
    if (!pub || pub.phase !== 'playing') return;
    const seat = pub.turnSeat;
    const pid = pub.seats[seat].id;
    if (pid.startsWith('bot:')) return;
    const key = pub.gameNo + ':' + pub.moveCount + ':' + seat;
    if (pending.has(key)) return;
    pending.add(key);
    env.api.setTimeout(() => {
      pending.delete(key);
      const cur = latestPublic(env);
      if (!cur || cur.phase !== 'playing' || cur.turnSeat !== seat) return;
      const board = cur.board.map((p) => (p ? { c: p.c, t: p.t } : null));
      const m = ai.botMove(board, cur.turn);
      if (!m) return;
      game.onAction(pid, 'move', { from: m.from, to: m.to });
    }, 500);
  })(env.api.broadcast);

  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});
  env.drain();

  const over = collect(env.events, 'xq:hand_over');
  const settled = collect(env.events, 'xq:settled');

  test('完整对局结束并结算', () => {
    assert.equal(over.length, 1);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].committed, true);
  });
  test('零和守恒：deltas 之和为 0，余额与 delta 一致', () => {
    const d = settled[0].deltas;
    const sum = (d['p1'] || 0) + (d['p2'] || 0);
    assert.equal(sum, 0, JSON.stringify(d));
    if (d['p1']) assert.equal(env.wallet.get('p1'), 3000 + d['p1']);
    if (d['p2']) assert.equal(env.wallet.get('p2'), 3000 + d['p2']);
  });
  test('输赢对称：有输必有赢', () => {
    const d = settled[0].deltas;
    const nz = Object.values(d).filter((v) => v !== 0);
    assert.ok(nz.length === 0 || nz.length === 2);
    if (nz.length === 2) assert.ok(nz[0] === -nz[1]);
  });
}

console.log('集成场景 D：AI 代打的局结束即解散');
{
  const env = createPlatform(['p1', 'p2'], { p1: 1000, p2: 1000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});

  let left = false;
  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'xq:settled') { env.stop(); return; }
    if (event === 'xq:move' && !left) {
      // 对局进行中 p2 离席 → 座位转 AI 代打，本局继续
      left = true;
      env.api.setTimeout(() => env.leave('p2'), 0);
    }
  })(env.api.broadcast);

  env.drain();

  const starts = collect(env.events, 'xq:start');
  const ends = collect(env.events, 'xq:session_end');
  const settled = collect(env.events, 'xq:settled');

  test('对局正常结束并结算', () => {
    assert.equal(collect(env.events, 'xq:hand_over').length, 1);
    assert.equal(settled.length, 1);
  });
  test('AI 代打的局结束立即解散：finishSession 恰好一次', () => {
    assert.equal(env.finishCount(), 1, 'finishSession 调用次数=' + env.finishCount());
  });
  test('不再自动开下一局', () => {
    assert.equal(starts.length, 1, 'xq:start 次数=' + starts.length);
  });
  test('广播 session_end(player_left)', () => {
    assert.ok(ends.some((e) => e.reason === 'player_left'), JSON.stringify(ends));
  });
}

console.log('集成场景 E：对局中双方离席 → 立即和棋收尾');
{
  const env = createPlatform(['p1', 'p2'], { p1: 3000, p2: 3000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});

  // 对局进行中双方先后离席
  env.leave('p1');
  env.leave('p2');
  env.drain();

  const over = collect(env.events, 'xq:hand_over');
  const settled = collect(env.events, 'xq:settled');
  const ends = collect(env.events, 'xq:session_end');

  test('双方离席立即按和棋收尾', () => {
    assert.equal(over.length, 1, 'hand_over 次数=' + over.length);
    assert.equal(over[0].draw, true);
    assert.equal(over[0].reason, 'both_left_draw');
  });
  test('和棋不动钱包', () => {
    assert.equal(env.wallet.get('p1'), 3000);
    assert.equal(env.wallet.get('p2'), 3000);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].committed, true);
  });
  test('随后解散房间（all_gone）', () => {
    assert.equal(env.finishCount(), 1, 'finishSession 次数=' + env.finishCount());
    assert.ok(ends.some((e) => e.reason === 'all_gone'), JSON.stringify(ends));
  });
}

console.log('集成场景 C：非法走子拒绝 + 认输流程');
{
  const env = createPlatform(['p1', 'p2'], { p1: 1000, p2: 1000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});

  const errs = [];
  env.api.sendTo = ((orig) => function (pid, event, data) {
    orig(pid, event, data);
    if (event === 'xq:error') errs.push({ pid, data });
  })(env.api.sendTo);

  test('非轮到方走子被拒', () => {
    game.onAction('p2', 'move', { from: idx(0, 0), to: idx(0, 1) });
    assert.ok(errs.some((e) => e.pid === 'p2' && /轮到你/.test(e.data.message)), JSON.stringify(errs));
  });
  test('移动对方棋子被拒', () => {
    game.onAction('p1', 'move', { from: idx(0, 0), to: idx(0, 1) });
    assert.ok(errs.some((e) => /自己的棋子/.test(e.data.message)));
  });
  test('不符合走法的步被拒', () => {
    game.onAction('p1', 'move', { from: idx(0, 9), to: idx(4, 5) }); // 车走斜线
    assert.ok(errs.some((e) => /不合法/.test(e.data.message)));
  });
  test('格式错误被拒', () => {
    game.onAction('p1', 'move', { from: 'a', to: 5 });
    game.onAction('p1', 'move', { from: -1, to: 5 });
    game.onAction('p1', 'move', { from: 3, to: 3 });
    assert.ok(errs.some((e) => /格式错误/.test(e.data.message)));
  });

  const rejected = errs.length;
  test('认输：对手获胜且钱包流转正确', () => {
    game.onAction('p2', 'resign', {});
    const over = collect(env.events, 'xq:hand_over');
    const settled = collect(env.events, 'xq:settled');
    assert.equal(over.length, 1);
    assert.equal(over[0].reason, 'resign');
    assert.equal(over[0].winner, 0, 'p1（红方）应获胜');
    assert.equal(settled[0].committed, true);
    assert.equal(settled[0].deltas['p2'], -100);
    assert.equal(settled[0].deltas['p1'], 100);
    assert.equal(env.wallet.get('p1'), 1100);
    assert.equal(env.wallet.get('p2'), 900);
  });
  test('对局结束后走子被拒', () => {
    const n = errs.length;
    game.onAction('p1', 'move', { from: idx(0, 9), to: idx(0, 8) });
    assert.ok(errs.length > n);
  });
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
