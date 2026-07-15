---
title: Create a Major Triad
description: Build a three-note just-intonation major chord in RMT Compose using At Start positioning, rooted so the whole chord transposes together.
---

# Create a Major Triad

You will build a major chord whose three notes sound at once — and whose two upper notes are anchored to the root, so moving the root moves the chord.

**Prerequisites:** [Build a Major Scale](/tutorials/beginner/major-scale), or equivalent comfort with the note widget.

## The chord

| Voice | Interval | Ratio above the root |
|---|---|---|
| Root | unison | 1/1 |
| Third | just major third | 5/4 |
| Fifth | perfect fifth | 3/2 |

## Root it properly

There are two ways to write a chord, and only one of them is worth learning.

**Anchored to the BaseNote** — each tone is a ratio of `base.f`:

```
base.f
base.f * (5/4)
base.f * (3/2)
```

**Anchored to the root** — the root is a ratio of `base.f`, and the tones are ratios of *the root*:

```
base.f
(5/4) * [1].f
(3/2) * [1].f
```

Both sound identical. But in the second, the chord is a *structure*: retune or transpose Note 1 and the third and fifth follow it, staying a chord. In the first, they do not — they are three independent pitches that happen to line up.

Every chord module shipped in the library uses the second form. So will you.

## Step 1: Clear the workspace

1. Click the **BaseNote** (the orange circle).
2. Scroll to **DELETE ALL NOTES** and click **Clean Slate**, then **Yes, Clean Slate**.

The BaseNote keeps its defaults: 263 Hz, 100 BPM.

## Step 2: Create the root

1. Click the **BaseNote** again to reopen its widget.
2. Scroll to **ADD NOTE / SILENCE**. Kind stays on **Note**.
3. Set the fields:
   - **Frequency:** `base.f`
   - **Duration:** `beat(base) * 2` (a half note — long enough to hear the chord ring)
   - **Start Time:** `base.t`
4. Click **Create**.

You now have Note 1, selected, with its widget open.

## Step 3: Create the third — At Start

This is the step that makes it a chord rather than a melody.

1. With **Note 1** selected, scroll to **ADD NOTE / SILENCE**.
2. Change the position radio from **At End** to **At Start**.

   Watch the **Start Time** field: it changes from `[1].t + [1].d` to `[1].t`. The new note will start *when Note 1 starts*, not after it.
3. Replace the **Frequency** field with:

```
(5/4) * [1].f
```

4. Leave **Duration** as it is — it prefilled from Note 1, so the two notes are the same length.
5. Click **Create Note**.

::: warning
If you forget to switch to **At Start**, you get an arpeggio, not a chord. The position radio defaults to **At End** every time the widget rebuilds.
:::

## Step 4: Create the fifth

1. Select **Note 1** again — the root. Not Note 2.
2. In **ADD NOTE / SILENCE**, set the position to **At Start** again.
3. Frequency:

```
(3/2) * [1].f
```

4. Click **Create Note**.

## Step 5: Listen and look

Press **Play**. Three notes, one chord.

In the workspace all three notes should be stacked vertically at the same horizontal position, with the same width. Click Note 1 and you will see **orange** dependency lines running to Notes 2 and 3 — thin ones, because they are what *depends on* Note 1. Thick lines would be what Note 1 depends on.

## Step 6: Move the whole chord with one click

The payoff.

1. Select **Note 1** (the root).
2. Click the **▲** arrow — either the one on the left edge of the note in the workspace, or the one on the frequency row of the widget.

The entire chord jumps up an octave. Notes 2 and 3 were never touched: their expressions still say `(5/4) * [1].f` and `(3/2) * [1].f`, and they followed the root for free.

Click **▼** to come back down. Note 1's expression returns to exactly `base.f` — the arrows fold their factor into the expression's coefficient rather than stacking multipliers in front of it.

::: tip
The arrow interval is **not fixed to the octave**. It defaults to ×2 up and ×1/2 down, but **Settings → Arrows** lets you pick any ratio — a fifth, a whole tone, a syntonic comma. Set it to `3/2` and ▲ moves the whole chord up a fifth. See [Transposing with Arrows](/user-guide/notes/transposing).
:::

## The one-drag alternative

The chord you just built ships as a module.

1. In the module library, expand **Chords** (11 modules).
2. Check that the drop mode is **Start** — the ⇤ button next to Undo/Redo in the module bar's toolbar should be filled (it is by default). **Start** makes the chord land *at* the note you drop on rather than after it.
3. Drag **Major** onto any note.

The module is exactly the structure you built: a root on `base.f`, and tones written `(5/4) * [1].f` and `(3/2) * [1].f`. Dropping it on a note re-roots the whole chord onto that note.

## Chord reference

The ratios the shipped chord modules actually use, all relative to the root:

| Module | Colon ratio | Tones |
|---|---|---|
| Major | 4:5:6 | 1/1, 5/4, 3/2 |
| Minor | 10:12:15 | 1/1, 6/5, 3/2 |
| Diminished | 5:6:7 | 1/1, 6/5, 7/5 |
| Augmented | 16:20:25 | 1/1, 5/4, 25/16 |
| Sus4 | 6:8:9 | 1/1, 4/3, 3/2 |
| Major 7th | 8:10:12:15 | 1/1, 5/4, 3/2, 15/8 |
| Minor 7th | 10:12:15:18 | 1/1, 6/5, 3/2, 9/5 |
| Dominant 7th | 36:45:54:64 | 1/1, 5/4, 3/2, 16/9 |
| Harmonic 7th | 4:5:6:7 | 1/1, 5/4, 3/2, 7/4 |
| Base-3 chord | 3:5:7:9 | 1/1, 5/3, 7/3, 3/1 |
| Base-5 chord | 5:7:9:11 | 1/1, 7/5, 9/5, 11/5 |

::: info
The **Dominant 7th** takes 16/9 for its seventh, not 7/4. That is deliberate: 16/9 against the 5/4 third yields the classic 64/45 tritone. The chord built on 7/4 is a different animal, and ships separately as **Harmonic 7th**.
:::

## Exercises

### 1. Minor triad

Select Note 2 and change its frequency to `(6/5) * [1].f`. Save. The chord turns minor, and the root and fifth never moved.

### 2. Add the octave

Select the root, **At Start**, frequency `2 * [1].f`. A fuller, more open chord.

### 3. First inversion

Put the third in the bass by dropping it an octave. Select Note 2 and press **▼** once — its expression becomes `(5/8) * [1].f`, an octave below the third. The chord is now voiced third-fifth-root.

### 4. A two-chord progression

1. Select the root, set the position to **At End**, frequency `(3/2) * [1].f`, and click **Create Note**. That is a new root a fifth up, starting when the first chord ends.
2. Build a third and a fifth on it with **At Start**, using `(5/4) * [N].f` and `(3/2) * [N].f` where N is your new root's id.

You have a V chord after a I chord. Because the second root references the first, transposing Note 1 still moves everything. That chaining is exactly how the shipped **Progressions** modules are built.

### 5. Save it

Marquee-select the chord (shift-drag across it) and click **Copy to Modules** in the group widget. It lands in the library's **Custom** section, root intact, ready to drop onto any note.

## What you learned

- **At Start** stacks notes into a chord; **At End** chains them into a melody.
- Anchoring chord tones to the root, not the BaseNote, makes the chord a movable object.
- One click on the root's ▲ arrow transposes the whole structure.

## Next

- [Add Rhythm](/tutorials/beginner/rhythm) — give the chords a groove
- [Note Dependencies](/tutorials/intermediate/dependencies) — the general rule behind `[1].f`
- [Selection & Group Editing](/user-guide/notes/selection) — marquees, group drag, Copy to Modules
