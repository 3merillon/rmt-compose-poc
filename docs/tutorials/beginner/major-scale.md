---
title: Build a Major Scale
description: Build an eight-note just-intonation major scale in RMT Compose, one note at a time, using pure frequency ratios.
---

# Build a Major Scale

You will build an eight-note major scale — Do Re Mi Fa Sol La Ti Do — where every pitch is an exact fraction of the BaseNote's frequency.

**Prerequisites:** the app running, and a skim of [Core Concepts](/getting-started/concepts).

## The ratios

| Degree | Name | Ratio | Expression |
|---|---|---|---|
| 1 | Do | 1/1 | `base.f` |
| 2 | Re | 9/8 | `base.f * (9/8)` |
| 3 | Mi | 5/4 | `base.f * (5/4)` |
| 4 | Fa | 4/3 | `base.f * (4/3)` |
| 5 | Sol | 3/2 | `base.f * (3/2)` |
| 6 | La | 5/3 | `base.f * (5/3)` |
| 7 | Ti | 15/8 | `base.f * (15/8)` |
| 8 | Do | 2/1 | `base.f * 2` |

Note that fractions are parenthesised and whole numbers are not. `(9/8)` is a fraction literal; `2` is a plain number.

## Step 1: Clear the workspace

The app opens with a 169-note demo composition. Get rid of it.

1. Click the **BaseNote** — the orange circle at the far left.
2. The note widget opens, titled **BaseNote Variables**.
3. Scroll to the bottom, to the **DELETE ALL NOTES** section.
4. Click **Clean Slate**, then **Yes, Clean Slate**.

::: warning
The dialog says "This action cannot be undone." It is wrong — Clean Slate is captured in the undo history and `Ctrl+Z` brings the composition back.
:::

Clean Slate closes the note widget and clears the selection. The BaseNote keeps its defaults: **263 Hz**, **100 BPM**, 4 beats per measure. Leave them alone — the scale is built from ratios, so the starting pitch does not matter.

## Step 2: Create Do

1. Click the **BaseNote** again to reopen its widget.
2. Scroll to the **ADD NOTE / SILENCE** section.
3. Leave the kind set to **Note**.
4. The three fields are already filled in for you:
   - **Frequency:** `base.f`
   - **Duration:** `beat(base)`
   - **Start Time:** `base.t`
5. Click **Create**.

::: info
On the BaseNote the button reads **Create**, not "Create Note", and there is no At Start / At End choice — a note added from the BaseNote always starts at `base.t`.
:::

The new note appears, gets selected, and the widget re-opens on it as **Note [1] Variables**. That is your Do, at 1/1.

## Step 3: Create Re

Now you are working from a normal note, and the widget looks different.

1. With Note 1 selected, scroll to **ADD NOTE / SILENCE**.
2. Leave the kind on **Note** and the position on **At End** — this is the default, and it is what you want for a scale. Each note starts where the previous one stops.
3. The fields prefill from Note 1:
   - **Frequency:** `[1].f` ← you will replace this
   - **Duration:** `beat(base)` ← leave it
   - **Start Time:** `[1].t + [1].d` ← leave it; this is what "At End" means
4. Replace the **Frequency** field with:

```
base.f * (9/8)
```

5. Click **Create Note**.

::: tip
The `Evaluated:` line above each field updates as you type. It prints `Invalid` if the expression does not parse — this live preview is the one place in the widget that does not wait for a Save.
:::

## Steps 4–9: the rest of the scale

Repeat Step 3 six more times. Each time: select the note you just made, keep **At End**, overwrite the **Frequency** field, click **Create Note**.

| Create | Select first | Frequency field |
|---|---|---|
| Mi (Note 3) | Note 2 | `base.f * (5/4)` |
| Fa (Note 4) | Note 3 | `base.f * (4/3)` |
| Sol (Note 5) | Note 4 | `base.f * (3/2)` |
| La (Note 6) | Note 5 | `base.f * (5/3)` |
| Ti (Note 7) | Note 6 | `base.f * (15/8)` |
| Do (Note 8) | Note 7 | `base.f * 2` |

Every note anchors its *pitch* to the BaseNote and its *timing* to the note before it. That split is deliberate, and Step 11 shows why it matters.

<details>
<summary>Legacy JavaScript syntax</summary>

Older modules store expressions as method chains. The widget decompiles them to DSL for display, so you will not need to type this — but you may see it in a hand-edited file.

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(9, 8))
```
</details>

## Step 10: Listen

Press **Play** in the top bar. You should hear eight notes climbing, and the last should sound like the first an octave higher.

Select each note in turn and read the `Evaluated:` line on its frequency row. At the default 263 Hz base:

| Note | Raw | Evaluated |
|---|---|---|
| 1 | `base.f` | 263 |
| 2 | `base.f * (9/8)` | 2367/8 |
| 5 | `base.f * (3/2)` | 789/2 |
| 8 | `base.f * 2` | 526 |

The values are exact fractions, not decimals. Nothing here is rounded.

## Step 11: Transpose the whole scale at once

This is the point of the exercise.

1. Click the **BaseNote**.
2. On the **frequency** row, change the `Raw:` field to `330`.
3. Click **Save**.

Every note in the scale moves. You wrote the pitches as ratios of `base.f`, so they are still a major scale — just a higher one. Nothing was recalculated by hand.

Change it back to `263` when you are done.

## The eight-drag alternative

Every interval in the table above already ships as a module. You do not have to type them.

1. In the module bar, expand **Intervals** (46 modules).
2. Set the drop mode to **End** — click the ⇥ button next to Undo/Redo in the module bar's toolbar. This makes each dropped module land at the end of the note you drop it on, which is what chains a scale together.
3. Drag **Major 2nd** (9/8) onto your Do note. Drag **Just major 3rd** (5/4) onto the note that appears. Keep going: Perfect 4th, Perfect 5th, Just major 6th, Just major 7th, Octave.

Each interval module is a single note whose frequency is `(N/D) * base.f` — dropping it onto a note re-anchors it to *that* note, so you get the interval above whatever you dropped on.

::: tip
Click the **magnifier** in the library toolbar to search. It matches on name, ratio, family and tags, so typing `3/2` or `fifth` both find the Perfect 5th.
:::

## Saving your scale

Two ways, and the second is usually better.

**Into the library.** Shift-drag a marquee across all eight notes (or shift-click them one by one). The group widget appears. Click **Copy to Modules**. Your scale lands in the library's **Custom** section as `Selection (8 notes)`, and it survives a reload. You can now drag it onto any note.

**To a file.** Open the **+** menu in the top bar and click **Save Module**. The download is always named `module.json` — rename it yourself, to something like `major-scale-just.json`.

## Exercises

### 1. Make it a minor scale

Change three notes:

| Note | From | To |
|---|---|---|
| Mi (3) | `base.f * (5/4)` | `base.f * (6/5)` |
| La (6) | `base.f * (5/3)` | `base.f * (8/5)` |
| Ti (7) | `base.f * (15/8)` | `base.f * (9/5)` |

### 2. Slow it down

Select a note, find the **duration** row, and click the **half note** icon. The Raw field fills with `beat(base) * 2` — then click **Save**. The icon buttons write the expression for you; they do not commit it.

### 3. Hear the difference against 12-TET

Drag the **12-TET** module from the library's **Scale Systems** section onto the BaseNote. Play both. The just major third (5/4, 386¢) is noticeably flatter and calmer than the 12-TET one (2^(4/12), 400¢).

## What you learned

- Major-scale degrees as exact ratios of a single reference pitch.
- **At End** chains notes in time; the frequency stays anchored to the BaseNote.
- Changing the BaseNote transposes everything that references it.
- The Intervals library already contains every ratio you typed.

## Next

- [Create a Major Triad](/tutorials/beginner/major-triad) — the same ratios, sounding together
- [Add Rhythm](/tutorials/beginner/rhythm) — durations, dots and silences
- [Pure Ratios](/user-guide/tuning/ratios) — why these fractions and not others
