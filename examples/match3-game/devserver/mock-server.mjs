// 消消乐本地联调服务器 —— 在没有平台后端的情况下跑通完整前端。
//
// 组成（与象棋/斗地主 devserver 同构，简化为单人 quick 语义）：
//   1. mock platform：实现 backend-sdk 的全部 platform.* API（真定时器、
//      内存钱包、commit-reveal 公平随机、会话名册/在线状态）
//   2. WS 服务（:9998）：按平台线上协议路由 session:ready / state:sync /
//      action / event 消息；首个连接即玩家 p1（quick 单人：连接即开局），
//      其余连接自动转观战
//   3. 静态宿主页（http://localhost:9998/）：模拟大厅 iframe 宿主，
//      通过 postMessage 下发 wsUrl/gameId/ticket
//
// 用法：npm i && npm start
// 需先构建：cd ../backend && npm run build；cd ../frontend && npm run build
// （前端热更时可自行把宿主 iframe 指到 :3202 的 vite dev server）
//
// 环境变量：MM_BALANCE=5000  初始金币

import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 9998;
const PLAYER = 'p1';
const INIT_BALANCE = Number.parseInt(process.env.MM_BALANCE || '5000', 10) || 5000;

const wallet = new Map([[PLAYER, INIT_BALANCE]]);
const walletVersion = new Map([[PLAYER, 0]]);
const conns = new Map(); // playerId → ws
const spectators = new Set();
const roster = new Map([[PLAYER, '玩家 P1']]);
const state = new Map();
const fairSeeds = new Map();
let roundQueue = null;
let roundRecords = null;
let roundIdSeq = 0;
let lastError = '';
const records = []; // recordResult 提交后落库（玩家侧对局记录页数据源）
let engineReady = false;
let sessionFinished = false;
let enginePhase = 'idle'; // 供 /status 观测（mm:init/start/game_over 时更新）

function wsSend(ws, type, action, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type, action, payload, timestamp: Date.now(), seq: 0 }));
  }
}
function broadcast(action, payload) {
  for (const ws of conns.values()) wsSend(ws, 'event', action, payload);
  for (const ws of spectators) wsSend(ws, 'event', action, payload);
}
function sendTo(playerId, action, payload) {
  const ws = conns.get(playerId);
  if (ws) wsSend(ws, 'event', action, payload);
}
function broadcastSystem(action, payload) {
  for (const ws of conns.values()) wsSend(ws, 'system', action, payload);
  for (const ws of spectators) wsSend(ws, 'system', action, payload);
}

const platform = {
  broadcast(action, data) {
    // 观测引擎阶段供 /status 使用（测试等待结算时避免盲等）
    if (action === 'mm:init') enginePhase = data?.phase || 'idle';
    if (action === 'mm:start') enginePhase = 'playing';
    if (action === 'mm:game_over') enginePhase = 'over';
    broadcast(action, data);
  },
  sendTo,
  getGameState: (k) => state.get(k),
  setGameState: (k, v) => state.set(k, v),
  getPlayers: () => [...roster.entries()].map(([id, name]) => ({ id, name })),
  isPlayerOnline: (pid) => {
    const ws = conns.get(pid);
    return !!ws && ws.readyState === 1;
  },
  random: () => Number(randomBytes(8).readBigUInt64LE() >> 11n) / Number(1n << 53n),
  beginFairRound: (seedId) => {
    const seed = randomBytes(16).toString('hex');
    fairSeeds.set(seedId, { seed, draws: 0 });
    return createHash('sha256').update(seed).digest('hex');
  },
  getFairRandom: (seedId, i) => {
    const f = fairSeeds.get(seedId);
    if (!f) return false;
    f.draws = Math.max(f.draws, i + 1);
    const h = createHash('sha256').update(seedId + ':' + f.seed + ':' + i).digest();
    return h.readUInt32BE(0) / 0x100000000;
  },
  revealFairRound: (seedId) => {
    const f = fairSeeds.get(seedId);
    if (!f) return false;
    // 平台会广播揭示事件（seed 可复算每一次抽取）
    broadcast('fair:reveal', { seedId, seed: f.seed, draws: f.draws });
    return { seed: f.seed, commitment: '', draws: f.draws };
  },
  log: (...args) => console.log('[game]', ...args),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearTimer: (id) => { clearTimeout(id); clearInterval(id); },
  beginRound: () => {
    if (roundQueue) return '';
    roundIdSeq++;
    roundQueue = [];
    roundRecords = new Map();
    return 'round-' + roundIdSeq;
  },
  deductBalance: (pid, amount) => {
    if (!roundQueue) return false;
    roundQueue.push({ pid, amount: -amount });
    return true;
  },
  rewardBalance: (pid, amount) => {
    if (!roundQueue) return false;
    roundQueue.push({ pid, amount: +amount });
    return true;
  },
  recordResult: (pid, result, scoreDelta, meta) => {
    if (!roundQueue) return false;
    // 同一 (round, player) 幂等：后一次覆盖前一次
    roundRecords.set(pid, { playerId: pid, result, scoreDelta: scoreDelta || 0, meta: meta || '' });
    return true;
  },
  endRound: () => {
    if (!roundQueue) return false;
    const q = roundQueue;
    const recs = roundRecords;
    roundQueue = null;
    roundRecords = null;
    for (const { pid, amount } of q) {
      if ((wallet.get(pid) || 0) + amount < 0) {
        lastError = 'insufficient balance';
        return false;
      }
    }
    for (const { pid, amount } of q) {
      wallet.set(pid, (wallet.get(pid) || 0) + amount);
      walletVersion.set(pid, (walletVersion.get(pid) || 0) + 1);
    }
    for (const { pid } of q) {
      sendTo(pid, 'wallet:balance', {
        balance: wallet.get(pid), version: walletVersion.get(pid), source: 'round',
      });
    }
    for (const r of recs.values()) records.push(r);
    return true;
  },
  getRoundId: () => (roundQueue ? 'round' : ''),
  lastRoundError: () => lastError,
  getBalance: (pid) => wallet.get(pid) || 0,
  getBalanceVersion: (pid) => walletVersion.get(pid) || 0,
  getRecords: () => records,
  finishSession: () => {
    if (sessionFinished) return;
    sessionFinished = true;
    console.log('[devserver] finishSession → 房间解散');
    broadcastSystem('session:finished', { sessionId: 'mock-session' });
    try { game.onFinish(); } catch { /* 引擎可能已停止 */ }
    setTimeout(() => {
      for (const ws of conns.values()) { try { ws.close(); } catch { /* ignore */ } }
      for (const ws of [...spectators]) { try { ws.close(); } catch { /* ignore */ } }
      conns.clear();
      spectators.clear();
      engineReady = false;
      sessionFinished = false;
      console.log('[devserver] 会话已终止，等待玩家重新进入');
    }, 500);
  },
  reopenSession: () => {
    console.log('[devserver] reopenSession → 会话回到可加入状态');
  },
};

// ── 加载游戏 bundle ──
globalThis.platform = platform;
const bundle = readFileSync(join(here, '../backend/dist/game.js'), 'utf8');
new Function(bundle)();
const game = {
  onInit: globalThis.onInit,
  onAction: globalThis.onAction,
  onSync: globalThis.onSync,
  onFinish: globalThis.onFinish,
  onPlayerJoin: globalThis.onPlayerJoin,
  onPlayerLeave: globalThis.onPlayerLeave,
};

function tryStartEngine() {
  if (engineReady || sessionFinished) return;
  if (!conns.has(PLAYER) || conns.get(PLAYER).readyState !== 1) return;
  engineReady = true;
  console.log('[devserver] 玩家已连接 → 自动组建房间并开局（quick 单人）');
  game.onInit();
  broadcastSystem('session:state', { state: 'ready' });
  broadcastSystem('session:started', { sessionId: 'mock-session', playerCount: 1 });
}

// ── WS + 静态宿主页 ──
const distRoot = join(here, '../frontend/dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400); res.end(); return;
  }
  if (path === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      online: conns.size, ready: engineReady, phase: enginePhase,
      balance: wallet.get(PLAYER), balanceVersion: walletVersion.get(PLAYER),
      records: records,
    }));
    return;
  }
  if (path === '/' || path.startsWith('/host')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(hostPage());
    return;
  }
  const file = resolve(distRoot, '.' + (path === '/' ? '/index.html' : path));
  if (file !== distRoot && !file.startsWith(distRoot + sep)) {
    res.writeHead(403); res.end(); return;
  }
  try {
    const data = readFileSync(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocketServer({ server });

let pendingPlayer = null; // 席位被占时排队等待的连接（页面重载场景）

/** 玩家席空出时让排队连接立即接管 */
function tryBindPending() {
  if (!pendingPlayer) return;
  const cur = conns.get(PLAYER);
  if (cur && cur.readyState === 1) return;
  const ws = pendingPlayer;
  pendingPlayer = null;
  if (ws.readyState === 1) bindPlayer(ws);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const spectate = url.searchParams.get('spectate') === '1';
  if (!spectate) {
    const cur = conns.get(PLAYER);
    if (!cur || cur.readyState !== 1) {
      bindPlayer(ws);
      return;
    }
    // 席位被占：1.5s 内旧连接关闭（页面重载/闪断）→ 新连接接管；
    // 逾期旧连接仍在线（真正的多标签页）→ 最新连接优先，旧连接降级观战
    pendingPlayer = ws;
    setTimeout(() => {
      if (pendingPlayer !== ws || ws.readyState !== 1) return;
      pendingPlayer = null;
      const now = conns.get(PLAYER);
      if (now === ws) return;
      if (now && now.readyState === 1) {
        spectators.add(now);
        wsSend(now, 'system', 'session:spectating', { sessionId: 'mock', playerCount: conns.size });
        conns.delete(PLAYER);
      }
      bindPlayer(ws);
    }, 1500);
    return;
  }
  spectators.add(ws);
  wsSend(ws, 'system', 'session:spectating', { sessionId: 'mock', playerCount: conns.size });
  ws.on('close', () => spectators.delete(ws));
});

function bindPlayer(ws) {
  if (sessionFinished) {
    console.log('[devserver] 旧房间已解散 → 重置会话');
    sessionFinished = false;
    engineReady = false;
  }
  ws.__boundAt = Date.now();
  conns.set(PLAYER, ws);
  console.log('[ws] player', PLAYER, 'connected');

  wsSend(ws, 'system', 'session:joined', {
    sessionId: 'mock-session', gameId: 'mm', playerId: PLAYER,
    playerCount: 1, state: engineReady ? 'playing' : 'waiting',
  });

  if (engineReady && !sessionFinished) {
    try { game.onPlayerJoin?.(PLAYER, roster.get(PLAYER) || ''); } catch (e) { console.error('[game] onPlayerJoin failed:', e); }
  }
  if (!engineReady) tryStartEngine();

  ws.on('message', (raw) => {
    if (conns.get(PLAYER) !== ws) return;
    if (sessionFinished) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'system') {
      if (msg.action === 'state:sync') {
        game.onSync(PLAYER);
      } else if (msg.action === 'session:ready' && !engineReady) {
        tryStartEngine();
      }
    } else if (msg.type === 'action') {
      console.log('[ws] action', PLAYER, msg.action, JSON.stringify(msg.payload || {}).slice(0, 60));
      game.onAction(PLAYER, msg.action, msg.payload);
    }
  });

  ws.on('close', () => {
    if (conns.get(PLAYER) === ws) {
      conns.delete(PLAYER);
      console.log('[ws]', PLAYER, 'disconnected → onPlayerLeave（宽限后结算）');
      if (engineReady && !sessionFinished) {
        try { game.onPlayerLeave?.(PLAYER); } catch (e) { console.error('[game] onPlayerLeave failed:', e); }
      }
      tryBindPending();
    } else {
      spectators.delete(ws);
    }
  });
}

function hostPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>宝石消消乐 · 本地联调</title>
<style>
  body { margin:0; background:#0f1220; color:#e2e8f0; font-family: system-ui; display:flex; flex-direction:column; height:100vh; }
  header { padding:8px 16px; font-size:13px; color:#94a3b8; display:flex; gap:16px; align-items:center; border-bottom:1px solid #1e293b; }
  iframe { flex:1; border:0; width:100%; }
  b { color:#fbbf24; }
</style></head><body>
<header>本地联调宿主 · 单人 quick · <b id="match">-</b> · 余额 <b id="bal">-</b> · 第 2 个及以后的标签页为观战</header>
<iframe id="game" src="/index.html"></iframe>
<script>
  var ORIGIN = 'http://localhost:${PORT}';
  function refresh() {
    fetch('/status').then(function (r) { return r.json(); }).then(function (s) {
      document.getElementById('match').textContent = s.ready ? '已开局' : '等待玩家';
      document.getElementById('bal').textContent = s.balance;
    }).catch(function () {});
  }
  setInterval(refresh, 1000); refresh();
  window.addEventListener('message', function (event) {
    if (event.origin !== 'http://localhost:${PORT}') return;
    var data = event.data || {};
    if (data.type === 'onlinegame:config:request') {
      event.source.postMessage({
        type: 'onlinegame:config:response',
        payload: { wsUrl: 'ws://localhost:${PORT}', gameId: 'mm' }
      }, ORIGIN);
    } else if (data.type === 'onlinegame:ticket:request') {
      event.source.postMessage({
        type: 'onlinegame:ticket:response',
        payload: { ticket: 'dev-ticket-' + Date.now() }
      }, ORIGIN);
    } else if (data.type === 'onlinegame:game:exit') {
      if (window.history.length > 1) window.history.back();
    }
  });
</script>
</body></html>`;
}

server.listen(PORT, () => {
  console.log(`[devserver] WS + 宿主页: http://localhost:${PORT}/  (游戏 iframe → /index.html; 初始金币 ${INIT_BALANCE})`);
});
