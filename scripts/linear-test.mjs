// Linear test — drives the dev or packaged app over CDP against the
// fake `linear` CLI in ~/workspace/.tmp/fakebin. The fixtures are
// REAL output captured from Raven's workspace (2026-11-12): the first
// 5 issues by updatedAt (XVOIDSX-71, 70, 69, 54, 68), get_issue 71 +
// 68 with full descriptions, and the 2 real comments on 68 (from
// Linear + rav3ndust). Nothing is synthesized. The fake answers on
// PATH, so the app must be launched with fakebin on PATH; the
// packaged run (as halotest) needs linear + linear-fixtures/ copied
// to /home/halotest/fakebin. Expects the app open (any tab); the test
// reloads the page first for a known state. The settings file is
// seeded by the test itself (main reads it fresh on every list call,
// so no app restart is needed between phases). Leaves the forge on
// Entire at the end, so the next ui-smoke run sees the Trails empty
// state.
//
//  1. A team with no issues says why instead of a bare "No issues yet."
//  2. The forge switcher shows all three marks (Entire + GitHub + Linear).
//  3. XVOIDSX-71 lists with a Backlog pill; XVOIDSX-54 with Done.
//  4. XVOIDSX-68 lists with Todo + Medium priority.
//  5. Clicking 71 loads its detail (real description, 0 comments, Linear link).
//  6. Clicking 68 loads its detail with its 2 real comments.
//  7. Settings shows the configured team in the Linear field.
//  8. Switching back to Entire leaves the app on the Trails view.
//
// Usage: node scripts/linear-test.mjs [port]
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
function seedLinear(team) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ entire: { projects: [] }, github: { repos: [] }, linear: { team }, repos: [] }, null, 2),
  );
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
// call shells out to the CLI, so the rows land a beat after load.
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
const clickForge = (name) =>
  evalJs(`[...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})?.click()`);
// Click a sidebar row by its exact title — the title is the row's
// first text node, before the pill spans.
const clickRow = (title) =>
  evalJs(
    `[...document.querySelectorAll('.trail-row')].find((b) => b.querySelector('.t-title')?.childNodes[0]?.textContent?.trim() === ${JSON.stringify(title)})?.click()`,
  );

// --- 1. A team with no issues says why ---
seedLinear('nope');
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
await clickForge('Linear');
await sleep(1500);
const noteEmpty = await sidebarNote();
check(
  'unknown team says why (not a bare empty list)',
  typeof noteEmpty === 'string' && noteEmpty.includes('No issues in team nope yet.'),
  `got "${noteEmpty}"`,
);

// --- 2. The switcher shows all three forge marks ---
const switcher = await evalJs(`[...document.querySelectorAll('.forge-btn')].map((b) => ({ text: b.textContent.trim(), svg: !!b.querySelector('svg') }))`);
check(
  'forge switcher shows Entire + GitHub + Linear with their marks',
  Array.isArray(switcher) &&
    switcher.length === 3 &&
    switcher.some((b) => b.text === 'Entire' && b.svg) &&
    switcher.some((b) => b.text === 'GitHub' && b.svg) &&
    switcher.some((b) => b.text === 'Linear' && b.svg),
  `got ${JSON.stringify(switcher)}`,
);

// --- 3. The team set: issues list with honest status pills ---
seedLinear('xvoidsx');
await send('Page.reload', { ignoreCache: true });
await sleep(1500);
await clickForge('Linear');
const row71 = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Halo: vibe-powered agentic harness — Electron app on top, local-first, herdr + Entire Trails' && el.textContent.includes('Backlog'))`,
);
check('XVOIDSX-71 lists with a Backlog pill', row71 === true, `got ${row71}`);
const row54 = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Nerva HF14: upgrade fleet miners + wallets to v0.4.0.0 before block 4,480,000' && el.textContent.includes('Done'))`,
);
check('XVOIDSX-54 lists with a Done pill', row54 === true, `got ${row54}`);
const row68 = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Lab week: first weights on koe-600m + kimeru, and make the heretic card ours' && el.textContent.includes('Todo'))`,
);
check('XVOIDSX-68 lists with a Todo pill', row68 === true, `got ${row68}`);

// --- 4. Clicking 71 loads its detail (real description, Linear link) ---
await clickRow('Halo: vibe-powered agentic harness — Electron app on top, local-first, herdr + Entire Trails');
const detail71 = await waitFor(
  `(() => { const t = document.querySelector('.main')?.innerText ?? ''; return t.includes('nightshadeNeon-soaked') && t.includes('0 comments') && t.includes('Open in Linear') ? true : null; })()`,
);
check('issue 71 detail renders real description, 0 comments, Linear link', detail71 === true, `got ${detail71}`);

// --- 5. Clicking 68 loads its detail with its 2 real comments ---
await clickRow('Lab week: first weights on koe-600m + kimeru, and make the heretic card ours');
const detail68 = await waitFor(
  `(() => { const t = document.querySelector('.main')?.innerText ?? ''; return t.includes('2 comments') && t.includes('rav3ndust') && t.includes('Colab') ? true : null; })()`,
);
check('issue 68 detail renders its 2 real comments', detail68 === true, `got ${detail68}`);

// --- 6. Settings shows the configured team in the Linear field ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
await sleep(1200);
const teamValue = await evalJs(`(() => {
  const labels = [...document.querySelectorAll('.settings label')];
  const l = labels.find((el) => el.textContent.trim().startsWith('Team'));
  return l ? l.querySelector('input')?.value ?? null : null;
})()`);
check('settings Linear field holds the team', teamValue === 'xvoidsx', `got "${teamValue}"`);

// --- 7. Back to Entire, so the next ui-smoke sees the Trails view ---
await evalJs(`[...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.trim() === 'Entire')?.click()`);
await sleep(800);
const backOnEntire = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.trim() === 'Entire');
  const h2 = [...document.querySelectorAll('.trail-list h2')].map((el) => el.textContent);
  return btn?.classList.contains('active') && h2.includes('Trails');
})()`);
check('switching back to Entire restores the Trails view', backOnEntire === true, `got ${backOnEntire}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
