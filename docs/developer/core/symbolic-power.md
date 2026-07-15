---
title: SymbolicPower
description: The algebraic representation of irrationals like 2^(1/12) — its real API, where it is actually live in the shipping app, and where it is not.
---

# SymbolicPower

**SymbolicPower** represents an irrational value by its algebraic structure instead of its numeric value:

```
value = coefficient × base₁^exp₁ × base₂^exp₂ × … × baseₙ^expₙ
```

`src/binary-evaluator.js:20-284`.

## The problem

Equal temperament needs irrational frequency ratios:

```javascript
Math.pow(2, 1/12) === 1.0594630943592953   // 12-TET semitone
```

Store that as a float and you lose precision with every operation: multiply it by itself twelve times and you do **not** get exactly 2. Approximate it as a rational instead — the evaluator's `POW` lands on `2739815/2586041` — and the error compounds under multiplication, so twelve of them still miss 2.

## The solution

Store the algebraic form. `2^(1/12)` is not a number to be computed; it is a *base* and an *exponent* to be carried around.

```javascript
SymbolicPower.fromPower(2, new Fraction(1, 12))
// { coefficient: Fraction(1), powers: [ { base: 2, exp: Fraction(1, 12) } ] }
```

Multiplication then merges like bases by **adding exponents**, so `2^(1/12) × 2^(1/12)` is `2^(1/6)` exactly — no float ever enters the calculation.

::: danger This is not what happens during evaluation
Read the next section before you build anything on that promise. In the shipping app, `SymbolicPower` **does not survive a single opcode boundary** on the evaluator's stack. The class is real and correct; the evaluator does not use it the way this section implies.
:::

## What actually happens at runtime

`OP.POW` (`binary-evaluator.js:1143-1170`) builds a `MusicValue`, calls `pow()`, and then — if the result is irrational — **flattens it back to an approximated rational and pushes that**:

```javascript
if (powResult.isCorrupted()) {
  this._lastEvalWasCorrupted = true;
  this.push(this.pool.allocFrom(powResult.toFraction()));   // ← float-derived approximation
}
```

Verified against the running VM:

```
2^(1/12)  →  Fraction 2739815 / 2586041   (≈ 1.0594630943592929)
2^(7/12)  →  Fraction 2126312 / 1419143   (≈ 1.4983070768766784)
4^(1/2)   →  Fraction 2 / 1                exactly — see below
```

So the evaluator's stack holds **only pooled `Fraction`s**. Every consumer downstream of `POW` — `MUL`, `DIV`, the evaluation cache, the renderer, the audio engine — sees `2739815/2586041`, not `2^(1/12)`. Multiplying twelve of them together does not give exactly 2.

What survives the flattening is not the algebra but the **flag**: `_lastEvalWasCorrupted`, which becomes the note's `corruptionFlags` bit, which becomes the crosshatch you see on the canvas. That flag is the entire payoff of the `POW` design in the shipping app.

::: info Rational powers are exact — at any magnitude, up to a cap
`MusicValue.pow()` (`:533`) calls `tryRationalPower()` (`:606`) first, which handles integer exponents (`rationalIntPower`, `:633`) and **perfect n-th roots** (`tryPerfectNthRoot`, `:656`) — both computed in BigInt, so they are exact regardless of how many digits the operands have. The root check is an exact binary search (`integerNthRoot`, `:684`); the old float version silently missed perfect roots past 2^53. Two DoS caps bound the exact path (`:581-582`): an integer exponent above **65536**, or a result beyond **~1 Mbit per component**, is treated as irrational instead of allocating gigabit integers. `4^(1/2)` really is `2`, exactly, and is **not** flagged as corrupted. Only irrational powers — and over-cap ones — corrupt.

`SymbolicPower` is only constructed at all when the base is a **positive integer below 2^53** (`:545-546` — the class stores bases as Numbers; real bases are small TET integers). A non-integer, negative, or oversized base falls straight to `MusicValue.irrational` — a plain f64.
:::

### Where the algebra *is* live

`src/dsl/simplify.js`. This is an independent re-implementation of the same normal form, and it runs on **save**, not on evaluation. Its header (`:1-21`) states the contract: a value is a rational coefficient times a product of `base^exp` terms, like bases merge, and coefficients never migrate into a power term.

That is what makes these rewrites happen when you save a variable:

| You type | It is saved as |
|---|---|
| `2 * (1/2) * base.f` | `base.f` |
| `base.f + base.f` | `2 * base.f` |
| `4^(1/2) * base.f` | `2 * base.f` — the perfect root folds; the note stays **un**corrupted |
| `2^(1/12) * 2^(1/12) * base.f` | `2^(1/6) * base.f` — like bases merge; still corrupted |
| `2 * base.f * 2^(7/12)` | unchanged — the coefficient stays out of the power |

A rewrite is rejected and the original kept if re-evaluating it moves the value (relative tolerance `1e-12`) or **flips the corruption flag** (`src/utils/simplify.js:128-155`).

The same machinery backs the ▲/▼ interval arrows (Settings → Arrows; default up ×2/1, down ×1/2 — they are not octave-only): `scaleDSL()` folds the arrow's factor into the expression's rational coefficient rather than prepending a multiplier, so up-then-down returns to exactly `base.f` and a TET note stays TET. Verified:

```
scaleDSL('base.f', 2, 1)                    → 2 * base.f
scaleDSL('2 * base.f', 1, 2)                → base.f
scaleDSL('base.f * 2^(7/12)', 3, 2)         → (3/2) * base.f * 2^(7/12)
```

## API

`SymbolicPower` (`binary-evaluator.js:20-284`). Note the field is **`exp`**, not `exponent`.

```javascript
class SymbolicPower {
  coefficient;   // Fraction
  powers;        // [{ base: number, exp: Fraction }]  — base is a positive integer

  static fromPower(base, exp)   // :35  — base^exp, coefficient 1
  static fromRational(frac)     // :42  — a rational, no power terms

  toFloat()                     // :49  — f64, for audio and rendering
  isRational()                  // :60  — no powers, or every exp has d === 1
  toRationalFraction()          // :67  — Fraction if rational, else null
  normalize()                   // :88  — drop zero exponents, sort by base

  mul(other)                    // :101 — merge like bases by adding exponents
  div(other)
  pow(frac)
}
```

There is no `simplify()`, no `fromFraction()`, no `valueOf()`, and no `isCorrupted()` on this class. (`isCorrupted()` is on `MusicValue` — `:345`.)

### 12-TET octave closure

```javascript
const semitone = SymbolicPower.fromPower(2, new Fraction(1, 12));

let octave = semitone;
for (let i = 1; i < 12; i++) octave = octave.mul(semitone);
// → { coefficient: 1, powers: [ { base: 2, exp: 1/1 } ] }

octave.isRational();            // true   — the exponent's denominator is 1
octave.toRationalFraction();    // Fraction 2/1 — exactly 2
```

`mul()` alone leaves you with `2^1`; `toRationalFraction()` is the step that collapses it to the rational `2`. Verified by running the real class.

### Multi-base

Bases that cannot be combined algebraically are kept separate:

```javascript
const tetThird = SymbolicPower.fromPower(2, new Fraction(4, 12));  // 12-TET major third
const bpStep   = SymbolicPower.fromPower(3, new Fraction(1, 13));  // Bohlen-Pierce step

tetThird.mul(bpStep);
// { coefficient: 1, powers: [ {base: 2, exp: 1/3}, {base: 3, exp: 1/13} ] }
```

`normalize()` sorts `powers` by base and drops zero exponents, so the representation is canonical.

## Corruption, end to end

The `CORRUPT` bitmask (`src/binary-note.js:55-62`):

```javascript
export const CORRUPT = {
  START_TIME:        0x01,
  DURATION:          0x02,
  FREQUENCY:         0x04,
  TEMPO:             0x08,
  BEATS_PER_MEASURE: 0x10,
  MEASURE_LENGTH:    0x20,
};
```

The path from an irrational power to a pixel:

```
POW produces an irrational
  → BinaryEvaluator._lastEvalWasCorrupted = true           binary-evaluator.js:1158
  → evaluateNote() ORs the property's bit into corruptionFlags   :1345-1347
  → Module._updateCorruptionFlags()                        module.js:642-659
      → DependencyGraph.setCorruptionFlags(id, flags)      dependency-graph.js:1659
  → RendererAdapter.sync() → a_corruptionType per note     renderer.js:823-898
  → the shader hatches the note
```

On the canvas:

| `a_corruptionType` | Meaning | Visual |
|---|---|---|
| `0.0` | clean | none |
| `1.0` | transitively corrupted — depends on something corrupt | single 45° diagonal hatch |
| `2.0` | directly corrupted — corrupt, with no corrupt dependency | crosshatch |

In the note widget, a transitively-corrupted **frequency** displays as `≈<fraction>` with the `corrupted-value` class (`src/modals/variable-controls.js:70-79`; `public/styles.css:1308-1311`).

::: warning The direct-corruption float readout
The widget's *directly*-corrupted branch (`≈1.0594631`, eight significant figures) keys on `value.isCorrupted || ev._irrational || ev._floatValue !== undefined` (`variable-controls.js:60`). `value.isCorrupted` is the dependency graph's per-property corruption bit (`src/modals/index.js:298`), so the branch fires on the JS path too; `_irrational` / `_floatValue` are only ever set by the WASM evaluator adapter (`src/wasm/evaluator-adapter.js:915-916`). The float it prints is `ev._floatValue` when present, otherwise the approximated fraction converted through `toNumber()` (`variable-controls.js:67`) — the documented lossy boundary in `src/utils/fraction-num.js`.
:::

Exact values can wear an `≈` too, without any corruption: once a fraction's numerator plus denominator pass 24 digits, the widget collapses the readout to an eight-significant-figure approximation and keeps the exact (elided) `n/d` form in the row's `title` tooltip (`src/modals/fraction-display.js`). The stored value stays exact — only the rendering approximates.

## The Rust mirror

`rust/src/value.rs:20-40`. The struct is **`PowerTerm`**, and `base` is a `u32` — matching the JS rule that only positive integer bases become symbolic:

```rust
pub struct PowerTerm {
    pub base: u32,
    pub exponent: Fraction,
}

pub struct SymbolicPower {
    pub coefficient: Fraction,
    pub powers: Vec<PowerTerm>,
}
```

The Rust evaluator's stack really does hold `Value::{Rational, Irrational, Symbolic}`, so it preserves the symbolic form across operations where the JS VM flattens. But that path is **opt-in and currently unusable** — see [WASM Overview](/developer/wasm/overview). Every user today is on the JS path.

## Scale systems

The modules that exercise this live in the module library's **Scale Systems** section (`public/modules/scale-systems/`), not at the top level: `TET-12`, `TET-19`, `TET-31`, `BP-13`, `Mixed-Base`, `tesla`.

```
[1].f * 2^(1/12)     # one 12-TET semitone above note 1
[1].f * 2^(1/31)     # one 31-TET step above note 1
[1].f * 3^(1/13)     # one Bohlen-Pierce step (13 equal divisions of the 3:1 tritave)
```

`Mixed-Base` is the interesting one: it mixes bases 2, 3 and 5 in a single module, and even within a single expression —

```
[7].f * 2 ^ (-1/12) * 3 ^ (-1/13)
```

— which is exactly the case the multi-base `powers` array and `normalize()` exist for.

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — where `POW` builds and then discards a `SymbolicPower`
- [Dependency Graph](/developer/core/dependency-graph) — where corruption flags are stored and made transitive
- [Equal Temperament](/user-guide/tuning/equal-temperament) — the user-facing guide
- [Custom TET](/user-guide/tuning/custom-tet) — building your own system
