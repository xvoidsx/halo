// Herdr-restart test (0.13.0) — drives the dev or packaged app over
// CDP and restarts the real herdr server underneath it. Open the Chat
// tab so a live attach exists, kill the server, wait for the attach
// to die AND for a 10 s poll to see the server down, rebuild the rig
// (server back + 3 agents), and assert the "herdr restarted —
// Reconnect all" banner appears; clicking it re-spawns the dead
// panes and the banner goes away. The rig is rebuilt by the test
// itself, so it ends in its standard 3-agent shape either way.
// Slow (~60 s): two 10 s poll windows plus the rig rebuild.
//
// Usage: node scripts/herdr-restart-test.mjs [port]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
const execFileAsync = promisify(execFile);
const PORT = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

const RIG =
  process.env.HALO_RIG_SCRIPT || path.join(os.homedir(), 'workspace', '.tmp', 'setup-rig.sh');
// The packaged run (as halotest) passes HALO_RIG_SCRIPT pointing at
// the halotest rig rebuild script — the homedir path above is the
// dev rig and does not exist for halotest.

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
await send('Runtime.enable');
await send('Page.enable');

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
const waitFor = async (expr, timeoutMs = 15000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await evalJs(expr);
    if (v) return v;
    await sleep(500);
  }
  return null;
};
const bannerText = () =>
  evalJs(
    `(() => {
      const b = document.querySelector('.reconnect-all');
      return b ? b.textContent : '';
    })()`,
  );

// --- 1. Open Chat so a live attach exists ---
await evalJs(
  `[...document.querySelectorAll('.main-head .icon-btn')].find((b) => b.textContent.includes('Chat'))?.click()`,
);
const attachRunning = await waitFor(
  `(() => {
    const s = document.querySelector('.chat-view .t-status')?.textContent ?? '';
    return s.includes('Running herdr agent attach') ? true : null;
  })()`,
  20000,
);
check('a chat attach is running before the restart', attachRunning === true);
check('no restart banner before the restart', !(await bannerText()).includes('herdr restarted'));

// --- 2. Kill the server; the attach dies, then a poll sees it down ---
await execFileAsync('pkill', ['-f', 'herd[r] server']);
const attachDead = await waitFor(
  `(() => {
    const s = document.querySelector('.chat-view .t-status')?.textContent ?? '';
    return s.includes('Shell exited') ? true : null;
  })()`,
  20000,
);
check('the attach dies when the server dies', attachDead === true);
// The app polls herdr every 10 s; a 12 s wait guarantees a poll
// fires while the server is down, so herdrDownRef is set.
await sleep(12000);

// --- 3. Rebuild the rig (server back + 3 agents) ---
try {
  await execFileAsync('bash', [RIG], { timeout: 90000 });
  console.log('PASS  rig rebuilt (server back, 3 agents)');
} catch (e) {
  check('rig rebuilt (server back, 3 agents)', false, e.message);
}

// --- 4. The banner appears on the next poll ---
let banner = null;
{
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const t = await bannerText();
    if (t.includes('herdr restarted')) {
      banner = t;
      break;
    }
    await sleep(500);
  }
}
check('the "herdr restarted — Reconnect all" banner appears', typeof banner === 'string' && banner.length > 0, `got ${JSON.stringify(banner)}`);

// --- 5. Clicking it re-spawns the dead panes and clears the banner ---
await evalJs(`document.querySelector('.reconnect-all')?.click()`);
const cleared = await waitFor(`!(document.querySelector('.reconnect-all')?.textContent.includes('herdr restarted'))`, 15000);
check('clicking Reconnect all clears the banner', cleared === true);
const attachBack = await waitFor(
  `(() => {
    const s = document.querySelector('.chat-view .t-status')?.textContent ?? '';
    return s.includes('Running herdr agent attach') ? true : null;
  })()`,
  20000,
);
check('the chat attach is running again after reconnect', attachBack === true);

// Cleanup: back to Trails so the next run starts clean.
await evalJs(
  `[...document.querySelectorAll('.main-head .icon-btn')].find((b) => b.textContent.includes('Trails'))?.click()`,
);
await sleep(500);

console.log(failures === 0 ? 'HERDR RESTART TEST: PASS' : `HERDR RESTART TEST: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
