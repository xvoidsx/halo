import type { HaloSettings, HerdrState, Trail } from './types';

declare global {
  interface Window {
    halo?: {
      getSettings: () => Promise<HaloSettings>;
      saveSettings: (next: HaloSettings) => Promise<{ ok: true; path: string }>;
      listTrails: () => Promise<{ mock: boolean; trails: Trail[] }>;
      getTrail: (id: string) => Promise<{ mock: boolean; trail: Trail | null }>;
      herdrStatus: () => Promise<HerdrState>;
      listTrailsLive: () => Promise<{ status: string; todo: string }>;
      watchTrail: (id: string) => Promise<{ status: string; todo: string }>;
    };
  }
}

export {};
