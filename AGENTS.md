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
  lazy-loaded), `ChatView.tsx` (chat list + live attached terminal),
  `theme.css` (nightshadeNeon), `types.ts` (shared types). No placeholder
  data anywhere — an empty trail list means no trail has run yet.
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

## Agent chat — the list + the live terminal (0.4.0, supersedes 0.3.0's text log)

- Chat is the agent center's Enter-to-jump, as a GUI: a left-hand list of
  every live agent, and the selected agent's **live terminal** on the
  right — `herdr agent attach <pane_id>` in an xterm pane, in the same
  window. You type straight into it. There is no text log and no send
  box: the log was the wrong renderer (see below), and a send box would
  only duplicate the agent's own input line.
- **Why the text log died (0.3.0 → 0.4.0, Raven's bench):** a TUI agent's
  `agent read` output IS its whole screen — the opencode logo is block
  characters the chat font renders as solid rectangles, plus the prompt
  line, status bar and version. No amount of ANSI stripping makes a
  screen dump read as a conversation. The terminal renders it properly
  because xterm is a terminal. `AgentChat.tsx` was deleted; `ChatMessage`
  and `nextChatId` went with it.
- `agent attach` is the chat surface now, not just jump-to-terminal.
  Typing in the attach pane reaches the agent (verified: termWrite into
  an attach → `agent read` shows the text). One attach per agent at a
  time — switching chats unmounts the old pane and kills its pty, so the
  "second attach bumps the first" behaviour never fires in the chat view.
- **ChatView owns the chat** (`src/ChatView.tsx`): the agent list (the
  agent center's jump-in list, as a GUI — click a row, or arrow to it and
  hit Enter), ordered blocked → working → idle like the center; one-line
  preview of each agent's latest output; a pink unread dot when an agent
  produces output while you look elsewhere. The selected agent is read
  every 2 s; the others are swept every ~10 s for previews/dots. The
  poller now exists ONLY for previews and dots — no transcripts, no
  messages. `agent prompt` / `agent read` are still the CLI boundary
  (prompt verified live against herdr 0.9.5; `agent send` does NOT exist
  — see "Herdr CLI — verified live" below).
- Pane output is raw terminal text — ANSI escapes are stripped from the
  displayed preview copy (the diff still runs on the raw output) so the
  preview reads as text, not cursor-movement noise.
- **Terminal spawn splits the command on whitespace** into program + args
  (node-pty takes them separately) — `herdr agent attach w1:p1` works,
  and the pane status shows the full command (`Running herdr agent
  attach w1:p1 ...`). Plain `'herdr'` still boots the herdr TUI.
- **Test launches must put herdr on PATH** (0.4.0 pack lesson): the
  packaged app launched as halotest via bare `su -c` saw "herdr?" in the
  chip and an empty chat list — `~/.local/bin` is not on a non-login
  shell's PATH. Launch test instances with
  `export PATH=/home/halotest/.local/bin:$PATH` first. (On a real navi
  machine herdr is on the login PATH, so this is a sandbox-launch
  artifact, not an app bug — but it reads exactly like broken detection,
  so check PATH before believing the chip.)
- **Packaged test launches need a CLEAN environment** (0.5.0): launching
  the packaged app as halotest via `su -c 'export PATH=...; ...'` left
  it seeing only 2 of halotest's 3 agents — the contaminated env made
  its `herdr` talk to another user's server (the CLI, same user, saw
  all 3 at the same moment). Relaunching with `env -i HOME=...
  PATH=...` showed all 3. Always launch packaged test instances with
  `env -i` and explicit HOME/PATH; never trust a mixed-env launch's
  agent list.

## Agent chat — the list + the live terminal (0.5.0: read-kills-attach)

- **Never `agent read` a pane with a live `agent attach` (0.5.0, the
  shell-exit bug).** The chat poller used to read the selected agent
  every 2 s for previews/dots; a read landing during a TUI agent's
  attach startup kills the attach, code 1, silently — opencode died on
  every click in the sandbox (and on Raven's machine), while a dumb
  prompt never noticed. Proof: disabling the poller made the opencode
  attach stay up 10 s; re-enabling the skip made it stay up in every
  test since. The server log shows the attach connecting fine and the
  client detaching on its own ~1.4 s later — the kill comes from the
  read, not the server. Rule: the poller reads ONLY panes with no live
  attach — never the selected agent, never a pane another terminal
  holds an attach to. TerminalPanel reports attach state up through
  `onAttachState(paneId, attached)`; App keeps the set and passes it
  to ChatView as `skipReadPaneIds`. The selected agent is skipped
  unconditionally as well (a read could land between mount and
  register). A dead attach unregisters on exit, so the poller resumes
  reading that agent and its preview/dots come back.
- **Dead panes reconnect.** When a shell exits, the pane shows
  `Shell exited (code N).` and a `↻ Reconnect` button that re-spawns
  the same command in a fresh terminal (a `spawnNonce` in the effect
  deps). The chat attach has no close button, so without this a dead
  chat was a dead end — now it is a way back.
- **Pty resizes are debounced (150 ms, trailing).** Mounting a pane
  makes its host grow a column at a time while the layout settles (the
  chat attach saw 103 → 123 in ~20 steps); the storm was first
  suspected in the shell-exit hunt, and the debounce collapses it into
  one resize to the final size. The exit's real cause was the poller
  read (above) — the debounce is still the right shape: less IPC
  chatter, and a TUI agent never sees a SIGWINCH storm. The xterm
  itself still reflows instantly; only the pty is told late.
- **Terminal splits are resizable.** Dividers between panes drag to
  move width between neighbours (min 10% each, measured against the
  sizes at drag start so a fast drag never drifts). Splitting divides
  the last pane's share; closing hands the closed pane's share to its
  neighbour. The panes reflow through the same ResizeObserver → fit
  path, so the debounced resize keeps the pty in step.

## Agent chat — keep-alive + Reconnect all (0.6.0)

- **The chat attach stays alive across tab switches.** ChatView
  mounts on first visit and is hidden (display:none) instead of
  unmounted when you leave the tab — the same shape the Terminal tab
  already used for its panes. The attach keeps its pty and its
  scrollback; coming back is returning, not relaunching. The poller
  keeps running while hidden, so previews and dots stay fresh.
- **Never fit a hidden pane to zero.** A display:none host is 0-size;
  fitting it would shrink the pty to a couple of columns, and a TUI
  agent reflows — or, at 20x5, segfaults — on that. Terminal.tsx's
  fit runs only when the host has size (`fitIfVisible`), in both the
  initial fit and the ResizeObserver callback. When the tab shows
  again the observer fires and the fit lands.
- **Reconnect all.** Every TerminalPanel reports its exit state up
  (`onExitState(paneId, dead)` — true on exit, false on spawn and on
  unmount, so a closed pane leaves the count). App counts dead panes
  across tabs (terminal panes + the chat attach) and shows a sidebar
  "↻ Reconnect all (N)" button while any are dead. Clicking it bumps
  a `reconnectSignal` that each dead pane answers by re-spawning
  itself — the same path as its own Reconnect button, driven by the
  existing spawnNonce. A live pane ignores the signal, and a pane
  that dies later does not auto-reconnect: the button is a deliberate
  act, not a standing order.
- **A dead renderer must not leave orphaned ptys.** The old panes
  never run their cleanup — a reload tears the JS context down first,
  a crash never runs it — so an orphaned `herdr agent attach` keeps
  holding its pane and every new attach to it exits code 1
  (double-attach). Main kills all ptys when the renderer goes away:
  `did-start-loading` (a reload starts a new renderer),
  `render-process-gone` (a crash), and `destroyed` (a closed window).
  The fresh renderer re-spawns what it needs. Proven by the test
  below: a reload used to poison the attach, now it does not.
- **CDP tests reload the page first.** Keep-alive means a warm
  instance is NOT a fresh one — a second run against the same instance
  used to misidentify the shell/attach ptys and fail spuriously. Every
  CDP test now starts with `Page.reload` (safe since the orphan fix)
  and waits for the app to come back. The chat-list test is also
  rig-agnostic on agent count now (it used to hardcode "2 live" /
  rowCount 2 and failed on a 3-agent rig).
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
- **`/usr/bin/halo` comes from our own after-install script, not the
  default postinst** (2026-11-11, 0.3.0): setting `deb.afterInstall`
  REPLACES electron-builder's default postinst, which is what registers
  `/usr/bin/halo` via update-alternatives — so from 0.1.7 (when
  `scripts/after-install.sh` was added) until 0.3.0, no install created
  the symlink at all and `halo` was command-not-found even after a clean
  apt install. Only rofi worked (its .desktop Exec points at
  /opt/Halo/halo directly), so nobody noticed. `after-install.sh` now
  registers the alternative itself (`update-alternatives --install
  /usr/bin/halo halo /opt/Halo/halo 100`, falling back to `ln -sf`);
  the postrm already removes it. Verify `/usr/bin/halo` exists after
  every pack, and remember a `deb.afterInstall` script replaces — never
  appends to — the default postinst.
- **chrome-sandbox must be 4755 — set it in after-install.sh** (2026-11-11,
  0.3.0): fpm strips the setuid bit when building the deb, so the
  packaged app FATALs on machines without unprivileged user namespaces
  ("The SUID sandbox helper binary was found, but is not configured
  correctly") — this sandbox is one; Debian's default (user namespaces
  on) is why Raven never hit it. `after-install.sh` now does
  `chmod 4755 /opt/Halo/chrome-sandbox` (postinst runs as root). Verify
  the mode after every pack.
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
- **Killing Electron from a shell: never pattern-match your own command
  line.** `pkill -f "[e]lectron"` is flaky here — the bracket trick
  fails when the tool wraps the command, and one bad kill SIGKILLs your
  own shell (seen 2026-11-11, 0.4.0). `pkill -f` with ANY pattern is
  unsafe: it matches the pattern text in your own shell's argv too
  (0.5.0 cleanup: `pkill -f "Xvfb :"` SIGTERMed the shell that ran it).
  Reliable method: scan /proc with the pattern held in a variable built
  from split quotes so the literal never appears contiguously in your
  argv:
  `pat="/opt/Ha""lo"; pat2="/usr/bin/ha""lo"; for p in /proc/[0-9]*; do
  c=$(tr '\0' ' ' < $p/cmdline 2>/dev/null); case "$c" in
  *"$pat"*|*"$pat2"*) kill -9 ${p#/proc/};; esac; done`. This catches
  the main process (/usr/bin/halo), zygotes and renderers (/opt/Halo).
  Verify the CDP port is free afterwards (`ss -ltn | grep 9222`).
- **Kill and relaunch in SEPARATE exec calls.** The kill exec's own text
  must not contain the target string anywhere else — one launch line
  with `npx electron` in the same command SIGKILLs your own shell
  (seen 2026-11-11, 0.5.0). The same trap bites inside ONE command:
  a verification `grep` later in the pipeline whose pattern matches
  the kill target kills the shell running the loop (seen 2026-11-11,
  0.6.0 — a `grep "herdr agent attach"` after the kill loop). Keep
  the kill exec free of the target string in EVERY stage, and verify
  in a follow-up exec.
- **Backslashes die inside template-literal CDP expressions.** A
  template literal in a `.mjs` test script eats `\d` in a regex before
  the expression reaches the page, so `/w\d+:p\d+/` becomes
  `/wd+:pd+/` and matches nothing. Write regexes in test expressions
  with character classes (`/w[0-9]+:p[0-9]+/`) or double the
  backslashes — never a single `\d`, `\w`, or `\s`.

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
