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
- No placeholder data anywhere. An empty trail list means no trail has run
  yet — the app never shows a trail that didn't happen.

## Not built yet

- **Live trail data.** The trail list starts empty and only fills from a
  real source. Wiring `listTrails()` to the Entire CLI is next, after the
  first test trail run (trails-test, then haibane, OpenCode as the test
  agent).
- **In-app terminal + chatting with herdr agents directly.** Next after live
  trails — a terminal per repo via xterm.js + node-pty (copland's proven
  stack), and agent chat by attaching to an agent by `pane_id`, so you can
  run commands and steer the agent from inside Halo.
- **`herdr agent list` output parsing is best-effort.** The command exists,
  but its exact output shape is not documented well enough to parse
  strictly — the adapter tries JSON first, then raw lines, and never
  fabricates an agent status it did not observe. Verify the format on a
  machine with herdr installed before trusting the agent list.
- **Ollama + BYOK are not connected yet.** The fields exist and persist
  locally; nothing connects to Ollama or any provider yet.
- No telemetry anywhere. Local-first by construction.

## Next steps

1. First real trail run per the run-sheet (Entire CLI, trails-test, OpenCode)
   — then wire `listTrails()` to the Entire CLI.
2. Verify `herdr agent list` output shape on a machine with herdr; tighten
   the adapter's parser.
3. In-app terminal + agent chat, so a trail can be run, steered, and
   commanded from inside Halo from the start.
4. Ollama wiring (local-first default model) + BYOK provider calls.
5. Bench on Cloudbook / T440p.
