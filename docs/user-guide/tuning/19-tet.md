---
title: 19-TET
description: Nineteen-tone equal temperament in RMT Compose — near-just thirds and sixths, split accidentals, and the shipped 19-TET module.
---

# 19-TET

19-TET divides the octave into nineteen equal steps of 63.16 cents. It buys you thirds and sixths that are almost exactly just, and it pays for them with a fifth that is 7 cents flat. It is the cheapest good answer to 12-TET's worst problem.

| Property | Value |
|---|---|
| Steps per octave | 19 |
| Step ratio | `2 ^ (1/19)` ≈ 1.037155 |
| Step size | 63.16 cents |
| Octave | 2/1, exact |

## What it fixes

12-TET's major third is 13.7 cents sharp. 19-TET's is 7.4 cents flat — half the error, in the other direction. But the real prize is elsewhere:

| Interval | Steps | 19-TET cents | Just ratio | Just cents | Error |
|---|---|---|---|---|---|
| Minor third | 5 | 315.8 | 6/5 | 315.6 | **+0.1¢** |
| Major sixth | 14 | 884.2 | 5/3 | 884.4 | **−0.1¢** |
| Major third | 6 | 378.9 | 5/4 | 386.3 | −7.4¢ |
| Minor sixth | 13 | 821.1 | 8/5 | 813.7 | +7.4¢ |
| Perfect fifth | 11 | 694.7 | 3/2 | 702.0 | −7.2¢ |
| Perfect fourth | 8 | 505.3 | 4/3 | 498.0 | +7.2¢ |

The **minor third and major sixth are essentially pure** — a tenth of a cent off, which is nothing. They have to be: 5 + 14 = 19 steps and 6/5 × 5/3 = 2, so the two errors are equal and opposite by construction.

The fifth is the price. Seven cents flat is audible as a slight slackness in open fifths, which is the standard complaint about 19-TET.

## Every interval

| Interval | Steps | Cents | Nearest just ratio | Error |
|---|---|---|---|---|
| Chromatic semitone (C→C♯) | 1 | 63.2 | 25/24 | −7.5¢ |
| Minor second (diatonic) | 2 | 126.3 | 16/15 | +14.6¢ |
| Major second | 3 | 189.5 | 9/8 | −14.4¢ |
| Minor third | 5 | 315.8 | 6/5 | +0.1¢ |
| Major third | 6 | 378.9 | 5/4 | −7.4¢ |
| Perfect fourth | 8 | 505.3 | 4/3 | +7.2¢ |
| Augmented fourth | 9 | 568.4 | 45/32 | −21.8¢ |
| Diminished fifth | 10 | 631.6 | 64/45 | +21.8¢ |
| Perfect fifth | 11 | 694.7 | 3/2 | −7.2¢ |
| Minor sixth | 13 | 821.1 | 8/5 | +7.4¢ |
| Major sixth | 14 | 884.2 | 5/3 | −0.1¢ |
| Minor seventh | 16 | 1010.5 | 9/5 | −7.1¢ |
| Major seventh | 17 | 1073.7 | 15/8 | −14.6¢ |
| Octave | 19 | 1200 | 2/1 | 0 |

::: info The minor second is *larger* than a 12-TET semitone
Two 19-TET steps is 126.3 cents — a quarter of a semitone wider than 12-TET's 100. The *small* semitone in 19-TET is the one-step chromatic semitone at 63.2 cents. Nineteen has two different semitones, and that is the whole point (see below).
:::

## Split accidentals

In 12-TET, C♯ and D♭ are the same key on the piano. In 19-TET they are not:

- C → C♯ is one step (63.2¢).
- D♭ → D is also one step.
- C♯ to D♭ is one step apart — **they are different pitches**, and C♯ is *below* D♭.

The nineteen steps are the seven naturals, plus a sharp and a flat for each of the five that take them, plus E♯/F♭ and B♯/C♭. That is 7 + 10 + 2 = 19. Nothing collapses.

This is what makes 19-TET a real meantone temperament rather than a curiosity: it notates the way Renaissance and early Baroque music was actually *meant*, where a D♯ and an E♭ were different notes with different functions.

## Writing 19-TET expressions

```
2 ^ (1/19)              # one step
2 ^ (6/19)              # major third (6 steps)
2 ^ (11/19)             # perfect fifth (11 steps)
base.f * 2 ^ (6/19)     # a major third above the BaseNote
[1].f * 2 ^ (1/19)      # one step above note 1
```

A 19-TET major triad:

```
base.f                  # root
base.f * 2 ^ (6/19)     # major third
base.f * 2 ^ (11/19)    # fifth
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(6, 19)))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(11, 19)))
```
</details>

## The shipped module

The library's **Scale Systems** section ships a **19-TET** module (file `scale-systems/TET-19.json`; the tile reads **19-TET**).

| | |
|---|---|
| Notes | 20 — nineteen steps plus the note you start on |
| Base frequency | 440 Hz |
| Tempo | 100 |
| Beats per measure | 4 |
| Instrument | `sine-wave` |
| Note duration | `beat(base) * (1/2)` |
| Step | `[n].f * 2 ^ (1/19)` |

Note 1 is `base.f`; every later note is the previous one times `2 ^ (1/19)`. It is a chain, so moving note 1 moves the whole scale.

To load it, drag the tile from **Scale Systems** (or search `19` or the `microtonal` tag with the library magnifier) onto a note or onto the BaseNote circle — a drop on empty canvas is refused. The full loading workflow is on [Equal Temperament](/user-guide/tuning/equal-temperament#loading-one).

All nineteen steps after the first show a **≈** prefix and cross-hatching, because `2^(k/19)` is irrational. The fraction beside the ≈ is the note's approximate ratio to the BaseNote.

## Working in 19-TET

**Start with triads.** Play a 12-TET major triad and a 19-TET one back to back. The 19-TET minor third is the one that stops beating.

**Minor keys are the sweet spot.** With a pure minor third and a pure major sixth, 19-TET flatters minor-mode harmony more than major.

**The fifth wants company.** A bare open fifth exposes the −7.2¢ error. Fill it in — the third covers it.

**The arrows cannot walk the scale.** The ▲/▼ arrows apply a rational interval you set in **Settings → Arrows** — the octave by default, but any ratio of positive integers in `[1/16, 16]`. A 19-TET step is not one of those. To move a note by one degree, edit the exponent.

## Challenges

**Notation.** Standard staff notation handles 19 pitches better than you would expect — the split accidentals map onto ♯ and ♭ directly — but there is no standard for what to do beyond that.

**Instruments.** Almost nothing acoustic is built for 19-TET, which is precisely why you would compose it here.

**Retraining.** Interval sizes in steps are all different. Six steps is a major third, not four.

## Next steps

- [31-TET](/user-guide/tuning/31-tet) — better fifths, plus septimal intervals
- [12-TET](/user-guide/tuning/12-tet) — the comparison case
- [Pure Ratios](/user-guide/tuning/ratios) — what 19-TET's thirds are chasing
- [Custom TET](/user-guide/tuning/custom-tet) — build your own division
