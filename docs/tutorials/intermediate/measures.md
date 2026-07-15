---
title: Working with Measures
description: Build measure chains from the note widget, set per-measure time signatures, and position notes by measure and beat instead of absolute time.
---

# Working with Measures

Measures are the dashed vertical lines that divide the workspace into bars. They are notes — a special kind, with a start time and nothing else — and you build them into chains, where each bar starts where the last one ended.

**Prerequisites:** [Note Dependencies](/tutorials/intermediate/dependencies), [Add Rhythm](/tutorials/beginner/rhythm).

## Tempo lives on the BaseNote

Click the **BaseNote** and you get rows for `startTime`, `frequency`, **`tempo`**, **`beatsPerMeasure`**, and `instrument`. The defaults:

| Property | Default |
|---|---|
| `tempo` | `100` BPM |
| `beatsPerMeasure` | `4` |

Click any ordinary note and you get `startTime`, `duration`, `frequency`, `color` and `instrument` — **no tempo row**. Tempo is a property of the piece, not of a note.

From tempo, two derived quantities fall out:

```
beat(base)              # one beat, in seconds: 60 / tempo
measure(base)           # one measure, in seconds: beatsPerMeasure × 60 / tempo
```

At the defaults, `beat(base)` is 0.6 s and `measure(base)` is 2.4 s.

::: info Helpers are input sugar
You type `measure(base)` and `tempo(base)`; the app stores the same bytecode as `base.ml` and `base.tempo`, and that is what the `Raw:` field will show you afterwards. `beat()` is the one helper that survives the round trip and is displayed back to you as `beat(...)`. All three forms are equivalent — do not be surprised when your `measure([1])` reappears as `[1].ml`.
:::

## Build a measure chain

1. Click the **BaseNote**, **Clean Slate** the workspace, and click the BaseNote again.
2. Find the row labelled **Add New Measure Chain** and click **Add**.

A dashed vertical line appears at time 0 with a small triangle at the top. That triangle is the measure's handle. The widget re-opens on it, titled **Measure [1] Variables**.

3. With Measure 1 selected, the widget now offers **Add Measure**. Click **Add**.

Measure 2 appears one measure-length later. Click **Add** again for Measure 3, and again for Measure 4.

::: info
**Add Measure** only appears on the **last** measure of a chain. If you select a measure in the middle, the button is not there — you cannot insert a bar into the middle of a chain from the widget.
:::

Select any measure and read its `startTime`:

```
[1].t + [1].ml
```

"Start where measure 1 starts, plus measure 1's length." That is the chain. Each bar depends on the one before it, so lengthening any bar pushes every later bar along.

## A measure widget is nearly empty

Click a measure triangle and you get:

- a **startTime** row,
- a **Measure Duration** row,
- **Add Measure**, if it is the last in its chain,
- **EVALUATE** (Evaluate to BaseNote only — no Liberate),
- **DELETE NOTE**.

No frequency, no duration, no colour, no instrument, and no **ADD NOTE / SILENCE** section. You cannot hang a note directly off a measure bar from the widget — but you *can* drag a library module onto one, and you can reference it from any note's expression.

## Change a time signature

The **Measure Duration** row edits that measure's `beatsPerMeasure` — how many beats the bar holds.

1. Click **Measure 3**'s triangle.
2. In the **Measure Duration** row, the `Raw:` field shows `4` (inherited from the BaseNote).
3. Change it to `3`.
4. Click **Save**.

Measure 3 becomes a 3-beat bar. It visibly narrows, and **Measure 4 and everything after it slide left**, because they are chained to it. You have a 4/4, 4/4, 3/4, 4/4 piece.

::: warning
The Save button on this row is hidden until you type in the field, and the row has no `Evaluated:` readout — you get the raw value only. Odd meters work too: `(7/8)` and `(5/4)` are both valid.
:::

To change the whole piece's meter instead, set `beatsPerMeasure` on the **BaseNote**. Every measure that has not overridden it follows.

## Positioning notes by measure

### On a bar line

The cleanest way to say "start at measure 3" is to reference measure 3. Put this in the note's **startTime**:

```
[3].t
```

This is robust: it stays correct even if you change the length of measure 1 or 2. Use it.

### Counting from the BaseNote

```
base.t                          # measure 1
base.t + measure(base)          # measure 2
base.t + measure(base) * 2      # measure 3
```

::: warning
This arithmetic only works while **every** measure is the same length. The moment you give one bar a different `beatsPerMeasure`, `measure(base) * 2` stops being "the start of measure 3". Reference the measure bar instead.
:::

### A beat inside a measure

Beat 3 of measure 2 — two beats past the bar line:

```
[2].t + beat(base) * 2
```

Beats are counted from zero, so "beat 3" is `* 2`.

## Practical: a kick-snare pattern

Four bars of the workspace, a note on beat 1 and beat 3 of each.

Build a measure chain of four bars first, then create notes from the BaseNote and set their start times:

| Note | startTime | duration |
|---|---|---|
| Kick, bar 1 | `[1].t` | `beat(base)` |
| Snare, bar 1 | `[1].t + beat(base) * 2` | `beat(base)` |
| Kick, bar 2 | `[2].t` | `beat(base)` |
| Snare, bar 2 | `[2].t + beat(base) * 2` | `beat(base)` |

Now change the BaseNote's tempo. The bars, the kicks and the snares all move together, and the pattern stays a pattern. Change measure 2's **Measure Duration** to `3` and the second bar's snare lands correctly inside the shorter bar, while measure 3 slides left to meet it.

## On per-note tempo

::: warning There is no tempo change mid-composition
The note widget exposes no `tempo` field on an ordinary note, so **a tempo change cannot be authored in the app**. Tempo is a BaseNote property, and one piece has one tempo.

You may see `beat([1])` in an expression — the app writes that form itself when you drag a note. It reads note 1's tempo and, because no ordinary note can carry one, falls back to the BaseNote's. So in practice `beat([N])` and `beat(base)` give the same answer for every note you can build in the app.
:::

## One duration this page adds

The note-length table — whole through triplet eighth, all as multiples of `beat(base)` — is in
[Add Rhythm](/tutorials/beginner/rhythm#duration-reference). Measures add one entry to it: a
duration of one full bar is `measure(base)`, or equivalently `beat(base) * base.bpm`. Both are
tempo-independent, like every duration written in beats.

## Exercises

### 1. A waltz

Set the BaseNote's `beatsPerMeasure` to `3` and its `tempo` to `150`. Build a four-bar chain and put a note on each beat. Compare with the shipped **Greensleeves** and **Bach Minuet in G** melodies in the library, both of which are in 3.

### 2. A hemiola

Give measures 1 and 2 a Measure Duration of `3`, and measure 3 a Measure Duration of `2`. Watch the chain re-flow.

### 3. Two chains

From the **BaseNote**, click **Add New Measure Chain** a second time. You get a second chain starting at `base.t`, independent of the first. Both anchor to the BaseNote; neither depends on the other.

### 4. Drop a melody onto a bar line

Drag **Ode to Joy** from the library's **Melodies** section onto a measure triangle. Its timing anchors to that bar; its pitches stay anchored to `base.f`, because a measure bar has no frequency to inherit.

## What you learned

- Tempo and `beatsPerMeasure` live on the BaseNote; ordinary notes have neither.
- Measure chains are built with **Add New Measure Chain** and **Add Measure**, and each bar depends on the one before it.
- **Measure Duration** sets a per-measure time signature.
- Reference a bar (`[3].t`) rather than counting measure lengths.

## Next

- [Microtonal Composition](/tutorials/advanced/microtonal) — alternative tunings
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) — deeper structures
- [beatsPerMeasure reference](/reference/properties/beats-per-measure) — the property in full
