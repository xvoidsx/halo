// Spawn-agent test — drives the dev or packaged app over CDP.
// Opens the Agents popover, checks the spawn dropdown lists only
// the kinds actually installed on this machine (pi + opencode in
// the sandbox rig; omp/hermes/codex are not), spawns a fake-pi
// agent, and asserts Halo jumps straight into Chat with the new
// agent live. The spawned agent + pane are closed at the end so the
// rig returns to its 3 agents. Expects the app open (any tab); the
// test reloads the page first for a known state.
//
//  1. The popover lists the installed spawnable kinds (pi, opencode).
//  2. The popover says which kinds are not installed (omp, hermes, codex).
//  3. Spawning pi creates a live agent named pi-1.
//  4. Halo jumps to Chat and the new agent is in the chat list.
//
// Usage: node scripts/spawn-test.mjs [port]
import { execSync } from 'node:child_process';
const PORT = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}
const HERDR_ENV = {
  ...process.env,
  PATH: `${process.env.HOME}/.local/bin:${process.env.HOME}/workspace/.tmp/fakebin:${process.env.HOME}/workspace/.npm-global/bin:/opt/hatch-image/bin:/usr/bin:/bin`,
};
const herdrAgents = () => {
  try {
    const out = execSync('herdr agent list', { env: HERDR_ENV, encoding: 'utf8', timeout: 10000 });
    return JSON.parse(out).result.agents;
  } catch {
    return [];
  }
};

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
const waitFor = async (expr, timeoutMs = 30000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await evalJs(expr);
    if (v) return v;
    await sleep(500);
  }
  return null;
};

// Open the Agents popover.
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Agents'))?.click()`);
await sleep(800);

// --- 1 + 2. The spawn dropdown lists installed kinds, names the rest ---
const spawnOpts = await waitFor(
  `(() => {
    const sel = document.querySelector('.spawn-row select');
    if (!sel || sel.disabled || sel.options.length === 0) return null;
    return [...sel.options].map((o) => o.value);
  })()`,
);
// In this sandbox opencode + pi + codex are on PATH (codex ships
// in /opt/hatch-image/bin); omp + hermes are not. The list is the
// installed set, whatever the machine has.
check(
  'spawn dropdown lists the installed kinds (opencode, pi, codex)',
  Array.isArray(spawnOpts) && spawnOpts.includes('pi') && spawnOpts.includes('opencode') && spawnOpts.includes('codex') && spawnOpts.length === 3,
  `got ${JSON.stringify(spawnOpts)}`,
);
const missingNote = await evalJs(
  `(() => { const pop = document.querySelector('.agents-switch'); return pop ? pop.innerText : ''; })()`,
);
check(
  'popover names the kinds that are not installed',
  typeof missingNote === 'string' && missingNote.includes('Not installed') && missingNote.includes('omp') && missingNote.includes('hermes'),
  `got ${JSON.stringify(missingNote?.slice(0, 300))}`,
);

// --- 3. Spawn a fake-pi agent ---
await evalJs(`(() => {
  const sel = document.querySelector('.spawn-row select');
  sel.value = 'pi';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await evalJs(`[...document.querySelectorAll('.spawn-row button')].find((b) => b.textContent.trim() === 'Spawn')?.click()`);
const spawned = await waitFor(
  `(() => { const t = document.body.innerText; return t.includes('pi-1') ? true : null; })()`,
  60000,
);
check('spawning pi jumps the UI to the new agent', spawned === true, `got ${spawned}`);
const agents = herdrAgents();
const pi1 = agents.find((a) => a.name === 'pi-1');
check(
  'a live pi-1 agent exists in herdr',
  !!pi1,
  `got ${JSON.stringify(agents.map((a) => a.name))}`,
);

// --- 4. The chat list holds the new agent ---
const inChat = await waitFor(
  `(() => { const t = document.querySelector('.chat-view')?.innerText ?? ''; return t.includes('pi-1') ? true : null; })()`,
);
check('chat list shows the spawned agent', inChat === true, `got ${inChat}`);

// --- Cleanup: close the spawned pane so the rig is 3 agents again ---
if (pi1?.pane_id) {
  try {
    execSync(`herdr pane close ${pi1.pane_id}`, { env: HERDR_ENV, encoding: 'utf8', timeout: 10000 });
  } catch {}
  await sleep(1500);
  const after = herdrAgents();
  check(
    'cleanup leaves the rig at 3 agents',
    after.length === 3 && !after.some((a) => a.name === 'pi-1'),
    `got ${JSON.stringify(after.map((a) => a.name))}`,
  );
} else {
  check('cleanup leaves the rig at 3 agents', false, 'no pi-1 pane to close');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
