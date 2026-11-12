import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentStatus,
  ConnectionStatus,
  GitHubIssue,
  GitHubIssueDetail,
  GitHubPR,
  GitHubPRDetail,
  HaloSettings,
  HerdrAgent,
  HerdrState,
  InstallResult,
  LinearIssue,
  LinearIssueDetail,
  NoteDetail,
  NoteItem,
  NotionDatabase,
  RepoStatus,
  ToolId,
  Trail,
} from './types.js';
import type { TermPane } from './Terminal.js';
import { defaultSettings } from './types.js';
import ChatView from './ChatView.js';
import { EntireMark, GitHubMark, LinearMark } from './ForgeLogos.js';

// The terminal pulls in xterm.js (~450 kB) — lazy-load it so the trail
// view stays light on old hardware and the terminal chunk only loads
// when the Terminal tab opens.
const TerminalPanel = lazy(() => import('./Terminal.js'));

type View = 'trail' | 'settings' | 'terminal' | 'chat' | 'notes';

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
  {
    key: 'groq',
    name: 'Groq',
    blurb: 'Very fast inference with a free tier. Llama, Qwen, and more, at ludicrous speed.',
    url: 'https://console.groq.com/keys',
    urlLabel: 'console.groq.com → API Keys',
  },
  {
    key: 'mistral',
    name: 'Mistral',
    blurb: 'Mistral models via the Mistral API. Open-weights friendly, European-hosted.',
    url: 'https://console.mistral.ai/api-keys',
    urlLabel: 'console.mistral.ai → API keys',
  },
  {
    key: 'huggingface',
    name: 'Hugging Face',
    blurb: 'Inference Endpoints + serverless inference for the models on the Hub — xvoidsx’s research home.',
    url: 'https://huggingface.co/settings/tokens',
    urlLabel: 'huggingface.co → Settings → Access Tokens',
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    blurb: 'Gemini models via Google AI Studio. Free tier for trying things out.',
    url: 'https://aistudio.google.com/apikey',
    urlLabel: 'aistudio.google.com → Get API key',
  },
  {
    key: 'xai',
    name: 'xAI',
    blurb: 'Grok models via the xAI API.',
    url: 'https://console.x.ai/',
    urlLabel: 'console.x.ai → API keys',
  },
  {
    key: 'venice',
    name: 'Venice',
    blurb: 'Private, uncensored inference — Venice does not log prompts or train on your data. OpenAI-compatible API.',
    url: 'https://venice.ai/settings/api',
    urlLabel: 'venice.ai → Settings → API',
  },
  {
    key: 'trustedrouter',
    name: 'TrustedRouter',
    blurb: 'One attested, OpenAI-compatible API for hundreds of models — the router proves the prompt path doesn’t log.',
    url: 'https://trustedrouter.com/',
    urlLabel: 'trustedrouter.com → API keys',
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
  onSpawned,
}: {
  herdr: HerdrState | null;
  activePaneId: string | null;
  onPick: (paneId: string) => void;
  onRefresh: () => void;
  onSpawned: (paneId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const live = herdr?.agents.length ?? 0;
  // Spawnable kinds, fetched when the popover opens (never before —
  // the probe shells out, and the popover is the only place it
  // matters). Only installed kinds are offered; the rest are named
  // in the note so the absence is honest, not invisible.
  const [spawnKinds, setSpawnKinds] = useState<{ kind: string; blurb: string; installed: boolean }[]>([]);
  const [spawnDefault, setSpawnDefault] = useState('');
  const [spawnPicked, setSpawnPicked] = useState('');
  const [spawning, setSpawning] = useState(false);
  const [spawnMsg, setSpawnMsg] = useState('');

  const loadSpawnable = () => {
    if (!window.halo) return;
    void window.halo.getSpawnableAgents().then((res) => {
      setSpawnKinds(res.kinds);
      setSpawnDefault(res.defaultKind);
      const first = res.kinds.find((k) => k.installed);
      setSpawnPicked(res.defaultKind && res.kinds.some((k) => k.kind === res.defaultKind && k.installed) ? res.defaultKind : (first?.kind ?? ''));
    }).catch(() => {});
  };

  const spawn = async () => {
    if (!window.halo || !spawnPicked || spawning) return;
    setSpawning(true);
    setSpawnMsg(`Starting ${spawnPicked}…`);
    try {
      const res = await window.halo.spawnAgent(spawnPicked);
      if (!res.ok) {
        setSpawnMsg(res.problem);
        return;
      }
      setSpawnMsg(`Started ${res.name} — jumping to chat…`);
      onSpawned(res.paneId);
      setOpen(false);
    } catch (e) {
      setSpawnMsg(`Could not spawn: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSpawning(false);
    }
  };

  const installedKinds = spawnKinds.filter((k) => k.installed);
  const missingKinds = spawnKinds.filter((k) => !k.installed);

  return (
    <div className="agents-switch">
      <button
        className="agents-chip"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            setSpawnMsg('');
            loadSpawnable();
          }
        }}
        title="Switch chat agent"
      >
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
              <p className="note">No agents running — spawn one below.</p>
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
            <h4>Spawn an agent</h4>
            {installedKinds.length === 0 && <p className="note">No spawnable agents installed — more in navi-extras.</p>}
            {installedKinds.length > 0 && (
              <div className="spawn-row">
                <select value={spawnPicked} onChange={(e) => setSpawnPicked(e.target.value)} disabled={spawning}>
                  {installedKinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.kind} — {k.blurb}
                    </option>
                  ))}
                </select>
                <button className="icon-btn" onClick={spawn} disabled={spawning || !spawnPicked}>
                  {spawning ? 'Starting…' : 'Spawn'}
                </button>
              </div>
            )}
            {spawnMsg && <p className="note">{spawnMsg}</p>}
            {missingKinds.length > 0 && (
              <p className="note">
                Not installed: {missingKinds.map((k) => k.kind).join(', ')} — install them from navi-extras.
              </p>
            )}
            {spawnDefault && (
              <p className="note">Your navi default agent is {spawnDefault} — pre-selected above.</p>
            )}
            <p className="note">goose and wisp are navi agents too, but herdr cannot start them — run them from a terminal pane.</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Trails home when nothing has run yet: a trail-like orbit, no
 * test-repo names, no favoured harness — just the invitation. */
function TrailsEmpty({ onOpenTerminal, detail }: { onOpenTerminal: () => void; detail?: string }) {
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
      {detail && <p className="note warn">{detail}</p>}
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
        {[trail.repo, trail.branch, trail.agent ? `agent: ${trail.agent}` : '', trail.phase]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {trail.url && (
        <p className="note">
          <a href={trail.url} target="_blank" rel="noreferrer">
            Open in Entire ↗
          </a>
        </p>
      )}

      {trail.scores === null && <p className="note">No evals yet — review agents have not scored this trail.</p>}
      {trail.scores !== null && (
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
      )}

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
        {trail.sessions.length === 0 && <p className="note">No sessions yet.</p>}
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
        {trail.gates.length === 0 && <p className="note">No gates yet.</p>}
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
        {trail.runs.length === 0 && <p className="note">No runs yet.</p>}
        {trail.runs.length > 0 && (
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
        )}
      </div>
    </div>
  );
}

const CHECK_PILL: Record<string, string> = {
  passing: 'green',
  failing: 'red',
  pending: 'amber',
  none: '',
};

function GitHubEmpty({ detail }: { detail?: string }) {
  return (
    <div className="main-body">
      <p className="empty-title">Nothing selected</p>
      <p className="note">Pick a pull request or an issue from the sidebar.</p>
      {detail && <p className="note warn">{detail}</p>}
    </div>
  );
}

// The detail view takes the list row OR the fuller detail — the
// row renders immediately (title, checks, labels are all in it) and
// the description/comments fill in when `gh pr view` / `gh issue
// view` lands. `'body' in pr` is false on a list row (the field is
// absent, not empty), so "Loading description…" is honest while the
// call is in flight, and `loadNote` carries a failed fetch's reason
// instead of a permanent loading state.
function GitHubPRView({ pr, loadNote }: { pr: GitHubPR | GitHubPRDetail; loadNote?: string }) {
  const hasBody = 'body' in pr;
  const hasComments = 'comments' in pr;
  const hasFiles = 'changedFiles' in pr;
  return (
    <div className="main-body">
      <p className="meta">
        {[pr.repo, `#${pr.number}`, pr.author ? `by ${pr.author}` : '', `${pr.headRef} → ${pr.baseRef}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="note">
        <span className={`pill ${CHECK_PILL[pr.checks] ?? 'cyan'}`}>checks: {pr.checks}</span>{' '}
        {pr.reviewDecision && <span className="pill cyan">{pr.reviewDecision.toLowerCase().replaceAll('_', ' ')}</span>}{' '}
        {pr.draft && <span className="pill amber">draft</span>}{' '}
        <span className="pill cyan">{pr.state}</span>
      </p>
      <p className="note">
        +{pr.additions} −{pr.deletions}
        {hasFiles ? ` · ${pr.changedFiles} files changed` : ''}
        {hasComments ? ` · ${pr.comments} comment${pr.comments === 1 ? '' : 's'}` : ''}
      </p>
      {pr.labels.length > 0 && (
        <p className="note">
          {pr.labels.map((l) => (
            <span key={l} className="pill cyan">
              {l}
            </span>
          ))}
        </p>
      )}
      {pr.url && (
        <p className="note">
          <a href={pr.url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        </p>
      )}
      <div className="section">
        <h3>Description</h3>
        {hasBody ? (
          pr.body ? (
            <p className="gh-body">{pr.body}</p>
          ) : (
            <p className="note">No description.</p>
          )
        ) : (
          <p className="note warn">{loadNote || 'Loading description…'}</p>
        )}
      </div>
    </div>
  );
}

function GitHubIssueView({ issue, loadNote }: { issue: GitHubIssue | GitHubIssueDetail; loadNote?: string }) {
  const hasBody = 'body' in issue;
  const hasComments = 'comments' in issue;
  return (
    <div className="main-body">
      <p className="meta">
        {[issue.repo, `#${issue.number}`, issue.author ? `by ${issue.author}` : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="note">
        <span className="pill cyan">{issue.state}</span>{' '}
        {issue.labels.map((l) => (
          <span key={l} className="pill cyan">
            {l}
          </span>
        ))}
      </p>
      {issue.assignees.length > 0 && <p className="note">Assigned to {issue.assignees.join(', ')}.</p>}
      {hasComments && (
        <p className="note">
          {issue.comments} comment{issue.comments === 1 ? '' : 's'}
        </p>
      )}
      {issue.url && (
        <p className="note">
          <a href={issue.url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        </p>
      )}
      <div className="section">
        <h3>Description</h3>
        {hasBody ? (
          issue.body ? (
            <p className="gh-body">{issue.body}</p>
          ) : (
            <p className="note">No description.</p>
          )
        ) : (
          <p className="note warn">{loadNote || 'Loading description…'}</p>
        )}
      </div>
    </div>
  );
}

const LINEAR_PILL: Record<string, string> = {
  backlog: '',
  unstarted: '',
  started: 'amber',
  completed: 'green',
  canceled: '',
};

function LinearEmpty({ detail }: { detail?: string }) {
  return (
    <div className="main-body">
      <p className="empty-title">Nothing selected</p>
      <p className="note">Pick an issue from the sidebar.</p>
      {detail && <p className="note warn">{detail}</p>}
    </div>
  );
}

// The detail view takes the list row OR the fuller detail — the row
// renders immediately (title, status, priority are all in it) and
// the description/comments fill in when `get_issue` + `list_comments`
// land. `'description' in issue` is false on a list row (the field
// is absent, not empty — the list truncates it), so "Loading
// description…" is honest while the call is in flight, and
// `loadNote` carries a failed fetch's reason instead of a permanent
// loading state.
function LinearIssueView({ issue, loadNote }: { issue: LinearIssue | LinearIssueDetail; loadNote?: string }) {
  const hasDescription = 'description' in issue;
  const hasComments = 'comments' in issue;
  return (
    <div className="main-body">
      <p className="meta">{[issue.id, issue.team, issue.createdBy ? `by ${issue.createdBy}` : ''].filter(Boolean).join(' · ')}</p>
      <p className="note">
        <span className={`pill ${LINEAR_PILL[issue.statusType] ?? ''}`}>{issue.status}</span>{' '}
        {issue.priority && <span className="pill cyan">{issue.priority} priority</span>}{' '}
        {issue.assignee && <span className="pill cyan">→ {issue.assignee}</span>}
      </p>
      {issue.labels.length > 0 && (
        <p className="note">
          {issue.labels.map((l) => (
            <span key={l} className="pill cyan">
              {l}
            </span>
          ))}
        </p>
      )}
      {hasComments && (
        <p className="note">
          {issue.comments.length} comment{issue.comments.length === 1 ? '' : 's'}
        </p>
      )}
      {hasComments &&
        issue.comments.map((c) => (
          <div key={c.id} className="section">
            <p className="meta">
              {c.author}
              {c.createdAt ? ` · ${c.createdAt.slice(0, 10)}` : ''}
            </p>
            <p className="gh-body">{c.body}</p>
          </div>
        ))}
      {issue.url && (
        <p className="note">
          <a href={issue.url} target="_blank" rel="noreferrer">
            Open in Linear ↗
          </a>
        </p>
      )}
      <div className="section">
        <h3>Description</h3>
        {hasDescription ? (
          issue.description ? (
            <p className="gh-body">{issue.description}</p>
          ) : (
            <p className="note">No description.</p>
          )
        ) : (
          <p className="note warn">{loadNote || 'Loading description…'}</p>
        )}
      </div>
    </div>
  );
}

/** Notes: the list lives in the main view (the sidebar belongs to
 * the forges), with the detail — or the new-note editor — beside it.
 * The editor's target is whichever source is wired up: Notion (a
 * database chosen in Settings) or the Obsidian vault. A target that
 * is not configured is not offered. */
function NotesView({
  notes,
  detail,
  selected,
  loadNote,
  notionReady,
  obsidianReady,
  onSelect,
  onRefresh,
  onCreate,
}: {
  notes: NoteItem[];
  detail: string;
  selected: NoteDetail | null;
  loadNote: string;
  notionReady: boolean;
  obsidianReady: boolean;
  onSelect: (id: string) => void;
  onRefresh: (query: string) => void;
  onCreate: (target: 'notion' | 'obsidian', title: string, body: string) => Promise<{ id: string; problem: string }>;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newTarget, setNewTarget] = useState<'notion' | 'obsidian'>(notionReady ? 'notion' : 'obsidian');
  const [createMsg, setCreateMsg] = useState('');

  const startCreate = () => {
    setCreating(true);
    setCreateMsg('');
    setNewTarget(notionReady ? 'notion' : 'obsidian');
  };

  const pushNote = async () => {
    if (!newTitle.trim() && !newBody.trim()) {
      setCreateMsg('Give the note a title or some body first.');
      return;
    }
    setCreateMsg('Pushing…');
    const res = await onCreate(newTarget, newTitle.trim(), newBody);
    if (res.problem) {
      setCreateMsg(res.problem);
      return;
    }
    setCreateMsg('Pushed.');
    setNewTitle('');
    setNewBody('');
    setCreating(false);
    onSelect(res.id);
  };

  return (
    <div className="notes-view">
      <div className="notes-list">
        <div className="notes-tools">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRefresh(query);
            }}
            placeholder="Search notes…"
          />
          <button className="icon-btn" onClick={() => onRefresh(query)} title="Refresh notes">
            ↻
          </button>
          <button className="icon-btn" onClick={startCreate} title="Write a new note">
            ＋ New
          </button>
        </div>
        {notes.length === 0 && <p className="note">{detail || 'No notes yet.'}</p>}
        {notes.map((n) => (
          <button
            key={n.id}
            className={`note-row ${selected?.id === n.id && !creating ? 'active' : ''}`}
            onClick={() => {
              setCreating(false);
              onSelect(n.id);
            }}
          >
            <div className="t-title">
              {n.title}
              <span className={`pill ${n.source === 'notion' ? 'cyan' : 'green'}`}>{n.source}</span>
            </div>
            {n.updatedAt && <div className="t-meta">{n.updatedAt.slice(0, 10)}</div>}
          </button>
        ))}
      </div>
      <div className="notes-detail">
        {creating ? (
          <div className="note-editor">
            <h3>New note</h3>
            <label>
              Title
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Note title" />
            </label>
            <label>
              Push to
              <select value={newTarget} onChange={(e) => setNewTarget(e.target.value as 'notion' | 'obsidian')}>
                <option value="notion" disabled={!notionReady}>
                  Notion{notionReady ? '' : ' (not configured)'}
                </option>
                <option value="obsidian" disabled={!obsidianReady}>
                  Obsidian vault{obsidianReady ? '' : ' (not configured)'}
                </option>
              </select>
            </label>
            <label>
              Body
              <textarea rows={12} value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Write the note…" />
            </label>
            <div className="save-row">
              <button className="primary-btn" onClick={pushNote}>
                Push note
              </button>
              <button className="icon-btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              {createMsg && <span className="saved-msg">{createMsg}</span>}
            </div>
            {!notionReady && !obsidianReady && (
              <p className="note">Nothing is wired up yet — add a Notion token or an Obsidian vault path in Settings → Notes.</p>
            )}
          </div>
        ) : selected ? (
          <>
            <h3>{selected.title}</h3>
            <p className="note">
              {selected.source === 'notion' ? 'Notion' : 'Obsidian vault'}
              {selected.updatedAt ? ` · ${selected.updatedAt.slice(0, 10)}` : ''}
              {selected.url && (
                <>
                  {' · '}
                  <a href={selected.url} target="_blank" rel="noreferrer">
                    Open ↗
                  </a>
                </>
              )}
            </p>
            {loadNote && <p className="note">{loadNote}</p>}
            {selected.content ? (
              <div className="gh-body">{selected.content}</div>
            ) : (
              !loadNote && <p className="note">No readable content — open it in Notion to read it.</p>
            )}
          </>
        ) : (
          <p className="note">{detail || 'Pick a note, or write a new one.'}</p>
        )}
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  setSettings,
  herdr,
  connections,
  onRefreshHerdr,
  onResetSidebarWidth,
  onRefreshConnections,
  onInstall,
  onConnect,
  onListNotionDatabases,
}: {
  settings: HaloSettings;
  setSettings: (next: HaloSettings) => void;
  herdr: HerdrState | null;
  connections: ConnectionStatus[];
  onRefreshHerdr: () => void;
  onResetSidebarWidth: () => void;
  onRefreshConnections: () => void;
  onInstall: (tool: ToolId) => Promise<InstallResult>;
  onConnect: (command: string) => void;
  onListNotionDatabases: () => Promise<{ databases: NotionDatabase[]; problem: string }>;
}) {
  const [saved, setSaved] = useState('');
  const [version, setVersion] = useState('');
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPath, setNewRepoPath] = useState('');
  const [connMsg, setConnMsg] = useState('');
  const [installing, setInstalling] = useState<ToolId | ''>('');
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [dbMsg, setDbMsg] = useState('');
  const [dbLoading, setDbLoading] = useState(false);

  // One row per forge: the dot, what the probe actually said, and
  // the next step — Install when the tool is missing, Connect when
  // it is installed but not signed in. Connect opens a setup terminal
  // pane running the login command; Install downloads the release
  // archive, verifies its checksum, and extracts it to ~/.local/bin.
  const connRow = (forge: 'entire' | 'github' | 'linear' | 'notion', install?: ToolId, loginCmd?: string) => {
    const c = connections.find((x) => x.forge === forge);
    if (!c) return <p className="note">Checking connection…</p>;
    const dotClass = c.state === 'connected' ? 'green' : c.state === 'not-authed' ? 'amber' : 'grey';
    return (
      <p className="note">
        <span className={`conn-dot ${dotClass}`} /> {c.detail}{' '}
        {c.state === 'missing' && install && (
          <button className="icon-btn" disabled={installing === install} onClick={() => runInstall(install)}>
            {installing === install ? 'Installing…' : `Install ${install}`}
          </button>
        )}
        {c.state === 'not-authed' && loginCmd && (
          <button className="icon-btn" onClick={() => onConnect(loginCmd)}>
            Connect
          </button>
        )}
      </p>
    );
  };

  const runInstall = async (tool: ToolId) => {
    setInstalling(tool);
    setConnMsg(`Installing ${tool}…`);
    try {
      const res = await onInstall(tool);
      setConnMsg(res.detail);
      onRefreshConnections();
    } catch (e) {
      setConnMsg(`Install failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstalling('');
    }
  };

  const findDatabases = async () => {
    setDbLoading(true);
    setDbMsg('');
    try {
      const res = await onListNotionDatabases();
      setDatabases(res.databases);
      setDbMsg(
        res.problem ||
          (res.databases.length
            ? `${res.databases.length} database${res.databases.length === 1 ? '' : 's'} found — pick one below.`
            : 'No databases found.'),
      );
    } catch (e) {
      setDbMsg(`Could not list databases: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDbLoading(false);
    }
  };

  useEffect(() => {
    if (window.halo) window.halo.getVersion().then(setVersion).catch(() => {});
  }, []);

  const save = async () => {
    if (window.halo) {
      try {
        const res = await window.halo.saveSettings(settings);
        setSaved(`Saved to ${res.path}`);
      } catch (e) {
        // A failed save must say so, not pretend it worked — the
        // settings file lives in a user-owned dir, but if that dir
        // is not writable the user needs to know, not wonder why
        // their font size (or a key) did not stick.
        setSaved(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
      }
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
    // The outer .main-body is the full-width scrolling container — the
    // scrollbar belongs to it, so it sits at the far right edge of the
    // window. The inner .settings is the 640px content column inside
    // it. Never put the max-width on the scroller itself: the scrollbar
    // then lands in the middle of the window (0.6.3 fix).
    <div className="main-body">
      <div className="settings">
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

      <h3>Entire Trails</h3>
      <label>
        Projects (one per line)
        <textarea
          rows={3}
          value={settings.entire.projects.join('\n')}
          onChange={(e) =>
            setSettings({
              ...settings,
              entire: {
                ...settings.entire,
                projects: e.target.value
                  .split('\n')
                  .map((p) => p.trim())
                  .filter(Boolean),
              },
            })
          }
          placeholder={'et/xvoidsx\ngh/rav3ndust'}
        />
      </label>
      {connRow('entire', 'entire', 'entire login')}
      {connMsg && <p className="note">{connMsg}</p>}
      <p className="note">
        The Trails list comes from `entire trail list --project`, which needs a project — `et/&lt;project&gt;` for a
        native Entire repo, `gh/&lt;owner&gt;` for a GitHub mirror. Trails stay an Entire thing: native projects
        list under Trails, mirrored projects under their own GitHub section. The Entire CLI must be installed and
        logged in. Until a project is set, the Trails list stays empty.
      </p>

      <h3>GitHub</h3>
      <label>
        Repos (one per line)
        <textarea
          rows={3}
          value={settings.github.repos.join('\n')}
          onChange={(e) =>
            setSettings({
              ...settings,
              github: {
                ...settings.github,
                repos: e.target.value
                  .split('\n')
                  .map((r) => r.trim())
                  .filter(Boolean),
              },
            })
          }
          placeholder={'xvoidsx/halo\nxvoidsx/navi'}
        />
      </label>
      {connRow('github', 'gh', 'gh auth login')}
      <p className="note">
        Pull requests and issues come from `gh pr list` / `gh issue list`, so the `gh` CLI must be installed and
        logged in (`gh auth login`) — Halo never holds a token of its own. Branch status (ahead/behind, dirty) is
        read from the local checkouts in Settings → Repos whose origin is the same GitHub repo. Read-only for now:
        no push, pull, or merge from Halo yet.
      </p>

      <h3>Linear</h3>
      <label>
        Team
        <input
          type="text"
          value={settings.linear.team}
          onChange={(e) => setSettings({ ...settings, linear: { ...settings.linear, team: e.target.value } })}
          placeholder="xvoidsx"
        />
      </label>
      <label>
        Personal API key (only when the connector is not available)
        <input
          type="password"
          value={settings.linear.apiKey}
          onChange={(e) => setSettings({ ...settings, linear: { ...settings.linear, apiKey: e.target.value } })}
          placeholder="lin_api_… — not configured"
        />
      </label>
      {connRow('linear')}
      <p className="note">
        Issues come from the `linear` connector CLI first (`call-tool list_issues` / `get_issue` / `list_comments`),
        so on a machine with the connector Halo never holds a token of its own — it rides the existing connection.
        On a machine without the connector, Halo calls the Linear GraphQL API directly with the personal API key
        above (create one at{' '}
        <a href="https://linear.app/settings/api" target="_blank" rel="noreferrer">
          linear.app/settings/api
        </a>
        ). Read-only for now: the connector's first grant is read-only, and Halo only ever calls read queries.
        Empty team means the whole workspace.
      </p>

      <h3>Notes</h3>
      <label>
        Notion integration token (for reading pages + pushing notes)
        <input
          type="password"
          value={settings.notes.notionToken}
          onChange={(e) => setSettings({ ...settings, notes: { ...settings.notes, notionToken: e.target.value } })}
          placeholder="ntn_… / secret_… — not configured"
        />
      </label>
      {connRow('notion', 'ntn')}
      <label>
        Target database (new notes are pushed here)
        <select
          value={settings.notes.notionDatabaseId}
          onChange={(e) => setSettings({ ...settings, notes: { ...settings.notes, notionDatabaseId: e.target.value } })}
        >
          <option value="">— pick a database —</option>
          {settings.notes.notionDatabaseId && !databases.some((d) => d.id === settings.notes.notionDatabaseId) && (
            <option value={settings.notes.notionDatabaseId}>{settings.notes.notionDatabaseId} (saved)</option>
          )}
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      <button className="icon-btn" disabled={dbLoading} onClick={findDatabases}>
        {dbLoading ? 'Looking…' : 'Find databases'}
      </button>
      {dbMsg && <p className="note">{dbMsg}</p>}
      <label>
        Obsidian vault path
        <input
          type="text"
          value={settings.notes.obsidianPath}
          onChange={(e) => setSettings({ ...settings, notes: { ...settings.notes, obsidianPath: e.target.value } })}
          placeholder="/home/rav3ndust/notes"
        />
      </label>
      <p className="note">
        Notes list Notion pages (recent first, or by search) and .md files from the Obsidian vault, newest first.
        Reading a Notion page inside Halo and pushing a new note to a database need the integration token — create
        one at{' '}
        <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
          notion.so/my-integrations
        </a>{' '}
        and share the target database with it ("Add connections" in Notion — an unshared database 404s). Without a
        token, Halo still lists and searches through the Notion connector when it is present. The Obsidian vault
        needs no auth at all: Halo reads and writes the .md files directly.
      </p>
      <button className="icon-btn" onClick={onRefreshConnections}>
        ↻ Refresh connections
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

      <h3>Terminal</h3>
      <label>
        Font size
        <select
          value={settings.terminal.fontSize}
          onChange={(e) =>
            setSettings({ ...settings, terminal: { ...settings.terminal, fontSize: Number(e.target.value) } })
          }
        >
          {[11, 12, 13, 14, 15, 16, 18].map((s) => (
            <option key={s} value={s}>
              {s}px{ s === 13 ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="note">Applies to every terminal pane and the chat attach, live — no restart needed.</p>

      <h3>Sidebar</h3>
      <p className="note">Drag the sidebar’s right edge to resize it (200–420px); the width is remembered.</p>
      <button className="icon-btn" onClick={onResetSidebarWidth}>
        Reset sidebar width (280px)
      </button>

      <h3>Halo</h3>
      <p className="note">Version {version || '…'}</p>
      <p className="note">Local-first, no telemetry. Settings live at ~/.config/halo/settings.json (0600).</p>

      <div className="save-row">
        <button className="primary-btn" onClick={save}>
          Save settings
        </button>
        {saved && <span className="saved-msg">{saved}</span>}
      </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('trail');
  const [trails, setTrails] = useState<Trail[]>([]);
  // Synchronous mirror of the trail list: the detail effect needs the
  // selected trail's project, and reading it from state would re-fetch
  // the detail on every 30 s list refresh. The ref is set in the same
  // beat as the state, before the selection can change.
  const trailsRef = useRef<Trail[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  // Human-readable trail-list state (empty because no project is
  // configured, the CLI is missing, …) — shown in the sidebar and
  // the empty view instead of a bare "No trails yet."
  const [trailsDetail, setTrailsDetail] = useState('');
  // Fuller trails fetched via `entire trail show`, keyed by id. The
  // list carries intent only; the detail survives list refreshes
  // because it lives here, not in the list rows.
  const [trailDetails, setTrailDetails] = useState<Record<string, Trail>>({});
  // The forge switcher: Entire (Trails), GitHub (PRs + issues), or
  // Linear (issues). One forge's list is visible at a time; the
  // others keep their selections. A UI preference, so it lives in
  // localStorage like the sidebar width — not in settings.json.
  const [forge, setForge] = useState<'entire' | 'github' | 'linear'>(() => {
    try {
      const saved = window.localStorage.getItem('halo.forge');
      return saved === 'github' || saved === 'linear' ? saved : 'entire';
    } catch {
      return 'entire';
    }
  });
  // GitHub lists, from the `gh` CLI (main reads the configured repos
  // from settings). Same shape as the trails side: a synchronous
  // mirror for the detail effect, a detail note for the empty states,
  // and per-item details that survive the 30 s list refresh.
  const [prs, setPrs] = useState<GitHubPR[]>([]);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [statuses, setStatuses] = useState<RepoStatus[]>([]);
  const [githubDetail, setGithubDetail] = useState('');
  const [ghPRDetails, setGhPRDetails] = useState<Record<string, GitHubPRDetail>>({});
  const [ghIssueDetails, setGhIssueDetails] = useState<Record<string, GitHubIssueDetail>>({});
  // Why the selected item's description is still loading (or why the
  // detail fetch failed) — the views show this instead of a permanent
  // "Loading description…".
  const [ghDetailNote, setGhDetailNote] = useState('');
  const [selectedGhId, setSelectedGhId] = useState<string>('');
  const ghRef = useRef<{ prs: GitHubPR[]; issues: GitHubIssue[] }>({ prs: [], issues: [] });
  // Linear issues, from the `linear` connector CLI (main reads the
  // configured team from settings). Same shape as the GitHub side: a
  // synchronous mirror for the detail effect, a detail note for the
  // empty states, and per-issue details that survive the 30 s list
  // refresh.
  const [linIssues, setLinIssues] = useState<LinearIssue[]>([]);
  const [linearDetail, setLinearDetail] = useState('');
  const [linDetails, setLinDetails] = useState<Record<string, LinearIssueDetail>>({});
  const [linDetailNote, setLinDetailNote] = useState('');
  const [selectedLinId, setSelectedLinId] = useState<string>('');
  const linRef = useRef<LinearIssue[]>([]);
  const [settings, setSettings] = useState<HaloSettings>(defaultSettings);
  const [herdr, setHerdr] = useState<HerdrState | null>(null);
  // Connection health: one probe per forge, refreshed on mount, when
  // Settings opens, and after any Install/Connect. The dots in the
  // forge switcher read this; the Settings rows show the detail.
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  // Notes: Notion + Obsidian, newest first. Same list/detail shape
  // as trails/GitHub/Linear — a synchronous mirror for the detail
  // effect, a detail note for the empty states, per-note details
  // that survive list refreshes.
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesDetail, setNotesDetail] = useState('');
  const [noteDetails, setNoteDetails] = useState<Record<string, NoteDetail>>({});
  const [noteDetailNote, setNoteDetailNote] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const notesRef = useRef<NoteItem[]>([]);
  // Terminal panes are first-class: one shell by default, at home —
  // no repo required. Split adds panes; 'Open herdr' boots the herdr
  // TUI in one. Panes mount on first visit and stay alive across tabs.
  const [termPanes, setTermPanes] = useState<TermPane[]>([{ id: 'pane-home', title: 'shell', cwd: '' }]);
  const [termMounted, setTermMounted] = useState(false);
  // The chat view mounts on first visit and stays alive across tabs,
  // hidden instead of unmounted — the attach keeps its pty and its
  // scrollback when you switch away and back. Same shape as the
  // terminal panes above.
  const [chatMounted, setChatMounted] = useState(false);
  // Pane ids whose shell has exited (terminal panes and the chat
  // attach alike) — the sidebar counts them for "Reconnect all".
  const [deadPanes, setDeadPanes] = useState<string[]>([]);
  const onExitState = useCallback((paneId: string, dead: boolean) => {
    setDeadPanes((prev) =>
      dead ? (prev.includes(paneId) ? prev : [...prev, paneId]) : prev.filter((p) => p !== paneId),
    );
  }, []);
  // Bumps when the user asks every dead pane to re-spawn at once.
  const [reconnectAllSignal, setReconnectAllSignal] = useState(0);
  // Split shares: one fraction per pane, summing to 1. Dragging a
  // divider moves share between its two neighbours (min 10% each).
  const [termSizes, setTermSizes] = useState<number[]>([1]);
  const dividerDragRef = useRef<{ index: number; startX: number; width: number; start: number[] } | null>(null);
  // The sidebar resizes like herdr's desktop app: a drag handle on
  // its right edge, 200–420px, remembered across restarts. The width
  // is a UI preference, so it lives in localStorage — not in
  // settings.json, which holds secrets (provider keys) instead.
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 420;
  const SIDEBAR_DEFAULT = 280;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      // Number(null) is 0, not NaN — a missing key must fall back
      // to the default, not clamp to the 200px floor.
      const raw = window.localStorage.getItem('halo.sidebarWidth');
      const saved = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(saved) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, saved)) : SIDEBAR_DEFAULT;
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // The drag's pointerup handler reads the width from this ref. It is
  // updated synchronously on every move — an effect-synced ref lags
  // behind a drag whose moves and pointerup fire in one burst, and
  // the saved width would be the pre-drag value.
  const sidebarWidthRef = useRef(sidebarWidth);
  // Reset from Settings: back to the 280px default, and forget the
  // persisted width so a reload does not bring the old one back.
  const resetSidebarWidth = useCallback(() => {
    sidebarWidthRef.current = SIDEBAR_DEFAULT;
    setSidebarWidth(SIDEBAR_DEFAULT);
    try {
      window.localStorage.removeItem('halo.sidebarWidth');
    } catch {
      // storage unavailable — the state reset is what matters.
    }
  }, []);
  // Pane ids currently holding a live `herdr agent attach` in any
  // terminal — the chat poller must not `agent read` those (a read
  // kills a live attach). TerminalPanels report their attach state.
  const [attachedPanes, setAttachedPanes] = useState<string[]>([]);
  const onAttachState = useCallback((paneId: string, attached: boolean) => {
    setAttachedPanes((prev) =>
      attached ? (prev.includes(paneId) ? prev : [...prev, paneId]) : prev.filter((p) => p !== paneId),
    );
  }, []);

  const refreshHerdr = useCallback(() => {
    if (window.halo) void window.halo.herdrStatus().then(setHerdr);
  }, []);

  const refreshConnections = useCallback(() => {
    if (window.halo) void window.halo.getConnections().then(setConnections).catch(() => {});
  }, []);

  // Trails come from the Entire CLI (main reads the configured project
  // from settings). Refresh on mount, every 30 s, and whenever the
  // Trails view is opened — a trail started after launch still shows
  // up live. 30 s, not the herdr poll's 10 s: the list call hits the
  // Entire API over the network.
  const refreshTrails = useCallback(() => {
    if (!window.halo) return;
    void window.halo.listTrails().then((res) => {
      setTrails(res.trails);
      trailsRef.current = res.trails;
      setTrailsDetail(res.detail);
      setSelectedId((prev) => {
        if (prev && res.trails.some((t) => t.id === prev)) return prev;
        return res.trails[0]?.id ?? '';
      });
    });
  }, []);

  // Picking a trail switches to the Trails view; the detail effect
  // below fetches its full view via `entire trail show`.
  const selectTrail = useCallback((id: string) => {
    setSelectedId(id);
    setView('trail');
  }, []);

  // GitHub lists come from the `gh` CLI (main reads the configured
  // repos from settings). Same 30 s cadence as trails — the list call
  // hits the GitHub API over the network.
  const refreshGitHub = useCallback(() => {
    if (!window.halo) return;
    void window.halo.listGitHub().then((res) => {
      setPrs(res.prs);
      setIssues(res.issues);
      setStatuses(res.statuses);
      ghRef.current = { prs: res.prs, issues: res.issues };
      setGithubDetail(res.detail);
      setSelectedGhId((prev) => {
        const ids = new Set([...res.prs.map((p) => p.id), ...res.issues.map((i) => i.id)]);
        if (prev && ids.has(prev)) return prev;
        return res.prs[0]?.id ?? res.issues[0]?.id ?? '';
      });
    });
  }, []);

  // Picking a PR or issue switches to the detail view; the detail
  // effect below fetches its full view via `gh pr view` / `gh issue
  // view`.
  const selectGh = useCallback((id: string) => {
    setGhDetailNote('');
    setSelectedGhId(id);
    setView('trail');
  }, []);

  // Linear issues come from the `linear` connector CLI (main reads
  // the configured team from settings). Same 30 s cadence as trails
  // and GitHub — the list call hits the Linear API over the network.
  const refreshLinear = useCallback(() => {
    if (!window.halo) return;
    void window.halo.listLinear().then((res) => {
      setLinIssues(res.issues);
      linRef.current = res.issues;
      setLinearDetail(res.detail);
      setSelectedLinId((prev) => {
        if (prev && res.issues.some((i) => i.id === prev)) return prev;
        return res.issues[0]?.id ?? '';
      });
    });
  }, []);

  // Picking an issue switches to the detail view; the detail effect
  // below fetches its full view via `get_issue` + `list_comments`.
  const selectLin = useCallback((id: string) => {
    setLinDetailNote('');
    setSelectedLinId(id);
    setView('trail');
  }, []);

  // Notes come from Notion (recent pages, or a search) and the
  // Obsidian vault (main reads both from settings). Refreshed on
  // mount and when the Notes view opens — notes change rarely, so
  // there is no 30 s timer for them.
  const refreshNotes = useCallback((query?: string) => {
    if (!window.halo) return;
    void window.halo.listNotes(query ?? '').then((res) => {
      setNotes(res.notes);
      notesRef.current = res.notes;
      setNotesDetail(res.detail);
      setSelectedNoteId((prev) => {
        if (prev && res.notes.some((n) => n.id === prev)) return prev;
        return res.notes[0]?.id ?? '';
      });
    });
  }, []);

  const selectNote = useCallback((id: string) => {
    setNoteDetailNote('');
    setSelectedNoteId(id);
    setView('notes');
  }, []);

  const createNote = useCallback(
    async (target: 'notion' | 'obsidian', title: string, body: string) => {
      if (!window.halo) return { id: '', problem: 'No Electron bridge (browser preview).' };
      const res = await window.halo.createNote(target, title, body);
      if (!res.problem) refreshNotes();
      return { id: res.id, problem: res.problem };
    },
    [refreshNotes],
  );

  // Switching forges remembers the choice and refreshes the list
  // when landing on it — an issue opened after launch still shows
  // up live.
  const switchForge = useCallback(
    (next: 'entire' | 'github' | 'linear') => {
      setForge(next);
      try {
        window.localStorage.setItem('halo.forge', next);
      } catch {
        // Private mode or no storage — the switch still works.
      }
      if (next === 'github') refreshGitHub();
      if (next === 'linear') refreshLinear();
    },
    [refreshGitHub, refreshLinear],
  );

  useEffect(() => {
    // No trail data is faked anywhere: the list starts empty and only
    // fills when a real trail source is wired up. In a plain browser
    // (vite dev) there is no Electron bridge, so the shell previews empty.
    if (!window.halo) {
      setTrails([]);
      trailsRef.current = [];
      setTrailsDetail('No Electron bridge (browser preview).');
      setHerdr({ installed: false, detail: 'No Electron bridge (browser preview).', agents: [] });
      return;
    }
    refreshTrails();
    refreshGitHub();
    refreshLinear();
    refreshConnections();
    refreshNotes();
    void window.halo.getSettings().then(setSettings);
    refreshHerdr();
    // Live detection: herdr agents come and go — re-check while Halo is
    // open, so an agent started after launch still shows up.
    const timer = window.setInterval(refreshHerdr, 10000);
    const trailTimer = window.setInterval(refreshTrails, 30000);
    const ghTimer = window.setInterval(refreshGitHub, 30000);
    const linTimer = window.setInterval(refreshLinear, 30000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(trailTimer);
      window.clearInterval(ghTimer);
      window.clearInterval(linTimer);
    };
  }, [refreshHerdr, refreshTrails, refreshGitHub, refreshLinear, refreshConnections, refreshNotes]);

  // Opening Settings re-probes the connections (the user may have
  // just signed in from a setup terminal); opening Notes refreshes
  // the list (a note may have landed from Notion or the vault).
  useEffect(() => {
    if (view === 'settings') refreshConnections();
    if (view === 'notes') refreshNotes();
  }, [view, refreshConnections, refreshNotes]);

  // The list carries intent only; the note detail comes from the
  // API (Notion) or the vault file (Obsidian), fetched when a note
  // is picked. It lands in noteDetails, so a list refresh never
  // clobbers a fuller note with its thin list row.
  useEffect(() => {
    if (!selectedNoteId || !window.halo) return;
    let cancelled = false;
    void window.halo.getNote(selectedNoteId).then((res) => {
      if (cancelled) return;
      if (res.note) {
        setNoteDetails((prev) => ({ ...prev, [res.note!.id]: res.note! }));
        // A note can arrive WITH a detail (the no-token Notion page
        // carries the "add a token" hint) — keep it, don't clear it.
        setNoteDetailNote(res.detail ?? '');
      } else {
        setNoteDetailNote(res.detail);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedNoteId]);

  // The list carries intent only; the detail view comes from
  // `entire trail show`, fetched when a trail is picked (or on first
  // load). It lands in trailDetails, so the 30 s list refresh never
  // clobbers a fuller trail with its thin list row.
  useEffect(() => {
    if (!selectedId || !window.halo) return;
    const project = trailsRef.current.find((t) => t.id === selectedId)?.project ?? '';
    let cancelled = false;
    void window.halo.getTrail(selectedId, project).then((res) => {
      if (cancelled || !res.trail) return;
      const full = res.trail;
      setTrailDetails((prev) => ({ ...prev, [full.id]: full }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // The list carries intent only; the detail view comes from
  // `gh pr view` / `gh issue view`, fetched when a row is picked (or
  // on first load). It lands in the detail records, so the 30 s list
  // refresh never clobbers a fuller item with its thin list row.
  useEffect(() => {
    if (!selectedGhId || !window.halo) return;
    const pr = ghRef.current.prs.find((p) => p.id === selectedGhId);
    const issue = !pr ? ghRef.current.issues.find((i) => i.id === selectedGhId) : undefined;
    let cancelled = false;
    if (pr) {
      void window.halo.getPR(pr.repo, pr.number).then((res) => {
        if (cancelled) return;
        if (!res.pr) {
          setGhDetailNote(res.detail);
          return;
        }
        const full = res.pr;
        setGhPRDetails((prev) => ({ ...prev, [full.id]: full }));
      });
    } else if (issue) {
      void window.halo.getIssue(issue.repo, issue.number).then((res) => {
        if (cancelled) return;
        if (!res.issue) {
          setGhDetailNote(res.detail);
          return;
        }
        const full = res.issue;
        setGhIssueDetails((prev) => ({ ...prev, [full.id]: full }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedGhId]);

  // The list carries intent only; the detail view comes from
  // `get_issue` + `list_comments`, fetched when an issue is picked
  // (or on first load). It lands in the detail records, so the 30 s
  // list refresh never clobbers a fuller issue with its thin list
  // row — and never shows the list's truncated description as the
  // real one.
  useEffect(() => {
    if (!selectedLinId || !window.halo) return;
    let cancelled = false;
    void window.halo.getLinearIssue(selectedLinId).then((res) => {
      if (cancelled) return;
      if (!res.issue) {
        setLinDetailNote(res.detail);
        return;
      }
      if (res.detail) setLinDetailNote(res.detail);
      const full = res.issue;
      setLinDetails((prev) => ({ ...prev, [full.id]: full }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedLinId]);

  useEffect(() => {
    if (view === 'terminal') setTermMounted(true);
  }, [view]);

  useEffect(() => {
    if (view === 'chat') setChatMounted(true);
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
    // The new pane takes half of the last pane's share — a split
    // divides what you were looking at.
    setTermSizes((sizes) => {
      if (sizes.length === 0) return [1];
      const last = sizes[sizes.length - 1];
      return [...sizes.slice(0, -1), last / 2, last / 2];
    });
    setView('terminal');
  }, []);

  // Connect opens a setup terminal pane running the login command
  // (`gh auth login`, `entire login`) — the user signs in there, in
  // the open, and the dot flips green on the next probe (opening
  // Settings re-probes).
  const openSetupTerminal = useCallback(
    (command: string) => {
      addTermPane(command, `sign in: ${command.split(' ')[0]}`);
    },
    [addTermPane],
  );

  // Which terminal pane the user is in — the split shortcuts and the
  // context menu act on this one. A pane reports focus when its
  // terminal gains it (the new pane focuses itself on spawn).
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>('pane-home');
  const onPaneFocus = useCallback((paneId: string) => {
    setFocusedPaneId(paneId);
  }, []);

  // Split AFTER a pane (the focused one, a given one, or the last):
  // the new pane goes right beside it and takes half its share. The
  // Split button and the shortcut split where you're looking; the
  // context menu splits the pane you right-clicked. `addTermPane`
  // above stays for "Open herdr" / "Jump to terminal", which append
  // at the end instead.
  const splitPane = useCallback(
    (afterId?: string) => {
      const id = `pane-${Date.now().toString(36)}`;
      setTermPanes((panes) => {
        const anchor = afterId ?? focusedPaneId ?? panes[panes.length - 1]?.id;
        const idx = panes.findIndex((p) => p.id === anchor);
        const at = idx === -1 ? panes.length : idx + 1;
        const next = [...panes];
        next.splice(at, 0, { id, title: 'shell', cwd: panes[0]?.cwd ?? '' });
        return next;
      });
      setTermSizes((sizes) => {
        const anchor = afterId ?? focusedPaneId ?? null;
        const idx = termPanes.findIndex((p) => p.id === anchor);
        const at = idx === -1 ? sizes.length - 1 : idx;
        if (at < 0 || sizes.length === 0) return [1];
        const share = sizes[at] ?? 1;
        const next = [...sizes];
        next.splice(at, 1, share / 2, share / 2);
        return next;
      });
      setView('terminal');
    },
    [focusedPaneId, termPanes],
  );

  const closeTermPane = useCallback((id: string) => {
    setTermPanes((panes) => {
      if (panes.length <= 1) return panes;
      const idx = panes.findIndex((p) => p.id === id);
      if (idx === -1) return panes;
      return panes.filter((p) => p.id !== id);
    });
    // Hand the closed pane's share to its neighbour so the rest keeps
    // its proportions.
    setTermSizes((sizes) => {
      if (sizes.length <= 1) return [1];
      const idx = termPanes.findIndex((p) => p.id === id);
      if (idx === -1) return sizes;
      const closed = sizes[idx] ?? 0;
      const rest = sizes.filter((_, i) => i !== idx);
      const giveTo = Math.max(0, idx - 1);
      rest[giveTo] = (rest[giveTo] ?? 0) + closed;
      return rest;
    });
    // Focus follows the pane that took the share, so the keyboard
    // stays somewhere sensible after a close.
    const idx = termPanes.findIndex((p) => p.id === id);
    if (idx !== -1 && termPanes.length > 1) {
      const neighbour = termPanes[Math.max(0, idx - 1)] ?? termPanes[idx + 1];
      if (neighbour && neighbour.id !== id) setFocusedPaneId(neighbour.id);
    }
  }, [termPanes]);

  // Right-click menu on a terminal pane (Split right / Close pane).
  // Positioned at the cursor; dismissed by clicking elsewhere,
  // Escape, or picking an item.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; paneId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [ctxMenu]);

  // Pane shortcuts — Raven's Kitty vocabulary, not a new one:
  // Ctrl+Shift+D splits, Ctrl+Shift+Q (or X) closes the pane,
  // Ctrl+Shift+Arrow moves focus between panes. Kitty's exact
  // scheme, settled 2026-10-08 (Ctrl+Shift+H is horizontal split
  // there, and Ctrl+Shift+V stays paste — neither is used here).
  // No leader key: a Ctrl+B leader would steal herdr's own prefix
  // from any herdr TUI running in a pane.
  //
  // Capture phase, on purpose: the xterm's textarea handles keys
  // before a bubble-phase window listener ever sees them, so a
  // bubble listener would be too late — the key would already be in
  // the shell. Capture runs first, and stopPropagation keeps the
  // terminal from ever seeing a shortcut key. Keys we don't handle
  // are left completely alone.
  useEffect(() => {
    const isEditableTarget = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return true;
      if (t.tagName === 'TEXTAREA' && !t.classList.contains('xterm-helper-textarea')) return true;
      if (t.isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      if (isEditableTarget(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'd') {
        // Split the focused pane, from any tab — it switches to
        // Terminal, like opening a new terminal from anywhere.
        e.preventDefault();
        e.stopPropagation();
        splitPane();
        return;
      }
      // Close and focus-move only make sense while looking at the
      // terminal — closing a pane you can't see would be a surprise.
      if (view !== 'terminal') return;
      if (key === 'q' || key === 'x') {
        const target = focusedPaneId ?? termPanes[termPanes.length - 1]?.id;
        if (target && termPanes.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          closeTermPane(target);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const idx = termPanes.findIndex((p) => p.id === focusedPaneId);
        const cur = idx === -1 ? termPanes.length - 1 : idx;
        const next = e.key === 'ArrowRight' ? Math.min(termPanes.length - 1, cur + 1) : Math.max(0, cur - 1);
        const target = termPanes[next];
        if (target && next !== cur) {
          e.preventDefault();
          e.stopPropagation();
          setFocusedPaneId(target.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [view, termPanes, focusedPaneId, splitPane, closeTermPane]);

  // Dragging a divider moves share between its two neighbours. The
  // drag is measured against the sizes at drag start, so a fast drag
  // never drifts; each pane keeps at least 10% of the width.
  const onDividerPointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const container = (e.target as HTMLElement).closest('.terminal-panes') as HTMLElement | null;
    if (!container) return;
    const width = container.getBoundingClientRect().width;
    if (width <= 0) return;
    dividerDragRef.current = { index, startX: e.clientX, width, start: termSizes };
    const onMove = (ev: PointerEvent) => {
      const drag = dividerDragRef.current;
      if (!drag) return;
      const delta = (ev.clientX - drag.startX) / drag.width;
      setTermSizes((sizes) => {
        const next = [...drag.start];
        const a = next[drag.index];
        const b = next[drag.index + 1];
        if (a === undefined || b === undefined) return sizes;
        const min = 0.1;
        const clamped = Math.max(-(a - min), Math.min(b - min, delta));
        next[drag.index] = a + clamped;
        next[drag.index + 1] = b - clamped;
        return next;
      });
    };
    const onUp = () => {
      dividerDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const selected = useMemo(
    () =>
      (selectedId ? (trailDetails[selectedId] ?? trails.find((t) => t.id === selectedId)) : undefined) ?? trails[0],
    [trails, trailDetails, selectedId],
  );

  // Trails stay an Entire thing: native (et/) projects group under
  // Trails, GitHub-mirrored (gh/) projects under their own GitHub
  // section — one group per project slug, in settings order.
  const trailGroups = useMemo(() => {
    const order: string[] = [];
    const byProject = new Map<string, Trail[]>();
    for (const t of trails) {
      const group = byProject.get(t.project);
      if (group) group.push(t);
      else {
        byProject.set(t.project, [t]);
        order.push(t.project);
      }
    }
    const et = order.filter((p) => !p.startsWith('gh/')).map((p) => ({ project: p, trails: byProject.get(p) ?? [] }));
    const gh = order.filter((p) => p.startsWith('gh/')).map((p) => ({ project: p, trails: byProject.get(p) ?? [] }));
    return { et, gh };
  }, [trails]);

  const renderTrailGroup = (project: string, group: Trail[]) => (
    <div key={project} className="trail-group">
      <h3 className="t-project">{project}</h3>
      {group.map((t) => (
        <button
          key={t.id}
          className={`trail-row ${selected?.id === t.id && view === 'trail' ? 'active' : ''}`}
          onClick={() => selectTrail(t.id)}
        >
          <div className="t-title">
            {t.title}
            <span className={`pill ${STATUS_PILL[t.status] ?? 'cyan'}`}>{t.status}</span>
          </div>
          <div className="t-meta">{[t.repo, t.agent, t.phase].filter(Boolean).join(' · ')}</div>
        </button>
      ))}
    </div>
  );

  // The GitHub view groups PRs and issues by repo, in settings
  // order — one group per owner/repo slug, with the local checkout's
  // branch status under the header when one maps to it.
  const ghGroups = useMemo(() => {
    const order: string[] = [];
    const byRepo = new Map<string, { prs: GitHubPR[]; issues: GitHubIssue[] }>();
    const ensure = (repo: string) => {
      let g = byRepo.get(repo);
      if (!g) {
        g = { prs: [], issues: [] };
        byRepo.set(repo, g);
        order.push(repo);
      }
      return g;
    };
    for (const p of prs) ensure(p.repo).prs.push(p);
    for (const i of issues) ensure(i.repo).issues.push(i);
    const configured = settings.github.repos;
    order.sort((a, b) => {
      const ia = configured.indexOf(a);
      const ib = configured.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return order.map((repo) => ({
      repo,
      prs: byRepo.get(repo)?.prs ?? [],
      issues: byRepo.get(repo)?.issues ?? [],
      status: statuses.find((s) => s.repo === repo) ?? null,
    }));
  }, [prs, issues, statuses, settings.github.repos]);

  const renderGhGroup = (group: { repo: string; prs: GitHubPR[]; issues: GitHubIssue[]; status: RepoStatus | null }) => (
    <div key={group.repo} className="trail-group">
      <h3 className="t-project">{group.repo}</h3>
      {group.status && (
        <p className="gh-status">
          {group.status.branch}
          {group.status.ahead > 0 || group.status.behind > 0
            ? ` · ↑${group.status.ahead} ↓${group.status.behind}`
            : ' · up to date'}
          {group.status.dirty > 0 ? ` · ${group.status.dirty} changed` : ' · clean'}
        </p>
      )}
      {group.prs.map((p) => (
        <button
          key={p.id}
          className={`trail-row ${selectedGhId === p.id && view === 'trail' && forge === 'github' ? 'active' : ''}`}
          onClick={() => selectGh(p.id)}
        >
          <div className="t-title">
            {p.title}
            <span className={`pill ${CHECK_PILL[p.checks] ?? 'cyan'}`}>checks: {p.checks}</span>
          </div>
          <div className="t-meta">
            {`#${p.number} · ${p.author} · ${p.headRef} → ${p.baseRef}`}
            {p.reviewDecision ? ` · ${p.reviewDecision.toLowerCase().replaceAll('_', ' ')}` : ''}
            {p.draft ? ' · draft' : ''}
          </div>
        </button>
      ))}
      {group.issues.map((i) => (
        <button
          key={i.id}
          className={`trail-row ${selectedGhId === i.id && view === 'trail' && forge === 'github' ? 'active' : ''}`}
          onClick={() => selectGh(i.id)}
        >
          <div className="t-title">
            {i.title}
            <span className="pill cyan">{i.state}</span>
          </div>
          <div className="t-meta">
            {`#${i.number} · ${i.author}`}
            {i.labels.length > 0 ? ` · ${i.labels.join(', ')}` : ''}
            {i.assignees.length > 0 ? ` · → ${i.assignees.join(', ')}` : ''}
          </div>
        </button>
      ))}
      {group.prs.length === 0 && group.issues.length === 0 && <p className="note">No open PRs or issues.</p>}
    </div>
  );

  // The selected GitHub item's fuller detail, when fetched — else the
  // thin list row, so the view still shows something while the
  // detail call is in flight.
  const selectedGh = useMemo(
    () =>
      selectedGhId
        ? (ghPRDetails[selectedGhId] ??
          ghIssueDetails[selectedGhId] ??
          prs.find((p) => p.id === selectedGhId) ??
          issues.find((i) => i.id === selectedGhId))
        : undefined,
    [selectedGhId, ghPRDetails, ghIssueDetails, prs, issues],
  );

  // The selected Linear issue's fuller detail, when fetched — else
  // the thin list row. The list row has no description (the list
  // truncates it), so the detail view waits for `get_issue` instead
  // of showing a cut-off paragraph.
  const selectedLin = useMemo(
    () =>
      selectedLinId
        ? (linDetails[selectedLinId] ?? linIssues.find((i) => i.id === selectedLinId))
        : undefined,
    [selectedLinId, linDetails, linIssues],
  );

  // The selected note: the full detail when it has loaded, else the
  // thin list row (title + source + link) so the pane is never
  // empty while the fetch is in flight.
  const selectedNote = useMemo(() => {
    if (!selectedNoteId) return null;
    const full = noteDetails[selectedNoteId];
    if (full) return full;
    const row = notes.find((n) => n.id === selectedNoteId);
    if (!row) return null;
    return { ...row, content: '' } as NoteDetail;
  }, [selectedNoteId, noteDetails, notes]);

  // Dragging the sidebar's right edge resizes it. The width is
  // clamped live and saved when the drag ends, so it sticks.
  const onSidebarPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    const onMove = (ev: PointerEvent) => {
      const drag = sidebarDragRef.current;
      if (!drag) return;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, drag.startWidth + (ev.clientX - drag.startX)));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      sidebarDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        window.localStorage.setItem('halo.sidebarWidth', String(sidebarWidthRef.current));
      } catch {
        // Private mode or no storage — the width just doesn't stick.
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const activeAgent = useMemo(
    () => herdr?.agents.find((a) => a.paneId === settings.activeAgentPaneId) ?? herdr?.agents[0] ?? null,
    [herdr, settings.activeAgentPaneId],
  );

  // The sidebar dot for a forge: green is signed in, amber is
  // installed but not signed in, grey is not installed (or the probe
  // has not run yet). Steady glow, never flashing.
  const dotFor = (f: 'entire' | 'github' | 'linear') => {
    const c = connections.find((x) => x.forge === f);
    const cls = !c ? 'grey' : c.state === 'connected' ? 'green' : c.state === 'not-authed' ? 'amber' : 'grey';
    return <span className={`conn-dot ${cls}`} title={c?.detail ?? 'Checking connection…'} />;
  };

  const headTitle =
    view === 'trail'
      ? forge === 'github'
        ? (selectedGh?.title ?? 'GitHub')
        : forge === 'linear'
          ? (selectedLin?.title ?? 'Linear')
          : (selected?.title ?? 'Trails')
      : view === 'terminal'
        ? 'Terminal'
        : view === 'chat'
          ? `Chat — ${activeAgent?.label ?? 'no agent'}`
          : view === 'notes'
            ? (selectedNote?.title ?? 'Notes')
            : 'Settings';

  return (
    <div className="shell">
      <aside
        className="sidebar"
        data-narrow={sidebarWidth < 260 ? 'true' : 'false'}
        style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}
      >
        <div className="brand">
          <h1>HALO</h1>
          <p className="tagline">your workspace, one live view</p>
        </div>
        <AgentSwitcher
          herdr={herdr}
          activePaneId={settings.activeAgentPaneId}
          onPick={(paneId) => {
            setSettings((s) => ({ ...s, activeAgentPaneId: paneId }));
            setView('chat');
          }}
          onRefresh={refreshHerdr}
          onSpawned={(paneId) => {
            refreshHerdr();
            setSettings((s) => ({ ...s, activeAgentPaneId: paneId }));
            setView('chat');
          }}
        />
        <div className="trail-list">
          <div className="forge-switch" role="tablist" aria-label="Forge">
            <button
              className={`forge-btn ${forge === 'entire' ? 'active' : ''}`}
              onClick={() => switchForge('entire')}
              title="Entire — Trails"
            >
              {dotFor('entire')}
              <EntireMark size={18} />
              <span className="f-label">Entire</span>
            </button>
            <button
              className={`forge-btn ${forge === 'github' ? 'active' : ''}`}
              onClick={() => switchForge('github')}
              title="GitHub — pull requests and issues"
            >
              {dotFor('github')}
              <GitHubMark size={18} />
              <span className="f-label">GitHub</span>
            </button>
            <button
              className={`forge-btn ${forge === 'linear' ? 'active' : ''}`}
              onClick={() => switchForge('linear')}
              title="Linear — issues"
            >
              {dotFor('linear')}
              <LinearMark size={18} />
              <span className="f-label">Linear</span>
            </button>
          </div>
          {forge === 'entire' && (
            <>
              <h2>Trails</h2>
              {trails.length === 0 && <p className="note">{trailsDetail || 'No trails yet.'}</p>}
              {trailGroups.et.map((g) => renderTrailGroup(g.project, g.trails))}
              {trailGroups.gh.length > 0 && <h2>GitHub</h2>}
              {trailGroups.gh.map((g) => renderTrailGroup(g.project, g.trails))}
            </>
          )}
          {forge === 'github' && (
            <>
              <h2>Pull requests &amp; issues</h2>
              {prs.length === 0 && issues.length === 0 && (
                <p className="note">{githubDetail || 'No PRs or issues yet.'}</p>
              )}
              {ghGroups.map((g) => renderGhGroup(g))}
            </>
          )}
          {forge === 'linear' && (
            <>
              <h2>Issues</h2>
              {linIssues.length === 0 && <p className="note">{linearDetail || 'No issues yet.'}</p>}
              {linIssues.map((i) => (
                <button
                  key={i.id}
                  className={`trail-row ${selectedLinId === i.id && view === 'trail' && forge === 'linear' ? 'active' : ''}`}
                  onClick={() => selectLin(i.id)}
                >
                  <div className="t-title">
                    {i.title}
                    <span className={`pill ${LINEAR_PILL[i.statusType] ?? ''}`}>{i.status}</span>
                  </div>
                  <div className="t-meta">
                    {[i.id, i.priority ? `${i.priority} priority` : '', i.assignee ? `→ ${i.assignee}` : '', i.labels.join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
        <button
          className={`notes-btn ${view === 'notes' ? 'active' : ''}`}
          onClick={() => {
            setView('notes');
            refreshNotes();
          }}
          title="Notes — Notion and Obsidian, in one place"
        >
          ✎ Notes
        </button>
        <button className="sidebar-foot" onClick={refreshHerdr} title="Refresh herdr agents">
          <span className={`status-light ${herdr ? (herdr.installed ? (herdr.agents.length ? 'green' : 'amber') : 'gray') : 'gray'}`}>●</span>
          {herdr ? (herdr.installed ? `herdr · ${herdr.agents.length} agent${herdr.agents.length === 1 ? '' : 's'}` : 'herdr not detected') : 'herdr…'}
          <span className="foot-refresh"> ↻</span>
        </button>
        {deadPanes.length > 0 && (
          <button
            className="reconnect-all"
            onClick={() => setReconnectAllSignal((s) => s + 1)}
            title="Re-spawn every terminal pane whose shell has exited — after a herdr restart, this brings them all back at once"
          >
            ↻ Reconnect all ({deadPanes.length})
          </button>
        )}
      </aside>
      <div
        className="sidebar-divider"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        title="Drag to resize the sidebar"
        onPointerDown={onSidebarPointerDown}
      />

      <main className="main">
        <div className="main-head">
          <h2>{headTitle}</h2>
          <button
            className={`icon-btn ${view === 'trail' ? 'active' : ''}`}
            onClick={() => {
              setView('trail');
              if (forge === 'github') refreshGitHub();
              else if (forge === 'linear') refreshLinear();
              else refreshTrails();
            }}
          >
            {forge === 'github' ? 'GitHub' : forge === 'linear' ? 'Linear' : 'Trails'}
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
          <button
            className={`icon-btn ${view === 'notes' ? 'active' : ''}`}
            onClick={() => {
              setView('notes');
              refreshNotes();
            }}
          >
            ✎ Notes
          </button>
          <button className={`icon-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            ⚙ Settings
          </button>
        </div>
        {view === 'trail' && forge === 'entire' && selected && <TrailView trail={selected} />}
        {view === 'trail' && forge === 'entire' && !selected && (
          <TrailsEmpty onOpenTerminal={() => setView('terminal')} detail={trailsDetail} />
        )}
        {view === 'trail' && forge === 'github' && selectedGh && 'checks' in selectedGh && (
          <GitHubPRView pr={selectedGh} loadNote={ghDetailNote} />
        )}
        {view === 'trail' && forge === 'github' && selectedGh && !('checks' in selectedGh) && (
          <GitHubIssueView issue={selectedGh} loadNote={ghDetailNote} />
        )}
        {view === 'trail' && forge === 'github' && !selectedGh && <GitHubEmpty detail={githubDetail} />}
        {view === 'trail' && forge === 'linear' && selectedLin && (
          <LinearIssueView issue={selectedLin} loadNote={linDetailNote} />
        )}
        {view === 'trail' && forge === 'linear' && !selectedLin && <LinearEmpty detail={linearDetail} />}
        {view === 'notes' && (
          <NotesView
            notes={notes}
            detail={notesDetail}
            selected={selectedNote}
            loadNote={
              selectedNoteId && !noteDetails[selectedNoteId] ? noteDetailNote || 'Loading…' : noteDetailNote
            }
            notionReady={Boolean(settings.notes.notionToken)}
            obsidianReady={Boolean(settings.notes.obsidianPath.trim())}
            onSelect={selectNote}
            onRefresh={refreshNotes}
            onCreate={createNote}
          />
        )}
        {chatMounted && (
          <div className={`chat-view ${view === 'chat' ? '' : 'hidden'}`}>
            <ChatView
              herdr={herdr}
              activePaneId={settings.activeAgentPaneId}
              onPickAgent={(paneId) => setSettings((s) => ({ ...s, activeAgentPaneId: paneId }))}
              skipReadPaneIds={attachedPanes}
              onAttachState={onAttachState}
              onExitState={onExitState}
              reconnectSignal={reconnectAllSignal}
              fontSize={settings.terminal.fontSize}
            />
          </div>
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            herdr={herdr}
            connections={connections}
            onRefreshHerdr={refreshHerdr}
            onResetSidebarWidth={resetSidebarWidth}
            onRefreshConnections={refreshConnections}
            onInstall={(tool) =>
              window.halo
                ? window.halo.installTool(tool)
                : Promise.resolve({ ok: false, detail: 'No Electron bridge (browser preview).' })
            }
            onConnect={openSetupTerminal}
            onListNotionDatabases={() =>
              window.halo
                ? window.halo.listNotionDatabases()
                : Promise.resolve({ databases: [], problem: 'No Electron bridge (browser preview).' })
            }
          />
        )}
        {termMounted && (
          <div className={`terminal-view ${view === 'terminal' ? '' : 'hidden'}`}>
            <div className="terminal-toolbar">
              <button className="icon-btn" onClick={() => splitPane()} title="Split the focused pane (Ctrl+Shift+D)">
                ＋ Split
              </button>
              <button className="icon-btn" onClick={() => addTermPane('herdr')} title="Boot the herdr TUI in a new pane">
                ▤ Open herdr
              </button>
              <span className="note">Panes stay alive when you switch tabs. “Open herdr” boots the herdr TUI in a pane. Shortcuts: Ctrl+Shift+D split · Ctrl+Shift+Q close pane · Ctrl+Shift+←/→ move between panes. Right-click a pane for more.</span>
            </div>
            <div className="terminal-panes">
              <Suspense
                fallback={
                  <div className="main-body">
                    <p className="empty">Loading terminal…</p>
                  </div>
                }
              >
                {termPanes.map((p, i) => (
                  <Fragment key={p.id}>
                    {i > 0 && (
                      <div
                        className="term-divider"
                        role="separator"
                        aria-label={`Resize ${termPanes[i - 1]?.title ?? 'pane'} and ${p.title}`}
                        onPointerDown={onDividerPointerDown(i - 1)}
                      />
                    )}
                    <TerminalPanel
                      pane={p}
                      onClose={termPanes.length > 1 ? () => closeTermPane(p.id) : undefined}
                      style={{ flexGrow: termSizes[i] ?? 1, flexBasis: 0 }}
                      fontSize={settings.terminal.fontSize}
                      onAttachState={onAttachState}
                      onExitState={onExitState}
                      reconnectSignal={reconnectAllSignal}
                      focused={focusedPaneId === p.id}
                      onFocus={onPaneFocus}
                      onContextMenu={(e, paneId) => {
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY, paneId });
                      }}
                    />
                  </Fragment>
                ))}
              </Suspense>
            </div>
          </div>
        )}
      </main>
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="ctx-menu"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 180),
            top: Math.min(ctxMenu.y, window.innerHeight - 110),
          }}
          role="menu"
        >
          <button
            role="menuitem"
            onClick={() => {
              splitPane(ctxMenu.paneId);
              setCtxMenu(null);
            }}
          >
            Split right <span className="ctx-key">Ctrl+Shift+D</span>
          </button>
          <button
            role="menuitem"
            disabled={termPanes.length <= 1}
            onClick={() => {
              closeTermPane(ctxMenu.paneId);
              setCtxMenu(null);
            }}
          >
            Close pane <span className="ctx-key">Ctrl+Shift+Q</span>
          </button>
        </div>
      )}
    </div>
  );
}
