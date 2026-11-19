---
title: Expression Syntax
description: The complete grammar of the RMT Compose expression DSL — tokens, literals, references, operators, precedence, the removed beat/tempo/measure forms, and error behaviour.
---

# Expression Syntax

A note has six variables, and each is stored as a **text expression**. The expression is compiled to
bytecode and evaluated with exact rational arithmetic. They fall in two groups:

| Group | Variables | What they are |
|---|---|---|
| **The language** | `f` frequency, `t` startTime, `d` duration | The notation. Each relates the note to other notes, and the BaseNote holds the only absolute values. |
| **Interpretation** | `a` amplitude, `attack`, `release` | How the note sounds. Not part of the notation; the only variables that fall back to the BaseNote when unset. |

This page is the complete grammar of the **DSL**:

```
base.f * (3/2)          # perfect fifth above the BaseNote
[1].t + [1].d           # starts when note 1 ends
base.d * (1/2)          # half a time unit long
2^(7/12)                # the 12-TET fifth ratio
```

The DSL has **no functions**. Where a length is needed, `base.d` is the idiom: the BaseNote's
duration is the time unit, one beat if you count in beats.

The method-chain syntax of earlier versions is retired; see
[The retired method-chain syntax](#the-retired-method-chain-syntax).

## Where you type an expression

Open the note widget, find the property row, and type into its **`Raw:`** field. A **`Save`**
button appears as soon as you type. Nothing changes until you press it.

![The note widget with a variable row expanded, showing the Evaluated: readout and the Raw: expression field with its Save button](/img/note-widget.png)

The **`Evaluated:`** line above it is read-only — it shows the value the expression currently
produces.

## Lexical structure

### Whitespace

Spaces, tabs, and newlines are insignificant. `base.f*(3/2)` and `base.f * (3/2)` compile
identically.

### Comments

`#` starts a comment that runs to the end of the line.

```
base.f * (3/2)   # perfect fifth
```

::: warning Comments are dropped on save
Comments are skipped by the lexer and are not stored. `base.f # fifth` is saved as `base.f`,
and the comment is gone the next time you open the widget.
:::

`//` is **not** a comment. `/` is the division operator, so `// comment` is a syntax error.

### Tokens

| Token | Characters |
|---|---|
| Number | `0`–`9`, optionally with a single `.` and more digits (`440`, `1.5`) |
| Operators | `+` `-` `*` `/` `^` |
| Delimiters | `(` `)` `[` `]` `.` |
| Keyword | `base` |
| Identifier | letter or `_`, then letters, digits, or `_` — used for property names |

Any other character is a lexer error: `Unknown character '&' at column 3`.

## Literals

| Form | Example | Value |
|---|---|---|
| Integer | `440` | 440/1 |
| Fraction literal | `(3/2)`, `(1/12)`, `(-5/4)` | Exact rational. The parentheses are **part of the literal** |
| Decimal | `0.5`, `1.5`, `3.14159` | Converted to a fraction at compile time |
| Negation | `-2`, `-base.f` | Prefix minus |

### Fraction literals versus grouping

Parentheses containing exactly `integer / integer` are a **fraction literal**. Parentheses
containing anything else are an ordinary **grouped expression**.

```
(3/2)           # fraction literal: 3/2
(1 + 2)         # grouped expression: 3
(base.f / 2)    # grouped expression
```

Both forms are accepted anywhere a value is accepted, so the distinction rarely matters. It
does matter for how the expression is stored: a fraction literal compiles to a single constant.

### Decimals are rationalized

There are no floating-point values in an expression. A decimal is converted to a fraction when
you save it, and it is the fraction that is stored. The conversion is **exact as written**: the
digits become the numerator over the matching power of ten, and the result is reduced.

| You type | It is stored as |
|---|---|
| `0.5` | `(1/2)` |
| `1.5` | `(3/2)` |
| `0.1` | `(1/10)` |
| `0.333333` | `(333333/1000000)` |
| `3.14159` | `(314159/100000)` |

::: tip Write the fraction you mean
A decimal can only ever spell a fraction whose denominator is a power of ten. `0.333333` is
exactly `(333333/1000000)` — close to a third, but not `(1/3)`, and no number of extra 3s will
get there. Use a fraction literal for any value that is not a terminating decimal.
:::

## Note references

| Form | Meaning |
|---|---|
| `[N].prop` | Property `prop` of note N |
| `base.prop` | Property of the BaseNote |
| `[0].prop` | The BaseNote. Note id 0 **is** the BaseNote |

`N` must be a literal integer between **0 and 65535** — the range a module's ids can occupy.
Anything outside it is rejected when the expression compiles
(`Note IDs must be integers between 0 and 65535`). There is no `[prev]`, no arithmetic inside
the brackets, and no variables.

Saving rewrites `[0]` to `base`: `[0].d` is saved as `base.d`.

Referencing another note's property creates a **dependency**. See
[Dependencies](/user-guide/notes/dependencies).

### Property names

Every property has a canonical name and one or more accepted spellings.

| Group | Property | Accepted spellings | Saved as |
|---|---|---|---|
| Language | frequency | `f`, `freq`, `frequency` | `f` |
| Language | startTime | `t`, `s`, `start`, `startTime` | `t` |
| Language | duration | `d`, `dur`, `duration` | `d` |
| Interpretation | amplitude | `a`, `amp`, `amplitude` | `a` |
| Interpretation | attack | `attack`, `atk` | `attack` |
| Interpretation | release | `release`, `rel` | `release` |

Aliases are normalized when the expression is saved: type `base.freq`, and it comes back as
`base.f`; type `[2].atk`, and it comes back as `[2].attack`.

`attack` and `release` are shares of the note's own duration, between 0 and 1: see
[attack and release](/reference/properties/attack-release).

Anything else is an error:

```
[1].x           # Unknown property 'x'. Valid properties: f (frequency), t (startTime),
                #   d (duration), a (amplitude), attack, release
[1].pitch       # same
base.l          # same — there is no `l` alias for duration
```

### What a reference resolves to

`amplitude`, `attack` and `release` — the interpretation variables, and only they — **fall back to the
BaseNote** when the referenced note does not define them. `[5].a` on a note with no amplitude of its
own gives you the BaseNote's.

`startTime`, `duration` and `frequency` do not inherit. If a reference cannot be resolved at all —
for example it points at a note that no longer exists — evaluation does not fail. It substitutes a
fixed default and carries on. For the three inheriting variables the BaseNote is still consulted
first; the default is what is left when the BaseNote does not define the variable either:

| Property | Default when unresolvable |
|---|---|
| startTime | 0 |
| duration | 1 |
| frequency | 440 |
| amplitude | 1 |
| attack | 0 |
| release | 0 |

(An unset `attack` or `release` that is not read through a reference plays as the instrument's own
envelope; the 0 above is only the stand-in value for an unresolvable reference.)

## There are no functions

The language has no functions. Every expression is made of numbers, note references, operators and
parentheses. Four forms that older versions accepted are refused, each with a message naming the
replacement:

| You type | The message |
|---|---|
| `beat(base)` | `'beat()' was removed: the reference note's duration is the time unit, so write base.d for beat(base), or [N].d to relate to note N` |
| `measure([1])` | `'measure()' was removed: a measure bar is a silent note with a duration, so write [N].d for measure([N])` |
| `tempo(base)` | `'tempo()' was removed: tempo is no longer stored; durations relate to other durations (base.d is the time unit, 60 / base.d the tempo)` |
| `base.tempo`, `[1].bpm`, `[1].ml` (also `beatsPerMeasure`, `measureLength`) | `'.tempo' was removed: tempo, beats per measure and measure length are no longer stored. Relate durations instead (base.d is the time unit; a measure bar's length is its .d)` |

Each is followed by `(at column N)`. Any other name followed by `(`, such as `min(1)` or
`instrument(base)`, fails as `Unexpected 'min', expected expression`.

The translations:

| Old | New |
|---|---|
| `beat(base)`, `beat([N])` | `base.d` |
| `beat(base) * (1/2)` | `base.d * (1/2)` |
| `measure([N])`, on a measure bar | `[N].d` |
| a tempo T | `base.d = 60/T` (see [the time unit](/reference/properties/duration#the-time-unit)) |
| beats per measure B | a measure bar of `base.d * B` (see [Measure bars](/reference/module-schema#measure-bars)) |

Modules saved in the old form are converted exactly when they load.

```
base.d                  # one time unit
base.d * 2              # two
base.d * (1/2)          # half of one
[5].d                   # as long as note 5, or one measure, if note 5 is a bar
```

`base.d * (n/d)` is what the note-length buttons in the note widget write for you.

## Operators

| Operator | Meaning |
|---|---|
| `+` | Addition |
| `-` | Subtraction |
| `*` | Multiplication |
| `/` | Division |
| `^` | Power |
| `-` (prefix) | Negation |

### Precedence and associativity

Listed loosest to tightest. Tighter binds first.

| Level | Operators | Associativity |
|---|---|---|
| 1 | `+` `-` (binary) | Left |
| 2 | `*` `/` | Left |
| 3 | `-` (prefix) | Prefix |
| 4 | `^` | **Right** |
| 5 | Literals, `[N].p`, `base.p`, `( … )` | — |

Consequences worth knowing:

```
[1].f * 2^(1/12)     # = [1].f * (2^(1/12))   — ^ binds tighter than *
-2^2                 # = -(2^2) = -4          — ^ binds tighter than unary -
2^3^2                # = 2^(3^2) = 512        — ^ is right-associative
2^-1                 # = 1/2                  — a unary minus is allowed in the exponent
2 * 3 + 4            # = 10
```

Use parentheses when you want a different order. Full per-operator semantics, including what a
fractional exponent produces, are in [Operators](/reference/expressions/operators).

## Grammar

```
expression     -> additive
additive       -> multiplicative (('+' | '-') multiplicative)*
multiplicative -> unary (('*' | '/') unary)*
unary          -> '-' unary | power
power          -> primary ('^' unary)?
primary        -> fraction | noteRef | '(' expression ')' | number
fraction       -> '(' number '/' number ')'
noteRef        -> '[' number ']' '.' property | 'base' '.' property
```

There is no call syntax.

## Expressions the app writes for you

Dragging a note, resizing it, pressing the ▲/▼ frequency arrows, and creating a note all
rewrite the affected expression. The rewritten expression is DSL.

The frequency arrows are worth a note: they **fold the interval into the expression's existing
coefficient** rather than prepending a new multiplier. Stepping up and then back down returns
you to exactly `base.f`, not `(1/2) * 2 * base.f`. A power term is never absorbed into the
coefficient, so a TET note stays TET.

| Before | After ▲ (default interval ×2) |
|---|---|
| `base.f` | `2 * base.f` |
| `(1/2) * base.f` | `base.f` |
| `base.f * 2^(7/12)` | `2 * base.f * 2^(7/12)` |

## What happens when you save

Saving runs the expression through a simplifier that puts it in a canonical form. The rewrite
is applied only if it evaluates to the same value **and** does not change whether the value is
irrational; otherwise your original text is kept.

| You type | It is saved as |
|---|---|
| `2 * (1/2) * base.f` | `base.f` |
| `base.f + base.f` | `2 * base.f` |
| `4^(1/2) * base.f` | `2 * base.f` (a perfect root folds to a rational) |
| `2^(1/12) * 2^(1/12) * base.f` | `2^(1/6) * base.f` (like bases merge; still irrational) |
| `2 * base.f * 2^(7/12)` | unchanged (a coefficient never migrates into a power) |

## Errors

### What the validator rejects

When you press **Save**, the expression is checked. These are rejected and the note is left
unchanged:

| Condition | Example |
|---|---|
| Empty expression | `` |
| Unknown property | `[1].x`, `base.l` |
| A removed function or property | `beat(base)`, `base.tempo` |
| Unknown character | `a & b` |
| Missing property after `.` | `base.` |
| Incomplete expression | `1 +` |
| Unclosed bracket | `([1].d + 1` |
| Self-reference | `[5].f * 2` as note 5's frequency |
| Circular dependency | note 1's frequency reads `[2].f` while note 2's frequency reads `[1].f` |

The last two are judged per property. `[5].d * 2` as note 5's start time is accepted, and so are
two notes that read each other through different properties.

A rejected expression shows its reason **inline in the widget** — in red under the `Save` button,
with a red border on the field. The note keeps its old value. The message is specific, for
example `Unknown property 'x'. Valid properties: f (frequency), t (startTime), d (duration),
a (amplitude), attack, release (at column 5)`.

### What is *not* an error

Two things that look like errors are not.

**Division by zero.** `(5/0)` is accepted. It is not read as a fraction literal — it falls back
to a grouped division, and at evaluation time a division by zero yields **1** with a console
warning. The property is additionally **marked corrupted**, so the note crosshatches on the
canvas the same way an irrational power does.

**An unresolvable reference.** See the defaults table above. Evaluation degrades rather than
failing.

An expression the compiler **cannot parse**, on the other hand, *is* an error: the compiler
logs a `console.error` and throws, the validators return `valid: false`, and a typo like `[1]f`
(the dot is missing) is refused with a message instead of silently zeroing the note. On a file
load the affected property is left unset.

## The retired method-chain syntax

Earlier versions also accepted a JavaScript-like method-chain syntax, for example
`module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))`, which is `[3].f * (3/2)`
in the DSL. That syntax is no longer compiled.

- **Typed now, it is refused.** In the note widget or any other expression field, the message is
  "The method-chain syntax was retired; write expressions in the DSL, e.g. [3].f * (3/2)." When the
  text can be converted, a last sentence gives its DSL form, for example "In the DSL this reads:
  base.f * (3/2)".
- **Old modules still open.** Module files, saved modules and autosaved modules written in the old
  syntax are converted to the DSL once, when the module is loaded, and the module is then saved in
  the DSL. The conversion is exact: each converted expression has the same exact fraction as
  before, which a test checks against values recorded with the old compiler.
- **A few chains are refused instead of guessed.** The old compiler did not read some chains as
  they were written: a `.mul()` or `.div()` after an `.add()` or `.sub()`, a `.pow()` after a
  `.mul()` or after another `.pow()`, and any `.neg()`. A module containing one does not load, and
  the message names the note and the variable so you can rewrite that expression in the DSL.
- **Converting files on disk.** Run `node scripts/migrate-modules.mjs <file-or-folder>` from the
  repository root. It converts the files in place, and also applies the earlier conversion of
  tempo, beats per measure and measure length to relations of `base.d`.

Examples of the conversion:

| Method chain | DSL |
|---|---|
| `module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))` | `[3].f * (3/2)` |
| `module.baseNote.getVariable('duration')` | `base.d` |
| `new Fraction(2).pow(new Fraction(1, 12)).mul(module.baseNote.getVariable('frequency'))` | `2^(1/12) * base.f` |
| `new Fraction(0.25)` | `(1/4)` |

## See also

- [Operators](/reference/expressions/operators) — per-operator semantics and result types
- [Module API](/reference/expressions/module-api) — references and the six properties
- [Fraction API](/reference/expressions/fraction-api) — exact numbers
- [Module JSON Schema](/reference/module-schema) — how expressions are stored in a file
- [Dependencies](/user-guide/notes/dependencies) — what a reference does to the graph
