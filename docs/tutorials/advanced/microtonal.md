---
title: Microtonal Composition
description: Compose in 19-TET, 31-TET, quarter tones, just intonation and Bohlen-Pierce using exact ratios and the shipped Scale Systems modules.
---

# Microtonal Composition

Write music outside 12-tone equal temperament. RMT Compose stores every pitch as an **expression**,
not a number, so a tuning system is something you write down rather than something you configure.

**Prerequisites:** [Octave Manipulation](/tutorials/intermediate/octaves) — you will use ratios and
the `^` operator throughout.

## Start with what ships

Before you hand-enter a scale, check the library. The **Scale Systems** section holds six
ready-made tuning systems, and **Intervals** holds 46 just ratios with their cents and limit
family attached.

| Scale Systems module | Notes | Step written as |
|---|---|---|
| 12-TET | 13 | `[N-1].f * 2 ^ (1/12)` |
| 19-TET | 20 | `[N-1].f * 2 ^ (1/19)` |
| 31-TET | 32 | `[N-1].f * 2 ^ (1/31)` |
| Bohlen–Pierce | 14 | `[N-1].f * 3 ^ (1/13)` |
| Tesla | 81 | successive odd harmonics over 9 |
| Mixed-Base | 12 | alternating 2-, 3- and 5-based steps |

Each scale is **chained**: note 1 sits on `base.f`, and every later note is the previous note's
frequency times one step. Lifting one note carries every note after it. Drag the module onto a
note and the whole scale re-roots onto that note.

::: tip Find things by ratio, not by scrolling
The magnifier at the left of the module bar's toolbar opens a search field
(`Search name, ratio, tag…`). It matches the module name, its **ratio**, its **cents**, its
**family** (`3-limit`, `7-limit`, `comma`, …) and its **tags** — so typing `7/4`, `septimal` or
`comma` narrows 79 modules to the handful you want. Matches surface even inside collapsed
sections. Closing the field always clears the query.
:::

## Pure intervals vs equal temperament

12-TET divides the octave into 12 equal parts, each `2^(1/12)` ≈ 1.0595. That is a compromise:
every interval except the octave is slightly off its pure ratio.

| Interval | Pure ratio | Pure cents | 12-TET cents | Error |
|---|---|---|---|---|
| Just major 3rd | 5/4 | 386.3 | 400 | +13.7 |
| Perfect 5th | 3/2 | 702.0 | 700 | −2.0 |
| Harmonic 7th | 7/4 | 968.8 | 1000 | +31.2 |

Pure ratios are written as fraction literals:

```
base.f * (5/4)          # just major third
base.f * (3/2)          # perfect fifth
base.f * (7/4)          # harmonic seventh
```

The parentheses are part of the fraction literal. `(5/4)` is an exact rational; `5/4` written bare
is a division that still evaluates exactly, but the literal form is what the app itself writes and
what round-trips through a save.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
```
</details>

## Equal temperaments

An n-TET step is `2 ^ (1/n)`. Take `k` of them with `2 ^ (k/n)`.

### 19-TET

```
base.f * 2^(3/19)       # major second  (3 steps)
base.f * 2^(6/19)       # major third   (6 steps)
base.f * 2^(11/19)      # perfect fifth (11 steps)
```

19-TET's major third is 378.9¢ — 7.4 cents *flat* of pure, where 12-TET is 13.7 cents sharp.

### 31-TET

```
base.f * 2^(10/31)      # major third   (10 steps)
base.f * 2^(18/31)      # perfect fifth (18 steps)
```

31-TET's major third lands within a cent of 5/4, which is why it is the classic meantone-adjacent
temperament for just-sounding harmony.

### 24-TET (quarter tones)

No 24-TET module ships — write it directly:

```
base.f * 2^(1/24)       # quarter tone up
base.f * 2^(2/24)       # one 12-TET semitone
base.f * 2^(3/24)       # three-quarter tone
```

::: warning `^` binds tighter than `*`
`base.f * 2 ^ (1/12)` parses as `base.f * (2^(1/12))`, which is what you want. But `2^3^2` is
`2^(3^2)` — the power operator is **right**-associative. Parenthesise when in doubt.
:::

### Interval comparison

| Interval | Pure | 12-TET | 19-TET | 31-TET |
|---|---|---|---|---|
| Major 2nd | `(9/8)` | `2^(2/12)` | `2^(3/19)` | `2^(5/31)` |
| Major 3rd | `(5/4)` | `2^(4/12)` | `2^(6/19)` | `2^(10/31)` |
| Perfect 4th | `(4/3)` | `2^(5/12)` | `2^(8/19)` | `2^(13/31)` |
| Perfect 5th | `(3/2)` | `2^(7/12)` | `2^(11/19)` | `2^(18/31)` |
| Major 6th | `(5/3)` | `2^(9/12)` | `2^(14/19)` | `2^(23/31)` |

## Bohlen–Pierce

A non-octave scale. The period is the **tritave** (3/1), divided into 13 equal steps:

```
base.f * 3^(1/13)       # one BP step
base.f * 3^(5/13)       # five BP steps
base.f * 3^(13/13)      # the tritave — exactly 3 x base
```

BP is built on odd harmonics (3, 5, 7, 9) rather than the even ones an octave-based scale
emphasises, which gives it a distinctly clarinet-friendly, hollow palette. The shipped
**Bohlen–Pierce** module is 14 notes: the root plus all 13 steps to the tritave.

## Just intonation

### 5-limit

Ratios whose prime factors are only 2, 3 and 5.

| Degree | Ratio | Cents | Ships as |
|---|---|---|---|
| Unison | 1/1 | 0 | Unison |
| Major 2nd | 9/8 | 203.9 | Major 2nd |
| Major 3rd | 5/4 | 386.3 | Just major 3rd |
| Perfect 4th | 4/3 | 498.0 | Perfect 4th |
| Perfect 5th | 3/2 | 702.0 | Perfect 5th |
| Major 6th | 5/3 | 884.4 | Just major 6th |
| Major 7th | 15/8 | 1088.3 | Just major 7th |
| Octave | 2/1 | 1200 | Octave |

```
base.f * (5/4)          # E
base.f * (3/2)          # G
base.f * (5/3)          # A
```

### 7-limit and beyond

The seventh harmonic gives the "barbershop" seventh; 11 and 13 give neutral intervals that sit
between major and minor.

| Name | Ratio | Cents | Family |
|---|---|---|---|
| Septimal minor 3rd | 7/6 | 266.9 | 7-limit |
| Septimal tritone | 7/5 | 582.5 | 7-limit |
| Harmonic 7th | 7/4 | 968.8 | 7-limit |
| Undecimal neutral 3rd | 11/9 | 347.4 | higher |
| Undecimal neutral 7th | 11/6 | 1049.4 | higher |
| Tridecimal neutral 2nd | 13/12 | 138.6 | higher |
| Tridecimal neutral 6th | 13/8 | 840.5 | higher |

All seven ship as interval modules. So do the six commas — Syntonic (81/80), Septimal (64/63),
Pythagorean (531441/524288), Enharmonic diesis (128/125), Diaschisma (2048/2025) and
Schisma (32805/32768).

## Building a microtonal composition

::: tip Drop mode: Start / End
The drop-mode buttons in the module bar's toolbar — ⇤ and ⇥, just left of Undo/Redo —
decide where a dropped module lands relative to the target note. Exactly one is lit at a time.

- **End** (⇥) — the module's notes are pushed past the target note's end. Chains scales and melodies.
- **Start** (⇤) — the module's notes share the target's start time. Stacks chords.

Default is **Start**. Note that dropping onto the **BaseNote** ignores the drop mode entirely.
:::

### A 19-TET melody, by hand

Four notes, each starting where the previous one ends, each pitched off note 1:

| Note | frequency | startTime | duration |
|---|---|---|---|
| 1 | `base.f` | `base.t` | `beat(base)` |
| 2 | `[1].f * 2^(3/19)` | `[1].t + [1].d` | `beat(base)` |
| 3 | `[1].f * 2^(6/19)` | `[2].t + [2].d` | `beat(base)` |
| 4 | `[1].f * 2^(8/19)` | `[3].t + [3].d` | `beat(base)` |

Create every note from the **ADD NOTE / SILENCE** section of a widget. Note 1 comes from the
BaseNote's widget, which has no **At Start** / **At End** toggle — it always writes `base.t` — and
whose button reads **Create**. Notes 2–4 come from the previous note's widget: pick **Note**, pick
**At End**, then press **Create Note**. Then open each variable's `Raw:` field and type the
expression above. Edits take effect when you press **Save**, not while you type.

### A just dominant seventh

All four notes share note 1's start and length; only the pitch differs.

| Note | frequency | startTime | duration |
|---|---|---|---|
| 1 (root) | `base.f` | `base.t` | `beat(base) * 2` |
| 2 (major 3rd) | `[1].f * (5/4)` | `[1].t` | `[1].d` |
| 3 (fifth) | `[1].f * (3/2)` | `[1].t` | `[1].d` |
| 4 (harmonic 7th) | `[1].f * (7/4)` | `[1].t` | `[1].d` |

Because every tone hangs off note 1, moving or retuning note 1 moves the whole chord. That is the
same structure the shipped **Harmonic 7th** chord module uses (4:5:6:7).

## What `≈` and the hatching mean

Type `base.f * 2^(1/12)` and two things happen.

**In the note widget**, the `Evaluated:` line shows a value with a `≈` prefix, in italic amber.

**In the workspace**, the note rectangle is hatched:

| Hatch | Meaning |
|---|---|
| **Crosshatch** (two diagonals) | The note's *own* expression produced an irrational value |
| **Single diagonal** | The note is clean, but something it depends on is not |

Both cases display `≈`. The hatching is what tells them apart.

::: warning `≈` means approximated, not merely rounded
When a `^` produces a genuinely irrational result, the evaluator converts it straight back to a
rational approximation and marks the property corrupted. The stored value really is an
approximation — subsequent arithmetic works on the approximation, not on a symbolic form.

A power that resolves to a rational is *not* corrupted: `2^(12/12)` is exactly 2, and `4^(1/2)` is
exactly 2. Only genuinely irrational powers hatch.

[Understanding SymbolicPower](/tutorials/advanced/symbolic-power) works through exactly where the
line falls and how much error accumulates when you chain irrational steps.
:::

## Listening well

### Turn reverb off

Reverb is **on by default** (25% wet, 1.8 s decay). It smears the beating you are trying to hear.
Open the Settings panel from the top-bar gear, go to the **Audio** tab and switch off
**Enable reverb** before any tuning comparison.

![The Audio tab of the Settings panel, showing the Enable reverb toggle, room size, decay, damping, pre-delay and reverb amount controls](/img/settings-audio.png)

### Use sustained notes

Beating between two nearly-in-tune pitches takes time to become audible. Give test notes at least
a couple of beats. `beat(base) * 4` is a reasonable starting length.

### Pick a timbre that reveals it

A `sine-wave` shows the beat rate between two fundamentals most cleanly; `organ` and `violin` add
harmonics that expose roughness higher up. Set the default in Settings → Audio →
**Default instrument**, or set one note's instrument from its widget. The full listening rig —
all nine instruments and the settings worth changing — is in
[Microtonal Experiments](/tutorials/workflows/microtonal-experiments).

### Loop it

Shift-click (or long-press) the **Play** button to loop playback. Park on a sustained dyad and let
it beat at you indefinitely while you retune the upper note.

## Save what you find

Select the notes of a scale you like — shift-drag a marquee across them on desktop, or long-press
and drag on touch — then press **Copy to Modules** in the group widget. The selection lands in the
library's **Custom** section as a module, rooted at its earliest note, with the dependency tree
intact. Drag it back onto any note to transpose the whole thing.

::: warning Copy to Modules drops note colours and instruments
The copied module keeps pitches, times and durations as relationships, but per-note `color` and
`instrument` are **not** carried across. Re-set them after you drop the copy back in.
:::

## Next

- [Understanding SymbolicPower](/tutorials/advanced/symbolic-power) — what "exact" really covers
- [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) — a structured listening workflow
- [Exploring Intervals](/tutorials/workflows/intervals) — systematic study of the 46 shipped intervals
- [Bohlen-Pierce](/user-guide/tuning/bohlen-pierce) and [Custom TET](/user-guide/tuning/custom-tet) — reference
