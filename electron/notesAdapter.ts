// Notes — the orchestration over the two note sources. Notion is
// the shared layer (connector first, integration token second —
// see notionAdapter for which calls each transport can make);
// Obsidian is the local-first layer (a vault directory of .md files
// on disk, read and written directly, no auth at all).
//
// Notes are identified by a source-prefixed id: Notion pages keep
// their page id, Obsidian files are `obsidian:<filename>`. The list
// merges both sources newest-first; a source that is not configured
// is simply absent, and a source that fails says so in the detail
// instead of blanking the other one.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  NoteDetail,
  NoteDetailResult,
  NotesConfig,
  NotesListResult,
  NotionDatabase,
} from '../src/types.js';
import {
  createNotionPageApi,
  getNotionPageApi,
  listNotionDatabasesApi,
  listNotionDatabasesConnector,
  listRecentNotionConnector,
  searchNotionApi,
  searchNotionConnector,
} from './notionAdapter.js';

const OBSIDIAN_PREFIX = 'obsidian:';

function listObsidianNotes(vaultPath: string): { notes: import('../src/types.js').NoteItem[]; problem: string } {
  const dir = (vaultPath ?? '').trim();
  if (!dir) return { notes: [], problem: '' };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { notes: [], problem: `Obsidian vault not found: ${dir}` };
  }
  const notes = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      let mtime = 0;
      try {
        mtime = fs.statSync(path.join(dir, e.name)).mtimeMs;
      } catch {
        // A file that vanishes between readdir and stat is skipped
        // by leaving its mtime at 0 (it sorts last).
      }
      return {
        id: `${OBSIDIAN_PREFIX}${e.name}`,
        title: e.name.replace(/\.md$/, '') || e.name,
        source: 'obsidian' as const,
        updatedAt: mtime ? new Date(mtime).toISOString() : '',
        url: undefined,
      };
    })
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 20);
  return { notes, problem: '' };
}

export async function listNotes(cfg: NotesConfig, query = ''): Promise<NotesListResult> {
  const problems: string[] = [];
  const token = (cfg.notionToken ?? '').trim();
  const q = (query ?? '').trim();

  // Notion first: search when there is a query, recent pages when
  // there is not. Connector first, API token second.
  let notionNotes: import('../src/types.js').NoteItem[] = [];
  const conn = q ? await searchNotionConnector(q) : await listRecentNotionConnector();
  if (!conn.notFound && !conn.problem) {
    notionNotes = conn.notes;
  } else if (token) {
    const api = await searchNotionApi(q, token);
    if (!api.problem) notionNotes = api.notes;
    else problems.push(api.problem);
  } else if (conn.problem) {
    problems.push(conn.problem);
  }

  const { notes: obsidianNotes, problem: obsidianProblem } = listObsidianNotes(cfg.obsidianPath);
  if (obsidianProblem) problems.push(obsidianProblem);

  const notes = [...notionNotes, ...obsidianNotes].sort((a, b) =>
    (b.updatedAt || '').localeCompare(a.updatedAt || ''),
  );
  if (notes.length === 0 && problems.length === 0) {
    return {
      notes: [],
      detail:
        'No notes yet — connect Notion or point at an Obsidian vault in Settings → Notes, then write your first one here.',
    };
  }
  return { notes, detail: problems.join(' ') };
}

export async function getNote(id: string, cfg: NotesConfig): Promise<NoteDetailResult> {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return { note: null, detail: 'No note selected.' };
  if (trimmed.startsWith(OBSIDIAN_PREFIX)) {
    const filename = trimmed.slice(OBSIDIAN_PREFIX.length);
    // The id is a bare filename from our own list — never a path.
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return { note: null, detail: 'That note id is not a vault file.' };
    }
    const dir = (cfg.obsidianPath ?? '').trim();
    const file = path.join(dir, filename);
    try {
      const content = fs.readFileSync(file, 'utf8');
      const note: NoteDetail = {
        id: trimmed,
        title: filename.replace(/\.md$/, ''),
        source: 'obsidian',
        updatedAt: '',
        url: file,
        content,
      };
      return { note, detail: '' };
    } catch {
      return { note: null, detail: `Could not read ${file}.` };
    }
  }
  // Notion: the full page text only comes from the API. Without a
  // token the detail view still shows the title and the Open link.
  const token = (cfg.notionToken ?? '').trim();
  if (!token) {
    return {
      note: {
        id: trimmed,
        title: '(Notion page)',
        source: 'notion',
        updatedAt: '',
        url: `https://www.notion.so/${trimmed.replace(/-/g, '')}`,
        content: '',
      },
      detail: 'Add a Notion integration token in Settings → Notes to read the page inside Halo.',
    };
  }
  const page = await getNotionPageApi(trimmed, token);
  if (page.problem) return { note: null, detail: page.problem };
  return {
    note: {
      id: trimmed,
      title: page.title,
      source: 'notion',
      updatedAt: '',
      url: page.url || undefined,
      content: page.content,
    },
    detail: '',
  };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'note';
}

export async function createNote(
  target: 'notion' | 'obsidian',
  title: string,
  body: string,
  cfg: NotesConfig,
): Promise<{ id: string; url: string; problem: string }> {
  const t = (title ?? '').trim();
  const b = body ?? '';
  if (target === 'notion') {
    const token = (cfg.notionToken ?? '').trim();
    const databaseId = (cfg.notionDatabaseId ?? '').trim();
    if (!token) return { id: '', url: '', problem: 'Add a Notion integration token in Settings → Notes first.' };
    if (!databaseId) return { id: '', url: '', problem: 'Choose a target database in Settings → Notes first.' };
    return createNotionPageApi(databaseId, t, b, token);
  }
  const dir = (cfg.obsidianPath ?? '').trim();
  if (!dir) return { id: '', url: '', problem: 'Set an Obsidian vault path in Settings → Notes first.' };
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { id: '', url: '', problem: `Could not use the vault directory: ${dir}` };
  }
  let filename = `${slugify(t)}.md`;
  let n = 2;
  while (fs.existsSync(path.join(dir, filename))) {
    filename = `${slugify(t)}-${n}.md`;
    n += 1;
  }
  const file = path.join(dir, filename);
  try {
    fs.writeFileSync(file, b, { mode: 0o600 });
  } catch {
    return { id: '', url: '', problem: `Could not write ${file}.` };
  }
  return { id: `${OBSIDIAN_PREFIX}${filename}`, url: file, problem: '' };
}

export async function listNotionDatabases(cfg: NotesConfig): Promise<{ databases: NotionDatabase[]; problem: string }> {
  const token = (cfg.notionToken ?? '').trim();
  if (token) return listNotionDatabasesApi(token);
  const conn = await listNotionDatabasesConnector();
  if (conn.notFound) {
    return { databases: [], problem: 'notion-cli not found — add an integration token in Settings → Notes to list databases.' };
  }
  if (conn.problem) return { databases: [], problem: conn.problem };
  if (conn.databases.length === 0) {
    return {
      databases: [],
      problem: 'No databases among your recently viewed pages. Open a database in Notion first, or add an integration token for the full list.',
    };
  }
  return { databases: conn.databases, problem: '' };
}
