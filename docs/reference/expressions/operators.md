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
| 5 | Literals, `[N].p`, `base.p`, `beat(x)`, `( … )` | — |

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
base.t + beat(base)    # one beat after the BaseNote starts
```

Exact. `(1/2) + (1/3)` is `5/6`, not `0.8333…`.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(1, 2).add(new Fraction(1, 3))
module.getNoteById(5).getVariable('startTime')
  .add(module.getNoteById(5).getVariable('duration'))
```
</details>

## Subtraction: `-`

```
5 - 2                  # 3
(3/4) - (1/4)          # 1/2
[3].t - (1/2)          # half a second before note 3 starts
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(5).sub(new Fraction(2))
module.getNoteById(3).getVariable('startTime').sub(new Fraction(1, 2))
```
</details>

## Multiplication: `*`

```
3 * 2                  # 6
(3/2) * (5/4)          # 15/8
base.f * (3/2)         # a perfect fifth above the BaseNote
beat(base) * 2         # two beats
```

Multiplication is how you build intervals. See [Pure Ratios](/user-guide/tuning/ratios).

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(3, 2).mul(new Fraction(5, 4))
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

## Division: `/`

```
6 / 2                  # 3
(3/2) / 3              # 1/2
[3].f / 2              # an octave below note 3
base.f / (3/2)         # a fifth below the BaseNote
```

::: warning Division by zero is not an error
`5 / 0` compiles. At evaluation the result is **1**, and a warning goes to the browser console.
The value is wrong and nothing on screen says so. `(5/0)` behaves the same way — it is not read
as a fraction literal, it falls back to a grouped division.
:::

For a beat duration, write `beat(base)`. It compiles to `60 / tempo(base)` and, unlike the long
form, it survives a save as `beat(base)`.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(3, 2).div(new Fraction(3))
new Fraction(60).div(module.findTempo(module.baseNote))   // one beat
```
</details>

## Negation: `-` (prefix)

```
-5                     # -5
-(3/2)                 # -3/2
-base.f                # negated frequency
```

Prefix `-` binds tighter than `*` and `/` but looser than `^`, so `-2^2` is `-4`.

::: warning No legacy equivalent you can type
`.neg()` appears in some old expressions but the legacy parser **cannot read it** — a saved
`new Fraction(5).neg()` silently compiles to `0`. Write `-5` in DSL, or `new Fraction(-5)` in
legacy.
:::

## Power: `^`

`a ^ b` raises `a` to the power `b`. Both operands must evaluate to rationals. `^` is
right-associative and binds tighter than every other operator.

```
2 ^ 3                  # 8
3 ^ 2                  # 9
2 ^ (-1)               # 1/2
4 ^ (1/2)              # 2 — a perfect square root, still exact
2 ^ (1/12)             # the 12-TET semitone — irrational
3 ^ (1/13)             # one Bohlen-Pierce step — irrational
```

### What `^` produces

The result type depends on the exponent, and it is the single most consequential thing about
this operator.

| Case | Result | Property is |
|---|---|---|
| Integer exponent (`2^3`, `2^-1`) | Exact rational | clean |
| Fractional exponent with an exact root (`4^(1/2)` → 2, `8^(1/3)` → 2) | Exact rational | clean |
| Fractional exponent with no exact root (`2^(1/12)`) | Irrational, approximated to a rational | **corrupted** |

A property whose value came out irrational is flagged **corrupted**. That flag is what drives
the visuals and the display:

- The note is drawn with a **crosshatch** — a note that merely *depends* on a corrupted note
  gets a single diagonal hatch instead.
- The value in the note widget is prefixed with **`≈`** to say "this is an approximation".

Corruption is not damage. Every equal-tempered scale in the module library is built out of
corrupted notes. It is a marker that the value is no longer an exact ratio, which means it can
no longer be reasoned about as one. See [SymbolicPower](/developer/core/symbolic-power).

::: tip Perfect roots stay clean
`4^(1/2)` is 2 exactly, so the note is not corrupted — and the simplifier will rewrite the
expression to `2`. Only genuinely irrational powers corrupt.
:::

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(2).pow(new Fraction(3))      // 8
new Fraction(2).pow(new Fraction(-1))     // 1/2
new Fraction(2).pow(new Fraction(1, 12))  // 12-TET semitone
```
</details>

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

The built-in functions have no opcodes of their own. `tempo(x)` and `measure(x)` compile to a
plain property load (`LOAD_BASE` / `LOAD_REF`); `beat(x)` compiles to `LOAD_CONST 60`, then the
tempo load, then `DIV`. The `FIND_TEMPO` (`0x20`), `FIND_MEASURE` (`0x21`),
`FIND_INSTRUMENT` (`0x22`), `DUP` (`0x30`) and `SWAP` (`0x31`) opcodes are defined but no
compiler emits them.

See [Binary Evaluator](/developer/core/binary-evaluator) for how the bytecode runs.

## Error conditions

There are fewer real errors than you would expect, and more silent wrong answers.

| What you write | What happens |
|---|---|
| `1 +`, `base.`, `a & b` | Rejected on save. Reason goes to the browser console; nothing appears on screen |
| `5 / 0` | Accepted. Evaluates to **1** with a console warning |
| `2^(1/12)` | Accepted. Irrational — the property is flagged corrupted |
| Anything neither compiler can parse | Silently compiles to constant **`0`** with a console warning |

Check the `Evaluated:` line in the note widget after saving. It is the only feedback you get.

## See also

- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Fraction API](/reference/expressions/fraction-api) — exactness, and the legacy surface
- [Module API](/reference/expressions/module-api) — references and built-in functions
- [Binary Evaluator](/developer/core/binary-evaluator) — bytecode execution
