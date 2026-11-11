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
// - agent attach/read: `herdr agent attach <pane_id>` / `read <pane_id>`
//   exist; wire them once the settings panel needs to open an agent.

import { execFile } from 'node:child_process';
import type { HerdrAgent, HerdrState } from '../src/types.js';

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
