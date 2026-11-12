// Connections — Halo's health layer for the tools it shells out to.
// Every forge gets a status probe (binary present? signed in?) that
// feeds the sidebar dots, plus an installer that fetches the tool
// when it is missing. Two rules hold throughout:
//
// 1. Nothing executes an install script. The installer is one path
//    for every tool: download the release archive + its checksums,
//    verify the sha256, extract the binaries into ~/.local/bin.
//    `gh` comes from GitHub releases, `entire` from install.entire.com
//    (GitHub releases as fallback — the same origin order as
//    Entire's own install.sh), `ntn` from npm. The Entire archive
//    URL shape (<base>/v<version>/entire_<os>_<arch>.tar.gz, with
//    checksums.txt beside it) and the checksum discipline (archive
//    and checksums always from the SAME origin) come from Entire's
//    install.sh, read 2026-11-12.
// 2. Probes never invent a login. Each one runs the tool's own status
//    command and reports what it actually said: `gh auth status`
//    (exit 0 = logged in), `entire auth status --json` (local only,
//    no network, per docs.entire.com/cli-reference/auth), the
//    connector's `list_issues` / `notion-get-self` for Linear and
//    Notion, and a GraphQL `viewer` / REST `/users/me` call when a
//    personal key is set instead. A probe that cannot tell is
//    `not-authed` with the tool's own words in the detail, never
//    green on a guess.

import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConnectionState, ConnectionStatus, InstallResult, ToolId } from '../src/types.js';
import { detectHerdr } from './herdrAdapter.js';
import { callLinearTool, linearApiProbe } from './linearAdapter.js';
import { notionApiMe, notionConnectorProbe } from './notionAdapter.js';

const DOWNLOAD_TIMEOUT_MS = 60000;
const PROBE_TIMEOUT_MS = 15000;

function runCmd(
  bin: string,
  args: string[],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
}

// --- probes ---

async function probeGitHub(): Promise<ConnectionStatus> {
  const res = await runCmd('gh', ['auth', 'status']);
  if (res.code === -1) {
    return { forge: 'github', state: 'missing', detail: 'gh not found — Install it below.' };
  }
  if (res.code === 0) {
    const text = `${res.stdout}\n${res.stderr}`;
    const m = text.match(/account (\S+)/) ?? text.match(/Logged in to \S+ account (\S+)/);
    const user = m ? m[1] : '';
    return {
      forge: 'github',
      state: 'connected',
      detail: user ? `Signed in to GitHub as ${user}.` : 'Signed in to GitHub.',
      username: user || undefined,
    };
  }
  return {
    forge: 'github',
    state: 'not-authed',
    detail: 'gh is installed but not logged in — Connect to sign in.',
  };
}

async function probeEntire(): Promise<ConnectionStatus> {
  const res = await runCmd('entire', ['auth', 'status', '--json']);
  if (res.code === -1) {
    return { forge: 'entire', state: 'missing', detail: 'entire CLI not found — Install it below.' };
  }
  if (res.code !== 0) {
    const err = firstLine(res.stderr || res.stdout);
    return {
      forge: 'entire',
      state: 'not-authed',
      detail: err ? `Entire: ${err}` : 'entire is installed but not logged in — Connect to sign in.',
    };
  }
  // The --json report is a verdict + rows; the user handle is the
  // provider-qualified handle under `user`. Anything unrecognized
  // still counts as signed in on exit 0 — the command is local-only
  // and only succeeds with a saved login.
  let user = '';
  try {
    const parsed = asRecord(JSON.parse(res.stdout));
    user = asString(parsed?.user);
    if (!user) {
      const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      const current = sessions.map((s) => asRecord(s)).find((s) => s && s.current === true);
      user = asString(current?.user);
    }
  } catch {
    // Unparseable JSON on exit 0: still signed in, no name to show.
  }
  return {
    forge: 'entire',
    state: 'connected',
    detail: user ? `Signed in to Entire as ${user}.` : 'Signed in to Entire.',
    username: user || undefined,
  };
}

async function probeLinear(apiKey: string): Promise<ConnectionStatus> {
  const key = (apiKey ?? '').trim();
  const conn = await callLinearTool('list_issues', { limit: 1, orderBy: 'updatedAt' });
  if (!conn.notFound && !conn.problem) {
    return { forge: 'linear', state: 'connected', detail: 'Linear connected via the connector.' };
  }
  if (key) {
    const api = await linearApiProbe(key);
    if (api.ok) {
      return {
        forge: 'linear',
        state: 'connected',
        detail: api.username ? `Linear connected via API key as ${api.username}.` : 'Linear connected via API key.',
        username: api.username || undefined,
      };
    }
    return { forge: 'linear', state: 'not-authed', detail: `Linear API key: ${api.problem}` };
  }
  if (conn.notFound) {
    return {
      forge: 'linear',
      state: 'missing',
      detail: 'Linear connector not found — add a personal API key in Settings → Linear.',
    };
  }
  return { forge: 'linear', state: 'not-authed', detail: `Linear: ${conn.problem}` };
}

async function probeNotion(token: string): Promise<ConnectionStatus> {
  const tok = (token ?? '').trim();
  const conn = await notionConnectorProbe();
  if (conn.ok) {
    return {
      forge: 'notion',
      state: 'connected',
      detail: conn.workspace
        ? `Notion connected (${conn.workspace}${conn.username ? ` as ${conn.username}` : ''}).`
        : 'Notion connected via the connector.',
      username: conn.username || undefined,
    };
  }
  if (tok) {
    const api = await notionApiMe(tok);
    if (api.ok) {
      return { forge: 'notion', state: 'connected', detail: 'Notion connected via integration token.' };
    }
    return { forge: 'notion', state: 'not-authed', detail: `Notion token: ${api.problem}` };
  }
  if (conn.notFound) {
    return {
      forge: 'notion',
      state: 'missing',
      detail: 'Notion connector not found — add an integration token in Settings → Notes.',
    };
  }
  return { forge: 'notion', state: 'not-authed', detail: `Notion: ${conn.problem}` };
}

async function probeHerdr(): Promise<ConnectionStatus> {
  const st = await detectHerdr();
  if (!st.installed) {
    return { forge: 'herdr', state: 'missing', detail: st.detail };
  }
  if (st.detail === 'herdr is installed.') {
    const n = st.agents.length;
    return {
      forge: 'herdr',
      state: 'connected',
      detail: n === 0 ? 'herdr is running — no agents yet.' : `herdr is running — ${n} agent${n === 1 ? '' : 's'}.`,
    };
  }
  return { forge: 'herdr', state: 'not-authed', detail: st.detail };
}

export async function getConnections(linearApiKey = '', notionToken = ''): Promise<ConnectionStatus[]> {
  const [entire, github, linear, notion, herdr] = await Promise.all([
    probeEntire(),
    probeGitHub(),
    probeLinear(linearApiKey),
    probeNotion(notionToken),
    probeHerdr(),
  ]);
  return [entire, github, linear, notion, herdr];
}

// --- installers ---

const LOCAL_BIN = path.join(os.homedir(), '.local', 'bin');

function archSuffix(): string {
  return os.arch() === 'arm64' ? 'arm64' : 'amd64';
}

function osSuffix(): string {
  return process.platform === 'darwin' ? 'darwin' : 'linux';
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function resolveLatestTag(owner: string, repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`could not list releases for ${owner}/${repo} (HTTP ${res.status})`);
  const body = (await res.json()) as { tag_name?: unknown };
  const tag = asString(body.tag_name);
  if (!tag) throw new Error(`no releases found for ${owner}/${repo}`);
  return tag.replace(/^v/, '');
}

function verifyChecksum(filePath: string, checksumsPath: string, fileName: string): void {
  const lines = fs.readFileSync(checksumsPath, 'utf8').split('\n');
  let expected = '';
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && (parts[1] === fileName || parts[1] === `*${fileName}`)) {
      expected = parts[0];
      break;
    }
  }
  if (!expected) throw new Error(`checksums.txt does not list ${fileName} — refusing to install unverified bytes.`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`checksum mismatch for ${fileName} — refusing to install.`);
  }
}

async function extractTarball(tarPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const res = await runCmd('tar', ['-xzf', tarPath, '-C', destDir], DOWNLOAD_TIMEOUT_MS);
  if (res.code !== 0) throw new Error(`could not extract the archive: ${firstLine(res.stderr || res.stdout)}`);
}

function installBinary(src: string, name: string): void {
  fs.mkdirSync(LOCAL_BIN, { recursive: true });
  const dest = path.join(LOCAL_BIN, name);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
}

function pathNote(): string {
  const pathDirs = (process.env.PATH ?? '').split(':');
  if (!pathDirs.includes(LOCAL_BIN)) {
    return ` Installed to ${LOCAL_BIN} — add it to your PATH if your shell cannot find it.`;
  }
  return '';
}

async function installGh(opts: { version?: string; base?: string } = {}): Promise<InstallResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-gh-'));
  try {
    const version = opts.version ?? (await resolveLatestTag('cli', 'cli'));
    const arch = archSuffix();
    const asset = `gh_${version}_linux_${arch}.tar.gz`;
    const checksums = `gh_${version}_checksums.txt`;
    const base = opts.base ?? `https://github.com/cli/cli/releases/download/v${version}`;
    const tarPath = path.join(tmp, asset);
    const sumPath = path.join(tmp, checksums);
    await downloadFile(`${base}/${asset}`, tarPath);
    await downloadFile(`${base}/${checksums}`, sumPath);
    verifyChecksum(tarPath, sumPath, asset);
    const out = path.join(tmp, 'out');
    await extractTarball(tarPath, out);
    installBinary(path.join(out, `gh_${version}_linux_${arch}`, 'bin', 'gh'), 'gh');
    return { ok: true, detail: `gh ${version} installed to ${LOCAL_BIN}/gh.${pathNote()} Run \`gh auth login\` to sign in.` };
  } catch (e) {
    return { ok: false, detail: `gh install failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function installEntire(opts: { version?: string; base?: string } = {}): Promise<InstallResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-entire-'));
  try {
    const version = opts.version ?? (await resolveLatestTag('entireio', 'cli'));
    const asset = `entire_${osSuffix()}_${archSuffix()}.tar.gz`;
    // Origin order mirrors install.sh: install.entire.com first,
    // GitHub releases second — archive and checksums always from the
    // SAME origin.
    const origins = opts.base
      ? [opts.base]
      : [`https://install.entire.com`, `https://github.com/entireio/cli/releases/download`];
    let tarPath = '';
    let lastErr = '';
    for (const origin of origins) {
      const base = `${origin}/v${version}`;
      const candTar = path.join(tmp, asset);
      const candSum = path.join(tmp, 'checksums.txt');
      try {
        await downloadFile(`${base}/${asset}`, candTar);
        await downloadFile(`${base}/checksums.txt`, candSum);
        verifyChecksum(candTar, candSum, asset);
        tarPath = candTar;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        fs.rmSync(candTar, { force: true });
        fs.rmSync(candSum, { force: true });
      }
    }
    if (!tarPath) throw new Error(lastErr || 'could not download the Entire archive from any origin.');
    const out = path.join(tmp, 'out');
    await extractTarball(tarPath, out);
    installBinary(path.join(out, 'entire'), 'entire');
    const helper = path.join(out, 'git-remote-entire');
    if (fs.existsSync(helper)) installBinary(helper, 'git-remote-entire');
    return { ok: true, detail: `Entire ${version} installed to ${LOCAL_BIN}/entire.${pathNote()} Run \`entire login\` to sign in.` };
  } catch (e) {
    return { ok: false, detail: `Entire install failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function installNtn(): Promise<InstallResult> {
  const npmCheck = await runCmd('npm', ['--version']);
  if (npmCheck.code === -1) {
    return { ok: false, detail: 'npm not found — install Node.js first, then try again.' };
  }
  const res = await runCmd('npm', ['install', '-g', 'ntn'], 120000);
  if (res.code !== 0) {
    const tail = (res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ');
    return { ok: false, detail: `npm install -g ntn failed: ${tail || `exit ${res.code}`}` };
  }
  return { ok: true, detail: 'ntn installed (npm install -g ntn). Run `ntn` once to sign in to Notion.' };
}

export async function installTool(
  tool: ToolId,
  opts: { version?: string; base?: string } = {},
): Promise<InstallResult> {
  if (tool === 'gh') return installGh(opts);
  if (tool === 'entire') return installEntire(opts);
  return installNtn();
}

export type { ConnectionState };
