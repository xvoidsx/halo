// Notes test — drives the dev or packaged app over CDP against
// the fake `notion-cli` in ~/workspace/.tmp/fakebin (real recent
// pages from Raven's workspace) and a throwaway Obsidian vault in
// /tmp. No Notion token is configured, so Notion reads stay
// connector-only and the detail view is honest about the missing
// token; Obsidian reads + writes go through the vault on disk.
// Expects the app open (any tab); the test reloads the page first
// for a known state. The vault is removed at the end.
//
//  1. The Notes view lists the fake Notion recent pages.
//  2. The Notes view lists the vault's .md files.
//  3. Clicking a vault note shows its content.
//  4. Clicking a Notion page (no token) says the token is needed.
//  5. Creating a note to the vault writes the file and lists it.
//  6. Settings shows the Notes section with its fields.
//
// Usage: node scripts/notes-test.mjs [port]
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

const VAULT = '/tmp/halo-notes-vault';
fs.rmSync(VAULT, { recursive: true, force: true });
fs.mkdirSync(VAULT, { recursive: true });
fs.writeFileSync(path.join(VAULT, 'lab-week.md'), '# Lab week\n\nTrain koe + kimeru.\n');
fs.writeFileSync(path.join(VAULT, 'halo-notes.md'), '# Halo notes\n\nConnections, spawn, notes.\n');

const SETTINGS_FILE = path.join(os.homedir(), '.config', 'halo', 'settings.json');
function seed() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        entire: { projects: [] },
        github: { repos: [] },
        linear: { team: 'xvoidsx', apiKey: '' },
        notes: { notionToken: '', notionDatabaseId: '', obsidianPath: VAULT },
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
await sleep(4000);

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
const openNotes = () => evalJs(`document.querySelector('.notes-btn')?.click()`);
const noteTitles = () => evalJs(`[...document.querySelectorAll('.note-row')].map((r) => r.textContent)`);
const clickNote = (title) =>
  evalJs(
    `[...document.querySelectorAll('.note-row')].find((r) => r.textContent.includes(${JSON.stringify(title)}))?.click()`,
  );

await openNotes();
await sleep(1000);

// --- 1 + 2. The list holds the fake Notion pages and the vault files ---
const titles = await waitFor(
  `(() => {
    const rows = [...document.querySelectorAll('.note-row')].map((r) => r.textContent);
    return rows.length >= 5 ? rows : null;
  })()`,
);
check(
  'notes list shows the fake Notion recent pages',
  Array.isArray(titles) && titles.some((t) => t.includes('xvoidsx dev log')) && titles.some((t) => t.includes('xvoidsx Outreach')),
  `got ${JSON.stringify(titles)}`,
);
check(
  'notes list shows the vault .md files',
  Array.isArray(titles) && titles.some((t) => t.includes('lab-week')) && titles.some((t) => t.includes('halo-notes')),
  `got ${JSON.stringify(titles)}`,
);

// --- 3. Clicking a vault note shows its content ---
await clickNote('lab-week');
const vaultDetail = await waitFor(
  `(() => { const t = document.querySelector('.notes-detail')?.innerText ?? ''; return t.includes('Train koe + kimeru') ? true : null; })()`,
);
check('vault note detail renders its content', vaultDetail === true, `got ${vaultDetail}`);

// --- 4. A Notion page without a token is honest about it ---
await clickNote('xvoidsx dev log');
const notionDetail = await waitFor(
  `(() => { const t = document.querySelector('.notes-detail')?.innerText ?? ''; return t.includes('integration token') ? true : null; })()`,
);
check('notion page without a token says the token is needed', notionDetail === true, `got ${notionDetail}`);

// --- 5. Creating a note to the vault writes the file and lists it ---
await evalJs(`[...document.querySelectorAll('.notes-view button')].find((b) => b.textContent.includes('New'))?.click()`);
await sleep(800);
await evalJs(`(() => {
  const ed = document.querySelector('.note-editor');
  const title = ed?.querySelector('input');
  const body = ed?.querySelector('textarea');
  if (!title || !body) return;
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(title, 'Test note from Halo');
  set(body, 'written by the notes test');
})()`);
await evalJs(`[...document.querySelectorAll('.note-editor button')].find((b) => b.textContent.includes('Push'))?.click()`);
// The list titles Obsidian notes by filename slug (same as the
// existing vault files — 'lab-week', not '# Lab week'), so the
// created note lists as 'test-note-from-halo'.
const created = await waitFor(
  `(() => { const rows = [...document.querySelectorAll('.note-row')].map((r) => r.textContent); return rows.some((t) => t.includes('test-note-from-halo')) ? true : null; })()`,
);
check('created note appears in the list', created === true, `got ${created}`);
const createdFile = path.join(VAULT, 'test-note-from-halo.md');
check(
  'created note lands as a file in the vault',
  fs.existsSync(createdFile) && fs.readFileSync(createdFile, 'utf8').includes('written by the notes test'),
  `exists: ${fs.existsSync(createdFile)}`,
);

// --- 6. Settings shows the Notes section ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
await sleep(1200);
const notesSection = await evalJs(
  `(() => {
    const h = [...document.querySelectorAll('.settings h3')].find((el) => el.textContent.trim() === 'Notes');
    if (!h) return null;
    const sec = h.parentElement?.innerText ?? '';
    return {
      token: sec.includes('integration token'),
      vault: sec.includes('Obsidian vault'),
      databases: sec.includes('Find databases'),
    };
  })()`,
);
check(
  'settings Notes section has token + vault + database fields',
  notesSection?.token === true && notesSection?.vault === true && notesSection?.databases === true,
  `got ${JSON.stringify(notesSection)}`,
);

fs.rmSync(VAULT, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
