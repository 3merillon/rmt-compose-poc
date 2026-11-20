---
title: WASM Overview
description: What the rmt-core Rust/WASM crate contains, which evaluator runs, how it is held to the JavaScript evaluator, and what it measures.
---

# WASM Overview

RMT Compose contains a Rust crate, `rmt-core`, that compiles to WebAssembly and implements the
bytecode evaluator a second time: exact values, per-variable evaluation order, the same records.
The compiled artifacts are committed to the repo and shipped with every deploy.

::: info WASM is the default in a browser
In a browser the app evaluates with the Rust core. A `Module` usually exists before the core is
ready, so it starts on the JavaScript `BinaryEvaluator` (`src/binary-evaluator.js`) and hot-swaps
to WASM when the core is ready. Both give the same records, so nothing changes on screen.
`?evaluator=js` in the URL keeps JavaScript and skips the fetch. In Node the JavaScript evaluator
runs unless a script opts in (see [Running Node scripts on WASM](#running-node-scripts-on-wasm)).
:::

## Which evaluator runs

| Where | How | Evaluator |
|---|---|---|
| Browser, no parameter | the default | WASM, after it loads (each `Module` starts on JavaScript and hot-swaps); JavaScript if the core fails to load |
| Browser, `?evaluator=js` | forced | JavaScript; the binary is not fetched |
| Browser, `?evaluator=wasm` | explicit default | Same as no parameter |
| Node, no variable | the default | JavaScript, unless the script has called `initWasm()` |
| Node, `RMT_EVALUATOR=js` | forced | JavaScript |
| Node, `RMT_EVALUATOR=wasm` | opt-in | WASM, once the script has called `initWasm()` |

The gate is `isEvaluatorHotSwapEnabled()` (`src/wasm/evaluator-adapter.js:114-116`). It also
checks `WASM_MATCHES_VARIABLE_LAYOUT` (`src/wasm/evaluator-adapter.js:46`), which is `true`. That
constant is a kill switch: set it to `false` and the WASM evaluator is off everywhere, even with
`?evaluator=wasm` (the browser prints a console warning saying so). Use it if a change to one
engine leaves the other behind. `RMT_EVALUATOR=wasm` in Node still runs the Rust core with the flag
`false`, so that the parity test can check it first (`src/wasm/evaluator-adapter.js:51`).

## What happens on page load

| Step | Where | Effect |
|---|---|---|
| `initWasm()` is called at import time | `src/store/app-state.js:7` | Shares the one initialization |
| `initWasm()` is `await`ed during `initApp()` | `src/main.js:82` | Shares it |
| `setTimeout(() => initWasm(), 0)` auto-init | `src/wasm/index.js:147` | Shares it |
| `Module` constructor registers a hot-swap callback | `src/module.js:139-145` | Only when the gate is open |
| Evaluation | `src/binary-evaluator.js` until the swap, then `src/wasm/evaluator-adapter.js` | JavaScript, or WASM after the swap |

`initWasm()` (`src/wasm/index.js:53`) is called three times at boot, and every call now shares one
initialization promise (`src/wasm/index.js:47`). Before that, each call fetched and instantiated
the module again, and the last to finish replaced the instance under objects made on an earlier
one: `recursive use of an object` errors, or a hang. With `?evaluator=js`, `initWasm()` returns
`false` before it fetches anything, so the 294 KB `rmt_core_bg.wasm` is never downloaded.

Otherwise `Module._upgradeEvaluators()` (`src/module.js:214`) swaps each module to the WASM
evaluator once the binary is ready. See [the hot-swap](/developer/wasm/adapters#the-hot-swap).

## The crate

`rust/src/` is crate `rmt-core`, version `0.1.0`, `license = "MIT"`.

| File | Contains |
|---|---|
| `lib.rs` | Module declarations, re-exports, `#[wasm_bindgen(start)] init()` (installs `console_error_panic_hook`), `version()` |
| `rational.rs` | `Q`, the exact rational |
| `exact.rs` | `Value`: rational, irrational, approximate. The twin of `src/value/exact.js` |
| `bytecode.rs` | Opcodes and the six variables |
| `variable_deps.rs` | The twin of `src/variable-deps.js` |
| `evaluator.rs` | `PersistentEvaluator` |
| `graph.rs` | `DependencyGraph` (not used by the app) |

The JS-visible exports (`src/wasm/rmt_core.js`) are `DependencyGraph`, `PersistentEvaluator`,
`init()` and `version()`, plus wasm-bindgen's own init entry points: `initSync` and the default
export `__wbg_init`, which `initWasm()` calls as `wasm.default()`.

`src/wasm/graph-adapter.js` is imported by nothing, so the app never constructs a
`DependencyGraph`. See [JS/WASM Adapters](/developer/wasm/adapters).

### Rational

`Q` (`rust/src/rational.rs:19`) is an exact fraction. While the numerator and denominator fit an
`i64` it is two machine words; past that it is a `BigRational`. The form is canonical: a value that
fits the small case is always held in it. Its `to_f64` is the twin of `toNumber()` in
`src/utils/fraction-num.js:78`.

### Exact values

`rust/src/exact.rs` follows `src/value/exact.js` operation by operation, so both engines compute
the same value, in the same canonical form, for every expression. There are three kinds:

- rational: a `Q`.
- irrational: a canonical sum of radical terms.
- approximate: a `Q` marked as measured or rounded (the `~` prefix and the `APPROX` opcode, `0x16`).

The caps are the same as in JavaScript: `MAX_TERMS` 64, `MAX_INT_POW` 8, `FACTOR_LIMIT` 65536
(`rust/src/exact.rs:29-31`), and so are the fallbacks when a cap is hit. In WebAssembly the power
function calls JavaScript's own `Math.pow`, so the doubles match to the bit. See
[Exact Values](/developer/core/symbolic-power) for the model.

### Variables and opcodes

`rust/src/bytecode.rs` has six variables, as the JavaScript evaluator does: `startTime` 0,
`duration` 1, `frequency` 2, `amplitude` 3, `attack` 4, `release` 5. Only 3 to 5 inherit from the
BaseNote. The opcodes `0x20`, `0x21` and `0x22` fail as unknown opcodes, as in JavaScript.

### PersistentEvaluator

`rust/src/evaluator.rs:675`. It holds notes and their records in arrays indexed by note id.
Evaluation is ordered per (note, variable) with Tarjan's strongly connected components, exactly
as `BinaryEvaluator.evaluateVariables()` does it (`rust/src/evaluator.rs:498`). Cycles and
unresolved references are not printed by Rust: it hands them to the JavaScript side, which prints
them in the JavaScript evaluator's own words.

Nothing is flattened to a float. Values cross to JavaScript whole: a rational as a numerator and
denominator, a rational too large for a double as text, an irrational as the text of its terms.
The records the adapter builds are the same as the JavaScript evaluator's. See
[JS/WASM Adapters](/developer/wasm/adapters#the-interface-of-persistentevaluator).

::: info Corruption flags never reach a shader
The renderer's hatching comes from a separate 3-value enum computed in JavaScript during
`RendererAdapter.sync()` (`0` clean, `1` transitive, `2` direct). The corruption bitmask says
*which property* is irrational; the renderer's value says *how* the note became corrupt. They are
different questions.
:::

## Loading

`src/wasm/index.js` is the loader. Its whole public surface:

| Export | Returns | Notes |
|---|---|---|
| `initWasm()` | `Promise<boolean>` | Shares one initialization. Resolves `false` before fetching when the gate is closed. Otherwise dynamic-imports `./rmt_core.js` and calls `wasm.default()`. Resolves `false` (never throws) while `WASM_CONFIG.fallbackOnError` is true |
| `getWasm()` | module or `null` | |
| `isWasmAvailable()` | `boolean` | True once the module is loaded |
| `isWasmInitialized()` | `boolean` | True after init **succeeds or fails** |
| `getWasmError()` | `Error` or `null` | |
| `getWasmVersion()` | `"0.1.0"` or `null` | The Rust crate version |
| `onWasmReady(cb)` | none | Runs `cb` on a microtask if WASM is already up; **never** fires if init already failed |

`onWasmReady` is the real readiness hook. There is **no `wasm:ready` eventBus event**.

## Running Node scripts on WASM

`scripts/wasm-node.mjs` is a preload. `node --import ./scripts/wasm-node.mjs <script>` sets
`RMT_EVALUATOR=wasm` and initializes WASM before the script runs, so every `Module` the script
creates evaluates on Rust (`scripts/wasm-node.mjs:15`). `scripts/perf/bench-node.mjs` takes
`--wasm`, `--runs N` and `--json` (`scripts/perf/bench-node.mjs:28-31`).

## How the two engines are held together

`scripts/test-wasm-parity.mjs` is part of `npm test`. It compares both engines exactly:

- All 96 library and fixture modules (`public/modules` except the generated `voices-*.json`,
  `scripts/fixtures/old-time`, `scripts/fixtures/legacy-syntax`), through a full evaluation, a
  commit in the middle, a BaseNote edit and a removal.
- 400 seeded fuzz modules over the exact algebra: tempered powers, sums of radicals, roots of
  negatives, `~`, division by zero and by sums, big constants, inherited interpretation
  variables, cycles. Each gets an edit.
- Ten evaluation suites run whole on WASM: `test-variable-deps`, `test-dirty-marking`,
  `test-relational-time` (which checks `scripts/fixtures/old-time-oracle.json`),
  `test-exact-values`, `test-exactness`, `test-note-kinds`, `test-amplitude`, `test-envelopes`,
  `test-library`, `test-legacy-syntax`.

It compares every record (fractions, exact values, flags), the console reports, and the cache's
size, keys and order: about 47,600 records. `scripts/perf/test-wasm-swap.mjs` is in `npm test`
too: the hot-swap, and three concurrent `initWasm()` calls fetch the module once. After changing
either engine, run `npm test`; the parity test must pass.

## Speed

Measured on one Windows machine, Node 22 and headless Edge. Treat the numbers as an order of
magnitude, not a promise.

**Node.** `scripts/perf/bench-pairs.mjs`: five back-to-back pairs, medians of the p50, record
read-back included. JS time divided by WASM time:

| Module | Full evaluation | Mid commit | Base edit |
|---|---|---|---|
| `chain-1000` | 1.4x | 1.7x | 1.8x |
| `lattice-1000` | 1.6x | 1.9x | 2.1x |
| `fan-1000` | 1.25x | 1x (one note is dirty: 0.03 ms on both) | 1.7x |
| `chords-dense` (800 notes) | 1.15x | 1.3x | 1.4x |
| `comma-chain-400` (fractions of hundreds of digits) | 5.2x | 6.4x | 6.3x |

On `comma-chain-400` JavaScript takes about 160 ms and WASM 25 to 31 ms.

**Edge.** Full evaluation of `chain-1000`: JavaScript 2.3 to 3.2 ms, WASM 0.9 to 1.2 ms.
`voices-20000`: JavaScript 50 ms, WASM 29 to 33 ms.

**End to end.** A commit (an octave change: expression rewrite, dirty marking, evaluation,
renderer sync, history snapshot) costs the same on both engines: `chain-1000` about 2.2 ms (11 ms
before the dirty-marking change), `voices-20000` about 26 ms. Evaluation is a small part of it. At
20,000 notes what remains is renderer sync and the autosave's `localStorage` write; the rewrite
check and the snapshot text now cost what the edit changed. See
[Performance](/developer/performance#the-commit-what-an-edit-costs).

## Limits

Note ids are 16-bit in the bytecode. The loader refuses ids above 65535, so `voices-100000`
loads 65,536 notes.

## See also

- [JS/WASM Adapters](/developer/wasm/adapters): the JS layer, `WASM_CONFIG`, the `?evaluator` gate
- [Building WASM](/developer/wasm/building): rebuilding the crate and syncing the artifacts
- [Build & Deploy](/developer/contributing/build-and-deploy): why the committed artifacts are what ships
- [Binary Evaluator](/developer/core/binary-evaluator): the JavaScript evaluator
- [Exact Values](/developer/core/symbolic-power): the value model both engines share
