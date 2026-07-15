---
title: Installation
description: Run RMT Compose from the hosted app or locally with Node 20.19+, build it for production, and rebuild the Rust/WASM core.
---

# Installation

This page gets you a running copy of RMT Compose — hosted or local — plus the production build, the module-library validator, and the optional Rust/WASM rebuild. If you only want to use the app, the first section is all you need.

## Hosted app

**[https://rmt.world](https://rmt.world)**

Nothing to install. Everything runs client-side in the browser.

## Local installation

### Prerequisites

- **Node.js 20.19+ or 22.12+** — from [nodejs.org](https://nodejs.org/). The project uses Vite 7, whose `engines` field is `^20.19.0 || >=22.12.0`. **Node 18 will not run the dev server.**
- **Git** — to clone the repository
- **A WebGL2 browser** — Chrome, Firefox, Edge or Safari

Rust is **not** required to run or develop the app. It is only needed to rebuild the WebAssembly core; see [Rebuilding the WASM core](#rebuilding-the-wasm-core).

### Steps

1. **Clone the repository**

```bash
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
```

2. **Install dependencies**

```bash
npm install
```

3. **Start the dev server**

```bash
npm run dev
```

Vite listens on **`http://localhost:3000`** and opens your browser automatically.

## Production build

There are two build paths, and the difference matters.

**Without Rust** — this is what the production deploy actually runs:

```bash
npx vite build
```

**With Rust** — rebuilds the WebAssembly core first, then bundles:

```bash
npm run build      # = npm run wasm:build && vite build
```

::: warning `npm run build` needs Rust
`npm run build` chains `wasm:build`, which shells out to `wasm-pack`. Without Rust and `wasm-pack` on your `PATH` it fails at the first step. If you have not touched the Rust crate, use `npx vite build` — the committed WebAssembly artifacts in `src/wasm/` are the ones that ship anyway.
:::

Either way, output lands in `dist/`. Serve it locally with:

```bash
npm run preview
```

## Validate the module library

```bash
npm test
```

This is **not** a unit-test suite — the repository has no test framework. `npm test` runs `scripts/validate-modules.mjs`, which walks every module listed in `public/modules/library.json` and checks that it parses, that every expression is valid, that no note references anything outside its own module, that it evaluates to finite values, and that each interval module's ratio matches the cents recorded in the manifest.

A healthy run prints:

```
Validating modules across 6 sections...
  intervals: 46/46 ok
  chords: 11/11 ok
  progressions: 8/8 ok
  melodies: 7/7 ok
  scale-systems: 6/6 ok
  custom: 1/1 ok
79 modules validated, 0 failure(s).
```

Run it after editing any module JSON.

## Run these docs

```bash
npm run docs:dev
```

VitePress serves the site in `docs/`. `npm run docs:build` and `npm run docs:preview` do what you'd expect.

## Rebuilding the WASM core

The repository contains a Rust crate (`rust/`, package `rmt-core` v0.1.0) that compiles to WebAssembly. **Its build artifacts are committed** to `src/wasm/` — that committed copy is what the app imports and what the production deploy ships. `rust/pkg/` (the raw `wasm-pack` output) is gitignored.

You only need this if you change the Rust source.

### Prerequisites

- **Rust** — from [rustup.rs](https://rustup.rs/)
- **wasm-pack** — `cargo install wasm-pack`

### Build and sync

```bash
npm run wasm:build
```

That runs `wasm-pack build --target web --out-dir pkg` inside `rust/`, then runs `scripts/sync-wasm.mjs`, which copies `rmt_core.js` and `rmt_core_bg.wasm` from `rust/pkg/` into `src/wasm/`.

**Commit the updated `src/wasm/rmt_core.js` and `src/wasm/rmt_core_bg.wasm`.** If you don't, the deploy keeps shipping the old binary, silently.

If you built the crate by hand, run the sync step alone:

```bash
npm run wasm:sync
```

::: warning The WASM evaluator is not active
The Rust core is fetched and initialised on every page load, but **all expression evaluation runs on the JavaScript engine.** Enabling the WebAssembly evaluator is opt-in and is currently blocked by a hang inside the Rust `PersistentEvaluator`. Do not expect a speed-up from it, and do not enable it. The JavaScript path is the shipped path and is what the app is tuned against.
:::

## All npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 3000; opens the browser |
| `npx vite build` | Production build to `dist/` **without** Rust — what the deploy runs |
| `npm run build` | `wasm:build` then `vite build`. **Requires Rust + wasm-pack** |
| `npm run preview` | Serve the built `dist/` (Vite's default preview port, 4173) |
| `npm test` | Validate every module in the library manifest |
| `npm run wasm:build` | Rebuild the Rust crate and sync artifacts into `src/wasm/` |
| `npm run wasm:sync` | Copy `rust/pkg/` → `src/wasm/` only |
| `npm run gen:intervals` | Regenerate the 46 interval modules and patch the manifest |
| `npm run perf:gen` | Generate stress modules into `public/modules/perf/` |
| `npm run perf:bench` | Headless Node evaluation benchmark |
| `npm run samples:build` | Rebuild the sampled piano and violin. **Requires ffmpeg and network access** |
| `npm run docs:dev` | This documentation site |
| `npm run docs:build` | Build the docs to `docs/.vitepress/dist` |
| `npm run docs:preview` | Preview the built docs |

The chord/progression and melody generators have no npm alias — run them with `node scripts/gen-chords-progressions.mjs` and `node scripts/gen-melodies.mjs`.

::: danger Do not routinely re-run the melody generator
`scripts/gen-melodies.mjs` is behind the shipped JSON. Amazing Grace, Bach Minuet and Greensleeves were corrected by hand after the generator last ran; re-running it would overwrite all three with the older versions the script still encodes. The files in `public/modules/melodies/` are the truth.
:::

## Browser support

RMT Compose requires **WebGL2** — without it, the workspace canvas does not initialise:

| Browser | Minimum version |
|---------|-----------------|
| Chrome | 56+ |
| Firefox | 51+ |
| Safari | 15+ |
| Edge | 79+ |

Any browser released in the last several years qualifies. WebAssembly support is not required for the app to work.

## Troubleshooting

### The dev server won't start

- Check your Node version: `node --version`. It must be **20.19+ or 22.12+**. Node 18 fails on Vite 7.
- Reinstall dependencies: delete `node_modules` and run `npm install` again.
- Check whether something else is already on port 3000.

### `npm run build` fails with "wasm-pack: command not found"

You don't have the Rust toolchain, and you probably don't need it. Run `npx vite build` instead — it uses the committed WebAssembly artifacts.

### "WebGL2 not available"

- Update your browser.
- Check that hardware acceleration is enabled in browser settings.
- Update your graphics drivers, or try another browser.

### A module fails to load

- Run `npm test` — it will tell you which module and which expression is bad.
- Check the browser console. Expression errors are logged there.
- Clear the browser cache and reload.

## Next steps

Continue to [Your First Composition](/getting-started/first-composition).
