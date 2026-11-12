// Halo settings file — local only, never synced, never sent anywhere.
// Lives at ~/.config/halo/settings.json, mode 0600, because the BYOK
// section may hold provider API keys. Treat this file like agents.env:
// user-owned secrets, local disk only.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EntireConfig, GitHubConfig, HaloSettings, LinearConfig, NotesConfig } from '../src/types.js';
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

/** The Linear section holds a `team` string (the team key or name,
 * e.g. 'xvoidsx') plus an optional `apiKey` — a personal API key
 * used only when the `linear` connector CLI is not available. A
 * stray type falls back to the default team and an empty key —
 * never a crash, never an invented filter. */
function normalizeLinear(raw: unknown): LinearConfig {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as { team?: unknown; apiKey?: unknown };
  return {
    team: typeof rec.team === 'string' && rec.team.trim() ? rec.team.trim() : 'xvoidsx',
    apiKey: typeof rec.apiKey === 'string' ? rec.apiKey.trim() : '',
  };
}

/** The Notes section holds three optional strings: a Notion
 * integration token, the Notion database new notes push to, and a
 * local Obsidian vault path. Anything non-string falls back to
 * empty — an empty Notes section just means nothing is wired up. */
function normalizeNotes(raw: unknown): NotesConfig {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    notionToken?: unknown;
    notionDatabaseId?: unknown;
    obsidianPath?: unknown;
  };
  return {
    notionToken: typeof rec.notionToken === 'string' ? rec.notionToken.trim() : '',
    notionDatabaseId: typeof rec.notionDatabaseId === 'string' ? rec.notionDatabaseId.trim() : '',
    obsidianPath: typeof rec.obsidianPath === 'string' ? rec.obsidianPath.trim() : '',
  };
}

/** The GitHub section holds a `repos` list of owner/repo slugs.
 * Anything else in the slot (a stray string, a null) falls back to
 * the empty list — never a crash, never invented repos. */
function normalizeGitHub(raw: unknown): GitHubConfig {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as { repos?: unknown };
  if (Array.isArray(rec.repos)) {
    const list = rec.repos
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim())
      .filter(Boolean);
    return { repos: [...new Set(list)] };
  }
  return { repos: [] };
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
      github: normalizeGitHub(parsed.github),
      linear: normalizeLinear(parsed.linear),
      notes: normalizeNotes(parsed.notes),
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
