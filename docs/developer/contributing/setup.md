---
title: Development Setup
description: Clone, install and run RMT Compose — the real Node version, every npm script, the dev-only URL flags, the WASM rebuild path and the perf harness.
---

# Development Setup

RMT Compose is a plain ES-module web app built with Vite 7. There is no framework, no TypeScript in
`src/`, and one runtime dependency (`fraction.js`). Getting it running takes two commands.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | **20.19+ or 22.12+** | Vite 7.1.12 declares `engines: ^20.19.0 \|\| >=22.12.0`. Node 18 cannot run the dev server. |
| **npm** | ships with Node | The lockfile is npm's. |
| **Git** | any recent | — |
| Browser | WebGL2 + Web Audio | The workspace is a single WebGL2 canvas and does not start without it. |

::: warning Node 18 does not work
The README and older docs said "Node.js 18+". That is wrong: Vite 7 refuses to run on it. Check with
`node --version` before you file a bug about `npm run dev`.
:::

Optional, and only for specific tasks:

| Tool | Needed for |
|---|---|
| **Rust** (via [rustup](https://rustup.rs/)) + **wasm-pack** | Rebuilding the WASM core (`npm run wasm:build`). The built artifacts are committed, so you do **not** need Rust to run or bundle the app. |
| **ffmpeg** on `PATH` | `npm run samples:build` only — rebuilding the bundled piano/violin sample packs. |

## Quick start

```bash
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
npm ci
npm run dev
```

Vite serves on **`http://localhost:3000`** and opens your browser automatically
(`vite.config.js` sets `server.port: 3000`, `server.open: true`).

## Scripts

The everyday commands:

| Script | Runs | Notes |
|---|---|---|
| `npm run dev` | `vite` | Dev server, port 3000, auto-opens. |
| `npm test` | `node scripts/validate-modules.mjs && node scripts/test-exactness.mjs && node scripts/test-variable-deps.mjs && node scripts/test-amplitude.mjs && node scripts/test-midi-export.mjs` | Validates every shipped library module, proves exact arithmetic end to end, then checks per-variable evaluation order, the amplitude variable and the MIDI export. The repo's only automated check. |
| `npm run build` | `npm run wasm:build && vite build` | **Requires Rust + wasm-pack.** Use `npx vite build` to bundle without Rust — see the warning below. |
| `npm run perf:gen` / `npm run perf:bench` | `scripts/perf/…` | Generate the stress modules; run the headless evaluation benchmark. |
| `npm run docs:dev` / `npm run docs:build` | `vitepress` | This documentation site. |

The full 13-script inventory — the WASM build chain, the module and sample generators, the preview
servers — is in [Build & Deploy](/developer/contributing/build-and-deploy#the-scripts).

::: warning `npm run build` shells out to wasm-pack
`"build": "npm run wasm:build && vite build"`. Without Rust and `wasm-pack` on your `PATH` it fails
at the first step, before Vite ever runs.

**To bundle the app without Rust, run `npx vite build`.** That is exactly what the production deploy
does — `vercel.json` overrides the build command to plain `vite build` and consumes the *committed*
WASM artifacts in `src/wasm/`.
:::

### `npm test`

There is no unit-test framework in this repo — no vitest, no jest. `npm test` runs six scripts.
The first, `scripts/validate-modules.mjs`, walks every item in the v2 manifest
`public/modules/library.json` and checks five things per module:

1. **Structure** — a `baseNote` object and a `notes` array.
2. **Expressions** — every string under the six expression keys (`startTime`, `duration`,
   `frequency`, `amplitude`, `attack`, `release`) passes `validateExpressionSyntax`.
3. **Self-containment** — every `[id]` reference resolves to a note defined in
   the same file (or to the base, id 0). This is what lets a module be dropped onto *any* target
   note: on import, id 0 is remapped to the target and the internal ids are renumbered.
4. **Evaluation** — `Module.loadFromJSON` + `evaluateModule` yields a finite `startTime`,
   `duration` and `frequency` for every note that declares them. Catches NaN, infinities and cycles.
5. **Ratio / cents** — for single-note interval modules, the evaluated frequency equals
   `ratio × base` and the manifest's `cents` equals `1200·log2(ratio)`.

```
$ npm test
Validating modules across 6 sections...

  intervals: 46/46 ok
  chords: 11/11 ok
  progressions: 8/8 ok
  melodies: 7/7 ok
  scale-systems: 6/6 ok
  custom: 1/1 ok

79 modules validated, 0 failure(s).
```

The second, `scripts/test-exactness.mjs`, proves the arbitrary-precision guarantee: a 200-note
`(3/2)` chain must evaluate to its exact 98-digit numerator (checked against native BigInt) and
survive the full compile → evaluate → decompile → save → load → re-evaluate round trip, and a
~98-digit `(N/D)` literal must round-trip through `LOAD_CONST_BIG` digit-exact.

The third, `scripts/test-variable-deps.mjs`, locks in that dependencies are ordered and
cycle-checked per (note, variable) rather than per note:

1. **Two notes reading each other** through different variables (`[1].f` from `[2].f`, `[2].t`
   from `[1].t + [1].d`) evaluate exactly, on the first evaluation.
2. **A note's own variables** may read each other in any direction (a start from the same note's
   duration, the BaseNote's duration from its own frequency), including through an inherited
   amplitude, attack or release.
3. **A true cycle is still refused** — by `validateExpression()` with the widget's two messages,
   and by the evaluator with a console error that names the loop and values that do not drift.
4. **An unresolved reference is named** in a console error instead of vanishing into a default.
5. **Incremental equals fresh** — after seeded random edits (cyclic ones included) every module
   must equal a fresh load of its own JSON, variable for variable.
6. **Amplitude is part of all of it** — ordered per variable, inherited from the BaseNote and
   cycle-checked like `duration`. One thing differs: an amplitude nobody sets is 1 by definition,
   so reading it is not an unresolved reference.

The fourth, `scripts/test-amplitude.mjs`, covers the variable `amplitude` on its own:

1. **Old modules are untouched** — no shipped module gains an `amplitude` key when saved, and
   every note in them sounds at exactly 1.
2. **Inheritance** — a note without an amplitude sounds at the BaseNote's and stores nothing,
   `[N].a` reads what such a note sounds at, and `a`, `amp` and `amplitude` compile to the same
   bytecode.
3. **Exactness** — a 50-note `(121/100)` chain keeps every digit, and an irrational amplitude sets
   corruption flag `0x08` and no other. `scripts/test-exact-values.mjs` checks the exact values
   (twelve `2^(1/12)` give exactly 2, `~` propagates, Evaluate to BaseNote writes exact relations).
4. **Round trips** — a snapshot and a saved (reindexed) file evaluate to the same gains, and
   removing a note's amplitude removes the key from the file.
5. **The clamp** — the audio boundary limits the gain to 0–4 while the module keeps the exact value.

The fifth, `scripts/test-midi-export.mjs`, exports modules with `src/midi/midi-export.js`, reads
the bytes back with a Standard MIDI File parser that shares no code with the exporter, and
requires every note within 0.1 cent and one tick of the module's evaluated value, on a channel of
its own. It covers the default module, all 79 library modules and synthetic cases — see
[MIDI Export](/developer/api/midi-export#the-check).

The sixth, `scripts/test-relational-time.mjs`, locks in relational time:

1. **Old modules convert exactly.** `scripts/fixtures/old-time-oracle.json` holds every start,
   duration, frequency and amplitude of the library modules and of the old-format fixtures in
   `scripts/fixtures/old-time/`, as evaluated by the engine that still had tempo, beats per measure
   and measure length (the engine at commit `6bf71cf`). Each module is loaded now and every value must be
   the same fraction. A bar's new duration must equal its old measure length, and the BaseNote's
   duration must equal `60 /` its old tempo.
2. **The language.** `beat()`, `tempo()`, `measure()`, `.bpm` and the other removed names are refused
   with a message naming what replaced them; `base.d` is the time unit.
3. **Measure bars.** Add Measure chains `[p].t + [p].d` / `[p].d`, and a saved module keeps the bar
   flag and no old key.
4. **Interpretation.** `attack` and `release` evaluate and fall back to the BaseNote's like
   `amplitude`; start, duration and frequency never fall back.

`node scripts/test-relational-time.mjs --oracle <file> <root>` compares another oracle, made with the
old engine, against the files under `<root>`.

Two more scripts are not part of `npm test`. `node scripts/migrate-modules.mjs <file-or-folder>
[--dry-run]` converts module files on disk to relational time in place, with the same conversion the
app applies on load (files already converted are left untouched). `node scripts/check-doc-citations.mjs
[docs/folder-or-page.md]` prints every source line citation in the docs beside the line it names now;
run it after editing `src/`, because the developer pages cite line numbers.

`npm test` exits non-zero on any failure. Run it after **any** change to the DSL, the expression
compiler, the evaluator, or anything under `public/modules/`.

::: warning A passing module is not a correct module
`validateExpressionSyntax` rejects malformed expressions of **either** syntax — the compiler throws
on anything neither parser can read, and the validator reports it as `valid: false`. What
`npm test` cannot check is intent: a module that loads and evaluates to finite numbers is not
necessarily a module that says what you meant.
:::

## Project layout

```
rmt-compose-poc/
├── index.html              # loads /src/main.js
├── vite.config.js          # port 3000, manualChunks, publicDir
├── vercel.json             # app deploy (buildCommand: vite build)
├── src/
│   ├── main.js             # entry point
│   ├── player.js           # orchestrator: transport, selection, commits, undo wiring
│   ├── module.js           # Module: notes, dep registration, evaluation, JSON load/save
│   ├── note.js             # Note: six BinaryExpressions + color/instrument/measure
│   ├── expression-compiler.js  # DSL compile entry point + LRU compile cache
│   ├── binary-note.js      # bytecode format (OP / VAR / CORRUPT)
│   ├── binary-evaluator.js # stack VM + incremental evaluator
│   ├── dependency-graph.js # forward + inverse, per-property indexes
│   ├── dsl/                # the PRIMARY expression language: lexer, parser,
│   │                       #   compiler, decompiler, simplify
│   ├── renderer/webgl2/    # renderer, workspace, camera-controller, renderer-config
│   ├── player/             # audio-engine, audio-graph, reverb, amplitude
│   ├── midi/               # midi-export: module → Standard MIDI File
│   ├── migrate/            # relational-time: old time model → relational form, on load
│   ├── instruments/        # synths + multisampled piano/violin
│   ├── modals/             # note widget, group widget
│   ├── menu/               # module library / module bar
│   ├── settings/           # settings-schema, settings-store, settings-panel
│   ├── theme/              # presets, theme-manager
│   ├── store/              # app-state, history (undo/redo)
│   ├── dev/                # perf-harness (loaded only with ?perf)
│   ├── wasm/               # WASM loader, config, evaluator adapter,
│   │                       #   + the COMMITTED rmt_core.js / rmt_core_bg.wasm
│   └── utils/              # event-bus, simplify, validators
├── rust/                   # the rmt-core crate (Cargo.toml, src/*.rs)
├── scripts/                # validate-modules, generators, sync-wasm, perf/
├── public/
│   ├── modules/            # library.json (v2 manifest) + the 79 shipped modules
│   ├── samples/            # CC0 multisampled piano + violin
│   └── styles.css
└── docs/                   # this VitePress site (its own package.json)
```

Two things new contributors get wrong:

- The entry point is **`src/main.js`**, not `src/index.js` (which does not exist).
- **`src/dsl/`** is the expression language, the only one. `src/expression-compiler.js` is a cache
  in front of it; `src/migrate/` converts older modules when they load.

## Dev-only flags

None of these has UI. They are read from the URL query string or `localStorage`.

| Flag | Effect |
|---|---|
| `?perf` (any value, e.g. `?perf=1`) | Loads `src/dev/perf-harness.js` and exposes `window.__rmtPerf`, `window.__rmtRenderer`, `window.__rmtWorkspace`. The harness is a separate lazily-fetched chunk — it never downloads without this flag. |
| `?atlas=0` / `?atlas=1` | Force the glyph atlas off/on. Default on. Also settable via the `rmt:atlas` localStorage key. |
| `?evaluator=js` | Force the JavaScript evaluator. Same as the default, but explicit. |
| `?evaluator=wasm` | Ignored with a console warning: the WASM evaluator is disabled until the Rust core is ported — see below. |

localStorage keys the app uses: `rmt:moduleSnapshot:v1` (the autosaved composition),
`rmt:moduleSnapshot:v1:unloadable` (a saved session that could not be loaded; the default module opens
instead), `rmt:settings:v1` (the settings store), `ui-state` (the module-library layout), `rmt:atlas`.

## WebAssembly

The Rust crate in `rust/` (`rmt-core` 0.1.0, MIT) compiles to WASM and provides an *alternative*
evaluator. You do not need it to develop:

- `src/wasm/rmt_core.js` and `src/wasm/rmt_core_bg.wasm` are **committed build artifacts**. They are
  what the app imports and what the deploy ships. `rust/pkg/` is gitignored.
- The WASM binary is **not fetched at all**: `initWasm()` returns `false` early because
  `isEvaluatorHotSwapEnabled()` is `false` (`src/wasm/evaluator-adapter.js:50-54`), in a browser and
  in headless Node alike.

::: danger The WASM evaluator is disabled
The Rust core still has the old variable layout (`tempo`, `beatsPerMeasure`, `measureLength`), so
`WASM_MATCHES_VARIABLE_LAYOUT` is `false` in `src/wasm/evaluator-adapter.js`, `?evaluator=wasm` is
ignored with a console warning, and every code path runs on the JavaScript evaluator. Porting the
Rust core is planned. Do not tell a user to pass the flag, and do not build a feature on it.
:::

Rebuilding the core, if you touched `rust/src/`:

```bash
npm run wasm:build   # wasm-pack build --target web --out-dir pkg, then sync-wasm.mjs
```

`scripts/sync-wasm.mjs` copies exactly two files — `rmt_core.js` and `rmt_core_bg.wasm` — from
`rust/pkg/` into `src/wasm/`. **Commit them.** If you skip the sync step, the app keeps loading the
previous binary and your Rust change silently does nothing.

The `WASM_CONFIG` flags in `src/wasm/config.js` are the JS-side switches: `useEvaluator`,
`usePersistentCache`, `fallbackOnError`, `logPerformance` and `debug`. Every flag reaches live
code — the old dead switches for the unimported adapters (`useFractions`, `useGraph`,
`useCompiler`) no longer exist.

## Performance and visual-regression harness

Renderer changes are held to a hard project rule: **measure and pixel-diff, never eyeball**. The
renderer used to rebuild everything every frame, which hid latent bugs; gating redraws unmasked them.
See [Performance](/developer/performance) for the measured numbers.

Only two harness entry points are npm scripts:

```bash
npm run perf:gen     # write stress modules to public/modules/perf/
npm run perf:bench   # headless Node evaluation benchmark (no renderer)
```

Everything else runs directly with `node` and drives a **running dev server** through Playwright:

```bash
node scripts/perf/bench-render.mjs   voices-5000
node scripts/perf/bench-drag.mjs     --module hub-5000 --steps 200
node scripts/perf/bench-pick.mjs
node scripts/perf/who-dirties.mjs
node scripts/perf/converge.mjs
node scripts/perf/visual-regress.mjs --capture
node scripts/perf/visual-regress.mjs --compare
```

Every app harness script defaults to `http://localhost:3000` — the port `npm run dev` pins — so
`--url` is only needed for a non-default server. (The two docs-site scripts are the exceptions:
`check-docs-rendered.mjs` targets 4173 and `shot-docs.mjs` defaults to 3005.)

Two more things about the harness:

- **`visual-regress.mjs` tolerates 300 differing pixels by default, not 0.** The GL context uses
  `antialias: true`, and MSAA resolution is not bit-deterministic across runs — re-comparing an
  unchanged build still flips a handful of pixels. A zero-pixel gate would be permanently red.
- The `voices-*` stress modules are gitignored (the 100k one is 16 MB). Run `npm run perf:gen` before
  any render benchmark.

In the browser, `?perf=1` exposes `window.__rmtPerf` with `measureEval()`, `measureCommit()`,
`measureSync()`, `measureRedraw()`, `profileFrame()`, `pickHubNoteId()` and `report()`.

::: warning `__rmtPerf.loadStress()` overwrites your work
It writes the stress module into `rmt:moduleSnapshot:v1` — the same key that autosaves your
composition — and reloads the page. Run `__rmtPerf.restoreDefault()` to get back to the default
module. Do not run it in a session you care about.
:::

## Documentation site

The docs are a separate VitePress project with their own `package.json` and lockfile in `docs/`.
From the repo root:

```bash
npm run docs:dev      # dev server
npm run docs:build    # → docs/.vitepress/dist
```

`docs/.vitepress/config.ts` sets `ignoreDeadLinks: false`, so a broken internal link **fails the
build**. Run `npm run docs:build` before you push a docs change — that is your link check.

## Production build and deploy

The app and the docs are two independent Vercel projects built from one repo.

| | App | Docs |
|---|---|---|
| Config | `vercel.json` (repo root) | `docs/vercel.json` (Vercel root dir = `docs/`) |
| Build command | `vite build` — **not** `npm run build` | `npm run build` (→ `vitepress build`) |
| Output | `dist/` | `.vitepress/dist` |

The root build command deliberately skips `wasm:build`: Vercel's image has no Rust toolchain, so the
deploy consumes the committed `src/wasm/` artifacts. The consequence is worth internalising — **a
stale committed artifact ships silently.**

## Troubleshooting

### The app boots to an empty workspace after you edited `src/`

Vite HMR intermittently strands this app's boot path. The module never loads, `getModule()` returns
`null`, and there is **no console error** — the canvas just comes up empty. It looks exactly like a
code regression you introduced. It is not: a fresh server with the same code works every time.

Kill every Vite server (watch for strays left on 3000/3001/3002 by earlier sessions) and start one
fresh before you verify anything in a browser.

### `wasm-pack: command not found` from `npm run build`

Expected. Use `npx vite build`, or install Rust and wasm-pack. See the warning above.

### `WebGL2 not available` in the console

The renderer logs this and bails out when `canvas.getContext('webgl2')` returns `null`
(`src/renderer/webgl2/renderer.js:477`). Update the browser, enable hardware acceleration, check GPU
drivers. There is no fallback renderer — the workspace does not initialise without WebGL2.

### The port is taken

`vite.config.js` pins port 3000. If it is in use, Vite picks another and prints it; the perf
scripts still default to 3000, so pass `--url` with the port Vite actually chose.

## Style and tooling

The repo has **no ESLint config, no Prettier config, and no `lint` or `format` script**. Nothing is
machine-enforced. Do not point a formatter at this codebase — it will reflow files that no one asked
you to touch. Read [Code Style](/developer/contributing/code-style) and match the file you are in.

`rust-analyzer` is worth installing if you work in `rust/`. `cargo fmt` is the Rust convention here.

## See also

- [Code Style](/developer/contributing/code-style) — the conventions, including how code writes
  expressions
- [Pull Requests](/developer/contributing/pull-requests) — what to run before you submit
- [System Architecture](/developer/architecture/overview) — how the pieces fit
- [Performance](/developer/performance) — the harness and the measured numbers
- [Building WASM](/developer/wasm/building) — the Rust crate in detail
