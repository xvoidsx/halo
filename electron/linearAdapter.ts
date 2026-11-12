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

async function callTool(name: string, args: Record<string, unknown>): Promise<{ payload: unknown; problem: string; notFound: boolean }> {
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

function mapIssue(entry: unknown): LinearIssue | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const id = asString(rec.id);
  if (!id) return null;
  const priority = asRecord(rec.priority);
  return {
    id,
    uuid: asString(rec.uuid),
    title: asString(rec.title) || `(untitled issue ${id})`,
    status: asString(rec.status) || 'Todo',
    statusType: mapStatusType(rec.statusType),
    priority: priority ? asString(priority.name) : '',
    url: asString(rec.url),
    labels: namesOf(rec.labels),
    assignee: personName(rec.assignee),
    createdBy: asString(rec.createdBy),
    team: asString(rec.team),
    createdAt: asString(rec.createdAt),
    updatedAt: asString(rec.updatedAt),
  };
}

function mapComment(entry: unknown): LinearComment | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const id = asString(rec.id);
  if (!id) return null;
  return {
    id,
    author: personName(rec.author),
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

/** The Linear issues list: open + in-flight + done, newest-updated
 * first, for the configured team (empty team = the whole workspace).
 * One failed call lands in the detail note instead of inventing
 * rows — same shape as listTrails / listGitHub. */
export async function listLinear(team: string): Promise<LinearListResult> {
  const args: Record<string, unknown> = { limit: 50, orderBy: 'updatedAt' };
  const t = (team ?? '').trim();
  if (t) args.team = t;
  const { payload, problem, notFound } = await callTool('list_issues', args);
  if (notFound) return { issues: [], detail: problem };
  if (problem) return { issues: [], detail: problem };
  const rec = asRecord(payload);
  const issues = rec && Array.isArray(rec.issues) ? rec.issues.map(mapIssue).filter((i): i is LinearIssue => i !== null) : null;
  if (issues === null) return { issues: [], detail: 'Unrecognized `linear list_issues` shape.' };
  if (issues.length === 0) {
    return { issues: [], detail: t ? `No issues in team ${t} yet.` : 'No issues in this workspace yet.' };
  }
  return { issues, detail: '' };
}

/** The issue detail view: full description from `get_issue` (the
 * list truncates it) plus comments from `list_comments`. A comments
 * failure does not blank the description — it lands in the note. */
export async function getLinearIssue(id: string): Promise<LinearIssueDetailResult> {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return { issue: null, detail: 'No issue selected.' };
  const { payload, problem, notFound } = await callTool('get_issue', { id: trimmed });
  if (notFound) return { issue: null, detail: problem };
  if (problem) return { issue: null, detail: problem };
  const commentsRes = await callTool('list_comments', { issueId: trimmed });
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
