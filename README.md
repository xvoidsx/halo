# halo
A nightshadeNeon-soaked application for running Trails, with your repos and agents in one live view.

Halo — a nightshade neon Electron shell that lets herdr run trails locally,
with your repos and agents in one live view.

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
  to the selected agent's chat. The trail list lives below it, and the
  footer shows herdr's status (click ↻ to refresh).

### Trails

- Live from the Entire CLI. Set the project in Settings → Entire
  Trails (`et/<project>` for a native repo, `gh/<owner>` for a GitHub
  mirror) and the list fills from `entire trail list --json`,
  refreshing every 30 s. Click a trail for the detail (`entire trail
  show --json`): eval scores when review agents have scored it
  (security / slop / human review / confidence / risk), "No evals yet"
  when they haven't, findings with severity + suggested fixes, linked
  sessions/checkpoints, gates/approvals, the last five runs, and a link
  out to the trail on Entire. Until a project is set, the list stays
  empty and says why.

### Settings

- Settings live at `~/.config/halo/settings.json` (0600): repos, active
  repo/agent, Ollama base URL + default model, BYOK provider keys (stored
  locally, never sent anywhere).

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
  renders "No evals yet", never faked numbers.
- In-app terminal: xterm.js in the renderer, node-pty shell in the main
  process (copland's stack: WebGL renderer with a canvas fallback, the
  terminal chunk lazy-loads so the trail view stays light). Pty resizes
  are debounced (150 ms) so a layout-settling storm collapses into one
  resize to the final size — verified with `stty size` on splits and
  divider drags.
- No placeholder data anywhere. An empty trail list means no trail has run
  yet — the app never shows a trail that didn't happen.
- No telemetry anywhere. Local-first by construction.

## Not built yet

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

1. Bench the 0.7.0 Trails build against the live trail-test trail.
2. Show it off in the Entire Discord after watching a Trail run.
3. Ollama wiring (local-first default model) + BYOK provider calls.
4. Horizontal splits (split-tree model).
5. Bench on Cloudbook / T440p.
