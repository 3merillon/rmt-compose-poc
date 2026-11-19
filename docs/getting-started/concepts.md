---
title: Core Concepts
description: The BaseNote, exact ratios, expressions, dependencies, measure bars, modules and the ≈ symbol — the ideas RMT Compose is built on.
---

# Core Concepts

A handful of ideas carry the whole tool: the **BaseNote**, **ratios**, **expressions**, **dependencies**, **measure bars**, **modules**, and the **≈ symbol**.

## Relative music theory

Musical relationships are ratios. RMT Compose takes that literally: nothing is stored as a pitch, everything is stored as a relationship.

**Traditional:** A4 is 440 Hz. E5 is 659.25 Hz. The fifth between them is implicit, and slightly out of tune.

**Relative:** the BaseNote is *whatever you say it is*. The note above it is `base.f * (3/2)`. The fifth is explicit, and exactly a fifth.

That buys you four things:

- **Pure intervals.** 3/2 is stored as the fraction 3/2 and evaluated as a fraction. It never becomes 1.5000001.
- **One-edit transposition.** Change the base frequency; everything defined against it moves, in tune.
- **Time works the same way.** Starts and lengths are relationships too, so changing one note's duration can stretch everything built on it.
- **Tunings as arithmetic.** `2^(1/12)` is a 12-TET semitone. `3^(1/13)` is a Bohlen-Pierce step. No special mode required.

## The BaseNote

Every module has one **BaseNote** — note id 0, drawn as the orange circle. It makes no sound. It is the origin.

| Property | Shortname | What it is | Code default |
|----------|-----------|------------|--------------|
| `frequency` | `f` | Reference frequency in Hz | 440 |
| `startTime` | `t` | Reference start time in seconds | 0 |
| `duration` | `d` | Reference length in seconds — the **time unit** | 1 |

::: info Defaults vs. the default module
The table's right-hand column is what a module gets when it is constructed with no JSON. The **default module the app boots with** overrides them: **frequency 263, startTime 0, duration 3/5** (a time unit of 0.6 s, which the note widget shows as 100 BPM). That is what a new user actually sees, and it is what the examples on this page use.
:::

### Every value is a relation; only the BaseNote is absolute

A note has three **language variables**: `frequency` (`f`), `startTime` (`t`) and `duration` (`d`). Each one is an exact expression relating the note to other notes. The BaseNote holds the only absolute values in the module: a frequency in hertz, and a start and a duration in seconds.

### The time unit

`base.d` is the **time unit**: one beat, if you count in beats. A quarter note is `base.d`, an eighth is `base.d * (1/2)`, and a note of three units is `base.d * 3`. Change the BaseNote's duration and every length written this way changes with it.

There is no stored tempo. The BaseNote's duration row in the [note widget](/user-guide/interface/variable-widget) shows `60 / base.d` beside the value, for example "= 100 BPM", as a read-only view. To change the pace, edit the duration. See [the time unit](/reference/properties/duration#the-time-unit).

Every other note can reference it:

```
base.f * (3/2)      # a perfect fifth above the base
base.t              # start when the BaseNote starts
base.d * 2          # two time units long
```

::: tip Think of it as a capo
The BaseNote is a capo. It sets where everything sits; the shapes above it don't change.
:::

## Ratios and fractions

Intervals are exact fractions:

| Interval | Ratio | Decimal | Character |
|----------|-------|---------|-----------|
| Unison | 1/1 | 1.000 | same pitch |
| Octave | 2/1 | 2.000 | same note, higher |
| Perfect fifth | 3/2 | 1.500 | very consonant |
| Perfect fourth | 4/3 | 1.333… | consonant |
| Major third | 5/4 | 1.250 | bright |
| Minor third | 6/5 | 1.200 | dark |
| Major second | 9/8 | 1.125 | whole step |

### Why exact fractions?

Compare a fifth in two systems:

| System | Ratio | Decimal |
|--------|-------|---------|
| Just intonation | 3/2 | 1.500000 |
| 12-TET | 2^(7/12) | 1.498307 |

The difference is small and audible. The just fifth locks; the tempered one beats slightly.

RMT Compose stores ratios with [fraction.js](https://github.com/rawify/Fraction.js), so a 3/2 is kept as the numerator/denominator pair **3, 2** — an exact rational — rather than a float. Arithmetic on rationals stays rational and stays exact. (Irrational values, like a TET step, are kept exact as powers; see [the ≈ symbol](#the-symbol-approximation) below.)

## Expressions

Every note property is an **expression**: text that compiles to bytecode and evaluates to a value.

### Literals

```
440                 # an integer
(3/2)               # a fraction literal — the parentheses are part of it
0.5                 # a decimal, converted to a fraction at compile time
```

### References

```
base.f              # the BaseNote's frequency
[5].t               # note 5's start time
[5].d               # note 5's duration
```

`[0]` is the same thing as `base`.

### Property shortnames

Every property has a short form, and that short form is what the app writes:

| Property | Accepted spellings |
|----------|--------------------|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |

Two further variables are not part of the notation: `amplitude` (`a`), and `attack` and `release` (`atk`, `rel`). See [Interpretation variables](#interpretation-variables).

### Operations

| Operation | Syntax | Example |
|-----------|--------|---------|
| Add | `+` | `[3].t + [3].d` |
| Subtract | `-` | `[3].t - (1/4)` |
| Multiply | `*` | `base.f * (3/2)` |
| Divide | `/` | `base.d / 2` |
| Power | `^` | `2^(1/12)` |
| Negate | `-` (prefix) | `-base.f` |

Precedence runs `+ -` loosest, then `* /`, then unary minus, then `^` tightest. `^` is right-associative, so `[1].f * 2^(1/12)` means `[1].f * (2^(1/12))` — exactly what you want when writing a TET step.

### No functions

The language has no functions. Older versions had `beat()`, `tempo()` and `measure()`; they are gone, along with the `tempo`, `beatsPerMeasure` and `measureLength` variables. Typing one is refused with a message naming the replacement: `base.d` for `beat(base)`, and `[N].d` for the length of note N. See [Modules from earlier versions](/user-guide/modules/module-format#modules-from-earlier-versions).

A quarter note is `base.d`; a dotted eighth is `base.d * (3/4)`; a whole measure of four is `base.d * 4`.

## Dependencies

When a note's expression references another note, it creates a **dependency**.

```
[1].f * (5/4)       # note 2's frequency: a major third above note 1
[2].t + [2].d       # note 3's start time: right after note 2 ends
```

Change note 1, and note 2 and note 3 update automatically. That is the mechanism behind everything: chords are a root plus tones defined against it, progressions are chords defined against the previous chord, scales are chains where each step is defined against the step below.

### Seeing dependencies

Select a note and its dependency lines are drawn, coloured by which **property** the relationship is about:

| Colour | Property |
|--------|----------|
| **Orange** | frequency |
| **Teal** | startTime |
| **Purple** | duration |

Line weight tells you which way the arrow points: a **thick** line is something the selected note *depends on*; a **thin** line is something that *depends on* the selected note.

![Dependency lines radiating from a selected note, coloured orange for frequency, teal for start time and purple for duration](/img/dependency-lines.png)

[Dependencies](/user-guide/notes/dependencies) covers the graph — retargeting, liberating a note from its parents, and what happens when you drag a note that others depend on.

### Circular dependencies are rejected

You cannot make note A depend on note B that depends on note A. Nor can an expression reference its own note.

The app refuses the edit and tells you why: the reason appears in red under the **Save** button, and the field gets a red border. Fix the expression and save again.

## Silences

A note with a **start time** and a **duration** but **no frequency** is a **silence**. It occupies time and nothing else, and it draws as a dark rectangle with a dashed border. You create one by choosing **Silence** instead of **Note** in the [Note Widget](/user-guide/interface/variable-widget)'s **ADD NOTE / SILENCE / REFERENCE** section — the frequency field disappears.

Silences are still full participants in the dependency graph: other notes can hang their start times off a silence's end. See [Creating Notes](/user-guide/notes/creating-notes).

## References and key changes

A note with a **frequency** and **no duration** never sounds: it is something the other notes relate to.
With no start time it is a **reference**, a pitch outside time: the tonic, the key, the root of a chord.
With a start time it is a **key change**: from that moment on, this is the reference. The editor draws a
reference as a long-dashed line across the whole workspace at its pitch, and a key change as the same
line from its start on, each labelled with its id. Notes hang from them like from any note, so
`(3/2) * [1].f` is the fifth of the tonic in note 1, and moving the tonic moves everything written
from it. Create one by choosing **Reference** or **Key change** in the Note Widget's add section.

A key or a chord root therefore no longer has to be carried by a note that sounds.

## Measure bars

A **measure bar** is a silent note with a start and a duration, no frequency, and the flag `"measure": true` in the saved file. It is a note like any other: its start and length are expressions, and other notes can depend on them.

The editor draws bars as dashed lines with triangles, never as rests. A silent note without the flag is a silence; a note with only a start is a plain marker, not a bar.

Bars chain. The first bar starts at `base.t` and lasts `base.d * 4`. Each next bar starts where the one before it ends and, unless you change it, is as long:

```
[1].t + [1].d       # bar 2: starts when bar 1 ends
[1].d               # bar 2: the same length as bar 1
```

A meter change is one bar's duration; the bars after it follow. Notes attach to a bar through `[bar].t` and `[bar].d * (1/4)`. See [Measures](/tutorials/intermediate/measures) and [Measure bars](/reference/module-schema#measure-bars).

## Interpretation variables

`amplitude` (`a`), `attack` (`atk`) and `release` (`rel`) are not part of the notation. They say how a note is played, not where it sits in pitch or time. They are the only variables that fall back to the BaseNote when a note does not set them.

- `amplitude` is a relative gain, default 1.
- `attack` and `release` are **shares of the note's own duration**, such as `1/8`, clamped to 0–1. When neither the note nor the BaseNote sets one, the instrument's own envelope applies.

See [attack and release](/reference/properties/attack-release).

## Transposition arrows

Selecting a note puts **▲** and **▼** buttons on its frequency row, and draws the same arrows on the note in the workspace. They multiply the note's frequency by a ratio.

That ratio is **yours to choose**. By default it's the octave — ×2 up, ×1/2 down — but the **Arrows** tab of [Settings](/user-guide/interface/settings) lets you set any ratio between 1/16 and 16 (a fifth, a comma, whatever you're working in). In the default *reciprocal* mode, down is the inverse of up.

The multiplication is folded into the expression's rational **coefficient** rather than stacked on the front of it. So `base.f` pressed up becomes `2 * base.f`, and pressed back down becomes `base.f` again — not `(1/2) * 2 * base.f`. Power terms are never absorbed into the coefficient, so a TET note stays a TET note.

[Transposing with Arrows](/user-guide/notes/transposing) has the details.

## Modules

A **module** is a collection of notes: a whole composition, or a reusable fragment.

### Module structure

```json
{
  "baseNote": {
    "frequency": "263",
    "startTime": "0",
    "duration": "3/5"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f",
      "startTime": "base.t",
      "duration": "base.d * 2",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    },
    {
      "id": 2,
      "frequency": "(5/4) * [1].f",
      "startTime": "[1].t",
      "duration": "base.d * 2"
    },
    {
      "id": 3,
      "startTime": "[1].t + [1].d",
      "duration": "base.d"
    }
  ]
}
```

Note 2 is a major third above note 1 — defined against *note 1*, not against the base. Note 3 has no `frequency`: it is a silence. All three lengths are written in time units, so editing the BaseNote's `duration` changes the pace of the whole module.

### The module library

The [module bar](/user-guide/interface/module-bar) under the top bar ships **79 modules** in six sections:

| Section | Count | Contents |
|---------|-------|----------|
| **Intervals** | 46 | Single intervals across the 3-, 5-, 7- and higher-limit families, plus six commas |
| **Chords** | 11 | Major, minor, dom7, harm7, min7, maj7, dim, aug, sus4, and the RMT-native base-3 and base-5 chords |
| **Progressions** | 8 | Four progressions (V7–I, ii–V–I, I–IV–V–I, I–vi–IV–V) and four cadences |
| **Melodies** | 7 | Public-domain tunes: Ode to Joy, Twinkle Twinkle, Frère Jacques, Amazing Grace, Greensleeves, Bach Minuet in G, Scarborough Fair |
| **Scale Systems** | 6 | 12-TET, 19-TET, 31-TET, Bohlen–Pierce, Tesla, Mixed-Base |
| **Custom** | 1 | Where your own modules land. Ships with `canon base`. |

Every module in the library is **relational and self-contained** — no expression refers to anything outside its own file. That is what lets you **drag a module onto any note** and have it re-root there: its `base.f` and `base.t` references become that note's frequency and start time, and the internal structure survives intact. Its `base.d` stays `base.d`: the module keeps its rhythm in time units and plays at your workspace's pace, whatever the length of the note you drop it on. Drop the ii–V–I onto a note a fourth up and you get the same progression, a fourth up.

[The Module Library](/user-guide/modules/module-library) lists every module and how to search them.

### Getting your work into the library

- **Save Module** (the **+** menu) downloads the whole workspace as `module.json`.
- **Copy to Modules** (the group widget, when several notes are selected) saves just that selection into the library's **Custom** section, rooted at its earliest note.
- A section's dashed **+** tile uploads a `.json` file into that section.

See [Saving Modules](/user-guide/modules/saving-modules).

## The ≈ symbol (approximation) {#the-symbol-approximation}

A value is one of three kinds. A **rational** value is an exact fraction (3/2). An **irrational** value is exact but not a fraction: it is kept as a power, like `2^(7/12)`. An **approximate** value is a number that stands for a value it is not exactly, like a measured `~261.63`. A leading **≈** in the note widget means only one thing: the value is approximate.

### When does that happen?

Equal temperament produces irrational values. A 12-TET semitone is:

```
2^(1/12)            # 1.0594630943...
```

There is no fraction that equals it, so RMT Compose keeps it as the power it is. Everything computed from it stays exact: twelve semitones multiply to exactly 2, so the 12-TET octave is exactly 2. A value becomes approximate only when you write it with `~`, or when an operation cannot be kept exact (a division by a sum of irrational terms, a division by zero). See [Approximate numbers](/reference/expressions/syntax#approximate-numbers).

### How it is shown

- In the note widget, an irrational value shows its exact form and its value, for example `(263/4) * 2^(1/4) = 78.190368…`. An approximate value shows `≈493.12500`. A rational value shows its fraction, also when a tempered chain lands on one.
- On the canvas, the note's label shows the same kind: a fraction (`3/2`), a power (`2^(7/12)`), or `≈` with a rounded fraction for an approximate note (or an exact fraction too long for the label). The note is **hatched** when it is tempered or approximate (not a pure ratio), and the hatch pattern tells you which:

| Hatching | Meaning |
|----------|---------|
| **Crosshatch** (both diagonals) | This note's own expression contains an irrational power, a `~` number or a division by zero |
| **Single diagonal hatch** | The note is pure itself, but something it depends on is tempered or approximate |

The app's internal word for the hatched state is *corrupted*; nothing is broken. Not every `^` hatches: `4^(1/2)` is exactly 2, a perfect root, so the result is rational and the note stays clean.

### Symbolic simplification

When you save an expression, RMT Compose simplifies it algebraically, and it merges powers of like bases:

```
2^(1/12) * 2^(1/12) * base.f     ->   2^(1/6) * base.f
2 * (1/2) * base.f               ->   base.f
4^(1/2) * base.f                 ->   2 * base.f
```

So two semitones up stays a single exact step of `2^(1/6)`. Evaluation keeps the same exact form, so nothing is rounded along the way.

### Just intonation vs equal temperament

| | Just intonation | Equal temperament |
|--|-----------------|-------------------|
| Ratios | exact fractions (3/2) | exact irrational powers (2^(7/12)) |
| Sound | pure, locked | a compromise that works in every key |
| Display | no marking | hatching on the note |

[Pure Ratios](/user-guide/tuning/ratios) and [Equal Temperament](/user-guide/tuning/equal-temperament) go further into both.

## Summary

| Concept | In one line |
|---------|-------------|
| **BaseNote** | Note 0. Silent. The only absolute values: a frequency in Hz, a start and a duration in seconds. |
| **Time unit** | `base.d`. One beat, if you count in beats. |
| **Ratio** | An exact fraction. 3/2 is a fifth. |
| **Expression** | The text that defines a property: `base.f * (3/2)`, `base.d`, `[1].t + [1].d`. |
| **Dependency** | One note referencing another. Change the parent, the child follows. |
| **Silence** | A note with time but no frequency. |
| **Measure bar** | A silent note flagged `measure`. Bars chain by `[p].t + [p].d`. |
| **Module** | A collection of notes. Self-contained, so it can be dropped anywhere. |
| **≈** | This value is approximate (written with `~`, or a fallback). Tempered and approximate notes are hatched on the canvas. |

## Next steps

- [Your First Composition](/getting-started/first-composition) — put the main ideas on screen in five minutes
- [Expression syntax reference](/reference/expressions/syntax) — the complete language
- [Dependencies](/user-guide/notes/dependencies) — the graph in detail
- [Tutorials](/tutorials/) — hands-on
