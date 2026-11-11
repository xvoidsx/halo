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

## What's real

- Electron + TypeScript scaffold, main/renderer split borrowed from Ember's
  shape (Vite renderer, `electron/` main, separate tsconfigs). No Ember code
  or branding — fresh code, nightshadeNeon theme throughout.
- Shell layout: left sidebar (trails), main pane (live trail view), settings
  panel (switch repos, see herdr agents with status lights). Lain identity
  chip in the sidebar.
- Trail data model + rendering: eval scores (security / slop / human review /
  confidence / risk), findings with severity + suggested fixes, linked
  sessions/checkpoints, gates/approvals, last-five runs.
- Settings file at `~/.config/halo/settings.json` (0600): repos, active
  repo/agent, Ollama base URL + default model, BYOK provider keys.
- Herdr detection: the main process shells out to the real `herdr agent
  list` command. If herdr is not installed, the UI says so plainly.
- **In-app terminal.** One terminal per repo, opened in that repo's
  directory — xterm.js in the renderer, node-pty shell in the main
  process (copland's stack: WebGL renderer with a canvas fallback, the
  terminal chunk lazy-loads so the trail view stays light). If the repo
  path does not exist on this machine, the panel says so instead of
  showing a dead prompt.
- **Agent chat.** Talk to a herdr agent directly, by `pane_id` — messages
  are typed into the agent's pane as literal text and submitted with
  Enter (`herdr agent send` + `agent send-keys enter`), and replies
  stream back by polling `herdr agent read`. Nothing is fabricated: your
  messages are the ones you typed, agent messages are text actually read
  from the pane, failures show as system lines in the chat.
- No placeholder data anywhere. An empty trail list means no trail has run
  yet — the app never shows a trail that didn't happen.

## Not built yet

- **Live trail data.** The trail list starts empty and only fills from a
  real source. Wiring `listTrails()` to the Entire CLI is next, after the
  first test trail run (trails-test, then haibane, OpenCode as the test
  agent).
- **Agent chat is not yet verified on a machine with herdr.** The send/read
  path follows herdr's documented CLI surface (herdr.dev, v0.7–0.9), and
  the adapter returns honest errors when herdr is absent — but no live
  agent conversation has run through it yet. Bench it on a machine with
  herdr installed before trusting it. `agent attach` is deliberately never
  used: it takes over the current terminal, which a GUI window cannot do.
- **`herdr agent list` output parsing is best-effort.** The command exists,
  but its exact output shape is not documented well enough to parse
  strictly — the adapter tries JSON first, then raw lines, and never
  fabricates an agent status it did not observe. Verify the format on a
  machine with herdr installed before trusting the agent list.
- **Ollama + BYOK are not connected yet.** The fields exist and persist
  locally; nothing connects to Ollama or any provider yet.
- No telemetry anywhere. Local-first by construction.

## Next steps

1. Bench the terminal + agent chat on a machine with herdr installed —
   send a message to a live agent from Halo and confirm the reply streams
   back.
2. First real trail run per the run-sheet (Entire CLI, trails-test, OpenCode)
   — then wire `listTrails()` to the Entire CLI.
3. Ollama wiring (local-first default model) + BYOK provider calls.
4. Bench on Cloudbook / T440p.
