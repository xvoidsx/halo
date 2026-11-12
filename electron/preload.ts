import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  AgentReadResult,
  AgentSendResult,
  GitHubIssueDetailResult,
  GitHubListResult,
  GitHubPRDetailResult,
  HaloSettings,
  HerdrState,
  TermOpResult,
  TermSpawnResult,
  TrailDetailResult,
  TrailListResult,
} from '../src/types.js';

// Minimal, typed bridge. The renderer never touches Node or Electron
// directly — everything goes through these invoke channels and the two
// event subscriptions below (terminal output / shell exit).
contextBridge.exposeInMainWorld('halo', {
  getVersion: (): Promise<string> => ipcRenderer.invoke('halo:getVersion'),
  getSettings: (): Promise<HaloSettings> => ipcRenderer.invoke('halo:getSettings'),
  saveSettings: (next: HaloSettings): Promise<{ ok: true; path: string }> =>
    ipcRenderer.invoke('halo:saveSettings', next),
  listTrails: (): Promise<TrailListResult> => ipcRenderer.invoke('halo:listTrails'),
  getTrail: (id: string, project: string): Promise<TrailDetailResult> =>
    ipcRenderer.invoke('halo:getTrail', id, project),
  listGitHub: (): Promise<GitHubListResult> => ipcRenderer.invoke('halo:listGitHub'),
  getPR: (repo: string, number: number): Promise<GitHubPRDetailResult> =>
    ipcRenderer.invoke('halo:getPR', repo, number),
  getIssue: (repo: string, number: number): Promise<GitHubIssueDetailResult> =>
    ipcRenderer.invoke('halo:getIssue', repo, number),
  herdrStatus: (): Promise<HerdrState> => ipcRenderer.invoke('halo:herdrStatus'),
  watchTrail: (id: string): Promise<{ status: string; todo: string }> =>
    ipcRenderer.invoke('halo:watchTrail', id),

  // Agent chat — by pane_id, never by bare label.
  agentSend: (paneId: string, text: string): Promise<AgentSendResult> =>
    ipcRenderer.invoke('halo:agent-send', paneId, text),
  agentRead: (paneId: string, lines?: number): Promise<AgentReadResult> =>
    ipcRenderer.invoke('halo:agent-read', paneId, lines),

  // In-app terminal — one shell per repo, cwd = the repo path.
  termSpawn: (repoId: string, cwd: string, cols: number, rows: number, command?: string): Promise<TermSpawnResult> =>
    ipcRenderer.invoke('halo:term-spawn', repoId, cwd, cols, rows, command),
  termWrite: (id: string, data: string): Promise<TermOpResult> => ipcRenderer.invoke('halo:term-write', id, data),
  termResize: (id: string, cols: number, rows: number): Promise<TermOpResult> =>
    ipcRenderer.invoke('halo:term-resize', id, cols, rows),
  termKill: (id: string): Promise<TermOpResult> => ipcRenderer.invoke('halo:term-kill', id),
  onTermData: (cb: (ev: { id: string; data: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string; data: string }) => cb(payload);
    ipcRenderer.on('halo:term-data', listener);
    return () => {
      ipcRenderer.removeListener('halo:term-data', listener);
    };
  },
  onTermExit: (cb: (ev: { id: string; code: number }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string; code: number }) => cb(payload);
    ipcRenderer.on('halo:term-exit', listener);
    return () => {
      ipcRenderer.removeListener('halo:term-exit', listener);
    };
  },
});
