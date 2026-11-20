---
title: Working with Measures
description: Build a chain of measure bars from the note widget, change the meter on one bar, and attach notes to bars instead of absolute time.
---

# Working with Measures

Measure bars are the dashed vertical lines that divide the workspace into bars. A bar is a note: a silent one with a start and a duration, no frequency, and the flag `"measure": true`. You build bars into a chain, where each bar starts where the one before it ends and, unless you say otherwise, lasts as long.

**Prerequisites:** [Note Dependencies](/tutorials/intermediate/dependencies), [Add Rhythm](/tutorials/beginner/rhythm).

## The time unit and the first bar

Click the **BaseNote**. Its rows are `startTime`, `frequency`, `duration`, the interpretation rows (`amplitude`, `attack`, `release`) and `instrument`. There is no tempo row and no beats-per-measure row. The BaseNote's `duration` is the **time unit**, and next to it the widget shows the same number as a tempo, for example "= 100 BPM". That reading is only a view; to change the pace you edit the duration.

At the defaults `base.d` is 3/5 s. A bar of four time units lasts `base.d * 4`, which is 2.4 s.

## Build a bar chain

1. Click the **BaseNote**, **Clean Slate** the workspace, and click the BaseNote again.
2. Find the row labelled **Add New Measure Chain** and click **Add**.

A dashed vertical line appears at time 0 with a small triangle at the top. That triangle is the bar's handle. The widget re-opens on it, titled **Measure [1] Variables**. Its expressions are:

```
startTime:  base.t
duration:   base.d * 4
```

3. With bar 1 selected, the widget offers **Add Measure**. Click **Add**.

Bar 2 appears one bar-length later. Click **Add** again for bar 3, and again for bar 4. Select bar 2 and read it:

```
startTime:  [1].t + [1].d
duration:   [1].d
```

"Start where bar 1 ends, and be as long as bar 1." Each bar depends on the one before it, so lengthening any bar pushes every later bar along.

::: info
**Add Measure** only appears on the **last** bar of a chain. If you select a bar in the middle, the button is not there. You cannot insert a bar into the middle of a chain from the widget.
:::

## A bar widget is nearly empty

Click a bar's triangle and you get:

- a **startTime** row,
- a **duration (bar length)** row, which shows "= 4 time units" beside the value,
- **Add Measure**, if it is the last bar in its chain,
- **EVALUATE** (Evaluate to BaseNote only; no Liberate),
- **DELETE NOTE**.

No frequency, no colour, no instrument, and no **ADD NOTE / SILENCE / REFERENCE** section. You cannot create a note directly from a bar in the widget, but you can drag a library module onto one, and you can reference the bar from any note's expression.

## Change the meter on one bar

A bar's length is its own duration, an expression like any other. There is no separate meter property.

1. Click bar 3's triangle.
2. In the **duration (bar length)** row, the `Raw:` field shows `[2].d`.
3. Change it to `base.d * 3`.
4. Click **Save**.

Bar 3 becomes a 3-unit bar. It visibly narrows, and **bar 4 slides left**, because bar 4 starts at `[3].t + [3].d`. Bar 4 also lasts `[3].d`, so it is a 3-unit bar too: the lengths are now 4, 4, 3, 3. To return to four after one short bar, give bar 4 a duration of `base.d * 4`.

::: tip
Odd meters work too: `base.d * (7/2)` is a bar of seven eighth notes, which reads as 7/8. The MIDI export writes a time signature from the first bar only; see [Exporting MIDI](/user-guide/modules/exporting-midi).
:::

You can also drag a bar's triangle. Dragging changes the length of the **previous** bar; the dragged bar keeps its own length.

## Attach notes to bars

### On a bar line

The cleanest way to say "start at bar 3" is to reference bar 3. Put this in the note's **startTime**:

```
[3].t
```

This stays correct whatever you do to bars 1 and 2.

### A fraction of a bar

To place a note a quarter of the way into bar 2, and give it a quarter of the bar's length:

```
startTime:  [2].t + [2].d * (1/4)
duration:   [2].d * (1/4)
```

Both are written against the bar's own start and duration, so the note moves and stretches with the bar. In a bar you shortened to three units, a quarter is three quarters of a time unit; in a bar of four units it is one.

### A fixed number of beats into a bar

Beat 3 of bar 2, two time units past the bar line:

```
[2].t + base.d * 2
```

Beats are counted from zero, so "beat 3" is `* 2`. This one does not scale with the bar; it always sits two time units in.

## Practical: a kick-snare pattern

Build a chain of four bars first, then create notes from the BaseNote and set their expressions:

| Note | startTime | duration |
|---|---|---|
| Kick, bar 1 | `[1].t` | `base.d` |
| Snare, bar 1 | `[1].t + base.d * 2` | `base.d` |
| Kick, bar 2 | `[2].t` | `base.d` |
| Snare, bar 2 | `[2].t + base.d * 2` | `base.d` |

Now change the BaseNote's `duration`. The bars, the kicks and the snares all stretch together, and the pattern stays a pattern. Shorten bar 2 to `base.d * 3` and bar 3 slides left to meet it. The bar 2 snare, written as two time units in, still lands on its third unit.

## One pace per module

::: warning There is no tempo change mid-composition
Tempo is not stored on any note. A single time unit, `base.d`, sets the pace for everything written in time units, so one module has one pace.

You can still write a stretch of music against another note's length: `[7].d * 2` is twice as long as note 7, however long that is. Change note 7 and everything written against it follows.
:::

## One duration this page adds

The note-length table, from whole to triplet eighth, all as multiples of `base.d`, is in [Add Rhythm](/tutorials/beginner/rhythm#duration-reference). Bars add one entry to it: a bar's length is its own duration, `[bar].d`, and a bar that follows another can copy it with `[p].d`.

## Exercises

### 1. A waltz

Set the first bar of a four-bar chain to `base.d * 3` and set the BaseNote's `duration` to `2/5` (150 BPM). Put a note on each beat. Compare with the shipped **Greensleeves** and **Bach Minuet in G** melodies in the library, both of which are in 3.

### 2. A hemiola

In a four-bar chain, give bar 1 a length of `base.d * 3`, and bar 2 a length of `base.d * 2`. Bar 3 copies bar 2, so give it `base.d * 3` to move on. Watch the chain re-flow.

### 3. Two chains

From the **BaseNote**, click **Add New Measure Chain** a second time. You get a second chain starting at `base.t`, independent of the first. Both anchor to the BaseNote; neither depends on the other.

### 4. Drop a melody onto a bar line

Drag **Ode to Joy** from the library's **Melodies** section onto a bar triangle. Its start maps to that bar; its pitches stay anchored to the BaseNote's frequency, because a bar has no frequency to map to, and its durations stay in the workspace's time unit, `base.d`.

## What you learned

- The BaseNote's `duration` is the time unit. There is no stored tempo or beats-per-measure.
- Bars are silent notes flagged `measure`. A chain is `[p].t + [p].d` for the start and `[p].d` for the length.
- A meter change is one bar's duration; the bars after it follow.
- Attach notes to bars with `[bar].t` and `[bar].d * (1/4)` rather than counting lengths.

## Next

- [Microtonal Composition](/tutorials/advanced/microtonal) — alternative tunings
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) — deeper structures
- [Measure bars](/reference/module-schema#measure-bars) — the bar in the file format
- [The time unit](/reference/properties/duration#the-time-unit) — `base.d` in full
