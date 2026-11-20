---
title: WASM Overview
description: What the rmt-core Rust/WASM crate contains, why the WASM evaluator is disabled by default, and the open bug that blocks it.
---

# WASM Overview

RMT Compose contains a Rust crate, `rmt-core`, that compiles to WebAssembly and implements a
bytecode evaluator, a dependency graph, an expression compiler and an arbitrary-precision
`Fraction`. The compiled artifacts are committed to the repo and shipped with every deploy.

::: danger The WASM evaluator is disabled
All evaluation runs on the **JavaScript** `BinaryEvaluator` (`src/binary-evaluator.js`). The Rust core
still has the old variable layout (`tempo`, `beatsPerMeasure` and `measureLength` at indices 3 to 5, no
`attack` or `release`) and the retired `FIND_TEMPO` / `FIND_MEASURE` opcodes, while the JavaScript
evaluator moved to relational time (`startTime`, `duration`, `frequency`, `amplitude`, `attack`,
`release`). The two would read the same bytecode differently, so
`WASM_MATCHES_VARIABLE_LAYOUT` is `false` in `src/wasm/evaluator-adapter.js`: the JavaScript evaluator
is always used, `?evaluator=wasm` is ignored with a console warning, and the hot-swap never arms.
Porting the Rust core to the new layout is planned, together with its per-variable evaluation.

Before this, the opt-in path also hung the tab in a browser (see
[Status](#status-the-evaluator-hot-swap-is-blocked)). Do not tell a user to pass `?evaluator=wasm`, and do not describe WASM as an app performance
feature. The JS path carries the app on its own: a full re-evaluation of the 1000-note
`chain-1000` stress module is ~3 ms, and an incremental commit is under 1 ms
(`node scripts/perf/bench-node.mjs chain-1000`). See [Performance](/developer/performance).
:::

## What actually happens on page load

| Step | Where | Effect |
|---|---|---|
| `initWasm()` is called eagerly at import time | `src/store/app-state.js:7` | **Returns `false` early**: `isEvaluatorHotSwapEnabled()` is false while the layout flag is false — no fetch |
| `initWasm()` is `await`ed during `initApp()` | `src/main.js:82` | Same early-out |
| `setTimeout(() => initWasm(), 0)` auto-init | `src/wasm/index.js:137-146` | Same call, same gate, deduped by a `wasmInitialized` guard |
| `Module` constructor registers a hot-swap callback | `src/module.js:67-73` | **Never**: `isEvaluatorHotSwapEnabled()` is false everywhere |
| Evaluation | `src/binary-evaluator.js` | JS |

So the 384 KB `rmt_core_bg.wasm` is **never downloaded or instantiated** — every boot-time caller
funnels through `initWasm()`, which checks `isEvaluatorHotSwapEnabled()` before touching the network.
That check is now false in a browser and in headless Node alike, so nothing loads the binary. The
benches and test that exercised the WASM evaluator (`scripts/perf/bench-node.mjs --wasm`,
`scripts/perf/test-wasm-swap.mjs`) depend on `initWasm()` succeeding; with the flag false it returns
`false`, and the bench aborts at its init check. Neither has been updated for the flag.

Because `isWasmAvailable()` stays `false`, every evaluator `createEvaluator()` returns is JS, including
modules constructed later in a session (a file load, an undo or redo restore).

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
multiplier fold into the `coefficient` instead of stacking another term. The JS evaluator has
since moved to a more general exact form (sums of terms, prime bases, approximate values,
[Exact Values](/developer/core/symbolic-power)); porting it is part of Phase D.

### EvaluatedNote

A plain serde struct — the values, plus one byte of flags:

```rust
// rust/src/evaluator.rs
pub struct EvaluatedNote {
    #[serde(rename = "startTime")]
    pub start_time: Option<FractionData>,
    pub duration: Option<FractionData>,
    pub frequency: Option<FractionData>,
    pub tempo: Option<FractionData>,      // old layout, see below
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

::: warning This is the old variable layout
The record above is the Rust core's, and it is **not** the JavaScript record. The JavaScript
`EvaluatedNote` is `{ startTime, duration, frequency, amplitude, attack, release, corruptionFlags }`
(`createEvaluationRecord()` in `src/binary-evaluator.js`): `tempo`, `beatsPerMeasure` and
`measureLength` are gone, and `attack` and `release` are new. Until the crate is ported
(`WASM_MATCHES_VARIABLE_LAYOUT`), treat every Rust-side variable table below as out of date.
:::

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

`corruption_flag_for_var(var_index)` maps the bytecode variable index (0–5) to its bit. In the
JavaScript layout, bits `0x08`, `0x10` and `0x20` mean `amplitude`, `attack` and `release`; here they
still mean tempo, beats per measure and measure length.

::: info These flags never reach a shader
The renderer's hatching is driven by a separate 3-value enum computed in JS during
`RendererAdapter.sync()` (`0` clean, `1` transitive, `2` direct — crosshatch for direct, single
diagonal hatch for transitive). The Rust bitmask says *which property* is irrational; the renderer's
value says *how* the note became corrupt. They are different questions and different code paths.
:::

## The compiler only understands the retired syntax

`ExpressionCompiler` in `rust/src/compiler.rs` parses the **method-chain grammar** only —
`module.baseNote.getVariable('frequency')`, `module.getNoteById(3).getVariable('startTime')`, and
`.add()/.sub()/.mul()/.div()/.pow()` chains. It has no lexer for the DSL.

That grammar is retired in the JavaScript app: the DSL is the only language, compiled by the
**JavaScript** DSL compiler (`src/dsl/compiler.js`) through `src/expression-compiler.js`, and modules
in the old syntax are converted to DSL on load (`src/migrate/legacy-syntax.js`). So the WASM compiler
could compile nothing the app holds; it is left in the crate until the Rust core is ported.

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
path, start here. It describes the opt-in path as it was before the relational-time change disabled
it (see the box at the top of the page); the browser hang below was never fixed, and the layout port
comes first.

### What works

- **The hot-swap.** WASM init is async and normally loses the race against `Module` construction, so
  a module starts on the JS evaluator. `Module`'s constructor registers an `onWasmReady` callback
  (holding a `WeakRef(this)` so discarded modules don't leak) that calls `_upgradeEvaluators()`
  (`src/module.js:139`): it swaps `_binaryEvaluator` / `_incrementalEvaluator` atomically, clears the
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
  ← WasmPersistentEvaluatorWrapper.registerNote (src/wasm/evaluator-adapter.js:758)
  ← WasmIncrementalEvaluator.evaluateDirty      (rust/src/evaluator.rs:905)
```

It hangs on the **first** registration (note 0) after `invalidateAll()`.

### What has been ruled out

| Hypothesis | Result |
|---|---|
| Stale committed artifact | Two separately-built binaries both hang |
| Node vs browser runtime | The identical call sequence — including the exact construct-then-upgrade race, the default module, and repeated register/invalidate/register cycles — passes headlessly in Node |
| A poisoned browser context | A fresh `PersistentEvaluator` in the same page, fed the same bytecodes (including the old default `measureLength` bytecode `[1,0,0,0,60,0,0,0,1,3,3,19,3,4,18]`, from before the layout change), evaluated, invalidated and re-registered: no hang |
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

### What is not ported

**The variable layout.** The JS evaluator has six variables (`startTime`, `duration`, `frequency`,
`amplitude`, `attack`, `release`; indices 0 to 5) and no `FIND_TEMPO` / `FIND_MEASURE` opcodes. The
Rust core still has `tempo`, `beatsPerMeasure` and `measureLength` at indices 3 to 5, the retired
opcodes, and the old inheritance list (`tempo`, `beatsPerMeasure`, `measureLength`, `amplitude`
inherit from the BaseNote; in JS only the interpretation variables from `FIRST_INTERPRETATION_VAR` up
do). `rust/src/bytecode.rs`, `rust/src/value.rs` and `rust/src/evaluator.rs` all need the new table.

**Per-variable evaluation.** The JS evaluator orders evaluation per (note, variable), detects only true cycles, and reports
unresolved references by name (see
[Binary Evaluator](/developer/core/binary-evaluator#evaluation-order-per-variable)). None of that is
in the crate: `evaluate_note_internal` (`rust/src/evaluator.rs:957`) still evaluates a note's six
expressions in a fixed order, and the WASM incremental evaluators still sort whole notes. The two
engines agree on every module whose notes depend on each other one way only — which is every
shipped module — and disagree on a module where two notes read each other through different
variables, or where a note's variable reads one that comes later in the fixed order. Unblocking the
swap means porting that as well.

### Suggested next steps

1. Build an instrumented crate: a registration counter plus an abort guard (panic instead of
   spinning) so the hang becomes a stack trace. `init()` already installs
   `console_error_panic_hook`, so a Rust panic surfaces in the browser console with a symbolicated
   trace. Rebuild with [`npm run wasm:build`](/developer/wasm/building) and **commit the synced
   artifacts** (or the browser will keep loading the old binary).
2. Bisect the Rust history for the behaviour change.
3. Port the Rust core to the six-variable layout, then flip `WASM_MATCHES_VARIABLE_LAYOUT` and keep the
   swap opt-in until a browser run of `__rmtPerf.measureEval(50)` on the default module and
   on `chain-1000` completes cleanly.

## See also

- [JS/WASM Adapters](/developer/wasm/adapters) — the JS layer, `WASM_CONFIG`, and the `?evaluator` gate
- [Building WASM](/developer/wasm/building) — rebuilding the crate and syncing the artifacts
- [Build & Deploy](/developer/contributing/build-and-deploy) — why the committed artifacts are what ships
- [Binary Evaluator](/developer/core/binary-evaluator) — the JS evaluator that actually runs
- [Exact Values](/developer/core/symbolic-power) — the JS side of the value model
