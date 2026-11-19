# Phase C: exact irrationals and marked approximations

Design for review, 19 November 2026. No code is written until you approve it. Five decisions are yours; they are collected at the end, each with my recommendation.

## What you asked for

1. **Symbolic irrationals.** "The 'perfect' irrationality should be conserved in the composition", and evaluated only "at some point" for sound.
2. **Approximations as their own kind.** "We want to support floating point values (and should be considered basically the same as a fraction approximation), and of course fraction approximations for example imported ones should never silently pass as perfect harmonics."

These are two separate things. `2^(1/12)` is exact but irrational: it is a relation, not a measurement. `261.63` taken from a tuning table is a measurement: a rational number that stands for something it is not exactly.

## How it works today (v2)

- **The evaluator computes in fractions only.** Every value on the stack is a BigInt fraction. `OP.POW` (`src/binary-evaluator.js:1177`) already computes a symbolic `SymbolicPower` (`:58`, coefficient × product of base^exponent), but then flattens it to a rational approximation of the float (`2^(1/12)` becomes `2739815/2586041`). It also sets a flag saying "this evaluation was irrational".
- **The flag is called "corruption".** It is a bit per variable on the note (`corruptionFlags`), plus a "transitive" status computed from the dependency graph. The renderer draws a crosshatch for a direct one and a single diagonal for a transitive one; the widget shows ≈. A division by zero sets the same flag and evaluates to 1.
- **Consequences:**
  - Twelve steps of `2^(1/12)` give 131.4999999999982 instead of 131.5. You saw this in Phase B: Evaluate to BaseNote on the octave note of 12-TET changed it from that value to exactly 263/2.
  - The editor guesses irrationals back from floats in several places, and writes some guesses as if they were exact:
    - `detectTETInterval()` in `src/modals/index.js`;
    - the TET search in `rebuildFrequencyForAnchor()` in `src/player.js`;
    - its "last resort": `2^(round(12·log2 r)/12)`, an approximation written as an exact power;
    - its fallback: `new Fraction(ratio)` from a float, written as an exact ratio.
- **Typed decimals are exact as written.** `261.63` is 26163/100, unmarked. There is no way to write "approximately".
- **The rest of the app reads fractions.** About 150 `toNumber()` calls in 14 files turn evaluated Fractions into floats for drawing, sound and MIDI. `player.js` and `modals/` also do exact Fraction arithmetic on evaluated values (offsets in time units, ratios between notes).

## Proposal

### 1. One value type, three kinds

The evaluator computes with a `Value`, which has one of three kinds:

| Kind | Holds | Example |
|---|---|---|
| **rational** | an exact fraction (today's case) | `3/2`, `263` |
| **irrational** | an exact algebraic value, see below | `263 × 2^(7/12)` |
| **approximate** | a fraction that stands for a measured or rounded number | `~261.63` |

**Irrational form.** A sum of terms, where each term is a rational coefficient times a product of integer bases raised to rational exponents:

```
value = Σ  c_k × Π  b_i ^ e_i        c_k rational, b_i positive integers, e_i rational
```

It is kept canonical, so that equal values are equal structurally:

- like bases merge (`2^(1/12) × 2^(1/12) = 2^(1/6)`);
- the integer part of an exponent moves into the coefficient (`2^(13/12) = 2 × 2^(1/12)`);
- small bases are factored into primes, so `4^(1/2)` is 2 and `6^(1/2)` is `2^(1/2) × 3^(1/2)`. Trial division stops at a bound; a cofactor beyond it stays as an opaque base. That is still exact, but such values may not compare equal structurally.
- terms with the same radical part add up (`3 × 2^(1/2) + 2^(1/2) = 4 × 2^(1/2)`).

**What is closed, and what is not:**

| Operation | Result |
|---|---|
| × and ÷ by a single term | exact, always (the product stays one term) |
| rational power of a single term | exact: `(c × 2^(1/12))^(1/2)` raises the coefficient too. A coefficient too large to factor becomes an opaque base, still exact. |
| + and − | exact: terms merge or are appended |
| × of two sums | exact: distribute and merge. Capped at **64 terms**; beyond the cap the result is approximate (below). |
| ÷ by a sum of several terms, a non-integer power of a sum | **not closed**. The result is approximate, computed from a 128-bit evaluation and marked ≈. |

Single-term values are what music produces: every TET pitch, and every chain of tempered intervals. Sums appear only where irrational durations are added to times. A start chain of notes whose lengths are `base.d × 2^(k/12)` produces at most one term per distinct radical, so the cap is not reached in practice. The fallback means the cap and the unclosed cases never fail and never pass as exact.

**Approximate.** An approximate value holds a fraction (its best known value) and the mark. Any operation with an approximate operand gives an approximate result; approximation spreads like the ≈ flag does today. Exact and approximate never compare equal.

### 2. The written form of an approximation

Proposed: a **`~` before a number**, read "about":

```
~261.63            ~(2739815/2586041)            [1].f * ~1.4983
```

- It marks a **literal only**, not an expression. A measurement is a number; what is derived from it is approximate by propagation.
- The DSL keeps "no functions" (your decision in Phase A), so `approx(…)` is not an option. `~` is one ASCII character the lexer does not use today.
- The note widget shows approximate values with ≈, and the decompiler prints them back with `~`.

### 3. Where values become numbers

There is one boundary, `toNumber(value)`, extended to all three kinds. Only drawing, sound and MIDI cross it, at the moment they need a float:

- rational: as today;
- irrational: each term computed in floating point, `c × Π b^e`;
- approximate: its fraction.

To keep the ~150 existing readers working unchanged, **each evaluation record keeps a Fraction next to the exact value**:

- `record.frequency` stays a Fraction. It equals the value when rational, and is the nearest double for the other two kinds.
- `record.exact.frequency` is the `Value`, with its kind.

**The evaluator reads only `exact`**, so dependents are computed from the exact value and never from the shadow. This is the change that conserves irrationality "up to evaluation". New readers that need exactness use the exact value; existing readers that only draw or play are untouched. The readers that must move to it, because they rewrite expressions from values:

- Evaluate to BaseNote and Evaluate Module (`src/modals/index.js`);
- frequency re-anchoring after a move (`rebuildFrequencyAlgebraically`, `rebuildFrequencyForAnchor`, the ratio rebuild in `commitNoteStartGL`);
- the ▲/▼ arrows' value check (`src/utils/simplify.js`);
- the widget display (`src/modals/fraction-display.js`, `variable-controls.js`).

With the exact value available, the float guessing listed above is **deleted**. Evaluate to BaseNote writes the exact relation it reads, such as `base.f * 2^(7/12)` or `base.f * 3 * 2^(1/2)`. An approximate value is written with `~`.

**Comparisons.** Ordering (which note starts first, the end of the piece) uses exact equality first. If the values are not equal, it uses the sign of the float difference, and when that is within 1e-12 relative, a 128-bit fixed-point evaluation (`integerNthRoot`, already in the file). Ties are therefore exact, and ordering is never wrong because of rounding.

**Sound and MIDI** take `toNumber(exact)`. A TET frequency is then computed directly from its powers, not from a float-derived fraction. That is a difference of about 1e-13 relative, inaudible, but it is the honest value.

### 4. What is drawn

Today one flag means "irrational". In this design it splits into two per-variable flags, **irrational** and **approximate**, each also tracked transitively through the dependency graph, as now.

- **Irrational notes keep today's hatching.** It tells the composer "tempered, not a harmonic", which stays true, so the crosshatch and the diagonal keep their meanings. The widget shows the exact form with its value, for example `263 × 2^(7/12) = 394.04…`, without ≈, because it is exact.
- **Approximate notes** get ≈ in the widget. How they look on the canvas is your design (decision 3).
- **Division by zero** stays a reported error with value 1, as now. It is marked approximate rather than irrational, so it never passes as exact.

### 5. Importers and writers that must mark approximations

Every path that writes a number it did not derive exactly must write it with `~`:

- the Evaluate and re-anchor fallbacks above, where they remain, for example a division by a sum;
- the composer skill's `translate.mjs` and any future MIDI import, wherever a value comes from a table or a float rather than a chosen ratio;
- gesture code that builds `new Fraction(float)`. Today drags snap to sixteenths, an exact choice, so they stay exact. I will audit every `new Fraction(<float>)` and list each case in the implementation report.

### 6. Not affected

- The module format, apart from the new `~`.
- The relational-time and syntax converters.
- Saving: expressions are text.
- The WASM evaluator stays off. Phase D ports this value type to Rust, with a JS/WASM parity test over the library.

## Tests (each item in `npm test`)

- `[1].f * 2^(1/12)` chained twelve times evaluates to exactly `2 × [1].f`: the kind is rational, the fraction equal.
- All three TET modules: every pitch is irrational with the expected canonical form (`263/4 × 2^(k/12)` and so on). No expression contains a float-derived fraction after Evaluate Module. Nothing is approximate.
- `4^(1/2)` is rational 2, and `(2^(1/2))^2` is rational 2.
- `~1.5 * base.f` is approximate, and so is every dependent. `~1.5` never equals `3/2`.
- A sum of irrational durations stays exact. Past the 64-term cap, or after a division by a sum, the result is approximate.
- Ordering of nearly equal irrational starts is exact (the refinement).
- The Phase B oracle (88 modules, 7,301 values) and the relational-time oracle still pass. The only allowed differences are rational values previously stored as float-derived fractions of irrationals: those become exact, and I will list them.
- Performance against v2 HEAD, in back-to-back pairs: full evaluation of `comma-chain-400`, `voices-5000` and the TET modules, and a drag on 12-TET. Rational-only modules must not slow down: the rational kind keeps today's pooled-fraction fast path.

## Order of work, each on its own branch, `v2` fast-forwarded after each

1. **C1: the value type in the evaluator.** Records carry `exact`, POW stays symbolic, the `toNumber` boundary, comparisons, irrational/approximate flags, and the widget display. There is no new syntax yet. Tests and the browser check.
2. **C2: `~` and the writers.** Lexer, parser, compiler, decompiler; propagation; Evaluate and re-anchor from exact values; the float TET guessing deleted; the audit of `new Fraction(float)`.
3. **C3: docs and the skill.** `symbolic-power.md` rewritten (it describes the flattening), the fraction API, the syntax reference, the skill's `format.md` and `translate.mjs`.

**Cost:** C1 is the large part, comparable to Phase B. C2 and C3 are smaller. Phase L, the library rewrite, comes after: it will use `~` for any value taken from a table.

## Your decisions

1. **The syntax for an approximation.** I recommend **`~` before a number** (`~261.63`). Alternatives: `≈261.63` (hard to type), a suffix `261.63~`.
2. **Does a plain decimal stay exact?** I recommend **yes**: `131.5` is exactly 263/2, which is how the library uses it (the 12-TET BaseNote is the only decimal in the library), and how a composer means `1.5`. Only `~` marks an approximation. The alternative, every decimal approximate and exact values written as fractions, would make the library's `131.5` approximate, and typing `1.5` for a fifth would no longer give a pure fifth. Your words, a float should be "considered basically the same as a fraction approximation", could mean that alternative, so the choice is yours.
3. **How approximate notes look on the canvas.** Until you design it, I propose they use today's hatching (like irrational notes) plus ≈ in the widget, so nothing approximate looks pure. Irrational notes keep the hatching they have.
4. **The fallback for sums.** Exact sums of terms up to 64 terms. Division by a sum, a non-integer power of a sum, or more than 64 terms gives an approximate value marked ≈.
5. **Evaluate to BaseNote writes the exact relation** it reads from the value (`base.f * 2^(7/12)`), and the float-based TET detection is removed.
