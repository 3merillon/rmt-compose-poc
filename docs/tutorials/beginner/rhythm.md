---
title: Add Rhythm
description: Work with beats, note durations, dotted notes and silences in RMT Compose to build a rhythmic phrase that survives a tempo change.
---

# Add Rhythm

You will build a four-note rhythmic phrase — quarter, eighth, eighth, half — and then change the tempo without touching a single note.

**Prerequisites:** [Build a Major Scale](/tutorials/beginner/major-scale).

## Time in RMT Compose

Three properties carry the timing:

| Property | What it is | Unit |
|---|---|---|
| `tempo` | beats per minute — a **BaseNote** property | BPM |
| `startTime` | when the note begins | seconds |
| `duration` | how long it sounds | seconds |

Start times and durations are in *seconds*, but you almost never write seconds. You write beats, and let `beat()` do the conversion:

```
beat(base)
```

`beat(base)` is one beat at the BaseNote's tempo: 60 seconds divided by the tempo. At the default 100 BPM that is 0.6 seconds. Write durations as multiples of it and they stay musically correct at any tempo.

::: warning
Write the beat as `beat(base)`. Spelling the division out by hand does **not** work — the parser does not accept `60 / tempo(base)`, and the failure is silent.
:::

## Duration reference

| Note | Beats | Expression |
|---|---|---|
| Whole | 4 | `beat(base) * 4` |
| Half | 2 | `beat(base) * 2` |
| Quarter | 1 | `beat(base)` |
| Eighth | 1/2 | `beat(base) * (1/2)` |
| Sixteenth | 1/4 | `beat(base) * (1/4)` |
| Dotted quarter | 3/2 | `beat(base) * (3/2)` |
| Double-dotted quarter | 7/4 | `beat(base) * (7/4)` |
| Triplet eighth | 1/3 | `beat(base) * (1/3)` |

## Step 1: Clear the workspace

Click the **BaseNote**, scroll to **DELETE ALL NOTES**, click **Clean Slate**, confirm.

The BaseNote stays at 263 Hz, **100 BPM**, 4 beats per measure.

## Step 2: The quarter note

1. Click the **BaseNote** to reopen its widget.
2. In **ADD NOTE / SILENCE**, the defaults are already what you want:
   - **Frequency:** `base.f`
   - **Duration:** `beat(base)`
   - **Start Time:** `base.t`
3. Click **Create**.

Note 1: one beat long.

## Step 3: Two eighth notes

1. Select **Note 1**. Position stays on **At End**.
2. Set **Frequency** to `base.f * (9/8)` and **Duration** to `beat(base) * (1/2)`.
3. Click **Create Note**.

Note 2 starts where Note 1 ends (`[1].t + [1].d`, filled in for you) and lasts half a beat.

Now do it again from Note 2:

1. Select **Note 2**. **At End**.
2. **Frequency:** `base.f * (5/4)`. **Duration:** prefilled as `beat(base) * (1/2)` — inherited from Note 2, so leave it.
3. Click **Create Note**.

## Step 4: The half note

1. Select **Note 3**. **At End**.
2. **Frequency:** `base.f * (3/2)`. **Duration:** `beat(base) * 2`.
3. Click **Create Note**.

## Step 5: Listen

Press **Play**. You should hear: *taa — ti-ti — taaaa*.

The four durations add up to 1 + ½ + ½ + 2 = 4 beats — exactly one 4/4 measure. In the workspace, Note 4 is twice as wide as Note 1, and Notes 2 and 3 are half as wide.

::: tip
**Shift-click Play** (or long-press it) to loop the phrase. The play icon's bars shrink into dashes that orbit a figure-8 while the loop runs. Shift-click again to exit.
:::

## Step 6: Change the tempo

1. Click the **BaseNote**.
2. On the **tempo** row, set the `Raw:` field to `60`.
3. Click **Save**.

Everything slows down and stays in proportion. You wrote every duration as a multiple of `beat(base)`, and every start time as "when the previous note ends" — so the rhythm is a set of relationships, not a set of timestamps.

Try `160`. Then put it back to `100`.

## Duration without typing

Two faster ways to set a duration.

**The icon buttons.** Select a note, find the **duration** row, and click one of the five note-length icons: whole, half, quarter, eighth, sixteenth. The two dot buttons multiply what you picked — `.` by 3/2, `..` by 7/4 — and clicking a selected dot again removes it.

::: warning
The icon buttons write the expression into the `Raw:` field and reveal the **Save** button. They do **not** commit. You still have to click **Save**.
:::

The widget pre-highlights the icon matching the note's current duration. If the duration is not one of the five (a triplet, say), no icon lights up. That is correct, not a bug.

**Dragging.** Grab a note's **right edge** in the workspace — the cursor becomes a horizontal resize arrow — and drag. The duration follows, and the note's expression is rewritten for you in beats. Dragging the note's **body** moves it in time instead.

## Silences are real notes

To put a rest in your phrase, do not fake it with an inaudible frequency. Use a silence.

1. Select the note the rest should follow.
2. In **ADD NOTE / SILENCE**, switch the kind radio from **Note** to **Silence**.

   The Frequency field disappears — that is what a silence *is*: a note with a start time and a duration and no frequency.
3. Set the **Duration** to how long the rest should last.
4. Click **Create Note**.

The silence takes an id and appears in the workspace with a dashed outline. Its widget is titled **Silence [N] Variables**. Notes can reference its `startTime` and `duration` like any other note, so a silence chains a phrase exactly the way a sounding note does.

## Exercises

### 1. Dotted rhythm

Select Note 1. On the duration row, click the **quarter** icon, then the **`.`** dot. The Raw field becomes `beat(base) * (3/2)`. Click **Save**. Now shorten Note 2 to a sixteenth so the bar still adds up.

### 2. Triplets

Set three consecutive notes to `beat(base) * (1/3)`. Three notes in the space of one beat. No icon will highlight for these — expected.

### 3. Syncopation

Give Note 1 a duration of `beat(base) * (3/2)`. Because Notes 2, 3 and 4 are chained with `[N].t + [N].d`, they all shift later automatically, and the accents land off the beat.

### 4. Rest on the downbeat

Insert a silence of `beat(base)` before Note 1's material and watch the whole phrase slide right, still intact.

## Chaining, in one line

Every note after the first uses this start time:

```
[1].t + [1].d
```

"Start when Note 1 ends." The **At End** radio writes it for you. It is the single most useful expression in the app — change any duration anywhere in the chain and everything downstream re-flows.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
```
</details>

## What you learned

- `beat(base)` converts beats to seconds, so durations survive a tempo change.
- The duration icons and dots write an expression; **Save** commits it.
- Dragging a note's right edge resizes it; dragging its body moves it.
- Silences are a first-class note kind, created from the same section.

## Next

- [Working with Measures](/tutorials/intermediate/measures) — measure chains and time signatures
- [Note Dependencies](/tutorials/intermediate/dependencies) — the general rule behind chaining
- [Transport Controls](/user-guide/playback/transport) — play, stop, loop, playhead tracking
