// Close-with-a-busy-pty test — regression cover for the close crash
// Raven still hits on the packaged build (2026-11-12 03:32 CST).
//
// The plain close-test opens an idle shell, so the pty is quiet at
// close time and the race almost never fires — it passed while the
// dialog kept appearing on Raven's machine, and its one 10 s flake
// during the 0.8.0 suite was the same bug, not timing. This test
// spawns a `yes` pty (output flooding constantly) and then closes,
// to give the race its best shot in the sandbox.
//
// Honest limit: even a flooding pty did NOT reproduce the hang here
// (passed on the buggy build too) — the sandbox process exits before
// the pty's buffered read lands, while Raven's busier machine gives
// the loop a tick longer. The proof of the fix is the direct
// experiment, not this test: on a destroyed BrowserWindow,
// `win.webContents` throws "Object has been destroyed" while
// `win.isDestroyed()` returns true safely — so the 0.6.3 guard
// (`win.webContents.isDestroyed()` first) threw at the very access
// meant to protect the send (0.7.0 dialog: main.js:61:25, the
// `.webContents` access inside the `if`, not the send). The fix
// checks `win.isDestroyed()` first, with a try/catch backstop.
//
// The test: spawn the busy pty, close via Browser.close, confirm the
// main process actually exits. If the dialog appeared, the process
// stays alive waiting for the user to click OK.
//
// Usage: node scripts/close-busy-test.mjs [port]
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
const PORT = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}
// The main process is the electron/halo binary whose cmdline has
// the debug port and NO --type= flag (zygotes and renderers have
// one). The first cmdline token must be the binary itself — a `su`
// or `xvfb-run` wrapper's cmdline also contains the port string
// (as part of its -c argument) and would match a looser check,
// which once made this test watch the wrapper instead of the app.
function mainPid() {
  for (const name of fs.readdirSync('/proc')) {
    if (!/^[0-9]+$/.test(name)) continue;
    try {
      const parts = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').filter(Boolean);
      const bin = parts[0] ?? '';
      const rest = parts.slice(1).join(' ');
      if (!/(electron|halo)$/.test(bin)) continue;
      if (rest.includes(`remote-debugging-port=${PORT}`) && !rest.includes('--type=')) return Number(name);
    } catch {}
  }
  return null;
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
// A process is gone when its /proc entry is missing OR when it is a
// zombie: after Browser.close the main process can exit but linger
// unreaped under the su/xvfb-run parent, so process.kill(pid, 0)
// keeps succeeding for a dead process. State 'Z' in /proc/<pid>/stat
// (the char after the ')' closing the comm field) means exited.
function isAlive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (stat.slice(close + 2, close + 3) === 'Z') return false;
  } catch {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
// A `yes` pty: output flooding constantly, so a flush is in flight
// when the window closes. No terminal tab needed — any pty in the
// manager exercises the same send path.
const spawned = await evalJs(`window.halo.termSpawn('busy', '/tmp', 80, 24, 'yes')`);
check('busy pty spawned', spawned && spawned.ok === true, `got ${JSON.stringify(spawned)}`);
await sleep(1500);
const pid = mainPid();
check('found the main process', pid !== null, `pid=${pid}`);
if (pid !== null) {
  // Close the whole app the way a user closing the window does.
  // Browser.close tears the CDP connection down with it, so the
  // response never arrives — send it raw and do not await a reply.
  ws.send(JSON.stringify({ id: ++msgId, method: 'Browser.close', params: {} }));
  let gone = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (!isAlive(pid)) {
      gone = true;
      break;
    }
  }
  check('app exits cleanly on close with a busy pty (no error dialog holding it open)', gone, gone ? `pid ${pid} exited` : `pid ${pid} still alive after 10s`);
  if (!gone) {
    // Leave nothing behind for the next run.
    try {
      execSync(`kill -9 ${pid}`);
    } catch {}
  }
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
