---
title: Exploring Intervals
description: A systematic workflow for studying musical intervals using the 46 interval modules that ship with RMT Compose.
---

# Exploring Intervals

An interval is a frequency ratio. RMT Compose ships **46 of them** as one-drag modules, each
carrying its ratio, its cents and its limit family. This is a workflow for hearing them all.

## Set up an interval lab

Two notes, sounding together, one of which you retune.

| Note | frequency | startTime | duration |
|---|---|---|---|
| 1 (reference) | `base.f` | `base.t` | `base.d * 4` |
| 2 (the interval) | `[1].f * (3/2)` | `[1].t` | `[1].d` |

Create both from the **ADD NOTE / SILENCE / REFERENCE** section of a widget. Note 1 comes from the BaseNote's
widget — it has no **At Start** / **At End** toggle, and its button reads **Create**. Note 2 comes
from note 1's widget: pick **Note**, pick **At Start** so it stacks, then **Create Note**. To try a
different interval, edit note 2's `frequency` in its `Raw:` field and press **Save**.

Note 2 is defined against note 1, so it follows note 1 anywhere. Note 1 is your movable reference.

### Before you listen: turn reverb off

Reverb is **on by default**. It blurs the beating that tells you an interval is out of tune. Open the
Settings panel from the top-bar gear → **Audio** → switch off **Enable reverb**.

Then shift-click (or long-press) **Play** to loop, and let the dyad sustain while you listen.

## Find a comparison pair

Open the library search and try `5/4`, then `81/64`. Both are major thirds. In the two-note setup above, enter `[1].f * (5/4)` for the upper pitch, listen, then change it to `[1].f * (81/64)`. Their ratio is 81/80, the syntonic comma. A sustained sound with upper partials, such as the harmonium, makes it easier to hear the change.

The [module library](/user-guide/modules/module-library) lists the 46 intervals and six sections. Use that catalogue to choose further ratios for the experiments below.

## A systematic pass

### Phase 1 — perfect consonances

Drag each onto your reference note, in **Start** mode so it stacks:

Unison (1/1) · Octave (2/1) · Perfect 5th (3/2) · Perfect 4th (4/3)

**Listen for:** no beating at all. These are the intervals where the partials line up.

### Phase 2 — imperfect consonances

Just major 3rd (5/4) · Just minor 3rd (6/5) · Just major 6th (5/3) · Just minor 6th (8/5)

**Listen for:** warmth and colour. Still smooth, but with character.

### Phase 3 — dissonances

Major 2nd (9/8) · Just minor 2nd (16/15) · Just major 7th (15/8) · Just minor 7th (9/5) ·
Just augmented 4th (45/32)

**Listen for:** roughness, and the pull toward resolution.

### Phase 4 — the septimal world

Septimal minor 3rd (7/6) · Septimal tritone (7/5) · Harmonic 7th (7/4)

**Listen for:** the 7/4 in particular. Against a 12-TET minor seventh it is 31 cents flat, and it
locks in a way the tempered one never does.

## Pure vs tempered

Add a third note and compare the same interval two ways.

| Note | frequency | Meaning |
|---|---|---|
| 1 | `base.f` | reference |
| 2 | `[1].f * (5/4)` | pure major third — 386.3¢ |
| 3 | `[1].f * 2^(4/12)` | 12-TET major third — 400¢ |

Play 1+2: smooth, beatless. Play 1+3: a slow shimmer. The gap is 13.7 cents, and on a sustained tone
it is unmistakable.

Note 3 will be **crosshatched** — that is the app telling you
`2^(4/12)` is irrational (tempered, not a pure ratio). Its value is kept exact: the widget shows `2^(1/3)` with its value. See
[Understanding SymbolicPower](/tutorials/advanced/symbolic-power).

## Interval inversion

An interval and its inversion sum to an octave: multiply the two ratios and you get 2/1.

| Interval | Ratio | Inversion | Ratio | Product |
|---|---|---|---|---|
| Just minor 2nd | 16/15 | Just major 7th | 15/8 | 2/1 |
| Major 2nd | 9/8 | Pythagorean minor 7th | 16/9 | 2/1 |
| Just minor 3rd | 6/5 | Just major 6th | 5/3 | 2/1 |
| Just major 3rd | 5/4 | Just minor 6th | 8/5 | 2/1 |
| Perfect 4th | 4/3 | Perfect 5th | 3/2 | 2/1 |
| Just augmented 4th | 45/32 | Just diminished 5th | 64/45 | 2/1 |

::: info Two different minor sevenths, both real
The inversion of the 9/8 major second is **16/9** (Pythagorean minor 7th, 996.09¢). The 5-limit
minor seventh is **9/5** (1017.60¢). They differ by a syntonic comma (81/80), and **both ship**.
Which one you want depends on how you got there — 16/9 if you inverted a whole tone, 9/5 if you
stacked a minor third on a fifth.
:::

To sound an inversion *below* the reference, divide:

```
[1].f / (8/5)           # a just minor sixth below note 1
```

## Compound intervals

Beyond the octave. Multiply the simple ratio by 2:

| Compound | Ratio | Built from |
|---|---|---|
| Minor 9th | 32/15 | 16/15 × 2 |
| Major 9th | 9/4 | 9/8 × 2 |
| Minor 10th | 12/5 | 6/5 × 2 |
| Major 10th | 5/2 | 5/4 × 2 |
| Perfect 11th | 8/3 | 4/3 × 2 |
| Perfect 12th | 3/1 | 3/2 × 2 |

```
[1].f * (9/4)           # a major ninth above note 1
```

Or drag the Major 2nd module on and press the note's **▲** arrow once — the default arrow interval
is ×2, so it becomes a major ninth. The arrows fold the factor into the coefficient rather than
stacking multipliers, so ▲ then ▼ returns you to exactly where you were.

## The harmonic series

Every pure interval hides in the harmonic series. Multiply the fundamental by an integer:

| Harmonic | Expression | Interval above the fundamental |
|---|---|---|
| 1 | `base.f` | fundamental |
| 2 | `base.f * 2` | octave |
| 3 | `base.f * 3` | octave + fifth |
| 4 | `base.f * 4` | two octaves |
| 5 | `base.f * 5` | two octaves + major 3rd |
| 6 | `base.f * 6` | two octaves + fifth |
| 7 | `base.f * 7` | two octaves + harmonic 7th |

Build all seven as notes stacked on the same start time and you have a harmonic stack you can hear
as a single timbre.

### Reducing to one octave

Divide by powers of 2 until the ratio sits between 1 and 2 — which is where the simple ratios come
from:

| Harmonic | Reduced | Name |
|---|---|---|
| 3 | 3/2 | Perfect 5th |
| 5 | 5/4 | Just major 3rd |
| 7 | 7/4 | Harmonic 7th |
| 9 | 9/8 | Major 2nd |
| 11 | 11/8 | Undecimal tritone |
| 13 | 13/8 | Tridecimal neutral 6th |

That table *is* the odd-harmonic logic behind the shipped **Base-3 chord** (3:5:7:9) and
**Base-5 chord** (5:7:9:11), and behind the 81-note **Tesla** scale, which walks the odd harmonics
9, 11, 13 … 169 over 9.

## Interval chains

### Pythagorean: stack fifths

Each note is a fifth above the previous, folded back down an octave when it overshoots:

| Note | frequency | Absolute ratio |
|---|---|---|
| 1 | `base.f` | 1/1 |
| 2 | `[1].f * (3/2)` | 3/2 |
| 3 | `[2].f * (3/2) / 2` | 9/8 |
| 4 | `[3].f * (3/2)` | 27/16 |
| 5 | `[4].f * (3/2) / 2` | 81/64 |

Because each note is written against the *previous* one, retuning note 1 shifts the entire chain.

Stack twelve fifths and you land a **Pythagorean comma** (531441/524288, 23.46¢) above seven
octaves — not on them. That gap is why equal temperament exists, and it is one of the six comma
modules.

### 5-limit: a just major scale

All degrees against the base:

| Degree | frequency |
|---|---|
| C | `base.f` |
| D | `base.f * (9/8)` |
| E | `base.f * (5/4)` |
| F | `base.f * (4/3)` |
| G | `base.f * (3/2)` |
| A | `base.f * (5/3)` |
| B | `base.f * (15/8)` |
| C′ | `base.f * 2` |

Every note hangs off the base, so changing `base.f` transposes the whole scale.

## Save what you learn

Don't rebuild the interval library — it already exists. Do save the **combinations** you find.

Select the notes of a chord or a chain you like (shift-drag a marquee), then press **Copy to
Modules** in the group widget. It lands in the library's **Custom** section, rooted at its earliest
note, with the internal dependency tree intact — so dropping it on any note transposes the whole
thing correctly.

## Exercises

**1 — Identify by sound.** Collapse every section except Intervals. Drag a tile onto your reference
note without reading its label, play, and guess. The tooltip (`Perfect 5th  (3/2, 702¢)`) gives you
the answer.

**2 — Build the four triads.** On one root, stack:

| Triad | Third | Fifth |
|---|---|---|
| Major | `(5/4)` | `(3/2)` |
| Minor | `(6/5)` | `(3/2)` |
| Diminished | `(6/5)` | `(7/5)` |
| Augmented | `(5/4)` | `(25/16)` |

Then compare with the shipped **Major**, **Minor**, **Diminished** and **Augmented** chord
modules — those are the exact ratios they use.

**3 — Rank the temperaments.** Build a major third four ways on the same root: `(5/4)`, `2^(4/12)`,
`2^(6/19)`, `2^(10/31)`. Play each against the root. Rank them by how close to beatless they sound,
then check your ranking against the cents: 386.3, 400, 378.9, 387.1.

## Next

- [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) — structured listening
- [Microtonal Composition](/tutorials/advanced/microtonal) — write in these tunings
- [Ratios](/user-guide/tuning/ratios) — the theory
