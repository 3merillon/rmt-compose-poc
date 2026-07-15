---
title: duration
description: Reference for the duration property - aliases, defaults, the note-length buttons, resizing, valid expressions, and worked examples.
---

# duration

`duration` is how long a note lasts, in **seconds**. Like every note property it is stored as an
expression string, compiled to bytecode, and evaluated with exact rational arithmetic.

Durations are almost always written in beats — `beat(base) * (3/4)` — rather than in seconds, so
that changing the tempo re-times the whole composition.

## Aliases

| Write | Meaning |
|---|---|
| `d` | canonical short form — what the app writes and what the widget shows |
| `dur` | accepted, rewritten to `d` on save |
| `duration` | accepted, rewritten to `d` on save |

There is no `l` or `len` alias. `[1].d` and `[1].duration` compile to identical bytecode.

## Defaults

| Situation | Value |
|---|---|
| A note with no `duration` expression, and no `frequency` | it is a **measure bar** — no length, drawn as a vertical dashed line |
| A note with a `duration` but no `frequency` | it is a **silence** — occupies time, never sounds |
| The BaseNote | **has no duration at all** by default |
| An expression referencing a note whose duration cannot be resolved | `1` second (silent fallback, console warning only) |

::: warning `base.d` is a trap
The BaseNote has no `duration` — not in the class defaults, and not in any shipped module. `base.d`
compiles fine, but it reads an empty expression and evaluates to the `1`-second fallback, not to
anything you set. Anchor durations to `beat(base)` or to a real note instead.
:::

`duration` does **not** inherit: `[5].d` on a note with no duration expression falls back to `1`, it
does not walk up to a parent.

## Where you edit it

![The note widget open on a note, showing the Evaluated and Raw rows and the note-length buttons](/img/note-widget.png)

- **The `Raw:` input.** Type an expression, press **Save**. Edits apply on Save, not while typing.
  An invalid expression is rejected with the reason shown in red under the Save button.
- **The note-length buttons** under the duration row (see below).
- **The right edge of the note.** Drag the pull tab on a note's right edge to resize it. The new
  length snaps to a **quarter of a beat** — a sixteenth note, when a beat is a quarter — with a
  minimum of one quarter-beat, and is written as `beat(base) * (n/d)`.

### The note-length buttons

Five icon buttons pick a base length, and two dot buttons multiply it:

| Button | Beats | Factor |
|---|---|---|
| Whole | 4 | ×4 |
| Half | 2 | ×2 |
| Quarter | 1 | ×1 |
| Eighth | 1/2 | ×1/2 |
| Sixteenth | 1/4 | ×1/4 |
| `.` (dot) | — | ×3/2 |
| `..` (double dot) | — | ×7/4 |

The dot buttons toggle, and combine with whichever length is selected: quarter + `.` gives 3/2 of a
beat, eighth + `.` gives 3/4, quarter + `..` gives 7/4.

Clicking a button **fills the `Raw:` field** with the corresponding expression and reveals `Save`.
Nothing changes until you press **Save**. The selection is pre-highlighted to match the note's
current length whenever that length is one the buttons can express.

## Expression examples

### Beat-relative (the normal case)

```
beat(base)             # one beat  (a quarter note)
beat(base) * 4         # four beats  (a whole note)
beat(base) * 2         # two beats  (a half note)
beat(base) * (1/2)     # half a beat  (an eighth note)
beat(base) * (1/4)     # a quarter beat  (a sixteenth note)
beat(base) * (3/2)     # a dotted quarter
beat(base) * (3/4)     # a dotted eighth
```

`beat(x)` compiles to `60 / tempo(x)`. It is the only helper the decompiler reconstructs, so it
survives a save unchanged.

::: tip Prefer the multiplier after the beat
`beat(base) * 2` is sniffed as DSL directly. `2 * beat(base)` compiles too, but only after a
wasted trip through the legacy parser — a lone helper call is recognised as DSL only when it leads
the expression. See [tempo](/reference/properties/tempo#the-beat-unit).
:::

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(60).div(module.findTempo(module.baseNote))
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(4))
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```
</details>

### Standard note values

| Note | Beats | Expression |
|---|---|---|
| Whole | 4 | `beat(base) * 4` |
| Dotted half | 3 | `beat(base) * 3` |
| Half | 2 | `beat(base) * 2` |
| Dotted quarter | 3/2 | `beat(base) * (3/2)` |
| Quarter | 1 | `beat(base)` |
| Dotted eighth | 3/4 | `beat(base) * (3/4)` |
| Eighth | 1/2 | `beat(base) * (1/2)` |
| Sixteenth | 1/4 | `beat(base) * (1/4)` |

### Measure-relative

```
measure(base)          # one full measure
measure(base) * (1/2)  # half a measure
measure(base) * 2      # two measures
```

`measure(x)` is saved as `x.ml` — the two compile to identical bytecode.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findMeasureLength(module.baseNote)
module.findMeasureLength(module.baseNote).mul(new Fraction(1, 2))
```
</details>

### Absolute seconds

```
1        # one second
2        # two seconds
(1/2)    # half a second
```

These ignore tempo. A composition written in absolute seconds will not re-time when you change the
BaseNote tempo.

### Relative to another note

```
[1].d          # same length as note 1
[1].d * 2      # twice as long as note 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('duration')
module.getNoteById(1).getVariable('duration').mul(new Fraction(2))
```
</details>

## Dependencies

Duration participates in dependencies in two directions.

Referencing another note's duration links you to it:

```
[1].t + [1].d      # start when note 1 ends: depends on note 1's startTime AND duration
```

Resizing note 1 therefore moves this note. Select a note and the workspace outlines the notes
involved: **purple** for duration, **teal** for startTime, **orange** for frequency. A thick outline
is a note the selection depends on; a thin outline is a note that depends on the selection. While
you are resizing, the duration colour stays bright and the other two dim.

## In the workspace

- A note's **width** is its duration; width scales with the X zoom.
- Silences (duration but no frequency) are drawn with a dashed border ring.

## In playback

The instrument envelope is fitted **inside** `[startTime, startTime + duration]` and reaches zero at
the end, so the audible length is the duration you wrote. Attack and release are proportional to
the note's length (with 3 ms / 15 ms floors so very short notes do not click), and together they are
capped at 90% of the note so there is always some body left.

The voice itself is stopped 150 ms after the note ends — while it is already silent — so that
exponential release curves finish cleanly. A running reverb tail can still be audible after that.

Every voice runs through the signal graph: voice gain → optional stereo panner → per-instrument bus
→ dry path plus a reverb send → master → limiter.

## See also

- [startTime](/reference/properties/start-time)
- [tempo](/reference/properties/tempo)
- [Add Rhythm](/tutorials/beginner/rhythm)
- [Expression Syntax](/reference/expressions/syntax)
