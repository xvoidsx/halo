# halo
A nightshadeNeon-soaked application for your whole workspace — agents, trails, pull requests, and issues in one live view.

Halo — a nightshade neon Electron shell that puts your whole workspace in
one live view: herdr agents, Entire trails, GitHub pull requests, and
Linear issues.

## Run it

```sh
npm install
npm run build        # vite build (renderer) + tsc (main process)
npm start            # Electron, loads dist/
```

For development with hot reload:

```sh
npm run dev          # vite dev server on http://127.0.0.1:5173 (browser preview)
npm run dev:electron # electron against the dev server (run `npm run dev` first, in another terminal)
```

`npm run dev` in a plain browser also works — the shell previews with an
empty trail list, since there is no Electron bridge and no placeholder data.

## How it works

Halo is a **herdr client, not a replacement**. It talks to the herdr agent
runtime you already run (`herdr agent list`, `agent prompt`, `agent attach`)
and puts a live view over it. Agents are addressed by **pane_id**, never by
a bare kind label. Nothing is faked: no placeholder trails, no fake agents,
no fake replies, ever.

### Terminal — first-class, not an afterthought

- Opens on your home directory; no repo required. Split panes freely.
- **Splits:** the ＋ Split button, Ctrl+Shift+D, or right-click a pane →
  Split right. A split lands beside the focused pane and takes half its
  share. Drag the dividers between panes to resize them (each pane keeps
  at least 10% of the width).
- **Shortcuts** (Raven's Kitty vocabulary): Ctrl+Shift+D split,
  Ctrl+Shift+Q (or X) close the focused pane, Ctrl+Shift+←/→ move focus
  between panes. Right-click a pane for Split right / Close pane.
- **"Open herdr"** boots the herdr TUI in a pane, so the whole agent
  runtime is one click away.
- Panes stay alive when you switch tabs — terminal, chat, and trails are
  all live at once. If a shell exits, its pane offers ↻ Reconnect; if
  several are dead at once (say herdr restarted), the sidebar's
  ↻ Reconnect all brings them all back.

### Chat — the live terminal, not a text log

- The agent list (blocked first, then working, idle, asleep) mirrors the
  navi agent centre. Click an agent and its **live terminal** opens in the
  same window — `herdr agent attach <pane_id>` — so you type straight into
  the agent, exactly as you would in herdr itself. The attach keeps its
  pty and scrollback when you switch tabs and come back.
- The poller never `agent read`s a pane with a live attach (a read kills
  a TUI agent's attach), and a quickly-dying attach gets one silent
  re-spawn, so a click that lands mid-poll doesn't strand you.

### Sidebar

- Drag its right edge to resize it (200–420px); the width sticks across
  restarts.
- The **Agents** switcher shows live agents with status lights and jumps
  to the selected agent's chat. Open it and there's a **Spawn an
  agent** dropdown too: every agent kind herdr can start that is
  actually installed on this machine (opencode, omp, hermes, pi,
  codex — whatever `command -v` finds), pre-selecting your navi
  default agent when it is one of them. Pick one, hit Spawn, and Halo
  names it `<kind>-<n>`, starts it in a free pane (splitting one if
  needed), and jumps straight into its chat. goose and wisp are navi
  agents too, but herdr cannot start them — run those from a terminal
  pane. Below the switcher, the **forge switcher** flips the list
  between Entire (Trails), GitHub (pull requests + issues), and Linear
  (issues) — the vendors' own marks, shown unmodified as platform
  indicators, one forge's list at a time. The footer shows herdr's
  status (click ↻ to refresh).
- At a narrow width (under 260px) the forge buttons go icons-only and
  long titles ellipsize instead of spilling — the sidebar stays
  usable all the way down to its 200px floor.

### Trails

- Live from the Entire CLI. Set the projects in Settings → Entire
  Trails, one per line (`et/<project>` for a native repo,
  `gh/<owner>` for a GitHub mirror) and the list fills from
  `entire trail list --json`, refreshing every 30 s. Trails stay an
  Entire thing: native projects list under Trails, mirrored projects
  under their own GitHub section. Click a trail for the detail
  (`entire trail show --json`): eval scores when review agents have
  scored it (security / slop / human review / confidence / risk),
  "No evals yet" when they haven't, findings with severity +
  suggested fixes, linked sessions/checkpoints, gates/approvals, the
  last five runs, and a link out to the trail on Entire. Until a
  project is set, the list stays empty and says why.

### GitHub

- Live from the `gh` CLI. Set the repos in Settings → GitHub, one per
  line (`owner/repo`), and the list fills from `gh pr list --json` +
  `gh issue list --json`, refreshing every 30 s. PR rows carry a
  checks pill (passing / failing / pending / none, from
  `statusCheckRollup`) and the review decision; issue rows carry labels
  and assignees. Click a row for the detail (`gh pr view` / `gh issue
  view --json`): description, comment count, and a link out to GitHub.
- **Branch status is read-only:** each repo group shows the local
  checkout's branch, ahead/behind, and dirty count, from `git status
  --porcelain=v2 --branch` on the matching repo in Settings → Repos.
  No push, pull, or merge from Halo yet — those come after the
  read-only view proves itself. The `gh` CLI must be installed and
  logged in; Halo never holds a token of its own.

### Linear

- Live from the `linear` connector CLI. Set the team in Settings →
  Linear (default `xvoidsx`; empty means the whole workspace) and the
  list fills from `linear call-tool list_issues`, refreshing every
  30 s. Rows carry the workflow status (Backlog / Todo / In Progress /
  Done …) and the priority; click a row for the detail (`get_issue` +
  `list_comments`): the full description — the list truncates it, so
  the detail is fetched, never the cut-off paragraph — the comments
  with their authors, and a link out to Linear. Read-only: the
  connector's first grant is read-only, and Halo only ever calls read
  tools. Halo never holds a Linear token; it rides the connector's
  existing OAuth connection. **On a machine without the connector,**
  paste a personal API key (Settings → Linear, from
  linear.app/settings/api) and Halo calls the Linear GraphQL API
  directly instead — same list, same detail, same read-only rule.
  The API returns priority as a number and the state as a nested
  object; the adapter normalizes both into the connector's shape, so
  one view serves both transports.

### Connections — setup that installs itself

- Every forge button carries a **connection dot**: green (tool present
  and signed in), amber (present, not signed in), grey (not
  installed). The same dot + a plain-language status line sits in
  each forge's Settings section.
- **Missing tool?** Settings offers Install: `gh` and the Entire CLI
  download as archives from their official releases, the checksum is
  verified against the published checksums file, and the binary lands
  in `~/.local/bin` — no sudo, no install script executed, ever.
  Notion's CLI (`ntn`) installs with `npm install -g ntn`. A tampered
  archive fails the checksum and installs nothing.
- **Not signed in?** Connect opens a setup terminal pane running the
  login command (`gh auth login`, `entire login`, …) and re-probes
  when it exits. Halo never asks for your credentials itself.

### Notes

- Its own section (✎ Notes in the sidebar), not a fourth forge: the
  list merges **Notion** pages (recent first, or by search) with
  **.md files from an Obsidian vault** (newest first). Obsidian is
  first — the vault is markdown on disk, local-first, and needs no
  auth at all; Notion is the shared-notes layer, reached through the
  connector when it is present.
- Click a note to read it. A Notion page without a token says so
  honestly and points at Settings; with an **integration token**
  (Settings → Notes, from notion.so/my-integrations) Halo reads the
  full page text through the Notion API — and **pushes new notes** to
  a database of your choice (pick it with Find databases; the token
  only sees databases shared with the integration). A new note to the
  vault is a plain `.md` file, written in the open.

### Settings

- Settings live at `~/.config/halo/settings.json` (0600): repos, active
  repo/agent, Ollama base URL + default model, BYOK provider keys (stored
  locally, never sent anywhere), Linear team + personal API key, Notes
  (Notion token + target database + Obsidian vault path).

## What's real

- Electron + TypeScript scaffold, main/renderer split borrowed from Ember's
  shape (Vite renderer, `electron/` main, separate tsconfigs). No Ember code
  or branding — fresh code, nightshadeNeon theme throughout.
- Herdr detection verified against live herdr 0.9.5: `agent list` is a JSON
  envelope under `result.agents`, chat sends via `agent prompt`, reads via
  `agent read --source recent-unwrapped`. Unrecognized output is shown raw,
  never read as an empty list.
- Trails verified against real Entire CLI output (`trail list` +
  `trail show --json`, project `et/xvoidsx`): the list is the `items`
  array with ULID ids and a `phase` ("planning", …); the detail is the
  trail object itself, with an entire.com URL. The list carries no
  repo/branch names — only repo ULIDs — so Halo shows the phase and
  links out rather than inventing a repo name. A trail with no evals
  renders "No evals yet", never faked numbers. Several projects list
  at once — native under Trails, mirrored under GitHub — and each
  trail carries its project, so the detail fetch goes to the right
  one. The gh side is verified against a fixture transcribed from a
  screenshot so far; the real `gh/rav3ndust` JSON is still to be
  checked.
- Linear verified against the real connector output (2026-11-12):
  `list_issues` returns `{issues, hasNextPage}` with the identifier
  (`XVOIDSX-71`), status + statusType, priority `{value, name}`,
  labels, team; `get_issue` returns the issue object itself with the
  FULL description; `list_comments` returns `{comments}` with
  `author: {id, name}` + body (real comments on XVOIDSX-68, from
  Linear + rav3ndust). The `linear` CLI prints an MCP envelope —
  outer JSON, then `result.content[0].text` as a second JSON string —
  so the adapter parses twice. 50 issues in the workspace, one team
  (`xvoidsx`).
- GitHub verified against the real `gh` 2.102.0 `--help` (JSON FIELDS
  lists) and real `git status --porcelain=v2 --branch` output: PRs
  carry `reviewDecision` + `statusCheckRollup` (any failure verdict
  fails the row, any run still going pends it), issues carry labels +
  assignees, and the branch line shows the local checkout's branch,
  ahead/behind, and dirty count. The `gh` fixtures are synthesized
  from the field lists until real `gh pr/issue list/view --json`
  lands from Raven's machine — same swap as the Entire fixtures got.
- In-app terminal: xterm.js in the renderer, node-pty shell in the main
  process (copland's stack: WebGL renderer with a canvas fallback, the
  terminal chunk lazy-loads so the trail view stays light). Pty resizes
  are debounced (150 ms) so a layout-settling storm collapses into one
  resize to the final size — verified with `stty size` on splits and
  divider drags.
- Connections verified against fakes + mock servers (2026-11-12):
  `gh auth status` / `entire auth status --json` / `linear
  list_issues` / `notion-get-self` drive the dots; the installers
  download real tarballs + checksums from a local fixture server
  (a tampered tarball fails the checksum and installs nothing); the
  Linear GraphQL + Notion REST transports run against canned mock
  responses (priority numbers map to names, the API's `state {name,
  type}` flattens into the connector's status, Notion's title
  property is read from the database schema, never guessed). The
  Notion connector shapes are real (verified live); the Entire
  `--json` auth shape is still assumed — the probe accepts a `user`
  string or a `sessions` array and treats any exit-0 JSON as signed
  in, so a shape drift fails soft.
- Notes verified against the fake `notion-cli` (real recent pages)
  and a throwaway vault: list merges both sources newest-first,
  vault detail renders the file, a Notion page without a token says
  the token is needed, and creating a note writes the `.md` file and
  lists it.
- Spawn verified live against herdr 0.9.5: the dropdown lists only
  installed kinds (opencode, pi, codex in the sandbox; omp/hermes
  named as not installed), spawning pi creates a live `pi-1` agent
  and jumps to its chat, and the pane is closed again afterwards.
- Sidebar + hints (0.12.0, 2026-11-12): the forge switcher never
  scrolls sideways at 270/280px — `min-width: 0` + an ellipsis
  backstop on the labels, tightened chrome (3px gaps, 2px padding,
  16px marks, flex-basis auto so the longest label gets its share);
  every label reads in full at the default width, and the Terminal
  hint bar wraps with pink kbd chips instead of clipping
  mid-shortcut. Opencode clip, diagnosed: a direct attach renders
  fully at 68 cols; the nested herdr TUI squeezes opencode's
  sub-pane (clipped UI at full width, segfault at split width) —
  herdr-side, and the mitigations (per-pane zoom, pane maximize)
  are the next version's QoL round.
- No placeholder data anywhere. An empty trail list means no trail has run
  yet — the app never shows a trail that didn't happen.
- No telemetry anywhere. Local-first by construction.

## Not built yet

- **Push / pull / merge from Halo.** The GitHub view is read-only on
  purpose: branch status shows first, buttons come after it proves
  itself (branch choice, dirty tree, and conflicts need careful UX).
- **Live trail event streaming.** The list refreshes every 30 s and the
  detail loads on click; `entire trail watch --json` is not wired yet,
  so new events arrive on the next refresh, not live.
- **Ollama + BYOK are not connected yet.** The fields exist and persist
  locally; nothing connects to Ollama or any provider yet.
- **Horizontal splits.** Panes split side-by-side only; stacking panes
  vertically needs a split-tree model and is a later version.

## Known behaviour (herdr-side, not Halo)

- The herdr TUI sizes its internal agent panes from its own terminal
  size, and its layout can squeeze an agent's pane to nothing in an
  over-split workspace — opencode then renders cut off or not at all.
  Halo's pty resize and herdr's layout area both track correctly; the
  rendering is downstream of Halo. Don't over-split a herdr workspace,
  and if an agent looks cut off, resizing the pane or re-attaching is
  the practical fix. Opening the herdr TUI in a very narrow pane can
  shrink an agent's pane small enough that opencode segfaults (its
  known tiny-size death), so give herdr room when you open it.

## Next steps

1. Bench the 0.10.0 Linear build: the third forge button, the real
   issues against the live workspace, the detail + comments, and the
   close dialog.
2. Show it off in the Entire Discord after watching a Trail run.
3. Notes section — the hub's fourth view. Obsidian first (the vault
   is markdown on disk, local-first, already Raven's brain),
   Notion second (the shared notebooks with Ryoko).
4. Push / pull from Halo, after the read-only GitHub view proves itself.
5. Ollama wiring (local-first default model) + BYOK provider calls.
6. Horizontal splits (split-tree model).
7. Bench on Cloudbook / T440p.
