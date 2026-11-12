# AGENTS.md — Halo

Halo — a nightshade neon Electron shell that puts your whole workspace in
one live view: herdr agents, Entire trails, GitHub pull requests, and
Linear issues. Two-week spike (Nov 2026),
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
- **2026-11-12 (0.11.0 bench, Raven): the clip is back — and the
  mechanism is now photographed.** Two probe scripts
  (`scripts/opencode-width-probe.mjs`,
  `scripts/opencode-herdr-view-probe.mjs`) with screenshots in the
  tree (`.tmp-opencode-*.png`): a DIRECT attach
  (`herdr agent attach w1:p2` in a Halo pane) renders opencode
  FULLY at 68 cols — logo, prompt, footer all visible. The clip
  lives in the NESTED case, Halo pane -> herdr TUI -> herdr
  workspace panes -> opencode. At full Halo width (140 cols) the
  herdr TUI gives opencode's sub-pane ~200px: the logo is cut off
  mid-word and the prompt wraps character by character. At split
  Halo width (68 cols) the TUI squeezes it further and opencode
  SEGFAULTS (Bun crash report in the pane) and drops off
  `herdr agent list` entirely — the agent has to be restarted
  (the rig rebuild does it). So: the nested herdr TUI is the
  fragile path; the direct attach is the safe one. Halo-side
  mitigations (the 0.13.0 QoL answer): per-pane font zoom and
  pane maximize, so the user can give a pane the width opencode
  needs; the standing guidance stays — use Chat attach for agents
  instead of the nested herdr TUI when panes are narrow.
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

## Trails — live data from the Entire CLI (0.7.0–0.8.0, 2026-11-12)

- **Trails are real now, not stubs.** `halo:listTrails` / `halo:getTrail`
  shell out to the Entire CLI: `entire trail list --project <project>
  --json` for the sidebar, `entire trail show <id> --project <project>
  --json` for the detail. Live streaming landed in 0.13.0
  (`startTrailWatch`, `entire trail watch --json` — see the 0.13.0
  entry); the old `watchTrail()` stub is gone.
- **The project is a Settings field, not derived.** `HaloSettings.entire
  .project` (e.g. `et/xvoidsx`, `gh/xvoidsx`), edited in Settings →
  Entire Trails. `entire trail list` requires `--project`, so an empty
  project means an empty list with an honest detail ("No Entire project
  configured — set it in Settings → Entire Trails."), never a bare
  "No trails yet." Deriving the project from repo remotes was
  considered and rejected as too fragile. Live streaming arrived in
  0.13.0 (`startTrailWatch`, `entire trail watch --json` — see the
  0.13.0 entry); the old `watchTrail()` stub is gone.
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
  **Re-copy the fake to /home/halotest/fakebin after any fake change**
  — the packaged app reads halotest's copy, not ~/workspace/.tmp.
  Also reset halotest's settings file to `projects: []` before the
  packaged ui-smoke run, or the leftover project lists a trail and
  the empty-state checks fail (seen 0.8.0). The packaged
  github-test needs `HALO_TEST_REPO=/home/halotest/repos/halo-test`
  in its env — without it the test seeds the hatch workspace path
  and the branch-status check fails on git's dubious-ownership
  refusal (halotest running git in hatch's repo).
- **0.8.0 — multi-project sidebar (2026-11-12): Trails stays Entire-only.**
  Settings holds a project *list* (`entire.projects`, one per line);
  the old single `project` string migrates in place on load
  (`settingsFile.ts` `normalizeEntire`). `listTrails(projects)` fetches
  each project in turn; one project's failure lands in the detail note
  instead of blanking the others. Each trail carries its project, so
  the sidebar groups by slug — native (et/) under Trails, mirrored
  (gh/) under their own GitHub section — and the detail fetch passes
  that trail's project back (`getTrail(id, project)`; the renderer
  reads it from a `trailsRef` mirror so the 30 s refresh never
  re-fetches the detail). The gh fixtures are transcribed from Raven's
  screenshot of his gh trail (real id/title/url), not his JSON — swap
  them for the real `trail list/show --project gh/rav3ndust --json`
  when he pastes it. Close-test flaked once on the 10 s window during
  the 0.8.0 suite (still alive after 10 s, then killed by the test's
  cleanup) — that was the same bug, NOT timing (corrected 2026-11-12
  after Raven's 0.7.0 screenshot proved the dialog still appears on
  close).
- **Close crash, real root cause (2026-11-12, fixed in 0.8.0):** the
  0.6.3 guard checked `win.webContents.isDestroyed()` first — but
  accessing `.webContents` on a destroyed BrowserWindow throws
  "Object has been destroyed" BEFORE the check ever runs. Proven with
  a throwaway Electron script (`win.webContents` throws on a destroyed
  window; `win.isDestroyed()` returns true safely) and by the 0.7.0
  dialog's stack (main.js:61:25 — the `.webContents` access inside
  the `if` condition, not the send). The fix funnels both sends through
  one `sendToRenderer` helper: `win.isDestroyed()` first (the only
  safe touch on a dead window), then the webContents check, then the
  send inside try/catch. The busy-pty close test
  (`scripts/close-busy-test.mjs`, spawns a `yes` pty then closes)
  did NOT reproduce the hang even on the buggy build — the sandbox
  process exits before the pty's buffered read lands, while Raven's
  busier machine gives the loop a tick longer — so it is regression
  cover only; the proof is the destroyed-window experiment above.
  Lesson: a guard must only touch APIs that are safe on the object it
  guards; verifying the guard's presence in the asar is not verifying
  it works.
- **0.9.0 — GitHub-native view + forge switcher (2026-11-12).** The
  sidebar's top is a forge switcher (Entire / GitHub marks, one
  forge's list at a time); the GitHub view is PRs + issues together
  via the `gh` CLI, with branch status read-only. Design, all
  Raven-approved: Trails stays Entire-only (et/ projects under
  Trails, gh/ mirrors under their own section inside the Entire
  view); GitHub goes GitHub-native (PR check status + reviewers in
  rows, labels/assignees on issues); push/pull buttons come only
  after the read-only view proves itself. `electron/githubAdapter.ts`
  is the boundary (new file, mirroring herdrAdapter.ts's Trails
  shape): `runGh` (15 s, ENOENT → code -1), `listGitHub(repos,
  localRepos)` (per-repo `gh pr list` / `gh issue list --state open
  --limit 50 --json <fields>`; one repo's failure lands in the detail
  note instead of blanking the others), `getPR` / `getIssue`
  (`gh pr view` / `gh issue view --json`), `slugForPath` +
  `statusForPath` (local git: origin → owner/repo, `git status
  --porcelain=v2 --branch` → branch/ahead/behind/dirty). `gh` JSON
  fields verified against the real CLI help (gh 2.102.0, JSON FIELDS
  lists: pr — number, title, state, author, url, headRefName,
  baseRefName, isDraft, reviewDecision, statusCheckRollup, additions,
  deletions, changedFiles, comments, reviews, labels, createdAt,
  body; issue — number, title, state, author, url, labels, assignees,
  createdAt, comments, body). Checks map from `statusCheckRollup`:
  any failure verdict fails the row, any run still going pends it,
  anything else that completed passes; empty rollup is 'none'.
  **Trap:** `gh ... view --json` returns `comments`/`reviews` as
  ARRAYS, not numbers — the mapper counts them (`countOf`), a bare
  number passes through. Settings holds a `github.repos` list
  (owner/repo, one per line; `normalizeGitHub` in settingsFile.ts).
  The renderer keeps the forge in localStorage (`halo.forge`) and the
  GitHub selection/detail in the same shape as trails (`ghRef`
  mirror, `ghDetailNote` for a failed detail fetch — the views take
  the list row OR the fuller detail, and `'body' in pr` distinguishes
  them, so "Loading description…" is honest while the call is in
  flight). **Logos:** the switcher uses the vendors' own marks
  unmodified, as platform indicators only — GitHub's brand page
  explicitly permits this ("Show integration — Use a permitted GitHub
  logo to inform others that your project integrates with GitHub");
  use the Invertocat mark (not the full Octocat character, which has
  tighter rules), in white/black, smaller than Halo's own logo, never
  as Halo's branding and never implying endorsement. The Entire mark
  is their favicon SVG (entire.com/favicon-dark.svg); the GitHub
  mark is the official Invertocat. Both live as inline SVG in
  `src/ForgeLogos.tsx` (currentColor, so the inactive forge dims).
  **Verification:** fake `gh` in ~/workspace/.tmp/fakebin/gh serves
  SYNTHESIZED fixtures in the real shapes (swap for real `gh`
  output when Raven pastes it); `scripts/github-test.mjs` (10 checks:
  not-configured note, both marks in the switcher, PR 42 passing /
  PR 41 failing pills, issue 17, branch status from REAL git —
  'main · up to date · 7 changed' on the dev tree — PR + issue
  detail with body/comment counts/GitHub link, Settings field, and
  switching back to Entire at the end so the next ui-smoke sees the
  Trails view). Packaged runs need the fake copied to
  /home/halotest/fakebin/gh AND `HALO_TEST_REPO` set to a repo
  halotest owns (its test repo at /home/halotest/repos/halo-test,
  origin github.com/xvoidsx/halo) — the root-owned tree is not
  git-readable by halotest. Full dev suite green on 0.9.0
  (ui-smoke, settings, sidebar-shortcuts, trails, github, chat-layout,
  keepalive, splits, chat-list — flaked once on attachRenders, passed
  on immediate re-run, the known timing flake — herdr-parser,
  herdr-e2e, pty-smoke, close ×2, close-busy).
- **0.10.0 — Linear issues as a third forge (2026-11-12).** The
  switcher grows to three buttons (Entire / GitHub / Linear) and
  the Linear view lists issues from the `linear` connector CLI.
  `electron/linearAdapter.ts` is the boundary: `runLinear` tries
  `linear` on PATH, then the documented connector location
  `/opt/hatch/bin/linear` (a packaged app's desktop-session PATH
  may not include it); calls are `call-tool --name <tool>
  --arguments-json '<json>'` (15 s timeout, ENOENT → code -1).
  **The output is an MCP envelope, parsed TWICE:** outer JSON,
  then `result.content[0].text` as a second JSON string
  (`parseMcp`). `list_issues` → `{issues, hasNextPage}` (limit 50,
  orderBy updatedAt, team filter when set); `get_issue` → the issue
  object itself at top level; `list_comments` → `{comments}`.
  **Trap:** the list TRUNCATES the description ("(truncated, use
  `get_issue` for full description)") — the detail view must fetch
  `get_issue` and never show the cut-off paragraph as the
  description (the `'description' in issue` guard, same pattern as
  GitHub's `'body' in pr`). Issue fields verified live against
  Raven's workspace (50 issues, one team `xvoidsx`): id is the
  identifier (`XVOIDSX-71`), status is the workflow name
  (Backlog/Todo/In Progress/Done), statusType its bucket, priority
  `{value, name}`, labels by name, assignee absent when unassigned
  (defensive `personName`: string, or object `.name`). Comments
  verified real on XVOIDSX-68 (2, from Linear + rav3ndust):
  `{id, author: {id, name}, body, createdAt}`. Settings holds a
  `linear.team` string (default `xvoidsx`; empty = whole workspace;
  `normalizeLinear` falls back to the default on a stray type).
  Read-only by construction: the connector's first grant is
  read-only and Halo only calls read tools — no token held, it
  rides the existing OAuth. **Logos:** Linear's brand page allows
  the logomark for tight layouts/logo-only grids, monochrome,
  unmodified, no endorsement implied — but unlike GitHub it has no
  explicit "show integration" blessing, so the use stays strictly
  inside their stated rules. The mark is the simpleicons tracing
  (CC0, same as GitHub's). **Verification:** fake `linear` in
  ~/workspace/.tmp/fakebin/linear serves REAL fixtures (list of 5,
  get_issue 71 + 68, comments on 68) from
  linear-fixtures/*.json — nothing synthesized; a non-xvoidsx team
  lists empty; `scripts/linear-test.mjs` (8 checks: unknown team
  note, three marks, 71 Backlog / 54 Done / 68 Todo pills, 71
  detail with the real description + 0 comments + Linear link, 68
  detail with its 2 real comments, Settings team field, back to
  Entire). The github-test's switcher check had to grow with the
  forge (2 → 3 buttons) — any test asserting the switcher count
  must be updated when a forge joins. Full dev suite green on
  0.10.0 (ui-smoke, settings, sidebar-shortcuts, trails, github,
  linear, chat-layout, keepalive, splits, chat-list, herdr-parser,
  herdr-e2e, pty-smoke, close, close-busy — close-busy raced the
  app startup once, passed on immediate re-run). Tagline decided
  the same night: Raven asked whether the sidebar's "herdr, trails,
  one live view" should go (it describes the 0.7.0 app); options
  offered were "your workspace, one live view" (Lain's pick — it
  can't go stale when notes land), "agents, forges, one live view",
  "agents, issues, one live view" — Raven picked "your workspace,
  one live view", shipped as 0.10.1 (sidebar tagline + the README /
  AGENTS.md one-liners, which now name all four forges).
- **0.11.0 — connections, dual transports, notes, spawn (2026-11-12).**
  Raven's brief: frictionless setup — the user should never have to
  figure out which CLI is missing or how to sign in. Four pieces,
  all approved in one message (dual transports included, "use your
  best judgment", aesthetics latitude granted), plus his agents
  dropdown idea folded in.
  - **Connection dots** (`electron/connections.ts`, `getConnections`
    over `Promise.all`): every forge button carries a steady dot —
    green (present + authed), amber (present, not authed), grey (not
    installed) — steady glow, never flashing (flashing reads as an
    alarm). Same dot + a plain status line in each forge's Settings
    section. Probes: `gh auth status` (exit 0 + parse the account),
    `entire auth status --json` (exit 0 + `user` string or the
    `current` entry of `sessions[]` — the --json shape is ASSUMED,
    docs-described only, so any exit-0 JSON counts as signed in),
    Linear = connector `list_issues {limit: 1}` else GraphQL
    `viewer`, Notion = connector `notion-get-self` else REST
    `/users/me`, herdr = `detectHerdr()`.
  - **Installers — download + verify, never execute a script.**
    One code path for gh + entire: `resolveLatestTag` (GitHub
    releases/latest), download the archive + its checksums file,
    sha256-verify against the published checksums (refuses on a
    mismatch or a missing entry), extract with system `tar`, copy the
    binary to `~/.local/bin` (chmod 755). gh from
    api.github.com/cli/cli (latest v2.103.3, tarball layout
    `gh_<ver>_linux_<arch>/bin/gh`); entire from install.entire.com
    (`v<version>/entire_<os>_<arch>.tar.gz` + checksums.txt, same
    origin as their install.sh uses — plus the GitHub releases
    fallback origin), installing `entire` + `git-remote-entire`.
    ntn is `npm install -g ntn` (0.23.29 on npm). No sudo anywhere.
    `opts.version`/`opts.base` overrides exist so the install test
    can drive them against a fixture server — use them, never a live
    release, in tests.
  - **Connect** is a setup terminal pane running the login command
    (`gh auth login`, `entire login`) — Halo already spawns
    terminals, so no custom per-vendor OAuth window — re-probing when
    the pane exits. Halo never asks for credentials itself.
  - **Dual transports.** Every forge has two: the CLI when present
    (existing login, zero new secrets), an API key/token from
    Settings when not. Linear: personal key (`lin_api_...`, from
    linear.app/settings/api, stored in settings.json 0600) → POST
    https://api.linear.app/graphql with the key RAW as the
    `Authorization` header (no `Bearer `) — GraphQL returns HTTP 200
    even on failures, so `.errors` is always checked. Notion:
    integration token → https://api.notion.com/v1 with `Bearer` +
    `Notion-Version: 2022-06-28` on EVERY request (do NOT use
    2025-09-03 — intermittent 401s on POST/PATCH); an integration
    only sees pages/databases explicitly shared with it, so a 404
    almost always means a missing share. **Normalization lives in
    one place:** `normalizeApiIssue` swaps the API's UUID `id` +
    `identifier` into the connector's `id` + `uuid` AND flattens
    `state {name, type}` into `status`/`statusType`; `mapComment`
    accepts `author` (connector) or `user` (API). Both were missing
    until the mock-API test caught them — the connector path had
    masked both. **Connector write tools are never called** (their
    argument names are unverified from `list-tools` alone) — all
    Notion writes go through the REST API.
  - **Notes** (`electron/notesAdapter.ts`, own sidebar section +
    main view, NOT a fourth forge): Notion (connector search/recent
    first, API search second when a token is set) + Obsidian vault
    (top-level `*.md`, mtime desc, limit 20), merged newest-first.
    Detail: Obsidian reads the file (path traversal rejected);
    Notion without a token returns the thin '(Notion page)' + the
    token hint (the detail effect keeps a note's accompanying
    detail — it used to clear it on any successful fetch, which hid
    exactly this hint). Create: Notion → `createNotionPageApi`
    (reads the database schema for the title property's NAME, never
    guesses it; body lines → paragraph blocks); Obsidian → writes
    `<slug>.md` (0600, `-2` dedupe). Obsidian titles in the list are
    filename slugs, same as existing vault files.
  - **Spawn** (`electron/herdrAdapter.ts`, `SPAWNABLE_KINDS`):
    opencode / omp / hermes / pi / codex — the kinds herdr 0.9.5 can
    start that navi ships. `binaryOnPath` (`command -v`) filters to
    installed only; `defaultAgentKind()` reads
    `~/.config/navi/default-agent` and pre-selects it when it IS one
    of the five (wisp/goose map to '' — they are NOT herdr kinds, so
    they are honestly excluded with a note, never listed).
    `findSpawnPane` prefers a bare pane (no `agent` key), else any
    pane; no workspace → create one and start direct in its root
    pane. `spawnAgent` names the first free `<kind>-<n>` (names read
    from the raw `agent list` envelope — the renderer's HerdrAgent
    drops the raw `name`, so the taken-names set is parsed here),
    splits unless starting direct, `agent start --timeout 60000`,
    returns the pane_id; the popover jumps to Chat with it.
  - **Tests (all new in 0.11.0):** `scripts/api-transport-test.mjs`
    (node-side mock servers, 18 checks — the one that caught the
    state-flattening + comment-author bugs), `scripts/install-test.mjs`
    (node-side fixture server + throwaway HOME, 9 checks incl. the
    tampered-tarball refusal), `scripts/connections-test.mjs` (9
    checks: dots, status lines, Install/Connect absence while
    connected, dark textareas, narrow icons-only + ellipsis),
    `scripts/notes-test.mjs` (7 checks), `scripts/spawn-test.mjs`
    (6 checks, cleans up its spawned pane). New fakes: `gh auth
    status`, `entire auth status --json`, and a whole fake
    `notion-cli` (real get-self / recent-pages shapes). **Fake
    binaries must be +x** — the notion-cli fake shipped 644 and the
    Notion probe read "notion-cli exited 1" until it was chmodded.
  - **Test traps from this round:** an ellipsized element's
    `scrollWidth` is STILL the full text width — asserting
    `scrollWidth <= clientWidth` fails on a correctly-clipped title;
    assert the bounding rect stays inside the sidebar instead. The
    sandbox has `codex` on PATH (/opt/hatch-image/bin), so the spawn
    test expects opencode/pi/codex installed, omp/hermes missing —
    the installed set is machine-dependent, assert what the machine
    has. The chat-list timing flake recurred once on `attachRenders`
    in this suite and passed on immediate re-run (known, no code
    change).
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
- **0.12.0 — sidebar narrow fix + aesthetic hints (2026-11-12).**
  Raven's first-night bench notes: the Linear logo drifts
  off-screen when shrunk and the text below the forge buttons
  vanishes; the Terminal hint bar clips mid-shortcut. The probe
  (`scripts/sidebar-overflow-probe.mjs`, deleted after — its checks
  now live in connections-test) found exactly one overflowing
  element at the default 280px: `.forge-switch` itself
  (scrollWidth 270 vs clientWidth 259) — the buttons are `flex: 1`
  with no `min-width: 0`, so they refuse to shrink below content
  and the row scrolls sideways (the horizontal scrollbar in the
  screenshots) and pushes Linear off at narrower widths. The notes
  already wrapped; the "vanishing" text was the switcher's
  scrollbar side effect. Fix: `min-width: 0` + `overflow: hidden`
  on `.forge-btn`, an ellipsis rule on `.f-label`, and tightened
  chrome (3px gaps, 2px padding, 16px marks, `flex: 1 1 auto` so
  the longest label gets its share first). **Trap:** the first
  pass (4px gaps, 3px padding, 18px marks) still truncated
  "GitHub" to "GitH…" at the default width — measured, the label
  needs 40px in Noto Sans 12px and had 38. The numbers in the
  comment are measured, not estimated: verify with a live DOM
  measure (children's scrollWidth vs clientWidth), not arithmetic.
  The hint bar: `.terminal-toolbar .note` is a flex item, so it
  also needed `min-width: 0` to wrap at all; the shortcuts are now
  `kbd` chips (pink-tinted border, mono, `white-space: nowrap`)
  so the help reads as part of the neon. `scripts/shot.mjs` is the
  quick visual check (reloads first — a stale bundle once made a
  fix look like it hadn't landed). Full dev suite green on 0.12.0
  (connections 13 checks incl. labelsWhole at 270/280 + the hint
  wrap; chat-list flaked once on attachRenders, passed on re-run).

- **0.13.0 — the QoL round (2026-11-12).** Raven's full approved
  list from the first-night bench (06:20 CST), split off from
  0.12.0's sidebar fix. Everything in one version:
  - **Per-pane zoom.** `paneZoom` (Record<paneId, px delta>, clamp
    −5..+8, 0 deletes the key) + `zoomFor(paneId)` (settings font
    size + delta); Terminal takes a `zoom` prop and shows an amber
    `+Npx` badge when zoom ≠ 0. Ctrl+=/− (plain Ctrl, terminal/chat
    views), Ctrl+0 resets. Verified: 13px = 139 cols, 14px = 122
    cols on the same pane.
  - **Pane maximize.** `maximizedPaneId` + `toggleMaximize`; the
    maximized pane gets flexGrow 1, the others `display: none`,
    dividers hidden; closing the maximized pane clears it.
    Ctrl+Shift+M (terminal only) + toolbar button + ctx menu.
    **Trap:** the new pane focuses itself on spawn, so after a
    Split the maximized pane is the NEW one — a test asserting
    "the first pane is hidden" fails; assert exactly one hidden +
    the visible one spans the container.
  - **Layout persistence.** `halo.termLayout` in localStorage
    ({panes: [{id,title,cwd,command?}], sizes}) — validated on
    load (same length, finite positive sizes, normalized) and
    written on every panes/sizes change. Panes whose title starts
    with 'sign in: ' are skipped on save, so a login pane never
    re-runs its command on launch. Initializers read the layout
    (panes, sizes, focused pane = first restored id).
  - **Ctrl+K quick switcher.** `switcherItems` memo over
    trails/prs/issues/linIssues/herdr.agents/notes; ranked by
    match (title-startsWith 0, title-includes 1, meta-includes 2),
    capped at 8; Enter runs the item (selectTrail/selectGh/
    selectLin — which now also setForge + persist halo.forge — or
    jump to Chat for agents, selectNote for notes). The palette
    is a backdrop + panel with autoFocus input; ArrowUp/Down wrap,
    Esc closes. While the palette is open the input is focused, so
    the window shortcut handler never fires inside it.
  - **Unread dots.** `seenIds` in localStorage ({entire,github,
    linear} string arrays); an effect merges the ACTIVE forge's
    current ids into seen whenever the lists change; `unreadCounts`
    memo counts the unseen per forge. The dot is absolutely
    positioned (top 3px right 3px) so it never disturbs the
    0.12.0 labelsWhole layout. **Test trap:** seenIds persists
    across runs, so a re-run finds the ids already seen and the
    dots never appear — the test clears `halo.seenIds` before the
    reload.
  - **Live trails.** `startTrailWatch(projects, onEvent,
    onStatus)` replaces the `watchTrail()` stub (deleted, with
    its `NotImplemented` interface): one long-lived `entire trail
    watch --project <project> --json` per project, per-child line
    buffer, only parseable JSON lines forwarded; the renderer
    treats ANY event as "refresh the list" and never reads event
    fields (the event shapes are docs-assumed, unverified against
    a real CLI — Raven's bench is the honest check). The 30 s
    list poll stays as backstop; the Trails h2 shows a cyan
    `● live` badge while the watch is connected. `stopTrailWatch`
    kills all children; `before-quit` calls it too.
  - **In-pane find + copy.** `@xterm/addon-search@0.16.0`
    (0.15.0 was rejected by npm — its peer wants @xterm/xterm
    ^5.0.0, Halo is on xterm 6.0.0; 0.16.x pairs with xterm 6).
    SearchAddon is created + loaded per pane and disposed before
    term.dispose(). Ctrl+F opens the find bar (input autofocused,
    findNext on change, ↑/↓, 'found'/'no match' + red border,
    Esc closes); Ctrl+Shift+C copies the selection via
    `term.getSelection()` → clipboard. Both ride `searchSignal`/
    `copySignal` ({paneId, nonce}) so the window handler can
    target the right pane (chat uses `chat-attach-<paneId>`).
  - **Herdr-restart detection.** The 10 s herdr poll compares
    down (`installed && detail startsWith('herdr responded with
    an error')` — verified live: a dead server makes `herdr
    agent list` exit 1 with a `server_not_running` JSON envelope
    on stderr) against up. **Real bug, found by the test:** a
    dead chat attach UNMOUNTS when the agent list empties
    (ChatView drops the vanished agent), so by the time the
    server returns `deadPanes` is empty and the banner never
    fires. Fix: a `hadDeadPanesRef` latch, set on any down poll
    while panes are dead (latched BEFORE setHerdr, which is what
    drains the list), consumed on the up transition; the button
    renders when `deadPanes.length > 0 || herdrRestarted`, and
    when the attach already came back on its own it reads
    "↻ herdr restarted — all agents back" (click dismisses).
  - **Watch-cleanup traps (both real, both fixed this round).**
    (1) Main spawns children that inherit its fds — including
    the DevTools listen socket — so a surviving watch child
    holds port 9222 bound after the app quits and the next
    launch's DevTools endpoint hangs (fetch never resolves, CDP
    tests stall with no output). `stopTrailWatch` now SIGKILLs
    after a 2 s grace period; the fake `entire`'s watch loop
    traps SIGTERM (a foreground `sleep 3600` defers SIGTERM
    until the sleep finishes — the trap runs the sleep in the
    background under `wait`). The 2 s SIGKILL only helps
    reloads — on quit the process exits before it fires — so
    the trap is what makes quit-clean work in the sandbox; the
    real `entire` binary is a single process and dies on
    SIGTERM. (2) A reload's renderer teardown can race the
    watch-stop IPC, orphaning the old watch — `startTrailWatch`
    calls `stopTrailWatch()` first, so a new start always kills
    the previous watch.
  - **DevTools ports are single-use in this sandbox (2026-11-12).**
    After an Electron app exits — cleanly, via close-test or
    otherwise — a phantom LISTEN socket stays on its
    `--remote-debugging-port` with no owning process (fuser/lsof
    show nothing, the inode has no holder in /proc), and the
    next app launched on that port runs fine but serves no
    DevTools: curl/fetch hang forever, CDP tests stall with no
    output. 9222 died this way, then 9223 after the packaged
    close-busy run. Workaround: launch each fresh app instance
    on a NEW port (9224, …) and pass it to the tests; the port
    number is just an argument. Do not waste time debugging the
    app when the port stops responding — check `ss -ltn` for a
    phantom listener first.
  - **Test fallout from the live badge.** The Trails h2 now
    reads "Trails ● live" when the watch is connected, so three
    older tests' exact `h2.includes('Trails')` assertions failed
    (trails/github/linear) — they now match
    `t.trim().startsWith('Trails')`. Connections-test section 7
    asserted exactly 3 kbd chips in the hint; the hint now has 6
    (maximize/zoom/find joined) — it asserts ≥3 with the first
    Ctrl+Shift+D and M + F named. The chat-list timing flake
    recurred once on `attachRenders` and passed on immediate
    re-run (known, no code change).
  - **New tests (all green dev on 0.13.0):**
    `scripts/qol-test.mjs` (18 checks: live badge, unread dots,
    switcher jump, zoom cols + badge + reset, maximize/unmaximize,
    layout persistence across reload, find bar),
    `scripts/trail-watch-test.mjs` (node-side, 10 checks against
    the fake entire: event arrives, stop kills, restart works),
    `scripts/herdr-restart-test.mjs` (CDP + real server restart,
    ~60 s: attach dies, banner appears, click clears, attach
    back; rebuilds the rig itself). Full dev suite green on
    0.13.0 (23 tests incl. the two close tests).

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
