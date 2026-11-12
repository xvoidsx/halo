// GitHub test — drives the dev or packaged app over CDP against the
// fake `gh` CLI in ~/workspace/.tmp/fakebin. The fixtures are
// SYNTHESIZED in the real `gh` JSON shapes (field names verified
// against gh 2.102.0 `--help`, 2026-11-12) until real `gh pr/issue
// list/view --json` output lands from Raven's machine — swap them for
// the real output then, as the Entire et/* fixtures were swapped for
// Raven's real `--json` in 0.7.0. Branch status is NOT faked: it runs
// real `git status --porcelain=v2 --branch` against the seeded repo
// path, so the repo must be a real checkout whose origin is
// github.com/xvoidsx/halo. Dev default is this repo's own root; the
// packaged run (as halotest, who cannot read the root-owned tree)
// passes HALO_TEST_REPO=/home/halotest/repos/halo-test instead.
// Expects the app open (any tab); the test reloads the page first
// for a known state. The settings file is seeded by the test itself
// (main reads it fresh on every list call, so no app restart is
// needed between phases). Leaves the forge on Entire at the end, so
// the next ui-smoke run sees the Trails empty state.
//
//  1. No repo configured: the GitHub view says why instead of a bare
//     "No PRs or issues yet."
//  2. The forge switcher shows both marks (Entire + GitHub).
//  3. PR 42 lists with a passing-checks pill; PR 41 with a failing one.
//  4. Issue 17 lists with its label.
//  5. The repo group carries a branch-status line (real git: 'main').
//  6. Clicking PR 42 loads its detail (body, comment count, GitHub link).
//  7. Clicking issue 17 loads its detail too.
//  8. Settings shows the configured repo in the GitHub field.
//  9. Switching back to Entire leaves the app on the Trails view.
//
// Usage: node scripts/github-test.mjs [port]
//   (HALO_TEST_REPO env overrides the seeded repo path.)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const PORT = Number(process.argv[2] || 9222);
const REPO_PATH = process.env.HALO_TEST_REPO || path.resolve(new URL('.', import.meta.url).pathname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

// Main reads the settings file on every list call, so seeding it here
// is enough — the renderer picks it up on the next reload.
const SETTINGS_FILE = path.join(os.homedir(), '.config', 'halo', 'settings.json');
function seedGitHub(repos, localRepos) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ entire: { projects: [] }, github: { repos }, repos: localRepos ?? [] }, null, 2),
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

// --- 1. No repo configured ---
seedGitHub([], []);
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
await clickForge('GitHub');
await sleep(1500);
const noteEmpty = await sidebarNote();
check(
  'no repo configured says why (not a bare empty list)',
  typeof noteEmpty === 'string' && noteEmpty.includes('No GitHub repo configured'),
  `got "${noteEmpty}"`,
);

// --- 2. The switcher shows all three forge marks ---
// (Was two in 0.9.0; Linear joined the switcher in 0.10.0.)
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

// --- 3. One repo set: PRs + issues list, checks pills honest ---
seedGitHub(['xvoidsx/halo'], [{ id: 'halo', name: 'halo', path: REPO_PATH }]);
await send('Page.reload', { ignoreCache: true });
await sleep(1500);
await clickForge('GitHub');
const pr42 = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Forge switcher: Entire / GitHub logos in the sidebar' && el.textContent.includes('checks: passing'))`,
);
check('PR 42 lists with a passing-checks pill', pr42 === true, `got ${pr42}`);
const pr41 = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Fix close crash on window close (take two)' && el.textContent.includes('checks: failing'))`,
);
check('PR 41 lists with a failing-checks pill', pr41 === true, `got ${pr41}`);
const issue17 = await waitFor(
  `[...document.querySelectorAll('.trail-row .t-title')].some((el) => el.childNodes[0]?.textContent?.trim() === 'Horizontal splits (split down) need a split-tree model')`,
);
check('issue 17 lists', issue17 === true, `got ${issue17}`);

// --- 4. Branch status comes from real git ---
const statusLine = await waitFor(
  `document.querySelector('.gh-status')?.textContent ?? null`,
);
check(
  'repo group carries a branch-status line from real git',
  typeof statusLine === 'string' && statusLine.includes('main'),
  `got "${statusLine}"`,
);

// --- 5. Clicking PR 42 loads its detail ---
await clickRow('Forge switcher: Entire / GitHub logos in the sidebar');
const prDetail = await waitFor(
  `(() => { const t = document.querySelector('.main')?.innerText ?? ''; return t.includes('Adds the forge switcher') && t.includes('2 comments') && t.includes('Open on GitHub') ? true : null; })()`,
);
check('PR detail renders body, comment count, GitHub link', prDetail === true, `got ${prDetail}`);

// --- 6. Clicking issue 17 loads its detail too ---
await clickRow('Horizontal splits (split down) need a split-tree model');
const issueDetail = await waitFor(
  `(() => { const t = document.querySelector('.main')?.innerText ?? ''; return t.includes('Splitting down needs a nested split-tree model') && t.includes('1 comment') && t.includes('Open on GitHub') ? true : null; })()`,
);
check('issue detail renders body, comment count, GitHub link', issueDetail === true, `got ${issueDetail}`);

// --- 7. Settings shows the configured repo in the GitHub field ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
await sleep(1200);
const reposValue = await evalJs(`(() => {
  const labels = [...document.querySelectorAll('.settings label')];
  const l = labels.find((el) => el.textContent.trim().startsWith('Repos'));
  return l ? l.querySelector('textarea')?.value ?? null : null;
})()`);
check(
  'settings GitHub field holds the repo',
  typeof reposValue === 'string' && reposValue.includes('xvoidsx/halo'),
  `got "${reposValue}"`,
);

// --- 8. Back to Entire, so the next ui-smoke sees the Trails view ---
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
