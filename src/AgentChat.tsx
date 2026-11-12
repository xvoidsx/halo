// Agent chat — talk to one herdr agent directly, by pane_id.
//
// Sends type a message into the agent's pane with `herdr agent prompt`
// (types AND submits in one call) and replies stream back from
// `herdr agent read`, polled by the parent ChatView. Nothing is
// fabricated: your messages are the ones you typed, agent messages are
// text actually read from the pane, and any failure shows up as a system
// line in the chat itself. The send/read path was verified live against
// herdr 0.9.5 (see AGENTS.md).
//
// Scrolling is sticky-bottom, not pinned: new output only pulls you to
// the latest while you are already at the bottom. Scroll up to read and
// the log stays where you put it, with a "jump to latest" pill when new
// messages land above you.

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, HerdrAgent } from './types.js';
import { nextChatId } from './types.js';

export default function AgentChat({
  agent,
  messages,
  live,
  readError,
  onAppend,
  onJumpToTerminal,
}: {
  agent: HerdrAgent;
  messages: ChatMessage[];
  live: boolean;
  readError: string;
  onAppend: (paneId: string, msg: ChatMessage) => void;
  onJumpToTerminal: (paneId: string) => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // True while the log is at (or near) the bottom — only then does new
  // output auto-scroll. Scrolling up unpins it; the pill offers the way
  // back down.
  const pinnedRef = useRef(true);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinnedRef.current = pinned;
    if (pinned) setShowJumpLatest(false);
  };

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJumpLatest(false);
    } else {
      setShowJumpLatest(true);
    }
  }, [messages]);

  const jumpToLatest = () => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJumpLatest(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !window.halo) return;
    setSending(true);
    onAppend(agent.paneId, {
      id: nextChatId('you'),
      at: new Date().toLocaleTimeString(),
      from: 'you',
      text,
    });
    setInput('');
    // Your own message — jump to the latest to see it land.
    pinnedRef.current = true;
    setShowJumpLatest(false);
    const res = await window.halo.agentSend(agent.paneId, text);
    setSending(false);
    if (!res.ok) {
      onAppend(agent.paneId, {
        id: nextChatId('system'),
        at: new Date().toLocaleTimeString(),
        from: 'system',
        text: `Could not send that message: ${res.detail}`,
      });
    }
    inputRef.current?.focus();
  };

  return (
    <div className="chat-view">
      <div className="chat-head">
        <span className="c-agent">{agent.label}</span>
        <span className="c-pane">{agent.paneId}</span>
        <span className={`c-state ${live ? 'good' : 'warn'}`}>
          {live ? '● live' : readError ? '● not reading' : '● connecting…'}
        </span>
        <button
          className="icon-btn c-jump"
          onClick={() => onJumpToTerminal(agent.paneId)}
          title={`Open ${agent.label}'s terminal in Halo (herdr agent attach ${agent.paneId})`}
        >
          ▤ Jump to terminal
        </button>
      </div>
      <p className="note chat-caveat">
        Messages are typed into the agent&apos;s pane with <code>herdr agent prompt</code> and replies are read back
        with <code>herdr agent read</code> — verified live against herdr 0.9.5. If the agent is mid-task it may not
        answer until it reaches a prompt.
      </p>
      <div ref={logRef} className="chat-log" onScroll={onLogScroll}>
        {readError && <p className="note warn chat-error">{readError}</p>}
        {messages.length === 0 && !readError && (
          <p className="empty">
            {live
              ? 'No output yet — send the agent a message, or wait for it to work.'
              : 'Connecting to the agent’s pane…'}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.from}`}>
            <div className="chat-meta">
              <span>{m.from === 'you' ? 'you' : m.from === 'agent' ? agent.label : 'halo'}</span>
              <span>{m.at}</span>
            </div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
      </div>
      {showJumpLatest && (
        <button className="chat-jump-latest" onClick={jumpToLatest}>
          ↓ Jump to latest
        </button>
      )}
      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          placeholder={`Message ${agent.label}…`}
          disabled={sending || !window.halo}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
        <button className="primary-btn" onClick={() => void send()} disabled={sending || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
