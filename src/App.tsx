import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentStatus, HaloSettings, HerdrAgent, HerdrState, Trail } from './types.js';
import type { TermPane } from './Terminal.js';
import { defaultSettings } from './types.js';
import ChatView from './ChatView.js';

// The terminal pulls in xterm.js (~450 kB) — lazy-load it so the trail
// view stays light on old hardware and the terminal chunk only loads
// when the Terminal tab opens.
const TerminalPanel = lazy(() => import('./Terminal.js'));

type View = 'trail' | 'settings' | 'terminal' | 'chat';

const STATUS_PILL: Record<string, string> = {
  running: 'cyan',
  review: 'amber',
  green: 'green',
  blocked: 'red',
  merged: 'green',
};

function scoreClass(value: number, invert = false): string {
  if (invert) return value <= 10 ? 'good' : value <= 25 ? 'warn' : 'bad';
  return value >= 85 ? 'good' : value >= 60 ? 'warn' : 'bad';
}

function lightClass(status: AgentStatus): string {
  if (status === 'running') return 'green';
  if (status === 'idle') return 'amber';
  if (status === 'error') return 'red';
  return 'gray';
}

// BYOK providers Halo likes. No harness or provider is the default —
// herdr says which agents exist, and these cards just tell you where
// a key comes from. Keys stay in the local settings file, 0600.
const BYOK_PROVIDERS = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    blurb: 'Cheap frontier chat + reasoning, OpenAI-compatible API. deepseek-chat / deepseek-reasoner.',
    url: 'https://platform.deepseek.com/api_keys',
    urlLabel: 'platform.deepseek.com → API keys',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    blurb: 'GPT models via the OpenAI API.',
    url: 'https://platform.openai.com/api-keys',
    urlLabel: 'platform.openai.com → API keys',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    blurb: 'Claude models via the Anthropic API.',
    url: 'https://console.anthropic.com/settings/keys',
    urlLabel: 'console.anthropic.com → API keys',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    blurb: 'One key, hundreds of models from many labs.',
    url: 'https://openrouter.ai/keys',
    urlLabel: 'openrouter.ai → Keys',
  },
] as const;

/** The Agents switcher: every live herdr agent, with status lights.
 * Picking one makes it the chat target. The pill is deliberately
 * generic — Halo runs where Lain is not a thing, and Lain shows up in
 * this list herself only once she is a live agent. Frosted dropdown,
 * never a separate page. */
function AgentSwitcher({
  herdr,
  activePaneId,
  onPick,
  onRefresh,
}: {
  herdr: HerdrState | null;
  activePaneId: string | null;
  onPick: (paneId: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const live = herdr?.agents.length ?? 0;
  return (
    <div className="agents-switch">
      <button className="agents-chip" onClick={() => setOpen((o) => !o)} title="Switch chat agent">
        <span>Agents</span>
        <span className="dot">{herdr ? (herdr.installed ? `● ${live} live ▾` : '● herdr? ▾') : '● … ▾'}</span>
      </button>
      {open && (
        <>
          <button className="switcher-backdrop" onClick={() => setOpen(false)} aria-label="Close agent switcher" />
          <div className="switcher-pop">
            <h4>Live agents — herdr</h4>
            {!herdr && <p className="note">Checking herdr…</p>}
            {herdr && !herdr.installed && <p className="note warn">● {herdr.detail}</p>}
            {herdr && herdr.installed && herdr.agents.length === 0 && (
              <p className="note">No agents running — start one in herdr, then refresh.</p>
            )}
            {herdr?.agents.map((a: HerdrAgent) => (
              <button
                key={a.paneId}
                className={`switcher-row ${activePaneId === a.paneId ? 'active' : ''}`}
                onClick={() => {
                  onPick(a.paneId);
                  setOpen(false);
                }}
              >
                <span className={`status-light ${lightClass(a.status)}`}>●</span>
                <span className="a-name">{a.label}</span>
                <span className="a-detail">
                  {a.paneId} · {a.status}
                </span>
              </button>
            ))}
            <button
              className="switcher-row"
              onClick={() => {
                onRefresh();
              }}
            >
              <span>↻ Refresh agents</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Trails home when nothing has run yet: a trail-like orbit, no
 * test-repo names, no favoured harness — just the invitation. */
function TrailsEmpty({ onOpenTerminal }: { onOpenTerminal: () => void }) {
  return (
    <div className="main-body trails-empty">
      <div className="trail-orbit" aria-hidden="true">
        <span className="orbit-ring" />
        <span className="orbit-dot dot-a" />
        <span className="orbit-dot dot-b" />
        <span className="orbit-core" />
      </div>
      <p className="empty-title">Waiting on trails</p>
      <p className="note">
        No trail has run yet. Open the terminal and run a trail with the Entire CLI — in any repo, with any agent
        herdr recognizes — and Halo picks it up live, right here.
      </p>
      <button className="primary-btn" onClick={onOpenTerminal}>
        Open terminal
      </button>
    </div>
  );
}

function TrailView({ trail }: { trail: Trail }) {
  const openFindings = trail.findings.filter((f) => f.status === 'open' || f.status === 'addressing');
  const resolvedCount = trail.findings.length - openFindings.length;
  return (
    <div className="main-body">
      <p className="meta">
        {trail.repo} · {trail.branch} · agent: {trail.agent}
      </p>

      <div className="scores">
        <div className="score">
          <div className="s-label">Security</div>
          <div className={`s-value ${scoreClass(trail.scores.security)}`}>{trail.scores.security}</div>
        </div>
        <div className="score">
          <div className="s-label">Slop</div>
          <div className={`s-value ${scoreClass(trail.scores.slop, true)}`}>{trail.scores.slop}</div>
        </div>
        <div className="score">
          <div className="s-label">Human review</div>
          <div className={`s-value ${scoreClass(trail.scores.humanReview)}`}>{trail.scores.humanReview}</div>
        </div>
        <div className="score">
          <div className="s-label">Confidence</div>
          <div className={`s-value ${scoreClass(trail.scores.confidence)}`}>{trail.scores.confidence}</div>
        </div>
        <div className="score">
          <div className="s-label">Risk</div>
          <div className={`s-value ${trail.scores.risk === 'low' ? 'good' : trail.scores.risk === 'medium' ? 'warn' : 'bad'}`}>
            {trail.scores.risk}
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Findings ({openFindings.length} open)</h3>
        {openFindings.length === 0 && <p className="note">No open findings.</p>}
        {resolvedCount > 0 && <p className="note">{resolvedCount} resolved.</p>}
        {openFindings.map((f) => (
          <div key={f.id} className={`finding sev-${f.severity}`}>
            <div className="f-head">
              <span className="f-sev">{f.severity}</span>
              <span className="f-msg">{f.message}</span>
              <span className="pill cyan">{f.status}</span>
            </div>
            {f.file && <div className="f-file">{f.file}</div>}
            <p className="f-fix">
              <b>Suggested fix:</b> {f.suggestedFix}
            </p>
          </div>
        ))}
      </div>

      <div className="section">
        <h3>Sessions &amp; checkpoints</h3>
        {trail.sessions.map((c) => (
          <div key={c.id} className="checkpoint">
            <span className="c-time">{c.at}</span>
            <span className="c-kind">{c.kind}</span>
            <span>
              <b>{c.agent}</b> — {c.summary}
            </span>
          </div>
        ))}
      </div>

      <div className="section">
        <h3>Gates &amp; approvals</h3>
        <div className="gates">
          {trail.gates.map((g) => (
            <div key={g.name} className={`gate ${g.status}`}>
              {g.name}
              <span className="g-status">
                {g.status}
                {g.by ? ` · ${g.by}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h3>Last five runs</h3>
        <table className="runs">
          <thead>
            <tr>
              <th>Run</th>
              <th>At</th>
              <th>Security</th>
              <th>Slop</th>
              <th>Human</th>
            </tr>
          </thead>
          <tbody>
            {trail.runs.map((r) => (
              <tr key={r.id}>
                <td className={r.status === 'green' ? 'good' : r.status === 'amber' ? 'warn' : 'bad'}>{r.status}</td>
                <td>{r.at}</td>
                <td>{r.security}</td>
                <td>{r.slop}</td>
                <td>{r.humanReview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  setSettings,
  herdr,
  onRefreshHerdr,
}: {
  settings: HaloSettings;
  setSettings: (next: HaloSettings) => void;
  herdr: HerdrState | null;
  onRefreshHerdr: () => void;
}) {
  const [saved, setSaved] = useState('');
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPath, setNewRepoPath] = useState('');

  const save = async () => {
    if (window.halo) {
      const res = await window.halo.saveSettings(settings);
      setSaved(`Saved to ${res.path}`);
    } else {
      setSaved('Saved (browser preview — no Electron bridge, not persisted)');
    }
  };

  const addRepo = () => {
    if (!newRepoName.trim() || !newRepoPath.trim()) return;
    const entry = { id: `repo-${Date.now()}`, name: newRepoName.trim(), path: newRepoPath.trim() };
    setSettings({ ...settings, repos: [...settings.repos, entry], activeRepoId: entry.id });
    setNewRepoName('');
    setNewRepoPath('');
  };

  return (
    <div className="main-body settings">
      <h3>Repos</h3>
      {settings.repos.length === 0 && <p className="note">No repos yet — add one below. Repos are optional context, not a requirement: the terminal opens at home without one.</p>}
      {settings.repos.map((r) => (
        <button
          key={r.id}
          className={`repo-row ${settings.activeRepoId === r.id ? 'active' : ''}`}
          onClick={() => setSettings({ ...settings, activeRepoId: r.id })}
        >
          <span className="r-name">{r.name}</span>
          <span className="r-path">{r.path}</span>
        </button>
      ))}
      <label>
        Repo name
        <input type="text" value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="e.g. halo-test" />
      </label>
      <label>
        Path
        <input type="text" value={newRepoPath} onChange={(e) => setNewRepoPath(e.target.value)} placeholder="/home/rav3ndust/src/halo-test" />
      </label>
      <button className="icon-btn" onClick={addRepo}>
        Add repo
      </button>

      <h3>Herdr agents</h3>
      {!herdr && <p className="note">Checking herdr…</p>}
      {herdr && !herdr.installed && <p className="note warn">● {herdr.detail}</p>}
      {herdr && herdr.installed && herdr.agents.length === 0 && <p className="note">{herdr.detail} No agents running.</p>}
      {herdr?.agents.map((a) => (
        <button
          key={a.paneId}
          className={`agent-row ${settings.activeAgentPaneId === a.paneId ? 'active' : ''}`}
          onClick={() => setSettings({ ...settings, activeAgentPaneId: a.paneId })}
        >
          <span className={`status-light ${lightClass(a.status)}`}>●</span>
          <span className="a-name">{a.label}</span>
          <span className="a-detail">
            {a.paneId} · {a.status}
            {a.detail ? ` · ${a.detail}` : ''}
          </span>
        </button>
      ))}
      <button className="icon-btn" onClick={onRefreshHerdr}>
        ↻ Refresh agents
      </button>

      <h3>Ollama — local-first</h3>
      <label>
        Base URL
        <input
          type="text"
          value={settings.ollama.baseUrl}
          onChange={(e) => setSettings({ ...settings, ollama: { ...settings.ollama, baseUrl: e.target.value } })}
        />
      </label>
      <label>
        Default model
        <input
          type="text"
          value={settings.ollama.defaultModel}
          onChange={(e) => setSettings({ ...settings, ollama: { ...settings.ollama, defaultModel: e.target.value } })}
        />
      </label>
      <p className="note">Ollama is not connected yet — the fields save locally for now.</p>

      <h3>BYOK providers</h3>
      <p className="note">
        Bring your own keys — stored in the local settings file (~/.config/halo/settings.json, 0600) and never
        leaving this machine. Providers are not connected yet; these fields save locally for now.
      </p>
      {BYOK_PROVIDERS.map((p) => (
        <div key={p.key} className="provider-card">
          <h4>{p.name}</h4>
          <p>{p.blurb}</p>
          <p>
            Get a key:{' '}
            <a href={p.url} target="_blank" rel="noreferrer">
              {p.urlLabel}
            </a>
          </p>
          <div className="provider-row">
            <input
              type="password"
              value={settings.byok[p.key].apiKey}
              placeholder="API key — not configured"
              onChange={(e) =>
                setSettings({
                  ...settings,
                  byok: { ...settings.byok, [p.key]: { ...settings.byok[p.key], apiKey: e.target.value } },
                })
              }
            />
            <label className="provider-enable">
              <input
                type="checkbox"
                checked={settings.byok[p.key].enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    byok: { ...settings.byok, [p.key]: { ...settings.byok[p.key], enabled: e.target.checked } },
                  })
                }
              />
              Enabled
            </label>
          </div>
        </div>
      ))}

      <div className="save-row">
        <button className="primary-btn" onClick={save}>
          Save settings
        </button>
        {saved && <span className="saved-msg">{saved}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('trail');
  const [trails, setTrails] = useState<Trail[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [settings, setSettings] = useState<HaloSettings>(defaultSettings);
  const [herdr, setHerdr] = useState<HerdrState | null>(null);
  // Terminal panes are first-class: one shell by default, at home —
  // no repo required. Split adds panes; 'Open herdr' boots the herdr
  // TUI in one. Panes mount on first visit and stay alive across tabs.
  const [termPanes, setTermPanes] = useState<TermPane[]>([{ id: 'pane-home', title: 'shell', cwd: '' }]);
  const [termMounted, setTermMounted] = useState(false);

  const refreshHerdr = useCallback(() => {
    if (window.halo) void window.halo.herdrStatus().then(setHerdr);
  }, []);

  useEffect(() => {
    // No trail data is faked anywhere: the list starts empty and only
    // fills when a real trail source is wired up. In a plain browser
    // (vite dev) there is no Electron bridge, so the shell previews empty.
    if (!window.halo) {
      setTrails([]);
      setHerdr({ installed: false, detail: 'No Electron bridge (browser preview).', agents: [] });
      return;
    }
    void window.halo.listTrails().then((res) => {
      setTrails(res.trails);
      if (res.trails[0]) setSelectedId(res.trails[0].id);
    });
    void window.halo.getSettings().then(setSettings);
    refreshHerdr();
    // Live detection: herdr agents come and go — re-check while Halo is
    // open, so an agent started after launch still shows up.
    const timer = window.setInterval(refreshHerdr, 10000);
    return () => window.clearInterval(timer);
  }, [refreshHerdr]);

  useEffect(() => {
    if (view === 'terminal') setTermMounted(true);
  }, [view]);

  const addTermPane = useCallback((command?: string, title?: string) => {
    setTermPanes((panes) => [
      ...panes,
      {
        id: `pane-${Date.now().toString(36)}`,
        title: title ?? command ?? 'shell',
        cwd: panes[0]?.cwd ?? '',
        command,
      },
    ]);
    setView('terminal');
  }, []);

  const closeTermPane = useCallback((id: string) => {
    setTermPanes((panes) => (panes.length > 1 ? panes.filter((p) => p.id !== id) : panes));
  }, []);

  const selected = useMemo(() => trails.find((t) => t.id === selectedId) ?? trails[0], [trails, selectedId]);
  const activeAgent = useMemo(
    () => herdr?.agents.find((a) => a.paneId === settings.activeAgentPaneId) ?? herdr?.agents[0] ?? null,
    [herdr, settings.activeAgentPaneId],
  );

  const headTitle =
    view === 'trail'
      ? (selected?.title ?? 'Trails')
      : view === 'terminal'
        ? 'Terminal'
        : view === 'chat'
          ? `Chat — ${activeAgent?.label ?? 'no agent'}`
          : 'Settings';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>HALO</h1>
          <p className="tagline">herdr, trails, one live view</p>
        </div>
        <AgentSwitcher
          herdr={herdr}
          activePaneId={settings.activeAgentPaneId}
          onPick={(paneId) => {
            setSettings((s) => ({ ...s, activeAgentPaneId: paneId }));
            setView('chat');
          }}
          onRefresh={refreshHerdr}
        />
        <div className="trail-list">
          <h2>Trails</h2>
          {trails.length === 0 && <p className="note">No trails yet.</p>}
          {trails.map((t) => (
            <button
              key={t.id}
              className={`trail-row ${selected?.id === t.id && view === 'trail' ? 'active' : ''}`}
              onClick={() => {
                setSelectedId(t.id);
                setView('trail');
              }}
            >
              <div className="t-title">
                {t.title}
                <span className={`pill ${STATUS_PILL[t.status] ?? 'cyan'}`}>{t.status}</span>
              </div>
              <div className="t-meta">
                {t.repo} · {t.agent}
              </div>
            </button>
          ))}
        </div>
        <button className="sidebar-foot" onClick={refreshHerdr} title="Refresh herdr agents">
          <span className={`status-light ${herdr ? (herdr.installed ? (herdr.agents.length ? 'green' : 'amber') : 'gray') : 'gray'}`}>●</span>
          {herdr ? (herdr.installed ? `herdr · ${herdr.agents.length} agent${herdr.agents.length === 1 ? '' : 's'}` : 'herdr not detected') : 'herdr…'}
          <span className="foot-refresh"> ↻</span>
        </button>
      </aside>

      <main className="main">
        <div className="main-head">
          <h2>{headTitle}</h2>
          <button
            className={`icon-btn ${view === 'trail' ? 'active' : ''}`}
            onClick={() => setView('trail')}
          >
            Trails
          </button>
          <button
            className={`icon-btn ${view === 'terminal' ? 'active' : ''}`}
            onClick={() => setView('terminal')}
          >
            ▤ Terminal
          </button>
          <button
            className={`icon-btn ${view === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >
            ✦ Chat
          </button>
          <button className={`icon-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            ⚙ Settings
          </button>
        </div>
        {view === 'trail' && selected && <TrailView trail={selected} />}
        {view === 'trail' && !selected && <TrailsEmpty onOpenTerminal={() => setView('terminal')} />}
        {view === 'chat' && (
          <ChatView
            herdr={herdr}
            activePaneId={settings.activeAgentPaneId}
            onPickAgent={(paneId) => setSettings((s) => ({ ...s, activeAgentPaneId: paneId }))}
            onJumpToTerminal={(paneId) => {
              const a = herdr?.agents.find((x) => x.paneId === paneId);
              addTermPane(`herdr agent attach ${paneId}`, `herdr · ${a?.label ?? paneId}`);
            }}
          />
        )}
        {view === 'settings' && <SettingsView settings={settings} setSettings={setSettings} herdr={herdr} onRefreshHerdr={refreshHerdr} />}
        {termMounted && (
          <div className={`terminal-view ${view === 'terminal' ? '' : 'hidden'}`}>
            <div className="terminal-toolbar">
              <button className="icon-btn" onClick={() => addTermPane()}>
                ＋ Split
              </button>
              <button className="icon-btn" onClick={() => addTermPane('herdr')}>
                ▤ Open herdr
              </button>
              <span className="note">Panes stay alive when you switch tabs. “Open herdr” boots the herdr TUI in a pane.</span>
            </div>
            <div className="terminal-panes">
              <Suspense
                fallback={
                  <div className="main-body">
                    <p className="empty">Loading terminal…</p>
                  </div>
                }
              >
                {termPanes.map((p) => (
                  <TerminalPanel key={p.id} pane={p} onClose={termPanes.length > 1 ? () => closeTermPane(p.id) : undefined} />
                ))}
              </Suspense>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
