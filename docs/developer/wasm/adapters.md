---
title: JS/WASM Adapters
description: The src/wasm layer — the loader, WASM_CONFIG, the evaluator wrappers, the opt-in hot-swap, and which three adapters are dead code.
---

# JS/WASM Adapters

`src/wasm/` is the boundary between the app and the Rust crate. One adapter in it is live. Three are
not.

| File | Status |
|---|---|
| `index.js` | **Live** — the loader (`initWasm`, `onWasmReady`, …) |
| `config.js` | **Live** — `WASM_CONFIG`, `shouldUseWasm()` |
| `evaluator-adapter.js` | **Live** — the only adapter the app imports |
| `compiler-adapter.js` | Dead code — imported by nothing |
| `graph-adapter.js` | Dead code — imported by nothing |
| `fraction-adapter.js` | Dead code — imported by nothing |

::: danger The live adapter is disabled by default
`createEvaluator()` returns a WASM evaluator only when WASM has finished loading **and**
`isEvaluatorHotSwapEnabled()` allowed the module to upgrade — which, in a browser, requires
`?evaluator=wasm`. Opting in currently hangs the tab. In every real session the app runs the JS
`BinaryEvaluator`. See [the hang dossier](/developer/wasm/overview#status-the-evaluator-hot-swap-is-blocked).
:::

## Dead code: three of the four adapters

`compiler-adapter.js`, `graph-adapter.js` and `fraction-adapter.js` export working factories
(`createCompiler()`, `createDependencyGraph()`, `createFraction()` and friends), and nothing in
`src/` or `scripts/` imports any of them. A repo-wide grep for their filenames returns zero hits
outside the docs.

That means the WASM `ExpressionCompiler`, `DependencyGraph` and `Fraction` are **never constructed by
the app**. Any description of a "WASM compile path" is a description of code that does not run. If
you are looking for the compiler that actually runs, it is
[`src/expression-compiler.js`](/developer/core/expression-compiler) and `src/dsl/compiler.js`.

## Configuration

```javascript
// src/wasm/config.js
export const WASM_CONFIG = {
  useEvaluator: true,       // live, but see below
  usePersistentCache: true, // live: pick PersistentEvaluator over Evaluator

  fallbackOnError: true,    // fall back to JS instead of throwing
  logPerformance: false,
  debug: false,             // console logging in the loader and adapters
};
```

There is **no `enabled` key**, and there are no flags for the dead adapters — the old
`useFractions` / `useGraph` / `useCompiler` switches have been removed. `shouldUseWasm(component)`
recognises `'evaluator'` and `'persistentCache'`; any other name (including `'fractions'`,
`'graph'`, `'compiler'`) falls to the `default` branch and returns `false`. `disableWasm()` and
`enableWasm()` flip the two feature flags together.

::: warning `useEvaluator: true` is a permission, not a switch
It only *permits* the WASM evaluator; the actual gate is `isEvaluatorHotSwapEnabled()`.
:::

## The `?evaluator` gate

`src/wasm/evaluator-adapter.js` reads `?evaluator` once from `location.search`:

| URL | `isEvaluatorHotSwapEnabled()` | What runs |
|---|---|---|
| *(no param)* — the default | `false` in a browser | JS `BinaryEvaluator` |
| `?evaluator=js` | `false` everywhere | JS `BinaryEvaluator` (explicit) |
| `?evaluator=wasm` | `true` | WASM — **hangs the tab** |
| *(headless Node — no `window`)* | `true` | WASM, so benches and `test-wasm-swap.mjs` can exercise the swap |

```javascript
// src/wasm/evaluator-adapter.js:36-40
export function isEvaluatorHotSwapEnabled() {
  if (FORCE_JS_EVALUATOR) return false;
  if (typeof window === 'undefined') return true; // headless tests/benches
  return EVALUATOR_PARAM === 'wasm';
}
```

The `typeof window === 'undefined'` branch is why the Node scripts run the WASM path and the browser
does not.

## Factories

Both are **synchronous**. Do not `await` them.

```javascript
import { createEvaluator, createIncrementalEvaluator } from './wasm/evaluator-adapter.js';

const evaluator   = createEvaluator(module);
const incremental = createIncrementalEvaluator(module, dependencyGraph, evaluator);
```

`createEvaluator(module)` resolves in this order:

1. `?evaluator=js`, or `useEvaluator: false`, or WASM not loaded → `JSBinaryEvaluator`
2. `usePersistentCache` and `wasm.PersistentEvaluator` exists → `WasmPersistentEvaluatorWrapper`
3. otherwise → `WasmEvaluatorWrapper`
4. construction throws and `fallbackOnError` → `JSBinaryEvaluator`

`createIncrementalEvaluator(module, graph, evaluator)` returns a `WasmIncrementalEvaluator` **only**
when the base evaluator is a `WasmPersistentEvaluatorWrapper`; otherwise `JSIncrementalEvaluator`.

`isWasmBackedEvaluator(evaluator)` tells you which one you got.

## The wrappers

### WasmPersistentEvaluatorWrapper

Wraps `wasm.PersistentEvaluator`. The cache lives in WASM memory; JS pulls values across the
boundary on demand instead of serializing the whole cache per note.

| Method | Purpose |
|---|---|
| `setModule(module)` | Rebind and invalidate everything |
| `invalidateAll()` / `invalidate(noteId)` | Drop cached values |
| `beginBatch()` | Clear the JS-side Fraction cache before a batch |
| `registerNote(note)` | Push a note's six bytecode slots into WASM |
| `isRegistered(id)` / `unregisterNote(id)` | Registration bookkeeping |
| `markDirty(id)` / `markDirtyBatch(ids)` | Mark for re-evaluation |
| `evaluateDirty(sortedIds)` | **One** WASM call for the whole topologically sorted batch |
| `hasCachedNote(id)` / `getEvaluatedNote(id)` | Read back, converting to `fraction.js` values lazily |
| `evaluateNote(note, evalCache)` | Evaluate one note |
| `evaluate(expr, evalCache)` | Evaluate a single **expression** (not a note id) |
| `getCachedValue(noteId, varIndex)` | Read one cached variable |
| `getPoolStats()` | Diagnostics |
| `exportCache()` / `importCache(json)` | Cache round-trip |

`registerNote` collects `startTime`, `duration`, `frequency`, `tempo`, `beatsPerMeasure` and
`measureLength` from `note.expressions`, converts each `BinaryExpression`'s bytecode to a plain array
and hands the object to `PersistentEvaluator.registerNote(id, expressions)`, where
`serde-wasm-bindgen` deserializes it.

::: danger This is the hang site
`WasmPersistentEvaluatorWrapper.registerNote` (`evaluator-adapter.js:724`), called from
`WasmIncrementalEvaluator.evaluateDirty` (`evaluator-adapter.js:533`), is where the browser locks up
after an `invalidateAll()`. The JS side of that call is straightforward; the loop is inside the Rust
binary.
:::

### WasmIncrementalEvaluator

Dirty tracking, topological sort, and one batched WASM call.

`evaluateDirty()` (no arguments — it reads its own dirty set):

1. `registerNote()` any dirty note that is not yet registered
2. topologically sort the dirty set (Kahn's algorithm, same as the JS incremental evaluator)
3. clear the local cache
4. call `evaluator.evaluateDirty(sorted)` — a single WASM call
5. clear the dirty set and return the cache

`invalidate(id)` unregisters the note (its bytecode changed) and marks all its transitive dependents
dirty **without** unregistering them (their bytecode did not change). `markDirtyOnly(id)` is the
dirty-without-unregister form.

It returns a `LazyWasmCacheProxy`, not a `Map`.

### LazyWasmCacheProxy

A `Map`-shaped view over the WASM-resident cache. `get(noteId)` checks a local `Map` first, then
calls `getEvaluatedNote(noteId)` on the wrapper, converting `FractionData` into `fraction.js` values
only for the notes someone actually reads. Iteration (`entries()`, `keys()`, `values()`) only yields
what has already been fetched this cycle — it is not a full enumeration of the WASM cache.

### WasmEvaluatorWrapper

The non-persistent fallback around `wasm.Evaluator`, used when `usePersistentCache` is off. It keeps
its cache in JS. Same interface where it matters: `evaluate(expr, evalCache)`,
`evaluateNote(note, evalCache)`, `invalidate`, `invalidateAll`, `getCachedValue`, `getPoolStats`.

## The hot-swap

WASM init is async and normally loses the race against `Module` construction. Rather than block boot,
the module starts on JS and upgrades later:

```javascript
// src/module.js:62-68 (in the Module constructor)
if (isEvaluatorHotSwapEnabled() && !isWasmBackedEvaluator(this._binaryEvaluator)) {
  const ref = new WeakRef(this);
  onWasmReady(() => {
    const mod = ref.deref();
    if (mod) mod._upgradeEvaluators();
  });
}
```

`_upgradeEvaluators()` (`src/module.js:133`) swaps `_binaryEvaluator` and `_incrementalEvaluator`
atomically, clears the evaluation cache, and marks every note dirty so the next `evaluateModule()`
re-evaluates on the new engine. Values are identical across engines, so nothing goes stale in
between. The `WeakRef` keeps a discarded module from leaking through the callback list.

Because `isEvaluatorHotSwapEnabled()` is `false` in a default browser session,
**`_upgradeEvaluators()` never runs in production.**

## Error handling

With `fallbackOnError: true` (the default), every WASM failure degrades to JS instead of throwing:

- `initWasm()` resolves `false` and the app runs on JS.
- `createEvaluator()` catches a construction failure and returns `JSBinaryEvaluator`.
- `onWasmReady(cb)` callbacks registered before a failed init **never fire** — by design, WASM will
  never arrive.

Set `WASM_CONFIG.debug = true` to see the loader's `WASM initialized: rmt-core v0.1.0` line and the
adapters' fallback warnings. There is no bytecode-level trace logging.

## Testing

There is **no unit-test framework** in this repo — no Jest, no Vitest. `npm test` runs
`scripts/validate-modules.mjs`, which validates the shipped module library. The real WASM checks are:

```bash
node scripts/perf/test-wasm-swap.mjs           # hot-swap + identical results, in Node
node scripts/perf/bench-node.mjs chain-1000 --wasm
```

Both exercise the WASM evaluator successfully. That is exactly why the browser hang is confusing —
and why a Node pass is not evidence that the browser path works.

## See also

- [WASM Overview](/developer/wasm/overview) — the crate, the value model, and the blocked-evaluator dossier
- [Building WASM](/developer/wasm/building) — rebuild and sync the artifacts
- [Binary Evaluator](/developer/core/binary-evaluator) — the JS evaluator that actually runs
- [Build & Deploy](/developer/contributing/build-and-deploy) — scripts, chunks, and the two deploys
