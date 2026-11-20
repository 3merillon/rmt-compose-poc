---
title: JS/WASM Adapters
description: The src/wasm layer — the loader, WASM_CONFIG, the evaluator wrapper, the PersistentEvaluator interface, the hot-swap, and the one adapter nothing imports.
---

# JS/WASM Adapters

`src/wasm/` is the boundary between the app and the Rust crate.

| File | Status |
|---|---|
| `index.js` | **Live**: the loader (`initWasm`, `onWasmReady`, …) |
| `config.js` | **Live**: `WASM_CONFIG`, `shouldUseWasm()` |
| `evaluator-adapter.js` | **Live**: the only adapter the app imports |
| `graph-adapter.js` | Dead code: imported by nothing |

::: info The live adapter is the default
In a browser the Rust core is the default. A `Module` starts on the JavaScript `BinaryEvaluator` and
hot-swaps to the adapter when the core is ready. `?evaluator=js` keeps JavaScript and skips the
fetch. If the core fails to load, JavaScript stays (`WASM_CONFIG.fallbackOnError`).
`WASM_MATCHES_VARIABLE_LAYOUT` (`src/wasm/evaluator-adapter.js:46`) is `true`. It is a kill switch:
set to `false`, the JavaScript evaluator runs everywhere, and `?evaluator=wasm` is ignored with a
console warning. See [WASM Overview](/developer/wasm/overview).
:::

## Dead code: the graph adapter

`graph-adapter.js` exports a working factory for the Rust `DependencyGraph`, and nothing in `src/`
or `scripts/` imports it. The app never constructs a WASM dependency graph. The dependency graph
that runs is [`src/dependency-graph.js`](/developer/core/dependency-graph).

The compiler and fraction adapters, and the Rust `ExpressionCompiler` and `Fraction` behind them,
are gone. The DSL is compiled by [`src/expression-compiler.js`](/developer/core/expression-compiler)
and `src/dsl/compiler.js`; exact values are `fraction.js` and `src/value/exact.js` in JavaScript,
`rust/src/rational.rs` and `rust/src/exact.rs` in Rust.

## Configuration

```javascript
// src/wasm/config.js
export const WASM_CONFIG = {
  useEvaluator: true,      // permits the WASM evaluator
  fallbackOnError: true,   // fall back to JS instead of throwing
  logPerformance: false,
  debug: false,            // console logging in the loader and adapters
};
```

There is **no `enabled` key**. `shouldUseWasm(component)` recognises only `'evaluator'`; any other
name returns `false`. `disableWasm()` and `enableWasm()` flip `useEvaluator`.

::: warning `useEvaluator: true` is a permission, not a switch
It only *permits* the WASM evaluator; the actual gate is `isEvaluatorHotSwapEnabled()`.
:::

## The `?evaluator` gate

`src/wasm/evaluator-adapter.js` reads the choice once (`src/wasm/evaluator-adapter.js:26-38`): the
`?evaluator` URL parameter in a browser, the `RMT_EVALUATOR` environment variable in Node.

| Where | Value | `isEvaluatorHotSwapEnabled()` | What runs |
|---|---|---|---|
| Browser | *(none)*, the default | `true` | JS at first, then WASM once the binary is ready |
| Browser | `js` | `false` | JS `BinaryEvaluator`; the binary is not fetched |
| Browser | `wasm` | `true` | Same as the default |
| Node | *(none)* | `true` | JS `BinaryEvaluator`, unless the script calls `initWasm()` |
| Node | `js` | `false` | JS `BinaryEvaluator` |
| Node | `wasm` | `true` | WASM, once the script has called `initWasm()` |

```javascript
// src/wasm/evaluator-adapter.js:114-116
export function isEvaluatorHotSwapEnabled() {
  return !FORCE_JS_EVALUATOR;
}
```

`FORCE_JS_EVALUATOR` is `EVALUATOR_PARAM === 'js' || (!WASM_MATCHES_VARIABLE_LAYOUT && !NODE_OPT_IN)`
(`src/wasm/evaluator-adapter.js:53`). With the kill switch `false`, a browser with `?evaluator=wasm`
stays on JavaScript and warns (`src/wasm/evaluator-adapter.js:55-57`). In Node,
`RMT_EVALUATOR=wasm` runs the Rust core even with the switch `false`, so the parity test can check
it first (`src/wasm/evaluator-adapter.js:51`).

Without `RMT_EVALUATOR`, headless Node passes the gate, but nothing evaluates on WASM unless the
script calls `initWasm()`. To run a script on Rust, use the preload
described in [WASM Overview](/developer/wasm/overview#running-node-scripts-on-wasm).

## Factories

Both are **synchronous**. Do not `await` them.

```javascript
import { createEvaluator, createIncrementalEvaluator } from './wasm/evaluator-adapter.js';

const evaluator   = createEvaluator(module);
const incremental = createIncrementalEvaluator(module, dependencyGraph, evaluator);
```

`createEvaluator(module)` (`src/wasm/evaluator-adapter.js:132`) resolves in this order:

1. the gate is closed, or `useEvaluator: false`, or WASM not loaded: `JSBinaryEvaluator`
2. otherwise `WasmPersistentEvaluatorWrapper`
3. construction throws and `fallbackOnError`: `JSBinaryEvaluator`, with a console warning

The wrapper's constructor refuses a binary older than its adapter: it checks that
`PersistentEvaluator` has every method in `REQUIRED_CORE_METHODS`
(`src/wasm/evaluator-adapter.js:76-80`) and throws, naming `npm run wasm:build`, if not.

`createIncrementalEvaluator(module, graph, evaluator)` returns a `WasmIncrementalEvaluator` when the
base evaluator is a `WasmPersistentEvaluatorWrapper`, and `JSIncrementalEvaluator` otherwise.
`isWasmBackedEvaluator(evaluator)` tells you which one you got.

## The interface of PersistentEvaluator

What the adapter calls on the Rust class (`rust/src/evaluator.rs:666`):

| Method | Purpose |
|---|---|
| `registerNotes(packed)` | Register notes. Per note: `u32` id, `u8` expression count, then per expression `u8` variable, `u32` length, bytecode. Little-endian |
| `removeNote(id)` | Forget a note: its expressions and its values |
| `invalidateAll()` | Forget everything |
| `clearValues()` | Drop the values, keep the notes |
| `evaluateDirty(ids)` | Order and evaluate a batch, one call |
| `hasProblems` | True when the last batch reported something |
| `takeCycles()`, `takeUnresolved()`, `takeFailures()`, `takeDivisionsByZero()` | What went wrong, for the JS side to print |
| `readNote(id)` | `Float64Array`: `[corruptionFlags, approxFlags, then per variable (kind, a, b)]` |
| `readNotes(ids)` | The same for several notes, one after another. A missing note is `-1` then zeros |
| `readValueText(id, var)` | Hexadecimal text `n/d` with the sign on `n`. For an irrational, its terms `c*b^p/q*...;c*...` |

The kinds (`src/wasm/evaluator-adapter.js:68-72`):

| Kind | Meaning | `a`, `b` |
|---|---|---|
| 0 | none | |
| 1 | rational | numerator and denominator, exact as doubles |
| 2 | rational too large | read `readValueText()` |
| 3 | irrational | read `readValueText()` |
| 4 | approximate | numerator and denominator |
| 5 | approximate, too large | read `readValueText()` |

## The wrappers

### WasmPersistentEvaluatorWrapper

`src/wasm/evaluator-adapter.js:343`. Wraps `wasm.PersistentEvaluator`. Compiled expressions go to
WASM once per note; evaluated values live there; each batch's records come back as `fraction.js`
values in one call.

| Method | Purpose |
|---|---|
| `setModule(module)` | Rebind and invalidate everything |
| `invalidateAll()` | Drop all values and registrations |
| `registerNotes(notes)` / `registerNote(note)` | Pack the notes' bytecode and register it, one call |
| `isRegistered(id)` / `unregisterNote(id)` | Registration bookkeeping (JS side) |
| `removeNote(id)` / `clearValues()` | Forward to the core |
| `evaluateDirty(ids)` | **One** WASM call for the whole batch; then reports problems |
| `readRecords(ids, put)` | **One** WASM call that reads the batch's records |
| `getEvaluatedNote(id)` / `getCachedValue(id, varIndex)` | Read one note or one value |
| `evaluateNote(note)` | Register and evaluate one note |
| `evaluate(expr)` | Not available: warns and returns 0. Single expressions are not evaluated on the WASM path |

Problems are not printed by Rust. After each batch the wrapper reads the cycles, unresolved
references, failures and divisions by zero from the core, and reports them through a JavaScript
`BinaryEvaluator`'s `reportProblems`, so the messages are word for word the JavaScript ones
(`src/wasm/evaluator-adapter.js:486-518`).

`_toRecord()` (`src/wasm/evaluator-adapter.js:602`) turns the numbers into a record of the same shape
as the JavaScript evaluator's (`createEvaluationRecord`): a `fraction.js` value per variable,
`corruptionFlags`, `approxFlags`, and `exact`, which holds the exact value of each variable that is
not rational. For an irrational, it is an `Irrational` built with `irrationalFromCanonicalTerms`
(`src/value/exact.js:64`), and the variable's own field holds its shadow. For an approximate value
it is an `Approx`.

### WasmIncrementalEvaluator

`src/wasm/evaluator-adapter.js:211`. Dirty tracking in JavaScript, one WASM call per batch, then one
call reading the batch's records.

`evaluateDirty()` (no arguments; it reads its own dirty set):

1. sort the dirty ids ascending, as the JavaScript evaluator walks them
2. for an id with no note, tell the core to remove it; register every note whose bytecode is new
3. call `evaluator.evaluateDirty(batch)`: the core orders the batch per (note, variable) and
   evaluates it
4. call `evaluator.readRecords(batch, …)` to put the batch's records into the cache
5. clear the dirty set and return the cache

`invalidate(id, dependents)` marks the note dirty and unregisters it (its bytecode may have
changed), and marks its dependents dirty without unregistering them. `markDirtyOnly(id)` is the
dirty-without-unregister form.

### WasmEvaluationCache

`src/wasm/evaluator-adapter.js:174`. A `Map` subclass holding `noteId` to record, filled right after
each batch. `get`, `has`, `size` and iteration are a plain `Map`'s, identical to the JavaScript
evaluator's cache, including order. Only `delete()` and `clear()` also reach the core, because the
core holds the values that evaluation reads.

### Expression previews, validation and simplify

These still create JavaScript `BinaryEvaluator`s. They read the same records.

## The hot-swap

WASM init is async and normally loses the race against `Module` construction. Rather than block boot,
the module starts on JS and upgrades later:

```javascript
// src/module.js:140-146 (in the Module constructor)
if (isEvaluatorHotSwapEnabled() && !isWasmBackedEvaluator(this._binaryEvaluator)) {
  const ref = new WeakRef(this);
  onWasmReady(() => {
    const mod = ref.deref();
    if (mod) mod._upgradeEvaluators();
  });
}
```

`_upgradeEvaluators()` (`src/module.js:215`) swaps `_binaryEvaluator` and `_incrementalEvaluator`
atomically, clears the evaluation cache, and marks every note dirty so the next `evaluateModule()`
re-evaluates on the new engine. Values are identical across engines, so nothing goes stale in
between. The `WeakRef` keeps a discarded module from leaking through the callback list.

The gate is closed by default in a browser, so without `?evaluator=wasm` `_upgradeEvaluators()`
never runs.

## Error handling

With `fallbackOnError: true` (the default), every WASM failure degrades to JS instead of throwing:

- `initWasm()` resolves `false` and the app runs on JS.
- `createEvaluator()` catches a construction failure and returns `JSBinaryEvaluator`.
- `onWasmReady(cb)` callbacks registered before a failed init **never fire**: WASM will never arrive.

Set `WASM_CONFIG.debug = true` to see the loader's `WASM initialized: rmt-core v0.1.0` line and the
adapters' fallback warnings.

## Testing

`npm test` runs `scripts/test-wasm-parity.mjs`, which compares both engines exactly, and
`scripts/perf/test-wasm-swap.mjs`, which tests the hot-swap and that three concurrent `initWasm()`
calls fetch the module once. The parity test also runs ten evaluation suites whole on WASM. See
[WASM Overview](/developer/wasm/overview#how-the-two-engines-are-held-together).

```bash
node scripts/test-wasm-parity.mjs
node scripts/perf/test-wasm-swap.mjs
node --import ./scripts/wasm-node.mjs scripts/test-variable-deps.mjs   # one suite on WASM
node scripts/perf/bench-node.mjs chain-1000 --wasm
```

## See also

- [WASM Overview](/developer/wasm/overview): the crate, the exact values, parity and speed
- [Building WASM](/developer/wasm/building): rebuild and sync the artifacts
- [Binary Evaluator](/developer/core/binary-evaluator): the JavaScript evaluator
- [Build & Deploy](/developer/contributing/build-and-deploy): scripts, chunks, and the two deploys
