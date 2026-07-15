---
title: Fraction API
description: How numbers work in RMT Compose expressions — exact rationals, literal forms, normalization, irrational results, and the legacy new Fraction() compatibility surface.
---

# Fraction API

Every number in an RMT Compose expression is an **exact rational** — a numerator over a
denominator, with no floating-point rounding. `(1/2) + (1/3)` is `5/6`, exactly, forever.
Rational arithmetic is what makes just intonation work: a 3:2 fifth stacked twelve times is a
number you can still reason about, not a drift of accumulated error.

::: info Expressions are not JavaScript
This page is named after [Fraction.js](https://github.com/rawify/Fraction.js), which supplies
the rational arithmetic underneath. It does **not** mean you can call Fraction.js methods in an
expression. Expression text is never `eval`'d and never executed — it is parsed by a small
compiler with a fixed grammar and turned into bytecode. Only what that grammar accepts works.
The grammar is on the [Syntax](/reference/expressions/syntax) page.
:::

## Writing numbers

There are three literal forms in the DSL.

| Form | Example | Value |
|---|---|---|
| Integer | `440` | 440/1 |
| Fraction literal | `(3/2)`, `(1/12)`, `(-5/4)` | Exact rational. The parentheses are part of the literal |
| Decimal | `0.5`, `1.5` | Converted to a fraction when you save |

```
440                    # 440 Hz
(3/2)                  # a perfect fifth
(5/4)                  # a major third
(-1/4)                 # negative quarter
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(440)      // 440/1
new Fraction(3, 2)     // 3/2
new Fraction(-1, 4)    // -1/4
```
</details>

### Fractions are normalized

Constants are reduced by their greatest common divisor and the sign is moved to the numerator
before storage.

| You type | It is stored as |
|---|---|
| `(6/4)` | `(3/2)` |
| `(123456789/987654321)` | `(13717421/109739369)` |
| `(3/-2)` | `(-3/2)` |

### Decimals become fractions

There are no floating-point values in a stored expression. A decimal is rationalized at compile
time, **exactly as written**: the digits become the numerator over the matching power of ten,
then the fraction is reduced.

| You type | It is stored as |
|---|---|
| `0.5` | `(1/2)` |
| `1.5` | `(3/2)` |
| `0.1` | `(1/10)` |
| `0.333333` | `(333333/1000000)` |
| `3.14159` | `(314159/100000)` |

::: tip Prefer fraction literals
A decimal can only spell a fraction whose denominator is a power of ten. `0.333333` is exactly
`(333333/1000000)` — not `(1/3)`, and no number of extra 3s will reach it. If you mean a third,
write `(1/3)`.
:::

### Large numbers

Constants are stored as 32-bit integers when both parts fit between −2 147 483 648 and
2 147 483 647, and are promoted to arbitrary-precision integers when they do not.
`(3000000000/7)` and `(1/3000000000)` both work.

::: tip Integer literals are exact at any size
A literal is parsed digit by digit into an arbitrary-precision integer — it never passes
through a float — so `9007199254740993` is stored as exactly `9007199254740993`, and a
hundred-digit numerator keeps all hundred digits. Arbitrary precision applies end to end:
the text you type, the stored constant, and every arithmetic result.
:::

## Exactness and irrationals

Addition, subtraction, multiplication and division are closed over the rationals: they can
never produce a value that is not an exact fraction. Only one operator can.

`^` with a fractional exponent produces an irrational number unless the root happens to be
exact:

| Expression | Result | Exact? |
|---|---|---|
| `2^3` | 8 | Yes |
| `2^(-1)` | 1/2 | Yes |
| `4^(1/2)` | 2 | Yes — a perfect square root |
| `8^(1/3)` | 2 | Yes — a perfect cube root |
| `2^(1/12)` | ≈ 1.059463… | **No** |
| `3^(1/13)` | ≈ 1.088182… | **No** |

When a property's value comes out irrational it is flagged **corrupted**. The value is stored as
the closest rational approximation, the note is drawn with a crosshatch, and the note widget
prefixes the value with **`≈`**. A note that only *depends* on a corrupted note is drawn with a
single diagonal hatch and also shows `≈`.

Exact exponentiation is also capped for safety: an integer exponent above **65536**, or a result
that would exceed roughly a megabit per component, is treated the same way — flagged and
approximated rather than computed exactly. See [Operators](/reference/expressions/operators#power).

This is how every equal-tempered scale in the module library is built. It is a marker, not a
fault. See [Operators](/reference/expressions/operators) and
[SymbolicPower](/developer/core/symbolic-power).

The simplifier will merge like bases when it can: `2^(1/12) * 2^(1/12)` becomes `2^(1/6)`, and
`4^(1/2)` folds all the way down to the rational `2`. A rewrite is never applied if it would
change whether the value is corrupted.

## Common patterns

### Frequency ratios

```
base.f * (3/2)         # a perfect fifth above the BaseNote
base.f * 2             # an octave above
base.f / (4/3)         # a perfect fourth below
[1].f * (5/4)          # a major third above note 1
```

### Beat durations

```
beat(base)             # one beat at the base tempo
beat(base) * 2         # two beats
beat(base) * (1/2)     # half a beat
beat(base) * (3/2)     # a dotted beat
```

`beat(base) * (n/d)` is exactly what the note-length buttons in the note widget write.

### Sequential timing

```
[7].t + [7].d          # start the instant note 7 ends
```

Note ids must be literal integers — there is no `[prev]`.

## The legacy `new Fraction()` surface

Modules saved before the DSL existed use a JavaScript-shaped method chain. They still load, and
they still compile to the same bytecode. You do not need to write this format, and the note
widget will convert it to DSL the moment you look at it — but if you are reading an old file,
this is what it means.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Perfect fifth above the BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Octave above
module.baseNote.getVariable('frequency').mul(new Fraction(2))

// Perfect fourth below
module.baseNote.getVariable('frequency').div(new Fraction(4, 3))

// One beat
new Fraction(60).div(module.findTempo(module.baseNote))

// Two beats
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Start when note 7 ends
module.getNoteById(7).getVariable('startTime')
  .add(module.getNoteById(7).getVariable('duration'))

// 12-TET semitone
new Fraction(2).pow(new Fraction(1, 12))
```
</details>

### Exactly what the legacy parser accepts

| Construct | Accepted |
|---|---|
| `new Fraction(n)` | Yes |
| `new Fraction(n, d)` | Yes |
| `.mul(…)` `.div(…)` | Yes |
| `.add(…)` `.sub(…)` | Yes |
| `.pow(…)` | Yes |
| `module.baseNote.getVariable('name')` | Yes |
| `module.getNoteById(N).getVariable('name')` | Yes |
| `module.findTempo(ref)` | Yes |
| `module.findMeasureLength(ref)` | Yes |

That is the whole list.

### What it does not accept

::: warning These are rejected with an error
The following are real Fraction.js methods, so they look like they should work. **They do not.**
The legacy parser does not recognize them, and after the DSL retry fails too the compiler throws
— the note widget shows the message under the Save button, and on a file load the property is
left unset with a `console.error`.

| Not accepted |
|---|
| `.neg()` |
| `.abs()` |
| `.inverse()` |
| `.mod()` |
| `.equals()`, `.compare()` |
| `.valueOf()`, `.toString()`, `.toFraction()` |
| `.n`, `.d`, `.s` (property access) |
| String arguments, e.g. `new Fraction("355", "113")` |

Write `-5` (DSL) or `new Fraction(-5)` (legacy) instead of a negation call. Everything else on
that list has no expression-language equivalent — comparisons, string conversion and modulo are
not part of the language in either format.
:::

### Migration table

| Legacy | DSL |
|---|---|
| `new Fraction(440)` | `440` |
| `new Fraction(3, 2)` | `(3/2)` |
| `a.add(b)` | `a + b` |
| `a.sub(b)` | `a - b` |
| `a.mul(b)` | `a * b` |
| `a.div(b)` | `a / b` |
| `a.pow(b)` | `a ^ b` |
| `new Fraction(5).neg()` | `-5` |
| `module.baseNote.getVariable('frequency')` | `base.f` |
| `module.getNoteById(1).getVariable('startTime')` | `[1].t` |
| `module.findTempo(module.baseNote)` | `tempo(base)` |
| `module.findMeasureLength(module.baseNote)` | `measure(base)` |
| `new Fraction(60).div(module.findTempo(module.baseNote))` | `beat(base)` |

One thing, and one thing only, rewrites a legacy expression as DSL: pressing **Save** in the
note widget. The `Raw:` field is already showing you the DSL, so saving it stores the DSL.

Everything else preserves the format it found. A drag, a resize, or a frequency arrow rewrites
the expression *in its existing format* — touch a legacy note in the workspace and what gets
written back is legacy. Exporting a module writes each expression exactly as it is currently
stored, so a legacy expression you never save through the widget stays legacy in the file. It
still loads, and it still works.

## See also

- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Operators](/reference/expressions/operators) — what each operator produces
- [Module API](/reference/expressions/module-api) — references and built-in functions
- [SymbolicPower](/developer/core/symbolic-power) — how irrational values are handled
