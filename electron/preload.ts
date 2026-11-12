import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
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
  listLinear: (): Promise<LinearListResult> => ipcRenderer.invoke('halo:listLinear'),
  getLinearIssue: (id: string): Promise<LinearIssueDetailResult> =>
    ipcRenderer.invoke('halo:getLinearIssue', id),
  herdrStatus: (): Promise<HerdrState> => ipcRenderer.invoke('halo:herdrStatus'),
  startTrailWatch: (): Promise<TrailWatchStatus> => ipcRenderer.invoke('halo:startTrailWatch'),
  stopTrailWatch: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('halo:stopTrailWatch'),
  onTrailEvent: (cb: (ev: TrailWatchEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TrailWatchEvent) => cb(payload);
    ipcRenderer.on('halo:trail-event', listener);
    return () => {
      ipcRenderer.removeListener('halo:trail-event', listener);
    };
  },
  onTrailWatchStatus: (cb: (status: TrailWatchStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TrailWatchStatus) => cb(payload);
    ipcRenderer.on('halo:trail-watch-status', listener);
    return () => {
      ipcRenderer.removeListener('halo:trail-watch-status', listener);
    };
  },

  // Spawning agents from the Agents dropdown.
  getSpawnableAgents: (): Promise<{ kinds: SpawnableAgent[]; defaultKind: string }> =>
    ipcRenderer.invoke('halo:getSpawnableAgents'),
  spawnAgent: (kind: string): Promise<SpawnResult> => ipcRenderer.invoke('halo:spawnAgent', kind),

  // Connections + installers — the sidebar dots and Settings buttons.
  getConnections: (): Promise<ConnectionStatus[]> => ipcRenderer.invoke('halo:getConnections'),
  installTool: (tool: ToolId): Promise<InstallResult> => ipcRenderer.invoke('halo:installTool', tool),

  // Notes — Notion + Obsidian.
  listNotes: (query?: string): Promise<NotesListResult> => ipcRenderer.invoke('halo:listNotes', query),
  getNote: (id: string): Promise<NoteDetailResult> => ipcRenderer.invoke('halo:getNote', id),
  createNote: (target: 'notion' | 'obsidian', title: string, body: string): Promise<{ id: string; url: string; problem: string }> =>
    ipcRenderer.invoke('halo:createNote', target, title, body),
  listNotionDatabases: (): Promise<{ databases: NotionDatabase[]; problem: string }> =>
    ipcRenderer.invoke('halo:listNotionDatabases'),

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
