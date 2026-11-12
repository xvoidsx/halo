// E2E check for Halo against a REAL herdr server (0.9.5) with a live
// agent. Needs: herdr server running, one agent started (e.g. the fake
// pi via `herdr agent start fakepi --kind pi --pane w1:p1`).
// Launch Halo with --remote-debugging-port=9222 first, then run this.
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
await sleep(4000); // let herdrStatus() land

const expr = `(async () => {
  const q = (s) => document.querySelector(s);
  const out = {};
  out.chip = q('.agents-chip')?.textContent ?? null;
  out.foot = q('.sidebar-foot')?.textContent ?? null;
  q('.agents-chip')?.click();
  await new Promise((r) => setTimeout(r, 500));
  out.dropdown = q('.switcher-pop')?.textContent ?? null;
  const sendRes = await window.halo.agentSend('w1:p1', 'halo e2e hello');
  out.send = sendRes;
  await new Promise((r) => setTimeout(r, 2000));
  const readRes = await window.halo.agentRead('w1:p1', 30);
  out.readOk = readRes.ok;
  out.readEcho = (readRes.output || '').includes('halo e2e hello');
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const val = res.result?.result?.value ?? {};
console.log(JSON.stringify(val, null, 2));
const pass =
  /\d+ live/.test(val.chip ?? '') &&
  /\d+ agents?/.test(val.foot ?? '') &&
  (val.dropdown ?? '').includes('fakepi') &&
  (val.dropdown ?? '').includes('w1:p1') &&
  val.send?.ok === true &&
  val.readOk === true &&
  val.readEcho === true;
console.log(pass ? 'HERDR E2E TEST: PASS' : 'HERDR E2E TEST: FAIL');
process.exit(pass ? 0 : 1);
