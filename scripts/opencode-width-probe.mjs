// Opencode width probe — diagnosis for Raven's 0.11.0 bench note:
// "the opencode pane is back to doing what it was before, where you
// can't see its full UI at default zoom in herdr view with more than
// one pane open."
//
// Attaches to the live opencode-test agent (rig w1:p2) in a SPLIT pane
// and in a FULL-WIDTH pane, screenshots both, and records the pty size
// + pane rects + herdr snapshot for each. Read the two PNGs to see
// what Raven sees.
//
// Usage: node scripts/opencode-width-probe.mjs [port]
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
    window.__termLog.push(ev.id + ' :: ' + ev.data.slice(-400));
  });

  btnByText('▤ Terminal')?.click();
  await sleep(2000);
  out.idsBeforeSplit = [...seen];
  btnByText('＋ Split')?.click();
  await sleep(2000);
  out.idsAfterSplit = [...seen];
  const newId = out.idsAfterSplit.find((id) => !out.idsBeforeSplit.includes(id));
  const oldId = out.idsBeforeSplit[0];
  out.splitPaneIds = { oldId, newId };

  // Phase A: opencode attach in the SPLIT pane.
  if (newId) await window.halo.termWrite(newId, 'herdr agent attach w1:p2\\r');
  await sleep(5000);
  const wraps = () => qa('.terminal-panes > .terminal-wrap').map((el) => {
    const host = el.querySelector('.terminal-host');
    return { w: Math.round(el.getBoundingClientRect().width), cols: host?.getAttribute('data-cols'), rows: host?.getAttribute('data-rows') };
  });
  out.splitWraps = wraps();
  // stty size + herdr snapshot from the shell pane (oldId).
  if (oldId) {
    await window.halo.termWrite(oldId, 'stty size; echo PROBE-A-DONE\\r');
    await sleep(1200);
    await window.halo.termWrite(oldId, 'herdr api snapshot > ~/workspace/.tmp/halo-snap-split.json; echo SNAP-A-DONE\\r');
    await sleep(1500);
  }
  out.logTailA = window.__termLog.slice(-6);
  const shotA = await (async () => { try { return 'ok'; } catch { return 'err'; } })();
  out.shotA = shotA;
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const v = res.result?.result?.value ?? {};
console.log(JSON.stringify(v, null, 2));

// Screenshot the split state from the browser side.
const shotA = await send('Page.captureScreenshot', { format: 'png' });
if (shotA.result?.data) {
  writeFileSync('/home/hatch/workspace/halo/.tmp-opencode-split.png', Buffer.from(shotA.result.data, 'base64'));
  console.log('saved ~/workspace/halo/.tmp-opencode-split.png');
} else {
  console.log('screenshot A failed', JSON.stringify(shotA).slice(0, 300));
}
process.exit(0);
