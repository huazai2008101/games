// 斗地主本地联调服务器 —— 在没有平台后端的情况下跑通完整前端。
//
// 组成：
//   1. mock platform：实现 backend-sdk 的全部 platform.* API（真定时器、
//      内存钱包、SHA-256 承诺-揭示公平随机、会话名册/在线状态/收尾控制）
//   2. WS 服务（:9998）：按平台线上协议路由 session:ready / state:sync /
//      action / event 消息，并模拟 quick 自动匹配（满足开局人数自动开局）
//   3. 静态宿主页（http://localhost:9998/）：模拟大厅 iframe 宿主，
//      通过 postMessage 下发 wsUrl/gameId/ticket
//
// 用法：npm i && npm start
// 然后打开 http://localhost:9998/ —— 页面内嵌 :3200 的游戏 dev server，
// 需要另开终端：cd ../frontend && npm run dev
//
// 自动匹配（对齐平台 quick 模式语义）：
//   DDZ_PLAYERS=p1,p2,p3       匹配池（同时是可坐的真人席位，最多 3）
//   DDZ_MIN_PLAYERS=3          开局人数，默认取匹配池大小（1..3 截断）
//   连接数达到开局人数 → 自动“组建房间”启动引擎并广播 session:started；
//   不足时客户端的 session:ready 收到与平台一致的
//   “need at least N players to ready” 错误，等待后续玩家补齐。
//   第 4 个及以后的标签页自动转为观战。
//
// 离席/归队（对齐平台 presence 语义）：
//   关闭标签页 → 触发引擎 onPlayerLeave（座位转 AI 托管）；
//   重开标签页 → 触发引擎 onPlayerJoin（恢复真人操控）。

import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 9998;
const slowMode = process.env.DDZ_SLOW_MODE === '1';

// ── 匹配池与开局人数 ──
const playerIds = [...new Set((process.env.DDZ_PLAYERS || 'p1')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean))].slice(0, 3);
if (playerIds.length === 0) playerIds.push('p1');
const parsedMin = Number.parseInt(process.env.DDZ_MIN_PLAYERS || '', 10);
const minPlayers = Number.isFinite(parsedMin)
  ? Math.max(1, Math.min(3, parsedMin))
  : Math.min(playerIds.length, 3);

const wallet = new Map([
  ['p1', 5000], ['p2', 8000], ['p3', 3000],
]);
const walletVersion = new Map([
  ['p1', 0], ['p2', 0], ['p3', 0],
]);
const conns = new Map(); // playerId → ws（p1/p2/p3）
const spectators = new Set();
const roster = new Map(); // 会话名册：playerId → 展示名（连接即入册，对齐平台）
const seeds = new Map();
const state = new Map();
let roundQueue = null;
let lastError = '';
let engineReady = false;
let sessionFinished = false;

function fairFloat(seed, i) {
  const h = createHash('sha256').update(seed + ':' + i).digest();
  let v = 0n;
  for (let k = 0; k < 7; k++) v = (v << 8n) | BigInt(h[k]);
  return Number(v) / Number(1n << 56n);
}

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
function realOnlineCount() {
  let n = 0;
  for (const ws of conns.values()) if (ws.readyState === 1) n++;
  return n;
}

const platform = {
  broadcast,
  sendTo,
  getGameState: (k) => state.get(k),
  setGameState: (k, v) => state.set(k, v),
  // 会话名册：已连接过的玩家按序入册（对齐平台“名册随加入增长”）
  getPlayers: () => [...roster.entries()].map(([id, name]) => ({ id, name })),
  isPlayerOnline: (pid) => {
    const ws = conns.get(pid);
    return !!ws && ws.readyState === 1;
  },
  random: () => Number(randomBytes(8).readBigUInt64LE() >> 11n) / Number(1n << 53n),
  beginFairRound(seedId) {
    seeds.set(seedId, { seed: randomBytes(16).toString('hex'), draws: 0 });
    const commitment = createHash('sha256').update(seeds.get(seedId).seed).digest('hex');
    broadcast('fair:commitment', { seedId, commitment });
    return commitment;
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
    broadcast('fair:reveal', {
      seedId, seed: s.seed,
      commitment: createHash('sha256').update(s.seed).digest('hex'),
      draws: s.draws,
    });
    return true;
  },
  log: (...args) => console.log('[game]', ...args),
  // 默认严格按生产时序运行；需要截图或人工观察时显式开启慢速模式。
  setTimeout: (fn, ms) => setTimeout(fn, slowMode && ms >= 10000 ? ms * 4 : ms),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearTimer: (id) => { clearTimeout(id); clearInterval(id); },
  beginRound: () => {
    if (roundQueue) return '';
    roundQueue = [];
    return 'round-' + Date.now();
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
  endRound: () => {
    if (!roundQueue) return false;
    const q = roundQueue;
    roundQueue = null;
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
    return true;
  },
  getRoundId: () => (roundQueue ? 'round' : ''),
  lastRoundError: () => lastError,
  getBalance: (pid) => wallet.get(pid) || 0,
  getBalanceVersion: (pid) => walletVersion.get(pid) || 0,
  // 会话收尾：广播 finished 并停掉引擎（对齐平台 finishSession 语义）。
  // 随后关闭所有连接并清场 —— 平台上会话终止后玩家由大厅重新排队，
  // 本地模拟为：客户端自动重连 → 重新进入自动匹配 → 组建全新房间。
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
      roster.clear();
      pending.length = 0;
      engineReady = false;
      sessionFinished = false;
      console.log('[devserver] 会话已终止，等待重新匹配');
    }, 500);
  },
  // 会话重开：对齐平台“回到可加入状态”（本地联调以日志示意）
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

// ── 自动匹配：满足开局人数自动组局 ──
function tryStartEngine() {
  if (engineReady || sessionFinished) return;
  if (realOnlineCount() < minPlayers) return;
  engineReady = true;
  console.log(`[devserver] 匹配成功（${realOnlineCount()}/${minPlayers}）→ 自动组建房间并开局`);
  game.onInit();
  broadcastSystem('session:state', { state: 'ready' });
  broadcastSystem('session:started', { sessionId: 'mock-session', playerCount: conns.size });
}

// ── WS + 静态宿主页 ──
// 游戏前端直接同源托管 frontend/dist（贴近平台 CDN 部署形态，联调也更简单；
// 开发热更时可自行改指 :3200 的 vite dev server）。
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
  if (path === '/match-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ online: realOnlineCount(), min: minPlayers, ready: engineReady }));
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

// 席位抢占竞态：页面刷新时新连接可能先于旧连接的 close 事件到达。
// 席位满时进入挂起队列，旧连接释放后自动补位。
const pending = [];

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  console.log('[ws] new conn:', url.search);
  const spectate = url.searchParams.get('spectate') === '1';
  if (spectate) {
    spectators.add(ws);
    ws.on('close', () => spectators.delete(ws));
    wsSend(ws, 'system', 'session:spectating', { sessionId: 'mock', playerCount: conns.size });
    console.log('[ws] spectator connected');
    return;
  }
  ws.on('close', () => {
    console.log('[ws] queued conn closed');
    const idx = pending.indexOf(ws);
    if (idx >= 0) pending.splice(idx, 1);
    assignSeats();
  });
  pending.push(ws);
  assignSeats();
});

function assignSeats() {
  let i = 0;
  while (i < pending.length) {
    const ws = pending[i];
    let pid = null;
    for (const p of playerIds) {
      const cur = conns.get(p);
      if (!cur || cur.readyState !== 1) {
        if (cur) conns.delete(p);
        pid = p;
        break;
      }
    }
    // 最新连接优先：席位被占时把最老的占用者降级为观战
    // （联调页刷新/重连时会留下收不到 close 的僵尸连接）
    if (!pid) {
      let oldestPid = null;
      let oldestTs = Infinity;
      for (const p of playerIds) {
        const cur = conns.get(p);
        if (cur && cur.__boundAt < oldestTs) { oldestTs = cur.__boundAt; oldestPid = p; }
      }
      if (oldestPid && Date.now() - oldestTs > 3000) {
        const old = conns.get(oldestPid);
        spectators.add(old);
        wsSend(old, 'system', 'session:spectating', { sessionId: 'mock', playerCount: conns.size });
        conns.delete(oldestPid);
        pid = oldestPid;
      }
    }
    if (!pid) break;
    pending.splice(i, 1);
    bindPlayer(ws, pid);
  }
  // 仍无席位的转观战
  while (i < pending.length) {
    const ws = pending.splice(i, 1)[0];
    spectators.add(ws);
    wsSend(ws, 'system', 'session:spectating', { sessionId: 'mock', playerCount: conns.size });
    console.log('[ws] seats full → spectator');
  }
  // 席位暂被 3s 保护期内的老连接占着 → 稍后重试
  if (pending.length > 0) setTimeout(assignSeats, 3500);
}

function bindPlayer(ws, pid) {
  // 已解散的房间且无人在线 → 重置为全新房间（对齐平台“新会话”语义）
  if (sessionFinished && realOnlineCount() === 0) {
    console.log('[devserver] 旧房间已解散且无人在线 → 重置匹配');
    sessionFinished = false;
    engineReady = false;
    roster.clear();
  }
  const isRejoin = roster.has(pid);
  ws.__boundAt = Date.now();
  conns.set(pid, ws);
  if (!roster.has(pid)) roster.set(pid, '玩家 ' + pid.slice(-1).toUpperCase());
  console.log('[ws] player', pid, isRejoin ? 'rejoined' : 'connected');

  wsSend(ws, 'system', 'session:joined', {
    sessionId: 'mock-session', gameId: 'ddz', playerId: pid,
    playerCount: conns.size, state: engineReady ? 'playing' : 'waiting',
  });
  broadcastSystem('session:member_joined', { playerId: pid, playerCount: conns.size });

  if (engineReady && !sessionFinished) {
    // 对齐平台：新成员与重连成员都触发引擎 onPlayerJoin
    try { game.onPlayerJoin?.(pid, roster.get(pid) || ''); } catch (e) { console.error('[game] onPlayerJoin failed:', e); }
  }
  if (!engineReady) tryStartEngine();

  ws.on('message', (raw) => {
    if (conns.get(pid) !== ws) return; // 已被更新的连接顶替，忽略僵尸消息
    if (sessionFinished) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'system') {
      if (msg.action === 'session:ready') {
        if (!engineReady) {
          // 对齐平台：人数不足时 ready 被拒，客户端据此展示匹配等待
          const err = `need at least ${minPlayers} players to ready (${realOnlineCount()}/${minPlayers})`;
          console.log('[ws] ready rejected:', err);
          wsSend(ws, 'system', 'error', { message: err });
        }
      } else if (msg.action === 'state:sync') {
        game.onSync(pid);
      } else if (msg.action === 'session:start' && !engineReady) {
        tryStartEngine();
      }
    } else if (msg.type === 'action') {
      console.log('[ws] action', pid, msg.action, JSON.stringify(msg.payload || {}).slice(0, 60));
      game.onAction(pid, msg.action, msg.payload);
    }
  });

  ws.on('close', () => {
    if (conns.get(pid) === ws) {
      conns.delete(pid);
      console.log('[ws]', pid, 'disconnected → onPlayerLeave (AI 托管)');
      broadcastSystem('session:member_left', { playerId: pid, playerCount: conns.size });
      if (engineReady && !sessionFinished) {
        try { game.onPlayerLeave?.(pid); } catch (e) { console.error('[game] onPlayerLeave failed:', e); }
      }
      assignSeats();
    } else {
      spectators.delete(ws);
    }
  });
}

function hostPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>斗地主 · 本地联调宿主</title>
<style>
  body { margin:0; background:#0f172a; color:#e2e8f0; font-family: system-ui; display:flex; flex-direction:column; height:100vh; }
  header { padding:8px 16px; font-size:13px; color:#94a3b8; display:flex; gap:16px; align-items:center; border-bottom:1px solid #1e293b; }
  iframe { flex:1; border:0; width:100%; }
  b { color:#fbbf24; }
</style></head><body>
<header>🀄 本地联调宿主 · 自动匹配 <b id="match">-</b> · 真人席位：${playerIds.join(' / ')} · 新开标签页即加入匹配 · 关闭标签页=离席(AI托管) · 重开=归队</header>
<iframe id="game" src="/index.html"></iframe>
<script>
  var ORIGIN = 'http://localhost:${PORT}';
  function refreshMatch() {
    fetch('/match-status').then(function (r) { return r.json(); }).then(function (s) {
      document.getElementById('match').textContent = s.ready
        ? '已开局（' + s.online + ' 在线）'
        : '匹配中 ' + s.online + '/' + s.min;
    }).catch(function () {});
  }
  setInterval(refreshMatch, 1000); refreshMatch();
  window.addEventListener('message', function (event) {
    if (event.origin !== 'http://localhost:${PORT}') return;
    var data = event.data || {};
    if (data.type === 'onlinegame:config:request') {
      event.source.postMessage({
        type: 'onlinegame:config:response',
        payload: { wsUrl: 'ws://localhost:${PORT}', gameId: 'ddz' }
      }, ORIGIN);
    } else if (data.type === 'onlinegame:ticket:request') {
      event.source.postMessage({
        type: 'onlinegame:ticket:response',
        payload: { ticket: 'dev-ticket-' + Date.now() }
      }, ORIGIN);
    } else if (data.type === 'onlinegame:game:exit') {
      // 游戏自带返回按钮：mock 宿主演示同样退回（模拟大厅导航）
      if (window.history.length > 1) window.history.back();
    }
  });
</script>
</body></html>`;
}

server.listen(PORT, () => {
  console.log(`[devserver] WS + 宿主页: http://localhost:${PORT}/  (游戏 iframe → /index.html; DDZ_PLAYERS=${playerIds.join(',')}; DDZ_MIN_PLAYERS=${minPlayers}; DDZ_SLOW_MODE=${slowMode ? '1' : '0'})`);
});
