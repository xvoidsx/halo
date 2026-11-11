// Halo settings file — local only, never synced, never sent anywhere.
// Lives at ~/.config/halo/settings.json, mode 0600, because the BYOK
// section may hold provider API keys. Treat this file like agents.env:
// user-owned secrets, local disk only.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HaloSettings } from '../src/types.js';
import { defaultSettings } from '../src/types.js';

const DIR = path.join(os.homedir(), '.config', 'halo');
const FILE = path.join(DIR, 'settings.json');

export function settingsPath(): string {
  return FILE;
}

export function loadSettings(): HaloSettings {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HaloSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      ollama: { ...defaultSettings.ollama, ...(parsed.ollama ?? {}) },
      byok: {
        openai: { ...defaultSettings.byok.openai, ...(parsed.byok?.openai ?? {}) },
        anthropic: { ...defaultSettings.byok.anthropic, ...(parsed.byok?.anthropic ?? {}) },
        openrouter: { ...defaultSettings.byok.openrouter, ...(parsed.byok?.openrouter ?? {}) },
        deepseek: { ...defaultSettings.byok.deepseek, ...(parsed.byok?.deepseek ?? {}) },
      },
    };
  } catch {
    return structuredClone(defaultSettings);
  }
}

export function saveSettings(next: HaloSettings): void {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}
