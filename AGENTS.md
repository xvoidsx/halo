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
- `herdr agent list` is a JSON envelope, verified live against herdr 0.9.5
  (see "Herdr CLI — verified live" below): the payload is under
  `result.agents`, there is NO top-level `agents` key. Unrecognized JSON
  returns null and the raw output is shown — never read a shape mismatch
  as an empty list.

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

## Chat layout — the infinite-expansion bug (0.6.1)

- **A flex item's automatic minimum size is its content, and an
  xterm's width IS content.** The chat terminal grew ~35px/s forever
  (measured: the wrap 927 → 1410 in 14 s, the document's
  scrollWidth with it) because the chat's `.terminal-wrap` never got
  the `min-width: 0` that `.terminal-panes` gives its own wraps —
  so the fit loop ran away: fit measures the host, widens the
  terminal, the widened terminal widens its ancestors, fit measures
  again. The Terminal tab was immune the whole time because its
  wraps ARE constrained. Fix: `min-width: 0` on every flex item on
  the path from the window to a terminal (`.terminal-view`,
  `.terminal-wrap`, `.terminal-panes`, `.terminal-host`,
  `.chat-view`, `.chat-wrap`), and `overflow: hidden` on
  `.terminal-host` so a terminal can never push the document wider
  even mid-resize. The xterm still fits exactly (host − padding).
- **Regression test:** `scripts/chat-layout-test.mjs` opens Chat on a
  real opencode agent, samples the layout for 10 s, and asserts no
  horizontal overflow, the wrap never exceeding its container, and
  the width stable — then the same after switching agents. Only a
  real TUI agent triggers the loop; a fake pi never did.

## Chat attach race — the poller can still kill a starting attach (0.6.1)

- **The 0.5.0 fix had two windows left.** The poller skips the
  selected pane and any pane with a live attach, but both skips are
  refs updated by effects — one render cycle after the click — and a
  background sweep that reaches the pane in that window reads it
  just as the attach starts (code 1). Worse, a read that was
  ALREADY in flight when the user clicked can't be stopped at all.
  The opencode attach died ~2 times in 5 clicks before this fix
  (the splits test caught it twice; the 0.6.0 session just got
  lucky). Fixes, both in the chat path:
  1. **Synchronous skip on select** (`ChatView.select`): the
     poller's `selectedRef` is set in the click handler itself, in
     the same instant as the state — the pane stops being background
     the moment it's picked, not a render later.
  2. **One silent re-spawn** (`Terminal.tsx`): an attach that exits
     code 1 in its first 3 s gets re-spawned once, with no dead-pane
     UI. The in-flight read is done by then, so the retry starts
     clean. Only once, only for attaches, only in the first 3 s —
     a genuinely broken attach still lands dead with Reconnect.
     The count resets per pane and on manual Reconnect, so it can
     never loop.
- **Proof:** the splits test's opencode check (the race's witness)
  passed 3× in a row on dev and 2× in a row packaged after the
  fix, after failing 2 of 5 before it.

## 0.6.2 — resizable sidebar, pane shortcuts, pane menu (2026-11-12)

- **Resizable sidebar.** Drag handle on the sidebar's right edge
  (`.sidebar-divider`, 6px, pointer-drag like the terminal
  dividers), 200–420px, persisted in `localStorage`
  (`halo.sidebarWidth`). It is a UI preference, not a secret, so it
  lives in localStorage — not in settings.json, which holds
  provider keys. `scripts/sidebar-shortcuts-test.mjs` covers the
  drag, the clamp, and persistence across a reload (18 checks).
- **Pane shortcuts — Raven's Kitty vocabulary, not a new one.**
  Ctrl+Shift+D splits the focused pane, Ctrl+Shift+Q (or X) closes
  it, Ctrl+Shift+Arrow moves focus between panes. Kitty's exact
  scheme, settled 2026-10-08 (Ctrl+Shift+H is horizontal split
  there, Ctrl+Shift+V stays paste — neither is used here). No
  leader key: a Ctrl+B leader would steal herdr's own prefix from
  any herdr TUI running in a pane. Split works from any tab (it
  switches to Terminal); close and focus-move only on the Terminal
  tab, so a hidden pane is never closed by surprise. Split inserts
  AFTER the focused pane and halves its share (`splitPane`); the
  Split button uses it too, while "Open herdr" / "Jump to terminal"
  still append at the end (`addTermPane`).
- **Capture phase is load-bearing for shortcuts.** The xterm's
  textarea handles keys before a bubble-phase window listener ever
  sees them, so a bubble listener is too late — the key is already
  in the shell. The shortcut listener runs on window with
  `capture: true` and `stopPropagation()`s only the keys it
  handles; every other key is left alone. Editable targets (real
  inputs, non-xterm textareas) are skipped so typing in a settings
  field is never hijacked.
- **Right-click pane menu.** `.ctx-menu` at the cursor: Split right
  (Ctrl+Shift+D) and Close pane (Ctrl+Shift+Q, disabled when it is
  the only pane). Dismissed by picking an item, clicking elsewhere,
  or Escape. Terminal-tab panes only — the chat attach has none.
  React renders the menu on the next tick, so a test must await a
  beat after dispatching the contextmenu before asserting it exists.
- **Focus tracking.** TerminalPanel reports focus via a `focusin`
  listener on its host (xterm.js 6.0.0 has no `onFocus` event on
  the Terminal type — `tsc` rejects `term.onFocus`). The parent
  keeps `focusedPaneId`; a pane focuses its terminal when its
  `focused` prop turns true, and closing a pane moves focus to the
  neighbour that took its share.
- **`Number(null)` is 0, not NaN.** The sidebar-width initializer
  clamped a missing localStorage key to the 200px floor instead of
  the 280px default, because `Number(null)` is `0` (finite). Check
  for a null key explicitly before converting.
- **A ref synced by an effect lags a drag.** The first sidebar
  persistence saved the pre-drag width: the pointermove/pointerup
  burst fires before React re-renders and the effect syncs the
  ref. Update the ref synchronously inside `onMove` instead.
- **CDP modifier bits are Alt=1, Ctrl=2, Meta=4, Shift=8.**
  Ctrl+Shift is 10, not 6 — modifiers 6 is Ctrl+Meta, which is why
  the first shortcut test saw `shift: false, meta: true` and every
  shortcut silently did nothing. (And a test that asserts a count
  can pass vacuously when the action never ran — assert the count
  CHANGED, not just its final value, where it matters.)
- **UI smoke test needs a fresh launch.** It checks the Trails
  empty state (`.trail-orbit`, "Waiting on trails"), so it fails
  on a warm instance sitting on another tab. Restart the app, run
  it first. Same for the chat-list test — a re-run after the
  splits/keepalive tests is the honest read.

## Terminal resize propagation — proven, and its limit (2026-11-12)

- **Halo's pty resize is correct.** Measured with `stty size` in a
  live shell pane: full width 41x140, after split 41x68, after a
  150px divider drag 41x47 / 41x90 for the 347px / 646px panes.
  The 150 ms debounce collapses the layout-settling storm into one
  resize, and the process sees the final size. So when a TUI in a
  Halo pane renders at the wrong size, the pty is not the culprit —
  look downstream, at the app inside the pane.
- **The herdr TUI in a Halo pane is the downstream case.** Its
  welcome dialog rendered clipped at a 321px pane (drawing wider
  than the pane) and reflowed correctly when the pane widened to
  469px — so herdr does respond to resizes, but its initial render
  can be at the wrong size (the pty size at spawn, while the layout
  is still settling) and its redraw can leave stale content. And
  opening the herdr TUI in a NARROW Halo pane killed the live
  opencode agent: opencode segfaulted (its known tiny-size death)
  and dropped off `herdr agent list` (3 live -> 2 live), with a
  herdr crash-report artifact in the pane. herdr's TUI resizes its
  workspace panes to fit its own terminal, so a narrow TUI pane
  can shrink an agent's pane to a segfault size. That is a
  herdr/opencode fragility, triggered through Halo — worth a
  warning, and worth reproducing the nested agent view before
  promising a Halo-side fix.
- **0.6.2 follow-up: herdr DOES track the resize.** `herdr api
  snapshot` shows the layout area moving with the Halo pane
  (48 cols at a 534px pane, 38 cols at 285px) — the chain
  Halo pty -> herdr TUI -> herdr server layout is intact. What
  herdr does with that area is its own layout algorithm: in the
  test rig's workspace (17 panes from repeated splits) the
  opencode pane was assigned width 0, so it could not render at
  all. No Halo-side fix follows from this — the opencode
  rendering issue is herdr's internal pane layout and opencode's
  redraw, both downstream of Halo. Do not over-split a herdr
  workspace; if an agent looks cut off, resizing the pane or
  re-attaching is the practical fix.
- Agent messages in the chat are text actually read from the pane. If a
  poll returns a snapshot that no longer starts with the previous one
  (scrollback scrolled past the window), the whole snapshot is shown —
  never diffed into invented text.

## 0.6.3 — settings round + close-crash fix (2026-11-12)

- **Settings scrollbar sits at the far-right edge now.** The Settings
  view's root div was itself the 640px-capped scroller, so its
  scrollbar floated mid-window. Now the outer `.main-body` is the
  full-width scroller and the 640px column is an inner div — the
  scrollbar rides the viewport edge, the content stays narrow.
  Pattern: the scrolling element is always full-width; the narrow
  column lives inside it.
- **Seven more BYOK providers** (11 cards total): Groq, Mistral,
  Hugging Face, Google Gemini, xAI, Venice, TrustedRouter — alongside
  Ollama (no key) and the original DeepSeek / OpenAI / Anthropic /
  OpenRouter. Keys still connect to nothing; they only save locally
  to settings.json (0600). When adding a provider, add its key in
  THREE places: `BYOK_PROVIDERS` (App.tsx), the `byok` type +
  defaults (types.ts), and the explicit per-key load-merge in
  `electron/settingsFile.ts` — the merge drops any key it doesn't
  name, so an old settings file silently loses a new provider's key.
- **Terminal font size** is a setting now (11–18px, default 13),
  applied live to every pane and the chat attach without re-spawning:
  Terminal.tsx takes a `fontSize` prop, sets `term.options.fontSize`,
  and re-fits. Verified: 13px = 139 cols, 16px = 108 cols on the
  same pane.
- **Version display** in Settings ("Version 0.6.3", from
  `app.getVersion()` via a `halo:getVersion` IPC channel) and a
  **Reset sidebar width** button (back to 280px, clears the
  localStorage key).
- **Save errors are honest now.** SettingsView's save is try/catch —
  a failed save shows "Could not save: <message>" instead of silently
  doing nothing. It caught a real one in the sandbox: the packaged
  test instance was launched as root with HOME=/home/halotest, so
  `/home/halotest/.config/halo/` was root-owned 700 and halotest's
  saves threw EACCES. **Packaged test launches must run AS the test
  user** (`su halotest -c ...`), never as root with the test user's
  HOME — a root-owned config dir silently breaks settings saves (and
  the app still runs fine otherwise, so nothing looks wrong until you
  check the log).
- **Close-crash fix (Raven's bench, 2026-11-12 01:29).** Closing Halo
  showed Electron's "A JavaScript error occurred in the main process
  — Object has been destroyed" dialog: a pty flushing a final chunk
  after the window closed called `win.webContents.send` on a
  destroyed webContents. `win?.` only guards a null win, not a
  destroyed one. Both send callbacks in main.ts now check
  `win && !win.webContents.isDestroyed()` before sending (the check
  and the send are synchronous, so no race between them).
- **Close-test zombie rule.** After `Browser.close` the main process
  can exit but linger as an unreaped zombie under the su/xvfb-run
  parent, so `process.kill(pid, 0)` keeps succeeding for a dead
  process. `scripts/close-test.mjs` reads `/proc/<pid>/stat` and
  treats state `Z` as exited. The packaged close test failed 3x on
  the old check and passes on the hardened one — the app itself
  always exited cleanly (exit 0, port freed); the test was watching
  a corpse.

## Trails — live data from the Entire CLI (0.7.0, 2026-11-12)

- **Trails are real now, not stubs.** `halo:listTrails` / `halo:getTrail`
  shell out to the Entire CLI: `entire trail list --project <project>
  --json` for the sidebar, `entire trail show <id> --project <project>
  --json` for the detail. `watchTrail()` is still a stub —
  `entire trail watch --json` is the source when live streaming lands.
- **The project is a Settings field, not derived.** `HaloSettings.entire
  .project` (e.g. `et/xvoidsx`, `gh/xvoidsx`), edited in Settings →
  Entire Trails. `entire trail list` requires `--project`, so an empty
  project means an empty list with an honest detail ("No Entire project
  configured — set it in Settings → Entire Trails."), never a bare
  "No trails yet." Deriving the project from repo remotes was
  considered and rejected as too fragile.
- **The CLI boundary is defensive because the JSON shape is
  provisional.** `runEntire` (electron/herdrAdapter.ts, 15 s timeout —
  network calls get longer than herdr's 5 s) returns code -1 with
  "entire not found on PATH" on ENOENT. `trailArray` accepts a bare
  array or an object with `trails`/`items`/`data`; anything else is
  "Unrecognized `entire trail list --json` shape — nothing listed."
  Field names (`id`/`ulid`/`number`, `repo`/`repository`, findings'
  `suggestedFix`/`fix`/`suggestion`) are docs-grounded guesses —
  tighten them against Raven's real `--json` output before calling
  this done; his exact output becomes the test fixture.
- **No evals yet is a state, not a zero.** `Trail.scores` is
  `EvalScores | null`; a trail with no review-agent scores renders
  "No evals yet" instead of invented numbers. Findings/gates map
  through severity/status whitelists (anything unrecognized falls
  back to `info`/`open`/`pending`), never fabricated.
- **Refresh shape.** List refreshes on mount, every 30 s (network
  API — deliberately slower than the 10 s herdr poll), and whenever
  the Trails nav button is clicked. Selecting a trail fetches its
  detail once into `trailDetails` (keyed by id), so the 30 s list
  refresh never clobbers a fuller trail with its thin list row.
  The current selection survives a refresh when its id is still
  listed, else the first trail is auto-selected.
- **Verification: fake `entire` + CDP test.**
  `~/workspace/.tmp/fakebin/entire` serves Raven's REAL `trail
  list` + `trail show --json` output (2026-11-12) for `trail list` /
  `trail show`; `scripts/trails-test.mjs` (5 checks:
  not-configured note, trail appears live, detail renders the real
  trail honestly — phase, "No evals yet", empty states for
  findings/gates/runs/sessions — Entire link, Settings field holds
  the project) passes dev against it. The test seeds the settings
  file itself (main reads it fresh on every list call, so no restart
  is needed between phases) — and leaves `entire.project` set to
  `et/trails-test`, so run the UI smoke test with the project
  cleared first: it checks the empty Trails view and fails while a
  fixture trail is listed (seen 2026-11-12).
- **Main-process changes need an app restart — Page.reload only
  refreshes the renderer.** A stale main silently serves old mapping
  code: after the `phase`/`url` adapter edits, the trails detail
  test failed on "planning" + the Entire link until the dev app was
  closed and relaunched (the renderer had the new empty-state notes,
  the main still returned trails without phase/url). Restart the dev
  app after any `electron/` change, then re-run the tests.
- **Packaged tests run AS halotest, not root.**
  `su halotest -c 'env -i HOME=/home/halotest
  PATH=/home/halotest/.local/bin:/home/halotest/fakebin:/usr/bin:/bin
  xvfb-run … /usr/bin/halo --no-sandbox --remote-debugging-port=9222'`;
  the CDP tests run as halotest too (`su halotest -c 'PATH=/usr/bin:/bin
  node …/scripts/<test>.mjs 9222'`) so the trails test's
  `os.homedir()` lands on halotest's settings file. Setup: the fake
  `entire` is copied to `/home/halotest/fakebin/entire`, and the repo
  tree is root-owned 660 — `chmod o+x` on `halo/` + `scripts/` and
  `a+r` on `scripts/*.mjs` so halotest can read the test scripts.
  The packaged trails test needs the fake on halotest's PATH the same
  way the dev test needs it on the dev app's PATH. (0.7.0 packaged
  suite: ui-smoke, settings, trails, close — all green as halotest.)
- **Rig spec correction (2026-11-12).** The intended herdr rig is
  THREE agents — fakepi on w1:p1, fakepi2, opencode-test — because
  chat-list-test requires a fakepi2 agent (it asserts row 2 and sends
  to it). A VM replacement had wiped `/tmp/setup-rig.sh` and left
  the restored w1 (17 panes) as dead stubs; the rebuild stops the
  server, removes the stale session state (`~/.config/herdr/
  session.json`, `sessions/`, `session-snapshots/`), and restarts
  with the fake binaries on PATH. Full dev suite green on the
  rebuilt rig (chat-layout 8/8, keepalive 14/14, splits 10/10,
  herdr-e2e pass, settings/sidebar/trails/parser/pty/close pass).
- **chat-list has a timing flake, not a regression.** On the correct
  rig it failed 1 in 3 runs on `attachRenders` alone (everything
  else green, the send provably landed in the pane's scrollback) and
  passed on immediate re-run — the known 0.6.1 attach-start race is
  the candidate, unproven at the micro level. No code change; if it
  recurs, lengthen the test's poll/retry, not the app.

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
