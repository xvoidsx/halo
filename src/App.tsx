import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { AgentStatus, HaloSettings, HerdrState, Trail } from './types.js';
import { defaultSettings } from './types.js';
import AgentChat from './AgentChat.js';

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
}: {
  settings: HaloSettings;
  setSettings: (next: HaloSettings) => void;
  herdr: HerdrState | null;
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
      {settings.repos.length === 0 && <p className="note">No repos yet — add the test repo below.</p>}
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
      <p className="note warn">
        Placeholder only — keys are stored in the local settings file (~/.config/halo/settings.json, 0600) and are not
        wired to any provider yet.
      </p>
      {(['openai', 'anthropic', 'openrouter'] as const).map((p) => (
        <label key={p}>
          {p} API key
          <input
            type="password"
            value={settings.byok[p].apiKey}
            placeholder="not configured"
            onChange={(e) =>
              setSettings({ ...settings, byok: { ...settings.byok, [p]: { ...settings.byok[p], apiKey: e.target.value } } })
            }
          />
        </label>
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
    void window.halo.herdrStatus().then(setHerdr);
  }, []);

  const selected = useMemo(() => trails.find((t) => t.id === selectedId) ?? trails[0], [trails, selectedId]);
  const activeRepo = useMemo(
    () => settings.repos.find((r) => r.id === settings.activeRepoId) ?? settings.repos[0] ?? null,
    [settings.repos, settings.activeRepoId],
  );
  const activeAgent = useMemo(
    () => herdr?.agents.find((a) => a.paneId === settings.activeAgentPaneId) ?? herdr?.agents[0] ?? null,
    [herdr, settings.activeAgentPaneId],
  );

  const headTitle =
    view === 'trail'
      ? (selected?.title ?? 'Trails')
      : view === 'terminal'
        ? `Terminal — ${activeRepo?.name ?? 'no repo'}`
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
        <div className="lain-chip">
          <span>✦ Lain</span>
          <span className="dot">● online</span>
        </div>
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
        <div className="sidebar-foot">
          <span className={`status-light ${herdr ? (herdr.installed ? (herdr.agents.length ? 'green' : 'amber') : 'gray') : 'gray'}`}>●</span>
          {herdr ? (herdr.installed ? `herdr · ${herdr.agents.length} agent${herdr.agents.length === 1 ? '' : 's'}` : 'herdr not detected') : 'herdr…'}
        </div>
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
        {view === 'trail' && selected ? (
          <TrailView trail={selected} />
        ) : view === 'trail' ? (
          <div className="main-body">
            <p className="empty">No trails yet.</p>
            <p className="note">
              Run your first trail with the Entire CLI (OpenCode as the test agent) in a connected repo —
              trails-test first, then haibane — and it will show up here, live. Nothing here is
              placeholder data: an empty list means no trail has run yet.
            </p>
          </div>
        ) : view === 'terminal' ? (
          activeRepo ? (
            <Suspense
              fallback={
                <div className="main-body">
                  <p className="empty">Loading terminal…</p>
                </div>
              }
            >
              <TerminalPanel key={activeRepo.id} repo={activeRepo} />
            </Suspense>
          ) : (
            <div className="main-body">
              <p className="empty">No repo selected.</p>
              <p className="note">Add a repo in Settings first — the terminal opens in that repo&apos;s directory.</p>
            </div>
          )
        ) : view === 'chat' ? (
          activeAgent ? (
            <AgentChat key={activeAgent.paneId} agent={activeAgent} />
          ) : (
            <div className="main-body">
              <p className="empty">No agent selected.</p>
              <p className="note">
                {herdr && !herdr.installed
                  ? 'herdr is not installed on this machine — start herdr and come back.'
                  : 'Pick a live agent in Settings first — chat talks to it by pane_id.'}
              </p>
            </div>
          )
        ) : (
          <SettingsView settings={settings} setSettings={setSettings} herdr={herdr} />
        )}
      </main>
    </div>
  );
}
