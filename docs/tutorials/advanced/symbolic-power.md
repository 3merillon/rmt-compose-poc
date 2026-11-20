---
title: Understanding SymbolicPower
description: How RMT Compose keeps equal-temperament values exact - rational, irrational and approximate values, what hatching means, and why twelve semitones give exactly an octave.
---

# Understanding SymbolicPower

Equal temperament needs irrational numbers. `2^(1/12)` = 1.0594630943592953… cannot be written as a
fraction. RMT Compose does not turn it into one: it keeps the power **exactly** through evaluation.
This page shows what that means, what stays exact, and how to tell the three kinds of value apart.

**Prerequisites:** [Microtonal Composition](/tutorials/advanced/microtonal), or equivalent comfort
with `^` expressions.

::: tip Twelve semitones are exactly an octave
`2^(1/12)` multiplied by itself twelve times is exactly 2. With a base frequency of 263/4, twelve
12-TET steps give exactly 263/2, with no error to accumulate. The rest of this page explains why.
:::

## Three kinds of value

Every value the evaluator computes is one of three kinds.

| Kind | Meaning | Examples |
|---|---|---|
| **Rational** | An exact fraction | `3/2`, `263`, `1.5` (exactly 3/2) |
| **Irrational** | Exact, but not a fraction: a sum of rational multiples of powers | `2^(1/12)`, `263 * 2^(7/12)` |
| **Approximate** | A number that stands for a value it is not exactly | `~261.63` |

An irrational value is a relation, kept as the power it is. An approximate value is a measurement:
a rational number marked as not exact. The two are never confused.

## What stays exact

Powers are reduced to a canonical form, so equal values are always equal:

```
2^(1/12) * 2^(1/12)     # 2^(1/6): like bases merge
2^(13/12)               # 2 * 2^(1/12): the whole part leaves the exponent
4^(1/2)                 # exactly 2: a perfect root is rational
6^(1/2)                 # 2^(1/2) * 3^(1/2): bases are factored into primes
2^(12/12)               # exactly 2
```

Sums and products of such values stay exact, and so does dividing by a single power term. When no
power is left, the value becomes a fraction again. That is why twelve semitones are exactly 2, and
why `4^(1/2)` is a plain rational.

## What becomes approximate

A few operations cannot be kept exact. Their result is **approximate**, and it is flagged:

- dividing by a sum of irrational terms,
- a non-integer power of a sum,
- a value with more than 64 terms,
- a division by zero,
- an integer exponent above 65 536, or a result far beyond a million bits.

Anything computed from an approximate value is approximate as well, and it never equals an exact
value: `~1.5` is not `3/2`. You can also write an approximation yourself with `~`, as in `~261.63`;
see [Approximate numbers](/reference/expressions/syntax#approximate-numbers).

A plain decimal stays exact: `1.5` is exactly 3/2. Only `~` marks an approximation.

## What the hatching means

| Where | Own expression is tempered or approximate | Depends on a tempered or approximate note |
|---|---|---|
| Note rectangle | **Crosshatch** (two diagonals) | **Single diagonal** hatch |

The hatching means "tempered or approximate, not a pure ratio". A note whose own expression holds an
irrational power, a `~` number or a division by zero is crosshatched; a note that depends on one has
a single diagonal hatch. The app's internal name for this state is *corrupted*, but nothing is
damaged: every equal-tempered module is built from hatched notes.

The note widget's `Evaluated:` line says which kind of value you have:

| Kind | `Evaluated:` shows |
|---|---|
| Irrational | The exact form and its value: `(263/4) * 2^(1/4) = 78.190368…` |
| Approximate | `≈493.12500` |
| Rational | The fraction, also when a tempered chain lands on one: the 12-TET octave note shows `263/2` |

The `≈` sign means only "approximate". A very long exact fraction is still shortened for display,
with the full value in the tooltip; that affects the display only.

## Measuring the error: there is none

Base frequency 263 Hz:

| Expression | Evaluates to | Kind |
|---|---|---|
| `base.f * 2^(12/12)` | 526 | rational |
| `base.f * 4^(1/2)` | 526 | rational |
| `base.f * 2^(1/12) * 2^(1/12) * …` (×12) | exactly 526 | rational |
| `base.f * 2^(7/12)` | `263 * 2^(7/12)` = 394.05… | irrational |

Twelve chained semitones give the octave exactly, because the evaluator never rounds an irrational
power. Writing `2^(7/12)` or `2^(1/12)` seven times gives the same exact value.

Sound, drawing and MIDI export need a number, so they use the nearest double of the exact value,
computed from the powers directly. The exact value is never replaced by that number.

## What the simplifier does

Saving a variable runs the expression through a simplifier that merges like bases:

| You type | Saved as |
|---|---|
| `base.f + base.f` | `2 * base.f` |
| `2 * (1/2) * base.f` | `base.f` |
| `4^(1/2) * base.f` | `2 * base.f` |
| `base.f * 2^(1/12) * 2^(1/12)` | `base.f * 2^(1/6)` |

A rewrite is kept only if it evaluates to exactly the same value, with the same hatching. The
twelve-fold chain has the value `base.f * 2`, but rewriting it would remove the hatching from a note
whose expression holds powers, so the simplifier keeps what you wrote.

::: tip The app does not hide tempering
If you want a note that is not hatched, write `base.f * 2` or `base.f * 2^(12/12)`. If you write
twelve tempered steps, you keep them, hatching included, and the value is still exactly 2.
:::

## The ▲/▼ arrows and TET

The frequency row's arrows multiply by the interval configured in Settings → Arrows (default ×2 up,
×1/2 down). They **fold the factor into the expression's rational coefficient** rather than stacking
a new multiplier on the front:

| Before | After ▲ |
|---|---|
| `base.f` | `2 * base.f` |
| `(1/2) * base.f` | `base.f` |
| `base.f * 2^(7/12)` | `2 * base.f * 2^(7/12)` |
| `base.f * ~1.5` | `2 * base.f * ~1.5` |

The coefficient absorbs the ×2; the power term and the `~` are left as written. **A TET note stays
a TET note**, and up-then-down returns you to exactly what you wrote.

## Evaluate to BaseNote

Evaluate to BaseNote and Evaluate Module write the exact relation: a 12-TET fifth becomes
`base.f * 2^(7/12)`, an octave `base.f * 2`. They never write a fraction derived from a float. An
approximate value is written with `~`, for example `base.f * ~(14983/8000)`. Moving a note before its
parent re-anchors its frequency with the exact ratio (`2^(5/6) * [1].f`), with the same value.

## The value types, in the code

The evaluator's exact value types are described on the developer page
[Exact Values](/developer/core/symbolic-power). An irrational value is a sum of terms
`coefficient × base₁^exp₁ × base₂^exp₂ × …`, a **list** of power terms. That is what lets a value
carry a base-2 term and a base-3 term at once, which the shipped **Mixed-Base** scale needs:

```
[7].f * 2 ^ (-1/12) * 3 ^ (-1/13)
```

For the bytecode, see [Binary Evaluator](/developer/core/binary-evaluator).

## Different bases

Any positive integer base works.

```
2^(1/12)                # 12-TET step   - octave-based
3^(1/13)                # Bohlen-Pierce - tritave-based
5^(1/7)                 # a 5-based step, as used in Mixed-Base
```

### Twelve fifths, three ways

The circle of fifths is the cleanest demonstration. Base frequency 263 Hz; seven octaves up is
33664 Hz.

| Written as | Evaluates to | Kind |
|---|---|---|
| `base.f * 2^(84/12)` | 33664 | rational |
| `base.f * 2^(7/12) * 2^(7/12) * …` (×12) | exactly 33664 | rational |
| `base.f * (3/2)^12` | 34123.286865234375 | rational (and *not* an octave) |

Rows 1 and 2 agree exactly: twelve tempered fifths are seven octaves. Row 3 is twelve *pure* fifths,
which overshoots by the Pythagorean comma (531441/524288, about 23.5 cents).

Equal temperament exists to make rows 1 and 3 agree, by tempering each fifth slightly; the exact
evaluation means the tempering is the only difference.

## Debugging checklist

**Is this note a pure ratio?** Look at the rectangle. Clean means every value is an exact fraction.
Crosshatched means its own expression is tempered or approximate. Single-diagonal means it depends
on one that is.

**Is it irrational or approximate?** Read `Evaluated:`. An exact form with a value is irrational;
`≈` followed by a decimal is approximate; a fraction is rational.

**Is my chain exact?** It is, if it uses only powers, sums and products. Look for `~`, a division
by a sum of powers, or a non-integer power of a sum: these make the value approximate.

**Did my edit save?** The `Save` button next to the `Raw:` field only appears once you start typing,
and the value does not change until you press it. An invalid expression is rejected with its reason
shown in red under the Save button.

## Next

- [Microtonal Composition](/tutorials/advanced/microtonal) - put the temperaments to work
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) - how hatching spreads through a graph
- [Expression Compiler](/developer/core/expression-compiler) - text to bytecode
