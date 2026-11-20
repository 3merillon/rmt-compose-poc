---
title: Exact Values
description: How RMT Compose keeps 2^(1/12) exact through evaluation — the three kinds of value (rational, irrational, approximate), their canonical form, what is closed and what falls back, and where numbers leave the exact world.
---

# Exact Values

Every value the evaluator computes has one of three kinds (`src/value/exact.js`):

| Kind | Representation | Example |
|---|---|---|
| **rational** | a `Fraction` (fraction.js, BigInt-backed). The common case and the fast path: never wrapped | `3/2`, `263` |
| **irrational** | an `Irrational` (`src/value/exact.js:49`): an exact algebraic value | `2^(1/12)`, `263 * 2^(7/12)` |
| **approximate** | an `Approx` (`src/value/exact.js:68`): a Fraction standing for a number it is not exactly | `~261.63` |

`2^(7/12)` is exact but irrational: it is a relation, kept as the power it is. `~261.63` is a measurement: a rational number marked as not exact. The two are never confused.

## The problem this solves

Equal temperament needs irrational ratios. A float loses precision with every operation, and a rational approximation of a float compounds its error under multiplication. Before v2 the evaluator turned `2^(1/12)` into the fraction `2739815/2586041`, so twelve 12-TET steps above 263/4 gave 131.4999999999982, not 131.5. Now they give exactly 263/2.

## The irrational form

```
value = Σ  c_k × Π  b_i ^ e_i        c_k rational ≠ 0, b_i integers > 1, 0 < e_i < 1
```

It is kept **canonical**, so equal values are equal structurally (`equals()`, `src/value/exact.js:387`):

- like bases merge: `2^(1/12) × 2^(1/12) = 2^(1/6)`;
- the integer part of an exponent moves into the coefficient: `2^(13/12) = 2 * 2^(1/12)`;
- bases are factored into primes by trial division up to 65536 (`FACTOR_LIMIT`, `src/value/exact.js:32`): `4^(1/2)` is the rational `2`, `6^(1/2)` is `2^(1/2) * 3^(1/2)`. A cofactor beyond the limit stays as one opaque base: still exact, though two such values may not compare equal structurally;
- terms with the same radical part add up: `3 * 2^(1/2) + 2^(1/2) = 4 * 2^(1/2)`;
- when no radical is left, the value is a `Fraction` again: twelve semitones are the rational `2`.

## What is closed, and what falls back

| Operation | Result |
|---|---|
| `+`, `−` | exact: terms merge or are appended |
| `×` | exact: distribute and merge, up to **64 terms** (`MAX_TERMS`, `src/value/exact.js:30`) |
| `÷` by a single term | exact: the term is inverted (`div()`, `src/value/exact.js:300`) |
| a rational power of a single term | exact: `(c × 2^(1/12))^(1/2)` raises the coefficient too (`pow()`, `src/value/exact.js:356`) |
| a rational power of a rational | exact: integer powers and perfect roots stay rational, the rest is factored (`rationalPow()`, `src/value/exact.js:317`) |
| an integer power 0 … 8 of a sum | exact: repeated multiplication (`MAX_INT_POW`) |
| `÷` by a sum, a non-integer power of a sum, more than 64 terms | **approximate** |
| an irrational or approximate exponent | **approximate** |
| an even root of a negative number | **approximate** (not a real number) |
| an integer exponent above 65536, a result beyond ~1 Mbit per component | **approximate** (the DoS caps, `src/value/exact.js:33-34`) |

A fallback never fails and never passes as exact: its result is an `Approx`, flagged and shown with ≈. Single-term values are what music produces (every TET pitch, every chain of tempered intervals); sums appear only where irrational durations are added to times, and stay well below the cap.

## Approximate values

An approximate value comes from `~` in an expression (`base.f * ~1.4983`, see [Approximate numbers](/reference/expressions/syntax#approximate-numbers)) or from a fallback above. Everything computed from it is approximate (`add`, `mul`, `div` and `pow` all check first), and it never equals an exact value: `~1.5` is not `3/2`. The DSL compiles `~x` to the literal followed by the opcode `APPROX` (0x16), which the evaluator turns into an `Approx` (`src/binary-evaluator.js:562`).

## In the evaluator

- **The stack** holds pooled `Fraction`s for rational values and immutable `Irrational` / `Approx` objects otherwise. `ADD`, `SUB`, `MUL`, `DIV` and `NEG` take the old fraction path when both operands are rational, and the exact module otherwise. A pooled Fraction is copied out of the pool before an exact value keeps it, because the pool reuses its objects.
- **`POW`** (`src/binary-evaluator.js:550`) calls `pow()` and pushes whatever kind it returns.
- **Records** keep, for each variable, a `Fraction` in the usual field (`record.frequency`) and the exact value in `record.exact.frequency` when it is not rational (`createEvaluationRecord()`, `src/binary-evaluator.js:34`). The Fraction is the **shadow**: the value itself when rational, the approximation when approximate, and the exact binary value of the nearest double when irrational (`shadow()`, `src/value/exact.js:229`). `record.approxFlags` has a bit per approximate variable.
- **References read the exact value** (`recordValue()`, `src/binary-evaluator.js:63`), so a dependent is computed from `263 * 2^(7/12)`, never from its shadow. `evaluate()` still returns a Fraction (the shadow), with the exact value in `_lastExact` (`src/binary-evaluator.js:600`); `Note.getExactVariable(name)` (`src/note.js:227`) gives the exact value of an evaluated note.

## Where numbers leave

Drawing, sound and MIDI read the shadow through `toNumber()`. For an irrational value that is the same double as `toNumber(exact)` (`src/value/exact.js:194`), which computes each term in floating point: the boundary is crossed once, at the moment a float is needed.

**Ordering** (`compare()`, `src/value/exact.js:401`) is exact: equal values compare equal structurally; otherwise the sign of the float difference decides, and when the two doubles are within 1e-12 relative, a 192-bit fixed-point evaluation does (`fixedPoint()`, `src/value/exact.js:243`). The start-time sorts of `Module.reindexModule()` and the player use it.

## Code that writes expressions from values

Evaluate to BaseNote, Evaluate Module, re-anchoring a moved note, Liberate, the arrows on a note without an expression and Copy selection as module rewrite an expression from an evaluated value. They read the exact value and write it with `src/utils/value-expr.js` (`valueFactor()`, `src/utils/value-expr.js:22`): a rational as a fraction, an irrational as its exact form (`base.f * 2^(7/12)`, `2^(5/6) * [1].f`), an approximate value with `~` (`base.f * ~(14983/8000)`). Nothing guesses an irrational back from a float any more.

## The flags and the hatching

The `CORRUPT` bitmask (`src/binary-note.js:63-70`) has a bit per variable (`0x01` start … `0x20` release). A variable's bit is set when **its own expression** makes a non-exact value: an irrational power (`src/binary-evaluator.js:557`), a `~` literal (`src/binary-evaluator.js:567`), a division by zero (`src/binary-evaluator.js:533`), or an approximation of the exact algebra (`pushResult()`, `src/binary-evaluator.js:373`). A note that only *reads* such a value gets no bit of its own; the dependency graph reports it transitively.

```
POW makes an irrational, or ~ / a fallback makes an approximation
  → BinaryEvaluator._lastEvalWasCorrupted = true
  → evaluateVariable() ORs the variable's bit into corruptionFlags   binary-evaluator.js:830
  → Module._updateCorruptionFlags()                                  module.js:709
      → DependencyGraph.setCorruptionFlags(id, flags)                dependency-graph.js:1746
  → RendererAdapter.sync() → a_corruptionType per note               renderer.js:1015
  → the shader hatches the note
```

| `a_corruptionType` | Meaning | Visual |
|---|---|---|
| `0.0` | exact rational, nothing tempered upstream | none |
| `1.0` | transitive: depends on a tempered or approximate note | single 45° diagonal hatch |
| `2.0` | direct: its own expression is tempered or approximate | crosshatch |

The note widget shows the kind in words (`buildEvaluatedDiv()`, `src/modals/variable-controls.js:112`): an irrational value as its exact form and its value (`(263/4) * 2^(1/4) = 78.190368…`), an approximate value as `≈493.12500`, a rational value as its fraction, also when a tempered chain lands on one (the octave of 12-TET shows `263/2`). A very long exact fraction is still elided to eight significant figures with the full form in the tooltip (`src/modals/fraction-display.js`); that is display only.

## The simplifier

`src/dsl/simplify.js` re-implements the same normal form on expression **text**, and runs when a variable is saved and for the ▲/▼ interval arrows. Coefficients never migrate into a power term, so a TET expression keeps its shape; an approximation `~x` is an opaque factor, never folded into the exact coefficient, and keeps its decimal form.

| You type | It is saved as |
|---|---|
| `2 * (1/2) * base.f` | `base.f` |
| `base.f + base.f` | `2 * base.f` |
| `4^(1/2) * base.f` | `2 * base.f` — the perfect root folds; the note is not hatched |
| `2^(1/12) * 2^(1/12) * base.f` | `2^(1/6) * base.f` — like bases merge |
| `2 * base.f * 2^(7/12)` | unchanged — the coefficient stays out of the power |

A rewrite is kept only if it evaluates to exactly the same value, with the same flag (`src/utils/simplify.js:84-98`). The arrows fold their factor into the coefficient (`scaleDSL()`), so up-then-down returns to exactly what was written:

```
scaleDSL('base.f * 2^(7/12)', 3, 2)   → (3/2) * base.f * 2^(7/12)
scaleDSL('base.f * ~1.5', 2, 1)       → 2 * base.f * ~1.5
```

## The Rust core

`rust/src/exact.rs` is the twin of `src/value/exact.js`, operation by operation: rational, irrational as canonical sums of radical terms, approximate. It has the same caps (`MAX_TERMS` 64, `MAX_INT_POW` 8, `FACTOR_LIMIT` 65536; `rust/src/exact.rs:29-31`) and the same fallbacks. Rationals are `Q` (`rust/src/rational.rs:19`): two machine words while the numerator and denominator fit an `i64`, else a `BigRational`. In WebAssembly the power function calls the JavaScript `Math.pow`, so doubles match to the bit. Values cross to JavaScript whole, never as floats. `scripts/test-wasm-parity.mjs` compares the two engines exactly (see [WASM Overview](/developer/wasm/overview)).

## Scale systems

The modules that exercise this live in the module library's **Scale Systems** section (`public/modules/scale-systems/`): `TET-12`, `TET-19`, `TET-31`, `BP-13`, `Mixed-Base`, `tesla`.

```
[1].f * 2^(1/12)     # one 12-TET semitone above note 1
[1].f * 3^(1/13)     # one Bohlen-Pierce step (13 equal divisions of the 3:1 tritave)
[7].f * 2 ^ (-1/12) * 3 ^ (-1/13)    # Mixed-Base: two bases in one expression
```

Evaluated, every pitch of the three TET modules is irrational except the octaves, which are exactly rational, and none is approximate; `scripts/test-exact-values.mjs` checks this, and that writing each pitch back relative to `base.f` gives exactly the same values.

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — the stack VM
- [Dependency Graph](/developer/core/dependency-graph) — where the flags are stored and made transitive
- [Expression Syntax](/reference/expressions/syntax#approximate-numbers) — `~` for users
- [Equal Temperament](/user-guide/tuning/equal-temperament) — the user-facing guide
