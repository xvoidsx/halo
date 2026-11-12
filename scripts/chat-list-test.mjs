// Chat-list check for Halo 0.4.0 against a REAL herdr server (0.9.5)
// with TWO live agents (fakepi w1:p1, fakepi2 w1:p2).
// Launch Halo with --remote-debugging-port=9222 first, then run this.
//
// 0.4.0 shape: the chat is the agent's LIVE TERMINAL in the same
// window (the center's Enter-to-jump, as a GUI pane) — the text log
// is gone, because a TUI agent's screen is not a conversation.
// Covers, in order:
//  1. the chat list shows both live agents, blocked-first ordered
//  2. clicking a row opens that agent's attached terminal in the chat view
//  3. the attach renders the agent's live screen
//  4. output on a background agent raises an unread dot + preview
//  5. jumping back clears the dot and swaps the attach (old one is gone)
//  6. typing in an attach pane reaches the agent (termWrite -> agentRead)
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

  // Collect terminal data now, so every attach render is captured.
  window.__termData = '';
  window.halo.onTermData((ev) => { window.__termData += ev.data; });

  // Open the Chat tab.
  btnByText('✦ Chat')?.click();
  await sleep(1200);
  const rows = () => qa('.chat-row');
  const chatPanes = () => qa('.chat-terminal .terminal-wrap');
  out.rowCount = rows().length;
  out.rowTexts = rows().map((r) => r.textContent);
  out.listHeading = !!q('.chat-list h2');
  out.noTextLog = !q('.chat-log') && !q('.chat-input-row');

  // Jump into the second chat: its attached terminal opens in place.
  rows()[1]?.click();
  let pane2 = null;
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    pane2 = chatPanes()[0];
    if (pane2) break;
  }
  out.attachPane = !!pane2;
  out.attachTitle = pane2?.querySelector('.t-repo')?.textContent ?? null;
  out.attachStatus = pane2?.querySelector('.t-status')?.textContent ?? null;

  // The attach renders the agent's live screen: type into the pane
  // and watch it come back through the attach's own pty stream.
  await window.halo.agentSend('w1:p2', 'attach hello');
  let render = '';
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    render = window.__termData ?? '';
    if (render.includes('attach hello')) break;
  }
  out.attachRenders = render.includes('attach hello');

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

  // Jump back: the old attach is gone, fakepi's attach is the only one,
  // and the dot clears.
  rows().find((r) => r.textContent.includes('fakepi') && !r.textContent.includes('fakepi2'))?.click();
  await sleep(2500);
  out.backPanes = chatPanes().length;
  out.backTitle = chatPanes()[0]?.querySelector('.t-repo')?.textContent ?? null;
  out.backStatus = chatPanes()[0]?.querySelector('.t-status')?.textContent ?? null;
  out.dotCleared = !rows().find((r) => r.textContent.includes('fakepi') && !r.textContent.includes('fakepi2'))?.querySelector('.c-unread');

  // Typing in an attach pane reaches the agent: spawn a direct attach
  // to the agent we are NOT looking at (fakepi2), type, read the pane.
  const spawn = await window.halo.termSpawn('chat-attach-check', '', 80, 24, 'herdr agent attach w1:p2');
  out.directSpawn = spawn;
  if (spawn.ok && spawn.id) {
    await sleep(2000);
    await window.halo.termWrite(spawn.id, 'terminal hello\\n');
    await sleep(2500);
    const readRes = await window.halo.agentRead('w1:p2', 30);
    out.typeLands = (readRes.output || '').includes('terminal hello');
    await window.halo.termKill(spawn.id);
  }
  return out;
})()`;
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const val = res.result?.result?.value ?? {};
console.log(JSON.stringify(val, null, 2));
const pass =
  (val.chip ?? '').includes('2 live') &&
  val.rowCount === 2 &&
  val.listHeading === true &&
  val.noTextLog === true &&
  (val.rowTexts?.[0] ?? '').includes('fakepi') &&
  (val.rowTexts?.[1] ?? '').includes('fakepi2') &&
  val.attachPane === true &&
  (val.attachTitle ?? '').includes('fakepi2') &&
  (val.attachStatus ?? '').includes('herdr agent attach w1:p2') &&
  val.attachRenders === true &&
  val.bgSendOk === true &&
  val.bgDot === true &&
  (val.bgPreview ?? '').includes('background hello') &&
  val.backPanes === 1 &&
  (val.backTitle ?? '').includes('fakepi') &&
  (val.backStatus ?? '').includes('herdr agent attach w1:p1') &&
  val.dotCleared === true &&
  val.directSpawn?.ok === true &&
  val.typeLands === true;
console.log(pass ? 'CHAT LIST TEST: PASS' : 'CHAT LIST TEST: FAIL');
process.exit(pass ? 0 : 1);
