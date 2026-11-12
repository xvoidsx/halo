// Sidebar + split-controls test — drives the dev or packaged app
// over CDP. Expects the app open (any tab); the test reloads the
// page first for a known state.
//
//  1. Sidebar: dragging its right-edge handle resizes it (200–420px)
//     and the width persists to localStorage across a reload.
//  2. Ctrl+Shift+D splits the focused terminal pane; the new pane
//     lands beside it and takes focus.
//  3. Ctrl+Shift+ArrowRight/Left moves focus between panes.
//  4. Ctrl+Shift+Q closes the focused pane (and only when more
//     than one pane exists).
//  5. Right-clicking a pane shows the context menu; "Split right"
//     splits that pane, and the menu dismisses.
//
// Usage: node scripts/sidebar-shortcuts-test.mjs [port]
const PORT = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
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
// Known state: clear the persisted sidebar width, then reload.
await send('Runtime.evaluate', { expression: `window.localStorage.removeItem('halo.sidebarWidth')`, returnByValue: true });
await send('Page.reload', { ignoreCache: true });
await sleep(4000);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
const sidebarWidth = () =>
  evalJs(`Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)`);
const paneCount = () =>
  evalJs(`document.querySelectorAll('.terminal-panes > .terminal-wrap').length`);
// Which pane holds keyboard focus (index into the .terminal-wrap list,
// -1 when none). The xterm's helper textarea is the focused element.
const focusedPaneIndex = () =>
  evalJs(`(() => {
    const ae = document.activeElement;
    if (!ae || !ae.classList.contains('xterm-helper-textarea')) return -1;
    const wraps = [...document.querySelectorAll('.terminal-panes > .terminal-wrap')];
    return wraps.findIndex((w) => w.contains(ae));
  })()`);
// Dispatch a real key chord through CDP. CDP modifier bits: Alt=1,
// Ctrl=2, Meta=4, Shift=8 — so Ctrl+Shift is 10, NOT 6.
const chord = async (key, code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: 10, windowsVirtualKeyCode: key.length === 1 ? key.charCodeAt(0) : 0 });
  await sleep(60);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: 10, windowsVirtualKeyCode: key.length === 1 ? key.charCodeAt(0) : 0 });
  await sleep(400);
};

// --- 1. Sidebar resize + persistence ---
const w0 = await sidebarWidth();
check('sidebar starts at 280px', w0 === 280, `got ${w0}`);
await evalJs(`(() => {
  const d = document.querySelector('.sidebar-divider');
  const r = d.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1 }));
  for (let i = 1; i <= 10; i++) { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + i * 10, clientY: cy, pointerId: 1 })); }
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx + 100, clientY: cy, pointerId: 1 }));
  return true;
})()`);
await sleep(500);
const w1 = await sidebarWidth();
check('sidebar drag widens it', w1 === w0 + 100, `${w0} -> ${w1}`);
const saved = await evalJs(`window.localStorage.getItem('halo.sidebarWidth')`);
check('sidebar width persisted', saved === String(w1), `saved=${saved}`);
// Clamp: drag far left, expect the 200px floor.
await evalJs(`(() => {
  const d = document.querySelector('.sidebar-divider');
  const r = d.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx - 500, clientY: cy, pointerId: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx - 500, clientY: cy, pointerId: 1 }));
  return true;
})()`);
await sleep(500);
const w2 = await sidebarWidth();
check('sidebar drag clamps at 200px', w2 === 200, `got ${w2}`);
// Persistence across reload.
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
const w3 = await sidebarWidth();
check('sidebar width survives reload', w3 === 200, `got ${w3}`);

// --- Terminal tab: shortcuts + context menu ---
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Terminal'))?.click()`);
await sleep(2500);
const n0 = await paneCount();
check('terminal starts with one pane', n0 === 1, `got ${n0}`);

// --- 2. Ctrl+Shift+D splits the focused pane ---
await chord('D', 'KeyD');
await sleep(1200);
const n1 = await paneCount();
check('Ctrl+Shift+D splits to two panes', n1 === 2, `got ${n1}`);
const f1 = await focusedPaneIndex();
check('new pane takes focus', f1 === 1, `focused=${f1}`);

// --- 3. Ctrl+Shift+Arrow moves focus ---
await chord('ArrowLeft', 'ArrowLeft');
await sleep(300);
const f2 = await focusedPaneIndex();
check('Ctrl+Shift+ArrowLeft moves focus to pane 0', f2 === 0, `focused=${f2}`);
await chord('ArrowRight', 'ArrowRight');
await sleep(300);
const f3 = await focusedPaneIndex();
check('Ctrl+Shift+ArrowRight moves focus to pane 1', f3 === 1, `focused=${f3}`);
// At the edge, focus stays put (no wrap).
await chord('ArrowRight', 'ArrowRight');
await sleep(300);
const f4 = await focusedPaneIndex();
check('focus stays at the last pane', f4 === 1, `focused=${f4}`);

// --- 5. Context menu: Split right on pane 0 ---
const menuShown = await evalJs(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wrap = document.querySelectorAll('.terminal-panes > .terminal-wrap')[0];
  const r = wrap.getBoundingClientRect();
  wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 50, clientY: r.top + 80 }));
  // React renders the menu on the next tick, not synchronously.
  await sleep(200);
  return !!document.querySelector('.ctx-menu');
})()`);
check('right-click shows the pane menu', menuShown === true);
await evalJs(`[...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent.includes('Split right'))?.click()`);
await sleep(1200);
const n2 = await paneCount();
check('menu "Split right" splits to three panes', n2 === 3, `got ${n2}`);
const menuGone = await evalJs(`!document.querySelector('.ctx-menu')`);
check('menu dismisses after picking an item', menuGone === true);

// --- 4. Ctrl+Shift+Q closes the focused pane ---
// Focus is on the newest pane (index 2 after the menu split).
await chord('Q', 'KeyQ');
await sleep(800);
const n3 = await paneCount();
check('Ctrl+Shift+Q closes the focused pane', n3 === 2, `got ${n3}`);
const f5 = await focusedPaneIndex();
check('focus lands on a neighbour after close', f5 >= 0 && f5 < 2, `focused=${f5}`);
// Close again to one pane, then confirm the last pane cannot close.
await chord('Q', 'KeyQ');
await sleep(800);
const n4 = await paneCount();
check('second close leaves one pane', n4 === 1, `got ${n4}`);
await chord('Q', 'KeyQ');
await sleep(500);
const n5 = await paneCount();
check('last pane cannot be closed', n5 === 1, `got ${n5}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
