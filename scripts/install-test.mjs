// Installer test (node-side, no CDP, no network beyond localhost).
// Builds real tarballs + checksums, serves them from a local fixture
// server, and drives the built installers against it with a throwaway
// HOME — the real ~/.local/bin is never touched. A tampered tarball
// must fail the checksum and install nothing.
// Run with a fake HOME: HOME=/tmp/halo-install-test-home node scripts/install-test.mjs
import http from 'node:http';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const HOME = os.homedir();
if (!HOME.startsWith('/tmp/')) {
  console.log('refusing to run without a /tmp HOME — relaunch as: HOME=/tmp/halo-install-test-home node scripts/install-test.mjs');
  process.exit(2);
}
const { installTool } = await import(`${ROOT}dist-electron/electron/connections.js`);

let checks = 0;
let failures = 0;
function check(name, cond, extra = '') {
  checks += 1;
  if (cond) console.log(`  ok ${checks} ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${checks} ${name} ${extra}`);
  }
}

const work = fs.mkdtempSync(path.join('/tmp', 'halo-install-fixtures-'));
function makeTarball(files, outPath) {
  // files: { 'path/in/tar': 'content' }
  const src = fs.mkdtempSync(path.join('/tmp', 'halo-install-src-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(src, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, { mode: 0o755 });
  }
  execSync(`tar -czf ${outPath} -C ${src} .`, { stdio: 'pipe' });
  fs.rmSync(src, { recursive: true, force: true });
}
function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const ghDir = path.join(work, 'gh', '9.9.9');
const entireDir = path.join(work, 'entire', 'v9.9.9');
fs.mkdirSync(ghDir, { recursive: true });
fs.mkdirSync(entireDir, { recursive: true });
const ghTar = path.join(ghDir, 'gh_9.9.9_linux_amd64.tar.gz');
makeTarball({ 'gh_9.9.9_linux_amd64/bin/gh': '#!/bin/sh\necho fake-gh-9.9.9\n' }, ghTar);
fs.writeFileSync(path.join(ghDir, 'gh_9.9.9_checksums.txt'), `${sha256(ghTar)}  gh_9.9.9_linux_amd64.tar.gz\n`);
const entireTar = path.join(entireDir, 'entire_linux_amd64.tar.gz');
makeTarball({ entire: '#!/bin/sh\necho fake-entire-9.9.9\n', 'git-remote-entire': '#!/bin/sh\necho fake-helper\n' }, entireTar);
fs.writeFileSync(path.join(entireDir, 'checksums.txt'), `${sha256(entireTar)}  entire_linux_amd64.tar.gz\n`);

const server = http.createServer((req, res) => {
  const file = path.join(work, decodeURIComponent(req.url || '').replace(/^\/+/, ''));
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200);
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const binDir = path.join(HOME, '.local', 'bin');

console.log('installers:');
const gh = await installTool('gh', { version: '9.9.9', base: `http://127.0.0.1:${port}/gh/9.9.9` });
check('gh installs', gh.ok, gh.detail);
const ghBin = path.join(binDir, 'gh');
check('gh binary lands in ~/.local/bin', fs.existsSync(ghBin));
check('gh binary is executable', fs.existsSync(ghBin) && (fs.statSync(ghBin).mode & 0o111) !== 0);
check('gh binary is the fixture', fs.existsSync(ghBin) && fs.readFileSync(ghBin, 'utf8').includes('fake-gh-9.9.9'));

const entire = await installTool('entire', { version: '9.9.9', base: `http://127.0.0.1:${port}/entire` });
check('entire installs', entire.ok, entire.detail);
const entireBin = path.join(binDir, 'entire');
const helperBin = path.join(binDir, 'git-remote-entire');
check('entire binary lands', fs.existsSync(entireBin) && fs.readFileSync(entireBin, 'utf8').includes('fake-entire-9.9.9'));
check('git-remote-entire lands beside it', fs.existsSync(helperBin));

// Tamper: rebuild the gh tarball with different bytes, keep the old
// checksums — the install must refuse.
makeTarball({ 'gh_9.9.9_linux_amd64/bin/gh': '#!/bin/sh\necho TAMPERED\n' }, ghTar);
const tampered = await installTool('gh', { version: '9.9.9', base: `http://127.0.0.1:${port}/gh/9.9.9` });
check('tampered tarball fails the checksum', !tampered.ok && tampered.detail.includes('checksum mismatch'), tampered.detail);
check('tampered install leaves the good binary alone', fs.readFileSync(ghBin, 'utf8').includes('fake-gh-9.9.9'));

server.close();
fs.rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? `install-test: ${checks} checks passed` : `install-test: ${failures}/${checks} FAILED`);
process.exit(failures === 0 ? 0 : 1);
