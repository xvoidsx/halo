// Chat — the agent center's jump-in list, as a GUI.
//
// The center's status tab is a live list of herdr agents and Enter jumps
// straight into one (attach, by pane_id). Halo does the same shape in
// its own way: a left-hand list of every live agent, and the selected
// agent's LIVE TERMINAL on the right — `herdr agent attach <pane>` in
// an xterm pane, in the same window. You type straight into it.
//
// The terminal is the chat surface on purpose. An earlier version
// rendered the agent as a text log (`herdr agent read` into chat
// bubbles), and it looked broken: a TUI agent's output IS its whole
// screen — the opencode logo is block characters the chat font renders
// as solid rectangles, plus the prompt line, status bar and version.
// A screen dump is not a conversation, and no amount of ANSI stripping
// makes it one. The terminal renders it properly because xterm is a
// terminal. There is no separate send box either — it would only
// duplicate the agent's own input line.
//
// The list is ordered the way the center orders urgency: blocked agents
// first (they need you), then working, then idle. A row shows a one-line
// preview of the agent's latest output, and a pink dot when it produced
// output while you were looking elsewhere. Those two come from a
// background poll of `herdr agent read` — the non-selected agents every
// ~10 s, just enough to keep previews and dots honest without hammering
// a local socket on old hardware. The selected agent is NEVER read: its
// live terminal IS the attach, and a read against an attached pane kills
// the attach (2026-11-11 — opencode died on every click until the poll
// stopped reading the selected agent). The same rule covers any pane
// another terminal holds an attach to (see skipReadPaneIds).
//
// The attach stays alive across tab switches: App keeps this view
// mounted once visited and hides it instead of unmounting it, so the
// terminal — and its scrollback — is still there when you come back.
// The poller keeps running while hidden, so previews and dots stay
// fresh on other tabs too.
//
// Nothing is fabricated: the terminal shows the agent's real pane, and
// previews are the pane's real last line. If a read fails, the row
// simply keeps its herdr status and no dot is raised.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentStatus, HerdrAgent, HerdrState } from './types.js';

// The terminal pulls in xterm.js (~450 kB) — lazy-load it, the same as
// the Terminal tab does, so the trail view stays light.
const TerminalPanel = lazy(() => import('./Terminal.js'));

const POLL_MS = 2000;
const READ_LINES = 120;
/** Background agents are re-read every Nth tick (2 s x 5 = ~10 s). */
const BACKGROUND_EVERY = 5;
const PREVIEW_LEN = 80;

/** Status priority, mirroring the agent center: blocked first, then
 * working, then idle. 'error' is the adapter's word for herdr's blocked. */
function statusRank(s: AgentStatus): number {
  if (s === 'error') return 0;
  if (s === 'running') return 1;
  if (s === 'idle') return 2;
  return 3;
}

function lightClass(status: AgentStatus): string {
  if (status === 'running') return 'green';
  if (status === 'idle') return 'amber';
  if (status === 'error') return 'red';
  return 'gray';
}

function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/** Pane output is raw terminal text — strip ANSI escapes so the preview
 * reads as text, not cursor-movement noise. The diff still runs on the
 * raw output; only the displayed copy is cleaned. The CSI pattern
 * covers intermediate bytes (space–/) so sequences like
 * `ESC[?1016;2$y` come off whole instead of leaving `$y` behind. */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '');
}

export default function ChatView({
  herdr,
  activePaneId,
  onPickAgent,
  skipReadPaneIds,
  onAttachState,
  onExitState,
  reconnectSignal,
}: {
  herdr: HerdrState | null;
  activePaneId: string | null;
  onPickAgent: (paneId: string) => void;
  /** Pane ids currently holding a live `herdr agent attach` in some
   * other terminal — the poller must not `agent read` those. */
  skipReadPaneIds: string[];
  onAttachState: (paneId: string, attached: boolean) => void;
  /** Reports when the chat attach's shell exits (and comes back) —
   * the parent counts it for "Reconnect all". */
  onExitState: (paneId: string, dead: boolean) => void;
  /** Bumps when the parent wants every dead pane re-spawned. */
  reconnectSignal: number;
}) {
  const agents = herdr?.agents ?? [];
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(activePaneId);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const lastOutputRef = useRef<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);

  // The poller runs on one interval and reads through refs, so it never
  // goes stale when the agent list refreshes or the selection moves.
  const agentsRef = useRef(agents);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);
  const selectedRef = useRef(selectedPaneId);
  useEffect(() => {
    selectedRef.current = selectedPaneId;
  }, [selectedPaneId]);
  const skipReadRef = useRef(skipReadPaneIds);
  useEffect(() => {
    skipReadRef.current = skipReadPaneIds;
  }, [skipReadPaneIds]);

  // Follow the switcher / Settings pick; fall back to the first live
  // agent when the selected one goes away or nothing is selected yet.
  useEffect(() => {
    if (activePaneId && agents.some((a) => a.paneId === activePaneId)) {
      setSelectedPaneId(activePaneId);
      return;
    }
    if (!selectedPaneId || !agents.some((a) => a.paneId === selectedPaneId)) {
      setSelectedPaneId(agents[0]?.paneId ?? null);
    }
  }, [activePaneId, agents, selectedPaneId]);

  // Poll every agent's pane output; only the newest tail matters —
  // enough to raise an unread dot and refresh the row preview.
  useEffect(() => {
    if (!window.halo) return;
    let stopped = false;
    let tick = 0;
    const readOne = async (paneId: string) => {
      const res = await window.halo!.agentRead(paneId, READ_LINES);
      if (stopped || !res.ok) return;
      const prev = lastOutputRef.current[paneId] ?? '';
      if (res.output === prev) return;
      let tailRaw = res.output;
      if (prev && res.output.startsWith(prev)) {
        tailRaw = res.output.slice(prev.length);
      }
      // If the pane scrolled past our window, `read` returns a fresh
      // snapshot that no longer starts with the old one — take it whole
      // rather than trying to diff scrollback we cannot see.
      lastOutputRef.current[paneId] = res.output;
      const tail = stripAnsi(tailRaw);
      if (!tail.trim()) return;
      const preview = lastLine(tail);
      if (preview) setPreviews((p) => ({ ...p, [paneId]: preview.slice(0, PREVIEW_LEN) }));
      if (paneId !== selectedRef.current) {
        setUnread((u) => ({ ...u, [paneId]: true }));
      }
    };
    const doTick = async () => {
      tick += 1;
      // Never read the selected agent: its live terminal is the attach,
      // and a read against an attached pane kills the attach. Never read
      // a pane another terminal holds an attach to, either. Only the
      // background sweep reads, and only panes with no live attach.
      if (tick % BACKGROUND_EVERY === 0) {
        for (const a of agentsRef.current) {
          if (a.paneId !== selectedRef.current && !skipReadRef.current.includes(a.paneId)) await readOne(a.paneId);
        }
      }
    };
    void doTick();
    const iv = window.setInterval(() => {
      void doTick();
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, []);

  const sorted = useMemo(
    () => [...agents].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.label.localeCompare(b.label)),
    [agents],
  );
  const selected = agents.find((a) => a.paneId === selectedPaneId) ?? null;

  const select = (paneId: string) => {
    setSelectedPaneId(paneId);
    setUnread((u) => ({ ...u, [paneId]: false }));
    onPickAgent(paneId);
  };

  // Arrow keys move between rows; Enter/Space on a focused row clicks
  // it, the same as the center's Enter-to-jump.
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.chat-row') ?? [])];
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r === document.activeElement);
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
    rows[next]?.focus();
  };

  if (!herdr || !herdr.installed || agents.length === 0) {
    return (
      <div className="chat-wrap">
        <div className="main-body">
          <p className="empty">No agent selected.</p>
          <p className="note">
            {herdr && !herdr.installed
              ? 'herdr is not installed on this machine — start herdr and come back.'
              : 'Pick a live agent from the Agents switcher — chat talks to it by pane_id.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
      <div className="chat-list" ref={listRef} onKeyDown={onListKeyDown} role="listbox" aria-label="Agent chats">
        <h2>Chats</h2>
        {sorted.map((a: HerdrAgent) => (
          <button
            key={a.paneId}
            className={`chat-row ${a.paneId === selectedPaneId ? 'active' : ''}`}
            onClick={() => select(a.paneId)}
            role="option"
            aria-selected={a.paneId === selectedPaneId}
          >
            <span className="c-top">
              <span className={`status-light ${lightClass(a.status)}`}>●</span>
              <span className="c-name">{a.label}</span>
              {unread[a.paneId] && <span className="c-unread" title="New output while you were away" />}
            </span>
            {previews[a.paneId] && <span className="c-preview">{previews[a.paneId]}</span>}
            <span className="c-detail">
              {a.paneId} · {a.status}
              {a.detail ? ` · ${a.detail}` : ''}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="chat-terminal">
          <Suspense
            fallback={
              <div className="main-body">
                <p className="empty">Opening {selected.label}’s terminal…</p>
              </div>
            }
          >
            <TerminalPanel
              key={selected.paneId}
              pane={{
                id: `chat-attach-${selected.paneId}`,
                title: `herdr · ${selected.label}`,
                cwd: '',
                command: `herdr agent attach ${selected.paneId}`,
              }}
              onAttachState={onAttachState}
              onExitState={onExitState}
              reconnectSignal={reconnectSignal}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
