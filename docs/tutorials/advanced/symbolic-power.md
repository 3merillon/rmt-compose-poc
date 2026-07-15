---
title: Understanding SymbolicPower
description: What "exact" means in RMT Compose - which powers resolve exactly, which are approximated and flagged, and how much error a chain of TET steps accumulates.
---

# Understanding SymbolicPower

Equal temperament produces irrational numbers. `2^(1/12)` = 1.0594630943592953… cannot be written
as a fraction. This page shows you exactly what RMT Compose does with such a value — where it is
exact, where it is not, and how to tell which you are looking at.

**Prerequisites:** [Microtonal Composition](/tutorials/advanced/microtonal), or equivalent comfort
with `^` expressions.

::: danger Read this before you rely on exactness
The headline you may have heard — *"chain twelve semitones and you get a perfect octave"* — is
**not true** on the evaluator that ships. It is true for `2^(12/12)`. It is false for
`2^(1/12) * 2^(1/12) * … ` twelve times. The rest of this page explains the difference, because the
difference is the whole story.
:::

## Two kinds of power

The `^` operator hands its result to a rational-power check before anything else. That check has
two ways to succeed.

**1. The exponent resolves to an integer.**

```
2^(12/12)               # 12/12 = 1  ->  exactly 2
2^3                     # exactly 8
2^(-1)                  # exactly 1/2
```

**2. The result is a perfect n-th root.**

```
4^(1/2)                 # exactly 2
8^(1/3)                 # exactly 2
```

In both cases you get an exact rational. The note is **not** flagged, **not** hatched, and its
`Evaluated:` line shows a plain value with no `≈`.

**Everything else is irrational**, and irrational is where the guarantees stop:

```
2^(1/12)                # irrational
3^(1/13)                # irrational
2^(7/12)                # irrational
```

When `^` yields an irrational, the evaluator does one thing: it converts the result to an
**approximating fraction** and sets a corruption flag on the property. There is no symbolic value
sitting on the stack afterwards. The approximation *is* the value from that point on.

## What corruption looks like

| Where | Directly corrupted | Transitively corrupted |
|---|---|---|
| Note rectangle | **Crosshatch** (two diagonals) | **Single diagonal** hatch |
| Note widget `Evaluated:` | `≈<value>`, italic amber | `≈<value>`, italic amber |

"Directly corrupted" means this note's own expression produced the irrational.
"Transitively corrupted" means it inherited one from something it references. Both show `≈`; only
the hatching distinguishes them.

The flag propagates: give note 1 a TET frequency, write note 2 as `[1].f * (3/2)`, and note 2 is
hatched too — its value is rational arithmetic performed on an approximation.

## How much error, exactly

This is measurable, so measure it. Base frequency 263 Hz:

| Expression | Evaluates to | Exact? | Flagged? |
|---|---|---|---|
| `base.f * 2^(12/12)` | 526 | yes — exactly | no |
| `base.f * 4^(1/2)` | 526 | yes — exactly | no |
| `base.f * 2^(1/12) * 2^(1/12) * …` (×12) | 525.999999999985675 | **no** | yes |
| `base.f * 2^(1/12)` | 278.6387938165… | no | yes |

Twelve chained semitones land **1.4 × 10⁻¹¹ short** of the octave. Each `^` rounds once, and twelve
roundings accumulate. It is a small error and it will never be audible — but it is an error, and a
page that promises "no drift" is lying to you.

The lesson is not "avoid TET". It is: **write the power you mean.** `2^(7/12)` rounds once.
`2^(1/12)` seven times rounds seven times. Prefer the closed form.

## What the simplifier does — and refuses to do

Saving a variable runs the expression through a simplifier. It has real symbolic algebra in it, and
it does merge like bases:

| You type | Saved as |
|---|---|
| `base.f + base.f` | `2 * base.f` |
| `2 * (1/2) * base.f` | `base.f` |
| `4^(1/2) * base.f` | `2 * base.f` |
| `base.f * 2^(1/12) * 2^(1/12)` | `base.f * 2^(1/6)` |

So `2^(1/12) × 2^(1/12) = 2^(1/6)` — the like-base merge — is real. It happens **at save time**, in
the simplifier, not during evaluation.

But now try the twelve-fold chain. The simplifier *can* fold it to `base.f * 2`… and then throws
that result away and keeps what you wrote.

Why: a rewrite is rejected if it **flips the corruption flag**. The chain is irrational (hatched);
`base.f * 2` is rational (clean). Silently swapping one for the other would repaint your note and
quietly change what the app is telling you about the value. So the simplifier declines.

::: tip This is a feature, not a bug
The app will not launder an approximation into an exact value behind your back. If you want the
exact octave, write `base.f * 2` or `base.f * 2^(12/12)` and get a clean note. If you write twelve
irrational steps, you keep twelve irrational steps — hatching and all.
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

Note the third row. The coefficient absorbs the ×2; the power term is left alone. **A TET note stays
a TET note** — the arrows will never quietly rationalise it, and up-then-down returns you to exactly
`base.f` rather than `(1/2) * 2 * base.f`.

## SymbolicPower, the class

The name on this page comes from a class in the evaluator. Its real shape is:

```javascript
class SymbolicPower {
  coefficient  // Fraction
  powers       // Array<{ base: number, exp: Fraction }>
}
```

It models `coefficient × base₁^exp₁ × base₂^exp₂ × … × baseₙ^expₙ` — a **list** of power terms, not a
single base/exponent pair. That is what lets a value carry a base-2 term and a base-3 term at once,
which is what the shipped **Mixed-Base** scale needs:

```
[7].f * 2 ^ (-1/12) * 3 ^ (-1/13)
```

::: warning The class is not what evaluates your notes
On the evaluator that ships, the stack holds plain rational fractions. `^` reaches
`SymbolicPower`, gets an irrational back, and immediately approximates it to a `Fraction`. The
like-base merging the class advertises is performed by the **simplifier** at save time, not by the
evaluator at run time.

A statement like "the evaluator preserves symbolic form end to end" is false. Do not build on it.
:::

For the class internals and the bytecode, see
[SymbolicPower (developer)](/developer/core/symbolic-power) and
[Binary Evaluator](/developer/core/binary-evaluator).

## Different bases

Any positive integer base works.

```
2^(1/12)                # 12-TET step   — octave-based
3^(1/13)                # Bohlen-Pierce — tritave-based
5^(1/7)                 # a 5-based step, as used in Mixed-Base
```

### Twelve fifths, three ways

The circle of fifths is the cleanest demonstration of everything above. Base frequency 263 Hz;
seven octaves up is 33664 Hz.

| Written as | Evaluates to | Exact? | Flagged? |
|---|---|---|---|
| `base.f * 2^(84/12)` | 33664 | yes | no |
| `base.f * 2^(7/12) * 2^(7/12) * …` (×12) | 33663.999999999163265 | **no** | yes |
| `base.f * (3/2)^12` | 34123.286865234375 | yes (and *not* an octave) | no |

Row 1 is the closed form: `84/12` reduces to the integer 7, so the power resolves exactly and the
note is clean. Row 2 is the same music written as twelve separate irrational steps — twelve
roundings, drifting 8 × 10⁻¹⁰ off, permanently hatched. Row 3 is twelve *pure* fifths, which is
exact rational arithmetic that simply does not land on an octave: it overshoots by the Pythagorean
comma (531441/524288, about 23.5 cents).

Three different answers, and all three are correct — they are answers to three different questions.
Equal temperament exists to make rows 1 and 3 agree; the evaluator's rounding is what separates
rows 1 and 2.

## Debugging checklist

**Is this note exact?** Look at the rectangle. Clean = exact rational. Crosshatched = its own
expression produced an irrational. Single-diagonal = it inherited one.

**Did my power resolve?** Write it and read `Evaluated:`. No `≈` means the rational-power check
succeeded and you have an exact value.

**Is my chain drifting?** Replace `2^(1/12)` repeated `k` times with a single `2^(k/12)`. One
rounding instead of `k`.

**Did my edit save?** The `Save` button next to the `Raw:` field only appears once you start typing,
and the value does not change until you press it. An invalid expression is rejected with its reason
shown in red under the Save button.

## Next

- [Microtonal Composition](/tutorials/advanced/microtonal) — put the temperaments to work
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) — how corruption spreads through a graph
- [Expression Compiler](/developer/core/expression-compiler) — text to bytecode
