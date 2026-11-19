---
title: duration
description: Reference for the duration property - aliases, defaults, the time unit (base.d), the note-length buttons, resizing, valid expressions, and worked examples.
---

# duration

`duration` is how long a note lasts, in **seconds**. Like every note property it is stored as an
expression string, compiled to bytecode, and evaluated with exact rational arithmetic.

It is one of the three variables of the notation, with [frequency](/reference/properties/frequency)
and [startTime](/reference/properties/start-time). Durations are almost always written against
other durations, never as seconds: `base.d * (3/4)` is three quarters of the time unit, and
`[1].d * 2` is twice as long as note 1.

## Aliases

| Write | Meaning |
|---|---|
| `d` | canonical short form — what the app writes and what the widget shows |
| `dur` | accepted, rewritten to `d` on save |
| `duration` | accepted, rewritten to `d` on save |

There is no `l` or `len` alias. `[1].d` and `[1].duration` compile to identical bytecode.

## The time unit

Every duration is measured against one note: the BaseNote. **`base.d` is the time unit**, one beat
if you count in beats. The BaseNote holds the only absolute time in a module, a start and a duration
in seconds, and every other start and duration is a relation to a note that leads back to them.

```
base.d              # one time unit
base.d * 4          # four
base.d * (1/2)      # half of one
[1].d               # as long as note 1
[1].d * (3/2)       # half again as long as note 1
```

There is no tempo setting, no beats-per-measure setting and no function to fetch either. Nothing
stores a tempo. What used to be `beat(base)` is `base.d`.

### The BPM view

A tempo is a reading of the time unit: **60 / base.d** beats per minute. On the BaseNote's
`duration` row the note widget shows it next to the value, read-only:

```
duration    Evaluated: 3/5   = 100 BPM
```

To set a tempo of T, set the BaseNote's duration to `60/T`. For 120 BPM write `(1/2)`; for 60 BPM
write `1`. The display is `= n BPM` when the tempo is exact, and `≈ n BPM` when it is not.

| Time unit (`base.d`) | Tempo |
|---|---|
| `1` | 60 BPM |
| `(3/5)` | 100 BPM |
| `(1/2)` | 120 BPM |
| `2` | 30 BPM |

| Note value | `base.d = 1` | `base.d = 3/5` | `base.d = 1/2` |
|---|---|---|---|
| Whole (4 time units) | 4 s | 2.4 s | 2 s |
| Half (2) | 2 s | 1.2 s | 1 s |
| Quarter (1) | 1 s | 0.6 s | 0.5 s |
| Eighth (1/2) | 0.5 s | 0.3 s | 0.25 s |
| Sixteenth (1/4) | 0.25 s | 0.15 s | 0.125 s |

### How durations relate to durations

A duration is an expression over other durations. Three consequences follow.

- **One edit re-times everything written against it.** Change the BaseNote's duration and every
  note whose duration, or whose start, is written in `base.d` re-evaluates. A note written in plain
  seconds (`1`) does not move.
- **A note can be its own unit.** `[3].d * 2` is twice as long as note 3 whatever note 3 is, and
  follows it when note 3 is resized.
- **A measure bar's length is its duration.** See [Measure bars](/reference/module-schema#measure-bars).
  The bar widget shows it in time units, for example `= 4 time units`.

### A dropped module keeps the workspace's time unit

When you drop a library module onto a note, the module's `base.f` and `base.t` are mapped to the
target's `f` and `t`, and its `base.d` stays `base.d`. The dropped module's rhythm is therefore
written in units of **your** BaseNote's duration: it plays at the workspace's pace, whatever the
length of the note you drop it on. (A module saved at 100 BPM and dropped into a piece at 120 BPM
plays at 120.)

On a measure bar, only `t` maps to the bar; frequency, the time unit, amplitude, attack and release
stay with the BaseNote. In **End** drop mode the module starts at the target's end.

### Old modules

A module written for the earlier time model, with a tempo and `beat()`, is converted exactly when it
loads. See [Modules from earlier versions](/user-guide/modules/module-format#modules-from-earlier-versions).

## Defaults

| Situation | Value |
|---|---|
| The BaseNote of a module created from scratch | `1` second (one time unit; 60 BPM) |
| The BaseNote of `defaultModule.json` | `(3/5)` second (100 BPM) |
| A note with a `duration` and a `frequency` | it is a **note**, and sounds |
| A note with a `duration` but no `frequency` | it is a **silence** (a rest): occupies time, never sounds |
| The same, flagged `"measure": true` | it is a **measure bar**, see [Measure bars](/reference/module-schema#measure-bars) |
| A note with no `duration` | it has no length: a plain marker, never scheduled to sound |
| An expression referencing a note whose duration cannot be resolved | `1` second (silent fallback, console warning only) |

`duration` does **not** inherit: `[5].d` on a note with no duration expression falls back to `1`, it
does not walk up to a parent.

::: warning Keep the time unit positive
`Module.getTimeUnit()`, which the snapping and the BPM view use, returns `1` when `base.d` is zero or
negative. The expressions themselves still read the value you wrote, so a zero duration on the
BaseNote makes every `base.d * k` zero.
:::

## Where you edit it

![The note widget open on a note, showing the Evaluated and Raw rows and the note-length buttons](/img/note-widget.png)

- **The `Raw:` input.** Type an expression, press **Save**. Edits apply on Save, not while typing.
  An invalid expression is rejected with the reason shown in red under the Save button.
- **The note-length buttons** under the duration row (see below). They are not shown on the BaseNote,
  whose duration *is* the time unit, nor on a measure bar.
- **The right edge of the note.** Drag the pull tab on a note's right edge to resize it. The new
  length snaps to a **quarter of a time unit**, with a minimum of one quarter, and is written as
  `base.d * (n/d)`.

### The note-length buttons

Five icon buttons pick a base length, and two dot buttons multiply it:

| Button | Time units | Factor |
|---|---|---|
| Whole | 4 | ×4 |
| Half | 2 | ×2 |
| Quarter | 1 | ×1 |
| Eighth | 1/2 | ×1/2 |
| Sixteenth | 1/4 | ×1/4 |
| `.` (dot) | — | ×3/2 |
| `..` (double dot) | — | ×7/4 |

The dot buttons toggle, and combine with whichever length is selected: quarter + `.` gives 3/2 of a
time unit, eighth + `.` gives 3/4, quarter + `..` gives 7/4.

Clicking a button **fills the `Raw:` field** with the corresponding expression and reveals `Save`.
Nothing changes until you press **Save**. The selection is pre-highlighted to match the note's
current length whenever that length is one the buttons can express.

## Expression examples

### In time units (the normal case)

```
base.d             # one time unit  (a quarter note)
base.d * 4         # four  (a whole note)
base.d * 2         # two  (a half note)
base.d * (1/2)     # half of one  (an eighth note)
base.d * (1/4)     # a quarter of one  (a sixteenth note)
base.d * (3/2)     # a dotted quarter
base.d * (3/4)     # a dotted eighth
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('duration')
module.baseNote.getVariable('duration').mul(new Fraction(4))
module.baseNote.getVariable('duration').mul(new Fraction(1, 2))
```
</details>

### Standard note values

| Note | Time units | Expression |
|---|---|---|
| Whole | 4 | `base.d * 4` |
| Dotted half | 3 | `base.d * 3` |
| Half | 2 | `base.d * 2` |
| Dotted quarter | 3/2 | `base.d * (3/2)` |
| Quarter | 1 | `base.d` |
| Dotted eighth | 3/4 | `base.d * (3/4)` |
| Eighth | 1/2 | `base.d * (1/2)` |
| Sixteenth | 1/4 | `base.d * (1/4)` |

### A bar length

A measure bar's duration is the length of its bar. Four time units is the bar Add Measure writes
first; a different bar length is a different meter:

```
base.d * 4         # 4/4, if a time unit is a quarter note
base.d * 3         # 3/4
base.d * (7/2)     # 7/8
[1].d              # as long as bar 1
```

### Absolute seconds

```
1        # one second
2        # two seconds
(1/2)    # half a second
```

These ignore the time unit. A note written in absolute seconds will not re-time when you change the
BaseNote's duration.

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
base.d * (1/2)     # depends on the BaseNote's duration, the time unit
```

Resizing note 1 therefore moves the first note; changing the time unit re-times the second. Select a
note and the workspace outlines the notes involved: **purple** for duration, **teal** for startTime,
**orange** for frequency. A thick outline is a note the selection depends on; a thin outline is a
note that depends on the selection. While you are resizing, the duration colour stays bright and the
other two dim.

## In the workspace

- A note's **width** is its duration; width scales with the X zoom.
- Silences (duration but no frequency) are drawn with a dashed border ring.
- A measure bar is not drawn as a rest: it is a dashed line with a triangle.

## In playback

The instrument envelope is fitted **inside** `[startTime, startTime + duration]` and reaches zero at
the end, so the audible length is the duration you wrote. How long the rise and the fall take is a
share of that duration: see [attack and release](/reference/properties/attack-release), which also
gives the floors (3 ms and 15 ms) and how the two are fitted inside a short note.

The voice itself is stopped 150 ms after the note ends — while it is already silent — so that
exponential release curves finish cleanly. A running reverb tail can still be audible after that.

Every voice runs through the signal graph: voice gain → optional stereo panner → per-instrument bus
→ dry path plus a reverb send → master → limiter.

## See also

- [startTime](/reference/properties/start-time)
- [attack and release](/reference/properties/attack-release)
- [Measure bars](/reference/module-schema#measure-bars)
- [Add Rhythm](/tutorials/beginner/rhythm)
- [Expression Syntax](/reference/expressions/syntax)
