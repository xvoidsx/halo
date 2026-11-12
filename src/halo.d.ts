import type {
  AgentReadResult,
  AgentSendResult,
  ConnectionStatus,
  GitHubIssueDetailResult,
  GitHubListResult,
  GitHubPRDetailResult,
  HaloSettings,
  HerdrState,
  InstallResult,
  LinearIssueDetailResult,
  LinearListResult,
  NoteDetailResult,
  NotesListResult,
  NotionDatabase,
  SpawnResult,
  SpawnableAgent,
  TermOpResult,
  TermSpawnResult,
  ToolId,
  TrailDetailResult,
  TrailListResult,
  TrailWatchEvent,
  TrailWatchStatus,
} from './types';

declare global {
  interface Window {
    halo?: {
      getVersion: () => Promise<string>;
      getSettings: () => Promise<HaloSettings>;
      saveSettings: (next: HaloSettings) => Promise<{ ok: true; path: string }>;
      listTrails: () => Promise<TrailListResult>;
      getTrail: (id: string, project: string) => Promise<TrailDetailResult>;
      listGitHub: () => Promise<GitHubListResult>;
      getPR: (repo: string, number: number) => Promise<GitHubPRDetailResult>;
      getIssue: (repo: string, number: number) => Promise<GitHubIssueDetailResult>;
      listLinear: () => Promise<LinearListResult>;
      getLinearIssue: (id: string) => Promise<LinearIssueDetailResult>;
      herdrStatus: () => Promise<HerdrState>;
      startTrailWatch: () => Promise<TrailWatchStatus>;
      stopTrailWatch: () => Promise<{ ok: boolean }>;
      onTrailEvent: (cb: (ev: TrailWatchEvent) => void) => () => void;
      onTrailWatchStatus: (cb: (status: TrailWatchStatus) => void) => () => void;
      getSpawnableAgents: () => Promise<{ kinds: SpawnableAgent[]; defaultKind: string }>;
      spawnAgent: (kind: string) => Promise<SpawnResult>;
      getConnections: () => Promise<ConnectionStatus[]>;
      installTool: (tool: ToolId) => Promise<InstallResult>;
      listNotes: (query?: string) => Promise<NotesListResult>;
      getNote: (id: string) => Promise<NoteDetailResult>;
      createNote: (target: 'notion' | 'obsidian', title: string, body: string) => Promise<{ id: string; url: string; problem: string }>;
      listNotionDatabases: () => Promise<{ databases: NotionDatabase[]; problem: string }>;
      agentSend: (paneId: string, text: string) => Promise<AgentSendResult>;
      agentRead: (paneId: string, lines?: number) => Promise<AgentReadResult>;
      termSpawn: (repoId: string, cwd: string, cols: number, rows: number, command?: string) => Promise<TermSpawnResult>;
      termWrite: (id: string, data: string) => Promise<TermOpResult>;
      termResize: (id: string, cols: number, rows: number) => Promise<TermOpResult>;
      termKill: (id: string) => Promise<TermOpResult>;
      onTermData: (cb: (ev: { id: string; data: string }) => void) => () => void;
      onTermExit: (cb: (ev: { id: string; code: number }) => void) => () => void;
    };
  }
}

export {};
