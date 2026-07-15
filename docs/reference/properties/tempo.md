---
title: tempo
description: Reference for the tempo property - the beat unit, inheritance from the BaseNote, per-note overrides, and worked examples.
---

# tempo

`tempo` is the speed of the composition in **beats per minute**. It is not a transport setting: it
is a note property, stored as an expression like any other, and it affects the music only through
the expressions that read it.

Nothing is "played at a tempo". Tempo enters the composition when an expression asks for a beat:

```
beat(base)          # = 60 / tempo(base) seconds
```

At 60 BPM a beat is 1 second; at 120 BPM it is 0.5 seconds. Change the BaseNote's tempo and every
duration and offset written in beats re-evaluates.

## Aliases

| Write | Meaning |
|---|---|
| `tempo` | the only spelling — there is no short alias |

`base.tempo`, `[3].tempo` and the helper form `tempo(base)` are all valid. `tempo(x)` and `x.tempo`
compile to identical bytecode, and the helper form is rewritten to the property form on save:
`tempo(base)` is stored as `base.tempo`.

## Defaults

| Situation | Value |
|---|---|
| BaseNote in a module created from scratch | `60` |
| BaseNote in `defaultModule.json` (what you get on first load) | `100` |
| A note with no `tempo` expression | inherits the BaseNote's tempo |
| Nothing resolvable at all | `60` (silent fallback) |

Tempo is one of the three **inheriting** properties, along with `beatsPerMeasure` and
`measureLength`. `[5].tempo` on a note that defines no tempo of its own yields the BaseNote's tempo.
(`startTime`, `duration` and `frequency` do not inherit.)

## Where you edit it

Click the **BaseNote** — the circle to the left of time zero — to open its widget. It has a `tempo`
row with an `Evaluated:` readout and a `Raw:` input. Type a value and press **Save**.

::: warning
There is no `tempo` row in a regular note's widget, and none in a measure's. The note widget only
exposes `startTime`, `duration`, `frequency`, `color` and `instrument`. **A per-note tempo can only
be set by editing the module JSON.**
:::

There is no UI for `measureLength` either — it is derived (see below).

## What a per-note tempo actually does

A `tempo` expression on a note is read in exactly two places:

1. **Expressions that name that note.** `beat([5])`, `tempo([5])` and `[5].tempo` resolve to note
   5's own tempo. Anything not written against note 5 is unaffected.
2. **A measure bar's own length.** A measure bar with its own `tempo` gets a measure length of
   `beatsPerMeasure / tempo * 60`, so its bar is longer or shorter than its neighbours.

::: warning A per-note tempo does not cascade
Setting `tempo` on note 5 does **not** re-time the notes that come after it. Notes read the BaseNote
tempo unless their expression explicitly references note 5's. A "tempo change from bar 9 onwards"
therefore has to be written into the expressions of the notes it should affect (for example, by
writing their durations as `beat([5]) * (n/d)`), or built from a measure chain whose measure bars
carry the new tempo.
:::

## Expression examples

### A fixed tempo on the BaseNote

```
60     # one beat per second
100    # the default module's tempo
120
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(60)
new Fraction(120)
```
</details>

### Reading a tempo

```
tempo(base)     # the BaseNote's tempo, stored as base.tempo
base.tempo      # the same thing
tempo([5])      # note 5's tempo (or the BaseNote's, if note 5 defines none)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findTempo(module.baseNote)
module.findTempo(module.getNoteById(5))
```

`module.findTempo(x)` is the legacy equivalent of `tempo(x)`.
`module.baseNote.getVariable('tempo')` is **not** — it is a plain property read, and it does not
fall back to the BaseNote when used on another note.
</details>

### The beat unit

```
beat(base)              # 60 / tempo(base) seconds
beat(base) * (3/4)      # a dotted eighth
beat([5])               # one beat at note 5's tempo
```

Always use `beat(x)`. It is what the app itself writes, and it is the only helper the decompiler
reconstructs, so it survives a save. Writing the division out by hand as `60 / base.tempo` also
works, and is normalised straight back to `beat(base)`.

::: tip Put the helper call first
An expression whose *only* DSL marker is a `beat(…)`, `tempo(…)` or `measure(…)` call is sniffed
as DSL only when that call is the **first thing in the expression**. Otherwise it is handed to the
legacy parser first, which cannot read it — the failure then falls through to a DSL retry, so the
expression still compiles, at the cost of a wasted parse.

| Write | Routing |
|---|---|
| `beat(base) * 2` | DSL directly — the helper leads |
| `2 * beat(base)` | legacy first, compiles on the DSL retry |
| `60 / tempo(base)` | legacy first, compiles on the DSL retry |
| `1 + beat(base)` | legacy first, compiles on the DSL retry |
| `(1/2) * beat(base)` | DSL directly — the leading fraction is itself a DSL marker |
| `base.t + beat(base)` | DSL directly — `base.` is a DSL marker |
| `60 / base.tempo` | DSL directly, and normalised back to `beat(base)` |

Lead with the helper, or with a note reference, and the sniff gets it right the first time.
:::

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(60).div(module.findTempo(module.baseNote))
```
</details>

## Beat length and note durations

| Note value | At 60 BPM | At 100 BPM | At 120 BPM |
|---|---|---|---|
| Whole (4 beats) | 4 s | 2.4 s | 2 s |
| Half (2 beats) | 2 s | 1.2 s | 1 s |
| Quarter (1 beat) | 1 s | 0.6 s | 0.5 s |
| Eighth (1/2 beat) | 0.5 s | 0.3 s | 0.25 s |
| Sixteenth (1/4 beat) | 0.25 s | 0.15 s | 0.125 s |

## Tempo and measure length

Measure length in seconds is derived, never authored by the UI:

```
measureLength = beatsPerMeasure / tempo * 60
```

It is computed for **measure bars and the BaseNote**. A regular note that does not define
`measureLength` gets the BaseNote's when an expression asks for `[N].ml`.

```
measure(base)     # the BaseNote's measure length in seconds; stored as base.ml
```

At 120 BPM in 4/4: `4 / 120 * 60 = 2` seconds.

## Dependencies

A tempo change on the BaseNote re-evaluates every note whose expressions read a beat or a measure —
which, in a normally-authored module, is nearly all of them. The dependency is carried by the
`base.*` reference on the expression rather than by a graph edge, but the effect is the same: edit
the BaseNote and the whole composition re-times.

Referencing another note's tempo (`beat([5])`) creates a real dependency on note 5.

## In the workspace

Tempo has no direct visual of its own. It changes the spacing of everything written in beats: at a
slower tempo, beat-relative notes get wider and measure bars get further apart.

## See also

- [duration](/reference/properties/duration)
- [beatsPerMeasure](/reference/properties/beats-per-measure)
- [startTime](/reference/properties/start-time)
- [Transport Controls](/user-guide/playback/transport)
