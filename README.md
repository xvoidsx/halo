# halo
A nightshadeNeon-soaked application for running Trails, with your repos and agents in one live view.

Halo — a nightshade neon Electron shell that lets herdr run trails locally,
with your repos and agents in one live view.

Two-week spike foundation (11 Nov 2026). This is the shell, not the finished
app: the layout, theme, trail view, settings, and the herdr boundary are
real; live trail data and provider wiring are stubbed on purpose.

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

`npm run dev` in a plain browser also works — the shell falls back to mock
data when the Electron bridge is absent, so the UI is previewable without
Electron.

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

## What's stubbed (on purpose)

- **Trail data is MOCK** (`src/mockTrails.ts`, two trails, labelled MOCK DATA
  in the UI). No real trail exists yet. Delete the mock file the moment real
  data flows.
- **`herdrAdapter.listTrails()` / `watchTrail()` are not implemented.**
  They return a `{ status: 'not-implemented', todo }` payload. The live
  source will be the Entire CLI once the first test trail exists
  (Raven is setting that up with OpenCode as the test agent).
- **`herdr agent list` output parsing is best-effort.** The command exists,
  but its exact output shape is not documented well enough to parse
  strictly — the adapter tries JSON first, then raw lines, and never
  fabricates an agent status it did not observe. Verify the format on a
  machine with herdr installed before trusting the agent list.
- **Ollama + BYOK are settings placeholders.** The fields exist and persist
  locally; nothing connects to Ollama or any provider yet.
- No telemetry anywhere. Local-first by construction.

## Next steps

1. Push this scaffold to `xvoidsx/halo` (repo is live:
   https://github.com/xvoidsx/halo).
2. First real trail run per the run-sheet (Entire CLI, small repo, OpenCode)
   — then wire `listTrails()` to the Entire CLI and delete the mock data.
3. Verify `herdr agent list` output shape on a machine with herdr; tighten
   the adapter's parser.
4. Ollama wiring (local-first default model) + BYOK provider calls.
5. Bench on Cloudbook / T440p before calling the spike done.
