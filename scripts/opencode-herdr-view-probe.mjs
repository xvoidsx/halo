// Herdr-view opencode probe — phase B of the diagnosis.
// Opens the herdr TUI itself in a Halo terminal pane (full width,
// then split) and screenshots what the opencode agent's sub-pane
// looks like inside it. This is Raven's actual report: "in herdr
// view with more than one pane open" — the nesting is Halo pane ->
// herdr TUI -> herdr workspace panes -> opencode.
//
// Usage: node scripts/opencode-herdr-view-probe.mjs [port]
import { writeFileSync } from 'node:fs';
const PORT = Number(process.argv[2] || 9222);
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
await send('Page.reload');
await sleep(6000);
await send('Runtime.enable');
await sleep(2000);

const expr = `(async () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const btnByText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const seen = new Set();
  window.__termLog = [];
  window.halo.onTermData((ev) => {
    seen.add(ev.id);
    window.__termLog.push(ev.id + ' :: ' + ev.data.slice(-200));
  });

  btnByText('▤ Terminal')?.click();
  await sleep(2000);
  const paneId = [...seen][0];
  out.paneId = paneId;
  // Open the herdr TUI in the single full-width pane.
  if (paneId) await window.halo.termWrite(paneId, 'herdr\\r');
  await sleep(4000);
  const wraps = () => qa('.terminal-panes > .terminal-wrap').map((el) => {
    const host = el.querySelector('.terminal-host');
    return { w: Math.round(el.getBoundingClientRect().width), cols: host?.getAttribute('data-cols'), rows: host?.getAttribute('data-rows') };
  });
  out.fullWraps = wraps();
  out.fullLogTail = window.__termLog.slice(-3);
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const v = res.result?.result?.value ?? {};
console.log(JSON.stringify(v, null, 2));
const shotFull = await send('Page.captureScreenshot', { format: 'png' });
if (shotFull.result?.data) {
  writeFileSync('/home/hatch/workspace/halo/.tmp-opencode-herdr-full.png', Buffer.from(shotFull.result.data, 'base64'));
  console.log('saved .tmp-opencode-herdr-full.png');
}

// Phase B: split the Halo pane (TUI now 68 cols) and shoot again.
const exprB = `(async () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const btnByText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  btnByText('＋ Split')?.click();
  await sleep(3000);
  const wraps = () => qa('.terminal-panes > .terminal-wrap').map((el) => {
    const host = el.querySelector('.terminal-host');
    return { w: Math.round(el.getBoundingClientRect().width), cols: host?.getAttribute('data-cols'), rows: host?.getAttribute('data-rows') };
  });
  out.splitWraps = wraps();
  return out;
})()`;
const resB = await send('Runtime.evaluate', { expression: exprB, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(resB.result?.result?.value ?? {}, null, 2));
const shotSplit = await send('Page.captureScreenshot', { format: 'png' });
if (shotSplit.result?.data) {
  writeFileSync('/home/hatch/workspace/halo/.tmp-opencode-herdr-split.png', Buffer.from(shotSplit.result.data, 'base64'));
  console.log('saved .tmp-opencode-herdr-split.png');
}
process.exit(0);
