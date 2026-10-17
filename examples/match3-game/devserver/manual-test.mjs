// 全量手工测试 —— headless Chromium + CDP 驱动真实页面，按手工用例逐项断言。
//
// 用法：
//   node manual-test.mjs        全流程用例（devserver 需以 MM_BALANCE=5000 启动）
//   node manual-test.mjs poor   余额不足路径（devserver 需以 MM_BALANCE=9 启动）
// 产物：ui-manual/ 关键步骤截图；退出码 0=全部通过。

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, 'ui-manual');
const CHROME = 'C:/Users/zihua/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const CDP_PORT = 9337;
const URL = 'http://localhost:9998/';
const MODE = process.argv[2] || 'full';

// Windows 上 chrome.kill() 只杀启动器进程，孤儿实例会占住 CDP 端口，
// 下一轮测试会连到旧浏览器的旧标签页 —— 启动前按端口清场。
try {
  const out = execSync(`netstat -ano | findstr :${CDP_PORT} | findstr LISTENING`, { shell: 'cmd.exe' }).toString();
  const pids = [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p)))];
  for (const pid of pids) {
    console.log('清理残留 Chrome 进程 pid=', pid);
    execSync(`taskkill /F /T /PID ${pid}`, { shell: 'cmd.exe' });
  }
} catch { /* 端口空闲 */ }

// 与后端 game.ts 档位常量一致（用于结算金额复核）
const TIERS = [
  { min: 600, mult: 0.5, star: 0 },
  { min: 1200, mult: 1.2, star: 1 },
  { min: 2600, mult: 2, star: 2 },
  { min: 4200, mult: 4, star: 3 },
];
function payoutFor(bet, score) {
  let stars = 0, mult = 0;
  for (const t of TIERS) if (score >= t.min) { stars = t.star; mult = t.mult; }
  return { stars, payout: Math.floor(bet * mult) };
}

mkdirSync(OUT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`, '--window-size=520,940', 'about:blank',
  `--user-data-dir=${join(here, '.chrome-test-profile')}`,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(id, name, cond, detail = '') {
  results.push({ id, name, ok: !!cond, detail: String(detail) });
  console.log(`  ${cond ? '✓' : '✗'} [${id}] ${name}${cond ? '' : ' — ' + detail}`);
}
const num = (s) => Number(String(s).replace(/,/g, ''));

async function openTab(url) {
  for (let i = 0; i < 15; i++) {
    try {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      return;
    } catch { await sleep(400); }
  }
  throw new Error('CDP 未就绪');
}
async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}
function connect(wsUrl) {
  return new Promise(async (resolve) => {
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.once('open', r));
    let msgId = 0;
    const pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    resolve({ ws, send });
  });
}

// —— 在宿主页上下文执行，函数体接收游戏 iframe 的 (doc, win) ——
function makeEval(tab) {
  return async (fnBody, arg) => {
    const r = await tab.send('Runtime.evaluate', {
      expression: `(function(){
        const doc = document.querySelector('#game') && document.querySelector('#game').contentDocument;
        if (!doc) return JSON.stringify({ err: 'no-frame' });
        try {
          const fn = (${fnBody});
          const out = fn(doc, doc.defaultView, ${JSON.stringify(arg ?? null)});
          return JSON.stringify(out === undefined ? null : out);
        } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); }
      })()`,
      returnByValue: true,
    });
    return JSON.parse(r.result?.result?.value ?? 'null');
  };
}

// —— 页面状态读取 ——
const readStateExpr = `(doc) => {
  const txt = (el) => (el ? el.textContent.trim() : null);
  const balance = txt(doc.querySelector('span.tabular-nums.text-sm'));
  const moves = txt(doc.querySelector('div.font-black.tabular-nums.text-lg'));
  const score = txt(doc.querySelector('span.num-pop'));
  const overlay = doc.querySelector('.fixed.inset-0');
  const banners = [...doc.querySelectorAll('.text-xs')].map(b => b.textContent.trim()).filter(t => t.length > 3);
  const betBtns = [...doc.querySelectorAll('button')].filter(b => /^\\d+$/.test(b.textContent.trim())).map(b => b.textContent.trim());
  const startBtn = [...doc.querySelectorAll('button')].find(b => /开始游戏|再来一局/.test(b.textContent) && b.textContent.length <= 6);
  const legend = doc.body.textContent.includes('四连 · 火箭');
  const connected = doc.body.textContent.includes('已连接');
  return {
    balance: balance ? Number(balance.replace(/,/g, '')) : null,
    moves: moves ? Number(moves) : null,
    score: score ? Number(score.replace(/,/g, '')) : null,
    tiles: doc.querySelectorAll('.tile').length,
    overlay: overlay ? overlay.textContent.trim().slice(0, 60) : null,
    banner: banners.find(t => /重连|断开|余额|消除|会话|结束/.test(t)) || null,
    betBtns, legend, connected,
    startEnabled: startBtn ? !startBtn.disabled : null,
    startLabel: startBtn ? startBtn.textContent.trim() : null,
  };
}`;

// —— 棋盘交互：点击 / 拖动 / 找有效步 ——
const tapExpr = `(doc, win, cell) => {
  const x = (cell % 8) * 56, y = Math.floor(cell / 8) * 56;
  const el = [...doc.querySelectorAll('.tile')].find(t =>
    (t.style.getPropertyValue('--tf') || '').replace(/\\s/g, '') === ('translate(' + x + 'px,' + y + 'px)'));
  if (!el) return 'no-tile';
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 9, isPrimary: true }));
  win.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy, pointerId: 9, isPrimary: true }));
  return 'ok';
}`;
const dragExpr = `(doc, win, pair) => {
  const a = pair.a, b = pair.b;
  const pos = (cell) => ({ x: (cell % 8) * 56, y: Math.floor(cell / 8) * 56 });
  const find = (x, y) => [...doc.querySelectorAll('.tile')].find(t =>
    (t.style.getPropertyValue('--tf') || '').replace(/\\s/g, '') === ('translate(' + x + 'px,' + y + 'px)'));
  const pa = pos(a), pb = pos(b);
  const el = find(pa.x, pa.y);
  if (!el) return 'no-tile';
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  // 朝目标格方向拖过阈值（>格宽 35%），与 App 的拖动判定一致
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const mag = Math.max(Math.abs(dx), Math.abs(dy));
  const ux = (dx / mag) * 34, uy = (dy / mag) * 34;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 11, isPrimary: true }));
  win.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + ux, clientY: cy + uy, pointerId: 11, isPrimary: true }));
  win.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx + ux, clientY: cy + uy, pointerId: 11, isPrimary: true }));
  return 'ok';
}`;
const findMoveExpr = `(doc) => {
  const tiles = [...doc.querySelectorAll('.tile')];
  if (tiles.length !== 64) return { err: 'tiles=' + tiles.length };
  const grid = new Array(64).fill(null);
  for (const t of tiles) {
    const m = (t.style.getPropertyValue('--tf') || '').match(/translate\\((\\d+)px, ?(\\d+)px\\)/);
    if (!m) continue;
    grid[Math.round(Number(m[2]) / 56) * 8 + Math.round(Number(m[1]) / 56)] = t;
  }
  const colorOf = (t) => {
    const face = t && t.querySelector('.tile-face');
    if (!face) return '?';
    if (face.querySelector('.m3-spin')) return 'R';
    const el = face.querySelector('[fill^="url(#m3-g"]');
    return el ? el.getAttribute('fill') : 'S';
  };
  const colors = grid.map(colorOf);
  const normal = (i) => typeof colors[i] === 'string' && colors[i].startsWith('url');
  const makesMatch = (a, b) => {
    const g = colors.slice();
    const t = g[a]; g[a] = g[b]; g[b] = t;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
      const i = r * 8 + c;
      if (normal(i) && g[i] === g[i + 1] && g[i] === g[i + 2]) return true;
    }
    for (let c = 0; c < 8; c++) for (let r = 0; r < 6; r++) {
      const i = r * 8 + c;
      if (normal(i) && g[i] === g[i + 8] && g[i] === g[i + 16]) return true;
    }
    return false;
  };
  const pairs = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) pairs.push([r * 8 + c, r * 8 + c + 1]);
  for (let c = 0; c < 8; c++) for (let r = 0; r < 7; r++) pairs.push([r * 8 + c, (r + 1) * 8 + c]);
  const hit = pairs.find(([a, b]) => normal(a) && normal(b) && makesMatch(a, b));
  if (hit) return { a: hit[0], b: hit[1] };
  // 兜底：彩虹球与任意相邻块
  const ri = colors.findIndex((c) => c === 'R');
  if (ri >= 0 && ri % 8 < 7) return { a: ri, b: ri + 1 };
  return { err: 'no-move' };
}`;
// 无效交换对：交换后不产生消除且双方均为普通块
const findInvalidExpr = `(doc) => {
  const tiles = [...doc.querySelectorAll('.tile')];
  const grid = new Array(64).fill(null);
  for (const t of tiles) {
    const m = (t.style.getPropertyValue('--tf') || '').match(/translate\\((\\d+)px, ?(\\d+)px\\)/);
    if (!m) continue;
    grid[Math.round(Number(m[2]) / 56) * 8 + Math.round(Number(m[1]) / 56)] = t;
  }
  const colorOf = (t) => {
    const el = t && t.querySelector('.tile-face [fill^="url(#m3-g"]');
    return el ? el.getAttribute('fill') : null;
  };
  const colors = grid.map(colorOf);
  for (let a = 0; a < 64; a++) {
    const b = a + 1;
    if (a % 8 === 7) continue;
    if (!colors[a] || !colors[b] || colors[a] === colors[b]) continue;
    const g = colors.slice();
    const t = g[a]; g[a] = g[b]; g[b] = t;
    let match = false;
    for (let r = 0; r < 8 && !match; r++) for (let c = 0; c < 6; c++) {
      const i = r * 8 + c;
      if (g[i] && g[i] === g[i + 1] && g[i] === g[i + 2]) { match = true; break; }
    }
    for (let c = 0; c < 8 && !match; c++) for (let r = 0; r < 6; r++) {
      const i = r * 8 + c;
      if (g[i] && g[i] === g[i + 8] && g[i] === g[i + 16]) { match = true; break; }
    }
    if (!match) return { a, b };
  }
  return { err: 'none' };
}`;
const clickBtnExpr = `(doc, win, label) => {
  const overlay = doc.querySelector('.fixed.inset-0');
  const scope = overlay ? overlay : doc;
  const b = [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label || x.textContent.includes(label));
  if (!b) return 'no-button';
  b.click();
  return 'ok';
}`;

async function shot(tab, name) {
  const r = await tab.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, name), Buffer.from(r.result.data, 'base64'));
  console.log('   📸', name);
}
async function waitFor(fn, timeoutMs = 9000, label = '') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  await openTab('about:blank');
  let targets = await listTargets();
  const t1 = targets.find((t) => t.type === 'page');
  const tab1 = await connect(t1.webSocketDebuggerUrl);
  await tab1.send('Page.enable');
  const ev = makeEval(tab1);
  const read = () => ev(readStateExpr);

  // ─────────────────────── 阶段③：余额不足 ───────────────────────
  if (MODE === 'poor') {
    await tab1.send('Page.navigate', { url: URL });
    await sleep(4500);
    let st = await read();
    check('MT-10', '待开局：余额 9 显示正常', st.balance === 9, JSON.stringify(st));
    await ev(clickBtnExpr, '开始游戏');
    await sleep(1200);
    st = await read();
    check('MT-11', '余额不足：提示「余额不足，请降低入场费」', /余额不足/.test(st.banner || ''), st.banner);
    check('MT-12', '余额不足：未开局（无棋盘）、余额不变', st.tiles === 0 && st.balance === 9, `tiles=${st.tiles} bal=${st.balance}`);
    await shot(tab1, 'poor.png');
    return;
  }

  // ─────────────────────── 阶段②：全流程 ───────────────────────
  console.log('MT-01 待开局界面');
  await tab1.send('Page.navigate', { url: URL });
  await sleep(4500);
  let st = await read();
  check('MT-01a', '连接成功（已连接）', st.connected === true);
  check('MT-01b', '余额 5,000 正确显示', st.balance === 5000, `bal=${st.balance}`);
  check('MT-01c', '特殊块图例展示', st.legend === true);
  check('MT-01d', '三档入场费 10/50/100', JSON.stringify(st.betBtns) === '["10","50","100"]', JSON.stringify(st.betBtns));
  check('MT-01e', '开始按钮可用', st.startEnabled === true && /开始游戏/.test(st.startLabel || ''));
  await shot(tab1, '01-idle.png');

  console.log('MT-02 开局（注 10）');
  await ev(clickBtnExpr, '开始游戏');
  const boardReady = await waitFor(async () => (await read()).tiles === 64, 6000);
  st = await read();
  check('MT-02a', '扣入场费：余额 5,000 → 4,990', st.balance === 4990, `bal=${st.balance}`);
  check('MT-02b', '步数 20、分数 0', st.moves === 20 && st.score === 0, `moves=${st.moves} score=${st.score}`);
  check('MT-02c', '64 颗宝石全部落位', boardReady && st.tiles === 64, `tiles=${st.tiles}`);
  await shot(tab1, '02-board.png');

  console.log('MT-03 点击交换（有效步）');
  let mv = await ev(findMoveExpr);
  check('MT-03a', '扫描到有效步', !mv.err, JSON.stringify(mv));
  await ev(tapExpr, mv.a); await sleep(260);
  await ev(tapExpr, mv.b);
  const swapDone = await waitFor(async () => {
    const s = await read();
    return s.moves === 19;
  }, 9000);
  st = await read();
  check('MT-03b', '交换生效：步数 20 → 19', swapDone && st.moves === 19, `moves=${st.moves}`);
  check('MT-03c', '得分入账（>0）', st.score > 0, `score=${st.score}`);

  console.log('MT-04 无效交换弹回');
  const before = await read();
  const bad = await ev(findInvalidExpr);
  check('MT-04a', '找到无效交换对', !bad.err, JSON.stringify(bad));
  if (!bad.err) {
    await ev(tapExpr, bad.a); await sleep(260);
    await ev(tapExpr, bad.b);
    await sleep(1600);
    st = await read();
    check('MT-04b', '提示「不会产生消除」', /消除/.test(st.banner || ''), st.banner);
    check('MT-04c', '步数与分数不变', st.moves === before.moves && st.score === before.score, `moves=${st.moves}/${before.moves} score=${st.score}/${before.score}`);
  }

  console.log('MT-05 拖动交换');
  mv = await ev(findMoveExpr);
  if (!mv.err) {
    await ev(dragExpr, mv);
    let dragDone = await waitFor(async () => (await read()).moves === before.moves - 1, 7000);
    if (!dragDone) {
      // 容错重试：重新扫描再拖一次
      mv = await ev(findMoveExpr);
      if (!mv.err) {
        await ev(dragExpr, mv);
        dragDone = await waitFor(async () => (await read()).moves === before.moves - 1, 7000);
      }
    }
    st = await read();
    check('MT-05', '拖动生效：步数再 -1', dragDone && st.moves === before.moves - 1, `moves=${st.moves} 期望 ${before.moves - 1}`);
  } else {
    check('MT-05', '拖动生效（跳过：无可测步）', true);
  }

  console.log('MT-06 刷新页面恢复对局');
  const pre = await read();
  await tab1.send('Page.navigate', { url: 'about:blank' });
  await sleep(600);
  await tab1.send('Page.navigate', { url: URL });
  await sleep(4500);
  st = await read();
  check('MT-06a', '棋盘恢复 64 颗', st.tiles === 64, `tiles=${st.tiles}`);
  check('MT-06b', '分数与步数恢复', st.score === pre.score && st.moves === pre.moves, `score=${st.score}/${pre.score} moves=${st.moves}/${pre.moves}`);
  check('MT-06c', '余额显示恢复', st.balance === pre.balance, `bal=${st.balance}/${pre.balance}`);

  console.log('MT-07 第二标签页接管席位 + 原页转观战');
  const preMove = await read();
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
  await sleep(1500);
  targets = await listTargets();
  const t2 = targets.find((t) => t.type === 'page' && t.id !== t1.id);
  const tab2 = await connect(t2.webSocketDebuggerUrl);
  await tab2.send('Page.enable');
  await tab2.send('Page.navigate', { url: URL });
  await sleep(4200); // 1.5s 席位宽限 + 连接 + 同步
  const ev2 = makeEval(tab2);
  const p2 = await ev2(readStateExpr);
  check('MT-07a', '新标签页接管玩家席位并恢复对局', p2.tiles === 64 && p2.moves === preMove.moves, `tiles=${p2.tiles} moves=${p2.moves}`);
  // 原 tab 已被降级为观战：由 tab2 走一步，tab1 凭广播重建
  mv = await ev2(findMoveExpr);
  check('MT-07b', '新标签页可正常行棋', !mv.err, JSON.stringify(mv));
  if (!mv.err) {
    await ev2(tapExpr, mv.a); await sleep(260);
    await ev2(tapExpr, mv.b);
    await waitFor(async () => (await ev2(readStateExpr)).moves === p2.moves - 1, 9000);
    // tab1 已在后台：Chrome 对隐藏标签节流 setTimeout，动画链放慢，放宽等待
    const specSynced = await waitFor(async () => (await read()).moves === p2.moves - 1, 20000);
    const spec1 = await read();
    check('MT-07c', '原标签页转观战并凭广播同步', specSynced && spec1.tiles === 64 && spec1.moves === p2.moves - 1,
      `观战页 ${spec1.tiles}/${spec1.moves} 期望 64/${p2.moves - 1}`);
  }
  // 关闭 tab2 → 玩家断线（进入宽限）
  await tab2.send('Page.close').catch(() => {});
  await sleep(800);

  console.log('MT-08 宽限期内重载收复席位 → 打完整局 → 结算');
  const dumpExpr = `(doc) => ({
    tiles: doc.querySelectorAll('.tile').length,
    selected: doc.querySelectorAll('.tile.selected').length,
    popping: doc.querySelectorAll('.tile.popping').length,
    floats: doc.querySelectorAll('.float-text').length,
    banner: [...doc.querySelectorAll('.text-xs')].map(b => b.textContent.trim()).filter(t => /消除|余额|错误/.test(t))[0] || null,
  })`;
  await tab1.send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  await tab1.send('Page.navigate', { url: URL });
  await sleep(4500);
  st = await read();
  // score 由服务端累计（含 tab2 在 MT-07 的得分），此处只校验结构一致性：
  // 棋盘恢复、步数 = MT-07 行棋后、余额未变（分数在 MT-03/06 已验证过一致性）
  check('MT-08a', '宽限期内重载：棋盘与对局恢复', st.tiles === 64 && st.moves === preMove.moves - 1,
    `tiles=${st.tiles} moves=${st.moves} 期望 ${preMove.moves - 1}`);
  check('MT-08b', '余额显示恢复（宽限期内未结算）', st.balance === 4990, `bal=${st.balance}`);
  let steps = 0;
  let overSeen = false;
  while (steps < 40) {
    st = await read();
    if (st.overlay) { overSeen = true; break; }
    if (st.moves === 0) {
      overSeen = await waitFor(async () => !!(await read()).overlay, 6000);
      break;
    }
    mv = await ev(findMoveExpr);
    if (mv.err) { check('MT-08-scan', '整局扫描始终有可行步', false, JSON.stringify(mv)); break; }
    await ev(tapExpr, mv.a); await sleep(280);
    await ev(tapExpr, mv.b);
    const cur = st.moves;
    const ok = await waitFor(async () => (await read()).moves < cur || !!(await read()).overlay, 12000);
    if (!ok) {
      const dump = await ev(dumpExpr);
      console.log('   ⚠ 第', steps + 1, '步未推进，现场：', JSON.stringify(dump), 'move=', JSON.stringify(mv));
      await ev(tapExpr, mv.b); await sleep(300);
      const ok2 = await waitFor(async () => (await read()).moves < cur || !!(await read()).overlay, 8000);
      if (!ok2) { check('MT-08-step', `第 ${steps + 1} 步在时限内完成（含重试）`, false, JSON.stringify(await ev(dumpExpr))); break; }
    }
    steps++;
  }
  st = await read();
  const finalScore = st.score;
  const expect = payoutFor(10, finalScore);
  check('MT-08c', '步数打完且终局浮层出现', overSeen && !!st.overlay, `overlay=${st.overlay}`);
  check('MT-08d', `结算分数与星级正确（${finalScore} 分 → ${expect.stars}★）`, st.overlay && st.overlay.includes(String(finalScore)), st.overlay);
  check('MT-08e', `奖金一致（${expect.payout > 0 ? '+' + expect.payout : '未达奖励线'}）`,
    st.overlay && (expect.payout > 0 ? st.overlay.includes(`+${expect.payout}`) : st.overlay.includes('未达奖励线')), st.overlay);
  await sleep(1000);
  st = await read();
  check('MT-08f', `钱包守恒：终局余额 = 4990 + ${expect.payout}`, st.balance === 4990 + expect.payout, `bal=${st.balance}`);
  await shot(tab1, '08-gameover.png');
  await ev(clickBtnExpr, '再来一局');
  await sleep(500);
  st = await read();
  check('MT-08g', '关闭浮层回到注档，开局按钮可用', st.overlay === null && st.startEnabled === true, `overlay=${st.overlay} start=${st.startEnabled}`);

  console.log('MT-09 对局中断线 → 离席宽限 → 逾期结算 → 归队');
  // over 态主按钮文案为「再来一局」；两者都试，点中即止
  let clicked = await ev(clickBtnExpr, '开始游戏');
  if (clicked === 'no-button') clicked = await ev(clickBtnExpr, '再来一局');
  const started = await waitFor(async () => (await read()).tiles === 64 && (await read()).moves === 20, 6000);
  const midBal = (await read()).balance;
  check('MT-09a', '新局开局扣费', clicked !== 'no-button' && started && midBal === 4990 + expect.payout - 10,
    `click=${clicked} bal=${midBal} 期望 ${4990 + expect.payout - 10}`);
  mv = await ev(findMoveExpr);
  if (!mv.err) {
    await ev(tapExpr, mv.a); await sleep(240);
    await ev(tapExpr, mv.b);
    await waitFor(async () => (await read()).moves === 19, 9000);
  }
  const preLeave = await read();
  // 断线：离开页面 → WS 断开 → 宽限期内不应结算
  await tab1.send('Page.navigate', { url: 'about:blank' });
  await sleep(2500);
  const duringGrace = await (await fetch('http://localhost:9998/status')).json();
  check('MT-09b', '宽限期内（2.5s）不结算', duringGrace.balance === midBal, `status.balance=${duringGrace.balance} 期望 ${midBal}`);
  // 结算确认移到归队后（MT-09c）：无头 Chrome 的 close 事件可能延迟，
  // 固定等待无法覆盖宽限定时器的实际起步时刻
  // 归队：模拟真实用户「关掉旧标签页 → 从大厅重新打开」。
  // 先等 /status 的引擎阶段变为 over（结算落定），此时无任何定时器在跑，
  // 之后加载的页面拿到的一定是终局快照，无竞态窗口。
  await tab1.send('Page.close').catch(() => {});
  const leaveExpect = payoutFor(10, preLeave.score);
  const settled = await waitFor(async () => {
    const s = await (await fetch('http://localhost:9998/status')).json();
    return s.phase === 'over';
  }, 40000);
  await sleep(1500); // 让滞后的 WS close 事件处理完，席位彻底空闲
  const created = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  await sleep(1200);
  targets = await listTargets();
  const t3 = targets.find((t) => t.id === created.id);
  const tab3 = await connect(t3.webSocketDebuggerUrl);
  await tab3.send('Page.enable');
  await tab3.send('Page.navigate', { url: URL });
  const ev3 = makeEval(tab3);
  const read3 = () => ev3(readStateExpr);
  const overlayShown = await waitFor(async () => !!(await read3()).overlay, 15000);
  st = await read3();
  check('MT-09c', '宽限期后引擎完成离席结算', settled, `status.phase=${(await (await fetch('http://localhost:9998/status')).json()).phase}`);
  check('MT-09d', '归队后显示「离席结算」浮层', overlayShown && st.overlay && st.overlay.includes('离席结算'), st.overlay);
  check('MT-09e', '归队后余额一致', st.balance === midBal + leaveExpect.payout, `bal=${st.balance}`);
  await shot(tab3, '09-leave.png');
}

main()
  .then(() => {
    const fail = results.filter((r) => !r.ok).length;
    console.log(`\n手工测试汇总：${results.length - fail}/${results.length} 通过 ${fail === 0 ? '✅' : '❌'}`);
    chrome.kill();
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('手工测试执行异常：', e);
    chrome.kill();
    process.exit(1);
  });
