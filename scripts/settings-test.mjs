// Settings test — drives the dev or packaged app over CDP.
// Expects the app open (any tab); the test reloads the page first
// for a known state.
//
//  1. Scrollbar: the settings scroller (.main-body) spans the full
//     main width, so its scrollbar sits at the window's right edge —
//     not in the middle. The inner .settings stays a 640px column.
//  2. BYOK: 11 provider cards (the original 4 + Groq, Mistral,
//     Hugging Face, Gemini, xAI, Venice, TrustedRouter).
//  3. Version: the Settings "Halo" section shows the running version.
//  4. Terminal font size: the select offers 11–18px, changing it
//     reflows the live terminal (fewer cols at a bigger size — read
//     from the host's data-cols mirror), and the choice persists.
//  5. Reset sidebar width: drag wide, reset, back to 280px and the
//     persisted key is gone.
//
// Usage: node scripts/settings-test.mjs [port]
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
const openSettings = async () => {
  await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Settings'))?.click()`);
  await sleep(1200);
};
// The terminal host (.terminal-host, inside .terminal-wrap) mirrors
// its live cols/rows in data attributes (set by Terminal.tsx on
// every resize) — the ground truth for "did a font-size change
// actually reflow this pane".
const termCols = () =>
  evalJs(`Number(document.querySelector('.terminal-panes .terminal-host')?.dataset.cols ?? 0)`);

// --- 1. Scrollbar at the right edge ---
await openSettings();
const scrollGeom = await evalJs(`(() => {
  const scroller = document.querySelector('.main-body');
  const inner = document.querySelector('.main-body .settings');
  if (!scroller || !inner) return null;
  const sr = scroller.getBoundingClientRect();
  const ir = inner.getBoundingClientRect();
  return {
    scrollerRight: Math.round(sr.right),
    innerWidth: window.innerWidth,
    innerSettingsWidth: Math.round(ir.width),
    scrollerScrollable: scroller.scrollHeight > scroller.clientHeight,
    innerScrollable: inner.scrollHeight > inner.clientHeight,
  };
})()`);
check('settings scroller spans to the window edge', scrollGeom && Math.abs(scrollGeom.scrollerRight - scrollGeom.innerWidth) <= 2, JSON.stringify(scrollGeom));
check('settings content stays a 640px column', scrollGeom && scrollGeom.innerSettingsWidth === 640, `got ${scrollGeom?.innerSettingsWidth}`);
check('the outer container scrolls, not the inner column', scrollGeom && scrollGeom.scrollerScrollable === true && scrollGeom.innerScrollable === false, JSON.stringify(scrollGeom));

// --- 2. BYOK provider cards ---
const providers = await evalJs(`[...document.querySelectorAll('.provider-card h4')].map((h) => h.textContent)`);
const expected = ['DeepSeek', 'OpenAI', 'Anthropic', 'OpenRouter', 'Groq', 'Mistral', 'Hugging Face', 'Google Gemini', 'xAI', 'Venice', 'TrustedRouter'];
check('11 BYOK provider cards', Array.isArray(providers) && providers.length === 11, `got ${providers?.length}: ${providers?.join(', ')}`);
check('all expected providers present', Array.isArray(providers) && expected.every((n) => providers.includes(n)), `missing: ${expected.filter((n) => !providers.includes(n)).join(', ')}`);

// --- 3. Version display ---
const versionText = await evalJs(`[...document.querySelectorAll('.settings .note')].map((n) => n.textContent).find((t) => t.startsWith('Version '))`);
check('settings shows the running version', typeof versionText === 'string' && /Version [0-9]+\.[0-9]+\.[0-9]+/.test(versionText), `got "${versionText}"`);

// --- 4. Terminal font size ---
const fontSizes = await evalJs(`[...document.querySelectorAll('.settings select')].map((s) => [...s.options].map((o) => o.value))`);
const sizeSelect = await evalJs(`(() => {
  const selects = [...document.querySelectorAll('.settings select')];
  const s = selects.find((el) => [...el.options].some((o) => o.value === '16'));
  return s ? { value: s.value, options: [...s.options].map((o) => o.value) } : null;
})()`);
check('font-size select offers 11–18px', sizeSelect && JSON.stringify(sizeSelect.options) === JSON.stringify(['11', '12', '13', '14', '15', '16', '18']), JSON.stringify(sizeSelect?.options));
// Live reflow: go to the Terminal tab, read cols at 13px, set 16px, read again.
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Terminal'))?.click()`);
await sleep(2500);
const cols13 = await termCols();
check('terminal reports a size at 13px', typeof cols13 === 'number' && cols13 > 0, `got ${cols13}`);
// Back to Settings, bump the font size to 16, save.
await openSettings();
await evalJs(`(() => {
  const selects = [...document.querySelectorAll('.settings select')];
  const s = selects.find((el) => [...el.options].some((o) => o.value === '16'));
  if (!s) return false;
  s.value = '16';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(1200);
const cols16 = await (async () => {
  await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Terminal'))?.click()`);
  await sleep(1500);
  return termCols();
})();
check('bigger font means fewer columns (live reflow, no re-spawn)', typeof cols16 === 'number' && typeof cols13 === 'number' && cols16 < cols13, `13px=${cols13} cols, 16px=${cols16} cols`);
// Persistence: save, reload, the select still reads 16.
await openSettings();
await evalJs(`[...document.querySelectorAll('.settings .primary-btn')].find((b) => b.textContent.includes('Save settings'))?.click()`);
await sleep(1000);
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
await openSettings();
const sizeAfterReload = await evalJs(`(() => {
  const selects = [...document.querySelectorAll('.settings select')];
  const s = selects.find((el) => [...el.options].some((o) => o.value === '16'));
  return s ? s.value : null;
})()`);
check('font size persists across reload', sizeAfterReload === '16', `got ${sizeAfterReload}`);
// Restore 13px so the rig is left tidy.
await evalJs(`(() => {
  const selects = [...document.querySelectorAll('.settings select')];
  const s = selects.find((el) => [...el.options].some((o) => o.value === '13'));
  if (!s) return false;
  s.value = '13';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(500);
await evalJs(`[...document.querySelectorAll('.settings .primary-btn')].find((b) => b.textContent.includes('Save settings'))?.click()`);
await sleep(800);

// --- 5. Reset sidebar width ---
const sidebarWidth = () =>
  evalJs(`Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)`);
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
const wide = await sidebarWidth();
check('sidebar dragged wide first', wide === 380, `got ${wide}`);
await openSettings();
await evalJs(`[...document.querySelectorAll('.settings button')].find((b) => b.textContent.includes('Reset sidebar width'))?.click()`);
await sleep(500);
const reset = await sidebarWidth();
check('reset returns the sidebar to 280px', reset === 280, `got ${reset}`);
const keyGone = await evalJs(`window.localStorage.getItem('halo.sidebarWidth')`);
check('reset forgets the persisted width', keyGone === null, `got ${keyGone}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
