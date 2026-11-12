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
  style,
  onAttachState,
  onExitState,
  reconnectSignal,
  focused,
  onFocus,
  onContextMenu,
}: {
  pane: TermPane;
  onClose?: () => void;
  /** Sizing for split layouts — the parent sets the pane's share. */
  style?: React.CSSProperties;
  /** Tells the parent when this pane is attached to a herdr agent's
   * pane — a pane with a live attach must not be `agent read` at the
   * same time (the read kills the attach; see below). */
  onAttachState?: (paneId: string, attached: boolean) => void;
  /** Tells the parent when this pane's shell has exited, and when it
   * comes back — the parent counts dead panes for "Reconnect all". */
  onExitState?: (paneId: string, dead: boolean) => void;
  /** Bumps when the parent wants every dead pane re-spawned. A pane
   * only answers when it is actually dead — a live pane ignores it. */
  reconnectSignal?: number;
  /** The parent marks one pane focused at a time (for the split
   * shortcuts and the context menu). When this turns true the panel
   * takes keyboard focus; when its terminal gains focus it reports
   * back, so the parent always knows which pane the user is in. */
  focused?: boolean;
  onFocus?: (paneId: string) => void;
  /** Right-click on a pane — the parent shows its context menu
   * (Split right / Close pane). Only wired for Terminal-tab panes. */
  onContextMenu?: (e: React.MouseEvent, paneId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState('Starting terminal…');
  const [failed, setFailed] = useState('');
  // When the shell exits, the pane offers a way back instead of a dead
  // end: Reconnect re-spawns the same command in a fresh terminal.
  const [deadCode, setDeadCode] = useState<number | null>(null);
  const [spawnNonce, setSpawnNonce] = useState(0);
  // A quickly-dying attach gets one silent re-spawn (see onTermExit
  // below). The count is per pane, and a manual Reconnect refreshes
  // it — a retry that also dies stays dead, so this can never loop.
  const spawnedAtRef = useRef(0);
  const attachRetriesRef = useRef(0);
  useEffect(() => {
    attachRetriesRef.current = 0;
  }, [pane.id, pane.command]);

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
    // A pane running `herdr agent attach <pane>` holds that agent's
    // pane open. Tell the parent while it lives, so nothing else
    // `agent read`s that pane at the same time (2026-11-11: a read
    // during the attach's startup kills the attach, code 1, for a TUI
    // agent — opencode died on every click until the poller stopped
    // reading the selected agent; a dumb prompt never noticed).
    const attachMatch = pane.command?.match(/^herdr agent attach (\S+)\s*$/);
    const attachPaneId = attachMatch?.[1] ?? null;
    const setAttached = (attached: boolean) => {
      if (attachPaneId) onAttachState?.(attachPaneId, attached);
    };
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      theme: NIGHTSHADE,
    });
    termRef.current = term;
    // xterm.js has no onFocus event in this version — the terminal's
    // helper textarea lives inside the host, so a focusin on the host
    // (it bubbles from the textarea) is the focus signal.
    const onHostFocusIn = () => onFocus?.(pane.id);
    host.addEventListener('focusin', onHostFocusIn);
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
    // Never fit a hidden pane to zero. A tab that is mounted but
    // hidden (display:none — the chat attach stays alive across tab
    // switches) has a 0-size host; fitting it would shrink the pty to
    // a couple of columns, and a TUI agent reflows — or, at 20x5,
    // segfaults — on that. Leave the pty's size alone until the pane
    // is visible again; the observer fires then and the fit lands.
    const fitIfVisible = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // Layout not ready yet; a resize will fit it.
      }
    };
    fitIfVisible();

    const offData = window.halo.onTermData((ev) => {
      if (ev.id === termId) term.write(ev.data);
    });
    const offExit = window.halo.onTermExit((ev) => {
      if (ev.id === termId) {
        // An attach that dies in its first seconds almost always died
        // to a read that was already in flight when it started — a
        // `herdr agent read` landing on a TUI attach's startup kills
        // it, code 1. The poller never STARTS such a read (the click
        // marks the pane selected synchronously), but a read that was
        // already running when the user clicked can't be stopped. So
        // a quickly-dying attach gets one silent re-spawn: the read
        // is done by then, and the retry starts clean. Only once,
        // only for attaches, only in the first 3 seconds — a
        // genuinely broken attach still lands dead with its
        // Reconnect button.
        const isAttach = pane.command?.startsWith('herdr agent attach ') ?? false;
        const livedMs = Date.now() - spawnedAtRef.current;
        if (isAttach && ev.code === 1 && livedMs < 3000 && attachRetriesRef.current < 1) {
          attachRetriesRef.current += 1;
          setStatus('Starting terminal…');
          setSpawnNonce((n) => n + 1);
          return;
        }
        setAttached(false);
        setDeadCode(ev.code);
        onExitState?.(pane.id, true);
        setStatus(`Shell exited (code ${ev.code}).`);
      }
    });
    term.onData((data) => {
      if (termId) void window.halo?.termWrite(termId, data);
    });
    // Resize the pty only once the terminal has settled. Mounting a
    // pane makes its host grow a column at a time while the layout
    // settles (the chat attach saw 103 → 123 in ~20 steps), and a
    // TUI agent's attach client dies on that SIGWINCH storm — herdr's
    // exited code 1 after three rapid resizes, while a dumb prompt
    // ignores them. Debouncing collapses the storm into one resize to
    // the final size; the xterm itself still reflows instantly, only
    // the pty is told late. Also less IPC chatter on old hardware.
    const RESIZE_SETTLE_MS = 150;
    let resizeTimer: number | null = null;
    let pendingResize: { cols: number; rows: number } | null = null;
    term.onResize(({ cols, rows }) => {
      pendingResize = { cols, rows };
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (pendingResize && termId) void window.halo?.termResize(termId, pendingResize.cols, pendingResize.rows);
        pendingResize = null;
      }, RESIZE_SETTLE_MS);
    });
    const observer = new ResizeObserver(() => {
      fitIfVisible();
    });
    observer.observe(host);

    spawnedAtRef.current = Date.now();
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
        setAttached(true);
        setDeadCode(null);
        onExitState?.(pane.id, false);
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
      host.removeEventListener('focusin', onHostFocusIn);
      offData();
      offExit();
      setAttached(false);
      // The pane is going away (closed, or the chat target changed) —
      // it is no longer a dead pane the parent should count.
      onExitState?.(pane.id, false);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (termId) void window.halo?.termKill(termId);
      termRef.current = null;
      try {
        webgl?.dispose();
      } catch {
        // Already gone.
      }
      fit.dispose();
      term.dispose();
    };
  }, [pane.id, pane.cwd, pane.command, spawnNonce]);

  // The parent moves keyboard focus between panes (Ctrl+Shift+Arrow).
  // Focus the terminal when this pane becomes the focused one.
  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  // "Reconnect all" from the parent: re-spawn this pane, but only if
  // it is actually dead. The effect runs only when the signal changes,
  // so a pane that dies later does not auto-reconnect — the button is
  // a deliberate act, not a standing order. deadCode is read from the
  // latest render's closure when the signal changes.
  useEffect(() => {
    if (reconnectSignal !== undefined && reconnectSignal > 0 && deadCode !== null) {
      setDeadCode(null);
      setStatus('Starting terminal…');
      attachRetriesRef.current = 0;
      setSpawnNonce((n) => n + 1);
    }
    // Deliberately only on the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectSignal]);

  return (
    <div
      className="terminal-wrap"
      style={style}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, pane.id) : undefined}
    >
      <div className="terminal-bar">
        <span className="t-repo">{pane.title}</span>
        <span className="t-path">{pane.cwd || 'home'}</span>
        {status && <span className="t-status">{status}</span>}
        {deadCode !== null && (
          <button
            className="t-reconnect"
            title="The shell exited — start it again"
            onClick={() => {
              setDeadCode(null);
              setStatus('Starting terminal…');
              attachRetriesRef.current = 0;
              setSpawnNonce((n) => n + 1);
            }}
          >
            ↻ Reconnect
          </button>
        )}
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
