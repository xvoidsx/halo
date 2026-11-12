import type {
  AgentReadResult,
  AgentSendResult,
  HaloSettings,
  HerdrState,
  TermOpResult,
  TermSpawnResult,
  TrailDetailResult,
  TrailListResult,
} from './types';

declare global {
  interface Window {
    halo?: {
      getVersion: () => Promise<string>;
      getSettings: () => Promise<HaloSettings>;
      saveSettings: (next: HaloSettings) => Promise<{ ok: true; path: string }>;
      listTrails: () => Promise<TrailListResult>;
      getTrail: (id: string, project: string) => Promise<TrailDetailResult>;
      herdrStatus: () => Promise<HerdrState>;
      watchTrail: (id: string) => Promise<{ status: string; todo: string }>;
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
