import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, settingsPath } from './settingsFile.js';
import { detectHerdr, listTrails, readAgentOutput, sendAgentMessage, watchTrail } from './herdrAdapter.js';
import { TerminalManager } from './terminal.js';
import type { HaloSettings } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    title: 'Halo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  win.webContents.on('did-finish-load', () => {
    console.log('[halo] renderer loaded');
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Terminal: node-pty shells, one per repo. Output streams to the
  // renderer; input and resizes come back over IPC.
  const termManager = new TerminalManager(
    (id, data) => {
      win?.webContents.send('halo:term-data', { id, data });
    },
    (id, code) => {
      win?.webContents.send('halo:term-exit', { id, code });
    },
  );
  ipcMain.handle('halo:term-spawn', (_e, repoId: string, cwd: string, cols: number, rows: number) =>
    termManager.spawn(repoId, cwd, cols, rows),
  );
  ipcMain.handle('halo:term-write', (_e, id: string, data: string) => termManager.write(id, data));
  ipcMain.handle('halo:term-resize', (_e, id: string, cols: number, rows: number) =>
    termManager.resize(id, cols, rows),
  );
  ipcMain.handle('halo:term-kill', (_e, id: string) => termManager.kill(id));

  // Settings: local file only, never leaves the machine.
  ipcMain.handle('halo:getSettings', (): HaloSettings => loadSettings());
  ipcMain.handle('halo:saveSettings', (_e, next: HaloSettings): { ok: true; path: string } => {
    saveSettings(next);
    return { ok: true, path: settingsPath() };
  });

  // Trails: no live source is wired up yet, so the list is empty — no
  // placeholder data is ever served. Wire listTrails() to the Entire
  // CLI once the first test trail exists (see herdrAdapter.ts).
  ipcMain.handle('halo:listTrails', () => ({ trails: [] }));
  ipcMain.handle('halo:getTrail', (_e, _id: string) => ({ trail: null }));

  // Herdr: real detection via the herdr CLI; everything else is a stub.
  ipcMain.handle('halo:herdrStatus', () => detectHerdr());
  ipcMain.handle('halo:listTrailsLive', () => listTrails());
  ipcMain.handle('halo:watchTrail', (_e, id: string) => watchTrail(id));

  // Agent chat: send + read by pane_id. Errors surface honestly — the
  // chat never invents a reply. Not yet verified on a machine with
  // herdr installed (see herdrAdapter.ts).
  ipcMain.handle('halo:agent-send', (_e, paneId: string, text: string) => sendAgentMessage(paneId, text));
  ipcMain.handle('halo:agent-read', (_e, paneId: string, lines?: number) =>
    readAgentOutput(paneId, lines ?? 120),
  );

  // No shell outlives Halo.
  app.on('before-quit', () => termManager.killAll());

  createWindow();
  console.log('[halo] ready — dev server:', isDev ? process.env.VITE_DEV_SERVER_URL : '(built dist)');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
