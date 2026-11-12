// Trails test — drives the dev or packaged app over CDP against the
// fake `entire` CLI in ~/workspace/.tmp/fakebin (Raven's REAL `trail
// list` + `trail show --json` output, 2026-11-12: one open trail in
// planning, no evals, no findings, no gates, no runs — the detail
// must render that honestly, not as blank sections).
// Expects the app open (any tab); the test reloads the page first
// for a known state. The settings file is seeded by the test itself
// (see seedProject below) — main reads it fresh on every list call,
// so no app restart is needed between phases.
//
//  1. No project configured: the sidebar says why instead of a bare
//     "No trails yet."
//  2. Project set: the real trail appears in the sidebar, live.
//  3. Clicking it loads the detail (`entire trail show`): phase in
//     the meta line, the honest "No evals yet" note, honest empty
//     states for findings/gates/runs/sessions, and a link out to
//     the trail on Entire.
//  4. Settings shows the configured project in the Entire field.
//
// Usage: node scripts/trails-test.mjs [port]
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const PORT = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

// Main reads the settings file on every list call, so seeding it here
// is enough — the renderer picks it up on the next reload.
const SETTINGS_FILE = path.join(os.homedir(), '.config', 'halo', 'settings.json');
function seedProject(project) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ entire: { project } }, null, 2));
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
await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await sleep(4000);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
// Poll an expression until it returns truthy (or time out) — the list
// call shells out to the CLI, so the trail lands a beat after load.
const waitFor = async (expr, timeoutMs = 15000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await evalJs(expr);
    if (v) return v;
    await sleep(500);
  }
  return null;
};
const sidebarNote = () => evalJs(`document.querySelector('.trail-list .note')?.textContent ?? ''`);
const mainText = () => evalJs(`document.querySelector('.main')?.innerText ?? ''`);

// --- 1. No project configured ---
seedProject('');
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
const noteEmpty = await sidebarNote();
check(
  'no project configured says why (not a bare empty list)',
  typeof noteEmpty === 'string' && noteEmpty.includes('No Entire project configured'),
  `got "${noteEmpty}"`,
);

// --- 2. Project set: the trail appears live ---
seedProject('et/trails-test');
await send('Page.reload', { ignoreCache: true });
const rowSeen = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.textContent.includes('Trails test: first trail'))`,
);
check('fixture trail appears in the sidebar', rowSeen === true, `got ${rowSeen}`);

// --- 3. Clicking it loads the detail ---
await evalJs(`[...document.querySelectorAll('.trail-row')].find((b) => b.textContent.includes('Trails test: first trail'))?.click()`);
const detailSeen = await waitFor(
  `(() => { const t = document.querySelector('.main')?.innerText ?? ''; return t.includes('No evals yet') && t.includes('No open findings.') && t.includes('planning') && t.includes('No gates yet.') && t.includes('No runs yet.') && t.includes('No sessions yet.'); })()`,
);
check('detail renders the real trail honestly (phase, no evals, empty states)', detailSeen === true);
const entireLink = await evalJs(`document.querySelector('.main a[href*="entire.com"]')?.href ?? ''`);
check('detail links out to the trail on Entire', typeof entireLink === 'string' && entireLink.includes('entire.com/et/xvoidsx/-/trails/1'), `got "${entireLink}"`);

// --- 4. Settings shows the configured project ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
await sleep(1200);
const projectValue = await evalJs(`(() => {
  const labels = [...document.querySelectorAll('.settings label')];
  const l = labels.find((el) => el.textContent.trim().startsWith('Project'));
  return l ? l.querySelector('input')?.value ?? null : null;
})()`);
check('settings Entire field holds the project', projectValue === 'et/trails-test', `got "${projectValue}"`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
