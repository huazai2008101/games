// 一次性探针：全新 Chrome + 全新页面加载「已离席结算」的会话，截图验证浮层。
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const CHROME = 'C:/Users/zihua/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
try {
  const out = execSync('netstat -ano | findstr :9341 | findstr LISTENING', { shell: 'cmd.exe' }).toString();
  for (const pid of [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p)))]) {
    execSync(`taskkill /F /T /PID ${pid}`, { shell: 'cmd.exe' });
  }
} catch { /* 端口空闲 */ }

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=9341', '--window-size=520,940', 'about:blank',
  '--user-data-dir=C:/Users/zihua/AppData/Local/Temp/m3probe',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(2500);
  const res = await fetch('http://127.0.0.1:9341/json/new?' + encodeURIComponent('http://localhost:9998/'), { method: 'PUT' });
  await res.json();
  await sleep(5000);
  const list = await (await fetch('http://127.0.0.1:9341/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  const shot = await new Promise((resolve) => {
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id === 1) resolve(Buffer.from(m.result.data, 'base64'));
    });
  });
  writeFileSync('probe-leave.png', shot);
  console.log('截图完成 probe-leave.png');
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e.message); chrome.kill(); process.exit(1); });
