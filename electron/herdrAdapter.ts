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
  const { code, stdout, stderr } = await runHerdr(['agent', 'list']);
  if (code === -1) {
    return { installed: false, detail: 'herdr is not installed (not on PATH).', agents: [] };
  }
  if (code !== 0) {
    return {
      installed: true,
      detail: `herdr responded with an error: ${stderr.trim() || stdout.trim() || `exit ${code}`}`,
      agents: [],
    };
  }
  return { installed: true, detail: 'herdr is installed.', agents: parseAgentList(stdout) };
}

/** Best-effort parse of `herdr agent list` output. Never fabricates agents. */
function parseAgentList(stdout: string): HerdrAgent[] {
  const text = stdout.trim();
  if (!text) return [];
  // Try JSON first (object or array form).
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
    // Not JSON — fall back to one agent per non-empty line, label only.
    // TODO: replace with the real output format once observed on a
    // machine with herdr installed. Do not guess at columns.
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => ({
        paneId: `line-${i}`,
        label: line,
        status: 'idle' as const,
        detail: 'unparsed `herdr agent list` output — format not yet verified',
      }));
  }
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
