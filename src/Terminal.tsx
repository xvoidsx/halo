// In-app terminal — xterm.js in the renderer, node-pty shell in main.
//
// One pane, one shell: each pane spawns its own shell in its own
// directory (home when no directory is given — a terminal never needs
// a repo). `command` runs a program directly instead of the login
// shell: 'herdr' boots the herdr TUI in the pane. WebGL renderer with
// a canvas fallback (WebGL can fail on old hardware — the terminal
// must still work). No shell is ever faked: if there is no Electron
// bridge, or the directory does not exist on this machine, the panel
// says so instead of showing a dead prompt.

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

const NIGHTSHADE: Record<string, string> = {
  background: '#000000',
  foreground: '#e8e8e8',
  cursor: '#ff10f0',
  selectionBackground: 'rgba(255, 16, 240, 0.35)',
  black: '#000000',
  red: '#ff3131',
  green: '#39ff14',
  yellow: '#ffb000',
  blue: '#00ffff',
  magenta: '#ff10f0',
  cyan: '#00ffff',
  white: '#e8e8e8',
  brightBlack: '#666666',
  brightRed: '#ff3131',
  brightGreen: '#39ff14',
  brightYellow: '#ffb000',
  brightBlue: '#00ffff',
  brightMagenta: '#ff10f0',
  brightCyan: '#00ffff',
  brightWhite: '#ffffff',
};

export interface TermPane {
  id: string;
  /** Shown in the pane bar, e.g. a repo name, 'shell', or 'herdr'. */
  title: string;
  /** Directory the shell starts in. Empty = home. */
  cwd: string;
  /** Program to run instead of the login shell, e.g. 'herdr'. */
  command?: string;
}

export default function TerminalPanel({
  pane,
  onClose,
}: {
  pane: TermPane;
  onClose?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Starting terminal…');
  const [failed, setFailed] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!window.halo) {
      setFailed('Terminal needs the Electron app — it is not available in a browser preview.');
      setStatus('');
      return;
    }
    let disposed = false;
    let termId = '';
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      theme: NIGHTSHADE,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try {
          webgl?.dispose();
        } catch {
          // Already gone — canvas renderer keeps working.
        }
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch {
      // No WebGL on this machine — the default canvas renderer is used.
      webgl = null;
    }
    try {
      fit.fit();
    } catch {
      // Layout not ready yet; a resize will fit it.
    }

    const offData = window.halo.onTermData((ev) => {
      if (ev.id === termId) term.write(ev.data);
    });
    const offExit = window.halo.onTermExit((ev) => {
      if (ev.id === termId) setStatus(`Shell exited (code ${ev.code}). Close the panel and reopen it for a new shell.`);
    });
    term.onData((data) => {
      if (termId) void window.halo?.termWrite(termId, data);
    });
    term.onResize(({ cols, rows }) => {
      if (termId) void window.halo?.termResize(termId, cols, rows);
    });
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // Terminal is going away; ignore.
      }
    });
    observer.observe(host);

    void window.halo
      .termSpawn(pane.id, pane.cwd, term.cols, term.rows, pane.command)
      .then((res) => {
        if (disposed) {
          if (res.ok && res.id) void window.halo?.termKill(res.id);
          return;
        }
        if (!res.ok || !res.id) {
          setFailed(res.detail);
          setStatus('');
          return;
        }
        termId = res.id;
        setStatus(res.detail);
        term.focus();
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setFailed(`Could not start the shell: ${err instanceof Error ? err.message : String(err)}`);
          setStatus('');
        }
      });

    return () => {
      disposed = true;
      observer.disconnect();
      offData();
      offExit();
      if (termId) void window.halo?.termKill(termId);
      try {
        webgl?.dispose();
      } catch {
        // Already gone.
      }
      fit.dispose();
      term.dispose();
    };
  }, [pane.id, pane.cwd, pane.command]);

  return (
    <div className="terminal-wrap">
      <div className="terminal-bar">
        <span className="t-repo">{pane.title}</span>
        <span className="t-path">{pane.cwd || 'home'}</span>
        {status && <span className="t-status">{status}</span>}
        {onClose && (
          <button className="t-close" onClick={onClose} title="Close this pane">
            ✕
          </button>
        )}
      </div>
      {failed ? (
        <div className="terminal-failed">
          <p className="empty">Terminal is not available.</p>
          <p className="note">{failed}</p>
        </div>
      ) : (
        <div ref={hostRef} className="terminal-host" />
      )}
    </div>
  );
}
