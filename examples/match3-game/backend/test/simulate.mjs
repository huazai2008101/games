// 消消乐后端回归 —— 直接驱动打包产物 dist/game.js。
//
// 覆盖两块：
//   1. board.ts 单元测试（Node 原生 TS 类型剥离直载源码）：
//      棋盘生成不变量、匹配/特殊块生成（4连/L-T/5连）、彩虹交换、爆炸扩展、
//      死局洗牌、确定性，以及核心的「步骤协议回放」——客户端按 steps 逐帧
//      重放必须精确得到服务端最终棋盘。
//   2. mock platform（内存钱包 + 公平随机注册表 + recordResult 对局记录）上跑完整会话：
//      开局扣费 → 全程游玩 → 终局派奖与对局记录登记的账务守恒；非法动作拒绝；
//      give_up / 离席结算 / 余额不足 / state:sync 快照一致性；末尾输出随机策略
//      RTP 基线（rtpDeclared 校准下限，见 README 平台接入）。
//
// 运行：npm test（Node ≥ 22.18，内置 TS 类型剥离）

import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));

const board = await import(pathToFileURL(join(here, '../src/board.ts')).href);
const {
  COLS, ROWS, COLORS, MAX_CHAIN, CLEAR_POINTS,
  colorOf, kindOf, makeTile, adjacent,
  hasAnyMatch, newBoard, findAnyMove, shuffleBoard, resolveSwap,
} = board;

const N = COLS * ROWS;
const idx = (r, c) => r * COLS + c;
const rand = () => randomBytes(6).readUIntLE(0, 6) / 0x1000000000000;

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

// 基础底板：对角条纹，天然无 3 连
function safeBase() {
  const b = new Array(N).fill(0);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) b[idx(r, c)] = (r + c) % COLORS;
  return b;
}

// ── 客户端影子模型：按 steps 逐帧重放（与前端动画协议一致） ──
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
      for (let i = 0; i < N; i++) b[i] = s.board[i];
    }
  }
  return b;
}

function validCodes(b) {
  return b.every((t) => t >= 0 && (t < COLORS || (t >= 10 && t < 35) || t === 40));
}

console.log('board.ts 消除引擎:');

test('newBoard：无初始匹配、必有可行步、块代码合法', () => {
  for (let k = 0; k < 30; k++) {
    const b = newBoard(rand);
    assert.ok(validCodes(b), '块代码非法');
    assert.equal(hasAnyMatch(b), false, '生成即匹配');
    assert.ok(findAnyMove(b), '无可行步');
  }
});

test('adjacent：上下左右为真，其余为假', () => {
  assert.equal(adjacent(idx(3, 3), idx(3, 4)), true);
  assert.equal(adjacent(idx(3, 3), idx(4, 3)), true);
  assert.equal(adjacent(idx(3, 3), idx(2, 3)), true);
  assert.equal(adjacent(idx(3, 3), idx(3, 2)), true);
  assert.equal(adjacent(idx(3, 3), idx(4, 4)), false);
  assert.equal(adjacent(idx(3, 3), idx(3, 5)), false);
  assert.equal(adjacent(idx(3, 3), idx(3, 3)), false);
  assert.equal(adjacent(-1, 0), false);
  assert.equal(adjacent(0, N), false);
});

test('基础 3 消：首波消除恰好 3 格计分 30，总分 = Σ各波得分（补块可连锁）', () => {
  const b = safeBase();
  // 行 3：c3..c4 = 1（c2 底板=0），把 1 放在 c6，交换 c5↔c6 完成横 3 连（c3..c5）
  b[idx(3, 3)] = 1; b[idx(3, 4)] = 1; b[idx(3, 6)] = 1;
  const res = resolveSwap(b, idx(3, 5), idx(3, 6), rand);
  assert.equal(res.valid, true);
  const clears = res.steps.filter((s) => s.t === 'clear');
  assert.ok(clears.length >= 1, '缺少 clear 步骤');
  assert.equal(clears[0].cells.length, 3, '首波应消除 3 格: ' + JSON.stringify(clears[0].cells));
  assert.equal(clears[0].creations.length, 0, '3 连不应生成特殊块');
  assert.equal(clears[0].chain, 1);
  assert.equal(clears[0].gain, CLEAR_POINTS * 3 * 1);
  const total = clears.reduce((a, s) => a + s.gain, 0);
  assert.equal(res.score, total, '总分 = Σ各波');
  assert.deepEqual(applySteps(res.steps, b), res.board, '步骤回放 ≠ 最终棋盘');
  assert.equal(hasAnyMatch(res.board), false, '落定后仍有匹配');
  assert.ok(validCodes(res.board));
});

test('无效交换：valid=false，棋盘不变', () => {
  const b = safeBase();
  // 对角条纹上任意相邻交换（底板区）都不产生匹配
  const res = resolveSwap(b, idx(0, 0), idx(0, 1), rand);
  assert.equal(res.valid, false);
  assert.deepEqual(res.board, b);
  assert.equal(res.steps.length, 0);
  assert.equal(res.score, 0);
});

test('横 4 连 → 横火箭（清行），枢纽落玩家交换格', () => {
  const b = safeBase();
  // 行 3：c2..c4 = 1，交换 c5↔c6 把 1 送进 c5 → 4 连 c2..c5，交换格 c5 为枢纽
  b[idx(3, 2)] = 1; b[idx(3, 3)] = 1; b[idx(3, 4)] = 1; b[idx(3, 6)] = 1;
  const res = resolveSwap(b, idx(3, 5), idx(3, 6), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  const creation = clear.creations.find((c) => c.cell === idx(3, 5));
  assert.ok(creation, '交换格应生成特殊块');
  assert.equal(creation.tile, makeTile(1, 1), '横4连应生成横火箭');
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('竖 4 连 → 竖火箭（清列）', () => {
  const b = safeBase();
  b[idx(2, 4)] = 3; b[idx(3, 4)] = 3; b[idx(4, 4)] = 3; b[idx(5, 4)] = 3;
  // 已成竖 4 连不行（生成时不能有初始匹配）→ 拆开：r5c4 放别处，交换恢复
  b[idx(5, 4)] = 2; b[idx(5, 3)] = 3;
  const res = resolveSwap(b, idx(5, 3), idx(5, 4), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  const creation = clear.creations.find((c) => c.cell === idx(5, 4));
  assert.ok(creation, '交换格应生成特殊块');
  assert.equal(creation.tile, makeTile(2, 3), '竖4连应生成竖火箭');
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('L/T 交叉 → 炸弹（3×3）', () => {
  const b = safeBase();
  // 交叉点 (5,3)：横臂 r5c1..c2=2、竖臂 r3c3..r4c3=2（各自仅 2 连，无初始匹配），
  // 把颜色 2 放在 r5c4，交换 r5c4↔r5c3 后交叉点成 2 → 横竖两臂同时成 3 连 = L 形
  b[idx(5, 1)] = 2; b[idx(5, 2)] = 2; b[idx(5, 4)] = 2;
  b[idx(3, 3)] = 2; b[idx(4, 3)] = 2;
  const res = resolveSwap(b, idx(5, 4), idx(5, 3), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  const creation = clear.creations.find((c) => kindOf(c.tile) === 3);
  assert.ok(creation, 'L/T 应生成炸弹');
  assert.equal(creation.cell, idx(5, 3), '炸弹应在交叉点');
  assert.equal(creation.tile, makeTile(3, 2));
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('5 连 → 彩虹球', () => {
  const b = safeBase();
  b[idx(2, 1)] = 4; b[idx(2, 2)] = 4; b[idx(2, 3)] = 4; b[idx(2, 4)] = 4; b[idx(2, 6)] = 4;
  const res = resolveSwap(b, idx(2, 5), idx(2, 6), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  const creation = clear.creations.find((c) => c.tile === 40);
  assert.ok(creation, '5连应生成彩虹球');
  assert.equal(res.board[creation.cell], 40);
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('火箭被消除时爆炸：清除所在整行', () => {
  const b = safeBase();
  // r4c3 横火箭（色0），下方 r5c3/r6c3/r7c3 竖 3 连色 0 触及 r4c3? 火箭在 r4，
  // 竖连 r5..r7 不含 r4 → 不会引爆。改为竖连覆盖 r4c3：r3c3=0 r4c3=火箭 r5c3=0
  b[idx(4, 3)] = makeTile(1, 0);
  b[idx(3, 3)] = 0; b[idx(5, 3)] = 0; b[idx(7, 3)] = 0;
  b[idx(6, 3)] = (6 + 3) % COLORS; // 底板=4 → r5,r7 是 0，r6=4 → 初始无匹配
  // 交换 r6c3↔r7c3? r7c3=0 → 换后 r6c3=0 → 竖连 r3..r7? r3=0,r4=火箭(色0),r5=0,r6=0,r7=4
  // 竖连 r3,r5,r6 不连续（r4 是火箭，colorOf=0）→ r3,r4,r5,r6 连续 4 个色0（含火箭）！
  const res = resolveSwap(b, idx(6, 3), idx(7, 3), rand);
  assert.equal(res.valid, true);
  const clears = res.steps.filter((s) => s.t === 'clear');
  const allCells = new Set();
  clears.forEach((s) => s.cells.forEach((c) => allCells.add(c)));
  for (let c = 0; c < COLS; c++) {
    assert.ok(allCells.has(idx(4, c)), `火箭应清整行 r4c${c}`);
  }
  assert.ok(clears.some((s) => s.triggered.some((t) => t.kind === 1)), '应记录火箭触发');
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('彩虹球 + 普通块 → 清除该颜色全部', () => {
  const b = safeBase();
  b[idx(1, 1)] = 40;
  let color2Cells = 0;
  for (let i = 0; i < N; i++) if (colorOf(b[i]) === 2) color2Cells++;
  b[idx(1, 2)] = 2; // 彩虹右侧放颜色 2
  const res = resolveSwap(b, idx(1, 1), idx(1, 2), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  const cells = new Set(clear.cells);
  for (let i = 0; i < N; i++) {
    if (colorOf(b[i]) === 2) assert.ok(cells.has(i), `颜色2的格 ${i} 应被清除`);
  }
  assert.ok(cells.has(idx(1, 2)), '彩虹球自身应被清除');
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('双彩虹 → 全屏清除', () => {
  const b = safeBase();
  b[idx(0, 0)] = 40; b[idx(0, 1)] = 40;
  const res = resolveSwap(b, idx(0, 0), idx(0, 1), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  assert.equal(clear.cells.length, N);
  assert.equal(clear.gain, CLEAR_POINTS * N * 1);
  assert.ok(res.score >= CLEAR_POINTS * N * 1, '全屏清除后补块级联可能继续加分');
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('彩虹球 + 火箭 → 清该颜色且火箭被引爆', () => {
  const b = safeBase();
  b[idx(2, 2)] = 40;
  b[idx(2, 3)] = makeTile(1, 1); // 色 coupon 1 的横火箭
  const res = resolveSwap(b, idx(2, 2), idx(2, 3), rand);
  assert.equal(res.valid, true);
  const clear = res.steps.find((s) => s.t === 'clear');
  const cells = new Set(clear.cells);
  for (let i = 0; i < N; i++) {
    if (colorOf(b[i]) === 1) assert.ok(cells.has(i), `颜色1的格 ${i} 应被清除`);
  }
  for (let c = 0; c < COLS; c++) assert.ok(cells.has(idx(2, c)), `火箭应清整行 r2c${c}`);
  assert.deepEqual(applySteps(res.steps, b), res.board);
});

test('连锁倍率：连锁波 chain 递增，得分按倍率放大（封顶 8）', () => {
  // 构造一次必然连锁：消除后下落补位形成新匹配不可控 → 用随机板统计：
  // 只验证「任意 resolution 的得分 = Σ 各波 gain，且每波 gain = 10×格数×min(chain,8)」
  for (let k = 0; k < 50; k++) {
    const b = newBoard(rand);
    const mv = findAnyMove(b);
    const res = resolveSwap(b, mv.a, mv.b, rand);
    if (!res.valid) continue;
    let sum = 0;
    let expectChain = res.steps[0].t === 'swap' ? 1 : 1;
    for (const s of res.steps) {
      if (s.t !== 'clear') continue;
      assert.equal(s.chain, expectChain, 'chain 应从 1 连续递增');
      assert.equal(s.gain, CLEAR_POINTS * s.cells.length * Math.min(s.chain, MAX_CHAIN));
      assert.equal(s.mult, Math.min(s.chain, MAX_CHAIN));
      sum += s.gain;
      expectChain++;
    }
    assert.equal(res.score, sum);
  }
});

test('随机全量解析不变量 ×120：落定无匹配、代码合法、必有可行步、回放一致', () => {
  for (let k = 0; k < 120; k++) {
    let b = newBoard(rand);
    for (let mv = 0; mv < 25; mv++) {
      const m = findAnyMove(b);
      assert.ok(m, '应有可行步（newBoard/洗牌保证）');
      const res = resolveSwap(b, m.a, m.b, rand);
      assert.equal(res.valid, true, 'findAnyMove 给出的交换必须有效');
      assert.ok(validCodes(res.board), '落定棋盘含非法代码');
      assert.equal(hasAnyMatch(res.board), false, '落定后仍有匹配');
      assert.ok(findAnyMove(res.board), '落定后死局（应已自动洗牌）');
      assert.deepEqual(applySteps(res.steps, b), res.board, '步骤回放不一致');
      if (res.shuffled) {
        assert.ok(res.steps.some((s) => s.t === 'shuffle'));
        break; // 洗牌后重新开始
      }
      b = res.board;
    }
  }
});

test('shuffleBoard：保留块集合重排，无初始匹配且有可行步', () => {
  for (let k = 0; k < 10; k++) {
    const b = newBoard(rand);
    const s = shuffleBoard(b, rand);
    const a = b.slice().sort((x, y) => x - y).join();
    const d = s.slice().sort((x, y) => x - y).join();
    assert.equal(d, a, '洗牌应是原块集合的重排');
    assert.equal(hasAnyMatch(s), false);
    assert.ok(findAnyMove(s));
  }
});

test('确定性：相同随机流 → 相同棋盘与相同结算步骤', () => {
  function seq(seed) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }
  const b1 = newBoard(seq(42));
  const b2 = newBoard(seq(42));
  assert.deepEqual(b1, b2);
  const m1 = findAnyMove(b1);
  const m2 = findAnyMove(b2);
  assert.deepEqual(m1, m2);
  const r1 = resolveSwap(b1, m1.a, m1.b, seq(7));
  const r2 = resolveSwap(b2, m2.a, m2.b, seq(7));
  assert.deepEqual(r1.steps, r2.steps);
  assert.equal(r1.score, r2.score);
});

// ── 2. mock platform 集成 ──

function createPlatform(playerIds, balances, opts = {}) {
  const events = [];
  const priv = {};
  const conns = new Set(playerIds);
  const wallet = new Map(Object.entries(balances));
  const walletVersion = new Map(Object.keys(balances).map((k) => [k, 0]));
  const logs = [];
  const roster = playerIds.map((id) => ({ id, name: 'name-' + id }));
  let roundQueue = null;
  let roundRecords = null;
  let roundIdSeq = 0;
  let lastError = '';
  const fairSeeds = new Map();
  let finishCount = 0;
  const state = new Map();
  const records = []; // recordResult 提交后落库（玩家侧对局记录页数据源）
  const env = { stopped: false };
  // 虚拟时钟：drain 顺序执行到期定时器（离席宽限等引擎定时器用）
  let vnow = 0;
  let timerSeq = 0;
  const timers = new Map();

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
    beginFairRound(seedId) {
      if (opts.fair === false) return '';
      const seed = randomBytes(16).toString('hex');
      fairSeeds.set(seedId, { seed, draws: 0 });
      return createHash('sha256').update(seed).digest('hex');
    },
    getFairRandom(seedId, i) {
      const f = fairSeeds.get(seedId);
      if (!f) return false;
      f.draws = Math.max(f.draws, i + 1);
      const h = createHash('sha256').update(seedId + ':' + f.seed + ':' + i).digest();
      return h.readUInt32BE(0) / 0x100000000;
    },
    revealFairRound(seedId) {
      const f = fairSeeds.get(seedId);
      if (!f) return false;
      return { seed: f.seed, commitment: '', draws: f.draws };
    },
    log(...args) { logs.push(args.join(' ')); },
    setTimeout(fn, ms) {
      timerSeq++;
      timers.set(timerSeq, { at: vnow + (ms || 0), fn });
      return timerSeq;
    },
    setInterval() { return 0; },
    clearTimer(id) { timers.delete(id); },
    beginRound() {
      if (roundQueue) return '';
      roundIdSeq++;
      roundQueue = [];
      roundRecords = new Map();
      return 'round-' + roundIdSeq;
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
    recordResult(pid, result, scoreDelta, meta) {
      if (!roundQueue) return false;
      // 同一 (round, player) 幂等：后一次覆盖前一次
      roundRecords.set(pid, { playerId: pid, result, scoreDelta: scoreDelta || 0, meta: meta || '' });
      return true;
    },
    endRound() {
      if (!roundQueue) return false;
      const q = roundQueue;
      const recs = roundRecords;
      roundQueue = null;
      roundRecords = null;
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
      for (const r of recs.values()) records.push(r);
      return true;
    },
    getRoundId() { return roundQueue ? 'round' : ''; },
    lastRoundError() { return lastError; },
    getBalance(pid) { return wallet.get(pid) || 0; },
    getBalanceVersion(pid) { return walletVersion.get(pid) || 0; },
  };

  env.drain = function (maxSteps = 10000) {
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
    if (!roster.some((r) => r.id === pid)) roster.push({ id: pid, name: name || 'name-' + pid });
    game && game.onPlayerJoin && game.onPlayerJoin(pid, name || 'name-' + pid);
  };
  env.finishCount = () => finishCount;
  env.records = records;
  return env;
}

let game = null;

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

// 用引擎同源算法驱动一整局
function playFullGame(env, pid, bet) {
  game.onAction(pid, 'start_game', { bet });
  const start = collect(env.events, 'mm:start').pop();
  assert.ok(start, 'mm:start 应广播');
  let boardNow = start.board.slice();
  let scoreNow = 0;
  let swaps = 0;
  for (let guard = 0; guard < 200; guard++) {
    if (collect(env.events, 'mm:game_over').length > 0) break;
    const mv = findAnyMove(boardNow);
    assert.ok(mv, '死局应由服务端洗牌兜底');
    game.onAction(pid, 'swap', { a: mv.a, b: mv.b });
    const sw = collect(env.events, 'mm:swap').pop();
    assert.ok(sw, 'findAnyMove 给出的交换必须被服务端受理');
    // 每步都校验步骤协议：影子客户端回放 == 服务端最终棋盘
    assert.deepEqual(applySteps(sw.steps, boardNow), sw.board, '步骤回放不一致');
    swaps++;
    scoreNow = sw.score;
    boardNow = sw.board.slice();
  }
  return { start, swaps, score: scoreNow, board: boardNow };
}

console.log('集成场景 A：完整对局（开局扣费 → 游玩 → 终局派奖，账务守恒）');
{
  const env = createPlatform(['p1'], { p1: 5000 });
  game = loadBundle(env);
  game.onInit();

  test('mm:init 携带规则快照', () => {
    const init = collect(env.events, 'mm:init').pop();
    assert.equal(init.config.cols, COLS);
    assert.equal(init.config.moves, 20);
    assert.deepEqual(init.config.bets, [10, 50, 100]);
    assert.equal(init.phase, 'idle');
  });

  test('state:sync 应答携带本人身份/余额/版本', () => {
    game.onSync('p1');
    const sync = env.priv['p1'].filter((m) => m.event === 'mm:sync').pop();
    assert.equal(sync.data.playerId, 'p1');
    assert.equal(sync.data.balance, 5000);
    assert.equal(typeof sync.data.version, 'number');
  });

  const run = playFullGame(env, 'p1', 50);

  test('mm:start 携带合法棋盘与承诺（扣费见下方账务守恒断言）', () => {
    assert.equal(run.start.board.length, N);
    assert.equal(hasAnyMatch(run.start.board), false);
    assert.ok(findAnyMove(run.start.board));
    assert.ok(run.start.commitment, '公平随机承诺哈希应为非空');
  });

  test('20 步后终局：分数/星级/派奖一致，账务守恒', () => {
    const overs = collect(env.events, 'mm:game_over');
    assert.equal(overs.length, 1);
    const over = overs[0];
    assert.equal(over.reason, 'moves_used');
    assert.equal(over.bet, 50);
    assert.equal(over.score, run.score);
    // 星级档位复核
    const tiers = collect(env.events, 'mm:init').pop().config.tiers;
    let stars = 0, mult = 0;
    for (const t of tiers) if (over.score >= t.min) { stars = t.star; mult = t.mult; }
    assert.equal(over.stars, stars);
    assert.equal(over.payout, Math.floor(50 * mult));
    assert.equal(over.committed, true);
    assert.equal(env.wallet.get('p1'), 5000 - 50 + over.payout);
    // 最后一步带 final 标记，其余步骤不带
    const swapsAll = collect(env.events, 'mm:swap');
    assert.equal(swapsAll.length, 20);
    assert.equal(swapsAll[swapsAll.length - 1].final, true, '最后一步应带 final');
    assert.equal(swapsAll[swapsAll.length - 2].final, undefined, '非最后一步不应带 final');
  });

  test('对局记录：结算回合内登记一条，净变动与 win/lose 一致', () => {
    const over = collect(env.events, 'mm:game_over')[0];
    const recs = env.records.filter((r) => r.playerId === 'p1');
    assert.equal(recs.length, 1, '一局恰好登记一条');
    const net = over.payout - over.bet;
    assert.equal(recs[0].scoreDelta, net);
    assert.equal(recs[0].result, net > 0 ? 'win' : net < 0 ? 'lose' : 'draw');
    assert.ok(recs[0].meta.indexOf('score=' + over.score) === 0, 'meta 携带本局分数');
  });

  test('对局后可再开新局', () => {
    game.onAction('p1', 'start_game', { bet: 10 });
    const starts = collect(env.events, 'mm:start');
    assert.equal(starts.length, 2);
    assert.equal(env.wallet.get('p1'), 5000 - 50 + collect(env.events, 'mm:game_over')[0].payout - 10);
  });
}

console.log('集成场景 B：非法动作与余额不足');
{
  const env = createPlatform(['p1'], { p1: 5 });
  game = loadBundle(env);
  game.onInit();

  test('swap 在 idle 态被拒', () => {
    game.onAction('p1', 'swap', { a: 0, b: 1 });
    const errs = env.priv['p1'].filter((m) => m.event === 'mm:error');
    assert.ok(errs.some((e) => /对局/.test(e.data.message)));
  });

  test('无效注档被拒', () => {
    game.onAction('p1', 'start_game', { bet: 7 });
    const errs = env.priv['p1'].filter((m) => m.event === 'mm:error');
    assert.ok(errs.some((e) => /档位/.test(e.data.message)));
    assert.equal(collect(env.events, 'mm:start').length, 0);
  });

  test('余额不足：真实原因透出且钱包不动', () => {
    game.onAction('p1', 'start_game', { bet: 10 });
    const errs = env.priv['p1'].filter((m) => m.event === 'mm:error');
    assert.ok(errs.some((e) => /balance|余额/.test(e.data.message)), JSON.stringify(errs));
    assert.equal(env.wallet.get('p1'), 5);
    assert.equal(collect(env.events, 'mm:start').length, 0);
  });

  test('开局失败不登记对局记录', () => {
    assert.equal(env.records.length, 0);
  });
}

console.log('集成场景 C：非法交换 / give_up / 离席结算 / 对局中 sync');
{
  const env = createPlatform(['p1'], { p1: 3000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'start_game', { bet: 10 });
  const start = collect(env.events, 'mm:start').pop();
  assert.equal(env.wallet.get('p1'), 2990);

  test('格式与相邻性校验', () => {
    game.onAction('p1', 'swap', { a: 0, b: 9 });
    game.onAction('p1', 'swap', { a: -1, b: 0 });
    game.onAction('p1', 'swap', { a: 'x', b: 0 });
    const errs = env.priv['p1'].filter((m) => m.event === 'mm:error');
    assert.ok(errs.some((e) => /相邻/.test(e.data.message)));
    assert.ok(errs.some((e) => /格式/.test(e.data.message)));
  });

  test('无匹配交换被拒且状态不变', () => {
    const b = start.board;
    // 找一对交换后不产生匹配的相邻格（对角条纹底板几乎全是）
    let done = false;
    for (let i = 0; i < N && !done; i++) {
      if (i % COLS < COLS - 1 && kindOf(b[i]) !== 4 && kindOf(b[i + 1]) !== 4) {
        const t = b.slice();
        const tmp = t[i]; t[i] = t[i + 1]; t[i + 1] = tmp;
        if (!hasAnyMatch(t)) {
          game.onAction('p1', 'swap', { a: i, b: i + 1 });
          const errs = env.priv['p1'].filter((m) => m.event === 'mm:error');
          assert.ok(errs.some((e) => /消除/.test(e.data.message)));
          done = true;
        }
      }
    }
    assert.equal(collect(env.events, 'mm:swap').length, 0, '无效交换不应产生 mm:swap');
  });

  test('有效交换推进状态且 mm:swap 与引擎内部一致', () => {
    const b = collect(env.events, 'mm:start').pop().board;
    const mv = findAnyMove(b);
    game.onAction('p1', 'swap', { a: mv.a, b: mv.b });
    const sw = collect(env.events, 'mm:swap').pop();
    assert.ok(sw, '有效交换应有 mm:swap');
    assert.equal(sw.movesLeft, 19);
    assert.ok(sw.gain > 0);
    assert.equal(sw.score, sw.gain);
    assert.deepEqual(applySteps(sw.steps, b), sw.board, '步骤回放一致性');
  });

  test('对局中 state:sync 返回相同棋盘与分数', () => {
    game.onSync('p1');
    const sync = env.priv['p1'].filter((m) => m.event === 'mm:sync').pop();
    const sw = collect(env.events, 'mm:swap').pop();
    assert.equal(sync.data.game.board.length, N);
    assert.deepEqual(sync.data.game.board, sw.board);
    assert.equal(sync.data.game.score, sw.score);
    assert.equal(sync.data.game.movesLeft, sw.movesLeft);
  });

  test('give_up：按当前分数结算并回到 over', () => {
    game.onAction('p1', 'give_up', {});
    const over = collect(env.events, 'mm:game_over').pop();
    assert.equal(over.reason, 'give_up');
    assert.equal(over.committed, true);
    const sw = collect(env.events, 'mm:swap').pop();
    assert.equal(over.score, sw.score);
    assert.equal(env.wallet.get('p1'), 2990 + over.payout);
    // 0 奖金（分数 < 600）也必须登记输局记录
    const recs = env.records.filter((r) => r.playerId === 'p1');
    assert.equal(recs.length, 1, '0 奖金仍应登记对局记录');
    assert.equal(recs[0].scoreDelta, over.payout - 10);
    assert.equal(recs[0].result, over.payout > 10 ? 'win' : 'lose');
    game.onSync('p1');
    const sync = env.priv['p1'].filter((m) => m.event === 'mm:sync').pop();
    assert.equal(sync.data.phase, 'over');
  });
}

console.log('集成场景 D：离席宽限 —— 逾期结算与归队续局');
{
  const env = createPlatform(['p1'], { p1: 1000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'start_game', { bet: 100 });
  assert.equal(env.wallet.get('p1'), 900);
  const b = collect(env.events, 'mm:start').pop().board;
  const mv = findAnyMove(b);
  game.onAction('p1', 'swap', { a: mv.a, b: mv.b });
  const sw = collect(env.events, 'mm:swap').pop();
  assert.ok(sw);

  env.leave('p1');

  test('宽限期内断线不结算', () => {
    assert.equal(collect(env.events, 'mm:game_over').length, 0);
  });

  // 虚拟时钟推进到宽限逾期（drain 会执行挂起的定时器）
  env.drain();

  const over = collect(env.events, 'mm:game_over').pop();
  test('宽限逾期按当前分数结算：reason=leave，账务一致', () => {
    assert.ok(over, '应产生 mm:game_over');
    assert.equal(over.reason, 'leave');
    assert.equal(over.score, sw.score);
    assert.equal(env.wallet.get('p1'), 900 + over.payout);
    assert.equal(over.committed, true);
  });

  test('离席结算同样登记对局记录', () => {
    const recs = env.records.filter((r) => r.playerId === 'p1');
    assert.equal(recs.length, 1);
    assert.equal(recs[0].scoreDelta, over.payout - 100);
    assert.equal(recs[0].result, over.payout > 100 ? 'win' : 'lose');
  });

  test('结算后再次离席不重复结算', () => {
    env.leave('p1');
    env.drain();
    assert.equal(collect(env.events, 'mm:game_over').length, 1);
  });
}

console.log('集成场景 D2：宽限期内归队 → 撤销结算、对局续行');
{
  const env = createPlatform(['p1'], { p1: 800 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'start_game', { bet: 100 });
  assert.equal(env.wallet.get('p1'), 700);
  const b = collect(env.events, 'mm:start').pop().board;
  const mv = findAnyMove(b);
  game.onAction('p1', 'swap', { a: mv.a, b: mv.b });
  assert.ok(collect(env.events, 'mm:swap').pop());

  env.leave('p1');
  env.join('p1', 'name-p1'); // 宽限期内归队
  env.drain(); // 推进全部定时器：不应有任何结算

  test('归队撤销离席结算，对局仍在进行', () => {
    assert.equal(collect(env.events, 'mm:game_over').length, 0);
    game.onSync('p1');
    const sync = env.priv['p1'].filter((m) => m.event === 'mm:sync').pop();
    assert.equal(sync.data.phase, 'playing');
    assert.equal(sync.data.game.movesLeft, 19);
    assert.equal(env.wallet.get('p1'), 700);
  });

  test('归队后可继续走子并正常结算', () => {
    const cur = collect(env.events, 'mm:swap').pop();
    const mv2 = findAnyMove(cur.board);
    game.onAction('p1', 'swap', { a: mv2.a, b: mv2.b });
    assert.equal(collect(env.events, 'mm:swap').length, 2);
  });

  test('会话收尾立即结算进行中的局', () => {
    game.onFinish();
    const over = collect(env.events, 'mm:game_over').pop();
    assert.ok(over);
    assert.equal(over.reason, 'session_end');
    assert.equal(env.wallet.get('p1'), 700 + over.payout);
  });
}

console.log('集成场景 E：非公平随机回退路径（平台不支持公平随机）');
{
  const env = createPlatform(['p1'], { p1: 5000 }, { fair: false });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'start_game', { bet: 10 });
  const start = collect(env.events, 'mm:start').pop();

  test('公平随机不可用时正常开局（承诺为空）且棋盘合法', () => {
    assert.equal(start.commitment, '');
    assert.equal(hasAnyMatch(start.board), false);
    assert.ok(findAnyMove(start.board));
    assert.equal(env.wallet.get('p1'), 4990);
  });
}

console.log('RTP 基线：随机策略（findAnyMove 首个可行步）批量对局');
{
  const env = createPlatform(['bot'], { bot: 1e9 });
  game = loadBundle(env);
  game.onInit();

  const GAMES = 300;
  const BET = 10;
  let totalPayout = 0;
  let netWins = 0;
  let star3 = 0;
  const oversBefore = collect(env.events, 'mm:game_over').length;

  for (let g = 0; g < GAMES; g++) {
    game.onAction('bot', 'start_game', { bet: BET });
    const localOver = collect(env.events, 'mm:game_over').length;
    let boardNow = collect(env.events, 'mm:start').pop().board.slice();
    for (let step = 0; step < 20; step++) {
      if (collect(env.events, 'mm:game_over').length > localOver) break;
      const mv = findAnyMove(boardNow);
      assert.ok(mv, '死局应由服务端洗牌兜底');
      game.onAction('bot', 'swap', { a: mv.a, b: mv.b });
      const sw = collect(env.events, 'mm:swap').pop();
      assert.ok(sw, '随机可行步必须被受理');
      boardNow = sw.board.slice();
    }
    assert.equal(collect(env.events, 'mm:game_over').length, localOver + 1, '每局恰好终局一次');
    const over = collect(env.events, 'mm:game_over').pop();
    totalPayout += over.payout;
    if (over.payout > BET) netWins++;
    if (over.stars >= 3) star3++;
  }
  assert.equal(collect(env.events, 'mm:game_over').length, oversBefore + GAMES);

  const rtpPct = (totalPayout / (GAMES * BET)) * 100;
  test('RTP 基线：每局一条对局记录，总账守恒', () => {
    assert.equal(env.records.length, GAMES, '每局恰好一条对局记录');
    assert.equal(env.wallet.get('bot'), 1e9 - GAMES * BET + totalPayout, '总账守恒');
    assert.ok(rtpPct >= 0 && rtpPct <= 500, 'RTP 百分比落在合理区间');
  });
  console.log(`  随机策略 ${GAMES} 局（bet=${BET}）：RTP ≈ ${rtpPct.toFixed(1)}%，净胜局 ${(netWins / GAMES * 100).toFixed(1)}%，3 星率 ${(star3 / GAMES * 100).toFixed(1)}%`);
  console.log('  ↑ 消消乐为技巧型玩法，真人实际回报高于该随机策略基线；rtpDeclared 以此校准（见 README 平台接入）');
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
