// Chat-layout stability check for Halo 0.6.1 — regression test for the
// infinite-expansion bug Raven caught benching 0.6.0.
//
// The bug: the chat terminal grew ~35px/s forever and the document's
// horizontal scrollbar with it. Cause: a flex item's automatic minimum
// size is its content, and an xterm's width IS content — the chat's
// .terminal-wrap never got the min-width: 0 that .terminal-panes gives
// its own wraps, so the fit loop ran away (fit measures the host,
// widens the terminal, the widened terminal widens its ancestors,
// fit measures again). The Terminal tab was immune the whole time
// because its wraps ARE constrained — this test proves the chat tab
// holds the same way.
//
// What it checks, against a REAL herdr server with a REAL opencode
// agent (a TUI agent is what makes the terminal wide enough to
// trigger the loop; a fake pi never did):
//  1. the chat terminal renders the agent's live screen
//  2. no horizontal overflow: document scrollWidth == clientWidth
//  3. the terminal wrap never exceeds its container (.chat-terminal)
//  4. the terminal width is STABLE across 10 seconds (no growth)
//  5. the same holds after switching to the fakepi agent
//
// Usage: launch Halo with --remote-debugging-port=9222 first, then
//   node scripts/chat-layout-test.mjs [port] [agent-name]
const PORT = Number(process.argv[2] ?? 9222);
const AGENT = process.argv[3] ?? 'opencode';
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
// Start from a known state: reload so no panes from an earlier run
// are still mounted (the chat attach now survives tab switches).
await send('Page.enable');
await send('Page.reload');
await sleep(6000);
await send('Runtime.enable');
await sleep(2000);

const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value;
};

const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  return ok;
};

let allPass = true;

// Open Chat and click the target agent's row.
const clicked = await evalJs(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btnByText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  btnByText('✦ Chat')?.click();
  await sleep(1500);
  const rows = [...document.querySelectorAll('.chat-row')];
  const row = rows.find((r) => r.textContent.includes(${JSON.stringify(AGENT)})) ?? rows[0];
  row?.click();
  await sleep(3000);
  return row ? row.textContent.slice(0, 40) : null;
})()`);
console.log('clicked row:', clicked);

// Sample the layout every second for 10 seconds.
const measure = `( () => {
  const w = (s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().width) : null; };
  return {
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    chatTerm: w('.chat-terminal'),
    termWrap: w('.chat-terminal .terminal-wrap'),
    termHost: w('.chat-terminal .terminal-host'),
    xterm: w('.chat-terminal .xterm'),
    status: document.querySelector('.chat-terminal .t-status')?.textContent ?? null,
    renders: !!document.querySelector('.chat-terminal .xterm canvas'),
  };
})()`;
const samples = [];
for (let i = 0; i < 10; i++) {
  samples.push(await evalJs(measure));
  await sleep(1000);
}
const first = samples[0];
const last = samples[samples.length - 1];
const maxWrap = Math.max(...samples.map((s) => s.termWrap ?? 0));
const maxScroll = Math.max(...samples.map((s) => s.docScroll));

allPass = check('attach running', (first.status ?? '').includes('herdr agent attach'), first.status) && allPass;
allPass = check('terminal renders (canvas present)', first.renders === true) && allPass;
allPass = check('no horizontal overflow', maxScroll <= first.docClient, `scroll ${maxScroll} vs client ${first.docClient}`) && allPass;
allPass = check('wrap never exceeds its container', maxWrap <= (first.chatTerm ?? 0), `wrap max ${maxWrap} vs container ${first.chatTerm}`) && allPass;
allPass = check('terminal width stable over 10s', Math.abs((last.termWrap ?? 0) - (first.termWrap ?? 0)) <= 2, `${first.termWrap} -> ${last.termWrap}`) && allPass;
allPass = check('xterm fits inside its host', (last.xterm ?? 0) <= (last.termHost ?? 0), `xterm ${last.xterm} vs host ${last.termHost}`) && allPass;

// Same checks after switching to the other agent (fakepi).
await evalJs(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [...document.querySelectorAll('.chat-row')];
  rows.find((r) => r.textContent.includes('fakepi'))?.click();
  await sleep(3000);
  return true;
})()`);
const s2 = [];
for (let i = 0; i < 5; i++) { s2.push(await evalJs(measure)); await sleep(1000); }
const maxScroll2 = Math.max(...s2.map((s) => s.docScroll));
const maxWrap2 = Math.max(...s2.map((s) => s.termWrap ?? 0));
allPass = check('no overflow after switching agent', maxScroll2 <= s2[0].docClient, `scroll ${maxScroll2} vs client ${s2[0].docClient}`) && allPass;
allPass = check('wrap holds after switching agent', maxWrap2 <= (s2[0].chatTerm ?? 0), `wrap max ${maxWrap2} vs container ${s2[0].chatTerm}`) && allPass;

console.log(allPass ? 'CHAT LAYOUT TEST: PASS' : 'CHAT LAYOUT TEST: FAIL');
process.exit(allPass ? 0 : 1);
