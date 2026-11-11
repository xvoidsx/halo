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
  scores: EvalScores;
  findings: Finding[];
  sessions: Checkpoint[];
  gates: Gate[];
  /** Most recent first, max five. */
  runs: TrailRun[];
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

/** One line in an agent chat. 'you' is text Raven typed; 'agent' is text
 * read back from the agent's pane via `herdr agent read`; 'system' is
 * Halo itself (errors, state changes). Agent text is never invented. */
export interface ChatMessage {
  id: string;
  at: string;
  from: 'you' | 'agent' | 'system';
  text: string;
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

export interface HaloSettings {
  repos: RepoEntry[];
  activeRepoId: string | null;
  activeAgentPaneId: string | null;
  ollama: OllamaConfig;
  byok: {
    openai: ProviderConfig;
    anthropic: ProviderConfig;
    openrouter: ProviderConfig;
    deepseek: ProviderConfig;
  };
}

export const defaultSettings: HaloSettings = {
  repos: [],
  activeRepoId: null,
  activeAgentPaneId: null,
  ollama: { baseUrl: 'http://127.0.0.1:11434', defaultModel: 'qwen3:8b' },
  byok: {
    openai: { apiKey: '', enabled: false },
    anthropic: { apiKey: '', enabled: false },
    openrouter: { apiKey: '', enabled: false },
    deepseek: { apiKey: '', enabled: false },
  },
};
