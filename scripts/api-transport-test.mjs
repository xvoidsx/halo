// Mock-API transport test (node-side, no CDP, no real keys).
// Spins up a local HTTP server serving canned Linear GraphQL +
// Notion REST responses, then drives the built adapters against it
// (the `base` parameter each API function takes). This is the only
// place the API-key transports are verified end to end — the live
// proof needs a real key on Raven's machine (bench checklist).
// Run: node scripts/api-transport-test.mjs
import http from 'node:http';
import { once } from 'node:events';

const ROOT = new URL('..', import.meta.url).pathname;
const { listLinearViaApi, getLinearIssueViaApi, linearApiProbe } = await import(
  `${ROOT}dist-electron/electron/linearAdapter.js`
);
const { notionApiMe, searchNotionApi, listNotionDatabasesApi, getNotionPageApi, createNotionPageApi } = await import(
  `${ROOT}dist-electron/electron/notionAdapter.js`
);

let checks = 0;
let failures = 0;
function check(name, cond, extra = '') {
  checks += 1;
  if (cond) console.log(`  ok ${checks} ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${checks} ${name} ${extra}`);
  }
}

const LINEAR_LIST = {
  data: {
    issues: {
      nodes: [
        {
          id: 'uuid-71', identifier: 'XVOIDSX-71', title: 'Halo: vibe-powered agentic harness',
          description: 'Electron app on top, local-first.',
          state: { name: 'Backlog', type: 'backlog' }, priority: 4, priorityLabel: 'Low',
          assignee: null, creator: { name: 'rav3ndust' }, team: { key: 'XVOIDSX', name: 'xvoidsx' },
          labels: { nodes: [{ name: 'enhancement' }] },
          url: 'https://linear.app/xvoidsx/issue/XVOIDSX-71/halo',
          createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: 'uuid-68', identifier: 'XVOIDSX-68', title: 'Lab week',
          description: 'Train koe + kimeru.',
          state: { name: 'Todo', type: 'unstarted' }, priority: 3, priorityLabel: 'Medium',
          assignee: { name: 'rav3ndust' }, creator: { name: 'rav3ndust' }, team: { key: 'XVOIDSX', name: 'xvoidsx' },
          labels: { nodes: [] },
          url: 'https://linear.app/xvoidsx/issue/XVOIDSX-68/lab-week',
          createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
        },
      ],
    },
  },
};
const LINEAR_DETAIL = {
  data: {
    issue: {
      id: 'uuid-68', identifier: 'XVOIDSX-68', title: 'Lab week',
      description: 'Train koe + kimeru, push to HF when done.',
      state: { name: 'Todo', type: 'unstarted' }, priority: 3, priorityLabel: 'Medium',
      assignee: { name: 'rav3ndust' }, creator: { name: 'rav3ndust' }, team: { key: 'XVOIDSX', name: 'xvoidsx' },
      labels: { nodes: [{ name: 'lab' }] },
      url: 'https://linear.app/xvoidsx/issue/XVOIDSX-68/lab-week',
      createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
      comments: {
        nodes: [
          { id: 'c1', body: "Yes—I'd start with Colab for the first experiments.", user: { name: 'rav3ndust' }, createdAt: '2026-11-10T01:00:00.000Z' },
          { id: 'c2', body: 'Noted.', user: { name: 'Linear' }, createdAt: '2026-11-10T02:00:00.000Z' },
        ],
      },
    },
  },
};

let lastCreateBody = null;
const server = http.createServer((req, res) => {
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = req.url || '';
    if (url === '/graphql' && req.method === 'POST') {
      const parsed = JSON.parse(body || '{}');
      const q = parsed.query || '';
      if (q.includes('viewer')) return send({ data: { viewer: { id: 'u1', name: 'rav3ndust' } } });
      if (q.includes('issue(id')) return send(LINEAR_DETAIL);
      if (q.includes('issues(')) return send(LINEAR_LIST);
      return send({ errors: [{ message: 'unknown query' }] });
    }
    if (url === '/v1/users/me') {
      return send({ object: 'user', id: 'bot-1', name: 'Halo test', bot: { owner: { user: { name: 'rav3ndust' } } } });
    }
    if (url === '/v1/search' && req.method === 'POST') {
      const parsed = JSON.parse(body || '{}');
      if (parsed.filter?.value === 'database') {
        return send({ results: [{ object: 'database', id: 'db-1', title: [{ plain_text: 'Notes DB' }] }] });
      }
      return send({
        results: [
          { object: 'page', id: 'page-1', url: 'https://www.notion.so/page-1', last_edited_time: '2026-11-12T00:00:00.000Z', properties: { title: { title: [{ plain_text: 'Halo notes' }] } } },
          { object: 'page', id: 'page-2', url: 'https://www.notion.so/page-2', last_edited_time: '2026-11-11T00:00:00.000Z', properties: { title: { title: [{ plain_text: 'xvoidsx dev log' }] } } },
        ],
      });
    }
    if (url === '/v1/pages/page-1') {
      return send({ object: 'page', id: 'page-1', url: 'https://www.notion.so/page-1', properties: { title: { title: [{ plain_text: 'Halo notes' }] } } });
    }
    if (url.startsWith('/v1/blocks/page-1/children')) {
      return send({
        results: [
          { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Halo notes' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'First line' }] } },
          { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'a point' }] } },
        ],
      });
    }
    if (url === '/v1/databases/db-1') {
      return send({ object: 'database', id: 'db-1', properties: { Name: { type: 'title', title: {} }, Status: { type: 'select', select: {} } } });
    }
    if (url === '/v1/pages' && req.method === 'POST') {
      lastCreateBody = JSON.parse(body || '{}');
      return send({ id: 'page-new', url: 'https://www.notion.so/page-new' });
    }
    return send({ message: 'not found here' }, 404);
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const gql = `http://127.0.0.1:${port}/graphql`;
const notion = `http://127.0.0.1:${port}/v1`;

console.log('linear api transport:');
const probe = await linearApiProbe('lin_api_test', gql);
check('viewer probe returns the name', probe.ok && probe.username === 'rav3ndust', JSON.stringify(probe));
const list = await listLinearViaApi('xvoidsx', 'lin_api_test', gql);
check('list returns 2 issues', list.issues.length === 2, list.detail);
check('identifier is the id, uuid kept separate', list.issues[0]?.id === 'XVOIDSX-71' && list.issues[0]?.uuid === 'uuid-71');
check('priority number maps to its name', list.issues[0]?.priority === 'Low' && list.issues[1]?.priority === 'Medium');
check('state + type map through', list.issues[0]?.status === 'Backlog' && list.issues[0]?.statusType === 'backlog');
check('assignee empty when null', list.issues[0]?.assignee === '');
check('creator + team key map through', list.issues[0]?.createdBy === 'rav3ndust' && list.issues[0]?.team === 'XVOIDSX');
const detail = await getLinearIssueViaApi('XVOIDSX-68', 'lin_api_test', gql);
check('detail has the full description', detail.issue?.description === 'Train koe + kimeru, push to HF when done.', detail.detail);
check('detail has 2 comments with authors', (detail.issue?.comments.length ?? 0) === 2 && detail.issue?.comments[0]?.author === 'rav3ndust');
const badList = await listLinearViaApi('xvoidsx', 'lin_api_test', `http://127.0.0.1:${port}/nope`);
check('a bad endpoint fails honestly', badList.issues.length === 0 && badList.detail.length > 0, badList.detail);

console.log('notion api transport:');
const me = await notionApiMe('secret_test', notion);
check('users/me validates the token', me.ok && me.username === 'rav3ndust', JSON.stringify(me));
const found = await searchNotionApi('', 'secret_test', notion);
check('search returns 2 pages with titles', found.notes.length === 2 && found.notes[0]?.title === 'Halo notes', found.problem);
const dbs = await listNotionDatabasesApi('secret_test', notion);
check('database list finds the DB', dbs.databases.length === 1 && dbs.databases[0]?.id === 'db-1' && dbs.databases[0]?.title === 'Notes DB', dbs.problem);
const page = await getNotionPageApi('page-1', 'secret_test', notion);
check('page title reads', page.title === 'Halo notes', page.problem);
check('blocks become plain text lines', page.content === 'Halo notes\nFirst line\n• a point', JSON.stringify(page.content));
const created = await createNotionPageApi('db-1', 'Test note', 'hello\nworld', 'secret_test', notion);
check('create returns the new id', created.id === 'page-new' && !created.problem, created.problem);
check('create used the schema title prop (Name)', lastCreateBody?.properties?.Name?.title?.[0]?.text?.content === 'Test note', JSON.stringify(lastCreateBody?.properties));
check('create sent the body as paragraph blocks', (lastCreateBody?.children?.length ?? 0) === 2);

server.close();
console.log(failures === 0 ? `api-transport-test: ${checks} checks passed` : `api-transport-test: ${failures}/${checks} FAILED`);
process.exit(failures === 0 ? 0 : 1);
