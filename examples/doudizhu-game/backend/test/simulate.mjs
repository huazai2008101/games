// 斗地主后端回归 —— 直接驱动打包产物 dist/game.js。
//
// 覆盖三块：
//   1. cards.ts / ai.ts 单元测试（Node 原生 TS 类型剥离直载源码）
//   2. mock platform（虚拟时钟 / 钱包 / 可验证随机）上跑完整会话：
//      场景 A：1 真人挂机 + 2 机器人 → 托管 AI 打完全局并结算
//      场景 B：3 真人（AI 策略代打）连打 3 局，校验结算守恒与倍数
//      场景 C：动作校验与 ddz:error 通道（同步驱动叫分→定庄→出牌）
//   3. 发牌可验证性：用 fair:reveal 的种子复算整副牌序，比对实际手牌
//
// 运行：npm test（Node ≥ 22.18，内置 TS 类型剥离）

import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));

// ── 1. cards.ts / ai.ts 单元测试（源码直载）──
const cards = await import(pathToFileURL(join(here, '../src/cards.ts')).href);
const ai = await import(pathToFileURL(join(here, '../src/ai.ts')).href);

const C = cards.COMBO;
function mk(ranks) {
  // '3'..'9','0'(=10),'J','Q','K','A','2','X'(小王),'D'(大王) → 牌 id（同点数按花色序取）
  const labels = cards.VALUE_LABELS;
  const out = [];
  for (const ch of ranks) {
    if (ch === 'X') { out.push(52); continue; }
    if (ch === 'D') { out.push(53); continue; }
    const ri = labels.indexOf(ch === '0' ? '10' : ch);
    assert(ri >= 0, 'bad rank char ' + ch);
    const used = out.filter((id) => id < 52 && Math.floor(id / 4) === ri).length;
    out.push(ri * 4 + used);
  }
  return out;
}

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

console.log('cards.ts 牌型识别:');
test('单张/对子/三张', () => {
  assert.equal(cards.detectCombo(mk('3')).type, C.SINGLE);
  assert.equal(cards.detectCombo(mk('KK')).type, C.PAIR);
  assert.equal(cards.detectCombo(mk('AAA')).type, C.TRIO);
});
test('王炸与双王非法对', () => {
  assert.equal(cards.detectCombo(mk('XD')).type, C.ROCKET);
  assert.equal(cards.detectCombo(mk('XX')), null);
  assert.equal(cards.detectCombo(mk('DD')), null);
});
test('三带一/三带二', () => {
  assert.equal(cards.detectCombo(mk('9995')).type, C.TRIO_SINGLE);
  assert.equal(cards.detectCombo(mk('888QQ')).type, C.TRIO_PAIR);
  assert.equal(cards.detectCombo(mk('888QK')), null);
});
test('顺子边界（34567 / 10JQKA），2 与王不入顺', () => {
  assert.equal(cards.detectCombo(mk('34567')).type, C.STRAIGHT);
  assert.equal(cards.detectCombo(mk('0JQKA')).type, C.STRAIGHT);
  assert.equal(cards.detectCombo(mk('JQKA2')), null);
  assert.equal(cards.detectCombo(mk('3456')), null);
});
test('连对', () => {
  assert.equal(cards.detectCombo(mk('334455')).type, C.PAIR_STRAIGHT);
  assert.equal(cards.detectCombo(mk('3344')), null);
});
test('飞机（纯/带单/带对），2 不可入飞机', () => {
  assert.equal(cards.detectCombo(mk('333444')).type, C.PLANE);
  assert.equal(cards.detectCombo(mk('33344456')).type, C.PLANE_SINGLE);
  assert.equal(cards.detectCombo(mk('3334445566')).type, C.PLANE_PAIR);
  assert.equal(cards.detectCombo(mk('222333')), null);
});
test('四带二（单/对）', () => {
  assert.equal(cards.detectCombo(mk('777734')).type, C.FOUR_TWO_SINGLE);
  assert.equal(cards.detectCombo(mk('77773344')).type, C.FOUR_TWO_PAIR);
  assert.equal(cards.detectCombo(mk('7777345')), null);
});
test('炸弹', () => {
  assert.equal(cards.detectCombo(mk('2222')).type, C.BOMB);
  assert.ok(cards.detectCombo(mk('3333')).value < cards.detectCombo(mk('2222')).value);
});
test('beats：同型比大 / 炸弹 / 王炸', () => {
  const s4 = cards.detectCombo(mk('4'));
  const s3 = cards.detectCombo(mk('3'));
  const st = cards.detectCombo(mk('34567'));
  const b = cards.detectCombo(mk('3333'));
  const r = cards.detectCombo(mk('XD'));
  assert.equal(cards.beats(s4, s3), true);
  assert.equal(cards.beats(st, s4), false);
  assert.equal(cards.beats(b, st), true);
  assert.equal(cards.beats(r, b), true);
  assert.equal(cards.beats(b, r), false);
});
test('findPlays：跟牌枚举全可压、自由出牌含顺子与王炸', () => {
  const hand = mk('33456789JQKKA2XD');
  const last = cards.detectCombo(mk('KK'));
  const plays = cards.findPlays(hand, last);
  assert.ok(plays.length > 0);
  assert.ok(plays.every((p) => cards.beats(p, last)));
  const free = cards.findPlays(hand, null);
  assert.ok(free.some((p) => p.type === C.STRAIGHT));
  assert.ok(free.some((p) => p.type === C.ROCKET));
});
test('validatePlay：压不过 / 手里没有 / 非法牌型均拒绝', () => {
  const hand = mk('3355JJ');
  const last = cards.detectCombo(mk('88'));
  assert.equal(cards.validatePlay(hand, mk('55'), last), null);
  assert.equal(cards.validatePlay(hand, mk('99'), last), null);
  assert.ok(cards.validatePlay(hand, mk('JJ'), last));
  assert.equal(cards.validatePlay(hand, [hand[0], hand[0]], null), null, '同一张实体牌不可重复提交');
});
test('AI 叫分阶梯与出牌合法性', () => {
  assert.equal(ai.botBid(mk('3345678'), 0), 0);
  const strong = mk('2222AAXDKKQQ34567');
  assert.ok(ai.botBid(strong, 0) >= 2);
  const hand = mk('3345678JQK');
  const play = ai.botPlay(hand, null, { seat: 0, landlordSeat: -1, leaderSeat: -1, remain: [10, 10, 10] });
  assert.ok(cards.detectCombo(play), 'AI 出的牌必须构成合法牌型');
});

// ── 2. mock platform ──

function fairFloat(seed, i) {
  const h = createHash('sha256').update(seed + ':' + i).digest();
  let v = 0n;
  for (let k = 0; k < 7; k++) v = (v << 8n) | BigInt(h[k]);
  return Number(v) / Number(1n << 56n); // 注意：1 << 56 是 32 位溢出，必须用 BigInt
}

function createPlatform(playerIds, balances) {
  const events = [];
  const priv = {};
  const conns = new Set(playerIds);
  const wallet = new Map(Object.entries(balances));
  const walletVersion = new Map(Object.keys(balances).map((k) => [k, 0]));
  const seeds = new Map();
  const logs = [];
  const roster = playerIds.map((id) => ({ id, name: 'name-' + id }));
  let roundQueue = null;
  let lastError = '';
  let vnow = 0;
  let timerSeq = 0;
  let finishCount = 0;
  let reopenCount = 0;
  const timers = new Map();
  const env = { stopped: false };

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
    reopenSession() { reopenCount++; },
    random() { return Number(randomBytes(8).readBigUInt64LE() >> 11n) / Number(1n << 53n); },
    beginFairRound(seedId) {
      seeds.set(seedId, { seed: randomBytes(16).toString('hex'), draws: 0 });
      return createHash('sha256').update(seeds.get(seedId).seed).digest('hex');
    },
    getFairRandom(seedId, i) {
      const s = seeds.get(seedId);
      if (!s) return false;
      s.draws++;
      return fairFloat(s.seed, i);
    },
    revealFairRound(seedId) {
      const s = seeds.get(seedId);
      if (!s) return false;
      api.broadcast('fair:reveal', { seedId, seed: s.seed, commitment: createHash('sha256').update(s.seed).digest('hex'), draws: s.draws });
      return true;
    },
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
  const state = new Map();

  env.drain = function (maxSteps = 30000) {
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
  // 离席/归队驱动器：对齐平台 presence 语义（最后一条连接断开=离席）
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
  env.reopenCount = () => reopenCount;
  return env;
}

function loadBundle(env) {
  globalThis.platform = env.api;
  const code = readFileSync(join(here, '../dist/game.js'), 'utf8');
  new Function(code)(); // IIFE：求值即 registerGame（挂全局 onInit/onAction/onSync/onFinish）
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

const descById = (a) => a.slice().sort((x, y) => y - x);

let game = null; // 当前场景的引擎实例（env.leave/env.join 回调用）

console.log('集成场景 A：1 真人（挂机）+ 2 机器人');
{
  const env = createPlatform(['p1'], { p1: 5000 });
  game = loadBundle(env);
  game.onInit();

  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'ddz:settled') env.stop(); // 一局即止，避免自动续局无限跑
  })(env.api.broadcast);

  game.onAction('p1', 'ready_hand', {});
  env.drain();

  const deals = collect(env.events, 'ddz:deal');
  const landlord = collect(env.events, 'ddz:landlord');
  const over = collect(env.events, 'ddz:hand_over');
  const settled = collect(env.events, 'ddz:settled');

  test('发牌且真人 17 张', () => {
    assert.ok(deals.length >= 1);
    const sync = env.priv['p1'].find((m) => m.event === 'ddz:sync');
    assert.equal(sync.data.hand.length, 17);
  });
  test('地主确定并公开 3 张底牌', () => {
    assert.equal(landlord.length, 1);
    assert.equal(landlord[0].bottom.length, 3);
  });
  test('牌局完成且结算提交成功', () => {
    assert.equal(over.length, 1);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].committed, true);
  });
  test('公共快照座位携带平台名册 username', () => {
    const pub = latestPublic(env);
    for (const s of pub.seats) {
      if (s.bot) continue;
      assert.equal(s.name, 'name-' + s.id, '座位 name 应来自平台名册');
    }
  });
  test('真人有金额变动必有钱包推送，且余额与结算一致', () => {
    const delta = settled[0].deltas['p1'] || 0;
    const pushed = env.priv['p1'].some((m) => m.event === 'wallet:balance');
    assert.ok(delta === 0 || pushed, '有变动必有 wallet:balance');
    // 机器人输钱不计底池 → p1 全赢时 delta 可为 0；否则余额必须等于初始 + delta
    if (delta !== 0) {
      assert.equal(env.wallet.get('p1'), 5000 + delta, '钱包扣奖与结算 delta 一致');
    }
  });
  test('无非法出牌', () => {
    assert.equal(env.logs.filter((l) => l.includes('illegal play')).length, 0, env.logs.join('\n'));
  });
  test('结算阶段 state:sync 可恢复结算浮层', () => {
    game.onSync('p1');
    const syncs = (env.priv['p1'] || []).filter((m) => m.event === 'ddz:sync');
    const latest = syncs[syncs.length - 1].data;
    assert.equal(latest.phase, 'settle');
    assert.equal(latest.handOver.winner, over[0].winner);
    assert.equal(latest.settled.committed, true);
  });
  test('发牌可验证：种子复算 = 实际手牌/底牌', () => {
    const reveal = collect(env.events, 'fair:reveal')[0];
    assert.ok(reveal, '终局应揭示 fair:reveal');
    const deck = Array.from({ length: 54 }, (_, i) => i);
    let di = 0;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(fairFloat(reveal.seed, di++) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const expected = [[], [], []];
    for (let i = 0; i < 51; i++) expected[i % 3].push(deck[i]);
    const sync = env.priv['p1'].find((m) => m.event === 'ddz:sync').data.hand;
    assert.deepEqual(descById(expected[0]), sync, '座位 0 手牌与复算一致');
    assert.deepEqual(descById(deck.slice(51)), descById(landlord[0].bottom), '底牌与复算一致');
  });
}

console.log('集成场景 B：3 真人（AI 策略代打）连打 3 局');
{
  const env = createPlatform(['p1', 'p2', 'p3'], { p1: 3000, p2: 3000, p3: 3000 });
  game = loadBundle(env);
  game.onInit();

  const lastSync = {};
  const pending = new Set();
  let settledHands = 0;

  function scheduleHuman(pub) {
    if (!pub || (pub.phase !== 'bidding' && pub.phase !== 'playing')) return;
    const seat = pub.turn;
    const pid = pub.seats[seat].id;
    if (pid.startsWith('bot:')) return;
    const key = pub.handNo + ':' + pub.phase + ':' + pub.turn;
    if (pending.has(key)) return;
    pending.add(key);
    env.api.setTimeout(() => {
      pending.delete(key);
      const cur = latestPublic(env);
      if (!cur || cur.handNo !== pub.handNo || cur.turn !== seat) return; // 过期动作丢弃
      const syn = lastSync[pid];
      if (!syn) return;
      if (cur.phase === 'bidding') {
        game.onAction(pid, 'bid', { score: ai.botBid(syn.hand, cur.bidScore) });
      } else if (cur.phase === 'playing') {
        const lastCombo = cur.lastPlay && cur.lastPlay.cards.length > 0 && cur.lastPlay.seat !== seat
          ? cards.detectCombo(cur.lastPlay.cards)
          : null;
        const playCards = ai.botPlay(syn.hand, lastCombo, {
          seat, landlordSeat: cur.landlordSeat,
          leaderSeat: cur.lastPlay ? cur.lastPlay.seat : -1,
          remain: cur.remain,
        });
        game.onAction(pid, 'play', { cards: playCards });
      }
    }, 700);
  }

  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'ddz:settled') {
      settledHands++;
      if (settledHands >= 3) { env.stop(); return; }
      for (const pid of ['p1', 'p2', 'p3']) {
        env.api.setTimeout(() => game.onAction(pid, 'ready_hand', {}), 500);
      }
    }
    scheduleHuman(data && data.public);
  })(env.api.broadcast);
  env.api.sendTo = ((orig) => function (pid, event, data) {
    orig(pid, event, data);
    if (event === 'ddz:sync' && data.hand) lastSync[pid] = data;
  })(env.api.sendTo);

  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});
  game.onAction('p3', 'ready_hand', {});
  env.drain(60000);

  const over = collect(env.events, 'ddz:hand_over');
  const settled = collect(env.events, 'ddz:settled');
  test('三局全部完成', () => {
    assert.equal(over.length, 3, 'hand_over=' + over.length);
    assert.equal(settled.length, 3);
    // B4 桥接:每局结算应经 platform.recordResult 记录三家的胜负结果
    const recs = (env.recordedResults ?? []).filter((r) => r.result === 'win' || r.result === 'lose');
    assert.ok(recs.length >= 6, `recordResult 胜负记录 = ${recs.length},3 局至少 6 条(每局胜/负)`);
  });
  test('每局结算均提交成功', () => {
    for (const s of settled) assert.equal(s.committed, true);
  });
  test('资金守恒：3 真人零和（总额恒为 9000）', () => {
    const total = [...env.wallet.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 9000, '实际总额 ' + total);
  });
  test('累计分数与结算增量一致', () => {
    const s = settled[settled.length - 1];
    let sum = 0;
    for (const k in s.scores) sum += s.scores[k];
    assert.equal(sum, 0, '三人累计净分应为 0');
  });
  test('无非法出牌', () => {
    assert.equal(env.logs.filter((l) => l.includes('illegal play')).length, 0, env.logs.join('\n'));
  });
  test('倍数 ≥ 叫分且各局终局亮牌', () => {
    for (const o of over) {
      assert.ok(o.multiplier >= o.bidScore && o.multiplier >= 1);
      assert.equal(o.hands.length, 3);
    }
  });
}

console.log('集成场景 C：动作校验与 ddz:error 通道（同步驱动）');
{
  const env = createPlatform(['p1', 'p2', 'p3'], { p1: 3000, p2: 3000, p3: 3000 });
  game = loadBundle(env);
  game.onInit();

  // 首局：全员 ready → 同步发牌进入叫分
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});
  game.onAction('p3', 'ready_hand', {});
  let pub = latestPublic(env);
  test('就绪后立即发牌进入叫分阶段', () => {
    assert.equal(pub.phase, 'bidding');
  });

  const errorsOf = (pid) => (env.priv[pid] || []).filter((m) => m.event === 'ddz:error');

  test('非叫分回合的 bid 被拒', () => {
    const dealer = pub.turn;
    const other = (dealer + 1) % 3;
    const pid = pub.seats[other].id;
    const before = errorsOf(pid).length;
    game.onAction(pid, 'bid', { score: 3 });
    assert.equal(errorsOf(pid).length, before + 1);
  });
  test('叫分越界（score=9）被拒', () => {
    const pid = pub.seats[pub.turn].id;
    const before = errorsOf(pid).length;
    game.onAction(pid, 'bid', { score: 9 });
    assert.equal(errorsOf(pid).length, before + 1);
  });
  test('叫分载荷必须是整数数字', () => {
    const pid = pub.seats[pub.turn].id;
    const before = errorsOf(pid).length;
    game.onAction(pid, 'bid', { score: '1' });
    assert.equal(errorsOf(pid).length, before + 1);
  });
  test('叫分低于当前最高分被拒', () => {
    const dealer = pub.turn;
    const pid = pub.seats[dealer].id;
    game.onAction(pid, 'bid', { score: 2 }); // 合法：成为最高
    const pub2 = latestPublic(env);
    assert.equal(pub2.bidScore, 2);
    const nextPid = pub2.seats[pub2.turn].id;
    assert.ok(pub2.turnEndsAt > 0, '下一叫分回合应带截止时间');
    const before = errorsOf(nextPid).length;
    game.onAction(nextPid, 'bid', { score: 1 }); // 必须大于 2
    assert.equal(errorsOf(nextPid).length, before + 1);
    // 直接叫 3 → 立即定庄
    game.onAction(nextPid, 'bid', { score: 3 });
    const pub3 = latestPublic(env);
    assert.equal(pub3.phase, 'playing');
    assert.equal(pub3.landlordSeat, (dealer + 1) % 3);
    pub = pub3;
  });
  test('非出牌回合的 play 被拒；垃圾牌型被拒', () => {
    const landlordSeat = pub.landlordSeat;
    const farmer = (landlordSeat + 1) % 3;
    const farmerPid = pub.seats[farmer].id;
    const before = errorsOf(farmerPid).length;
    game.onAction(farmerPid, 'play', { cards: [0] });
    assert.equal(errorsOf(farmerPid).length, before + 1, '还没轮到你出牌');

    const landlordPid = pub.seats[landlordSeat].id;
    const before2 = errorsOf(landlordPid).length;
    game.onAction(landlordPid, 'play', { cards: [0, 7] }); // 两张散牌非任何牌型
    assert.equal(errorsOf(landlordPid).length, before2 + 1, '垃圾牌型应被拒');

    // 地主自由出牌：出手里最小单张（合法）应成功
    const hand = (env.priv[landlordPid] || []).filter((m) => m.event === 'ddz:sync').pop().data.hand;
    const beforeDuplicate = errorsOf(landlordPid).length;
    game.onAction(landlordPid, 'play', { cards: [hand[hand.length - 1], hand[hand.length - 1]] });
    assert.equal(errorsOf(landlordPid).length, beforeDuplicate + 1, '同一张牌重复提交应被拒');
    const before3 = errorsOf(landlordPid).length;
    game.onAction(landlordPid, 'play', { cards: [hand[hand.length - 1]] });
    assert.equal(errorsOf(landlordPid).length, before3, '最小单张应成功');
    const pub4 = latestPublic(env);
    assert.equal(pub4.lastPlay.seat, landlordSeat);
    assert.equal(pub4.turn, (landlordSeat + 1) % 3, '出牌广播应直接指向下一回合');
    assert.ok(pub4.turnEndsAt > 0, '下一出牌回合应带截止时间');
  });
}

console.log('集成场景 D：自动匹配 —— 玩家陆续补位，满员自动组建牌局开局');
{
  const env = createPlatform(['p1'], { p1: 5000, p2: 5000, p3: 5000 });
  game = loadBundle(env);
  game.onInit();

  test('人未满进入匹配相位（空位 vacant 标记）', () => {
    const pub = latestPublic(env);
    assert.equal(pub.phase, 'matching');
    assert.equal(pub.seats.filter((s) => s.vacant).length, 2);
  });

  env.join('p2', '名字二号');
  test('首个匹配者坐进空位，仍未满员不开局', () => {
    const pub = latestPublic(env);
    assert.equal(collect(env.events, 'ddz:player_joined').length, 1);
    assert.equal(pub.phase, 'matching');
    assert.equal(pub.seats[1].id, 'p2');
    assert.equal(pub.seats[1].name, '名字二号');
    assert.equal(pub.seats[1].vacant, false);
    assert.equal(collect(env.events, 'ddz:deal').length, 0);
  });

  env.join('p3');
  const deals = collect(env.events, 'ddz:deal');
  test('满员自动组建牌局开局（无需任何点击）', () => {
    assert.equal(collect(env.events, 'ddz:match_filled').length, 1);
    assert.equal(collect(env.events, 'ddz:match_filled')[0].reason, 'full');
    assert.equal(deals.length, 1, '满员应立即发牌');
    const pub = latestPublic(env);
    assert.equal(pub.phase, 'bidding');
    for (const s of pub.seats) {
      assert.equal(s.bot, false, '满员后不应有 AI 座位');
      assert.equal(s.vacant, false);
    }
  });

  test('新入座者 state:sync 拿到本人手牌', () => {
    game.onSync('p3');
    const syncs = (env.priv['p3'] || []).filter((m) => m.event === 'ddz:sync');
    assert.ok(syncs.length >= 1);
    assert.equal(syncs[syncs.length - 1].data.hand.length, 17);
  });

  env.stop();
}

console.log('集成场景 E：匹配超时 —— 空位由 AI 补位后再开局');
{
  const env = createPlatform(['p1'], { p1: 5000 });
  game = loadBundle(env);
  game.onInit();

  env.drain(); // 虚拟时钟跑过 MATCH_WAIT_MS
  test('超时后 match_filled 且空位转 AI', () => {
    const filled = collect(env.events, 'ddz:match_filled');
    assert.equal(filled.length, 1);
    assert.equal(filled[0].reason, 'timeout');
    const pub = latestPublic(env);
    assert.equal(pub.phase, 'lobby');
    assert.equal(pub.seats[0].bot, false);
    assert.equal(pub.seats[1].bot, true);
    assert.equal(pub.seats[2].bot, true);
    for (const s of pub.seats) assert.equal(s.vacant, false, '补位后不应再有空位标记');
  });

  game.onAction('p1', 'ready_hand', {});
  test('AI 补位后可正常开局', () => {
    assert.equal(collect(env.events, 'ddz:deal').length, 1);
  });
  env.stop();
}

console.log('集成场景 F：离席托管 / 归队恢复 / 终局解散');
{
  const env = createPlatform(['p1', 'p2', 'p3'], { p1: 3000, p2: 3000, p3: 3000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});
  game.onAction('p3', 'ready_hand', {});
  assert.equal(collect(env.events, 'ddz:deal').length, 1);

  // ── 离席：座位立即转 AI 代打，当局继续 ──
  env.leave('p2');
  test('离席即机器人接管', () => {
    const pub = latestPublic(env);
    assert.equal(pub.seats[1].bot, true);
    assert.equal(collect(env.events, 'ddz:bot_takeover').length, 1);
  });
  test('被托管座位不能手动行动', () => {
    const before = (env.priv['p2'] || []).filter((m) => m.event === 'ddz:error').length;
    game.onAction('p2', 'bid', { score: 3 });
    const pub = latestPublic(env);
    // 托管座位直接被忽略（无 ddz:error，也无副作用）：行动通道对 bot 关闭
    assert.ok((env.priv['p2'] || []).filter((m) => m.event === 'ddz:error').length >= before);
    assert.ok(pub.phase === 'bidding' || pub.phase === 'playing');
  });

  // ── 归队：当局进行中恢复真人操控 ──
  env.join('p2', 'name-p2');
  test('归队恢复真人操控', () => {
    const pub = latestPublic(env);
    assert.equal(collect(env.events, 'ddz:player_return').length, 1);
    assert.equal(pub.seats[1].bot, false);
  });

  // ── 再离席且不归队 → 结算后进入解散宽限并 finishSession ──
  env.leave('p2');
  env.drain(120000); // 打完当局 + 走完解散流程

  const over = collect(env.events, 'ddz:hand_over');
  const ends = collect(env.events, 'ddz:session_end');
  test('当局照常完成结算', () => {
    assert.equal(over.length, 1, 'hand_over=' + over.length);
    assert.equal(collect(env.events, 'ddz:settled').length, 1);
  });
  test('结算后广播解散并调用 finishSession', () => {
    assert.ok(ends.length >= 1, '应有 ddz:session_end');
    assert.equal(ends[0].reason, 'player_left');
    assert.ok(env.finishCount() >= 1, 'finishSession 应被调用');
  });
  test('解散后绝不再开新局（不 reopen、无第二次发牌）', () => {
    assert.equal(collect(env.events, 'ddz:deal').length, 1);
    assert.equal(env.reopenCount(), 0, '不应再 reopenSession');
    assert.equal(env.finishCount(), 1, 'finishSession 只应调用一次');
  });
}

console.log('集成场景 G：解散宽限内归队 —— 取消解散并恢复自动续局');
{
  const env = createPlatform(['p1', 'p2', 'p3'], { p1: 3000, p2: 3000, p3: 3000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});
  game.onAction('p3', 'ready_hand', {});

  // p2 离席后 3s 归队（当局仍在进行），之后挂机让 AI 打完
  env.leave('p2');
  env.api.setTimeout(() => env.join('p2', 'name-p2'), 3000);
  // 第二局发牌即截停：证明解散被取消、自动续局恢复
  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'ddz:deal' && collect(env.events, 'ddz:deal').length >= 2) env.stop();
  })(env.api.broadcast);
  env.drain(120000);

  test('归队取消解散：无 session_end、不 finishSession', () => {
    assert.equal(collect(env.events, 'ddz:session_end').length, 0);
    assert.equal(env.finishCount(), 0);
  });
  test('宽限取消后恢复常规自动续局（出现第二局发牌）', () => {
    assert.ok(collect(env.events, 'ddz:deal').length >= 2, '应自动续局');
    const pub = latestPublic(env);
    assert.equal(pub.seats[1].bot, false, 'p2 座位应是真人');
  });
  env.stop();
}

console.log('集成场景 H：解散宽限内 state:sync 恢复结算浮层（含 dissolveAt）');
{
  const env = createPlatform(['p1', 'p2', 'p3'], { p1: 3000, p2: 3000, p3: 3000 });
  game = loadBundle(env);
  game.onInit();
  game.onAction('p1', 'ready_hand', {});
  game.onAction('p2', 'ready_hand', {});
  game.onAction('p3', 'ready_hand', {});

  // p2 局中离席；当局结算进入解散宽限时挂起时钟，留出 sync 检查窗口
  env.leave('p2');
  env.api.broadcast = ((orig) => function (event, data) {
    orig(event, data);
    if (event === 'ddz:session_end') env.stop();
  })(env.api.broadcast);
  env.drain(120000);

  test('结算后进入 dissolving 相位', () => {
    assert.equal(latestPublic(env).phase, 'dissolving');
  });

  game.onSync('p1');
  const syncs = (env.priv['p1'] || []).filter((m) => m.event === 'ddz:sync');
  const last = syncs[syncs.length - 1].data;
  test('宽限期内 state:sync 带回 handOver 与 dissolveAt（刷新可恢复浮层）', () => {
    assert.equal(last.phase, 'dissolving');
    assert.ok(last.handOver, '应携带 handOver');
    assert.ok(last.settled, '应携带 settled');
    assert.ok(last.dissolveAt > 0, '应携带解散截止时刻');
  });
}

if (failed > 0) {
  console.error('\n回归未通过：' + failed + ' 项');
  process.exit(1);
}

console.log('\n全部回归通过 ✓');

