// GitHub adapter — the boundary where Halo talks to GitHub via the
// `gh` CLI. Halo never holds a token: `gh` owns the auth, Halo only
// shells out, exactly like the Entire side. Branch status comes from
// local git, read-only — ahead/behind + dirty count, never a push or
// pull (those are a later build, once the read-only view has proven
// itself).
//
// `gh` JSON fields verified against the real CLI help (`gh pr list
// --help` / `gh issue list --help`, gh 2.102.0, 2026-11-12):
// - pr list/view: number, title, state, author, url, headRefName,
//   baseRefName, isDraft, reviewDecision, statusCheckRollup,
//   additions, deletions, changedFiles, comments, reviews, labels,
//   createdAt, body.
// - issue list/view: number, title, state, author, url, labels,
//   assignees, createdAt, comments, body.
// The mapping is defensive like the Trails one — an unrecognized
// shape yields an honest detail, never invented rows. The fixtures in
// the fake `gh` (~/workspace/.tmp/fakebin/gh) are synthesized from
// these field lists until real `gh` JSON lands from Raven's machine.

import { execFile } from 'node:child_process';
import type {
  GitHubCheckState,
  GitHubIssue,
  GitHubIssueDetail,
  GitHubIssueDetailResult,
  GitHubListResult,
  GitHubPR,
  GitHubPRDetail,
  GitHubPRDetailResult,
  RepoEntry,
  RepoStatus,
} from '../src/types.js';

const GH_TIMEOUT_MS = 15000;
const GIT_TIMEOUT_MS = 5000;

function runGh(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('gh', args, { timeout: GH_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: 'gh CLI not found' });
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

function runGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: 'git not found' });
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function loginOf(v: unknown): string {
  const rec = asRecord(v);
  return rec ? asString(rec.login) : '';
}

function namesOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const rec = asRecord(item);
    const name = rec ? asString(rec.name) || asString(rec.login) : '';
    if (name) out.push(name);
  }
  return out;
}

/** The check rollup is an array of {status, conclusion} per check run.
 * Any failure verdict fails the PR; any run still going pends it;
 * anything else that completed without a failure verdict passes. */
function mapChecks(rollup: unknown): GitHubCheckState {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const c of rollup) {
    const rec = asRecord(c);
    if (!rec) continue;
    const conclusion = asString(rec.conclusion);
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion)) return 'failing';
    if (asString(rec.status) !== 'COMPLETED') pending = true;
  }
  return pending ? 'pending' : 'passing';
}

function mapPRState(raw: unknown): GitHubPR['state'] {
  const s = asString(raw).toLowerCase();
  if (s === 'merged') return 'merged';
  if (s === 'closed') return 'closed';
  return 'open';
}

function mapPR(entry: unknown, repo: string): GitHubPR | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const number = asNumber(rec.number);
  if (!number) return null;
  return {
    id: `pr-${repo}-${number}`,
    repo,
    number,
    title: asString(rec.title) || `(untitled PR #${number})`,
    state: mapPRState(rec.state),
    author: loginOf(rec.author),
    url: asString(rec.url),
    headRef: asString(rec.headRefName),
    baseRef: asString(rec.baseRefName),
    draft: rec.isDraft === true,
    checks: mapChecks(rec.statusCheckRollup),
    reviewDecision: asString(rec.reviewDecision),
    additions: asNumber(rec.additions),
    deletions: asNumber(rec.deletions),
    labels: namesOf(rec.labels),
    createdAt: asString(rec.createdAt),
  };
}

/** `gh ... view --json` returns comments/reviews as ARRAYS of objects;
 * Halo only keeps the count. A bare number passes through untouched. */
function countOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  return asNumber(v);
}

function mapPRDetail(entry: unknown, repo: string): GitHubPRDetail | null {
  const pr = mapPR(entry, repo);
  if (!pr) return null;
  const rec = asRecord(entry);
  if (!rec) return null;
  return {
    ...pr,
    body: asString(rec.body),
    comments: countOf(rec.comments),
    changedFiles: asNumber(rec.changedFiles),
  };
}

function mapIssue(entry: unknown, repo: string): GitHubIssue | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const number = asNumber(rec.number);
  if (!number) return null;
  return {
    id: `issue-${repo}-${number}`,
    repo,
    number,
    title: asString(rec.title) || `(untitled issue #${number})`,
    state: asString(rec.state).toLowerCase() === 'closed' ? 'closed' : 'open',
    author: loginOf(rec.author),
    url: asString(rec.url),
    labels: namesOf(rec.labels),
    assignees: Array.isArray(rec.assignees) ? rec.assignees.map(loginOf).filter(Boolean) : [],
    createdAt: asString(rec.createdAt),
  };
}

function mapIssueDetail(entry: unknown, repo: string): GitHubIssueDetail | null {
  const issue = mapIssue(entry, repo);
  if (!issue) return null;
  const rec = asRecord(entry);
  if (!rec) return null;
  return { ...issue, body: asString(rec.body), comments: countOf(rec.comments) };
}

/** The origin remote of a local checkout, as owner/repo — or null
 * when the checkout is not a GitHub repo (Entire-native clones,
 * local-only repos, no remote at all). */
async function slugForPath(path: string): Promise<string | null> {
  const { code, stdout } = await runGit(['-C', path, 'remote', 'get-url', 'origin']);
  if (code !== 0) return null;
  const url = stdout.trim();
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

/** Branch status of one local checkout, from `git status
 * --porcelain=v2 --branch`: `# branch.head <name>`,
 * `# branch.ab +<ahead> -<behind>`, and one line per changed file
 * (`1`/`2`/`u` entries). Null when the path is not a readable git
 * checkout — the caller skips it silently, it is not a GitHub repo
 * Halo can show status for. */
async function statusForPath(path: string, repo: string): Promise<RepoStatus | null> {
  const { code, stdout } = await runGit(['-C', path, 'status', '--porcelain=v2', '--branch']);
  if (code !== 0) return null;
  let branch = '';
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (/^[12u] /.test(line)) dirty += 1;
  }
  return { repo, path, branch: branch || '(detached)', ahead, behind, dirty, detail: '' };
}

/** The GitHub lists: open PRs + open issues for every configured
 * repo, plus branch status for the local checkouts that map to them.
 * One repo's failure lands in the detail note instead of blanking
 * the others — same shape as listTrails. */
export async function listGitHub(repos: string[], localRepos: RepoEntry[]): Promise<GitHubListResult> {
  const list = [...new Set((repos ?? []).map((r) => r.trim()).filter(Boolean))];
  if (list.length === 0) {
    return {
      prs: [],
      issues: [],
      statuses: [],
      detail: 'No GitHub repo configured — add one in Settings → GitHub (owner/repo, one per line).',
    };
  }
  const prs: GitHubPR[] = [];
  const issues: GitHubIssue[] = [];
  const problems: string[] = [];
  for (const repo of list) {
    const prRes = await runGh([
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      'number,title,state,author,url,headRefName,baseRefName,isDraft,reviewDecision,statusCheckRollup,additions,deletions,labels,createdAt',
    ]);
    if (prRes.code === -1) {
      return { prs: [], issues: [], statuses: [], detail: 'gh CLI not found on PATH — install it and run `gh auth login`.' };
    }
    if (prRes.code !== 0) {
      const err = (prRes.stderr.trim() || prRes.stdout.trim()).slice(0, 120);
      problems.push(`${repo} PRs: ${err}`);
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(prRes.stdout);
      } catch {
        problems.push(`${repo} PRs: output that is not JSON`);
        parsed = null;
      }
      if (Array.isArray(parsed)) {
        for (const p of parsed.map((e) => mapPR(e, repo))) if (p) prs.push(p);
      } else if (parsed !== null) {
        problems.push(`${repo} PRs: unrecognized \`gh pr list --json\` shape`);
      }
    }
    const issueRes = await runGh([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      'number,title,state,author,url,labels,assignees,createdAt',
    ]);
    if (issueRes.code !== 0) {
      const err = (issueRes.stderr.trim() || issueRes.stdout.trim()).slice(0, 120);
      problems.push(`${repo} issues: ${err}`);
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(issueRes.stdout);
      } catch {
        problems.push(`${repo} issues: output that is not JSON`);
        parsed = null;
      }
      if (Array.isArray(parsed)) {
        for (const i of parsed.map((e) => mapIssue(e, repo))) if (i) issues.push(i);
      } else if (parsed !== null) {
        problems.push(`${repo} issues: unrecognized \`gh issue list --json\` shape`);
      }
    }
  }
  const statuses: RepoStatus[] = [];
  for (const entry of localRepos ?? []) {
    const slug = await slugForPath(entry.path);
    if (!slug || !list.includes(slug)) continue;
    const status = await statusForPath(entry.path, slug);
    if (status) statuses.push(status);
  }
  if (prs.length === 0 && issues.length === 0 && problems.length > 0) {
    return { prs: [], issues: [], statuses, detail: `gh list failed — ${problems.join('; ')}` };
  }
  const detail =
    problems.length > 0
      ? `Some repos failed to list — ${problems.join('; ')}`
      : prs.length === 0 && issues.length === 0
        ? 'No open PRs or issues in these repos yet.'
        : '';
  return { prs, issues, statuses, detail };
}

/** The PR detail view, from `gh pr view <number> --repo <repo>
/// --json`. */
export async function getPR(repo: string, number: number): Promise<GitHubPRDetailResult> {
  if (!repo) {
    return { pr: null, detail: 'No GitHub repo configured — add one in Settings → GitHub.' };
  }
  if (!number) return { pr: null, detail: 'No PR selected.' };
  const { code, stdout, stderr } = await runGh([
    'pr',
    'view',
    String(number),
    '--repo',
    repo,
    '--json',
    'number,title,body,state,author,url,headRefName,baseRefName,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,comments,labels',
  ]);
  if (code === -1) {
    return { pr: null, detail: 'gh CLI not found on PATH — install it and run `gh auth login`.' };
  }
  if (code !== 0) {
    const err = (stderr.trim() || stdout.trim()).slice(0, 200);
    return { pr: null, detail: `gh pr view failed: ${err}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { pr: null, detail: 'gh pr view returned output that is not JSON.' };
  }
  const pr = mapPRDetail(parsed, repo);
  if (!pr) return { pr: null, detail: 'Unrecognized `gh pr view --json` shape.' };
  return { pr, detail: '' };
}

/** The issue detail view, from `gh issue view <number> --repo
 * <repo> --json`. */
export async function getIssue(repo: string, number: number): Promise<GitHubIssueDetailResult> {
  if (!repo) {
    return { issue: null, detail: 'No GitHub repo configured — add one in Settings → GitHub.' };
  }
  if (!number) return { issue: null, detail: 'No issue selected.' };
  const { code, stdout, stderr } = await runGh([
    'issue',
    'view',
    String(number),
    '--repo',
    repo,
    '--json',
    'number,title,body,state,author,url,labels,assignees,comments',
  ]);
  if (code === -1) {
    return { issue: null, detail: 'gh CLI not found on PATH — install it and run `gh auth login`.' };
  }
  if (code !== 0) {
    const err = (stderr.trim() || stdout.trim()).slice(0, 200);
    return { issue: null, detail: `gh issue view failed: ${err}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { issue: null, detail: 'gh issue view returned output that is not JSON.' };
  }
  const issue = mapIssueDetail(parsed, repo);
  if (!issue) return { issue: null, detail: 'Unrecognized `gh issue view --json` shape.' };
  return { issue, detail: '' };
}
