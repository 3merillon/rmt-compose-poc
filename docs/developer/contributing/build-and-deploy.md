---
title: Build & Deploy
description: Every npm script and what it really does, the committed WASM artifacts Vercel ships, and the two separate Vercel projects behind rmt.world and docs.rmt.world.
---

# Build & Deploy

RMT Compose is a plain [Vite](https://vite.dev) ES-module app — no framework, no TypeScript in
`src/` — plus a separate VitePress site in `docs/`. One repo, **two independent Vercel projects**.

## Requirements

| | |
|---|---|
| Node | **20.19+ or 22.12+**. `package.json` declares no `engines` field, but Vite 7.1.12's own `engines` is `^20.19.0 \|\| >=22.12.0`. Node 18 will not run it. |
| Runtime dependency | `fraction.js` `^4.3.7` — the only one |
| devDependencies | `playwright`, `pngjs`, `vite`, `vitepress` |
| Browser | **WebGL2** is a hard requirement — the workspace does not initialise without it. WASM support is not required. |
| Rust + wasm-pack | Optional. Only for rebuilding the crate — see [Building WASM](/developer/wasm/building) |
| ffmpeg | Optional. Only for `npm run samples:build` |

```bash
npm ci
npm run dev     # http://localhost:3000, opens your browser
```

The dev server port (**3000**) and auto-open are set in `vite.config.js`.

## The scripts

All 13, and what each one really does.

| Script | Command | What it does |
|---|---|---|
| `dev` | `vite` | Dev server on port 3000, auto-opens the browser |
| `build` | `npm run wasm:build && vite build` | Full build. **Requires Rust + wasm-pack.** Vercel does *not* use this |
| `preview` | `vite preview` | Serves the built `dist/` on Vite's default preview port (4173) |
| `test` | `node scripts/validate-modules.mjs` | **Not a unit-test runner.** Validates every module in the library manifest |
| `gen:intervals` | `node scripts/gen-interval-catalog.mjs` | Regenerates `public/modules/intervals/` and patches the `intervals` section of `library.json` |
| `wasm:build` | `cd rust && wasm-pack build --target web --out-dir pkg && cd .. && node scripts/sync-wasm.mjs` | Builds the Rust crate, then copies the artifacts into `src/wasm/` |
| `wasm:sync` | `node scripts/sync-wasm.mjs` | The copy step alone |
| `perf:gen` | `node scripts/perf/generate-stress-module.mjs` | Writes stress modules to `public/modules/perf/` |
| `perf:bench` | `node scripts/perf/bench-node.mjs` | Headless Node evaluation benchmark |
| `samples:build` | `node scripts/build-samples.mjs` | Rebuilds the piano and violin multisamples. **Needs ffmpeg and network access** |
| `docs:dev` | `vitepress dev docs` | Docs dev server |
| `docs:build` | `vitepress build docs` | Builds the docs |
| `docs:preview` | `vitepress preview docs` | Previews the built docs |

::: warning `npm run build` is not the command for a fresh contributor
It chains `wasm:build`, which needs a Rust toolchain. To produce a production bundle without Rust,
run **`npx vite build`** — byte for byte what Vercel runs.
:::

::: warning `npm test` is not a test suite
There is no Jest and no Vitest anywhere in this repo. `npm test` runs `scripts/validate-modules.mjs`,
which validates every module referenced by `public/modules/library.json` and exits non-zero on
failure. Run it before you touch anything under `public/modules/`. The five checks it performs are
detailed in [Development Setup](/developer/contributing/setup#npm-test).
:::

### Scripts with no npm alias

Run these with `node` directly.

| Script | Purpose |
|---|---|
| `scripts/gen-chords-progressions.mjs` | Generates the chords / progressions / cadences modules and patches `library.json` |
| `scripts/gen-melodies.mjs` | Generates the public-domain melodies and the `scale-systems` category |
| `scripts/perf/test-wasm-swap.mjs` | Headless end-to-end test of the WASM evaluator hot-swap |
| `scripts/perf/bench-render.mjs`, `bench-drag.mjs`, `bench-hover.mjs`, `bench-pick.mjs`, `bench-marquee.mjs`, `profile-sync.mjs`, `converge.mjs`, `who-dirties.mjs` | Playwright render/interaction benchmarks. They drive a **running** dev server |
| `scripts/perf/visual-regress.mjs` | Playwright pixel-diff regression harness (`--capture` / `--compare`) |

::: tip Pass `--url` explicitly
The Playwright harness scripts have inconsistent `--url` defaults (5173 and 3001 both appear), and
the dev server is on **3000**. Always pass `--url http://localhost:3000`.
:::

See [Performance](/developer/performance) for how to use them.

## What the Vite build produces

`npx vite build` on the current commit:

| Chunk | Raw | Gzip |
|---|---|---|
| `index-*.js` (entry) | 427.82 kB | 111.17 kB |
| `renderer-*.js` | 262.69 kB | 53.59 kB |
| `dsl-*.js` | 25.19 kB | 7.72 kB |
| `settings-panel-*.js` (async) | 23.65 kB | 8.19 kB |
| `rmt_core-*.js` (WASM glue) | 16.72 kB | 4.69 kB |
| `instruments-*.js` | 9.17 kB | 2.93 kB |
| `perf-harness-*.js` (async, `?perf` only) | 6.00 kB | 2.34 kB |
| `vendor-*.js` (fraction.js) | 5.75 kB | 2.22 kB |
| `rmt_core_bg-*.wasm` | 384.01 kB | 146.96 kB |
| `index.html` | 8.81 kB | 2.98 kB |

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
`import()`ed during `initApp()` (`src/main.js:112`), so it is out of the entry bundle but still
fetched on every boot. `perf-harness-*.js` is genuinely conditional — it is only ever downloaded with
`?perf` in the URL (`src/main.js:133`).

::: info `optimizeDeps.exclude: ['rmt-core']` is vestigial
`rmt-core` is not an npm dependency — the WASM glue is imported by relative path. The exclusion
matches nothing. Harmless, but do not read it as evidence of a package.
:::

## The committed WASM artifacts

This is the one non-obvious thing about the build.

```
rust/pkg/                    ← wasm-pack output. GITIGNORED.
  └── (copied by scripts/sync-wasm.mjs)
       ↓
src/wasm/rmt_core.js         ← COMMITTED. 42,725 bytes.
src/wasm/rmt_core_bg.wasm    ← COMMITTED. 384,008 bytes.
```

Vercel's build command is plain `vite build`. It never runs `wasm-pack`, and the build image has no
Rust toolchain. **The committed `src/wasm/` files are what gets bundled and shipped.** After any
change under `rust/`, run `npm run wasm:build` and commit the two synced files, or the deploy keeps
serving the old binary with no warning.

The binary is fetched and instantiated on every page load — and then, on the default path, never
used, because the WASM evaluator is
[opt-in and currently blocked](/developer/wasm/overview#status-the-evaluator-hot-swap-is-blocked).

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

The app's `buildCommand` deliberately overrides `npm run build` with bare `vite build` — that is what
skips `wasm:build` and consumes the committed artifacts instead.

`docs/` has its own `package.json` and its own `package-lock.json`, and its scripts (`dev`, `build`,
`preview`) call `vitepress` with **no path argument**, because Vercel's root directory is already
`docs/`. From the repo root, use the `docs:*` scripts instead.

### Docs site config

`docs/.vitepress/config.ts` sets the sitemap hostname to `https://docs.rmt.world`, local search
(`provider: 'local'`), the GitHub edit link, and `lineNumbers: true` on code fences.

::: warning A dead link fails the docs build
`ignoreDeadLinks: false`. One broken root-relative link and `npm run docs:build` exits non-zero,
naming the file. Write cross-links without the `.md` extension
(`/developer/wasm/overview`, not `/developer/wasm/overview.md`), and run `npm run docs:build` before
you push.
:::

## Release checklist

1. `npm test` — the module library still validates.
2. If you touched `rust/`: `npm run wasm:build`, then commit `src/wasm/rmt_core.js` and
   `src/wasm/rmt_core_bg.wasm`.
3. `npx vite build` — reproduces the Vercel build locally, without Rust.
4. `npm run preview` — sanity-check the bundle.
5. If you touched the renderer: measure and pixel-diff. See [Performance](/developer/performance) —
   `visual-regress.mjs` defaults to a 300-pixel tolerance (MSAA resolution is not bit-deterministic
   across runs, so a 0-pixel gate would be permanently red).
6. If you touched the docs: `npm run docs:build`.

## Licensing

The project is **MIT** (`LICENSE.md`, and `license = "MIT"` in `rust/Cargo.toml`). Third-party
components, per `THIRD_PARTY_NOTICES.md`: fraction.js (MIT), the VSCO-2 Community Edition sample sets
(CC0), Roboto Mono (Apache-2.0).

## See also

- [Development Setup](/developer/contributing/setup) — clone, install, run
- [Building WASM](/developer/wasm/building) — the Rust crate and the sync step
- [WASM Overview](/developer/wasm/overview) — why the WASM evaluator is off by default
- [Performance](/developer/performance) — the benchmark and pixel-diff harness
- [Code Style](/developer/contributing/code-style)
- [Pull Requests](/developer/contributing/pull-requests)
