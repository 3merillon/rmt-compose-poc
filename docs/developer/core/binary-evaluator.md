---
title: Binary Evaluator
description: The stack VM that executes note bytecode — the fraction pool, reported defaults, corruption flagging, and the incremental evaluator's per-variable evaluation order.
---

# Binary Evaluator

`src/binary-evaluator.js` is a stack-based virtual machine that executes the bytecode produced by the [expression compiler](/developer/core/expression-compiler). It exports four things:

| Export | Role |
|---|---|
| `BinaryEvaluator` | the stack VM (`src/binary-evaluator.js:829`) |
| `IncrementalEvaluator` | dirty tracking + per-variable evaluation order (`:1584`) |
| `MusicValue` | rational / irrational / symbolic value wrapper (`:330`) |
| `SymbolicPower` | algebraic form of an irrational power (`:58`) — see [SymbolicPower](/developer/core/symbolic-power) |

::: info This is the path that actually runs
Every browser session runs the **JavaScript** evaluator. The WASM evaluator is disabled: the Rust core still has the old variable layout (`tempo`, `beatsPerMeasure`, `measureLength` at indices 3 to 5, no attack or release), so `WASM_MATCHES_VARIABLE_LAYOUT` is `false` in `src/wasm/evaluator-adapter.js`, `?evaluator=wasm` is ignored with a console warning, and the hot-swap in `Module` never arms. Porting the Rust core is planned. See [WASM Overview](/developer/wasm/overview).
:::

## The six variables

A note has six variables, addressed by the `VAR` indices in `src/binary-note.js`:

| Index | `VAR` | Variable | Kind |
|---|---|---|---|
| 0 | `START_TIME` | `startTime` | language |
| 1 | `DURATION` | `duration` | language |
| 2 | `FREQUENCY` | `frequency` | language |
| 3 | `AMPLITUDE` | `amplitude` | interpretation |
| 4 | `ATTACK` | `attack` | interpretation |
| 5 | `RELEASE` | `release` | interpretation |

`FIRST_INTERPRETATION_VAR` is `3`. The language variables relate a note to other notes; the BaseNote holds the only absolute values (a frequency in Hz, a start and a duration in seconds, with `base.d` the time unit). The interpretation variables say how a note sounds: `amplitude` is a relative gain, `attack` and `release` are shares of the note's own duration. There is no stored tempo, beats-per-measure or measure length, and no computed measure length: a measure bar is an ordinary note whose duration is its length.

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
    this._lastEvalUnresolved = null; // references the last evaluate() replaced by a default
  }
}
```

The stack holds **only pooled `Fraction`s** — BigInt-backed since fraction.js 5.x, so a pooled value is exact at any magnitude. `SymbolicPower` appears transiently inside the `POW` handler and never survives it (see [POW](#pow-and-corruption)).

`evaluate(expr, evalCache)` (`:1031`) walks the bytecode with a `pc` cursor and returns the single remaining stack value. `LOAD_CONST_BIG` decodes its variable-length BigInts straight into a pooled fraction (`:1058-1070`) — the old path routed them through a double-backed `Fraction` constructor, which silently rounded anything past 2^53.

## Value resolution — `LOAD_REF` and `LOAD_BASE`

There is **no recursion**. The [evaluation order](#evaluation-order-per-variable) guarantees that every variable an expression reads is already in the cache by the time it is evaluated. `LOAD_REF` (`:1071-1126`) resolves in this order:

1. the caller's `evalCache` entry for that note id;
2. the evaluator's own internal `cache` (`getCachedValue()`) — only a standalone `evaluateNote()` fills it; the incremental path never does, so it cannot serve a stale value there;
3. **for the interpretation variables only** (`varIdx >= FIRST_INTERPRETATION_VAR`: `AMPLITUDE`, `ATTACK`, `RELEASE`) — the same two lookups again against note **0**, the BaseNote (`:1098-1115`);
4. a **hard-coded default**.

Step 3 is the inheritance rule users feel: `[5].a` on a note with no amplitude yields the BaseNote's amplitude, and `[5].attack` and `[5].release` work the same way. `startTime`, `duration` and `frequency` do **not** inherit: they are relations, written or absent, so a reference to one that a note does not define gets the default below. `src/variable-deps.js` states the same rule for the scheduler (`resolveVariableRef()`, `>= FIRST_INTERPRETATION_VAR` only).

::: warning Unresolvable references do not throw — they get a default, and a console error
| Variable | Default pushed |
|---|---|
| `startTime` | `0` |
| `duration` | `1` |
| `frequency` | `440` |
| `amplitude` | `1` |
| `attack` | `0` |
| `release` | `0` |

(`UNRESOLVED_DEFAULTS`, `binary-evaluator.js:28`, pushed by `pushDefault()` at `:982`.) The default is no longer silent. `evaluate()` records every reference it replaced in `_lastEvalUnresolved`, and module evaluation reports them once per batch, naming both ends and the reason (`reportProblems()`, `:1504`):

```
Unresolved reference! A hard-coded default was used instead:
  [1].frequency reads [9].frequency, but note 9 does not exist (used 440)
  [3].startTime reads [2].duration, but note 2 has no duration (used 1)
```

Code that calls `evaluate()` directly — the widget's live previews and the validators — still gets the default without a message; it is the module evaluation that reports.

`amplitude` is the one variable whose default is not a stand-in. A note that sets none, under a BaseNote that sets none, sounds at `1` **by definition**, so `[5].a` on such a note pushes `1` and records nothing (`amplitudeIsUnset()`, `:999`). It is reported like the others only when the note it names does not exist, or when an amplitude that *is* set has no value because of a cycle or a failed evaluation. `attack` and `release` have no such exemption: a reference to one that neither the note nor the BaseNote sets pushes `0` and is reported.

Delete a note and its dependents evaluate against these defaults — a dependent's frequency becomes 440 Hz. `Module.removeNote()` still does not rewrite dependents, but it warns about every dependent left dangling **and marks them dirty**, so they show at once what a reload would show (the UI's delete paths liberate dependents first; this guards programmatic callers and hand-authored JSON).
:::

## Runtime behaviour of the other opcodes

| Situation | What happens |
|---|---|
| `DIV` with a zero divisor | `console.warn('Division by zero in binary evaluator, using 1')`, pushes `1`, **and sets the corruption flag** for the property being evaluated — the note crosshatches, same path as an irrational `POW` (`:1184-1200`) |
| Stack depth ≠ 1 at the end | `console.warn('Stack has N items after evaluation, expected 1')`, returns the top (`:1253-1255`) |
| `pop()` on an empty stack | throws `Stack underflow in binary evaluator` (`:952-958`) |
| `peek()` on an empty stack | throws `Stack empty in binary evaluator` |
| Unknown opcode byte | throws `Unknown opcode: 0x..` (`:1249`) |

`DUP` and `SWAP` have cases in the switch but **no compiler emits them**, so they are unreachable. `FIND_INSTRUMENT` has no case at all. `FIND_TEMPO` (`0x20`) and `FIND_MEASURE` (`0x21`) are retired: they are no longer in `OP`, so a byte with either value is an unknown opcode.

## `POW` and corruption

`OP.POW` (`:1209-1232`) is the only place a value can leave the rationals.

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

`MusicValue.pow()` (`:571`) tries `tryRationalPower()` (`:644`) first — an exact integer power, or a perfect n-th root, computed in BigInt so it is exact at any magnitude (the root check is an exact binary search, `integerNthRoot` at `:722`; the old float version silently missed perfect roots past 2^53).

Two DoS caps bound exact exponentiation (`:619-620`): integer exponents beyond **65536**, or results beyond **~1 Mbit per component**, are treated as irrational — corruption flag plus float approximation, the same UX as an inexact root. Without the caps a `x^(10^9)` expression would allocate gigabit integers (on 4.x it silently overflowed to `Infinity` instead).

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

It carries **no corruption bitmask**. Corruption bits are accumulated per-note by `evaluateVariable()`, not by the value. Its `s`/`n`/`d` compatibility getters return **BigInt** (`0n`/`1n` sentinels for irrational/symbolic values), matching the 5.x `Fraction` fields, so consumers never see mixed Number/BigInt types.

## The fraction pool

`FractionPool` (`:747-826`) is a **bump allocator**, not a ring buffer. Its fields are **always BigInt** — fraction.js 5.x arithmetic throws on mixed Number/BigInt fields, so `alloc()` coerces Number arguments once at the door:

```javascript
alloc(n = 0n, d = 1n) {
  if (this.index >= this.pool.length) { /* grow: double the pool */ }
  const f = this.pool[this.index++];   // hand out the next slot and mutate it
  f.s = …; f.n = …; f.d = …;           // BigInt sign / magnitude / denominator
  return f;
}
reset() { this.index = 0; }            // rewind — called once per batch
```

`allocFrom()` (`:793`) copies BigInt fields directly and coerces duck-typed `{s, n, d}` values with Number fields (the WASM adapter can produce those) so they cannot poison downstream arithmetic.

`IncrementalEvaluator.evaluateDirty()` calls `evaluator.beginBatch()` (`:1678`, defined at `:885`), which calls `pool.reset()`. Everything allocated during the previous batch is recycled at that instant.

::: danger Never cache a pooled fraction
`reset()` rewinds the index, so the next batch mutates the very objects the last batch handed out. `evaluateVariable()` copies every result into a fresh `new Fraction(...)` before storing it (`:1467`). If you add a code path that keeps a value returned by `evaluate()` across a batch boundary, copy it first.
:::

## `evaluateNote()` and `evaluateVariable()`

`evaluateNote(note, evalCache)` (`:1272`) evaluates one note's six expressions and returns:

```javascript
{
  startTime, duration, frequency,
  amplitude, attack, release,   // null unless the note defines one
  corruptionFlags               // bitmask, see below
}
```

The unit of evaluation is the **variable**, not the note. `evaluateVariable(note, varIndex, record, evalCache)` (`:1458`) runs one expression and writes one field of the record; `evaluateNote()` is a group of one handed to [`evaluateVariables()`](#evaluation-order-per-variable), which decides the order. A note's variables may read each other — the BaseNote's duration from its own frequency, a start from the same note's duration — so the in-progress record is written into the shared cache *before* evaluation begins:

```javascript
const workingCache = evalCache || new Map();
workingCache.set(note.id, result);   // :1281-1282
```

::: tip There is no fixed order inside a note
There used to be one. An expression that read a variable *later* in it got the hard-coded default, or whatever the note had evaluated to last time — a BaseNote variable computed from 440, then from the previous frequency after every edit. The list survives as `VAR_ORDER` (`:21`: frequency, startTime, duration, amplitude, attack, release), but only as the order in which the walk *starts*; anything a variable reads is evaluated ahead of it.
:::

After each variable, if `_lastEvalWasCorrupted` was set by a `POW`, the matching bit is OR-ed into `corruptionFlags` (`:1479-1481`). The bits are the `CORRUPT` mask from `src/binary-note.js:62-69`, `1 << varIndex`: `startTime 0x01`, `duration 0x02`, `frequency 0x04`, `amplitude 0x08`, `attack 0x10`, `release 0x20`.

### No computed measure length

Earlier versions computed a `measureLength` for a measure bar and for the BaseNote (`beatsPerMeasure × 60 / tempo`) as a seventh value of the record. That is gone, with the variables it used. A measure bar is an ordinary note (a start, a duration, no frequency, flagged `measure`) and its length is its own `duration`, evaluated like any other. The evaluator does not look at the flag.

## Incremental evaluation

```javascript
new IncrementalEvaluator(module, dependencyGraph, evaluator)   // :1585
```

Fields: `graph`, `evaluator`, `dirty` (a `Set`), `cache` (`Map<noteId, result>`), `generation`.

| Method | Effect |
|---|---|
| `invalidate(noteId, dependents?)` (`:1616`) | marks the note **and everything that must follow it** dirty, via `graph.getEvaluationDependents()` — transitive, and across the BaseNote. A caller that already holds that set passes it in. Bumps `generation`. |
| `markDirtyOnly(noteId)` (`:1635`) | marks dirty **without** re-registration or bytecode invalidation. |
| `invalidateAll()` (`:1642`) | clears both caches, bumps generation, marks every note dirty |
| `evaluateDirty()` (`:1672`) | `beginBatch()` → a blank record for every dirty note → `evaluateVariables()` → `reportProblems()` → clear dirty → return the cache |
| `getEvaluatedNote(id)`, `isCacheValid()` | accessors |

`markDirtyOnly()` is the one to know about. `Module.markNoteDirty()` (`src/module.js:235-237`) uses it for dependents whose *values* changed but whose *bytecode* did not, and so does the batch path (`src/module.js:310-313`). It was added to reach parity with the WASM evaluator; before it existed, `module.js` guarded the call with a `typeof === 'function'` check, so on the JS path **editing the BaseNote never re-evaluated its indirect dependents**.

Dirty tracking stays **per note**: a change to any expression of a note re-evaluates all of that note and of every note downstream. That is a superset of what strictly has to change, and it is what keeps the dirty set one cheap graph walk. Only the *order* is per variable.

::: tip A dirty note never reads its own last value
`evaluateDirty()` installs a blank record for every dirty note before it evaluates anything (`:1690-1705`). From then on a variable can read only what this batch has computed, or what a clean note holds. The old code kept the previous record until the note's turn came, so anything read out of order silently got last time's value — the reason a wrong result used to "fix itself" on the second evaluation, and a looped one grew on every edit.
:::

### Evaluation order per variable

`evaluateVariables(notes, records, evalCache)` (`:1315-1452`) takes the dirty notes (ascending by id) and evaluates their variables one at a time, each after the variables it reads.

What a variable reads comes from `src/variable-deps.js`, the one place that states it:

| A variable reads… | Resolved by |
|---|---|
| every `LOAD_REF` / `LOAD_BASE` in its bytecode, `base.x` being note 0 | `BinaryExpression.getVariableRefs()` (`binary-note.js:295`), decoded once per expression |
| the BaseNote's variable instead, when the reference is to an `amplitude`, `attack` or `release` the named note does not define (indices `>= FIRST_INTERPRETATION_VAR`) | `resolveVariableRef()` (`variable-deps.js:81`) |
| nothing schedulable, when no note defines it — `evaluate()` falls back to the default and reports it | — |

The walk is depth-first and iterative (explicit stacks, so a 1000-deep chain cannot overflow the call stack). It starts from every variable in turn — notes in ascending id, variables in `VAR_ORDER` — and before evaluating one, descends into whatever it reads **inside the dirty set**. Variables of clean notes are final and are read as they are.

This is what makes cross-variable relationships work. Note 1's frequency may read note 2's frequency while note 2's start reads note 1's start and duration:

```
[1].f = (3/2) * [2].f        [2].t = [1].t + [1].d
```

Between whole notes that is a loop — the old per-note Kahn sort reported `Dependency cycle detected!` and evaluated `[1].f` against 440. Between variables it is a tree, and every value comes out exact on the first evaluation.

### True cycles

A variable that depends on itself has no order. The walk is Tarjan's strongly-connected-components algorithm, so it finds each set of mutually dependent variables **whole**, and then (`:1411-1436`):

1. evaluates the members in ascending (note id, variable) order — a member read before its turn falls back to the hard-coded default (or, for an interpretation variable, to the BaseNote's value), exactly like any other unresolved reference;
2. hands one loop per set to `reportProblems()` (`:1504`).

```
Dependency cycle detected! These variables depend on themselves, so some of their reads fell back to defaults:
  [1].frequency → [2].frequency → [1].frequency
```

It does **not** throw, and the loop still gets values. Because the order inside a set is fixed and dirty notes start from blank records, those values depend only on the module — not on which note the walk reached first, and not on the edit history. An incremental evaluation always equals a fresh load of the same module; `scripts/test-variable-deps.mjs` (part of `npm test`) checks that on seeded random modules and edits, cyclic ones included.

Cycles are meant to be prevented upstream, by `validateExpression()` in `src/modals/validation.js`, which uses the same per-variable rule — see [Dependency Graph](/developer/core/dependency-graph#cycles-are-checked-per-variable).

::: info The WASM path still orders whole notes
The Rust evaluator evaluates a note's expressions in the old fixed order and with the old variable layout, and both WASM incremental evaluators sort **notes** with the Kahn algorithm this page used to describe (`WasmIncrementalEvaluator.topoSort()`, `src/wasm/evaluator-adapter.js:589`). Nothing of this section has been ported, which is one reason the WASM evaluator is disabled.
:::

## From corruption flag to pixels

This is the whole point of tracking corruption, and it crosses four files:

```
POW produces an irrational
  → BinaryEvaluator._lastEvalWasCorrupted = true          binary-evaluator.js:1224
  → evaluateVariable ORs the property's bit into corruptionFlags   :1479-1481
  → Module._updateCorruptionFlags() pushes it into the graph   module.js:682-705
      → DependencyGraph.setCorruptionFlags(noteId, flags)      dependency-graph.js:1746
  → RendererAdapter.sync() derives a_corruptionType per note   renderer.js:910-957
      0 = clean · 1 = transitive (single diagonal hatch) · 2 = direct (crosshatch)
  → the note widget prefixes the frequency with ≈             variable-controls.js:127-143
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
| VM stack | 32 entries, doubles when exhausted | `binary-evaluator.js:834` |
| Fraction pool (evaluator) | 256, doubles when exhausted | `:838` (class default is 128, `:748`) |
| Fraction backing | `fraction.js@5.3.4` — `n`/`d`/`s` are **BigInt**, arbitrary precision | `node_modules/fraction.js` |
| POW exponent cap | integer exponent ≤ **65536**, result ≤ **~1 Mbit** per component | `:619-620` |
| Note id in bytecode | `u16` → max **65535** | `binary-note.js:128` |
| Note id accepted anywhere | integer `0 … 65535` — enforced by the loader **and both expression parsers** | `module.js:873`, `dsl/parser.js:253`, `expression-compiler.js:215` |

::: tip Arbitrary precision, end to end
fraction.js 5.x is BigInt-backed, so exact rational arithmetic survives **any depth** of module tree: a 200-note `(3/2)` chain evaluates to its exact 98-digit numerator, and `(81/80)^400` is exact (see the `comma-chain-400` stress shape). `scripts/test-exactness.mjs` (part of `npm test`) locks this in: compile → evaluate → decompile → save → load → re-evaluate must reproduce every digit. The only remaining approximations are the *documented* ones — irrational `POW` results (corruption flag) and the float boundary `toNumber()` in `src/utils/fraction-num.js` where values leave for GL, Web Audio, and display.
:::

Note ids above 65 535 used to silently truncate to a different note in the compilers ([70000] bound to note 4464); both parsers now reject them at compile time with the same 0…65535 range the JSON loader enforces.

## See also

- [Expression Compiler](/developer/core/expression-compiler) — where the bytecode comes from
- [Dependency Graph](/developer/core/dependency-graph) — where `getEvaluationDependents()` and the corruption flags live
- [SymbolicPower](/developer/core/symbolic-power) — what `POW` builds, and what happens to it
- [WASM Overview](/developer/wasm/overview) — the other evaluator, and why it is off
