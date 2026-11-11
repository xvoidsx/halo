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
- Always commit `package-lock.json` — `npm ci` on CI fails without it.

## Verification before claiming anything

- `npm run typecheck`, then `npm run build`. Both must pass.
- Never claim a window launch you did not verify. If the sandbox has no
  display, say so and record what was actually run.
- Bench on Cloudbook / T440p before calling the spike done.

## Copy

User-facing strings name the actor and point at the next step ("herdr is
not installed (not on PATH)" beats "something went wrong"). No dead ends,
no bare error codes in the UI.
