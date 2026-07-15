---
title: Binary Evaluator
description: The stack VM that executes note bytecode — the fraction pool, silent defaults, corruption flagging, and the incremental evaluator's Kahn topological sort.
---

# Binary Evaluator

`src/binary-evaluator.js` is a stack-based virtual machine that executes the bytecode produced by the [expression compiler](/developer/core/expression-compiler). It exports four things:

| Export | Role |
|---|---|
| `BinaryEvaluator` | the stack VM (`:722`) |
| `IncrementalEvaluator` | dirty tracking + Kahn topological sort (`:1341`) |
| `MusicValue` | rational / irrational / symbolic value wrapper (`:274`) |
| `SymbolicPower` | algebraic form of an irrational power (`:20`) — see [SymbolicPower](/developer/core/symbolic-power) |

::: info This is the path that actually runs
A browser session runs the **JavaScript** evaluator. The WASM evaluator exists but its hot-swap is opt-in via `?evaluator=wasm` (`src/wasm/evaluator-adapter.js:36-40`, and the comment at `src/module.js:57-60`), and that path currently hangs the main thread on a full re-evaluation cycle. Everything on this page describes the shipping JS path. See [WASM Overview](/developer/wasm/overview).
:::

## The machine

```javascript
class BinaryEvaluator {
  constructor(module) {
    this.module = module;
    this.stack = new Array(32);      // doubles on overflow
    this.stackTop = 0;
    this.pool = new FractionPool(256);
    this.generation = 0;
    this.cache = new Map();          // noteId -> evaluated result
    this._lastEvalWasCorrupted = false;
  }
}
```

The stack holds **only pooled `Fraction`s**. `SymbolicPower` appears transiently inside the `POW` handler and never survives it (see [POW](#pow-and-corruption)).

`evaluate(expr, evalCache)` (`:880`) walks the bytecode with a `pc` cursor and returns the single remaining stack value.

## Value resolution — `LOAD_REF` and `LOAD_BASE`

There is **no recursion**. Topological order guarantees a note's dependencies are already in the cache by the time it is evaluated. `LOAD_REF` (`:919-983`) resolves in this order:

1. the caller's `evalCache` entry for that note id;
2. the evaluator's own internal `cache` (`getCachedValue()`);
3. **for `TEMPO`, `BEATS_PER_MEASURE` and `MEASURE_LENGTH` only** — the same two lookups again against note **0**, the BaseNote (`:946-963`);
4. a **hard-coded default**.

Step 3 is the inheritance rule users feel: `[5].tempo` on a note with no tempo expression yields the BaseNote's tempo. `startTime`, `duration` and `frequency` do **not** inherit.

::: warning Unresolvable references do not throw — they get a default
| Property | Default pushed |
|---|---|
| `startTime` | `0` |
| `duration` | `1` |
| `frequency` | `440` |
| `tempo` | `60` |
| `beatsPerMeasure` | `4` |
| `measureLength` | `4` |

(`binary-evaluator.js:965-977`.) Delete a note and its dependents keep evaluating against these — a dependent's frequency becomes 440 Hz. `Module.removeNote()` still does not rewrite dependents, but it now emits a `console.warn` listing every dependent left dangling (the UI's delete paths liberate dependents first; the warning guards programmatic callers and hand-authored JSON).
:::

## Runtime behaviour of the other opcodes

| Situation | What happens |
|---|---|
| `DIV` with a zero divisor | `console.warn('Division by zero in binary evaluator, using 1')`, pushes `1`, **and sets the corruption flag** for the property being evaluated — the note crosshatches, same path as an irrational `POW` (`:1052-1062`) |
| Stack depth ≠ 1 at the end | `console.warn('Stack has N items after evaluation, expected 1')`, returns the top (`:1200-1204`) |
| `pop()` on an empty stack | throws `Stack underflow in binary evaluator` (`:838-843`) |
| `peek()` on an empty stack | throws `Stack empty in binary evaluator` |
| Unknown opcode byte | throws `Unknown opcode: 0x..` (`:1195-1196`) |

`FIND_TEMPO`, `FIND_MEASURE`, `DUP` and `SWAP` have cases in the switch but **no compiler emits them**, so they are unreachable. `FIND_INSTRUMENT` has no case at all.

## `POW` and corruption

`OP.POW` (`:1070-1094`) is the only place a value can leave the rationals.

```javascript
case OP.POW: {
  const exp  = this.pop();
  const base = this.pop();
  const powResult = MusicValue.rational(new Fraction(base.s * base.n, base.d))
                      .pow(MusicValue.rational(new Fraction(exp.s * exp.n, exp.d)));

  if (powResult.isCorrupted()) {
    this._lastEvalWasCorrupted = true;
    const frac = new Fraction(powResult.toFloat());   // ← float-derived approximation
    this.push(this.pool.alloc(frac.s * frac.n, frac.d));
  } else {
    const frac = powResult.fraction;
    this.push(this.pool.alloc(frac.s * frac.n, frac.d));
  }
  break;
}
```

`MusicValue.pow()` (`:505-537`) tries `tryRationalPower()` first — an exact integer power, or a perfect n-th root. If that succeeds the result is an exact `Fraction` and **nothing is corrupted**: `4^(1/2)` is `2`, cleanly.

If it fails, and the base is a positive integer, it builds a `SymbolicPower`. That symbolic value is then **immediately flattened back to an approximated rational** by the branch above. Verified against the running VM:

```
2^(1/12)  →  Fraction 2739815/2586041   (≈1.0594630943592929), _lastEvalWasCorrupted = true
4^(1/2)   →  Fraction 2/1               exactly, not corrupted
```

Everything downstream — `MUL`, `DIV`, the cache, the renderer, the audio engine — sees that approximation. The corruption *flag* is what survives, not the algebra.

### `MusicValue`

```javascript
class MusicValue {
  constructor(type, data) {   // type: 'rational' | 'irrational' | 'symbolic'
    this.fraction;   // Fraction   — when rational
    this.float;      // number     — when irrational
    this.symbolic;   // SymbolicPower — when symbolic
  }
  isCorrupted() { return this.type === 'irrational' || this.type === 'symbolic'; }
}
```

It carries **no corruption bitmask**. Corruption bits are accumulated per-note by `evaluateNote()`, not by the value.

## The fraction pool

`FractionPool` (`:654-717`) is a **bump allocator**, not a ring buffer:

```javascript
alloc(n = 0, d = 1) {
  if (this.index >= this.pool.length) { /* grow: double the pool */ }
  const f = this.pool[this.index++];   // hand out the next slot and mutate it
  f.s = …; f.n = …; f.d = …;
  return f;
}
reset() { this.index = 0; }            // rewind — called once per batch
```

`IncrementalEvaluator.evaluateDirty()` calls `evaluator.beginBatch()` (`:1427`), which calls `pool.reset()`. Everything allocated during the previous batch is recycled at that instant.

::: danger Never cache a pooled fraction
`reset()` rewinds the index, so the next batch mutates the very objects the last batch handed out. `evaluateNote()` copies every result into a fresh `new Fraction(...)` before storing it (`:1263-1266`). If you add a code path that keeps a value returned by `evaluate()` across a batch boundary, copy it first.
:::

## `evaluateNote()`

`:1214-1328`. Evaluates one note's six expressions in a fixed order and returns:

```javascript
{
  startTime, duration, frequency, tempo, beatsPerMeasure, measureLength,
  corruptionFlags   // u8 bitmask
}
```

Order: **tempo → beatsPerMeasure → frequency → measureLength → startTime → duration** (`:1286-1295`). Expressions within a note may reference each other — `measureLength` reads the `tempo` evaluated a moment earlier — so the in-progress result object is written into the shared cache *before* evaluation begins:

```javascript
const workingCache = evalCache || new Map();
workingCache.set(note.id, result);   // :1232-1233
```

::: tip The per-note cache copy is gone
This used to clone the whole evaluation cache for every note, which made a full evaluation **O(N²)**. Under topological order every dependency is already final before its dependent runs, and the caller overwrites the same key with the finished result — so writing straight into the shared map is safe. The rationale is in the source comment at `:1225-1231`.
:::

After each property, if `_lastEvalWasCorrupted` was set by a `POW`, the matching bit is OR-ed into `corruptionFlags`. The bits are the `CORRUPT` mask from `binary-note.js:55-62`: `startTime 0x01`, `duration 0x02`, `frequency 0x04`, `tempo 0x08`, `beatsPerMeasure 0x10`, `measureLength 0x20`.

### The synthetic `measureLength`

If `measureLength` was not explicitly defined **and** the note is a measure bar (has `startTime`, no `duration`, no `frequency`) or is the BaseNote, it is computed as `beatsPerMeasure / tempo * 60` and stored as a **plain duck-typed object**, not a `Fraction` (`:1302-1322`):

```javascript
{ s: 1, n: Math.round(v * 1e6), d: 1e6, valueOf: () => v }
```

It has `valueOf()` and `s`/`n`/`d`, which is enough for the VM and the renderer — but it is not a `Fraction`, so `instanceof` checks and `Fraction` methods on it will fail. Regular notes skip this entirely.

## Incremental evaluation

```javascript
new IncrementalEvaluator(module, dependencyGraph, evaluator)   // :1342
```

Fields: `graph`, `evaluator`, `dirty` (a `Set`), `cache` (`Map<noteId, result>`), `generation`.

| Method | Effect |
|---|---|
| `invalidate(noteId)` (`:1369`) | marks the note **and all transitive dependents** dirty, via `graph.getAllDependents()`. Bumps `generation`. |
| `markDirtyOnly(noteId)` (`:1388`) | marks dirty **without** re-registration or bytecode invalidation. |
| `invalidateAll()` (`:1395`) | clears both caches, bumps generation, marks every note dirty |
| `evaluateDirty()` (`:1421`) | `beginBatch()` → `topoSort(dirty)` → `evaluateNote()` in order → clear dirty → return the cache |
| `getEvaluatedNote(id)`, `isCacheValid()` | accessors |

`markDirtyOnly()` is the one to know about. `Module.markNoteDirty()` uses it for dependents whose *values* changed but whose *bytecode* did not — including the BaseNote-dependents branch (`src/module.js:215-235`) and the batch path (`:311-316`). It was added to reach parity with the WASM evaluator; before it existed, `module.js` guarded the call with a `typeof === 'function'` check, so on the JS path **editing the BaseNote never re-evaluated its indirect dependents**.

### `topoSort()` — Kahn's algorithm

`:1454-1552`. Not a recursive DFS.

1. For each dirty note, count its dependencies **that are also in the dirty set** — that is its in-degree.
2. A note that references the BaseNote gets an **implicit extra in-degree edge from note 0**, but only when note 0 is itself dirty (`graph.getBaseNoteDependents()`). The BaseNote is not a real edge in the graph — recording it would be a self-cycle — so the sort simulates it.
3. Zero-degree notes go into a queue, **sorted numerically** so the order is deterministic and note 0 goes first.
4. Processing a note decrements its dependents. Processing note **0** additionally releases every BaseNote dependent.
5. The queue is walked with an index cursor, not `shift()`.

On a cycle (`:1526-1549`) it does **not** throw:

```javascript
console.warn('Dependency cycle detected! Some notes could not be evaluated.');
// dumps up to 10 stuck notes with their unresolved deps, then:
// appends the remaining notes (sorted by id) to the result anyway
```

The stuck notes still get evaluated — against whatever stale or default values are reachable. Cycles are meant to be prevented upstream, by `validateExpression()` in `src/modals/validation.js`.

## From corruption flag to pixels

This is the whole point of tracking corruption, and it crosses four files:

```
POW produces an irrational
  → BinaryEvaluator._lastEvalWasCorrupted = true          binary-evaluator.js:1085
  → evaluateNote ORs the property's bit into corruptionFlags   :1272-1274
  → Module._updateCorruptionFlags() pushes it into the graph   module.js:636-659
      → DependencyGraph.setCorruptionFlags(noteId, flags)      dependency-graph.js:1659
  → RendererAdapter.sync() derives a_corruptionType per note   renderer.js:823-898
      0 = clean · 1 = transitive (single diagonal hatch) · 2 = direct (crosshatch)
  → the note widget prefixes the frequency with ≈             variable-controls.js:64-69
```

`_updateCorruptionFlags` is scoped to the dirty set, not all notes.

## Performance

Do not quote numbers that are not measured. Two harnesses exist:

- `npm run perf:bench` → `scripts/perf/bench-node.mjs`. Headless Node, **JS evaluator only** — no renderer, no WASM.
- `?perf=1` in the browser → `window.__rmtPerf` (`src/dev/perf-harness.js`), with `measureEval()`, `measureCommit()`, `report()`.

One run of `npm run perf:bench` on the generated stress modules (`npm run perf:gen`). The shapes are defined in `scripts/perf/generate-stress-module.mjs:179-183`:

| Module | Notes / depth | Full eval (p50) | Mid-chain commit (p50) | BaseNote edit (p50) |
|---|---|---|---|---|
| `chain-1000` | 1000 / depth 1000 | 3.01 ms | 0.77 ms | 1.19 ms |
| `fan-1000` | 1000 / depth 1 | 1.87 ms | 0.01 ms | 1.03 ms |
| `lattice-1000` | 1000 / 10 chains × 100 | 2.23 ms | 0.84 ms | 1.08 ms |
| `chords-dense` | 800 / 200 chords, roots chained | 1.50 ms | 0.57 ms | 0.72 ms |

::: warning These are one machine's numbers
Absolute values move with the host, and the p95s in the harness output run 2-4× the p50s. Re-run the bench rather than quoting this table — the evaluation table in [Performance](/developer/performance) is a *different run* of the same bench, and the two disagree by a few tenths of a millisecond for exactly this reason. What is stable is the *shape*: `fan-1000`'s mid-chain commit is ~100× cheaper than `chain-1000`'s, because nothing depends on the note you edited.
:::

Depth, not note count, is what costs: the incremental evaluator only touches the dirty closure, and a deep chain has a much larger one.

## Exact values

| Thing | Value | Source |
|---|---|---|
| VM stack | 32 entries, doubles | `binary-evaluator.js:727` |
| Fraction pool (evaluator) | 256, doubles when exhausted | `:731` (class default is 128, `:655`) |
| Fraction backing | `fraction.js@4.3.7` — `n`/`d`/`s` are **doubles**, not BigInt | `node_modules/fraction.js/fraction.js` |
| Note id in bytecode | `u16` → max **65535** | `binary-note.js:117-121` |
| Note id accepted on load | integer `0 … 65535` — matches the `u16` | `module.js:870-873` |

::: warning `fraction.js` is not arbitrary precision
The package ships a BigInt variant (`bigfraction.js`) but nothing imports it. The default export is double-backed. Exact rational arithmetic, yes; unbounded, no — a product like `(81/80)^1000` overflows.
:::

The JSON loader caps ids at 65 535 to match the `u16` that `LOAD_REF` writes — an id can no longer
wrap to a different note; out-of-range ids are skipped with a console warning.

## See also

- [Expression Compiler](/developer/core/expression-compiler) — where the bytecode comes from
- [Dependency Graph](/developer/core/dependency-graph) — where `getAllDependents()` and the corruption flags live
- [SymbolicPower](/developer/core/symbolic-power) — what `POW` builds, and what happens to it
- [WASM Overview](/developer/wasm/overview) — the other evaluator, and why it is off
