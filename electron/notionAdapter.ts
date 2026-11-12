// Notion adapter — the boundary where Halo talks to Notion two ways:
//   1. the `notion-cli` connector CLI (Muse's MCP-backed `notion-cli`,
//      `/opt/hatch/bin/notion-cli`), exactly like the Linear side —
//      Halo never holds a Notion token, it rides the existing OAuth.
//   2. the public Notion REST API with an integration token from
//      Settings → Notes (notion.so/my-integrations), used when the
//      connector is not available — and for every write, because the
//      API shapes are fully known while the connector's write-tool
//      argument names are not published anywhere I could read.
//
// Connector shapes (verified live, 2026-11-12 — the listing carries
// no input schemas, so only calls actually run here are trusted):
// - notion-search {query, page_size} → {"results":[{id,title,url,
//   type:"page"|"database",highlight,timestamp}],"type":
//   "workspace_search"} — an empty query returns recently viewed
//   pages, with a notice saying so. Titles come back flat, no
//   properties digging needed.
// - notion-list-recent-pages {} → {"results":[{type,url,title,icon}]}
//   (no id — it is extracted from the /p/<hex> URL).
// - notion-get-self {} → {"workspace":{id,name},"user":{name,email}}.
// The envelope is the same MCP double-parse as Linear: outer JSON,
// then result.content[0].text as a second JSON string.
//
// API shapes (Notion REST API, version header 2022-06-28 on EVERY
// request — do NOT use 2025-09-03, it 401s intermittently on
// POST/PATCH; auth is `Bearer <token>`):
// - GET /v1/users/me → 200 with {id} (the probe); 401 = bad token.
// - POST /v1/search {query?, filter?:{property:"object",
//   value:"database"}, page_size} → {results:[{object:"page"|
//   "database", id, url, last_edited_time, properties...}]}.
// - GET /v1/pages/{id} + GET /v1/blocks/{id}/children → page text.
// - POST /v1/pages {parent:{database_id}, properties:{<Title prop>:
//   {title:[{text:{content}}]}}, children:[paragraph blocks]}.
//   The title property's NAME comes from the database schema
//   (GET /v1/databases/{id} → the property of type "title").
// - An integration only sees pages/databases explicitly shared with
//   it ("Add connections") — a 404 almost always means a missing
//   share, and the detail says so.

import { execFile } from 'node:child_process';
import type { NoteItem, NotionDatabase } from '../src/types.js';

const NOTION_TIMEOUT_MS = 15000;
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** `notion-cli` is the connector CLI on PATH; the absolute path is
 * the documented location from its connector doc, tried when PATH
 * misses (a packaged app's desktop-session PATH may not include
 * it). Same pattern as the Linear side. */
const NOTION_BIN_CANDIDATES = ['notion-cli', '/opt/hatch/bin/notion-cli'];

function runNotionRaw(
  bin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: NOTION_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: `${bin} not found` });
        return;
      }
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

async function runNotion(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  for (const bin of NOTION_BIN_CANDIDATES) {
    const res = await runNotionRaw(bin, args);
    if (res.code !== -1) return res;
  }
  return { code: -1, stdout: '', stderr: 'notion-cli not found' };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** The MCP envelope, parsed twice: outer JSON, then
 * result.content[0].text as a second JSON string. */
function parseMcp(stdout: string): { payload: unknown; problem: string } {
  let outer: unknown;
  try {
    outer = JSON.parse(stdout);
  } catch {
    return { payload: null, problem: 'Unrecognized `notion-cli` output (not JSON).' };
  }
  const rec = asRecord(outer);
  if (!rec) return { payload: null, problem: 'Unrecognized `notion-cli` output.' };
  if (rec.ok === false) {
    const err = asRecord(rec.error);
    return { payload: null, problem: asString(err?.message) || asString(rec.error) || 'Notion call failed.' };
  }
  const result = asRecord(rec.result);
  const content = Array.isArray(result?.content) ? result.content : [];
  const first = asRecord(content[0]);
  const text = asString(first?.text);
  if (!text) return { payload: null, problem: 'Unrecognized `notion-cli` output (empty result).' };
  try {
    return { payload: JSON.parse(text), problem: '' };
  } catch {
    return { payload: null, problem: 'Unrecognized `notion-cli` output (inner text is not JSON).' };
  }
}

export async function callNotionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ payload: unknown; problem: string; notFound: boolean }> {
  const res = await runNotion(['call-tool', '--name', name, '--arguments-json', JSON.stringify(args)]);
  if (res.code === -1) {
    return {
      payload: null,
      problem: 'notion-cli not found — the Notion connector is not on this machine.',
      notFound: true,
    };
  }
  if (res.code !== 0) {
    return {
      payload: null,
      problem: (res.stderr || res.stdout || `notion-cli exited ${res.code}`).trim().slice(0, 200),
      notFound: false,
    };
  }
  const { payload, problem } = parseMcp(res.stdout);
  return { payload, problem, notFound: false };
}

/** The connector probe: `notion-get-self` with no args. Returns the
 * workspace + user when the connection works. */
export async function notionConnectorProbe(): Promise<{
  ok: boolean;
  username: string;
  workspace: string;
  problem: string;
  notFound: boolean;
}> {
  const { payload, problem, notFound } = await callNotionTool('notion-get-self', {});
  if (notFound || problem) return { ok: false, username: '', workspace: '', problem, notFound };
  const rec = asRecord(payload);
  const user = asRecord(rec?.user);
  const workspace = asRecord(rec?.workspace);
  return {
    ok: true,
    username: asString(user?.name) || asString(user?.email),
    workspace: asString(workspace?.name),
    problem: '',
    notFound: false,
  };
}

function richTextToPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return rich.map((r) => asString(asRecord(r)?.plain_text)).join('');
}

function notionApiTitle(entry: unknown): string {
  const rec = asRecord(entry);
  if (!rec) return '(untitled note)';
  // Connector search results carry a flat title.
  if (typeof rec.title === 'string' && rec.title) return rec.title;
  // REST API pages carry properties; the title property is usually
  // called "title" (pages) or "Name"/"Title" (database rows).
  const props = asRecord(rec.properties);
  if (props) {
    for (const key of ['title', 'Name', 'Title']) {
      const prop = asRecord(props[key]);
      const arr = prop?.title;
      if (Array.isArray(arr)) {
        const text = richTextToPlain(arr);
        if (text) return text;
      }
    }
  }
  // REST API databases carry a top-level title array.
  if (Array.isArray(rec.title)) {
    const text = richTextToPlain(rec.title);
    if (text) return text;
  }
  return '(untitled note)';
}

function idFromNotionUrl(url: string): string {
  const m = url.match(/\/p\/([0-9a-f]{32})/i) ?? url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return '';
  const hex = m[1].replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mapSearchEntry(entry: unknown): NoteItem | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const id = asString(rec.id) || idFromNotionUrl(asString(rec.url));
  if (!id) return null;
  return {
    id,
    title: notionApiTitle(entry),
    source: 'notion',
    updatedAt: asString(rec.last_edited_time) || asString(rec.timestamp),
    url: asString(rec.url) || undefined,
  };
}

/** Connector search: `notion-search`. An empty query returns recently
 * viewed pages (the tool says so in a notice). */
export async function searchNotionConnector(query: string): Promise<{ notes: NoteItem[]; problem: string; notFound: boolean }> {
  const { payload, problem, notFound } = await callNotionTool('notion-search', {
    query,
    page_size: 20,
  });
  if (notFound || problem) return { notes: [], problem, notFound };
  const rec = asRecord(payload);
  const results = Array.isArray(rec?.results) ? rec.results : null;
  if (!results) return { notes: [], problem: 'Unrecognized `notion-search` shape.', notFound: false };
  const notes = results.map(mapSearchEntry).filter((n): n is NoteItem => n !== null);
  return { notes, problem: '', notFound: false };
}

/** Connector recent pages: `notion-list-recent-pages`. The entries
 * carry no id — it comes from the URL. */
export async function listRecentNotionConnector(): Promise<{ notes: NoteItem[]; problem: string; notFound: boolean }> {
  const { payload, problem, notFound } = await callNotionTool('notion-list-recent-pages', {});
  if (notFound || problem) return { notes: [], problem, notFound };
  const rec = asRecord(payload);
  const results = Array.isArray(rec?.results) ? rec.results : null;
  if (!results) return { notes: [], problem: 'Unrecognized `notion-list-recent-pages` shape.', notFound: false };
  const notes = results.map(mapSearchEntry).filter((n): n is NoteItem => n !== null);
  return { notes, problem: '', notFound: false };
}

// --- REST API transport (integration token) ---

async function notionFetch(
  token: string,
  path: string,
  init: RequestInit = {},
  base: string = NOTION_API_BASE,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON bodies stay as text; the caller decides.
  }
  return { status: res.status, json, text };
}

function notionApiProblem(status: number, json: unknown, text: string): string {
  const rec = asRecord(json);
  const msg = asString(rec?.message);
  if (status === 401) return 'Notion token rejected (401) — check the integration token in Settings → Notes.';
  if (status === 404)
    return 'Notion could not find that page or database (404) — the integration must be shared on it ("Add connections" in Notion).';
  if (status === 429) return 'Notion rate limit (429) — try again in a moment.';
  if (msg) return `Notion API ${status}: ${msg}`;
  return `Notion API ${status}: ${text.slice(0, 160) || 'request failed.'}`;
}

export async function notionApiMe(token: string, base: string = NOTION_API_BASE): Promise<{ ok: boolean; username: string; problem: string }> {
  try {
    const { status, json, text } = await notionFetch(token, '/users/me', { method: 'GET' }, base);
    if (status === 200) {
      const rec = asRecord(json);
      const bot = asRecord(rec?.bot);
      const owner = asRecord(bot?.owner);
      const ownerUser = asRecord(owner?.user);
      return { ok: true, username: asString(ownerUser?.name) || asString(rec?.name) || 'integration', problem: '' };
    }
    return { ok: false, username: '', problem: notionApiProblem(status, json, text) };
  } catch (e) {
    return { ok: false, username: '', problem: `Could not reach the Notion API: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function searchNotionApi(
  query: string,
  token: string,
  base: string = NOTION_API_BASE,
): Promise<{ notes: NoteItem[]; problem: string }> {
  try {
    const { status, json, text } = await notionFetch(
      token,
      '/search',
      { method: 'POST', body: JSON.stringify({ query, page_size: 20 }) },
      base,
    );
    if (status !== 200) return { notes: [], problem: notionApiProblem(status, json, text) };
    const rec = asRecord(json);
    const results = Array.isArray(rec?.results) ? rec.results : null;
    if (!results) return { notes: [], problem: 'Unrecognized Notion search shape.' };
    return { notes: results.map(mapSearchEntry).filter((n): n is NoteItem => n !== null), problem: '' };
  } catch (e) {
    return { notes: [], problem: `Could not reach the Notion API: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function listNotionDatabasesApi(
  token: string,
  base: string = NOTION_API_BASE,
): Promise<{ databases: NotionDatabase[]; problem: string }> {
  try {
    const { status, json, text } = await notionFetch(
      token,
      '/search',
      {
        method: 'POST',
        body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 50 }),
      },
      base,
    );
    if (status !== 200) return { databases: [], problem: notionApiProblem(status, json, text) };
    const rec = asRecord(json);
    const results = Array.isArray(rec?.results) ? rec.results : null;
    if (!results) return { databases: [], problem: 'Unrecognized Notion search shape.' };
    const databases = results
      .filter((r) => asRecord(r)?.object === 'database')
      .map((r) => ({ id: asString(asRecord(r)?.id), title: notionApiTitle(r) }))
      .filter((d) => d.id);
    return { databases, problem: '' };
  } catch (e) {
    return { databases: [], problem: `Could not reach the Notion API: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Connector databases: search with an empty query and keep the
 * databases client-side. The empty query returns recently viewed
 * pages, so this can come back empty even when databases exist —
 * the API path (token) is the reliable one. */
export async function listNotionDatabasesConnector(): Promise<{ databases: NotionDatabase[]; problem: string; notFound: boolean }> {
  const { payload, problem, notFound } = await callNotionTool('notion-search', { query: '', page_size: 50 });
  if (notFound || problem) return { databases: [], problem, notFound };
  const rec = asRecord(payload);
  const results = Array.isArray(rec?.results) ? rec.results : null;
  if (!results) return { databases: [], problem: 'Unrecognized `notion-search` shape.', notFound: false };
  const databases = results
    .filter((r) => asRecord(r)?.type === 'database')
    .map((r) => ({ id: asString(asRecord(r)?.id), title: notionApiTitle(r) }))
    .filter((d) => d.id);
  return { databases, problem: '', notFound: false };
}

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const lines: string[] = [];
  for (const b of blocks) {
    const rec = asRecord(b);
    if (!rec) continue;
    const type = asString(rec.type);
    const content = asRecord(rec[type]);
    const text = richTextToPlain(content?.rich_text);
    if (type === 'code') {
      const lang = asString(content?.language);
      lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
    } else if (text) {
      lines.push(type === 'bulleted_list_item' ? `• ${text}` : type === 'numbered_list_item' ? `1. ${text}` : text);
    }
  }
  return lines.join('\n');
}

/** Page detail via the API: the page record (for its title) plus
 * its top-level blocks as plain text. */
export async function getNotionPageApi(
  id: string,
  token: string,
  base: string = NOTION_API_BASE,
): Promise<{ title: string; content: string; url: string; problem: string }> {
  try {
    const page = await notionFetch(token, `/pages/${encodeURIComponent(id)}`, { method: 'GET' }, base);
    if (page.status !== 200) {
      return { title: '', content: '', url: '', problem: notionApiProblem(page.status, page.json, page.text) };
    }
    const rec = asRecord(page.json);
    const title = notionApiTitle(page.json);
    const url = asString(rec?.url);
    const kids = await notionFetch(token, `/blocks/${encodeURIComponent(id)}/children?page_size=100`, { method: 'GET' }, base);
    if (kids.status !== 200) {
      return { title, content: '', url, problem: notionApiProblem(kids.status, kids.json, kids.text) };
    }
    const kidsRec = asRecord(kids.json);
    return { title, content: blocksToText(kidsRec?.results), url, problem: '' };
  } catch (e) {
    return { title: '', content: '', url: '', problem: `Could not reach the Notion API: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Create a page in a database via the API. The title property's
 * name comes from the database schema (usually "title" or "Name"),
 * so the schema is fetched first — never guessed. The body becomes
 * one paragraph block per line. */
export async function createNotionPageApi(
  databaseId: string,
  title: string,
  body: string,
  token: string,
  base: string = NOTION_API_BASE,
): Promise<{ id: string; url: string; problem: string }> {
  try {
    const schema = await notionFetch(token, `/databases/${encodeURIComponent(databaseId)}`, { method: 'GET' }, base);
    if (schema.status !== 200) {
      return { id: '', url: '', problem: notionApiProblem(schema.status, schema.json, schema.text) };
    }
    const props = asRecord(asRecord(schema.json)?.properties) ?? {};
    let titleProp = '';
    for (const [key, val] of Object.entries(props)) {
      if (asString(asRecord(val)?.type) === 'title') {
        titleProp = key;
        break;
      }
    }
    if (!titleProp) return { id: '', url: '', problem: 'That database has no title property — pick another one.' };
    const children = body
      .split('\n')
      .map((line) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: line ? [{ type: 'text', text: { content: line } }] : [] },
      }));
    const created = await notionFetch(
      token,
      '/pages',
      {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: { [titleProp]: { title: [{ type: 'text', text: { content: title || '(untitled note)' } }] } },
          children,
        }),
      },
      base,
    );
    if (created.status !== 200) {
      return { id: '', url: '', problem: notionApiProblem(created.status, created.json, created.text) };
    }
    const rec = asRecord(created.json);
    return { id: asString(rec?.id), url: asString(rec?.url), problem: '' };
  } catch (e) {
    return { id: '', url: '', problem: `Could not reach the Notion API: ${e instanceof Error ? e.message : String(e)}` };
  }
}
