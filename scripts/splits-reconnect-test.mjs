// Splits + reconnect test — drives the PACKAGED or dev app over CDP.
// Expects herdr 0.9.5 running with two fake-pi agents (fakepi w1:p1,
// fakepi2 w1:p2) and the app open on the Trails view.
//
//  1. Terminal tab: Split gives two panes with a draggable divider;
//     dragging it moves width from the right pane to the left one.
//  2. Chat tab: killing the live attach's pty shows "Shell exited" and
//     a Reconnect button; clicking it re-spawns the attach.
//  3. The opencode attach (when a real opencode agent is live) stays
//     Running — the 0.5.0 regression for the poller-read kill.
//
// Usage: node scripts/splits-reconnect-test.mjs [port] [opencode]
//   opencode=1 includes check 3 (needs an opencode agent named
//   opencode-test on w1:p2... the row is found by label instead).
const PORT = Number(process.argv[2] || 9222);
const CHECK_OPENCODE = process.argv[3] === 'opencode';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

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
// Start from a known state: reload the page so no panes from an
// earlier run are still mounted (the chat attach now survives tab
// switches, so a warm instance is NOT a fresh one). The main process
// kills orphaned ptys when the renderer goes away, so the reload is
// safe — a new attach works right after.
await send('Page.enable');
await send('Page.reload');
await sleep(6000); // let the app reload and herdrStatus() land
await send('Runtime.enable');
await sleep(2000);

const expr = `(async () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const btnByText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // --- 1. Resizable splits ---
  btnByText('▤ Terminal')?.click();
  await sleep(1500);
  out.panesBefore = qa('.terminal-panes > .terminal-wrap').length;
  btnByText('＋ Split')?.click();
  await sleep(1500);
  out.panesAfter = qa('.terminal-panes > .terminal-wrap').length;
  out.divider = !!q('.term-divider');
  const widths = () => qa('.terminal-panes > .terminal-wrap').map((el) => el.getBoundingClientRect().width);
  const before = widths();
  const divider = q('.term-divider');
  if (divider) {
    const r = divider.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 120, clientY: cy, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx + 120, clientY: cy, pointerId: 1 }));
    await sleep(600);
  }
  const after = widths();
  out.widthsBefore = before.map((w) => Math.round(w));
  out.widthsAfter = after.map((w) => Math.round(w));

  // --- 2. Reconnect ---
  // Find the chat attach's pty id from its data stream (fakepi prompt).
  window.__attachIds = {};
  window.halo.onTermData((ev) => {
    if (ev.data.includes('fakepi>')) window.__attachIds[ev.id] = true;
  });
  btnByText('✦ Chat')?.click();
  await sleep(2000);
  const row = qa('.chat-row')[0];
  row?.click();
  await sleep(2500);
  out.chatStatusBefore = q('.chat-terminal .t-status')?.textContent ?? null;
  const attachId = Object.keys(window.__attachIds)[0] ?? null;
  out.attachId = attachId;
  if (attachId) await window.halo.termKill(attachId);
  await sleep(1200);
  out.chatStatusDead = q('.chat-terminal .t-status')?.textContent ?? null;
  out.reconnectVisible = !!q('.chat-terminal .t-reconnect');
  q('.chat-terminal .t-reconnect')?.click();
  await sleep(2500);
  out.chatStatusAfter = q('.chat-terminal .t-status')?.textContent ?? null;
  out.reconnectGone = !q('.chat-terminal .t-reconnect');

  // --- 3. Opencode attach survives (regression) ---
  if (${CHECK_OPENCODE}) {
    const oc = qa('.chat-row').find((r) => r.textContent.includes('opencode'));
    out.opencodeRow = !!oc;
    oc?.click();
    const samples = [];
    for (let i = 0; i < 10; i++) { samples.push(q('.chat-terminal .t-status')?.textContent ?? null); await sleep(1000); }
    out.opencodeStatuses = samples;
  }
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const v = res.result?.result?.value ?? {};
console.log(JSON.stringify(v, null, 2));

check('one pane before split', v.panesBefore === 1, `got ${v.panesBefore}`);
check('two panes after split', v.panesAfter === 2, `got ${v.panesAfter}`);
check('divider appears between panes', v.divider === true);
const grew = (v.widthsAfter?.[0] ?? 0) - (v.widthsBefore?.[0] ?? 0);
const shrank = (v.widthsBefore?.[1] ?? 0) - (v.widthsAfter?.[1] ?? 0);
check('dragging the divider moves width left', grew > 50 && shrank > 50, `left +${grew}px, right -${shrank}px`);
check('chat attach running before kill', (v.chatStatusBefore ?? '').startsWith('Running herdr agent attach'), v.chatStatusBefore);
check('attach pty found', !!v.attachId, v.attachId);
check('dead pane shows Shell exited', (v.chatStatusDead ?? '').startsWith('Shell exited'), v.chatStatusDead);
check('Reconnect button appears on a dead pane', v.reconnectVisible === true);
check('Reconnect re-spawns the attach', (v.chatStatusAfter ?? '').startsWith('Running herdr agent attach'), v.chatStatusAfter);
check('Reconnect button goes away after reconnect', v.reconnectGone === true);
if (CHECK_OPENCODE) {
  check('opencode row present', v.opencodeRow === true);
  const alive = (v.opencodeStatuses ?? []).every((s) => (s ?? '').startsWith('Running herdr agent attach'));
  check('opencode attach stays Running for 10s', alive, (v.opencodeStatuses ?? []).join(' | '));
}
process.exit(failures ? 1 : 0);
