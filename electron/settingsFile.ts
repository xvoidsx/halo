// Halo settings file — local only, never synced, never sent anywhere.
// Lives at ~/.config/halo/settings.json, mode 0600, because the BYOK
// section may hold provider API keys. Treat this file like agents.env:
// user-owned secrets, local disk only.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EntireConfig, HaloSettings } from '../src/types.js';
import { defaultSettings } from '../src/types.js';

const DIR = path.join(os.homedir(), '.config', 'halo');
const FILE = path.join(DIR, 'settings.json');

export function settingsPath(): string {
  return FILE;
}

/** The Entire section used to hold a single `project` string (0.7.0);
 * 0.8.0 holds a `projects` list. A file with the old shape migrates
 * in place — the old key is dropped on the next save. */
function normalizeEntire(raw: unknown): EntireConfig {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    projects?: unknown;
    project?: unknown;
  };
  if (Array.isArray(rec.projects)) {
    const list = rec.projects
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean);
    return { projects: [...new Set(list)] };
  }
  if (typeof rec.project === 'string' && rec.project.trim()) return { projects: [rec.project.trim()] };
  return { projects: [] };
}

export function loadSettings(): HaloSettings {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HaloSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      ollama: { ...defaultSettings.ollama, ...(parsed.ollama ?? {}) },
      entire: normalizeEntire(parsed.entire),
      terminal: { ...defaultSettings.terminal, ...(parsed.terminal ?? {}) },
      byok: {
        openai: { ...defaultSettings.byok.openai, ...(parsed.byok?.openai ?? {}) },
        anthropic: { ...defaultSettings.byok.anthropic, ...(parsed.byok?.anthropic ?? {}) },
        openrouter: { ...defaultSettings.byok.openrouter, ...(parsed.byok?.openrouter ?? {}) },
        deepseek: { ...defaultSettings.byok.deepseek, ...(parsed.byok?.deepseek ?? {}) },
        groq: { ...defaultSettings.byok.groq, ...(parsed.byok?.groq ?? {}) },
        mistral: { ...defaultSettings.byok.mistral, ...(parsed.byok?.mistral ?? {}) },
        huggingface: { ...defaultSettings.byok.huggingface, ...(parsed.byok?.huggingface ?? {}) },
        gemini: { ...defaultSettings.byok.gemini, ...(parsed.byok?.gemini ?? {}) },
        xai: { ...defaultSettings.byok.xai, ...(parsed.byok?.xai ?? {}) },
        venice: { ...defaultSettings.byok.venice, ...(parsed.byok?.venice ?? {}) },
        trustedrouter: { ...defaultSettings.byok.trustedrouter, ...(parsed.byok?.trustedrouter ?? {}) },
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
