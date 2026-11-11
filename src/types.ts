// Halo shared types. Kept in src/ so both the renderer and the Electron
// main process (via import from the built bundle's types) agree on shape.
// Trail data comes from Entire Trails in the real app; until a trail
// exists, the renderer uses mockTrails.ts (clearly labelled MOCK).

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
  /** Detected agent label, e.g. 'opencode'. Display only. */
  label: string;
  status: AgentStatus;
  detail?: string;
}

export interface HerdrState {
  installed: boolean;
  detail: string;
  agents: HerdrAgent[];
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
  },
};
