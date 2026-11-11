// Drive the PACKAGED Halo app over CDP and prove the in-app terminal
// really spawns a shell: subscribe to term-data, spawn in /tmp, write a
// marker command, collect output, report. Usage:
//   xvfb-run -a /opt/Halo/halo --no-sandbox --remote-debugging-port=9222 &
//   node scripts/pty-smoke-test.mjs
// Exits 0 with PASS when the marker comes back over the PTY.
// Run as an unprivileged user (HOME pointed at a writable dir) — that
// is the whole point: root can read files a normal user cannot.
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('no CDP page target after 20s');
}

const ws = new WebSocket(await getPageWs());
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
await send('Page.enable');
await sleep(2000); // let the app settle (terminal engine loads async)

const expr = `(async () => {
  const out = [];
  window.halo.onTermData((ev) => out.push(ev.data));
  const spawn = await window.halo.termSpawn('cdp-test', '/tmp', 80, 24);
  if (!spawn.ok) return { spawn, out: out.join('') };
  await new Promise((r) => setTimeout(r, 800));
  await window.halo.termWrite(spawn.id, 'echo HALO_PTY_OK\\n');
  await new Promise((r) => setTimeout(r, 1500));
  await window.halo.termKill(spawn.id);
  return { spawn, out: out.join('') };
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2));
const val = res.result?.result?.value;
const pass = val?.spawn?.ok === true && typeof val.out === 'string' && val.out.includes('HALO_PTY_OK');
console.log(pass ? 'PTY TEST: PASS' : 'PTY TEST: FAIL');
process.exit(pass ? 0 : 1);
