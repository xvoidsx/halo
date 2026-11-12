// Halo shared types. Kept in src/ so both the renderer and the Electron
// main process (via import from the built bundle's types) agree on shape.
// Trail data comes from Entire Trails; until a trail exists the list
// is empty — no placeholder data anywhere in the app.

export type TrailStatus = 'running' | 'review' | 'green' | 'blocked' | 'merged';

export interface EvalScores {
  /** 0-100, higher is better. */
  security: number;
  /** 0-100, lower is better (less slop). */
  slop: number;
  /** 0-100. */
  humanReview: number;
  /** 0-100, overall confidence in the trail. */
  confidence: number;
  /** 'low' | 'medium' | 'high'. */
  risk: 'low' | 'medium' | 'high';
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'open' | 'addressing' | 'fixed' | 'dismissed';

export interface Finding {
  id: string;
  severity: FindingSeverity;
  status: FindingStatus;
  file?: string;
  message: string;
  suggestedFix: string;
}

export interface Checkpoint {
  id: string;
  at: string;
  agent: string;
  kind: 'prompt' | 'commit' | 'review' | 'note';
  summary: string;
}

export interface Gate {
  name: string;
  status: 'approved' | 'pending' | 'blocked';
  by?: string;
}

export interface TrailRun {
  id: string;
  at: string;
  status: 'green' | 'amber' | 'red';
  security: number;
  slop: number;
  humanReview: number;
}

export interface Trail {
  id: string;
  title: string;
  repo: string;
  branch: string;
  status: TrailStatus;
  agent: string;
  /** Entire project slug this trail came from, e.g. 'et/xvoidsx'
   * or 'gh/rav3ndust' — the sidebar groups by it, and the detail
   * fetch needs it back. */
  project: string;
  /** Workflow phase from the Entire API (e.g. "planning") — the
   * list carries it; absent on shapes that don't. */
  phase?: string;
  /** Link to the trail on entire.com, when the API returns one
   * (the show object carries `url`). */
  url?: string;
  /** Null when no eval has scored the trail yet — the UI says so
   * instead of showing invented numbers. */
  scores: EvalScores | null;
  findings: Finding[];
  sessions: Checkpoint[];
  gates: Gate[];
  /** Most recent first, max five. */
  runs: TrailRun[];
}

/** Result of `entire trail list --json`: the trails plus an honest
 * human-readable note for when the list is empty or failed. */
export interface TrailListResult {
  trails: Trail[];
  detail: string;
}

/** Result of `entire trail show --json` for one trail. */
export interface TrailDetailResult {
  trail: Trail | null;
  detail: string;
}

export type AgentStatus = 'running' | 'idle' | 'not-detected' | 'error';

export interface HerdrAgent {
  /** herdr pane_id — the always-addressable target. */
  paneId: string;
  /** Detected agent label, e.g. 'pi'. Display only. */
  label: string;
  status: AgentStatus;
  detail?: string;
}

export interface HerdrState {
  installed: boolean;
  detail: string;
  agents: HerdrAgent[];
}

/** Result of sending a message to a herdr agent by pane_id. */
export interface AgentSendResult {
  ok: boolean;
  detail: string;
}

/** Result of reading a herdr agent's pane output by pane_id. `output` is
 * raw terminal text from `herdr agent read` — plain text, not JSON. */
export interface AgentReadResult {
  ok: boolean;
  paneId: string;
  output: string;
  detail: string;
}

/** Result of spawning an in-app terminal shell. */
export interface TermSpawnResult {
  ok: boolean;
  id?: string;
  detail: string;
}

/** Result of a terminal write / resize / kill. */
export interface TermOpResult {
  ok: boolean;
  detail: string;
}

/** A GitHub pull request, mapped from `gh pr list/view --json`.
 * Fields verified against the real `gh` 2.102.0 help (JSON FIELDS
 * list, 2026-11-12): number, title, state, author, url, headRefName,
 * baseRefName, isDraft, reviewDecision, statusCheckRollup, additions,
 * deletions, changedFiles, comments, reviews, labels, createdAt, body. */
export type GitHubCheckState = 'passing' | 'failing' | 'pending' | 'none';

export interface GitHubPR {
  /** `pr-<owner>/<repo>-<number>` — unique across repos. */
  id: string;
  /** owner/repo */
  repo: string;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  url: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  checks: GitHubCheckState;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or '' when none. */
  reviewDecision: string;
  additions: number;
  deletions: number;
  labels: string[];
  createdAt: string;
}

export interface GitHubPRDetail extends GitHubPR {
  body: string;
  comments: number;
  changedFiles: number;
}

export interface GitHubIssue {
  /** `issue-<owner>/<repo>-<number>` */
  id: string;
  /** owner/repo */
  repo: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string;
  url: string;
  labels: string[];
  assignees: string[];
  createdAt: string;
}

export interface GitHubIssueDetail extends GitHubIssue {
  body: string;
  comments: number;
}

/** Branch status of one local checkout, from `git status
 * --porcelain=v2 --branch`. Read-only: ahead/behind counts and a
 * dirty-file count, never a push or pull (those are a later build,
 * once the read-only view has proven itself). */
export interface RepoStatus {
  /** owner/repo, from the origin remote. */
  repo: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
  /** '' when the status is live, else why it is not. */
  detail: string;
}

export interface GitHubListResult {
  prs: GitHubPR[];
  issues: GitHubIssue[];
  statuses: RepoStatus[];
  detail: string;
}

export interface GitHubPRDetailResult {
  pr: GitHubPRDetail | null;
  detail: string;
}

export interface GitHubIssueDetailResult {
  issue: GitHubIssueDetail | null;
  detail: string;
}

export interface RepoEntry {
  id: string;
  name: string;
  path: string;
}

export interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
}

export interface ProviderConfig {
  /** Stored locally in ~/.config/halo/settings.json (0600). Empty = not configured. */
  apiKey: string;
  enabled: boolean;
}

export interface TerminalConfig {
  /** Terminal font size in px. 13 is the default; 11–16 covers the
   * small-screen bench machines and the big-monitor setups alike. */
  fontSize: number;
}

export interface EntireConfig {
  /** Entire projects for the Trails list, e.g. 'et/xvoidsx' and
   * 'gh/rav3ndust'. `entire trail list` requires --project, so the
   * list stays empty until at least one is set. Empty = not
   * configured. Trails stay an Entire thing: native (et/) projects
   * list under Trails, GitHub-mirrored (gh/) ones under their own
   * GitHub section. */
  projects: string[];
}

export interface GitHubConfig {
  /** GitHub repos for the PR/issue lists, e.g. 'xvoidsx/halo'.
   * `gh pr list` / `gh issue list` need --repo, so the lists stay
   * empty until at least one is set. Empty = not configured. */
  repos: string[];
}

export interface HaloSettings {
  repos: RepoEntry[];
  activeRepoId: string | null;
  activeAgentPaneId: string | null;
  ollama: OllamaConfig;
  entire: EntireConfig;
  github: GitHubConfig;
  terminal: TerminalConfig;
  byok: {
    openai: ProviderConfig;
    anthropic: ProviderConfig;
    openrouter: ProviderConfig;
    deepseek: ProviderConfig;
    groq: ProviderConfig;
    mistral: ProviderConfig;
    huggingface: ProviderConfig;
    gemini: ProviderConfig;
    xai: ProviderConfig;
    venice: ProviderConfig;
    trustedrouter: ProviderConfig;
  };
}

export const defaultSettings: HaloSettings = {
  repos: [],
  activeRepoId: null,
  activeAgentPaneId: null,
  ollama: { baseUrl: 'http://127.0.0.1:11434', defaultModel: 'qwen3:8b' },
  entire: { projects: [] },
  github: { repos: [] },
  terminal: { fontSize: 13 },
  byok: {
    openai: { apiKey: '', enabled: false },
    anthropic: { apiKey: '', enabled: false },
    openrouter: { apiKey: '', enabled: false },
    deepseek: { apiKey: '', enabled: false },
    groq: { apiKey: '', enabled: false },
    mistral: { apiKey: '', enabled: false },
    huggingface: { apiKey: '', enabled: false },
    gemini: { apiKey: '', enabled: false },
    xai: { apiKey: '', enabled: false },
    venice: { apiKey: '', enabled: false },
    trustedrouter: { apiKey: '', enabled: false },
  },
};
