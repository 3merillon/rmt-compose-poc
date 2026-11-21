---
title: Operators
description: Every operator in the RMT Compose expression DSL — semantics, precedence, associativity, result types, and the bytecode each one compiles to.
---

# Operators

The expression DSL has six operators. All of them work on exact rational values.

| Operator | Meaning | Example |
|---|---|---|
| `+` | Addition | `[5].t + [5].d` |
| `-` | Subtraction | `[3].t - (1/2)` |
| `*` | Multiplication | `base.f * (3/2)` |
| `/` | Division | `[1].d / 2` |
| `^` | Power | `2^(1/12)` |
| `-` (prefix) | Negation | `-base.f` |

## Precedence and associativity

Loosest first. Tighter binds first.

| Level | Operators | Associativity |
|---|---|---|
| 1 | `+` `-` (binary) | Left |
| 2 | `*` `/` | Left |
| 3 | `-` (prefix) | Prefix |
| 4 | `^` | **Right** |
| 5 | Literals, `[N].p`, `base.p`, `( … )` | — |

| Expression | Parses as | Value |
|---|---|---|
| `[1].f * 2^(1/12)` | `[1].f * (2^(1/12))` | one semitone above note 1 |
| `-2^2` | `-(2^2)` | −4 |
| `2^3^2` | `2^(3^2)` | 512 |
| `2^-1` | `2^(-1)` | 1/2 |
| `2 * 3 + 4` | `(2 * 3) + 4` | 10 |
| `[1].t - [2].t - [3].t` | `([1].t - [2].t) - [3].t` | left-associative |

Parentheses override all of this.

## Addition: `+`

```
1 + 2                  # 3
(1/2) + (1/3)          # 5/6
[5].t + [5].d          # the moment note 5 ends
base.t + base.d        # one time unit after the BaseNote starts
```

Exact. `(1/2) + (1/3)` is `5/6`, not `0.8333…`.

## Subtraction: `-`

```
5 - 2                  # 3
(3/4) - (1/4)          # 1/2
[3].t - (1/2)          # half a second before note 3 starts
```

## Multiplication: `*`

```
3 * 2                  # 6
(3/2) * (5/4)          # 15/8
base.f * (3/2)         # a perfect fifth above the BaseNote
base.d * 2             # two time units
```

Multiplication is how you build intervals. See [Pure Ratios](/user-guide/tuning/ratios).

## Division: `/`

```
6 / 2                  # 3
(3/2) / 3              # 1/2
[3].f / 2              # an octave below note 3
base.f / (3/2)         # a fifth below the BaseNote
```

::: warning Division by zero is not an error
`5 / 0` compiles. At evaluation the result is **1**, a warning goes to the browser console, and
the value is **approximate** — the note crosshatches on the canvas, so the substituted
value does announce itself. `(5/0)` behaves the same way — it is not read as a fraction literal,
it falls back to a grouped division.
:::

For a length, write it against the time unit: `base.d / 2` or `base.d * (1/2)`. A tempo is never
divided into a duration: `60 / base.d` is only the BPM view shown in the note widget.

## Negation: `-` (prefix)

```
-5                     # -5
-(3/2)                 # -3/2
-base.f                # negated frequency
```

Prefix `-` binds tighter than `*` and `/` but looser than `^`, so `-2^2` is `-4`.

## Power: `^`

`a ^ b` raises `a` to the power `b`. The exponent should be a rational; an irrational or
approximate exponent gives an approximate value. `^` is
right-associative and binds tighter than every other operator.

```
2 ^ 3                  # 8
3 ^ 2                  # 9
2 ^ (-1)               # 1/2
4 ^ (1/2)              # 2 — a perfect square root, still exact
2 ^ (1/12)             # the 12-TET semitone — irrational, kept exact
3 ^ (1/13)             # one Bohlen-Pierce step — irrational, kept exact
```

### What `^` produces

The result type depends on the exponent, and it is the single most consequential thing about
this operator.

| Case | Result | Hatched |
|---|---|---|
| Integer exponent (`2^3`, `2^-1`) | Exact rational | no |
| Fractional exponent with an exact root (`4^(1/2)` → 2, `8^(1/3)` → 2) | Exact rational | no |
| Fractional exponent with no exact root (`2^(1/12)`) | Exact irrational: kept as the power | yes |
| Irrational or approximate exponent, integer exponent past the safety caps (`2^100000`) | Approximate | yes |

An irrational power is never turned into a fraction. `2^(1/12)` stays `2^(1/12)`, values computed
from it are exact (`263 * 2^(7/12)`), and twelve steps of `2^(1/12)` give exactly 2. The exponent
is reduced (`2^(3/12)` is `2^(1/4)`) and the base is factored into primes (`6^(1/2)` is
`2^(1/2) * 3^(1/2)`).

A property that holds a tempered or approximate value is hatched, and the display follows its kind:

- The note is drawn with a **crosshatch** when its own expression holds the power — a note that
  merely *depends* on a tempered or approximate note gets a single diagonal hatch instead.
- The value in the note widget shows an irrational value as its exact form and its value, for
  example `(263/4) * 2^(1/4) = 78.190368…`. Only an approximate value is prefixed with **`≈`**.

For the arithmetic behind these results, see [Exact Values](/developer/core/symbolic-power).

::: tip Perfect roots stay clean
`4^(1/2)` is 2 exactly, so the note is not hatched — and the simplifier will rewrite the
expression to `2`. Perfect roots are found exactly at any magnitude. Only genuinely irrational
powers hatch.
:::

::: warning Very large powers are capped
Exact exponentiation has two safety caps: an integer exponent larger than **65536**, or a
result that would exceed roughly **a megabit per component**, is not computed exactly. The
result is approximate instead — the property is hatched and the value
is an approximation. Below the caps, integer powers and perfect roots are exact regardless of
how many digits the result has.
:::

## Worked patterns

### Intervals as multiplication

```
base.f * 2             # octave (2:1)
base.f * (3/2)         # perfect fifth (3:2)
base.f * (4/3)         # perfect fourth (4:3)
base.f * (5/4)         # major third (5:4)
base.f * (6/5)         # minor third (6:5)
```

### Intervals downward

```
base.f / 2             # an octave down
base.f / (3/2)         # a fifth down
base.f * (2/3)         # a fifth down — the same thing
```

### Compound intervals

```
base.f * 2 * (5/4)     # major tenth (octave plus major third)
base.f * (5/2)         # major tenth, in one ratio
base.f * 4             # two octaves
```

### Equal temperament

```
base.f * 2^(1/12)      # one step of 12-TET
base.f * 2^(7/12)      # seven steps — the 12-TET fifth
base.f * 2^(1/19)      # one step of 19-TET
base.f * 3^(1/13)      # one step of Bohlen-Pierce (13 divisions of the tritave)
```

Chaining these from note to note is the usual way to build a scale: note 2 is
`[1].f * 2^(1/12)`, note 3 is `[2].f * 2^(1/12)`, and so on. See
[Equal Temperament](/user-guide/tuning/equal-temperament).

## Bytecode

Operators compile to a stack machine. This is what an expression becomes:

| Operator | Opcode | Byte | Effect |
|---|---|---|---|
| `+` | `ADD` | `0x10` | pop 2, push sum |
| `-` | `SUB` | `0x11` | pop 2, push difference |
| `*` | `MUL` | `0x12` | pop 2, push product |
| `/` | `DIV` | `0x13` | pop 2, push quotient (0 divisor → push 1) |
| `-` (prefix) | `NEG` | `0x14` | pop 1, push negation |
| `^` | `POW` | `0x15` | pop base and exponent, push the power; may set the corruption flag |

The language has no functions, so there are no call opcodes. `FIND_TEMPO` (`0x20`) and
`FIND_MEASURE` (`0x21`) are retired and not reused. `FIND_INSTRUMENT` (`0x22`), `DUP` (`0x30`) and
`SWAP` (`0x31`) are defined but no compiler emits them.

See [Binary Evaluator](/developer/core/binary-evaluator) for how the bytecode runs.

## Error conditions

| What you write | What happens |
|---|---|
| `1 +`, `base.`, `a & b` | Rejected on save; the reason appears in red under the Save button |
| `5 / 0` | Accepted. Evaluates to an **approximate 1** with a console warning and crosshatch |
| `2^(1/12)` | Accepted. Irrational, kept exact — the property is hatched (crosshatch) |
| `2^100000` | Accepted. Past the exact-power caps — approximate, and the property is hatched |
| `[16777216].f` | Rejected on save: `Invalid note ID '16777216'. Note IDs must be integers between 0 and 16777215` |
| Anything the compiler cannot parse | Rejected: `console.error` plus a thrown compile error; the widget shows the message, and on a file load the property is left unset |

The `Evaluated:` line in the note widget still repays a glance after saving anything unusual.

## See also

- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Fraction API](/reference/expressions/fraction-api) — exactness
- [Module API](/reference/expressions/module-api) — note references and the six properties
- [Binary Evaluator](/developer/core/binary-evaluator) — bytecode execution
