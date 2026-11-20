---
title: Build & Deploy
description: Every npm script and what it really does, what the Vite build produces, and the two separate Vercel projects behind rmt.world and docs.rmt.world.
---

# Build & Deploy

RMT Compose is a plain [Vite](https://vite.dev) ES-module app — no framework, no TypeScript in
`src/` — plus a separate VitePress site in `docs/`. One repo, **two independent Vercel projects**.

## Requirements

| | |
|---|---|
| Node | **20.19+ or 22.12+**. `package.json` declares no `engines` field, but Vite 7.1.12's own `engines` is `^20.19.0 \|\| >=22.12.0`. Node 18 will not run it. |
| Runtime dependency | `fraction.js` `^5.3.4` (BigInt-backed) — the only one |
| devDependencies | `playwright`, `pngjs`, `vite`, `vitepress` |
| Browser | **WebGL2** is a hard requirement — the workspace does not initialise without it. |
| ffmpeg | Optional. Only for `npm run samples:build` |

```bash
npm ci
npm run dev     # http://localhost:3000, opens your browser
```

The dev server port (**3000**) and auto-open are set in `vite.config.js`.

## The scripts

All 11, and what each one really does.

| Script | Command | What it does |
|---|---|---|
| `dev` | `vite` | Dev server on port 3000, auto-opens the browser |
| `build` | `vite build` | Production bundle into `dist/`. The same command Vercel runs |
| `preview` | `vite preview` | Serves the built `dist/` on Vite's default preview port (4173) |
| `test` | `node scripts/validate-modules.mjs && node scripts/test-exactness.mjs && node scripts/test-variable-deps.mjs && node scripts/test-amplitude.mjs && node scripts/test-midi-export.mjs && node scripts/test-relational-time.mjs` | **Not a unit-test runner.** Validates every library module, proves arbitrary-precision exactness end to end, then checks per-variable evaluation order and cycle detection, the amplitude variable, the MIDI export and relational time (the conversion of old-model modules, against `scripts/fixtures/old-time-oracle.json`) |
| `gen:intervals` | `node scripts/gen-interval-catalog.mjs` | Regenerates `public/modules/intervals/` and patches the `intervals` section of `library.json` |
| `perf:gen` | `node scripts/perf/generate-stress-module.mjs` | Writes stress modules to `public/modules/perf/` |
| `perf:bench` | `node scripts/perf/bench-node.mjs` | Headless Node evaluation benchmark |
| `samples:build` | `node scripts/build-samples.mjs` | Rebuilds the piano and violin multisamples. **Needs ffmpeg and network access** |
| `docs:dev` | `vitepress dev docs` | Docs dev server |
| `docs:build` | `vitepress build docs` | Builds the docs |
| `docs:preview` | `vitepress preview docs` | Previews the built docs |

::: warning `npm test` is not a test suite
There is no Jest and no Vitest anywhere in this repo. `npm test` runs the 20 scripts listed
under `test` in `package.json` and exits non-zero if any fails. Among them: `scripts/validate-modules.mjs`, which validates every module referenced
by `public/modules/library.json`; `scripts/test-exactness.mjs`, which proves exact rational
arithmetic survives a 200-note `(3/2)` chain (checked against native BigInt) and that a ~98-digit
`LOAD_CONST_BIG` literal round-trips digit-exact; `scripts/test-variable-deps.mjs`, which
checks that evaluation is ordered per (note, variable), that only true cycles are refused, and that
an incremental evaluation always equals a fresh load; `scripts/test-amplitude.mjs`, which checks
that `amplitude` inherits from the BaseNote, stays exact, and is never written to a module that
did not set it; and `scripts/test-midi-export.mjs`, which parses exported MIDI files back and
requires every note within 0.1 cent and one tick; and `scripts/test-relational-time.mjs`, which checks
that old-model modules convert to exactly the values the old engine gave them, that the removed names
are refused, and that measure bars and `attack` / `release` behave. Run it before you touch anything under
`public/modules/`, the compilers, or the evaluator. The checks are detailed in
[Development Setup](/developer/contributing/setup#npm-test).
:::

### Scripts with no npm alias

Run these with `node` directly.

| Script | Purpose |
|---|---|
| `scripts/gen-chords-progressions.mjs` | Generates the chords / progressions / cadences modules and patches `library.json` |
| `scripts/gen-melodies.mjs` | Generates the public-domain melodies and the `scale-systems` category |
| `scripts/migrate-modules.mjs` | Converts module JSON files (a file or a folder) to relational time in place, with the same conversion the app applies on load; `--dry-run` reports without writing |
| `scripts/check-doc-citations.mjs` | Prints every source line citation in the docs beside the line it names now, so stale `file.js:N` citations can be found after a `src/` edit |
| `scripts/shift-doc-citations.py` | Re-points the docs' `file.js:N` citations (and bare `` `:N` `` ones after a cited file on the same line) after a `src/` edit, by mapping each cited line of the file at a given commit to the same line now: `python scripts/shift-doc-citations.py . v2 src/player.js` |
| `scripts/perf/bench-render.mjs`, `bench-drag.mjs`, `bench-hover.mjs`, `bench-pick.mjs`, `bench-marquee.mjs`, `profile-sync.mjs`, `converge.mjs`, `who-dirties.mjs` | Playwright render/interaction benchmarks. They drive a **running** dev server |
| `scripts/perf/visual-regress.mjs` | Playwright pixel-diff regression harness (`--capture` / `--compare`) |

All the app-facing Playwright harness scripts default to `--url http://localhost:3000` — the dev
server's pinned port — so `--url` is only needed for a non-default server. The only exceptions are
the two docs-site scripts: `check-docs-rendered.mjs` (4173, the VitePress preview port) and
`shot-docs.mjs` (3005).

See [Performance](/developer/performance) for how to use them.

## What the Vite build produces

`npm run build` (`vite build`) on the current commit:

| Chunk | Raw | Gzip |
|---|---|---|
| `index-*.js` (entry) | 357.15 kB | 97.69 kB |
| `renderer-*.js` | 346.71 kB | 80.87 kB |
| `dsl-*.js` | 25.87 kB | 8.20 kB |
| `settings-panel-*.js` (async) | 29.40 kB | 10.13 kB |
| `instruments-*.js` | 14.20 kB | 4.73 kB |
| `perf-harness-*.js` (async, `?perf` only) | 5.97 kB | 2.33 kB |
| `vendor-*.js` (fraction.js) | 6.81 kB | 2.48 kB |
| `index.html` | 8.91 kB | 3.00 kB |

Output goes to `dist/` (gitignored). `publicDir: 'public'` is copied verbatim, so `modules/`,
`samples/`, `images/`, `styles.css`, `favicon.ico`, `robots.txt`, `sitemap.xml` and `license.html`
all ship as-is.

### Chunking

`manualChunks` in `vite.config.js` splits the entry monolith into independently-cacheable pieces.
The rules run in order:

| Chunk | Matches | Why |
|---|---|---|
| `vendor` | `/node_modules/` | fraction.js — effectively immutable, highest cache value |
| `renderer` | `renderer/webgl2/renderer.js`, `renderer-config.js` | A verified singleton-free leaf: it imports only `renderer-config.js` |
| `dsl` | `/src/dsl/`, `binary-note.js`, `binary-utils.js` | The bytecode foundation is bundled here deliberately — it breaks the core↔dsl cross-chunk cycle |
| `instruments` | `/src/instruments/` | Singleton-free leaf |
| *(entry)* | everything else | `player.js`, `module.js`, workspace, menu bar, modals, audio, theme, settings store |

The singletons (`eventBus`, `app-state`, `settingsStore`) stay coalesced in the entry chunk on
purpose, so they can never be duplicated across chunks. `id` is normalised to forward slashes so the
matching works on Windows.

Two chunks come from dynamic imports rather than the `manualChunks` rules. `settings-panel-*.js` is
`import()`ed during `initApp()` (`src/main.js:102`), so it is out of the entry bundle but still
fetched on every boot. `perf-harness-*.js` is genuinely conditional — it is only ever downloaded with
`?perf` in the URL (`src/main.js:123`).

## Deploys

Two Vercel projects, one repo.

| | App | Docs |
|---|---|---|
| Domain | `https://rmt.world` | `https://docs.rmt.world` |
| Vercel root directory | repo root | `docs/` |
| Config file | `vercel.json` | `docs/vercel.json` |
| `framework` | `vite` | `vitepress` |
| `installCommand` | Vercel default | `npm install` |
| `buildCommand` | **`vite build`** | `npm run build` → `vitepress build` |
| `outputDirectory` | `dist` | `.vitepress/dist` |

The app's `buildCommand` is `vite build`, the same as `npm run build`.

`docs/` has its own `package.json` and its own `package-lock.json`, and its scripts (`dev`, `build`,
`preview`) call `vitepress` with **no path argument**, because Vercel's root directory is already
`docs/`. From the repo root, use the `docs:*` scripts instead.

### Docs site config

`docs/.vitepress/config.ts` sets the sitemap hostname to `https://docs.rmt.world`, local search
(`provider: 'local'`), the GitHub edit link, and `lineNumbers: true` on code fences.

::: warning A dead link fails the docs build
`ignoreDeadLinks: false`. One broken root-relative link and `npm run docs:build` exits non-zero,
naming the file. Write cross-links without the `.md` extension
(`/developer/performance`, not `/developer/performance.md`), and run `npm run docs:build` before
you push.
:::

## Release checklist

1. `npm test` — the module library still validates.
2. `npm run build` — the same `vite build` Vercel runs.
3. `npm run preview` — sanity-check the bundle.
4. If you touched the renderer: measure and pixel-diff. See [Performance](/developer/performance) —
   `visual-regress.mjs` defaults to a 300-pixel tolerance (MSAA resolution is not bit-deterministic
   across runs, so a 0-pixel gate would be permanently red).
   Set `PW_CHANNEL=msedge` for `visual-regress.mjs`, `bench-render.mjs` and `converge.mjs` where
   Playwright's own Chromium is not installed. `HUB_ID=<id>` pins the note the `selected-*` scenes
   select: the automatic pick (most related notes) can change between builds when counts tie.
5. If you touched the docs: `npm run docs:build`.

## Licensing

The project is **MIT** (`LICENSE.md`). Third-party
components, per `THIRD_PARTY_NOTICES.md`: fraction.js (MIT), the VSCO-2 Community Edition sample sets
(CC0), Roboto Mono (Apache-2.0).

## See also

- [Development Setup](/developer/contributing/setup) — clone, install, run
- [Performance](/developer/performance) — the benchmark and pixel-diff harness
- [Code Style](/developer/contributing/code-style)
- [Pull Requests](/developer/contributing/pull-requests)
