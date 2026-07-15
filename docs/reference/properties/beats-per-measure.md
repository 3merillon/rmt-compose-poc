---
title: beatsPerMeasure
description: Reference for the beatsPerMeasure property - aliases, defaults, measure bars and chains, mixed meters, and worked examples.
---

# beatsPerMeasure

`beatsPerMeasure` is how many **beats** fit in one measure. It is the only input to a measure's
length:

```
measureLength = beatsPerMeasure / tempo * 60      # seconds
```

It is a rational number, not an integer — `(7/2)` and `(3/2)` are valid — and it is a *count of
beats*, not the numerator of a time signature. One beat is always `60 / tempo` seconds.

## Aliases

| Write | Meaning |
|---|---|
| `bpm` | canonical short form — what the app writes and what the widget shows |
| `beatsPerMeasure` | accepted, rewritten to `bpm` on save |

`base.bpm` and `[3].bpm` are both valid.

## Defaults

| Situation | Value |
|---|---|
| BaseNote in a module created from scratch | `4` |
| BaseNote in `defaultModule.json` | `4` |
| A note with no `beatsPerMeasure` expression | inherits the BaseNote's value |
| Nothing resolvable at all | `4` (silent fallback) |

`beatsPerMeasure` is one of the three **inheriting** properties, along with `tempo` and
`measureLength`. `[5].bpm` on a note that defines none of its own yields the BaseNote's.

## Where you edit it

**For the whole composition:** click the **BaseNote** (the circle to the left of time zero), edit the
`beatsPerMeasure` row, press **Save**.

**For one measure:** click a **measure bar's triangle** to open the measure widget. It has two rows:
a `startTime` row, and a **Measure Duration** row. The Measure Duration row is a single `Raw:`
expression field with a **Save** button (the button appears once you type).

The field is pre-filled with the measure's own `beatsPerMeasure` expression, or — when the measure
has none — with the BaseNote's, shown in DSL. Saving writes the expression you typed to *that
measure*, creating a per-measure override.

::: warning The value is a beat count, not a time signature
`beatsPerMeasure` is used literally as a number of beats. Entering `(7/8)` gives a measure of
**0.875 beats**, not a seven-eight bar. For a bar of seven eighth-notes with a quarter-note beat,
enter `(7/2)`.
:::

## Expression examples

### On the BaseNote

```
4        # four beats to the bar
3        # three
2        # two
(7/2)    # seven eighth-notes, if a beat is a quarter
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(4)
new Fraction(3)
new Fraction(7, 2)
```
</details>

### Reading it

```
base.bpm         # the BaseNote's beats per measure
[5].bpm          # note 5's (or the BaseNote's, if note 5 defines none)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('beatsPerMeasure')
```
</details>

### Deriving a measure length

```
measure(base)              # the BaseNote's measure length in seconds; stored as base.ml
beat(base) * base.bpm      # the same value, written out
measure(base) * 2          # two measures
measure(base) * (1/2)      # half a measure
```

`beat(base) * base.bpm` is exactly what the shipped scale-system modules put in the BaseNote's
`measureLength`.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findMeasureLength(module.baseNote)
module.findMeasureLength(module.baseNote).mul(new Fraction(2))
```
</details>

## Common meters

Measure length is a beat count, so a compound meter has to be expressed in the unit the tempo
defines. With a quarter-note beat:

| Feel | beatsPerMeasure | Measure length at 120 BPM |
|---|---|---|
| 4/4 | `4` | 2 s |
| 3/4 | `3` | 1.5 s |
| 2/4 | `2` | 1 s |
| 5/4 | `5` | 2.5 s |
| 6/8 (six eighths) | `3` | 1.5 s |
| 7/8 (seven eighths) | `(7/2)` | 1.75 s |

## Measure bars and mixed meters

A note with a `startTime` but **no `duration` and no `frequency`** is a **measure bar**. It is drawn
as a vertical dashed line, never sounds, and is where a per-measure `beatsPerMeasure` lives. Measure
bars are chained through `startTime`, each one starting a measure length after the previous:

```json
{ "id": 1, "startTime": "base.t" },
{ "id": 2, "startTime": "[1].t + measure([1])" },
{ "id": 3, "startTime": "[2].t + measure([2])", "beatsPerMeasure": "3" },
{ "id": 4, "startTime": "[3].t + measure([3])" }
```

Measure 3 is three beats long; measures 1, 2 and 4 inherit 4 beats from the BaseNote. Because
measure 4 starts at `[3].t + measure([3])`, shortening measure 3 pulls measure 4 — and everything
anchored after it — earlier. That is the whole mixed-meter mechanism; there is no separate
time-signature object.

::: tip
A measure bar's length is derived from *its own* `beatsPerMeasure` and *its own* `tempo`
(falling back to the BaseNote's for either). Regular notes do not get a derived measure length: for
them, `[N].ml` resolves to the BaseNote's measure length unless they define `measureLength`
explicitly.
:::

To add measures, select the **BaseNote** — the row is labelled **Add New Measure Chain** — or the
**last measure of an existing chain**, where it is labelled **Add Measure**. Then press **Add**. The
row does not appear on a regular note, or on a measure in the middle of a chain.

## Dependencies

Changing the BaseNote's `beatsPerMeasure` re-evaluates every measure length derived from it, and
therefore every measure bar downstream in a chain, and therefore every note anchored to those
measures. Referencing another note's `bpm` (`[5].bpm`) creates a real dependency on note 5.

## In the workspace

**Vertical dashed lines** are the measure bars, one per measure, spaced by each measure's own
length. They move when tempo or `beatsPerMeasure` changes. (The *horizontal dotted* lines are the
octave guides — see [frequency](/reference/properties/frequency).)

Each measure bar carries a triangle handle at the top; drag it to move the measure, click it to open
the measure widget.

## See also

- [tempo](/reference/properties/tempo)
- [duration](/reference/properties/duration)
- [startTime](/reference/properties/start-time)
- [Working with Measures](/tutorials/intermediate/measures)
