// Trail watch test — drives the BUILT adapter (dist-electron) against
// the fake `entire` in ~/workspace/.tmp/fakebin, whose `trail watch`
// prints a ready line, then one trail event, then holds the stream
// open. Asserts an event arrives, the start result is ok, stop kills
// the stream, and no projects means ok:false.
//
// Usage: PATH=~/workspace/.tmp/fakebin:$PATH node scripts/trail-watch-test.mjs
import { startTrailWatch, stopTrailWatch, trailWatchActive } from '../dist-electron/electron/herdrAdapter.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

const events = [];
const statuses = [];
const onEvent = (ev) => events.push(ev);
const onStatus = (st) => statuses.push(st);

// --- 1. No projects means a failed start, no stream ---
const empty = startTrailWatch([], onEvent, onStatus);
check('no projects means ok:false', empty.ok === false, `got ${JSON.stringify(empty)}`);
check('no watch process runs', trailWatchActive() === false);

// --- 2. One project: an event arrives ---
const started = startTrailWatch(['et/xvoidsx'], onEvent, onStatus);
check('start returns ok:true', started.ok === true, `got ${JSON.stringify(started)}`);
check('a watch process is running', trailWatchActive() === true);
const got = await new Promise((resolve) => {
  const end = Date.now() + 8000;
  const tick = () => {
    if (events.length > 0) resolve(true);
    else if (Date.now() > end) resolve(false);
    else setTimeout(tick, 200);
  };
  tick();
});
check('a trail event arrives within 8s', got === true, `got ${events.length} events`);
if (events.length > 0) {
  check('the event belongs to the watched project', events[0].project === 'et/xvoidsx', `got ${events[0].project}`);
  let parsed = null;
  try {
    parsed = JSON.parse(events[0].event);
  } catch {
    parsed = null;
  }
  check('the event is a parseable JSON line', parsed !== null && typeof parsed === 'object', `got ${events[0].event}`);
}
await sleep(500);

// --- 3. Stop kills the stream ---
stopTrailWatch();
await sleep(500);
check('stop leaves no watch process', trailWatchActive() === false);

// --- 4. A second start after stop works (restartability) ---
const again = startTrailWatch(['et/xvoidsx'], onEvent, onStatus);
check('restart after stop returns ok:true', again.ok === true);
stopTrailWatch();
await sleep(300);
check('final stop leaves no watch process', trailWatchActive() === false);

console.log(failures === 0 ? 'TRAIL WATCH TEST: PASS' : `TRAIL WATCH TEST: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
