// 临时 UI 验证脚本：headless Chromium + CDP，自动开局、执行交换并逐阶段截图。
// 用法：node cdp-shot.mjs（需先启动 mock-server）；产物在 ui-shots/

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, 'ui-shots');
const CHROME = 'C:/Users/zihua/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const PORT = 9333;
const URL = 'http://localhost:9998/';

mkdirSync(OUT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=520,940', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(400);
  }
  throw new Error('CDP 目标未就绪');
}

const ws = new WebSocket(await getTarget());
await new Promise((r) => ws.once('open', r));

let msgId = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function inGame(expression) {
  const r = await send('Runtime.evaluate', {
    expression: `(function(){
      const doc = document.querySelector('#game').contentDocument;
      if (!doc) return 'no-frame';
      const fn = (${expression});
      return String(fn(doc, window));
    })()`,
    returnByValue: true,
  });
  return r.result?.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, name), Buffer.from(r.result.data, 'base64'));
  console.log('📸', name);
}

await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(5000);
await shot('1-idle.png');

// 关闭可能的终局浮层并开局
await inGame(`(doc) => {
  const b = [...doc.querySelectorAll('button')].find((x) => x.textContent.trim() === '再来一局');
  if (b) b.click();
  return 'ok';
}`);
await sleep(400);
await inGame(`(doc) => {
  const b = [...doc.querySelectorAll('button')].find((x) => /开始游戏|再来一局/.test(x.textContent));
  if (b) b.click();
  return b ? b.textContent.trim() : 'no-button';
}`);
await sleep(2800);
await shot('2-board.png');

// 找一对必然消除的相邻块：先选中第一块，暂存第二格索引到 iframe window
const probe = await inGame(`(doc, win) => {
  const tiles = [...doc.querySelectorAll('.tile')];
  if (tiles.length !== 64) return 'tiles=' + tiles.length;
  const grid = new Array(64).fill(null);
  for (const t of tiles) {
    const m = (t.style.getPropertyValue('--tf') || '').match(/translate\\((\\d+)px, ?(\\d+)px\\)/);
    if (!m) continue;
    const c = Math.round(Number(m[1]) / 56), r = Math.round(Number(m[2]) / 56);
    grid[r * 8 + c] = t;
  }
  const colorOf = (t) => {
    if (!t) return '?';
    const face = t.querySelector('.tile-face');
    if (!face) return '?';
    if (face.querySelector('.m3-spin')) return 'R';
    const el = face.querySelector('[fill^="url(#m3-g"]');
    if (el) return el.getAttribute('fill');
    return 'S'; // 火箭/炸弹等其他特殊块
  };
  const colors = grid.map(colorOf);
  const makesMatch = (a, b) => {
    const g = colors.slice();
    const t = g[a]; g[a] = g[b]; g[b] = t;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
      const i = r * 8 + c;
      if (g[i] !== '?' && g[i] !== 'S' && g[i] === g[i + 1] && g[i] === g[i + 2]) return true;
    }
    for (let c = 0; c < 8; c++) for (let r = 0; r < 6; r++) {
      const i = r * 8 + c;
      if (g[i] !== '?' && g[i] !== 'S' && g[i] === g[i + 8] && g[i] === g[i + 16]) return true;
    }
    return false;
  };
  const tap = (i) => {
    const el = grid[i];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 9, isPrimary: true }));
    doc.defaultView.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 9, isPrimary: true }));
  };
  const pairs = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) pairs.push([r * 8 + c, r * 8 + c + 1]);
  for (let c = 0; c < 8; c++) for (let r = 0; r < 7; r++) pairs.push([r * 8 + c, (r + 1) * 8 + c]);
  const hit = pairs.find(([a, b]) => colors[a].startsWith('url') && colors[b].startsWith('url') && makesMatch(a, b));
  if (!hit) return 'no-move';
  win.__second = hit[1];
  tap(hit[0]);
  return JSON.stringify({ first: hit[0], second: hit[1] });
}`);
console.log('probe:', probe);

if (probe && probe.startsWith('{')) {
  await sleep(300);
  // 点第二格完成交换，300ms 后抓消除动画帧
  await inGame(`(doc, win) => {
    const second = win.__second;
    const x = (second % 8) * 56, y = Math.floor(second / 8) * 56;
    const el = [...doc.querySelectorAll('.tile')].find((t) =>
      (t.style.getPropertyValue('--tf') || '').replace(/\\s/g, '') === ('translate(' + x + 'px,' + y + 'px)'));
    if (!el) return 'no-tile';
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 10, isPrimary: true }));
    doc.defaultView.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 10, isPrimary: true }));
    return 'tapped';
  }`);
  await sleep(320);
  await shot('3-clearing.png');
  await sleep(2600);
  await shot('4-settled.png');

  // 提前结算 → 终局浮层
  await inGame(`(doc) => {
    const b = [...doc.querySelectorAll('button')].find((x) => x.textContent.includes('提前结算'));
    if (b) b.click();
    return b ? 'ok' : 'no-button';
  }`);
  await sleep(2200);
  await shot('5-gameover.png');
}

ws.close();
chrome.kill();
console.log('done →', OUT_DIR);
