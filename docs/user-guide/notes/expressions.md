---
title: Expressions
description: Write note properties as expressions — fractions, references to other notes, beat(base), and TET powers — and understand what the app does with them.
---

# Expressions

Every note property is stored as an **expression**, not as a number. `440` is an expression. So is `base.f * (3/2)`. The app compiles them, works out the values, and recomputes everything downstream whenever a value changes.

This page is the practical introduction. The exhaustive grammar lives in the [Expression Syntax reference](/reference/expressions/syntax).

## The three ingredients

```
440                # a literal — 440 Hz
base.f             # a reference — the BaseNote's frequency
base.f * (3/2)     # arithmetic on a reference — a perfect fifth above it
```

That is the whole language. Everything else is detail.

## Units: seconds, and the beat idiom

`startTime` and `duration` are measured in **seconds**. Frequency is in **Hz**.

Music is not written in seconds, so the language gives you `beat(base)` — the length of one beat at the BaseNote's tempo, in seconds.

```
beat(base)              # one beat
beat(base) * 4          # a whole note
beat(base) * (1/2)      # an eighth note
beat(base) * (3/4)      # a dotted eighth
base.t + beat(base) * 2 # two beats after the BaseNote starts
```

::: warning `1` means one second
At the default tempo of 100, one beat is `0.6` seconds — so `"duration": "1"` is a note about 1⅔ beats long, which is almost certainly not what you meant. Reach for `beat(base)`.
:::

Every shipped module writes its durations this way, and so does the app: the note-length icon buttons in the widget emit `beat(base)` for a quarter, and `beat(base) * 2`, `beat(base) * (1/2)` and so on for the rest.

## Literals

| You write | You get |
|---|---|
| `440` | the integer 440 |
| `(3/2)` | the exact fraction 3/2 — **the parentheses are part of the literal** |
| `0.5` | converted to a fraction at compile time |
| `-2` | negation works as you'd expect |

Fractions are exact rationals, all the way through. `(1/3)` is one third, not `0.3333`.

::: tip Prefer fractions to decimals
A decimal is rationalised, and not always the way you would guess: `3.14159` compiles to `(9563/3044)`. If you want an exact value, write the fraction.
:::

## Referencing other notes

| Form | Meaning |
|---|---|
| `[5].f` | note 5's frequency |
| `base.f` | the BaseNote's frequency |
| `[0].f` | the same thing — note 0 **is** the BaseNote |

The property goes after the dot. The short names are the ones you will see everywhere:

| Property | Short | Also accepted |
|---|---|---|
| frequency | `f` | `freq`, `frequency` |
| startTime | `t` | `s`, `start`, `startTime` |
| duration | `d` | `dur`, `duration` |
| tempo | `tempo` | — |
| beatsPerMeasure | `bpm` | `beatsPerMeasure` |
| measureLength | `ml` | `measureLength` |

So `[3].d` is note 3's duration and `base.bpm` is the BaseNote's beats-per-measure. There is no `l` alias for duration.

`tempo`, `bpm` and `ml` **fall back to the BaseNote** when the note you name doesn't define them — `[5].tempo` on a note with no tempo of its own gives you the BaseNote's tempo. `f`, `t` and `d` do not fall back.

## Arithmetic

`+`  `-`  `*`  `/`  `^`  and unary `-`, with the precedence you would expect from mathematics — except for one thing worth knowing:

::: info `^` binds tighter than `*`
`base.f * 2^(1/12)` parses as `base.f * (2^(1/12))`, which is what you want. `^` is also right-associative, so `2^3^2` is `2^(3^2)`.
:::

Use `(` `)` to group. Use `#` to start a comment — but note that **comments are dropped when the expression is saved**.

## The three helper functions

There are exactly three, and each takes a bare note reference (`base` or `[N]`) — not an expression.

| Call | Gives you |
|---|---|
| `beat(x)` | one beat at x's tempo, in seconds |
| `tempo(x)` | x's tempo |
| `measure(x)` | x's measure length, in seconds |

::: info `tempo()` and `measure()` don't survive a save
They compile to exactly the same thing as `x.tempo` and `x.ml`, and that's the form that comes back when the expression is redisplayed. Type `measure([1])` and it works, but the widget will show you `[1].ml` afterwards. **`beat()` is the one helper that round-trips** — write it and it stays written.
:::

## The patterns you'll actually use

**Pitch**

```
base.f * (3/2)      # perfect fifth, just intonation
base.f * (5/4)      # major third, just intonation
[1].f * (9/8)       # whole tone above note 1
base.f * 2^(7/12)   # perfect fifth, 12-TET
base.f * 3^(1/13)   # one Bohlen-Pierce step
440                 # an absolute pitch, tied to nothing
```

**Time**

```
base.t                    # start with the BaseNote
[1].t + [1].d             # start the moment note 1 ends
[1].t                     # start with note 1 (chord)
[1].t + measure([1])      # start one measure after note 1
base.t + beat(base) * 3   # three beats in
```

**Length**

```
beat(base)              # a quarter note
beat(base) * (7/4)      # a double-dotted quarter
[3].d                   # exactly as long as note 3 — and tied to it
```

## What the app does with what you typed

**It always shows you DSL.** Whatever format a note was authored in, the `Raw:` field decompiles it into the DSL. You will essentially never see the legacy method-chain syntax unless you open an old JSON file by hand — and saving a legacy row rewrites it as DSL.

**It simplifies on save.** Expressions are canonicalised into a rational coefficient times a product of powers:

| You type | It saves |
|---|---|
| `2 * (1/2) * base.f` | `base.f` |
| `base.f + base.f` | `2 * base.f` |
| `4^(1/2) * base.f` | `2 * base.f` |
| `2^(1/12) * 2^(1/12) * base.f` | `2^(1/6) * base.f` |

A rewrite is rejected and your original kept if it would change the value, so simplification can never quietly retune a note.

**It re-evaluates in dependency order.** Change the BaseNote's frequency and every note that references it — directly or through a chain — updates. See [Dependencies](/user-guide/notes/dependencies).

## Irrational values and the ≈ badge

Equal temperament needs irrational numbers: `2^(1/12)` is not a fraction. The app cannot hold those exactly, so it flags them.

A note whose frequency is irrational — or which depends on one that is — is called **corrupted**, and shows up two ways:

- In the note widget, the **`Evaluated:`** value gets an **`≈`** prefix and turns italic amber.
- In the workspace, the note is drawn with diagonal **hatching**. A **crosshatch** (both diagonals) means the note is *directly* irrational. A **single diagonal** means it *inherited* the problem from a note it depends on.

This is information, not an error. TET music is supposed to look like this. It is telling you where exactness stops. [Equal Temperament](/user-guide/tuning/equal-temperament) goes into what stays exact and what does not.

::: info Every row can carry the ≈ badge
An irrational start time or duration is marked just like an irrational frequency — the row shows `≈` and a decimal to 8 significant figures. Only the *transitive* case (inheriting an irrational value from up the chain) is tracked for frequency alone.
:::

## Things that go wrong

### A typo'd note ID is not an error

::: danger `[999].f` silently becomes 440 Hz
Nothing validates that a referenced note exists. If the reference can't be resolved, the evaluator substitutes a default instead of complaining — **440 Hz** for a frequency, `0` for a start time, `1` for a duration. So a mistyped ID produces a plausible-sounding note rather than an error message. If a note is stubbornly sitting at 440 Hz, check its IDs.
:::

### Self-references and cycles are rejected

A note cannot reference itself, and two notes cannot reference each other in a loop. Both are caught before the expression is stored.

```
# On note 4 — rejected, a note cannot reference itself
[4].f * (3/2)

# On note 5, when note 6 already reads [5].f — rejected, that's a cycle
[6].f * (3/2)
```

### Rejections tell you why

When `Save` rejects an expression — bad syntax, self-reference, cycle — the reason appears **inline in the widget**: a red message under the `Save` button, and a red border on the `Raw:` field. The field keeps your text and the note doesn't change; fix the expression and save again. Both clear on your next keystroke.

## Expression versus value

| Term | Meaning |
|---|---|
| **Expression** | the formula — `base.f * (3/2)` |
| **Value** | what it currently works out to — `394.5` Hz |
| **`Raw:`** | the expression, in the widget |
| **`Evaluated:`** | the value, in the widget |

Retuning the BaseNote changes every *value* in the piece and no *expression* at all. That is the point of the whole system.

## Where to go next

- [Expression Syntax reference](/reference/expressions/syntax) — the complete grammar.
- [Frequency](/reference/properties/frequency), [Start Time](/reference/properties/start-time), [Duration](/reference/properties/duration) — property-by-property reference.
- [Dependencies](/user-guide/notes/dependencies) — what a reference buys you.
- [Pure Ratios](/user-guide/tuning/ratios) and [Equal Temperament](/user-guide/tuning/equal-temperament) — the two ways to write a pitch.
