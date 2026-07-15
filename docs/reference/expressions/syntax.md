---
title: Expression Syntax
description: The complete grammar of the RMT Compose expression DSL — tokens, literals, references, built-in functions, operators, precedence, and error behaviour.
---

# Expression Syntax

Every note property in RMT Compose — `startTime`, `duration`, `frequency`, `tempo`,
`beatsPerMeasure`, `measureLength` — is stored as a **text expression**. The expression is
compiled to bytecode and evaluated with exact rational arithmetic.

This page is the complete grammar. The modern format is the **DSL**:

```
base.f * (3/2)          # perfect fifth above the BaseNote
[1].t + [1].d           # starts when note 1 ends
beat(base) * (1/2)      # half a beat long
2^(7/12)                # the 12-TET fifth ratio
```

An older **legacy** method-chain format still loads and still compiles. It is covered in
[Fraction API](/reference/expressions/fraction-api) and
[Module API](/reference/expressions/module-api). You never have to write it: the note widget
displays every expression as DSL, whatever format it was stored in, and pressing **Save** in
the widget stores that DSL.

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
| Identifier | letter or `_`, then letters, digits, or `_` — used for property names and function names |

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
you save it, and it is the fraction that is stored. Simple decimals convert to the fraction you
expect; others are approximated (largest denominator 10 000).

| You type | It is stored as |
|---|---|
| `0.5` | `(1/2)` |
| `1.5` | `(3/2)` |
| `0.1` | `(1/10)` |
| `0.333333` | `(1/3)` |
| `3.14159` | `(9563/3044)` |

::: tip Write the fraction you mean
`(1/3)` is exactly one third. `0.333333` happens to land on `(1/3)` because it is in the
lookup table of common decimals — but `3.14159` becomes `(9563/3044)`, which is not what most
people expect. Use fraction literals for anything that has to be exact.
:::

## Note references

| Form | Meaning |
|---|---|
| `[N].prop` | Property `prop` of note N |
| `base.prop` | Property of the BaseNote |
| `[0].prop` | The BaseNote. Note id 0 **is** the BaseNote |

`N` must be a literal non-negative integer. There is no `[prev]`, no arithmetic inside the
brackets, and no variables.

The `[0]` rewrite happens everywhere a note id is accepted, including inside function
arguments: `measure([0])` is `measure(base)`, and `beat([0])` is `beat(base)`.

Referencing another note's property creates a **dependency**. See
[Dependencies](/user-guide/notes/dependencies).

### Property names

Every property has a canonical name and one or more accepted spellings.

| Property | Accepted spellings | Saved as |
|---|---|---|
| frequency | `f`, `freq`, `frequency` | `f` |
| startTime | `t`, `s`, `start`, `startTime` | `t` |
| duration | `d`, `dur`, `duration` | `d` |
| tempo | `tempo` | `tempo` |
| beatsPerMeasure | `bpm`, `beatsPerMeasure` | `bpm` |
| measureLength | `ml`, `measureLength` | `ml` |

Aliases are normalized when the expression is saved: type `base.freq`, and it comes back as
`base.f`.

Anything else is an error:

```
[1].x           # Unknown property 'x'. Valid properties: f (frequency), t (startTime),
                #   d (duration), tempo, bpm, ml
[1].pitch       # same
base.l          # same — there is no `l` alias for duration
```

### What a reference resolves to

`tempo`, `beatsPerMeasure` and `measureLength` **fall back to the BaseNote** when the
referenced note does not define them. `[5].tempo` on a note with no tempo of its own gives you
the BaseNote's tempo.

`startTime`, `duration` and `frequency` do not inherit. If a reference cannot be resolved at
all — for example it points at a note that no longer exists — evaluation does not fail. It
substitutes a fixed default and carries on:

| Property | Default when unresolvable |
|---|---|
| startTime | 0 |
| duration | 1 |
| frequency | 440 |
| tempo | 60 |
| beatsPerMeasure | 4 |
| measureLength | 4 |

## Built-in functions

There are exactly three, each takes exactly one argument, and that argument must be a **bare
note reference** — `[N]` or `base`. It cannot be an expression.

| Call | Returns |
|---|---|
| `tempo(x)` | The tempo of `x`, in BPM |
| `measure(x)` | The measure length of `x`, in seconds |
| `beat(x)` | One beat of `x`, in seconds — that is, `60 / tempo(x)` |

```
beat(base)              # one beat at the base tempo
beat(base) * 2          # two beats
beat(base) * (1/2)      # half a beat
measure([5])            # one measure of note 5
```

`beat(base) * (n/d)` is what the note-length buttons in the note widget write for you.

::: warning Helper arguments cannot be expressions
`beat([1].t)` and `tempo(base.f)` are syntax errors. Only `beat([1])`, `beat(base)`,
`tempo([1])`, `tempo(base)`, `measure([1])` and `measure(base)` parse.
:::

Any other identifier followed by `(` is a syntax error — there is no `instrument()`, no `min()`,
no `abs()`.

### tempo() and measure() do not survive a save

`tempo(x)` compiles to exactly the same bytecode as `x.tempo`, and `measure(x)` to the same as
`x.ml`. They are input sugar. When the expression is written back out you get the property form:

| You type | It is saved as |
|---|---|
| `tempo(base)` | `base.tempo` |
| `measure([2])` | `[2].ml` |
| `beat(base)` | `beat(base)` |

`beat()` is the only function the decompiler reconstructs, so it is the only one you will see
in a saved module.

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
| 5 | Literals, `[N].p`, `base.p`, `f(x)`, `( … )` | — |

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
primary        -> fraction | noteRef | helperCall | '(' expression ')' | number
fraction       -> '(' number '/' number ')'
noteRef        -> '[' number ']' '.' property | 'base' '.' property
helperCall     -> HELPER '(' noteArg ')'
noteArg        -> '[' number ']' | 'base'
```

`HELPER` is one of `tempo`, `measure`, `beat`.

## Expressions the app writes for you

Dragging a note, resizing it, pressing the ▲/▼ frequency arrows, and creating a note all
rewrite the affected expression. Each of these preserves the format it found: a DSL expression
is rewritten as DSL, and a legacy expression is rewritten as legacy. The only thing that
converts a legacy expression to DSL is pressing **Save** in the note widget, whose `Raw:` field
is already showing you the DSL.

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
| Unknown character | `a & b` |
| Missing property after `.` | `base.` |
| Incomplete expression | `1 +` |
| Unclosed bracket | `beat([1].t` |
| Self-reference | `[5].f * 2` typed on note 5 |
| Circular dependency | note 1 references note 2, which references note 1 |

::: warning Rejection is silent
A rejected expression produces **no message in the interface**. The `Save` button does nothing
visible, the note keeps its old value, and the reason is written to the browser console. Open
the developer console (F12) if a save appears to do nothing — the message there is specific,
for example `Unknown property 'x'. Valid properties: f (frequency), t (startTime), d
(duration), tempo, bpm, ml (at column 5)`.
:::

### What is *not* an error

Three things that look like errors are not.

**Division by zero.** `(5/0)` is accepted. It is not read as a fraction literal — it falls back
to a grouped division, and at evaluation time a division by zero yields **1** with a console
warning.

**An unresolvable reference.** See the defaults table above. Evaluation degrades rather than
failing.

**An expression neither compiler can parse.** It is not rejected — it silently compiles to the
constant **`0`**, with only a console warning. This is how a typo like `[1]f` (the dot is
missing) can zero a note's value without any visible complaint. Check the `Evaluated:` line
after saving anything unusual.

## Format detection

Each expression string is classified as DSL or legacy on its own, at compile time:

1. It is **DSL** if it contains a note reference (`[N].`), a `base.` reference, starts with a
   fraction literal, or starts with `tempo(` / `measure(` / `beat(`.
2. It is **legacy** if it contains `new Fraction(`, `module.getNoteById`, `module.baseNote`,
   `.getVariable(`, a `.mul(`/`.div(`/`.add(`/`.sub(`/`.pow(`/`.neg(` call, or
   `module.findTempo` / `module.findMeasureLength`.
3. Otherwise, if the whole string is reference-free arithmetic — `263`, `2 * 263`,
   `(1/2) * 263` — it is **DSL**.
4. Otherwise it is treated as legacy.

Rule 3 is why a bare number in a module file is DSL, not legacy.

<details>
<summary>Legacy JavaScript syntax</summary>

The legacy format is a method chain over `Fraction` objects. It is text, not JavaScript — it is
never evaluated, only pattern-matched and compiled. Only `.mul()`, `.div()`, `.add()`, `.sub()`
and `.pow()` are recognized.

```javascript
// Perfect fifth above the BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Start when note 1 ends
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))

// One beat
new Fraction(60).div(module.findTempo(module.baseNote))

// 12-TET semitone
new Fraction(2).pow(new Fraction(1, 12))
```

| Task | DSL | Legacy |
|---|---|---|
| Perfect fifth | `base.f * (3/2)` | `module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))` |
| Note 1's end time | `[1].t + [1].d` | `module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))` |
| One beat | `beat(base)` | `new Fraction(60).div(module.findTempo(module.baseNote))` |
| 12-TET semitone | `2^(1/12)` | `new Fraction(2).pow(new Fraction(1, 12))` |
| Measure length | `measure([1])` | `module.findMeasureLength(module.getNoteById(1))` |

See [Fraction API](/reference/expressions/fraction-api) for the full list of what the legacy
parser does and does not accept.
</details>

## See also

- [Operators](/reference/expressions/operators) — per-operator semantics and result types
- [Module API](/reference/expressions/module-api) — references and functions in detail
- [Fraction API](/reference/expressions/fraction-api) — exact numbers, and the legacy surface
- [Module JSON Schema](/reference/module-schema) — how expressions are stored in a file
- [Dependencies](/user-guide/notes/dependencies) — what a reference does to the graph
