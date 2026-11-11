# AGENTS.md — Halo

Halo — a nightshade neon Electron shell that lets herdr run trails locally,
with your repos and agents in one live view. Two-week spike (Nov 2026),
Linear XVOIDSX-71, exploratory. This file is the repo's working notes:
what to build, where things live, and the lessons that apply here.

## What Halo is

- An Electron **app on top of a harness**, not a harness. The harness is
  replaceable; the app is the product.
- Local-first with Ollama, BYOK for other providers. Keys live only in
  `~/.config/halo/settings.json` (0600) — never in the repo, never logged,
  never sent to xvoidsx.
- Halo is a **herdr client, not a replacement**. It asks herdr to do the
  work and renders what comes back.
- **No telemetry anywhere.** No usage events, no error reports, no phone-home.
- Navi-first; Windows/Mac later. Keep it lean — it has to feel fine on a
  T440p (3.5 GB usable) and a Cloudbook, not just a fast desktop.

## Layout

- `electron/` — main process: `main.ts` (window + IPC), `preload.ts`
  (typed contextBridge — the renderer never touches Node directly),
  `herdrAdapter.ts` (herdr CLI boundary), `settingsFile.ts`
  (`~/.config/halo/settings.json`), `terminal.ts` (node-pty shells, one
  per repo).
- `src/` — renderer (React + Vite): `App.tsx` (sidebar trails, main trail
  view, settings, terminal + chat tabs), `Terminal.tsx` (xterm.js panel,
  lazy-loaded), `AgentChat.tsx` (chat pane, polls `herdr agent read`),
  `theme.css` (nightshadeNeon), `types.ts` (shared types).
  No placeholder data anywhere — an empty trail list means no trail has
  run yet.
- `electron-builder.yml` — Linux `.deb` packaging. Output goes to `release/`
  (not `dist/`, which is Vite's renderer output). node-pty ships in the
  package (`files` + `asarUnpack` — the .node binary cannot load from
  inside asar) and is rebuilt for Electron at pack time.

## Herdr rules (from navi's own herdr work)

- Address agents by **`pane_id`**, never by bare label. The `agent` field in
  `herdr agent list` is a display label, not a target — `attach`/`read`
  do not resolve bare labels.
- Never fabricate an agent status you did not observe. A stub that says
  "not implemented" is correct; a fake "live" connection is not.
- `herdr agent list` output shape is best-effort parsed (JSON first, then
  raw lines). Verify the real format on a machine with herdr installed
  before trusting the agent list.

## Agent chat (herdr send / read)

- Chat is `agent send <pane_id> <text>` (literal text, no Enter) followed
  by `agent send-keys <pane_id> enter` to submit, and `agent read
  <pane_id> --source recent-unwrapped --lines N` (plain terminal text)
  polled every 2 s. Documented in herdr's CLI reference (herdr.dev,
  v0.7–0.9).
- `agent attach` is never used for chat — it takes over the current
  terminal, which a GUI window cannot do.
- The send/read path is **not yet verified on a machine with herdr
  installed** (herdr is absent in this sandbox). The adapter returns
  honest errors; the UI shows them as system lines in the chat. Bench it
  on a real machine before trusting it.
- Agent messages in the chat are text actually read from the pane. If a
  poll returns a snapshot that no longer starts with the previous one
  (scrollback scrolled past the window), the whole snapshot is shown —
  never diffed into invented text.

## Terminal (xterm.js + node-pty)

- Stack, borrowed from copland on purpose: node-pty shells in main
  (`electron/terminal.ts`), xterm.js in the renderer (`src/Terminal.tsx`),
  WebGL renderer with a canvas fallback (WebGL can fail on old hardware).
- One terminal per repo, cwd = the repo path from settings. The shell is
  `$SHELL` or `/bin/bash`. If the path does not exist, the panel says so
  instead of showing a dead prompt. All shells are killed on quit.
- The terminal chunk is lazy-loaded (`React.lazy` in App.tsx) so the trail
  view's initial bundle stays ~238 kB; xterm (~443 kB) loads only when
  the Terminal tab opens.
- **Install command in this sandbox** (node-gyp chown is blocked outside
  /tmp here): `npm_config_devdir=/tmp/node-gyp-cache npm install
  --unsafe-perm=true` — used for `@xterm/xterm@6.0.0`,
  `@xterm/addon-fit@0.11.0`, `@xterm/addon-webgl@0.19.0`, `node-pty@1.1.0`.
  On a real machine plain `npm install` works.
- Packaging: node-pty must be in `electron-builder.yml` `files` AND
  `asarUnpack` (the .node binary cannot load from inside asar), and
  electron-builder rebuilds it for Electron at pack time. Verify the
  unpacked `pty.node` exists in `release/linux-unpacked/resources/
  app.asar.unpacked/` before shipping a .deb.

## Electron / packaging lessons (xvoidsx)

- **Never set `GH_TOKEN` on the electron-builder build step** — it makes
  electron-builder attempt a GitHub publish and fail the build. Releases
  are cut separately (softprops/action-gh-release with `GITHUB_TOKEN`).
- Pin `electron-builder` (currently 26.18.0) — do not float it.
- **`.deb` must be gzip-compressed.** `dpkg-deb` here defaults to zstd,
  which older dpkg fails on ("Unknown frame descriptor"). Verify with
  `dpkg-deb --info` / `file` that the built deb uses gzip before shipping,
  and verify asar contents (`npx asar list`) + deb permissions
  (`dpkg-deb -c`).
- **Pack under `umask 022` — or the .desktop file ships unreadable.**
  The sandbox umask is 0007, so the generated `.desktop` file and the icon
  landed in the deb as 660 root:root. Root can read them, your user can't —
  rofi silently skips entries it can't read, so Halo never appeared in the
  launcher even though `halo` worked from a terminal (binary is 755). The
  0.1.2 pack runs `(umask 022; TMPDIR=~/workspace/.tmp npm run pack)` and
  the deb is verified with `dpkg-deb -c` (desktop + icon must be 644,
  binary 755) before every upload. `build/icon.png` itself is chmod 644 in
  the tree too, since fpm preserves source modes. Note umask only affects
  NEW files: `git reset --hard` recreates checked-out files under the
  sandbox umask (the 0.2.0 icons came back 660 after a reset), so
  re-chmod the tree (`chmod 644 build/icons/*.png build/icon.png`,
  `chmod -R a+rX node_modules`) before packing, and rely on
  `scripts/after-install.sh` (`chmod -R a+rX /opt/Halo`) as the runtime
  safety net on install.
- **dpkg never fixes the mode of a directory that already exists.**
  The 0.1.0/0.1.1 debs (built under umask 007) left `/opt/Halo` and its
  subdirs as 770 root:root; upgrades replaced the files but not the dir
  modes, so rofi launches failed with "Permission denied" even though
  the binary was 755. Fixed by `deb.afterInstall`
  (`scripts/after-install.sh`) normalizing `/opt/Halo` dirs to 755, and
  by packing under `umask 022`. Verify every deb by installing it over
  the stale build and launching as an unprivileged user.
- **Native modules in the ESM main process: load by dynamic import()
  of the real unpacked file.** `import 'node-pty'` fails (Node's ESM
  loader ignores Electron's `app.asar.unpacked` redirect),
  `require('node-pty')` via createRequire fails (a require rooted at an
  asar file:// URL does not walk into app.asar/node_modules), and even
  `require(<absolute unpacked path>)` fails under Electron — while the
  same absolute require works fine under plain node, and both the asar
  copy and the unpacked copy of the package are complete. The fix that
  actually loads: `await import(pathToFileURL(<unpacked>/lib/index.js))`,
  loaded lazily in TerminalManager's constructor with spawn() reporting
  "still loading" honestly until it lands. Corollary: smoke-test the
  PACKAGED app (install the .deb, launch as an unprivileged user), not
  just the dev build — the 0.1.0–0.1.5 Terminal was silently broken in
  the package while the dev smoke test passed.
- **fpm stages the whole unpacked app (~500 MB) under TMPDIR**, and
  /tmp here is a 512M tmpfs — the 0.1.1 pack died in `tar` (exit 2) with
  /tmp part-full. Build with `TMPDIR=~/workspace/.tmp npm run pack`
  (workspace has room) and keep /tmp clear of big scratch files.
- **App icon lives at `build/icon.png`** (1600x1600, neon halo ring,
  nightshadeNeon) plus the generated standard sizes in `build/icons/`
  (16–512px). The 1600-only icon never showed in rofi — it looks up
  standard hicolor sizes. Regenerate the sizes from icon.png (PIL
  LANCZOS) whenever the source icon changes, chmod 644.
- **Launcher identity:** `desktopName: org.xvoidsx.halo` in package.json +
  `linux.syncDesktopName: true` in electron-builder.yml, so the Wayland
  app_id / WM_CLASS matches the .desktop entry and the launcher links the
  running window to it.
- **`/usr/bin/halo` comes from the default postinst** (update-alternatives
  symlink to /opt/Halo/halo, fallback `ln -sf`) — do NOT add a custom
  afterInstall script for the symlink. A `deb.afterInstall` script DOES
  exist now, but only for permission healing (`scripts/after-install.sh`:
  /opt/Halo dirs to 755) — see the dpkg-dir-modes lesson above.
  If `halo` is "command not found" after install, the package was never
  configured: `dpkg -i` without deps installed leaves postinst unrun —
  finish with `sudo apt -f install` (or install with
  `sudo apt install ./halo_*.deb`, which resolves deps).
- **Running as root:** Electron FATALS without --no-sandbox, and the check
  fires in Electron's native launcher BEFORE Halo's JS runs — so no in-app
  fix can catch it (verified: a getuid/appendSwitch guard shipped in the
  asar still FATALed). Do not try to fix this in main.ts. The real answer
  is run as a normal user — `halo` is on PATH after a proper install — or
  `halo --no-sandbox` when root is unavoidable.

## Verification before claiming anything

- `npm run typecheck`, then `npm run build`. Both must pass.
- Never claim a window launch you did not verify. If the sandbox has no
  display, say so and record what was actually run.
- Bench on Cloudbook / T440p before calling the spike done.

## Copy

User-facing strings name the actor and point at the next step ("herdr is
not installed (not on PATH)" beats "something went wrong"). No dead ends,
no bare error codes in the UI.

## Herdr CLI — verified live against 0.9.5 (2026-11-11)
- **`herdr agent list` is a JSON envelope**: `{"id":"cli:agent:list","result":{"agents":[…],"type":"agent_list"}}`. The payload is under `result.agents` — there is NO top-level `agents` key. 0.2.0 parsed `parsed.agents ?? []` and silently showed zero agents with pi running. Never read a shape mismatch as an empty list: unrecognized JSON returns null and the raw output is shown (scripts/herdr-parser-test.mjs covers the live envelope).
- **Agent records**: `agent` (detected label, e.g. "pi"), `agent_status` (idle|working|blocked|unknown|done), `name` (unique agent name), `pane_id` (workspace-qualified, e.g. "w1:p1"), `terminal_id`, `cwd`, `focused`. Targets accept a pane_id or a unique agent name — never a bare kind label (`attach opencode` → agent_not_found).
- **`herdr agent send` does NOT exist** (prints the help text). Chat sends via **`herdr agent prompt <target> "<text>"`** — types AND submits in one call. `agent read <target> --source recent-unwrapped --lines N` returns plain text. `agent get` returns `{"result":{"agent":{…}}}`. `herdr api snapshot` returns the full live state (`result.snapshot.agents`).
- **Verifying locally**: install herdr 0.9.5 from https://herdr.dev/install.sh (script inspected 2026-11-11: manifest fetch + SHA-256-verified binary, no sudo), `herdr server` in the background, then a fake agent: a tiny C program named `pi` (prints a prompt, sleeps) on PATH + `herdr agent start fakepi --kind pi --pane w1:p1`. `agent list` then shows it. scripts/herdr-e2e-test.mjs drives the packaged app against that server (switcher shows the agent, agentSend + agentRead round-trip). Clean up after: `herdr server stop`, remove the fake binary.
- **Protocol mismatch**: a CLI newer than the server fails with `protocol_mismatch`; surface the error, don't pretend all is well.
