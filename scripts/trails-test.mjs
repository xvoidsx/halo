// Trails test — drives the dev or packaged app over CDP against the
// fake `entire` CLI in ~/workspace/.tmp/fakebin. The et/* fixtures
// are Raven's REAL `trail list` + `trail show --json` output
// (2026-11-12: one open trail in planning, no evals, no findings,
// no gates, no runs — the detail must render that honestly, not as
// blank sections). The gh/* fixtures are transcribed from his
// screenshot of the gh/rav3ndust trail (same shape, real id/title/
// url) until the real gh JSON lands.
// Expects the app open (any tab); the test reloads the page first
// for a known state. The settings file is seeded by the test itself
// (see seedProjects below) — main reads it fresh on every list call,
// so no app restart is needed between phases.
//
//  1. No project configured: the sidebar says why instead of a bare
//     "No trails yet."
//  2. Two projects set (et + gh): the native trail lists under
//     Trails, the mirrored trail under its own GitHub section.
//  3. Clicking the gh trail loads the detail (`entire trail show`
//     with that trail's project): phase in the meta line, the honest
//     "No evals yet" note, honest empty states for findings/gates/
//     runs/sessions, and a link out to the trail on Entire.
//  4. Clicking the et trail loads its detail too (per-project detail
//     routing both ways).
//  5. Settings shows both configured projects in the Entire field.
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
function seedProjects(projects) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ entire: { projects } }, null, 2));
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
// Click a trail row by its exact title — 'Test trail' is not a
// substring of 'Trails test: first trail', but an exact match is
// proof against any future title that does overlap.
const clickTrail = (title) =>
  evalJs(
    `[...document.querySelectorAll('.trail-row')].find((b) => b.querySelector('.t-title')?.childNodes[0]?.textContent?.trim() === ${JSON.stringify(title)})?.click()`,
  );

// --- 1. No project configured ---
seedProjects([]);
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
const noteEmpty = await sidebarNote();
check(
  'no project configured says why (not a bare empty list)',
  typeof noteEmpty === 'string' && noteEmpty.includes('No Entire project configured'),
  `got "${noteEmpty}"`,
);

// --- 2. Two projects set: native under Trails, mirrored under GitHub ---
seedProjects(['et/xvoidsx', 'gh/rav3ndust']);
await send('Page.reload', { ignoreCache: true });
const etSeen = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.textContent.includes('Trails test: first trail'))`,
);
check('native trail appears in the sidebar', etSeen === true, `got ${etSeen}`);
const ghSeen = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Test trail')`,
);
check('mirrored trail appears in the sidebar', ghSeen === true, `got ${ghSeen}`);
const headings = await evalJs(`[...document.querySelectorAll('.trail-list h2')].map((el) => el.textContent)`);
check(
  'Trails and GitHub are separate sections',
  Array.isArray(headings) &&
    // The Trails h2 carries the live badge when the watch is
    // connected ("Trails ● live"), so match the heading's start.
    headings.some((h) => h.trim().startsWith('Trails')) &&
    headings.includes('GitHub'),
  `got ${JSON.stringify(headings)}`,
);
// The gh group must sit after the GitHub heading in the DOM — under
// GitHub, not under Trails.
const ghPlaced = await evalJs(`(() => {
  const h2 = [...document.querySelectorAll('.trail-list h2')].find((el) => el.textContent === 'GitHub');
  const g = [...document.querySelectorAll('.trail-list .trail-group')].find((el) => el.querySelector('.t-project')?.textContent === 'gh/rav3ndust');
  if (!h2 || !g) return false;
  return (h2.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && g.textContent.includes('Test trail');
})()`);
check('mirrored trail groups under GitHub', ghPlaced === true, `got ${ghPlaced}`);

// --- 3. Clicking the gh trail loads its detail ---
await clickTrail('Test trail');
const ghDetailSeen = await waitFor(
  `(() => { const t = document.querySelector('.main')?.innerText ?? ''; return t.includes('No evals yet') && t.includes('No open findings.') && t.includes('planning') && t.includes('No gates yet.') && t.includes('No runs yet.') && t.includes('No sessions yet.'); })()`,
);
check('gh detail renders the trail honestly (phase, no evals, empty states)', ghDetailSeen === true);
const ghLink = await waitFor(
  `(() => { const a = document.querySelector('.main a[href*="entire.com"]'); return a && a.href.includes('entire.com/gh/rav3ndust/-/trails/1') ? a.href : null; })()`,
);
check('gh detail links out to the trail on Entire', typeof ghLink === 'string', `got "${ghLink}"`);

// --- 4. Clicking the et trail loads its detail too ---
await clickTrail('Trails test: first trail');
const etLink = await waitFor(
  `(() => { const a = document.querySelector('.main a[href*="entire.com"]'); return a && a.href.includes('entire.com/et/xvoidsx/-/trails/1') ? a.href : null; })()`,
);
check('et detail links out to the trail on Entire', typeof etLink === 'string', `got "${etLink}"`);

// --- 5. Settings shows both configured projects ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
await sleep(1200);
const projectsValue = await evalJs(`(() => {
  const labels = [...document.querySelectorAll('.settings label')];
  const l = labels.find((el) => el.textContent.trim().startsWith('Projects'));
  return l ? l.querySelector('textarea')?.value ?? null : null;
})()`);
check(
  'settings Entire field holds both projects',
  typeof projectsValue === 'string' && projectsValue.includes('et/xvoidsx') && projectsValue.includes('gh/rav3ndust'),
  `got "${projectsValue}"`,
);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
