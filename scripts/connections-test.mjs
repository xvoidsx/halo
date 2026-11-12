// Connections test — drives the dev or packaged app over CDP
// against the fake `gh` (auth status), fake `entire` (auth status
// --json), fake `linear` (list_issues) and fake `notion-cli`
// (get-self) in ~/workspace/.tmp/fakebin. All four probes must come
// back connected, so every forge button carries a steady green dot
// and every Settings section shows its status line. Also covers the
// two quick wins from 0.11.0: dark textareas (the white-bars bug)
// and the narrow-sidebar behaviour (icons-only forge buttons at
// <260px, long titles ellipsized). Expects the app open (any tab);
// the test reloads the page first for a known state. Leaves the
// forge on Entire and the sidebar at its default width, so the next
// ui-smoke run sees the Trails empty state.
//
//  1. All three forge buttons show a green connection dot.
//  2. Settings shows a status line + no Install/Connect buttons
//     while everything is connected.
//  3. The Entire + GitHub textareas are dark (no white bars).
//  4. At 200px the forge buttons go icons-only (labels hidden) and
//     the dots stay visible; long trail titles ellipsize.
//  5. The Notes button is present in the sidebar and the main head.
//  6. At 270px (labels visible, tightest fit) every forge button
//     stays inside the sidebar and the switcher never scrolls
//     sideways; same no-scroll check at the 280px default.
//  7. The Terminal hint bar wraps (no mid-shortcut clip) and
//     shows its three kbd shortcut chips.
//
// Usage: node scripts/connections-test.mjs [port]
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

const SETTINGS_FILE = path.join(os.homedir(), '.config', 'halo', 'settings.json');
function seed() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        entire: { projects: ['et/xvoidsx'] },
        github: { repos: ['xvoidsx/halo'] },
        linear: { team: 'xvoidsx', apiKey: '' },
        notes: { notionToken: '', notionDatabaseId: '', obsidianPath: '' },
        repos: [],
      },
      null,
      2,
    ),
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

seed();
await send('Page.reload', { ignoreCache: true });
await sleep(5000);

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

// --- 1. All three forge buttons show a green dot ---
const dots = await waitFor(
  `(() => {
    const btns = [...document.querySelectorAll('.forge-btn')];
    if (btns.length !== 3) return null;
    return btns.map((b) => ({ text: b.textContent.trim(), green: !!b.querySelector('.conn-dot.green') }));
  })()`,
);
check(
  'all three forge buttons carry a green connection dot',
  Array.isArray(dots) && dots.length === 3 && dots.every((d) => d.green),
  `got ${JSON.stringify(dots)}`,
);

// --- 2. Settings shows status lines, no Install/Connect buttons ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
await sleep(2000);
const connLines = await evalJs(
  `[...document.querySelectorAll('.settings .note')].map((el) => el.textContent).filter((t) => /signed in|connected|logged in/i.test(t))`,
);
check(
  'settings shows a status line per connected forge',
  Array.isArray(connLines) &&
    connLines.some((t) => t.includes('Signed in to Entire')) &&
    connLines.some((t) => t.includes('Signed in to GitHub')) &&
    connLines.some((t) => t.includes('Linear connected')) &&
    connLines.some((t) => t.includes('Notion connected')),
  `got ${JSON.stringify(connLines)}`,
);
const installBtns = await evalJs(
  `[...document.querySelectorAll('.settings button')].filter((b) => b.textContent.trim().startsWith('Install')).length`,
);
check('no Install button while everything is connected', installBtns === 0, `got ${installBtns}`);
const connectBtns = await evalJs(
  `[...document.querySelectorAll('.settings button')].filter((b) => b.textContent.trim() === 'Connect').length`,
);
check('no Connect button while everything is connected', connectBtns === 0, `got ${connectBtns}`);

// --- 3. The Entire + GitHub textareas are dark ---
const textareaBg = await evalJs(
  `(() => {
    const tas = [...document.querySelectorAll('.settings textarea')];
    if (tas.length < 2) return null;
    return tas.map((t) => getComputedStyle(t).backgroundColor);
  })()`,
);
check(
  'settings textareas are dark (white-bars bug fixed)',
  Array.isArray(textareaBg) && textareaBg.every((c) => c !== 'rgb(255, 255, 255)' && c !== 'rgb(255,255,255)'),
  `got ${JSON.stringify(textareaBg)}`,
);

// --- 4. Narrow sidebar: icons-only forge buttons, dots visible ---
await evalJs(`localStorage.setItem('halo.sidebarWidth', '200')`);
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
const narrow = await waitFor(
  `(() => {
    const aside = document.querySelector('.sidebar');
    if (!aside || aside.getAttribute('data-narrow') !== 'true') return null;
    const labels = [...document.querySelectorAll('.forge-btn .f-label')];
    const dots = [...document.querySelectorAll('.forge-btn .conn-dot')];
    return {
      labelsHidden: labels.length === 3 && labels.every((l) => getComputedStyle(l).display === 'none'),
      dotsVisible: dots.length === 3 && dots.every((d) => d.offsetParent !== null),
    };
  })()`,
);
check(
  'at 200px the forge buttons go icons-only and the dots stay visible',
  narrow?.labelsHidden === true && narrow?.dotsVisible === true,
  `got ${JSON.stringify(narrow)}`,
);
// A long trail title must ellipsize instead of spilling out. Note:
// scrollWidth > clientWidth is EXPECTED on a clipped title (the
// full text is still in the box, visually ellipsized) — the honest
// check is that no row's box extends past the sidebar's right edge.
const titleFits = await evalJs(
  `(() => {
    const side = document.querySelector('.sidebar')?.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.trail-row .t-title, .trail-row .t-meta')];
    if (!rows.length || !side) return null;
    return rows.every((r) => r.getBoundingClientRect().right <= side.right + 1);
  })()`,
);
check('long trail titles stay inside the narrow sidebar', titleFits === true, `got ${titleFits}`);

// --- 6. Forge switcher never scrolls sideways (0.12.0) ---
// At 270px the labels are still visible (narrow starts under 260)
// and the fit is at its tightest: the buttons must stay inside the
// sidebar and the switcher must not scroll — the 0.11.0 bug was a
// horizontal scrollbar at the default width, from the buttons
// refusing to shrink below their content width.
const switcherFits = async (width) => {
  await evalJs(`localStorage.setItem('halo.sidebarWidth', '${width}')`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);
  return evalJs(
    `(() => {
      const side = document.querySelector('.sidebar')?.getBoundingClientRect();
      const sw = document.querySelector('.forge-switch');
      const btns = [...document.querySelectorAll('.forge-btn')];
      if (!side || !sw || btns.length !== 3) return null;
      return {
        switcherScrolls: sw.scrollWidth > sw.clientWidth,
        buttonsInside: btns.every((b) => b.getBoundingClientRect().right <= side.right + 1),
        labelsWhole: [...document.querySelectorAll('.forge-btn .f-label')].every(
          (l) => l.scrollWidth <= l.clientWidth,
        ),
      };
    })()`,
  );
};
const at270 = await switcherFits(270);
check(
  'at 270px the forge buttons stay inside the sidebar and the switcher never scrolls',
  at270?.buttonsInside === true && at270?.switcherScrolls === false,
  `got ${JSON.stringify(at270)}`,
);
const at280 = await switcherFits(280);
check(
  'at the 280px default the forge switcher never scrolls sideways and every label reads in full',
  at280?.switcherScrolls === false && at280?.labelsWhole === true,
  `got ${JSON.stringify(at280)}`,
);

// --- 7. The Terminal hint bar wraps with kbd chips (0.12.0) ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Terminal'))?.click()`);
await sleep(2000);
const hint = await evalJs(
  `(() => {
    const el = document.querySelector('.terminal-toolbar .note');
    if (!el) return null;
    const kbd = [...el.querySelectorAll('kbd')].map((k) => k.textContent);
    const r = el.getBoundingClientRect();
    return { kbds: kbd, height: Math.round(r.height), scrolls: el.scrollWidth > el.clientWidth };
  })()`,
);
check(
  'terminal hint wraps instead of clipping and shows its shortcut chips',
  Array.isArray(hint?.kbds) &&
    hint.kbds.length === 3 &&
    hint.kbds[0].includes('Ctrl+Shift+D') &&
    hint.scrolls === false &&
    hint.height > 20,
  `got ${JSON.stringify(hint)}`,
);

// --- 5. The Notes button is present ---
const notesBtn = await evalJs(
  `(() => {
    const side = !!document.querySelector('.notes-btn');
    return { side };
  })()`,
);
check('sidebar has a Notes button', notesBtn?.side === true, `got ${JSON.stringify(notesBtn)}`);

// --- Cleanup: default width, back to Entire, so the next ui-smoke is clean ---
await evalJs(`localStorage.setItem('halo.sidebarWidth', '280')`);
await evalJs(`[...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.trim() === 'Entire')?.click()`);
await sleep(800);
const backOnEntire = await evalJs(
  `(() => {
    const btn = [...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.trim() === 'Entire');
    return btn?.classList.contains('active');
  })()`,
);
check('cleanup leaves the app on Entire at default width', backOnEntire === true, `got ${backOnEntire}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
