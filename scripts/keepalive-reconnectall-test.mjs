// Keep-alive + Reconnect-all test — drives the PACKAGED or dev app over CDP.
// Expects herdr 0.9.5 running with two fake-pi agents (fakepi w1:p1,
// fakepi2 w1:p2) and the app open on the Trails view.
//
//  1. Keep-alive: the chat attach keeps the SAME pty across a tab
//     switch. The attach is identified by its 'fakepi>' output; after
//     switching to Terminal and back, writing to the same pty id still
//     echoes — a re-spawn would have a new id and the old one would be
//     dead, so no echo.
//  2. Reconnect-all: killing the chat attach and a Terminal shell shows
//     "Shell exited" on both and a sidebar "Reconnect all (2)" button;
//     clicking it re-spawns both.
//
// Usage: node scripts/keepalive-reconnectall-test.mjs [port]
const PORT = Number(process.argv[2] || 9222);
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
// switches, so a warm instance is NOT a fresh one — the shell/attach
// identification below would collide with the leftovers).
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

  // Collect term data per pty id from the very start — before any pane mounts.
  window.__dataById = {};
  window.__attachId = null;
  window.halo.onTermData((ev) => {
    window.__dataById[ev.id] = (window.__dataById[ev.id] || '') + ev.data;
    if (ev.data.includes('fakepi>')) window.__attachId = ev.id;
  });
  const waitFor = async (id, marker, ms = 5000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if ((window.__dataById[id] || '').includes(marker)) return true;
      await sleep(200);
    }
    return false;
  };

  // --- Mount the shell first, then the chat attach ---
  btnByText('▤ Terminal')?.click();
  await sleep(2500);
  // The shell is the first pty that emitted data (no attach exists yet).
  let shellId = null;
  for (let i = 0; i < 10 && !shellId; i++) {
    shellId = Object.keys(window.__dataById).find((id) => (window.__dataById[id] || '').length > 0) ?? null;
    if (!shellId) await sleep(500);
  }
  out.shellId = shellId;
  // Prove it is the shell before trusting it with a kill: write a
  // marker, expect the pty echo back.
  if (shellId) {
    await window.halo.termWrite(shellId, 'echo SHELLMARK-7\\n');
    out.shellEcho = await waitFor(shellId, 'SHELLMARK-7');
  }

  btnByText('✦ Chat')?.click();
  await sleep(2000);
  const row = qa('.chat-row')[0];
  row?.click();
  await sleep(2500);
  out.chatStatusBefore = q('.chat-terminal .t-status')?.textContent ?? null;
  const attachId = window.__attachId;
  out.attachId = attachId;

  // --- 1. Keep-alive: tab round-trip, the SAME pty must answer ---
  if (attachId) {
    await window.halo.termWrite(attachId, 'echo KEEP-7\\n');
    out.markerBefore = await waitFor(attachId, 'KEEP-7');
  }
  btnByText('▤ Terminal')?.click();
  await sleep(1500);
  btnByText('✦ Chat')?.click();
  await sleep(1000);
  out.chatStatusAfterSwitch = q('.chat-terminal .t-status')?.textContent ?? null;
  if (attachId) {
    await window.halo.termWrite(attachId, 'echo ALIVE-9\\n');
    out.samePtyAlive = await waitFor(attachId, 'ALIVE-9');
  }

  // --- 2. Reconnect-all: kill both, one button brings both back ---
  if (attachId) await window.halo.termKill(attachId);
  await sleep(1200);
  out.chatStatusDead = q('.chat-terminal .t-status')?.textContent ?? null;
  out.chatReconnectVisible = !!q('.chat-terminal .t-reconnect');
  btnByText('▤ Terminal')?.click();
  await sleep(1000);
  if (shellId) await window.halo.termKill(shellId);
  await sleep(1200);
  out.shellStatusDead = q('.terminal-panes .t-status')?.textContent ?? null;
  out.reconnectAllText = q('.reconnect-all')?.textContent ?? null;
  q('.reconnect-all')?.click();
  await sleep(2500);
  out.shellStatusAfter = q('.terminal-panes .t-status')?.textContent ?? null;
  btnByText('✦ Chat')?.click();
  await sleep(1000);
  out.chatStatusAfter = q('.chat-terminal .t-status')?.textContent ?? null;
  out.reconnectAllGone = !q('.reconnect-all');
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const v = res.result?.result?.value ?? {};
console.log(JSON.stringify(v, null, 2));

check('shell pty found', !!v.shellId, v.shellId);
check('shell marker echoes', v.shellEcho === true);
check('chat attach running before switch', (v.chatStatusBefore ?? '').startsWith('Running herdr agent attach'), v.chatStatusBefore);
check('attach pty found', !!v.attachId, v.attachId);
check('marker echoes before switch', v.markerBefore === true);
check('chat still Running after tab round-trip', (v.chatStatusAfterSwitch ?? '').startsWith('Running herdr agent attach'), v.chatStatusAfterSwitch);
check('same pty answers after switch (keep-alive)', v.samePtyAlive === true);
check('chat dead after kill', (v.chatStatusDead ?? '').startsWith('Shell exited'), v.chatStatusDead);
check('chat Reconnect visible', v.chatReconnectVisible === true);
check('shell dead after kill', (v.shellStatusDead ?? '').startsWith('Shell exited'), v.shellStatusDead);
check('Reconnect all shows (2)', (v.reconnectAllText ?? '').includes('(2)'), v.reconnectAllText);
check('shell back after Reconnect all', !!v.shellStatusAfter && !v.shellStatusAfter.startsWith('Shell exited') && v.shellStatusAfter !== 'Starting terminal…', v.shellStatusAfter);
check('chat Running after Reconnect all', (v.chatStatusAfter ?? '').startsWith('Running herdr agent attach'), v.chatStatusAfter);
check('Reconnect all button gone', v.reconnectAllGone === true);
process.exit(failures ? 1 : 0);
