// Linear adapter — the boundary where Halo talks to Linear via the
// `linear` connector CLI (Muse's MCP-backed `linear`, `/opt/hatch/bin/linear`).
// Halo never holds a Linear token: the connector owns the OAuth, Halo
// only shells out — `call-tool --name <tool> --arguments-json '<json>'` —
// exactly like the Entire and GitHub sides. Read-only: the connector's
// first grant is read-only, and Halo only ever calls read tools.
//
// Output shape (verified live, 2026-11-12): the CLI prints one JSON
// envelope — {"ok":true,"result":{"content":[{"text":"<inner JSON as a
// string>","type":"text"}],"tool_name":"<name>"}} — so the payload is
// parsed TWICE: outer JSON, then content[0].text as JSON.
// - list_issues: {"issues":[{id:"XVOIDSX-71",uuid,title,description
//   (TRUNCATED in the list — "(truncated, use `get_issue` for full
//   description)"),priority:{value,name},url,gitBranchName,createdAt,
//   updatedAt,status:"Backlog",statusType:"backlog",labels:[],createdBy,
//   team:"xvoidsx",teamId}],"hasNextPage":false}
// - get_issue: the issue object itself at top level, description FULL.
// - list_comments: {"comments":[{id,author:{id,name},body,createdAt,
//   updatedAt,parentId,quotedText,resolvedAt,attachments,onBehalfOf}],
//   "hasNextPage":false}
// The mapping is defensive like the Trails/GitHub ones — an
// unrecognized shape yields an honest detail, never invented rows.
// The fixtures in the fake `linear` (~/workspace/.tmp/fakebin/linear)
// are REAL output (list of 5 issues, get_issue 71 + 68, comments on
// 68) captured from Raven's workspace, not synthesized.

import { execFile } from 'node:child_process';
import type {
  LinearComment,
  LinearIssue,
  LinearIssueDetail,
  LinearIssueDetailResult,
  LinearListResult,
  LinearStatusType,
} from '../src/types.js';

const LINEAR_TIMEOUT_MS = 15000;

/** `linear` is the connector CLI on PATH; the absolute path is the
 * documented location from its connector doc, tried when PATH misses
 * (a packaged app's desktop-session PATH may not include it). */
const LINEAR_BIN_CANDIDATES = ['linear', '/opt/hatch/bin/linear'];

function runLinearRaw(
  bin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: LINEAR_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: `${bin} not found` });
        return;
      }
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

async function runLinear(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const first = await runLinearRaw(LINEAR_BIN_CANDIDATES[0], args);
  if (first.code !== -1) return first;
  return runLinearRaw(LINEAR_BIN_CANDIDATES[1], args);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function namesOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const rec = asRecord(item);
    const name = rec ? asString(rec.name) || asString(rec.login) : typeof item === 'string' ? item : '';
    if (name) out.push(name);
  }
  return out;
}

/** The MCP envelope: outer JSON, then content[0].text is itself a
 * JSON string. Returns the inner payload, or null with the reason
 * why it could not be read. */
function parseMcp(stdout: string): { payload: unknown; problem: string } {
  let outer: unknown;
  try {
    outer = JSON.parse(stdout);
  } catch {
    return { payload: null, problem: 'output that is not JSON' };
  }
  const outerRec = asRecord(outer);
  if (!outerRec) return { payload: null, problem: 'unrecognized `linear` output shape' };
  if (outerRec.ok === false) {
    const err = asString((outerRec as Record<string, unknown>).error) || asString(outerRec.message);
    return { payload: null, problem: err ? `linear error: ${err}` : 'linear reported an error' };
  }
  const result = asRecord(outerRec.result);
  const content = result ? result.content : null;
  const first = Array.isArray(content) ? content[0] : null;
  const text = asRecord(first) ? asString((first as Record<string, unknown>).text) : '';
  if (!text) return { payload: null, problem: 'unrecognized `linear` output shape (no content text)' };
  try {
    return { payload: JSON.parse(text), problem: '' };
  } catch {
    return { payload: null, problem: 'inner output that is not JSON' };
  }
}

export async function callLinearTool(name: string, args: Record<string, unknown>): Promise<{ payload: unknown; problem: string; notFound: boolean }> {
  const { code, stdout, stderr } = await runLinear(['call-tool', '--name', name, '--arguments-json', JSON.stringify(args)]);
  if (code === -1) return { payload: null, problem: 'linear CLI not found — the Linear connector is not on this machine.', notFound: true };
  if (code !== 0) {
    const err = (stderr.trim() || stdout.trim()).slice(0, 200);
    return { payload: null, problem: `linear ${name} failed: ${err}`, notFound: false };
  }
  const { payload, problem } = parseMcp(stdout);
  return { payload, problem, notFound: false };
}

const STATUS_TYPES: LinearStatusType[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

function mapStatusType(raw: unknown): LinearStatusType {
  const s = asString(raw).toLowerCase();
  return (STATUS_TYPES as string[]).includes(s) ? (s as LinearStatusType) : 'unstarted';
}

function personName(v: unknown): string {
  if (typeof v === 'string') return v;
  const rec = asRecord(v);
  return rec ? asString(rec.name) || asString(rec.login) : '';
}

const PRIORITY_NAMES: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };

/** Priority arrives three ways: the connector's {value, name}, the
 * GraphQL API's number + priorityLabel, or a bare string. */
function priorityName(rec: Record<string, unknown>): string {
  const label = asString(rec.priorityLabel);
  if (label) return label;
  const p = rec.priority;
  if (typeof p === 'number') return PRIORITY_NAMES[p] ?? '';
  const obj = asRecord(p);
  if (obj) return asString(obj.name);
  return asString(p);
}

function mapIssue(entry: unknown): LinearIssue | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const id = asString(rec.id);
  if (!id) return null;
  const team = asRecord(rec.team);
  return {
    id,
    uuid: asString(rec.uuid),
    title: asString(rec.title) || `(untitled issue ${id})`,
    status: asString(rec.status) || 'Todo',
    statusType: mapStatusType(rec.statusType),
    priority: priorityName(rec),
    url: asString(rec.url),
    labels: namesOf(rec.labels),
    assignee: personName(rec.assignee),
    createdBy: personName(rec.createdBy) || personName(rec.creator),
    team: team ? asString(team.key) || asString(team.name) : asString(rec.team),
    createdAt: asString(rec.createdAt),
    updatedAt: asString(rec.updatedAt),
  };
}

/** Normalize one GraphQL issue node into the connector's shape, so
 * the same mapper serves both transports. The API's `id` is the
 * UUID and `identifier` is the human key — the connector's `id`
 * IS the identifier, so they swap. */
function normalizeApiIssue(node: unknown): Record<string, unknown> | null {
  const rec = asRecord(node);
  if (!rec) return null;
  const identifier = asString(rec.identifier);
  if (!identifier) return null;
  // The API carries the workflow state as `state {name, type}`; the
  // connector carries it flat as `status` + `statusType`. Flatten
  // here so one mapper serves both transports (caught by the
  // mock-API test — the connector path had masked it).
  const state = asRecord(rec.state);
  return {
    ...rec,
    id: identifier,
    uuid: asString(rec.id),
    status: state ? asString(state.name) : asString(rec.status),
    statusType: state ? asString(state.type) : asString(rec.statusType),
  };
}

function mapComment(entry: unknown): LinearComment | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const id = asString(rec.id);
  if (!id) return null;
  return {
    id,
    // Connector comments carry `author`; API comments carry `user`.
    author: personName(rec.author) || personName(rec.user),
    body: asString(rec.body),
    createdAt: asString(rec.createdAt),
  };
}

function mapIssueDetail(entry: unknown, comments: LinearComment[]): LinearIssueDetail | null {
  const issue = mapIssue(entry);
  if (!issue) return null;
  const rec = asRecord(entry);
  if (!rec) return null;
  return { ...issue, description: asString(rec.description), comments };
}

// --- GraphQL transport (personal API key) ---
//
// Linear has a single GraphQL endpoint and no REST API. The key is a
// personal API key from linear.app/settings/api (`lin_api_...`) and is
// sent RAW as the Authorization header — no `Bearer ` prefix. GraphQL
// returns HTTP 200 even on failures, so `.errors` is always checked
// before trusting `.data`. Field names verified against the public
// Linear GraphQL docs (2026-11-12): `issues(filter, first, orderBy)`
// with `nodes`, `issue(id:)` accepting identifier or UUID, `priority`
// a number (0 none, 1 urgent, 2 high, 3 medium, 4 low) with
// `priorityLabel` beside it, comments as a `nodes` connection.

const LINEAR_API_BASE = 'https://api.linear.app/graphql';

async function linearGraphQL(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  base: string = LINEAR_API_BASE,
): Promise<{ data: unknown; problem: string }> {
  let res: Response;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { data: null, problem: `Could not reach the Linear API: ${e instanceof Error ? e.message : String(e)}` };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { data: null, problem: `Linear API returned non-JSON (HTTP ${res.status}).` };
  }
  const rec = asRecord(body);
  const errors = Array.isArray(rec?.errors) ? rec.errors : [];
  if (errors.length > 0) {
    const first = asRecord(errors[0]);
    return { data: null, problem: `Linear API: ${asString(first?.message) || 'query failed.'}` };
  }
  if (res.status === 401) return { data: null, problem: 'Linear API key rejected (401) — check the key in Settings → Linear.' };
  if (res.status !== 200) return { data: null, problem: `Linear API HTTP ${res.status}.` };
  return { data: asRecord(rec?.data) ?? null, problem: '' };
}

/** The API probe: `viewer` validates the key and returns the name. */
export async function linearApiProbe(apiKey: string, base: string = LINEAR_API_BASE): Promise<{ ok: boolean; username: string; problem: string }> {
  const { data, problem } = await linearGraphQL(apiKey, 'query { viewer { id name } }', {}, base);
  if (problem) return { ok: false, username: '', problem };
  const viewer = asRecord(asRecord(data)?.viewer);
  return { ok: true, username: asString(viewer?.name), problem: '' };
}

const LIST_ISSUES_QUERY = `query($filter: IssueFilter, $first: Int) {
  issues(filter: $filter, first: $first, orderBy: updatedAt) {
    nodes {
      id identifier title description url priority priorityLabel
      state { name type }
      assignee { name } creator { name } team { key name }
      labels { nodes { name } }
      createdAt updatedAt
    }
  }
}`;

export async function listLinearViaApi(team: string, apiKey: string, base: string = LINEAR_API_BASE): Promise<LinearListResult> {
  const t = (team ?? '').trim();
  const variables: Record<string, unknown> = { first: 50 };
  if (t) variables.filter = { team: { key: { eq: t } } };
  const { data, problem } = await linearGraphQL(apiKey, LIST_ISSUES_QUERY, variables, base);
  if (problem) return { issues: [], detail: problem };
  const nodes = asRecord(asRecord(data)?.issues)?.nodes;
  if (!Array.isArray(nodes)) return { issues: [], detail: 'Unrecognized Linear API issues shape.' };
  const issues = nodes.map(normalizeApiIssue).map(mapIssue).filter((i): i is LinearIssue => i !== null);
  if (issues.length === 0) {
    return { issues: [], detail: t ? `No issues in team ${t} yet.` : 'No issues in this workspace yet.' };
  }
  return { issues, detail: '' };
}

const GET_ISSUE_QUERY = `query($id: String!) {
  issue(id: $id) {
    id identifier title description url priority priorityLabel
    state { name type }
    assignee { name } creator { name } team { key name }
    labels { nodes { name } }
    createdAt updatedAt
    comments(first: 50) { nodes { id body user { name } createdAt } }
  }
}`;

export async function getLinearIssueViaApi(id: string, apiKey: string, base: string = LINEAR_API_BASE): Promise<LinearIssueDetailResult> {
  const { data, problem } = await linearGraphQL(apiKey, GET_ISSUE_QUERY, { id }, base);
  if (problem) return { issue: null, detail: problem };
  const node = asRecord(asRecord(data)?.issue);
  if (!node) return { issue: null, detail: 'Linear API returned no such issue.' };
  const commentsRaw = asRecord(node.comments)?.nodes;
  const comments = Array.isArray(commentsRaw)
    ? commentsRaw.map(mapComment).filter((c): c is LinearComment => c !== null)
    : [];
  const issue = mapIssueDetail(normalizeApiIssue(node), comments);
  if (!issue) return { issue: null, detail: 'Unrecognized Linear API issue shape.' };
  return { issue, detail: '' };
}

/** The Linear issues list: open + in-flight + done, newest-updated
 * first, for the configured team (empty team = the whole workspace).
 * Transport order: the connector CLI first (it carries the existing
 * login, no new secret); the personal API key second, when the
 * connector is missing or fails and a key is set. One failed call
 * lands in the detail note instead of inventing rows — same shape
 * as listTrails / listGitHub. */
export async function listLinear(team: string, apiKey = '', base: string = LINEAR_API_BASE): Promise<LinearListResult> {
  const args: Record<string, unknown> = { limit: 50, orderBy: 'updatedAt' };
  const t = (team ?? '').trim();
  if (t) args.team = t;
  const { payload, problem, notFound } = await callLinearTool('list_issues', args);
  if (!notFound && !problem) {
    const rec = asRecord(payload);
    const issues = rec && Array.isArray(rec.issues) ? rec.issues.map(mapIssue).filter((i): i is LinearIssue => i !== null) : null;
    if (issues === null) return { issues: [], detail: 'Unrecognized `linear list_issues` shape.' };
    if (issues.length === 0) {
      return { issues: [], detail: t ? `No issues in team ${t} yet.` : 'No issues in this workspace yet.' };
    }
    return { issues, detail: '' };
  }
  const key = (apiKey ?? '').trim();
  if (key) {
    const viaApi = await listLinearViaApi(team, key, base);
    if (!viaApi.detail) return viaApi;
    return { issues: [], detail: `Connector: ${problem || 'unavailable'}. API key: ${viaApi.detail}` };
  }
  return { issues: [], detail: problem || 'Linear is not connected.' };
}

/** The issue detail view: full description from `get_issue` (the
 * list truncates it) plus comments from `list_comments`. A comments
 * failure does not blank the description — it lands in the note.
 * Same transport order as the list: connector first, API key second. */
export async function getLinearIssue(id: string, apiKey = '', base: string = LINEAR_API_BASE): Promise<LinearIssueDetailResult> {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return { issue: null, detail: 'No issue selected.' };
  const { payload, problem, notFound } = await callLinearTool('get_issue', { id: trimmed });
  if (!notFound && !problem) {
    const commentsRes = await callLinearTool('list_comments', { issueId: trimmed });
    let comments: LinearComment[] = [];
    let commentProblem = '';
    if (commentsRes.problem) {
      commentProblem = commentsRes.problem;
    } else {
      const rec = asRecord(commentsRes.payload);
      comments = rec && Array.isArray(rec.comments)
        ? rec.comments.map(mapComment).filter((c): c is LinearComment => c !== null)
        : [];
    }
    const issue = mapIssueDetail(payload, comments);
    if (!issue) return { issue: null, detail: 'Unrecognized `linear get_issue` shape.' };
    return { issue, detail: commentProblem ? `Comments failed to load — ${commentProblem}` : '' };
  }
  const key = (apiKey ?? '').trim();
  if (key) return getLinearIssueViaApi(trimmed, key, base);
  return { issue: null, detail: problem || 'Linear is not connected.' };
}
