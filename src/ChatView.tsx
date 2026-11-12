// Chat — the agent center's jump-in list, as a GUI.
//
// The center's status tab is a live list of herdr agents and Enter jumps
// straight into one (attach, by pane_id). Halo does the same shape in
// its own way: a left-hand list of every live agent, and the selected
// agent's chat on the right. Click a row — or arrow to it and hit Enter
// — and you are in that chat.
//
// The list is ordered the way the center orders urgency: blocked agents
// first (they need you), then working, then idle. A row shows a one-line
// preview of the agent's latest output, and a pink dot when it produced
// output while you were looking elsewhere.
//
// Polling: the agent you are looking at is read every 2 s; the others
// are swept every ~10 s, just enough to keep their previews and unread
// dots honest without hammering a local socket on old hardware. Every
// agent's transcript lives here (keyed by pane_id) so jumping between
// chats never loses what you were reading — transcripts cap at 500
// messages per agent.
//
// Nothing is fabricated: agent lines are text actually read from the
// pane via `herdr agent read`, and a read failure shows up as a state
// line in that chat, never as a fake message.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentStatus, ChatMessage, HerdrAgent, HerdrState } from './types.js';
import { nextChatId } from './types.js';
import AgentChat from './AgentChat.js';

const POLL_MS = 2000;
const READ_LINES = 120;
/** Background agents are re-read every Nth tick (2 s x 5 = ~10 s). */
const BACKGROUND_EVERY = 5;
/** Transcripts cap per agent — long sessions stay light on old hardware. */
const MAX_MESSAGES = 500;
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

/** Pane output is raw terminal text — strip ANSI escapes so the chat
 * reads as text, not cursor-movement noise. The diff still runs on the
 * raw output; only the displayed copy is cleaned. */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '');
}

export default function ChatView({
  herdr,
  activePaneId,
  onPickAgent,
  onJumpToTerminal,
}: {
  herdr: HerdrState | null;
  activePaneId: string | null;
  onPickAgent: (paneId: string) => void;
  onJumpToTerminal: (paneId: string) => void;
}) {
  const agents = herdr?.agents ?? [];
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(activePaneId);
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState<Record<string, boolean>>({});
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
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

  const appendMessage = useCallback((paneId: string, msg: ChatMessage) => {
    setTranscripts((m) => {
      const list = [...(m[paneId] ?? []), msg];
      return { ...m, [paneId]: list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list };
    });
  }, []);

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

  // Poll every agent's pane output; append only what is new.
  useEffect(() => {
    if (!window.halo) return;
    let stopped = false;
    let tick = 0;
    const readOne = async (paneId: string) => {
      const res = await window.halo!.agentRead(paneId, READ_LINES);
      if (stopped) return;
      if (!res.ok) {
        setReadErrors((e) => ({ ...e, [paneId]: res.detail }));
        setLive((l) => ({ ...l, [paneId]: false }));
        return;
      }
      setReadErrors((e) => {
        if (!(paneId in e)) return e;
        const next = { ...e };
        delete next[paneId];
        return next;
      });
      setLive((l) => ({ ...l, [paneId]: true }));
      const prev = lastOutputRef.current[paneId] ?? '';
      if (res.output === prev) return;
      let tailRaw = res.output;
      if (prev && res.output.startsWith(prev)) {
        tailRaw = res.output.slice(prev.length);
      }
      // If the pane scrolled past our window, `read` returns a fresh
      // snapshot that no longer starts with the old one — show it whole
      // rather than trying to diff scrollback we cannot see.
      lastOutputRef.current[paneId] = res.output;
      const tail = stripAnsi(tailRaw);
      if (!tail.trim()) return;
      appendMessage(paneId, {
        id: nextChatId('agent'),
        at: new Date().toLocaleTimeString(),
        from: 'agent',
        text: tail,
      });
      const preview = lastLine(tail);
      if (preview) setPreviews((p) => ({ ...p, [paneId]: preview.slice(0, PREVIEW_LEN) }));
      if (paneId !== selectedRef.current) {
        setUnread((u) => ({ ...u, [paneId]: true }));
      }
    };
    const doTick = async () => {
      tick += 1;
      const sel = selectedRef.current;
      if (sel) await readOne(sel);
      if (tick % BACKGROUND_EVERY === 0) {
        for (const a of agentsRef.current) {
          if (a.paneId !== sel) await readOne(a.paneId);
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
  }, [appendMessage]);

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
        <AgentChat
          key={selected.paneId}
          agent={selected}
          messages={transcripts[selected.paneId] ?? []}
          live={live[selected.paneId] ?? false}
          readError={readErrors[selected.paneId] ?? ''}
          onAppend={appendMessage}
          onJumpToTerminal={onJumpToTerminal}
        />
      )}
    </div>
  );
}
