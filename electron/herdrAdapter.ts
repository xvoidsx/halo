// Herdr adapter — the boundary where Halo talks to the herdr agent runtime.
//
// Halo is a herdr CLIENT, not a replacement: it asks herdr to do the work
// and renders what comes back. The underlying harness (OpenCode, pi, wisp…)
// is herdr's business, not Halo's, so the engine can be swapped later
// without touching this interface.
//
// What is real today:
// - detectHerdr() / listAgents(): shells out to the real `herdr` CLI.
//   `herdr agent list` exists in the real runtime; it reports the detected
//   agent label and the pane_id (the always-addressable target). The exact
//   output shape is NOT documented well enough to parse strictly, so
//   listAgents() tries JSON first, then falls back to raw lines, and never
//   fabricates a status it did not observe. If herdr is not installed, the
//   result says so plainly instead of pretending.
// - Everything else is a clearly-marked stub. Do NOT invent herdr APIs or
//   fake a live connection: a stub that says "not implemented" is correct.
//
// TODO (once the first real trail exists):
// - listTrails(): source from the Entire CLI (`entire trail list` / show)
//   or from herdr once a trails surface is agreed. Currently no trail
//   data is served at all — the list is empty until then.
// - runTrail() / watchTrail(): stream trail events into the renderer.
// - Agent chat (sendAgentMessage / readAgentOutput below) is wired to the
//   real CLI surface, but NOT yet verified on a machine with herdr
//   installed: `agent send` + `agent send-keys enter` + `agent read` are
//   documented in herdr's CLI reference (herdr.dev, v0.7–0.9), and the
//   adapter surfaces CLI errors honestly instead of faking a reply. Bench
//   the chat on a real machine before trusting it. `agent attach` is
//   deliberately NOT used for chat — it takes over the current terminal,
//   which is not something a GUI window can do.
//
// Agent targeting rule, always: address by pane_id. The `agent` field in
// `herdr agent list` is a display label, not a target — attach/read do
// not resolve bare labels on Raven's machine (attach opencode ->
// agent_not_found). pane_id is the always-addressable target.

import { execFile } from 'node:child_process';
import type { AgentReadResult, AgentSendResult, HerdrAgent, HerdrState } from '../src/types.js';

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

/** Is the herdr CLI present, and what can it tell us? */
export async function detectHerdr(): Promise<HerdrState> {
  // Try machine-readable output first; fall back to the human table.
  // --json may not exist on older herdr versions — a non-zero exit
  // there just means "try the plain list", not "herdr is broken".
  const json = await runHerdr(['agent', 'list', '--json']);
  if (json.code === 0) {
    const agents = parseAgentList(json.stdout, true);
    if (agents !== null) {
      return { installed: true, detail: 'herdr is installed.', agents };
    }
  }
  const plain = await runHerdr(['agent', 'list']);
  if (plain.code === -1) {
    return { installed: false, detail: 'herdr is not installed (not on PATH).', agents: [] };
  }
  if (plain.code !== 0) {
    return {
      installed: true,
      detail: `herdr responded with an error: ${(plain.stderr || plain.stdout).trim() || `exit ${plain.code}`}`,
      agents: [],
    };
  }
  const agents = parseAgentList(plain.stdout, false);
  if (agents === null) {
    // Output we cannot parse into addressable agents. Say so, show the
    // raw text, and never fabricate a pane_id — a fake target fails
    // confusingly when chat tries to use it.
    const raw = plain.stdout.trim().slice(0, 400);
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
 * with, and a fake one fails confusingly.
 */
function parseAgentList(stdout: string, asJson: boolean): HerdrAgent[] | null {
  const text = stdout.trim();
  if (!text) return [];
  if (asJson) {
    try {
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed as { agents?: unknown[] }).agents ?? [];
      return (list as Record<string, unknown>[])
        .filter((a) => typeof a === 'object' && a !== null)
        .map((a) => ({
          paneId: String(a.pane_id ?? a.paneId ?? a.id ?? ''),
          label: String(a.agent ?? a.label ?? a.harness ?? 'unknown'),
          status: 'idle' as const,
          detail: 'reported by `herdr agent list`',
        }))
        .filter((a) => a.paneId !== '');
    } catch {
      return null;
    }
  }
  // Human table: one agent per row. herdr addresses panes by tmux-style
  // pane_id (%N); a row without one is not an addressable agent.
  // Skip headers and rule lines, keep only rows carrying a %N token.
  const agents: HerdrAgent[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-─═_|+]+$/.test(line.replace(/[\s|]/g, ''))) continue;
    if (/pane/i.test(line) && /agent/i.test(line)) continue;
    const pane = line.match(/%\d+/);
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

// --- Stubs: real trails data does not exist yet. ---------------------------

export interface NotImplemented {
  status: 'not-implemented';
  todo: string;
}

/** TODO: source from the Entire CLI once the first test trail exists. */
export async function listTrails(): Promise<NotImplemented> {
  return {
    status: 'not-implemented',
    todo: 'listTrails(): no live trail source yet — wire to `entire trail list` (or herdr) after the first trail run. Nothing is served until then.',
  };
}

/** TODO: stream live trail events into the renderer. */
export async function watchTrail(_trailId: string): Promise<NotImplemented> {
  return {
    status: 'not-implemented',
    todo: 'watchTrail(): live trail event streaming is not built yet. The trail list stays empty until the Entire CLI surface is agreed.',
  };
}

// --- Agent chat: send + read, by pane_id only. ---------------------------
//
// Documented herdr CLI surface (herdr.dev CLI reference, v0.7–0.9):
// - `herdr agent send <target> <text>` writes LITERAL text to the
//   agent's pane — no Enter. Follow it with `agent send-keys <target>
//   enter` to submit, exactly like typing a prompt and pressing Enter.
// - `herdr agent read <target> --source recent-unwrapped --lines N`
//   prints the pane's terminal text directly (UTF-8, ANSI stripped by
//   default) — plain text, not JSON.
// - `herdr agent attach <target>` takes over the current terminal. Halo
//   never uses it: a GUI window cannot take over a terminal.
// NOT yet verified on a machine with herdr installed — herdr is absent
// in this sandbox. Every failure here is surfaced to the UI as an error,
// never papered over with a fabricated reply.

/** Type a message into an agent's pane and press Enter to submit it. */
export async function sendAgentMessage(paneId: string, text: string): Promise<AgentSendResult> {
  if (!paneId || !paneId.trim()) {
    return { ok: false, detail: 'No agent selected — pick a live agent in Settings first.' };
  }
  if (!text.trim()) {
    return { ok: false, detail: 'Nothing to send.' };
  }
  const sent = await runHerdr(['agent', 'send', paneId, text]);
  if (sent.code === -1) {
    return { ok: false, detail: 'herdr is not installed (not on PATH).' };
  }
  if (sent.code !== 0) {
    return {
      ok: false,
      detail: `herdr agent send failed: ${(sent.stderr || sent.stdout).trim() || `exit ${sent.code}`}`,
    };
  }
  const enter = await runHerdr(['agent', 'send-keys', paneId, 'enter']);
  if (enter.code !== 0) {
    return {
      ok: false,
      detail: `Your text was typed into the pane, but Enter did not land: ${(enter.stderr || enter.stdout).trim() || `exit ${enter.code}`}`,
    };
  }
  return { ok: true, detail: 'Sent to the agent.' };
}

/** Read an agent's recent pane output as plain text. */
export async function readAgentOutput(paneId: string, lines = 120): Promise<AgentReadResult> {
  if (!paneId || !paneId.trim()) {
    return { ok: false, paneId, output: '', detail: 'No agent selected — pick a live agent in Settings first.' };
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
