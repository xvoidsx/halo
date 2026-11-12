// Close-crash test — verifies closing Halo never shows the
// "Object has been destroyed" error dialog.
//
// Root cause (2026-11-12, Raven's bench): when the window closes,
// a pty can flush a final data chunk (or an exit) after the
// webContents is destroyed but before killAll() has run. The main
// process then called win.webContents.send on a destroyed
// webContents, which throws as an uncaught main-process exception
// and Electron shows its error dialog. The fix guards both sends
// with webContents.isDestroyed().
//
// The test: open the Terminal tab (a live shell pty), then close
// the app via Browser.close and confirm the main process actually
// exits. If the dialog appeared, the process would stay alive
// waiting for the user to click OK.
//
// Usage: node scripts/close-test.mjs [port]
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
      if (rest.includes('remote-debugging-port=9222') && !rest.includes('--type=')) return Number(name);
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
// A live shell pty, so there is output that could arrive late.
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Terminal'))?.click()`);
await sleep(2500);
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
  check('app exits cleanly on close (no error dialog holding it open)', gone, gone ? `pid ${pid} exited` : `pid ${pid} still alive after 10s`);
  if (!gone) {
    // Leave nothing behind for the next run.
    try {
      execSync(`kill -9 ${pid}`);
    } catch {}
  }
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
