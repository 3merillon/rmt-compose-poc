---
title: WASM Overview
description: What the rmt-core Rust/WASM crate contains, why the WASM evaluator is disabled by default, and the open bug that blocks it.
---

# WASM Overview

RMT Compose contains a Rust crate, `rmt-core`, that compiles to WebAssembly and implements a
bytecode evaluator, a dependency graph, an expression compiler and an arbitrary-precision
`Fraction`. The compiled artifacts are committed to the repo and shipped with every deploy.

::: danger The WASM evaluator does not run in the shipped app
All evaluation in the browser runs on the **JavaScript** `BinaryEvaluator`
(`src/binary-evaluator.js`). The WASM evaluator is opt-in behind `?evaluator=wasm`, and turning it
on **hangs the tab** — a non-deterministic infinite loop inside the Rust `PersistentEvaluator`. The
hot-swap machinery around it is finished and passes end-to-end in Node; only the Rust side is
broken. See [Status: blocked](#status-the-evaluator-hot-swap-is-blocked).

Do not tell a user to pass `?evaluator=wasm`, and do not describe WASM as an app performance
feature. The JS path carries the app on its own: a full re-evaluation of the 1000-note
`chain-1000` stress module is ~3 ms, and an incremental commit is under 1 ms
(`node scripts/perf/bench-node.mjs chain-1000`). See [Performance](/developer/performance).
:::

## What actually happens on page load

| Step | Where | Effect |
|---|---|---|
| `initWasm()` is called eagerly at import time | `src/store/app-state.js:6` | **Returns `false` early** unless `?evaluator=wasm` — no fetch |
| `initWasm()` is `await`ed during `initApp()` | `src/main.js:77` | Same early-out on the default path |
| `setTimeout(() => initWasm(), 0)` auto-init | `src/wasm/index.js:136-145` | Same call, same gate, deduped by a `wasmInitialized` guard |
| `Module` constructor registers a hot-swap callback | `src/module.js:62-68` | **Only if** `isEvaluatorHotSwapEnabled()` — false in a browser without `?evaluator=wasm` |
| Evaluation | `src/binary-evaluator.js` | JS |

So on the default path the 384 KB `rmt_core_bg.wasm` is **never downloaded or instantiated** —
every boot-time caller funnels through `initWasm()`, which checks `isEvaluatorHotSwapEnabled()`
before touching the network. Only `?evaluator=wasm` (or headless Node, which has no `window` and
passes the gate so benches and tests can run) pays the fetch+instantiate.

A consequence worth knowing: because `isWasmAvailable()` stays `false` on the default path,
modules constructed *later* in a session — a file load, an undo/redo snapshot restore — can no
longer silently pick up a WASM-backed evaluator through `createEvaluator()`. Every evaluator is JS
unless the opt-in is set.

## The crate

`rust/src/` — crate name `rmt-core`, version `0.1.0`, `license = "MIT"`.

| File | Contains |
|---|---|
| `lib.rs` | Module declarations, re-exports, `#[wasm_bindgen(start)] init()` (installs `console_error_panic_hook`), `version()` |
| `fraction.rs` | `Fraction` — a wrapper around `num-rational`'s `BigRational` |
| `value.rs` | `Value`, `SymbolicPower`, `PowerTerm`, the corruption-flag constants |
| `bytecode.rs` | Opcode definitions |
| `evaluator.rs` | `Evaluator`, `PersistentEvaluator`, `EvaluatedNote`, `FractionData` |
| `graph.rs` | `DependencyGraph` |
| `compiler.rs` | `ExpressionCompiler` |

The JS-visible exports (`src/wasm/rmt_core.js`) are `DependencyGraph`, `Evaluator`,
`ExpressionCompiler`, `Fraction`, `PersistentEvaluator`, `init()` and `version()`, plus
wasm-bindgen's own init entry points — `initSync` and the default export `__wbg_init`, which
`initWasm()` calls as `wasm.default()`.

::: warning There is no class called `Compiler`
It is `ExpressionCompiler`. Older docs and snippets that `import { Compiler }` will fail.
:::

### Fraction

```rust
// rust/src/fraction.rs
#[wasm_bindgen]
pub struct Fraction {
    inner: BigRational,
}
```

A string-based `FractionRepr { n: String, d: String, s: i8 }` is declared but not wired up:
evaluated values actually cross the JS boundary as the u32-capped `FractionData`
(`rust/src/evaluator.rs`), so numerators or denominators beyond u32 degrade to a float
approximation. The bytecode channel is the exception — `LOAD_CONST_BIG` constants cross
BigInt-exact in both directions.

### Value

Three variants, not two:

```rust
// rust/src/value.rs
pub enum Value {
    Rational(Fraction),        // exact: 3/2, 440/1
    Irrational(f64),           // legacy f64 approximation
    Symbolic(SymbolicPower),   // algebraic structure preserved
}
```

### SymbolicPower

A rational coefficient times a **product** of power terms — not a single `base^exponent`:

```rust
pub struct PowerTerm {
    pub base: u32,          // positive integer base (2, 3, 5, …)
    pub exponent: Fraction, // rational exponent
}

pub struct SymbolicPower {
    pub coefficient: Fraction,
    pub powers: Vec<PowerTerm>,
}
```

This shape is what lets `2^(1/12) * 2^(1/12)` collapse to `2^(1/6)`, and what lets an arrow
multiplier fold into the `coefficient` instead of stacking another term. It mirrors the JS
[SymbolicPower](/developer/core/symbolic-power).

### EvaluatedNote

A plain serde struct — the values, plus one byte of flags:

```rust
// rust/src/evaluator.rs
pub struct EvaluatedNote {
    #[serde(rename = "startTime")]
    pub start_time: Option<FractionData>,
    pub duration: Option<FractionData>,
    pub frequency: Option<FractionData>,
    pub tempo: Option<FractionData>,
    #[serde(rename = "beatsPerMeasure")]
    pub beats_per_measure: Option<FractionData>,
    #[serde(rename = "measureLength")]
    pub measure_length: Option<FractionData>,
    #[serde(default, rename = "corruptionFlags")]
    pub corruption_flags: u8,
}
```

`FractionData` carries `s` (sign), `n`, `d` for rationals and `f` for an irrational approximation,
plus a `corrupted` boolean and an optional `symbolic` payload.

### Corruption flags

`u8`, one bit per property (`rust/src/value.rs`):

| Constant | Value |
|---|---|
| `CORRUPT_START_TIME` | `0x01` |
| `CORRUPT_DURATION` | `0x02` |
| `CORRUPT_FREQUENCY` | `0x04` |
| `CORRUPT_TEMPO` | `0x08` |
| `CORRUPT_BEATS_PER_MEASURE` | `0x10` |
| `CORRUPT_MEASURE_LENGTH` | `0x20` |

`corruption_flag_for_var(var_index)` maps the bytecode variable index (0–5) to its bit.

::: info These flags never reach a shader
The renderer's hatching is driven by a separate 3-value enum computed in JS during
`RendererAdapter.sync()` (`0` clean, `1` transitive, `2` direct — crosshatch for direct, single
diagonal hatch for transitive). The Rust bitmask says *which property* is irrational; the renderer's
value says *how* the note became corrupt. They are different questions and different code paths.
:::

## The compiler only understands legacy syntax

`ExpressionCompiler` in `rust/src/compiler.rs` parses the **legacy method-chain grammar** only —
`module.baseNote.getVariable('frequency')`, `module.getNoteById(3).getVariable('startTime')`, and
`.add()/.sub()/.mul()/.div()/.pow()` chains. It has no lexer for the DSL.

Every default module and every expression the app writes today is DSL (`base.f * (3/2)`,
`[3].t + [3].d`, `beat(base) * 2`). DSL is compiled by the **JavaScript** DSL compiler
(`src/dsl/compiler.js`), routed from `src/expression-compiler.js` by `isDSLSyntax()`. So even if the
WASM compiler were wired in, it would fall back to JS for essentially every expression in the app.

It is not wired in: `src/wasm/compiler-adapter.js` is imported by nothing. See
[JS/WASM Adapters](/developer/wasm/adapters#dead-code-three-of-the-four-adapters).

## Loading

`src/wasm/index.js` is the loader. Its whole public surface:

| Export | Returns | Notes |
|---|---|---|
| `initWasm()` | `Promise<boolean>` | Dynamic-imports `./rmt_core.js`, calls `wasm.default()`. Resolves `false` (never throws) while `WASM_CONFIG.fallbackOnError` is true |
| `getWasm()` | module or `null` | |
| `isWasmAvailable()` | `boolean` | True once the module is loaded |
| `isWasmInitialized()` | `boolean` | True after init **succeeds or fails** |
| `getWasmError()` | `Error` or `null` | |
| `getWasmVersion()` | `"0.1.0"` or `null` | The Rust crate version |
| `onWasmReady(cb)` | — | Runs `cb` on a microtask if WASM is already up; **never** fires if init already failed |

`onWasmReady` is the real readiness hook. There is **no `wasm:ready` eventBus event** — earlier
planning documents named one, but it never appears in the source.

## Status: the evaluator hot-swap is blocked

This section is the handover dossier. If you have a Rust toolchain and want to unblock the WASM
path, start here.

### What works

- **The hot-swap.** WASM init is async and normally loses the race against `Module` construction, so
  a module starts on the JS evaluator. `Module`'s constructor registers an `onWasmReady` callback
  (holding a `WeakRef(this)` so discarded modules don't leak) that calls `_upgradeEvaluators()`
  (`src/module.js:133`): it swaps `_binaryEvaluator` / `_incrementalEvaluator` atomically, clears the
  evaluation cache and marks every note dirty, so the next `evaluateModule()` re-evaluates on the new
  engine. Values are identical across engines, so nothing goes visually stale mid-swap.
- **In Node.** `node scripts/perf/test-wasm-swap.mjs` builds a `Module` *before* init completes,
  finishes init, and verifies the upgrade plus identical evaluation results and working BaseNote
  propagation. It passes. `node scripts/perf/bench-node.mjs chain-1000 --wasm` also runs the WASM
  evaluator to completion.

### What is broken

In a **browser**, with `?evaluator=wasm`, a full re-evaluation cycle (`invalidateAll()` →
`evaluateDirty()`) hangs the main thread forever inside the WASM binary.

**Repro** (3/3 in fresh headless Chromium):

```bash
npm run dev
# open http://localhost:3000/?perf=1&evaluator=wasm
# in the console:
__rmtPerf.measureEval(1)
# → tab freezes
```

**Stack** at the CDP pause, outermost last:

```
$func198
  ← $persistentevaluator_registerNote          (WASM)
  ← WasmPersistentEvaluatorWrapper.registerNote (src/wasm/evaluator-adapter.js:724)
  ← WasmIncrementalEvaluator.evaluateDirty      (src/wasm/evaluator-adapter.js:533)
```

It hangs on the **first** registration (note 0) after `invalidateAll()`.

### What has been ruled out

| Hypothesis | Result |
|---|---|
| Stale committed artifact | Two separately-built binaries both hang |
| Node vs browser runtime | The identical call sequence — including the exact construct-then-upgrade race, the default module, and repeated register/invalidate/register cycles — passes headlessly in Node |
| A poisoned browser context | A fresh `PersistentEvaluator` in the same page, fed the same bytecodes (including the default `measureLength` bytecode `[1,0,0,0,60,0,0,0,1,3,3,19,3,4,18]` — the source string is now DSL, but the bytes are unchanged), evaluated, invalidated and re-registered: no hang |
| serde input shape | Plain objects and arrays; `register_note` deserializes them fine everywhere else |

### What is suspicious

`PersistentEvaluator::register_note` (`rust/src/evaluator.rs:905`) is trivial: deserialize a
`JsExpressions`, write six optional bytecode slots into a `HashMap` entry, insert the id into the
dirty `HashSet`. There is no loop in it that can spin. So the hang is almost certainly *deeper
state* — allocator/memory state, a hash-order-dependent loop elsewhere in the evaluator, a
`serde-wasm-bindgen` interaction, or UB — surfacing at the registration call.

Two properties matter:

- It is **non-deterministic**. The same manual sequence against the app's own evaluator instance
  passed once and hung on other attempts.
- It needs **full app boot state** — roughly 170 notes registered and evaluated, plus the hot-swap
  warm-up. Isolated reproductions do not trigger it.

### Suggested next steps

1. Build an instrumented crate: a registration counter plus an abort guard (panic instead of
   spinning) so the hang becomes a stack trace. `init()` already installs
   `console_error_panic_hook`, so a Rust panic surfaces in the browser console with a symbolicated
   trace. Rebuild with [`npm run wasm:build`](/developer/wasm/building) and **commit the synced
   artifacts** (or the browser will keep loading the old binary).
2. Bisect the Rust history for the behaviour change.
3. Keep the swap opt-in until a browser run of `__rmtPerf.measureEval(50)` on the default module and
   on `chain-1000` completes cleanly.

## See also

- [JS/WASM Adapters](/developer/wasm/adapters) — the JS layer, `WASM_CONFIG`, and the `?evaluator` gate
- [Building WASM](/developer/wasm/building) — rebuilding the crate and syncing the artifacts
- [Build & Deploy](/developer/contributing/build-and-deploy) — why the committed artifacts are what ships
- [Binary Evaluator](/developer/core/binary-evaluator) — the JS evaluator that actually runs
- [SymbolicPower](/developer/core/symbolic-power) — the JS side of the symbolic value model
