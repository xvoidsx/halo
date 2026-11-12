// Quick visual check — click a main-tab button, screenshot the window.
// Usage: node scripts/shot.mjs [port] [tab-text] [out.png]
import { writeFileSync } from 'node:fs';
const PORT = Number(process.argv[2] || 9222);
const TAB = process.argv[3] || 'Terminal';
const OUT = process.argv[4] || '/home/hatch/workspace/halo/.tmp-shot.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('no CDP page');
}
const ws = new WebSocket(await getPageWs());
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((r) => {
  ws.onopen = r;
});
await send('Page.enable');
// Fresh renderer state: the running page may hold a stale bundle
// from before the last build, so reload before shooting.
await send('Page.reload');
await sleep(5000);
await send('Runtime.enable');
await send(
  'Runtime.evaluate',
  { expression: `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('${TAB}'))?.click(); 'ok'`, returnByValue: true },
);
await sleep(2500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', OUT);
} else console.log('screenshot failed');
process.exit(0);
