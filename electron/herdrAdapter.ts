// Herdr adapter — the boundary where Halo talks to the herdr agent runtime.
//
// Halo is a herdr CLIENT, not a replacement: it asks herdr to do the work
// and renders what comes back. The underlying harness (OpenCode, pi, wisp…)
// is herdr's business, not Halo's, so the engine can be swapped later
// without touching this interface.
//
// Verified live against herdr 0.9.5 (sandbox, 2026-11-11, real server +
// a test agent started with `agent start`):
// - `herdr agent list` prints a JSON ENVELOPE by default — no --json
//   flag needed: {"id":"cli:agent:list","result":{"agents":[…],"type":
//   "agent_list"}}. The payload lives under result.agents; a top-level
//   `agents` key does not exist, and treating its absence as "no agents"
//   is exactly how 0.2.0 silently showed zero agents with pi running.
//   Never read a shape mismatch as an empty list: unrecognized JSON
//   returns null and the raw output is shown instead.
// - Agent records carry `agent` (detected label, e.g. "pi"),
//   `agent_status` (idle|working|blocked|unknown|done), `name` (unique
//   agent name), and `pane_id` (workspace-qualified, e.g. "w1:p1").
//   Targets accept a pane_id or a unique agent name — never a bare
//   kind label ("attach opencode" -> agent_not_found, seen on Raven's
//   machine). Halo addresses by pane_id, falling back to the name.
// - `herdr agent prompt <target> "<text>"` types AND submits in one
//   call. `herdr agent send` does NOT exist (it prints the help text) —
//   the 0.1.x chat used it and would have failed on every send.
// - `herdr agent read <target> --source recent-unwrapped --lines N`
//   returns plain text, not JSON.
// - `herdr agent get <target>` returns {"result":{"agent":{…}}}.
// - A CLI newer than the server fails with protocol_mismatch; the
//   error surfaces in `detail` instead of pretending all is well.
//
// Trails come from the Entire CLI (docs.entire.com/cli-reference/trail),
// not from herdr: `entire trail list --project <project> --json` for the
// sidebar, `entire trail show <selector> --project <project> --json` for
// the detail view. --project is required even inside a clone, and the
// project is `et/<project>` for a native Entire repo or `gh/<owner>` for
// a GitHub mirror. The mapping below is docs-grounded and defensive —
// field names get tightened against a real `--json` paste (Raven's
// trails-test run, 2026-11-12).
// - watchTrail(): stream live trail events into the renderer via
//   `entire trail watch --json` — not built yet.

import { execFile } from 'node:child_process';
import type {
  AgentReadResult,
  AgentSendResult,
  Finding,
  Gate,
  HerdrAgent,
  HerdrState,
  Trail,
  TrailDetailResult,
  TrailListResult,
  TrailStatus,
} from '../src/types.js';

const TIMEOUT_MS = 5000;

function runHerdr(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('herdr', args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: 'herdr not found on PATH' });
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

/** Is the herdr CLI present, and what can it tell us?
 * `agent list` prints a JSON envelope by default, so the plain call
 * goes first; --json is only a fallback for older versions. */
export async function detectHerdr(): Promise<HerdrState> {
  const plain = await runHerdr(['agent', 'list']);
  if (plain.code === 0) return finishDetection(plain.stdout);
  if (plain.code === -1) {
    return { installed: false, detail: 'herdr is not installed (not on PATH).', agents: [] };
  }
  const json = await runHerdr(['agent', 'list', '--json']);
  if (json.code === 0) return finishDetection(json.stdout);
  return {
    installed: true,
    detail: `herdr responded with an error: ${(plain.stderr || plain.stdout).trim() || `exit ${plain.code}`}`,
    agents: [],
  };
}

function finishDetection(stdout: string): HerdrState {
  const agents = parseAgentList(stdout);
  if (agents === null) {
    // Output we cannot parse into addressable agents. Say so, show the
    // raw text, and never fabricate a pane_id — a fake target fails
    // confusingly when chat tries to use it.
    const raw = stdout.trim().slice(0, 400);
    return {
      installed: true,
      detail: raw
        ? `herdr answered in a format Halo cannot parse yet — raw output: ${raw}`
        : 'herdr answered, but listed no agents.',
      agents: [],
    };
  }
  return { installed: true, detail: 'herdr is installed.', agents };
}

/**
 * Parse `herdr agent list` output into addressable agents.
 * Returns null when the output cannot be parsed into real pane_ids
 * (caller reports the raw text honestly instead of guessing).
 * Never fabricates a pane_id: an agent without one cannot be chatted
 * with, and a fake one fails confusingly. Exported for the parser test
 * (scripts/herdr-parser-test.mjs) — it runs against the live envelope
 * captured from herdr 0.9.5.
 */
export function parseAgentList(stdout: string): HerdrAgent[] | null {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    const list = extractAgents(parsed);
    if (list === null) return null;
    return mapAgents(list);
  } catch {
    return parseTable(text);
  }
}

/** Pull the agents array out of herdr's JSON envelope. The payload
 * lives under result.agents; a top-level `agents` key does not exist.
 * Returns null when no recognizable agents container is present — a
 * shape mismatch is NOT an empty list. */
function extractAgents(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.agents)) return obj.agents as Record<string, unknown>[];
  const result = obj.result;
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.agents)) return r.agents as Record<string, unknown>[];
    if (typeof r.agent === 'object' && r.agent !== null) return [r.agent as Record<string, unknown>];
  }
  if (typeof obj.agent === 'object' && obj.agent !== null) return [obj.agent as Record<string, unknown>];
  return null;
}

function mapAgents(list: unknown[]): HerdrAgent[] {
  return (list as Record<string, unknown>[])
    .filter((a) => typeof a === 'object' && a !== null)
    .map((a) => {
      const kind = String(a.agent ?? a.kind ?? a.label ?? '');
      const name = String(a.name ?? '');
      return {
        // pane_id is the always-addressable target (w1:p1); a unique
        // agent name is the documented fallback target.
        paneId: String(a.pane_id ?? a.paneId ?? a.name ?? ''),
        label: name || kind || 'unknown',
        status: mapHerdrStatus(String(a.agent_status ?? a.status ?? a.state ?? 'unknown')),
        detail: name && kind && name !== kind ? `kind: ${kind}` : 'reported by `herdr agent list`',
      };
    })
    .filter((a) => a.paneId !== '');
}

function mapHerdrStatus(s: string): HerdrAgent['status'] {
  switch (s) {
    case 'working':
      return 'running';
    case 'idle':
      return 'idle';
    case 'blocked':
      return 'error';
    case 'done':
      return 'idle';
    default:
      return 'not-detected';
  }
}

/** Human-table safety net (`agent list` is JSON by default, so this
 * should rarely run). Pane ids are workspace-qualified: w1:p2. */
function parseTable(text: string): HerdrAgent[] | null {
  const agents: HerdrAgent[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-─═_|+]+$/.test(line.replace(/[\s|]/g, ''))) continue;
    if (/pane/i.test(line) && /agent/i.test(line)) continue;
    const pane = line.match(/w\d+:p\d+/);
    if (!pane) continue;
    const label = line
      .replace(pane[0], '')
      .replace(/[│|]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
    agents.push({
      paneId: pane[0],
      label: label || 'unknown',
      status: 'idle' as const,
      detail: 'reported by `herdr agent list`',
    });
  }
  // Empty table body (e.g. "No agents running") parses to zero agents —
  // that is a real answer, not a parse failure.
  if (agents.length === 0 && /no agents/i.test(text)) return [];
  if (agents.length === 0) return null;
  return agents;
}

export async function listHerdrAgents(): Promise<HerdrState> {
  return detectHerdr();
}

// --- Entire Trails: live trail data from the Entire CLI. ------------------
//
// Nothing is ever invented here: an unrecognized JSON shape returns an
// empty list with a detail that says so, and a trail with no evals yet
// gets scores: null, which the UI renders as "No evals yet" instead of
// fake numbers. The list carries intent (title, status); eval scores,
// findings and runs arrive only when their own CLI surfaces are wired.

export interface NotImplemented {
  status: 'not-implemented';
  todo: string;
}

/** `entire trail list` hits the Entire API over the network — give it
 * longer than the local herdr calls. */
const ENTIRE_TIMEOUT_MS = 15000;

function runEntire(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('entire', args, { timeout: ENTIRE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: 'entire not found on PATH' });
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

/** The list JSON is a bare array or an object holding one under a
 * `trails` / `items` / `data` key. Anything else is unrecognized. */
function trailArray(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  const rec = asRecord(json);
  if (!rec) return null;
  for (const key of ['trails', 'items', 'data']) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return null;
}

/** Entire lifecycle is open/closed; Halo's TrailStatus also carries
 * the eval states a trail can be in once review agents score it. */
function mapTrailStatus(raw: unknown): TrailStatus {
  const s = asString(raw).toLowerCase();
  if (s === 'closed' || s === 'merged') return 'merged';
  if (s === 'review') return 'review';
  if (s === 'green') return 'green';
  if (s === 'blocked') return 'blocked';
  return 'running'; // 'open' and anything unrecognized: the trail is live
}

function mapTrailEntry(entry: unknown, project: string): Trail | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const num = rec.number ?? rec.id;
  const id =
    asString(rec.id) ||
    asString(rec.ulid) ||
    (num !== undefined && num !== null ? `trail-${String(num)}` : '');
  if (!id) return null;
  return {
    id,
    title: asString(rec.title) || asString(rec.name) || '(untitled trail)',
    repo: asString(rec.repo ?? rec.repository),
    branch: asString(rec.branch),
    status: mapTrailStatus(rec.status),
    agent: asString(rec.agent),
    project,
    // The list carries a workflow phase ("planning", …); the detail
    // may refine it. Absent on shapes that don't carry one.
    phase: asString(rec.phase) || undefined,
    // The show object carries the trail's entire.com URL; the list
    // entries don't. Absent on shapes that don't carry one.
    url: asString(rec.url) || undefined,
    // The list carries intent, not eval scores.
    scores: null,
    findings: [],
    sessions: [],
    gates: [],
    runs: [],
  };
}

function mapFindings(v: unknown): Finding[] {
  if (!Array.isArray(v)) return [];
  const out: Finding[] = [];
  for (const item of v) {
    const r = asRecord(item);
    if (!r) continue;
    const sev = asString(r.severity).toLowerCase();
    const st = asString(r.status).toLowerCase();
    out.push({
      id: asString(r.id) || `finding-${out.length}`,
      severity: sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low' ? sev : 'info',
      status: st === 'addressing' || st === 'fixed' || st === 'dismissed' ? st : 'open',
      file: asString(r.file) || undefined,
      message: asString(r.message ?? r.title ?? r.summary),
      suggestedFix: asString(r.suggestedFix ?? r.fix ?? r.suggestion),
    });
  }
  return out;
}

function mapGates(v: unknown): Gate[] {
  if (!Array.isArray(v)) return [];
  const out: Gate[] = [];
  for (const item of v) {
    const r = asRecord(item);
    if (!r) continue;
    const st = asString(r.status).toLowerCase();
    out.push({
      name: asString(r.name) || `gate-${out.length}`,
      status: st === 'approved' || st === 'blocked' ? st : 'pending',
      by: asString(r.by ?? r.approver) || undefined,
    });
  }
  return out;
}

/** `show` returns the trail intent plus `changes[]` — one entry per
 * repository branch, each with its own URL. It may wrap the trail
 * under a `trail` key. */
function mapTrailDetail(json: unknown, fallbackId: string, project: string): Trail | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const t = asRecord(rec.trail) ?? rec;
  const base = mapTrailEntry(t, project);
  if (!base) return null;
  const changes = Array.isArray(t.changes) ? t.changes : [];
  const first = asRecord(changes[0]);
  return {
    ...base,
    id: base.id || fallbackId,
    repo: (first ? asString(first.repo ?? first.repository ?? first.name) : '') || base.repo,
    branch: (first ? asString(first.branch) : '') || base.branch,
    findings: mapFindings(t.findings),
    gates: mapGates(t.gates),
  };
}

/** The Trails sidebar, from `entire trail list --project <project>
/// --json` — once per configured project (Settings → Entire Trails),
/// native and GitHub-mirrored alike. Each trail carries the project
/// it came from, so the sidebar can group by it. One project's failure
/// never blanks the others: it lands in the detail note instead. */
export async function listTrails(projects: string[]): Promise<TrailListResult> {
  const list = (projects ?? []).map((p) => p.trim()).filter(Boolean);
  if (list.length === 0) {
    return { trails: [], detail: 'No Entire project configured — set it in Settings → Entire Trails.' };
  }
  const trails: Trail[] = [];
  const problems: string[] = [];
  for (const project of list) {
    const { code, stdout, stderr } = await runEntire(['trail', 'list', '--project', project, '--json']);
    if (code === -1) {
      return { trails: [], detail: 'entire CLI not found on PATH — install it and run `entire login`.' };
    }
    if (code !== 0) {
      const err = stderr.trim() || stdout.trim();
      problems.push(`${project}: ${err.slice(0, 120)}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      problems.push(`${project}: output that is not JSON`);
      continue;
    }
    const arr = trailArray(parsed);
    if (arr === null) {
      problems.push(`${project}: unrecognized \`entire trail list --json\` shape`);
      continue;
    }
    for (const t of arr.map((e) => mapTrailEntry(e, project))) if (t) trails.push(t);
  }
  if (trails.length === 0 && problems.length > 0) {
    return { trails: [], detail: `entire trail list failed — ${problems.join('; ')}` };
  }
  const detail =
    problems.length > 0
      ? `Some projects failed to list — ${problems.join('; ')}`
      : trails.length === 0
        ? 'No trails in these projects yet.'
        : '';
  return { trails, detail };
}

/** The detail view, from `entire trail show <id> --project <project>
/// --json`. */
export async function getTrail(id: string, project: string): Promise<TrailDetailResult> {
  if (!project) {
    return { trail: null, detail: 'No Entire project configured — set it in Settings → Entire Trails.' };
  }
  if (!id) return { trail: null, detail: 'No trail selected.' };
  const { code, stdout, stderr } = await runEntire(['trail', 'show', id, '--project', project, '--json']);
  if (code === -1) {
    return { trail: null, detail: 'entire CLI not found on PATH — install it and run `entire login`.' };
  }
  if (code !== 0) {
    const err = stderr.trim() || stdout.trim();
    return { trail: null, detail: `entire trail show failed: ${err.slice(0, 200)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { trail: null, detail: 'entire trail show returned output that is not JSON.' };
  }
  const trail = mapTrailDetail(parsed, id, project);
  if (!trail) return { trail: null, detail: 'Unrecognized `entire trail show --json` shape.' };
  return { trail, detail: '' };
}

/** TODO: stream live trail events into the renderer via
 * `entire trail watch --json` (one JSON line per event, auto-reconnect).
 * The list + detail above are the first pass; watch is the live tail. */
export async function watchTrail(_trailId: string): Promise<NotImplemented> {
  return {
    status: 'not-implemented',
    todo: 'watchTrail(): live trail event streaming is not built yet — `entire trail watch --json` is the source when it lands.',
  };
}

// --- Agent chat: prompt + read, by pane_id only. --------------------------
//
// Verified live against herdr 0.9.5 (sandbox, 2026-11-11): `agent
// prompt` types the text AND submits it in one call — the prompt landed
// in the agent's pane and `agent read` showed it back. `agent send`
// does not exist in 0.9.x. `agent attach` is deliberately NOT used for
// chat — it takes over the current terminal, which is not something a
// GUI window can do. Every failure here is surfaced to the UI as an
// error, never papered over with a fabricated reply.

/** Submit a prompt to an agent's pane (types + submits, one call). */
export async function sendAgentMessage(paneId: string, text: string): Promise<AgentSendResult> {
  if (!paneId || !paneId.trim()) {
    return { ok: false, detail: 'No agent selected — pick a live agent first.' };
  }
  if (!text.trim()) {
    return { ok: false, detail: 'Nothing to send.' };
  }
  const res = await runHerdr(['agent', 'prompt', paneId, text]);
  if (res.code === -1) {
    return { ok: false, detail: 'herdr is not installed (not on PATH).' };
  }
  if (res.code !== 0) {
    return {
      ok: false,
      detail: `herdr agent prompt failed: ${(res.stderr || res.stdout).trim() || `exit ${res.code}`}`,
    };
  }
  return { ok: true, detail: 'Sent to the agent.' };
}

/** Read an agent's recent pane output as plain text. */
export async function readAgentOutput(paneId: string, lines = 120): Promise<AgentReadResult> {
  if (!paneId || !paneId.trim()) {
    return { ok: false, paneId, output: '', detail: 'No agent selected — pick a live agent first.' };
  }
  const res = await runHerdr(['agent', 'read', paneId, '--source', 'recent-unwrapped', '--lines', String(lines)]);
  if (res.code === -1) {
    return { ok: false, paneId, output: '', detail: 'herdr is not installed (not on PATH).' };
  }
  if (res.code !== 0) {
    return {
      ok: false,
      paneId,
      output: '',
      detail: `herdr agent read failed: ${(res.stderr || res.stdout).trim() || `exit ${res.code}`}`,
    };
  }
  return { ok: true, paneId, output: res.stdout, detail: '' };
}
