// Chat-list check for Halo 0.3.0 against a REAL herdr server (0.9.5)
// with TWO live agents (fakepi w1:p1, fakepi2 w1:p2).
// Launch Halo with --remote-debugging-port=9222 first, then run this.
//
// Covers, in order:
//  1. the chat list shows both live agents, blocked-first ordered
//  2. clicking a row jumps into that agent's chat
//  3. output on a background agent raises an unread dot + preview
//  4. switching back shows the background output (transcript persists)
//  5. sticky scroll: scrolled-up log stays put, jump-to-latest pill appears
//  6. jump-to-terminal opens a pane running `herdr agent attach <pane>`
//     and the attach renders the agent's live screen
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('no CDP page target after 20s');
}

const ws = new WebSocket(await getPageWs());
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => { ws.onopen = r; });
await send('Runtime.enable');
await sleep(4000); // let herdrStatus() land

const expr = `(async () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const btnByText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
  const out = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  out.chip = q('.agents-chip')?.textContent ?? null;

  // Open the Chat tab.
  btnByText('✦ Chat')?.click();
  await sleep(1200);
  const rows = () => qa('.chat-row');
  out.rowCount = rows().length;
  out.rowTexts = rows().map((r) => r.textContent);
  out.listHeading = !!q('.chat-list h2');

  // Jump into the second chat.
  rows()[1]?.click();
  await sleep(600);
  out.selectedHead = q('.chat-head .c-agent')?.textContent ?? null;
  out.jumpBtn = !!q('.chat-head .c-jump');

  // Collect terminal data now, so the attach render is captured.
  window.__termData = '';
  window.halo.onTermData((ev) => { window.__termData += ev.data; });

  // Talk to the agent we are NOT looking at (fakepi, w1:p1).
  const sendRes = await window.halo.agentSend('w1:p1', 'background hello');
  out.bgSendOk = sendRes.ok;

  // Wait for the ~10s background sweep to raise the unread dot + preview.
  let dot = false;
  let preview = '';
  for (let i = 0; i < 16; i++) {
    await sleep(1000);
    const row = rows().find((r) => r.textContent.includes('fakepi') && !r.textContent.includes('fakepi2'));
    dot = !!row?.querySelector('.c-unread');
    preview = row?.querySelector('.c-preview')?.textContent ?? '';
    if (dot && preview.includes('background hello')) break;
  }
  out.bgDot = dot;
  out.bgPreview = preview;

  // Jump back: transcript must show the background output, dot clears.
  rows().find((r) => r.textContent.includes('fakepi') && !r.textContent.includes('fakepi2'))?.click();
  await sleep(600);
  out.backHead = q('.chat-head .c-agent')?.textContent ?? null;
  out.logHasBg = (q('.chat-log')?.textContent ?? '').includes('background hello');
  out.dotCleared = !rows().find((r) => r.textContent.includes('fakepi') && !r.textContent.includes('fakepi2'))?.querySelector('.c-unread');

  // Sticky scroll: fill the log, scroll up, send more, check it stays put.
  for (let i = 0; i < 15; i++) {
    await window.halo.agentSend('w1:p1', 'scroll filler ' + i);
    await sleep(250);
  }
  await sleep(4000); // let the 2s poll append the echoes
  const log = q('.chat-log');
  out.logScrollable = log ? log.scrollHeight > log.clientHeight + 10 : false;
  if (log) log.scrollTop = 0;
  await sleep(300); // let the scroll handler register the unpin
  await window.halo.agentSend('w1:p1', 'after scroll up');
  await sleep(3000);
  out.scrollTopAfterNew = log ? log.scrollTop : null;
  out.jumpPill = !!q('.chat-jump-latest');
  q('.chat-jump-latest')?.click();
  await sleep(300);
  out.scrollTopAfterJump = log ? log.scrollTop : null;
  out.scrollHeight = log ? log.scrollHeight : null;

  // Jump to terminal: opens a pane attached to fakepi's live screen.
  q('.chat-head .c-jump')?.click();
  await sleep(2500);
  const panes = qa('.terminal-wrap').map((w) => ({
    title: w.querySelector('.t-repo')?.textContent ?? null,
    status: w.querySelector('.t-status')?.textContent ?? null,
  }));
  out.termPane = panes.length > 0;
  out.termPanes = panes;
  const attachPane = panes.find((p) => (p.title ?? '').includes('fakepi'));
  out.termTitle = attachPane?.title ?? null;
  out.termStatus = attachPane?.status ?? null;
  let attachRender = '';
  for (let i = 0; i < 6; i++) {
    await sleep(1000);
    attachRender = window.__termData ?? '';
    // The attach renders the agent pane's live screen — by now it shows
    // the filler lines we typed, not the long-scrolled-off prompt.
    if (attachRender.includes('scroll filler')) break;
  }
  out.attachShowsPane = attachRender.includes('scroll filler');
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const val = res.result?.result?.value ?? {};
console.log(JSON.stringify(val, null, 2));
const pass =
  (val.chip ?? '').includes('2 live') &&
  val.rowCount === 2 &&
  val.listHeading === true &&
  (val.rowTexts?.[0] ?? '').includes('fakepi') &&
  (val.rowTexts?.[1] ?? '').includes('fakepi2') &&
  val.selectedHead === 'fakepi2' &&
  val.jumpBtn === true &&
  val.bgSendOk === true &&
  val.bgDot === true &&
  (val.bgPreview ?? '').includes('background hello') &&
  val.backHead === 'fakepi' &&
  val.logHasBg === true &&
  val.dotCleared === true &&
  val.logScrollable === true &&
  (val.scrollTopAfterNew ?? 9999) < 10 &&
  val.jumpPill === true &&
  (val.scrollTopAfterJump ?? 0) > (val.scrollHeight ?? 0) - 1000 &&
  val.termPane === true &&
  (val.termTitle ?? '').includes('fakepi') &&
  (val.termStatus ?? '').includes('herdr agent attach w1:p1') &&
  val.attachShowsPane === true;
console.log(pass ? 'CHAT LIST TEST: PASS' : 'CHAT LIST TEST: FAIL');
process.exit(pass ? 0 : 1);
