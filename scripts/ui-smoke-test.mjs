// CDP check for Halo 0.2.0 UI: orbit empty state, logo glow, agent
// switcher, terminal toolbar, BYOK DeepSeek card. Usage: launch Halo
// with --remote-debugging-port=9222, then `node scripts/ui-smoke-test.mjs`.
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
await sleep(2500);

const expr = `(async () => {
  const q = (s) => document.querySelector(s);
  const btnByText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  const out = {};
  out.orbit = !!q('.trail-orbit');
  out.waitingText = document.body.textContent.includes('Waiting on trails');
  out.noTestHaibane = !document.body.textContent.includes('trails-test') && !document.body.textContent.includes('haibane');
  out.noOpencodeDefault = !document.body.textContent.includes('OpenCode as the test agent');
  out.logoGlow = getComputedStyle(q('.brand h1')).animationName;
  out.switcher = !!q('.agents-chip');
  q('.agents-chip')?.click();
  await new Promise((r) => setTimeout(r, 400));
  out.switcherOpen = !!q('.switcher-pop');
  out.switcherRefresh = !!btnByText('Refresh agents');
  q('.switcher-backdrop')?.click();
  btnByText('▤ Terminal')?.click();
  await new Promise((r) => setTimeout(r, 1200));
  out.termToolbar = !!q('.terminal-toolbar');
  out.splitBtn = !!btnByText('Split');
  out.openHerdrBtn = !!btnByText('Open herdr');
  btnByText('⚙ Settings')?.click();
  await new Promise((r) => setTimeout(r, 800));
  out.deepseekCard = document.body.textContent.includes('DeepSeek');
  out.noPlaceholder = !document.body.textContent.includes('Placeholder only');
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const val = res.result?.result?.value ?? {};
console.log(JSON.stringify(val, null, 2));
const pass = Object.values(val).every((v) => v === true || v === 'halo-glow');
console.log(pass ? 'UI TEST: PASS' : 'UI TEST: FAIL');
process.exit(pass ? 0 : 1);
