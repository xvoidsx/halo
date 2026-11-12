import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, settingsPath } from './settingsFile.js';
import { detectHerdr, getTrail, listTrails, readAgentOutput, sendAgentMessage, watchTrail } from './herdrAdapter.js';
import { TerminalManager } from './terminal.js';
import type { HaloSettings } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let win: BrowserWindow | null = null;

function createWindow(termManager: TerminalManager): void {
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

  // A dead renderer must not leave orphaned ptys behind. The old
  // panes never get to run their cleanup — a reload tears the JS
  // context down first, a crash never runs it at all — so an orphaned
  // `herdr agent attach` keeps holding its pane and every new attach
  // to it exits code 1 (double-attach). Kill them all when the
  // renderer goes away, in every shape that takes: a reload starts
  // loading a new renderer, a crash reports render-process-gone, and
  // a closed window destroys its webContents. The fresh renderer
  // re-spawns what it needs. (2026-11-11: a page reload left an
  // orphaned attach on w1:p1 and every later attach to it died.)
  win.webContents.on('did-start-loading', () => termManager.killAll());
  win.webContents.on('render-process-gone', () => termManager.killAll());
  win.webContents.on('destroyed', () => termManager.killAll());

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
  // renderer; input and resizes come back over IPC. The sends are
  // guarded by isDestroyed(): when the window closes, a pty can still
  // flush a final data chunk (or an exit) after the webContents is
  // destroyed but before killAll() has run — sending to a destroyed
  // webContents throws "Object has been destroyed" as an uncaught
  // main-process exception, which is the error dialog on close
  // (2026-11-12, Raven's bench). The check and the send are in one
  // synchronous block, so the window cannot be destroyed between them.
  const termManager = new TerminalManager(
    (id, data) => {
      if (win && !win.webContents.isDestroyed()) {
        win.webContents.send('halo:term-data', { id, data });
      }
    },
    (id, code) => {
      if (win && !win.webContents.isDestroyed()) {
        win.webContents.send('halo:term-exit', { id, code });
      }
    },
  );
  ipcMain.handle('halo:term-spawn', (_e, repoId: string, cwd: string, cols: number, rows: number, command?: string) =>
    termManager.spawn(repoId, cwd, cols, rows, command),
  );
  ipcMain.handle('halo:term-write', (_e, id: string, data: string) => termManager.write(id, data));
  ipcMain.handle('halo:term-resize', (_e, id: string, cols: number, rows: number) =>
    termManager.resize(id, cols, rows),
  );
  ipcMain.handle('halo:term-kill', (_e, id: string) => termManager.kill(id));

  // Settings: local file only, never leaves the machine.
  ipcMain.handle('halo:getVersion', (): string => app.getVersion());
  ipcMain.handle('halo:getSettings', (): HaloSettings => loadSettings());
  ipcMain.handle('halo:saveSettings', (_e, next: HaloSettings): { ok: true; path: string } => {
    saveSettings(next);
    return { ok: true, path: settingsPath() };
  });

  // Trails: live from the Entire CLI (see herdrAdapter.ts). The project
  // comes from Settings → Entire Trails; without it the list is empty
  // with a detail that says why — never placeholder data.
  ipcMain.handle('halo:listTrails', () => listTrails(loadSettings().entire.project.trim()));
  ipcMain.handle('halo:getTrail', (_e, id: string) => getTrail(id, loadSettings().entire.project.trim()));

  // Herdr: real detection via the herdr CLI; trail watching is a stub
  // until `entire trail watch --json` streaming lands.
  ipcMain.handle('halo:herdrStatus', () => detectHerdr());
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

  createWindow(termManager);
  console.log('[halo] ready — dev server:', isDev ? process.env.VITE_DEV_SERVER_URL : '(built dist)');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(termManager);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
