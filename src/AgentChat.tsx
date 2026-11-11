// Agent chat — talk to a herdr agent directly, by pane_id.
//
// Sends type a message into the agent's pane as literal text and press
// Enter (`herdr agent send` + `agent send-keys enter`); replies stream
// back by polling `herdr agent read` every two seconds and appending only
// the new tail of the pane output. Nothing is fabricated: your messages
// are the ones you typed, agent messages are text actually read from the
// pane, and any failure shows up as a system line in the chat itself.
//
// Honest limits, stated in the UI:
// - The send/read path is documented (herdr.dev CLI reference, v0.7–0.9)
//   but NOT yet verified on a machine with herdr installed.
// - Messages are typed into the pane as literal text. If the agent is
//   mid-task it may not see them until it reaches a prompt.

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, HerdrAgent } from './types.js';

const POLL_MS = 2000;
const READ_LINES = 120;

let msgCounter = 0;
function nextId(prefix: string): string {
  msgCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${msgCounter}`;
}

export default function AgentChat({ agent }: { agent: HerdrAgent }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [readError, setReadError] = useState('');
  const [live, setLive] = useState(false);
  const lastOutputRef = useRef('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Poll the agent's pane output; append only what is new.
  useEffect(() => {
    if (!window.halo) {
      setReadError('Agent chat needs the Electron app — it is not available in a browser preview.');
      return;
    }
    let stopped = false;
    const tick = async () => {
      const res = await window.halo!.agentRead(agent.paneId, READ_LINES);
      if (stopped) return;
      if (!res.ok) {
        setReadError(res.detail);
        setLive(false);
        return;
      }
      setReadError('');
      setLive(true);
      const prev = lastOutputRef.current;
      if (res.output === prev) return;
      let tail = res.output;
      if (prev && res.output.startsWith(prev)) {
        tail = res.output.slice(prev.length);
      }
      // If the pane scrolled past our window, `read` returns a fresh
      // snapshot that no longer starts with the old one — show it whole
      // rather than trying to diff scrollback we cannot see.
      lastOutputRef.current = res.output;
      if (!tail.trim()) return;
      setMessages((m) => [
        ...m,
        { id: nextId('agent'), at: new Date().toLocaleTimeString(), from: 'agent', text: tail },
      ]);
    };
    void tick();
    const iv = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [agent.paneId]);

  // Keep the log pinned to the latest output.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !window.halo) return;
    setSending(true);
    setMessages((m) => [...m, { id: nextId('you'), at: new Date().toLocaleTimeString(), from: 'you', text }]);
    setInput('');
    const res = await window.halo.agentSend(agent.paneId, text);
    setSending(false);
    if (!res.ok) {
      setMessages((m) => [
        ...m,
        {
          id: nextId('system'),
          at: new Date().toLocaleTimeString(),
          from: 'system',
          text: `Could not send that message: ${res.detail}`,
        },
      ]);
    }
    inputRef.current?.focus();
  };

  return (
    <div className="chat-view">
      <div className="chat-head">
        <span className="c-agent">{agent.label}</span>
        <span className="c-pane">{agent.paneId}</span>
        <span className={`c-state ${live ? 'good' : 'warn'}`}>{live ? '● live' : readError ? '● not reading' : '● connecting…'}</span>
      </div>
      <p className="note chat-caveat">
        Messages are typed into the agent&apos;s pane as literal text, then Enter is sent. If the agent is mid-task it
        may not answer until it reaches a prompt. This path uses <code>herdr agent send / read</code> — documented,
        but not yet verified on a machine with herdr installed.
      </p>
      <div ref={logRef} className="chat-log">
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
