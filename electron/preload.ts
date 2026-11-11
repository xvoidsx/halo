import { contextBridge, ipcRenderer } from 'electron';
import type { HaloSettings, HerdrState, Trail } from '../src/types.js';

// Minimal, typed bridge. The renderer never touches Node or Electron
// directly — everything goes through these invoke channels.
contextBridge.exposeInMainWorld('halo', {
  getSettings: (): Promise<HaloSettings> => ipcRenderer.invoke('halo:getSettings'),
  saveSettings: (next: HaloSettings): Promise<{ ok: true; path: string }> =>
    ipcRenderer.invoke('halo:saveSettings', next),
  listTrails: (): Promise<{ mock: boolean; trails: Trail[] }> => ipcRenderer.invoke('halo:listTrails'),
  getTrail: (id: string): Promise<{ mock: boolean; trail: Trail | null }> =>
    ipcRenderer.invoke('halo:getTrail', id),
  herdrStatus: (): Promise<HerdrState> => ipcRenderer.invoke('halo:herdrStatus'),
  listTrailsLive: (): Promise<{ status: string; todo: string }> => ipcRenderer.invoke('halo:listTrailsLive'),
  watchTrail: (id: string): Promise<{ status: string; todo: string }> =>
    ipcRenderer.invoke('halo:watchTrail', id),
});
