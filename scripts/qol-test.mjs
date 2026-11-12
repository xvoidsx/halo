// QoL test (0.13.0) — drives the dev or packaged app over CDP:
// per-pane zoom, pane maximize, layout persistence, Ctrl+K switcher,
// unread dots, the live trail indicator, and in-pane find. Seeds
// settings (entire.projects et/xvoidsx, github repos xvoidsx/halo,
// linear team xvoidsx), clears the seen-ids so the unread dots are
// deterministic, reloads, and leaves the forge on Entire with one
// terminal pane.
//
//  1. The Trails heading carries a "live" badge (watch connected).
//  2. GitHub + Linear forge buttons carry an unread dot; Entire
//     (the active forge) does not; looking at Linear clears its dot.
//  3. Ctrl+K opens the switcher; typing "trail" lists the trail;
//     Enter jumps to it.
//  4. Ctrl+= zooms the focused pane (fewer cols, +1px badge);
//     Ctrl+0 resets it.
//  5. Maximize hides the other pane and spans the container;
//     Unmaximize brings it back.
//  6. Two panes survive a page reload (layout persistence), then
//     closing back to one persists a one-pane layout.
//  7. Ctrl+F opens the find bar; a marker typed into the pane
//     is found; Esc closes it.
//
// Usage: node scripts/qol-test.mjs [port]
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
// Dispatch a real key chord through CDP. CDP modifier bits: Alt=1,
// Ctrl=2, Meta=4, Shift=8 — so plain Ctrl is 2, Ctrl+Shift is 10.
const chord = async (key, code, vk, modifiers = 2) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk });
  await sleep(60);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk });
  await sleep(400);
};
const clickMainHead = async (label) =>
  evalJs(`(() => {
    const b = [...document.querySelectorAll('.main-head .icon-btn')].find((x) => x.textContent.includes('${label}'));
    if (!b) return false;
    b.click();
    return true;
  })()`);

seed();
// Deterministic start: no seen ids (so the unread dots show), the
// forge on Entire, no saved layout (so the terminal starts at one pane).
await evalJs(`(() => {
  window.localStorage.removeItem('halo.seenIds');
  window.localStorage.removeItem('halo.termLayout');
  window.localStorage.setItem('halo.forge', 'entire');
  return true;
})()`);
await send('Page.reload', { ignoreCache: true });
await sleep(5000);

// --- 1. Live trail indicator ---
const live = await waitFor(`!!document.querySelector('.live-dot')`);
check('the Trails heading carries a live badge once the watch connects', live === true);

// --- 2. Unread dots ---
const rows = await waitFor(`document.querySelectorAll('.trail-row').length > 0`);
check('the trail list loads', rows === true);
const dots = await waitFor(
  `(() => {
    const btns = [...document.querySelectorAll('.forge-btn')];
    const has = (label) => {
      const b = btns.find((x) => x.textContent.includes(label));
      return !!b?.querySelector('.unread-dot');
    };
    return has('GitHub') && has('Linear') && !has('Entire') ? { gh: true, lin: true } : null;
  })()`,
);
check('GitHub + Linear carry unread dots while Entire (active) does not', dots !== null, `got ${JSON.stringify(dots)}`);
await evalJs(`[...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.includes('Linear')).click()`);
await sleep(1200);
const linCleared = await evalJs(
  `!([...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.includes('Linear')).querySelector('.unread-dot'))`,
);
check('looking at Linear clears its unread dot', linCleared === true);
await evalJs(`[...document.querySelectorAll('.forge-btn')].find((b) => b.textContent.includes('Entire')).click()`);
await sleep(800);

// --- 3. Ctrl+K switcher ---
await chord('k', 'KeyK', 75);
const switcherOpen = await waitFor(`!!document.querySelector('.quick-switcher')`);
check('Ctrl+K opens the quick switcher', switcherOpen === true);
await evalJs(`document.querySelector('.quick-switcher input')?.focus()`);
await send('Input.insertText', { text: 'trail' });
const hit = await waitFor(
  `(() => {
    const rows = [...document.querySelectorAll('.quick-list button')];
    return rows.some((r) => r.textContent.includes('Trails test: first trail')) ? rows.length : null;
  })()`,
);
check('typing "trail" lists the trail', typeof hit === 'number' && hit >= 1, `got ${hit}`);
await chord('Enter', 'Enter', 13, 0);
await sleep(800);
const jumped = await evalJs(
  `!document.querySelector('.quick-switcher') && document.querySelector('.main-head h2')?.textContent.includes('Trails test: first trail')`,
);
check('Enter jumps to the trail and closes the switcher', jumped === true);

// --- 4. Per-pane zoom ---
await clickMainHead('Terminal');
await sleep(1500);
const cols0 = await evalJs(`Number(document.querySelector('.terminal-host')?.dataset.cols ?? 0)`);
check('the terminal reports its columns', cols0 > 0, `got ${cols0}`);
await chord('=', 'Equal', 187);
await sleep(800);
const zoomed = await evalJs(
  `(() => {
    const host = document.querySelector('.terminal-host');
    const badge = document.querySelector('.t-zoom');
    return { cols: Number(host?.dataset.cols ?? 0), badge: badge?.textContent ?? '' };
  })()`,
);
check(
  'Ctrl+= zooms the pane (fewer cols, +1px badge)',
  zoomed.cols < cols0 && zoomed.badge === '+1px',
  `got ${JSON.stringify(zoomed)} (was ${cols0})`,
);
await chord('0', 'Digit0', 48);
await sleep(800);
const reset = await evalJs(
  `(() => {
    const host = document.querySelector('.terminal-host');
    return { cols: Number(host?.dataset.cols ?? 0), badge: !!document.querySelector('.t-zoom') };
  })()`,
);
check('Ctrl+0 resets the zoom', reset.cols === cols0 && reset.badge === false, `got ${JSON.stringify(reset)}`);

// --- 5. Pane maximize ---
await evalJs(`[...document.querySelectorAll('.terminal-toolbar .icon-btn')].find((b) => b.textContent.includes('Split'))?.click()`);
const two = await waitFor(`document.querySelectorAll('.terminal-panes > .terminal-wrap').length === 2`);
check('Split gives two panes', two === true);
await evalJs(`[...document.querySelectorAll('.terminal-toolbar .icon-btn')].find((b) => b.textContent.includes('Maximize'))?.click()`);
await sleep(800);
const maxed = await evalJs(
  `(() => {
    const wraps = [...document.querySelectorAll('.terminal-panes > .terminal-wrap')];
    const container = document.querySelector('.terminal-panes');
    if (wraps.length !== 2 || !container) return null;
    // Which pane is maximized depends on focus (the new pane focuses
    // itself on spawn), so assert exactly one is hidden and the
    // visible one spans the container, whichever it is.
    const hidden = wraps.filter((w) => getComputedStyle(w).display === 'none');
    const visible = wraps.find((w) => getComputedStyle(w).display !== 'none');
    const wide = visible && Math.abs(visible.getBoundingClientRect().width - container.getBoundingClientRect().width) < 4;
    return { hiddenCount: hidden.length, wide: !!wide };
  })()`,
);
check('Maximize hides the other pane and spans the container', maxed?.hiddenCount === 1 && maxed?.wide === true, `got ${JSON.stringify(maxed)}`);
await evalJs(`[...document.querySelectorAll('.terminal-toolbar .icon-btn')].find((b) => b.textContent.includes('Unmaximize'))?.click()`);
await sleep(800);
const unmaxed = await evalJs(
  `(() => {
    const wraps = [...document.querySelectorAll('.terminal-panes > .terminal-wrap')];
    return wraps.length === 2 && wraps.every((w) => getComputedStyle(w).display !== 'none');
  })()`,
);
check('Unmaximize brings the other pane back', unmaxed === true);

// --- 6. Layout persistence across reload ---
await send('Page.reload', { ignoreCache: true });
await sleep(5000);
await clickMainHead('Terminal');
const restored = await waitFor(`document.querySelectorAll('.terminal-panes > .terminal-wrap').length === 2`, 15000);
check('two panes survive a page reload (layout persistence)', restored === true);
await evalJs(
  `(() => {
    const wraps = [...document.querySelectorAll('.terminal-panes > .terminal-wrap')];
    wraps[1].querySelector('.t-close')?.click();
    return true;
  })()`,
);
await sleep(1200);
const layoutSaved = await evalJs(
  `(() => {
    try {
      const l = JSON.parse(window.localStorage.getItem('halo.termLayout') ?? 'null');
      return l?.panes?.length ?? -1;
    } catch {
      return -1;
    }
  })()`,
);
check('closing back to one pane persists a one-pane layout', layoutSaved === 1, `got ${layoutSaved}`);

// --- 7. In-pane find ---
// The search target is typed into the pane first — the prompt's
// username is user-dependent (root in the dev sandbox, halotest in
// the packaged run), so searching for 'root' only passes as root.
await evalJs(`document.querySelector('.terminal-host')?.click()`);
await sleep(300);
await send('Input.insertText', { text: 'echo HALO_FIND_ME\r' });
await sleep(800);
await chord('f', 'KeyF', 70);
const findOpen = await waitFor(
  `(() => {
    const bar = document.querySelector('.term-search');
    return bar && document.activeElement === bar.querySelector('input') ? true : null;
  })()`,
);
check('Ctrl+F opens the find bar with its input focused', findOpen === true);
await send('Input.insertText', { text: 'HALO_FIND_ME' });
const found = await waitFor(
  `(() => {
    const state = document.querySelector('.term-search-state')?.textContent ?? '';
    const input = document.querySelector('.term-search input');
    return state === 'found' && !input?.classList.contains('no-match') ? true : null;
  })()`,
);
check('typing "HALO_FIND_ME" finds a match in the pane', found === true);
await chord('Escape', 'Escape', 27, 0);
await sleep(500);
const findClosed = await evalJs(`!document.querySelector('.term-search')`);
check('Esc closes the find bar', findClosed === true);

// Cleanup: back to Trails on Entire, one terminal pane.
await clickMainHead('Trails');
await sleep(500);

console.log(failures === 0 ? 'QOL TEST: PASS' : `QOL TEST: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
