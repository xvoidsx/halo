// Parser test for the herdr adapter — runs parseAgentList against
// envelopes captured live from herdr 0.9.5 (sandbox, 2026-11-11).
// Usage: `npm run build` first, then `node scripts/herdr-parser-test.mjs`.
import { parseAgentList } from '../dist-electron/electron/herdrAdapter.js';

const cases = [
  {
    name: 'live populated envelope (herdr 0.9.5)',
    input: '{"id":"cli:agent:list","result":{"agents":[{"agent":"pi","agent_status":"idle","cwd":"/tmp","focused":true,"foreground_cwd":"/tmp","interactive_ready":true,"name":"fakepi","pane_id":"w1:p1","revision":0,"state_change_seq":1,"tab_id":"w1:t1","terminal_id":"term_66008a152284e1","workspace_id":"w1"}],"type":"agent_list"}}',
    expect: [{ paneId: 'w1:p1', label: 'fakepi', status: 'idle' }],
  },
  {
    name: 'live empty envelope (herdr 0.9.5)',
    input: '{"id":"cli:agent:list","result":{"agents":[],"type":"agent_list"}}',
    expect: [],
  },
  {
    name: 'two agents, status mapping',
    input: JSON.stringify({
      result: {
        type: 'agent_list',
        agents: [
          { agent: 'opencode', agent_status: 'working', name: 'oc', pane_id: 'w1:p2' },
          { agent: 'pi', agent_status: 'blocked', pane_id: 'w2:p1' },
        ],
      },
    }),
    expect: [
      { paneId: 'w1:p2', label: 'oc', status: 'running' },
      { paneId: 'w2:p1', label: 'pi', status: 'error' },
    ],
  },
  {
    name: 'unrecognized JSON shape is not an empty list',
    input: '{"error":{"code":"protocol_mismatch","message":"client protocol 22 is newer than server protocol 21"}}',
    expect: null,
  },
  {
    name: 'garbage is not an empty list',
    input: 'herdr agent commands:\n  herdr agent list\n',
    expect: null,
  },
];

let failed = 0;
for (const c of cases) {
  const got = parseAgentList(c.input);
  const ok =
    c.expect === null
      ? got === null
      : Array.isArray(got) &&
        got.length === c.expect.length &&
        c.expect.every(
          (e, i) => got[i].paneId === e.paneId && got[i].label === e.label && got[i].status === e.status,
        );
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${c.name}`);
  if (!ok) {
    failed++;
    console.log('  expected:', JSON.stringify(c.expect));
    console.log('  got:     ', JSON.stringify(got));
  }
}
console.log(failed === 0 ? 'PARSER TEST: PASS' : `PARSER TEST: FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
