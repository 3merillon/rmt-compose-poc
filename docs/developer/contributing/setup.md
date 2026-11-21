# Development setup

From the repository root run `npm ci` and `npm run dev`. The lockfile installs Vite 7 for the app, VitePress for the docs, and Playwright for browser checks. Use Node 20.19+ on the 20.x line or 22.12+. For first-time clone instructions see [Installation](/getting-started/installation).

The configured dev port is 3000. Use `npm run dev -- --host 127.0.0.1 --port 3005 --strictPort` for an isolated checkout. A different port gives you a separate browser origin, including a separate autosave. Pass that URL to browser tools. Some harnesses use Vite’s source-module URLs and need the dev server.

## Type checking and Node entry points

Run `npm run typecheck` from the repository root to check the application, Node tools, Playwright page callbacks and Vue components. In `docs/`, run `npm ci`, `npm run typecheck` and `npm run build` to use the standalone documentation project.

The documented `.mjs` entry points load their sibling TypeScript files through `ts-blank-space/register` on all supported Node versions. The loader erases annotations without introducing helper functions into callbacks that Playwright sends to the browser. Vite serves the application and its lazy modules in development and bundles them for deployment.

## npm test

Run `npm test` for the module validator and the test scripts listed in the root `package.json`. They exercise the shipped library against its score oracle, rational and symbolic evaluation, cycle rejection, migration, history-related edit costs, player assignment, MIDI encoding, group editing, reopening copied scores and the visible-detail threshold. Run `node scripts/gen-canon-parts.mjs --check` separately to check the generated canon parts.

## Performance and visual regression harness

Install Playwright’s Chromium once with `npx playwright install chromium`. Some audio/gesture scripts specifically launch an installed Edge or Chrome. Use `?perf=1` for the renderer/workspace probes and the lazy `window.__rmtPerf` harness. Use a disposable browser profile for `loadStress` because it replaces that origin’s autosaved piece. [Harnesses and fixtures](/developer/performance#the-benchmark-harness)

To exercise group-copy pitches through the UI, run `node scripts/perf/check-group-copy-pitches.mjs http://127.0.0.1:4175` with the app on that address. It uses the group widget, reloads the Custom library, opens the copy from JSON and edits its pitch anchor.

## Local listening room

The prepared Wi-Fi development server serves `/listen/`. Open that path on the same host and port as the Wi-Fi app. The room compares three versions of the bar-5 passage around note 81, plays the revised canon on sampled piano, and pairs each of the eight previous progression voicings with its revision. It uses local audition files, including material under `scripts/perf/__visual__/listen/v2-wifi/`. A fresh clone and a production build contain the editable modules. The prepared room and its recordings are local development resources.

For an implementation comparison, `scripts/perf/listening-pairs.mjs` renders its named sheets through the real audio engine in headless Edge and writes local WAVs and an index under `scripts/perf/__visual__/listen/`. These are separate from the prepared Wi-Fi room. For an exercise anyone can reproduce in the released app, use [the canon and cadence tutorial](/tutorials/workflows/canon-and-cadences).

## Find the implementation

`src/main.ts` boots the app. `src/player.ts` connects the workspace, library, transport and score history. `src/module.ts` and `src/note.ts` own the score. `src/dsl/`, `src/value/` and `src/migrate/` cover expressions, exact arithmetic and old files. `src/renderer/webgl2/` handles the score display, `src/player/` and `src/instruments/` implement audio, and `src/store/` handles history and autosave.

If the app opens the wrong score after a reload, check the origin and use **Reset Default Module**. If the canvas stays blank after editing the code, check the console and WebGL2 availability, reload the page, then restart the dev server for that checkout if needed. [Build and deployment](/developer/contributing/build-and-deploy)
