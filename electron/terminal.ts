// In-app terminal — node-pty shells in the main process.
//
// One terminal per repo, opened in that repo's directory (cwd = the repo
// path from settings). The shell is the user's login shell ($SHELL, or
// /bin/bash). Output streams to the renderer over `halo:term-data`; input
// and resizes come back over IPC. Lean by design: a single terminal at a
// time, no panes, no tabs — this has to feel fine on a T440p.
//
// Copland's stack, borrowed deliberately: node-pty in main + xterm.js in
// the renderer. The renderer never touches node-pty directly.

import * as fs from 'node:fs';
import * as pty from 'node-pty';
import type { TermOpResult, TermSpawnResult } from '../src/types.js';

interface TermSession {
  id: string;
  repoId: string;
  cwd: string;
  shell: string;
  pty: pty.IPty;
}

export class TerminalManager {
  private terms = new Map<string, TermSession>();
  private counter = 0;

  constructor(
    private sendData: (id: string, data: string) => void,
    private sendExit: (id: string, code: number) => void,
  ) {}

  /** Spawn a shell in `cwd`. Returns an error (never a fake shell) when
   * the directory does not exist or is not a directory on this machine. */
  spawn(repoId: string, cwd: string, cols: number, rows: number): TermSpawnResult {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return { ok: false, detail: `Repo path does not exist on this machine: ${cwd}` };
    }
    if (!stat.isDirectory()) {
      return { ok: false, detail: `Repo path is not a directory: ${cwd}` };
    }
    const shell = process.env.SHELL || '/bin/bash';
    const id = `term-${++this.counter}-${Date.now().toString(36)}`;
    let child: pty.IPty;
    try {
      child = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: Math.max(20, cols || 80),
        rows: Math.max(5, rows || 24),
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
      });
    } catch (err) {
      return { ok: false, detail: `Could not start ${shell}: ${err instanceof Error ? err.message : String(err)}` };
    }
    child.onData((data) => this.sendData(id, data));
    child.onExit(({ exitCode }) => {
      this.terms.delete(id);
      this.sendExit(id, exitCode);
    });
    this.terms.set(id, { id, repoId, cwd, shell, pty: child });
    return { ok: true, id, detail: `Shell ${shell} started in ${cwd}` };
  }

  write(id: string, data: string): TermOpResult {
    const term = this.terms.get(id);
    if (!term) return { ok: false, detail: 'That terminal is gone — open a new one.' };
    try {
      term.pty.write(data);
    } catch (err) {
      return { ok: false, detail: `Could not write to the shell: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { ok: true, detail: '' };
  }

  resize(id: string, cols: number, rows: number): TermOpResult {
    const term = this.terms.get(id);
    if (!term) return { ok: false, detail: 'That terminal is gone — open a new one.' };
    try {
      term.pty.resize(Math.max(20, cols), Math.max(5, rows));
    } catch (err) {
      return { ok: false, detail: `Could not resize the shell: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { ok: true, detail: '' };
  }

  kill(id: string): TermOpResult {
    const term = this.terms.get(id);
    if (!term) return { ok: false, detail: 'That terminal is already gone.' };
    this.terms.delete(id);
    try {
      term.pty.kill();
    } catch {
      // Already dead — the exit handler cleans up the rest.
    }
    return { ok: true, detail: '' };
  }

  /** Kill every live shell. Called on quit so no shell outlives Halo. */
  killAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id);
  }

  get liveCount(): number {
    return this.terms.size;
  }
}
