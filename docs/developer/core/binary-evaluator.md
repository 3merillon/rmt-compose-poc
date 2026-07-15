---
title: Binary Evaluator
description: The stack VM that executes note bytecode — the fraction pool, silent defaults, corruption flagging, and the incremental evaluator's Kahn topological sort.
---

# Binary Evaluator

`src/binary-evaluator.js` is a stack-based virtual machine that executes the bytecode produced by the [expression compiler](/developer/core/expression-compiler). It exports four things:

| Export | Role |
|---|---|
| `BinaryEvaluator` | the stack VM (`:791`) |
| `IncrementalEvaluator` | dirty tracking + Kahn topological sort (`:1418`) |
| `MusicValue` | rational / irrational / symbolic value wrapper (`:292`) |
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

The stack holds **only pooled `Fraction`s** — BigInt-backed since fraction.js 5.x, so a pooled value is exact at any magnitude. `SymbolicPower` appears transiently inside the `POW` handler and never survives it (see [POW](#pow-and-corruption)).

`evaluate(expr, evalCache)` (`:949`) walks the bytecode with a `pc` cursor and returns the single remaining stack value. `LOAD_CONST_BIG` decodes its variable-length BigInts straight into a pooled fraction (`:975-987`) — the old path routed them through a double-backed `Fraction` constructor, which silently rounded anything past 2^53.

## Value resolution — `LOAD_REF` and `LOAD_BASE`

There is **no recursion**. Topological order guarantees a note's dependencies are already in the cache by the time it is evaluated. `LOAD_REF` (`:988-1052`) resolves in this order:

1. the caller's `evalCache` entry for that note id;
2. the evaluator's own internal `cache` (`getCachedValue()`);
3. **for `TEMPO`, `BEATS_PER_MEASURE` and `MEASURE_LENGTH` only** — the same two lookups again against note **0**, the BaseNote (`:1015-1032`);
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

(`binary-evaluator.js:1034-1046`.) Delete a note and its dependents keep evaluating against these — a dependent's frequency becomes 440 Hz. `Module.removeNote()` still does not rewrite dependents, but it now emits a `console.warn` listing every dependent left dangling (the UI's delete paths liberate dependents first; the warning guards programmatic callers and hand-authored JSON).
:::

## Runtime behaviour of the other opcodes

| Situation | What happens |
|---|---|
| `DIV` with a zero divisor | `console.warn('Division by zero in binary evaluator, using 1')`, pushes `1`, **and sets the corruption flag** for the property being evaluated — the note crosshatches, same path as an irrational `POW` (`:1118-1132`) |
| Stack depth ≠ 1 at the end | `console.warn('Stack has N items after evaluation, expected 1')`, returns the top (`:1273-1275`) |
| `pop()` on an empty stack | throws `Stack underflow in binary evaluator` (`:907-910`) |
| `peek()` on an empty stack | throws `Stack empty in binary evaluator` |
| Unknown opcode byte | throws `Unknown opcode: 0x..` (`:1268-1269`) |

`FIND_TEMPO`, `FIND_MEASURE`, `DUP` and `SWAP` have cases in the switch but **no compiler emits them**, so they are unreachable. `FIND_INSTRUMENT` has no case at all.

## `POW` and corruption

`OP.POW` (`:1143-1170`) is the only place a value can leave the rationals.

```javascript
case OP.POW: {
  const exp  = this.pop();
  const base = this.pop();
  const powResult = MusicValue.rational(new Fraction(base.s * base.n, base.d))
                      .pow(MusicValue.rational(new Fraction(exp.s * exp.n, exp.d)));

  if (powResult.isCorrupted()) {
    this._lastEvalWasCorrupted = true;
    this.push(this.pool.allocFrom(powResult.toFraction()));  // ← float-derived approximation
  } else {
    this.push(this.pool.allocFrom(powResult.fraction));
  }
  break;
}
```

`MusicValue.pow()` (`:576-608`) tries `tryRationalPower()` first — an exact integer power, or a perfect n-th root, computed in BigInt so it is exact at any magnitude (the root check is an exact binary search, `integerNthRoot` at `:684`; the old float version silently missed perfect roots past 2^53).

Two DoS caps bound exact exponentiation (`:581-582`): integer exponents beyond **65536**, or results beyond **~1 Mbit per component**, are treated as irrational — corruption flag plus float approximation, the same UX as an inexact root. Without the caps a `x^(10^9)` expression would allocate gigabit integers (on 4.x it silently overflowed to `Infinity` instead).

If `tryRationalPower()` fails and the base is a positive integer below 2^53 (`SymbolicPower` stores bases as Numbers; real bases are small TET integers), it builds a `SymbolicPower`. That symbolic value is then **immediately flattened back to an approximated rational** by the branch above. Verified against the running VM:

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

It carries **no corruption bitmask**. Corruption bits are accumulated per-note by `evaluateNote()`, not by the value. Its `s`/`n`/`d` compatibility getters return **BigInt** (`0n`/`1n` sentinels for irrational/symbolic values), matching the 5.x `Fraction` fields, so consumers never see mixed Number/BigInt types.

## The fraction pool

`FractionPool` (`:709-788`) is a **bump allocator**, not a ring buffer. Its fields are **always BigInt** — fraction.js 5.x arithmetic throws on mixed Number/BigInt fields, so `alloc()` coerces Number arguments once at the door:

```javascript
alloc(n = 0n, d = 1n) {
  if (this.index >= this.pool.length) { /* grow: double the pool */ }
  const f = this.pool[this.index++];   // hand out the next slot and mutate it
  f.s = …; f.n = …; f.d = …;           // BigInt sign / magnitude / denominator
  return f;
}
reset() { this.index = 0; }            // rewind — called once per batch
```

`allocFrom()` (`:755`) copies BigInt fields directly and coerces duck-typed `{s, n, d}` values with Number fields (the WASM adapter can produce those) so they cannot poison downstream arithmetic.

`IncrementalEvaluator.evaluateDirty()` calls `evaluator.beginBatch()` (`:1504`), which calls `pool.reset()`. Everything allocated during the previous batch is recycled at that instant.

::: danger Never cache a pooled fraction
`reset()` rewinds the index, so the next batch mutates the very objects the last batch handed out. `evaluateNote()` copies every result into a fresh `new Fraction(...)` before storing it (`:1336-1339`). If you add a code path that keeps a value returned by `evaluate()` across a batch boundary, copy it first.
:::

## `evaluateNote()`

`:1287-1401`. Evaluates one note's six expressions in a fixed order and returns:

```javascript
{
  startTime, duration, frequency, tempo, beatsPerMeasure, measureLength,
  corruptionFlags   // u8 bitmask
}
```

Order: **tempo → beatsPerMeasure → frequency → measureLength → startTime → duration** (`:1359-1368`). Expressions within a note may reference each other — `measureLength` reads the `tempo` evaluated a moment earlier — so the in-progress result object is written into the shared cache *before* evaluation begins:

```javascript
const workingCache = evalCache || new Map();
workingCache.set(note.id, result);   // :1305-1306
```

::: tip The per-note cache copy is gone
This used to clone the whole evaluation cache for every note, which made a full evaluation **O(N²)**. Under topological order every dependency is already final before its dependent runs, and the caller overwrites the same key with the finished result — so writing straight into the shared map is safe. The rationale is in the source comment at `:1294-1300`.
:::

After each property, if `_lastEvalWasCorrupted` was set by a `POW`, the matching bit is OR-ed into `corruptionFlags`. The bits are the `CORRUPT` mask from `binary-note.js:55-62`: `startTime 0x01`, `duration 0x02`, `frequency 0x04`, `tempo 0x08`, `beatsPerMeasure 0x10`, `measureLength 0x20`.

### The synthetic `measureLength`

If `measureLength` was not explicitly defined **and** the note is a measure bar (has `startTime`, no `duration`, no `frequency`) or is the BaseNote, it is computed as `beatsPerMeasure.mul(60).div(tempo)` and stored as a **real, exact `Fraction`** (`:1371-1398`). It used to be a duck-typed `{s, n, d, valueOf}` object quantized to 1e-6 — that impostor drifted against the exact expression path and its Number fields would poison BigInt-backed consumers. Regular notes skip this entirely.

## Incremental evaluation

```javascript
new IncrementalEvaluator(module, dependencyGraph, evaluator)   // :1342
```

Fields: `graph`, `evaluator`, `dirty` (a `Set`), `cache` (`Map<noteId, result>`), `generation`.

| Method | Effect |
|---|---|
| `invalidate(noteId)` (`:1446`) | marks the note **and all transitive dependents** dirty, via `graph.getAllDependents()`. Bumps `generation`. |
| `markDirtyOnly(noteId)` (`:1465`) | marks dirty **without** re-registration or bytecode invalidation. |
| `invalidateAll()` (`:1472`) | clears both caches, bumps generation, marks every note dirty |
| `evaluateDirty()` (`:1498`) | `beginBatch()` → `topoSort(dirty)` → `evaluateNote()` in order → clear dirty → return the cache |
| `getEvaluatedNote(id)`, `isCacheValid()` | accessors |

`markDirtyOnly()` is the one to know about. `Module.markNoteDirty()` uses it for dependents whose *values* changed but whose *bytecode* did not — including the BaseNote-dependents branch (`src/module.js:215-235`) and the batch path (`:311-316`). It was added to reach parity with the WASM evaluator; before it existed, `module.js` guarded the call with a `typeof === 'function'` check, so on the JS path **editing the BaseNote never re-evaluated its indirect dependents**.

### `topoSort()` — Kahn's algorithm

`:1531-1629`. Not a recursive DFS.

1. For each dirty note, count its dependencies **that are also in the dirty set** — that is its in-degree.
2. A note that references the BaseNote gets an **implicit extra in-degree edge from note 0**, but only when note 0 is itself dirty (`graph.getBaseNoteDependents()`). The BaseNote is not a real edge in the graph — recording it would be a self-cycle — so the sort simulates it.
3. Zero-degree notes go into a queue, **sorted numerically** so the order is deterministic and note 0 goes first.
4. Processing a note decrements its dependents. Processing note **0** additionally releases every BaseNote dependent.
5. The queue is walked with an index cursor, not `shift()`.

On a cycle (`:1599-1626`) it does **not** throw:

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
  → BinaryEvaluator._lastEvalWasCorrupted = true          binary-evaluator.js:1158
  → evaluateNote ORs the property's bit into corruptionFlags   :1345-1347
  → Module._updateCorruptionFlags() pushes it into the graph   module.js:642-659
      → DependencyGraph.setCorruptionFlags(noteId, flags)      dependency-graph.js:1659
  → RendererAdapter.sync() derives a_corruptionType per note   renderer.js:808-898
      0 = clean · 1 = transitive (single diagonal hatch) · 2 = direct (crosshatch)
  → the note widget prefixes the frequency with ≈             variable-controls.js:64-80
```

`_updateCorruptionFlags` is scoped to the dirty set, not all notes.

## Performance

Do not quote numbers that are not measured. Two harnesses exist:

- `npm run perf:bench` → `scripts/perf/bench-node.mjs`. Headless Node, **JS evaluator only** — no renderer, no WASM.
- `?perf=1` in the browser → `window.__rmtPerf` (`src/dev/perf-harness.js`), with `measureEval()`, `measureCommit()`, `report()`.

One run of `npm run perf:bench` on the generated stress modules (`npm run perf:gen`), measured on the BigInt-backed evaluator:

| Module | Notes / depth | Full eval (p50) | Mid-chain commit (p50) | BaseNote edit (p50) |
|---|---|---|---|---|
| `chain-1000` | 1000 / depth 1000 | 3.23 ms | 0.97 ms | 1.79 ms |
| `fan-1000` | 1000 / depth 1 | 2.15 ms | 0.01 ms | 1.54 ms |
| `lattice-1000` | 1000 / 10 chains × 100 | 1.87 ms | 0.82 ms | 1.74 ms |
| `chords-dense` | 800 / 200 chords, roots chained | 1.05 ms | 0.51 ms | 1.00 ms |
| `comma-chain-400` | 400 / (81/80)^k growth | 124.5 ms | 99.3 ms | 122.7 ms |

::: warning These are one machine's numbers
Absolute values move with the host, and the p95s in the harness output run 2-4× the p50s. Re-run the bench rather than quoting this table — the evaluation table in [Performance](/developer/performance) is a *different run* of the same bench, and the two disagree by a few tenths of a millisecond for exactly this reason. What is stable is the *shape*: `fan-1000`'s mid-chain commit is ~100× cheaper than `chain-1000`'s, because nothing depends on the note you edited.
:::

Two costs matter now. **Depth** decides how much of the module a commit touches (the incremental evaluator only re-evaluates the dirty closure). **Digit count** decides what each operation costs: BigInt arithmetic scales with operand size, which is why `comma-chain-400` — whose fractions grow to ~760 digits — runs ~100× slower per note than the product-1 shapes whose fractions stay small. The bounded shapes moved by well under 2× against the double-backed baseline.

## Exact values

| Thing | Value | Source |
|---|---|---|
| VM stack | 32 entries, doubles when exhausted | `binary-evaluator.js:796` |
| Fraction pool (evaluator) | 256, doubles when exhausted | `:800` (class default is 128, `:710`) |
| Fraction backing | `fraction.js@5.3.4` — `n`/`d`/`s` are **BigInt**, arbitrary precision | `node_modules/fraction.js` |
| POW exponent cap | integer exponent ≤ **65536**, result ≤ **~1 Mbit** per component | `:581-582` |
| Note id in bytecode | `u16` → max **65535** | `binary-note.js:117-121` |
| Note id accepted anywhere | integer `0 … 65535` — enforced by the loader **and both expression parsers** | `module.js:873`, `dsl/parser.js:253`, `expression-compiler.js:215` |

::: tip Arbitrary precision, end to end
fraction.js 5.x is BigInt-backed, so exact rational arithmetic survives **any depth** of module tree: a 200-note `(3/2)` chain evaluates to its exact 98-digit numerator, and `(81/80)^400` is exact (see the `comma-chain-400` stress shape). `scripts/test-exactness.mjs` (part of `npm test`) locks this in: compile → evaluate → decompile → save → load → re-evaluate must reproduce every digit. The only remaining approximations are the *documented* ones — irrational `POW` results (corruption flag) and the float boundary `toNumber()` in `src/utils/fraction-num.js` where values leave for GL, Web Audio, and display.
:::

Note ids above 65 535 used to silently truncate to a different note in the compilers ([70000] bound to note 4464); both parsers now reject them at compile time with the same 0…65535 range the JSON loader enforces.

## See also

- [Expression Compiler](/developer/core/expression-compiler) — where the bytecode comes from
- [Dependency Graph](/developer/core/dependency-graph) — where `getAllDependents()` and the corruption flags live
- [SymbolicPower](/developer/core/symbolic-power) — what `POW` builds, and what happens to it
- [WASM Overview](/developer/wasm/overview) — the other evaluator, and why it is off
