---
title: 31-TET
description: Thirty-one-tone equal temperament in RMT Compose — quarter-comma meantone, 7-limit harmony, and the shipped 31-TET module.
---

# 31-TET

31-TET divides the octave into thirty-one equal steps of 38.71 cents. It gives you a major third that is 0.8 cents off pure, a usable fifth, and — unusually — good septimal intervals as well. Christiaan Huygens worked it out in the 1690s. It is still the best all-round equal temperament under 50 notes.

| Property | Value |
|---|---|
| Steps per octave | 31 |
| Step ratio | `2 ^ (1/31)` ≈ 1.022611 |
| Step size | 38.71 cents |
| Octave | 2/1, exact |

## What it gets right

| Interval | Steps | 31-TET cents | Just ratio | Just cents | Error |
|---|---|---|---|---|---|
| Major third | 10 | 387.1 | 5/4 | 386.3 | **+0.8¢** |
| Minor sixth | 21 | 812.9 | 8/5 | 813.7 | **−0.8¢** |
| Harmonic seventh | 25 | 967.7 | 7/4 | 968.8 | **−1.1¢** |
| Septimal tritone | 15 | 580.6 | 7/5 | 582.5 | **−1.9¢** |
| Septimal tritone (wide) | 16 | 619.4 | 10/7 | 617.5 | **+1.9¢** |
| Septimal minor third | 7 | 271.0 | 7/6 | 266.9 | +4.1¢ |
| Perfect fifth | 18 | 696.8 | 3/2 | 702.0 | −5.2¢ |
| Minor third | 8 | 309.7 | 6/5 | 315.6 | −6.0¢ |
| Major sixth | 23 | 890.3 | 5/3 | 884.4 | +6.0¢ |

The major third is *effectively pure*. So is the harmonic seventh, which no other small temperament manages. The fifth is 5.2 cents flat — this is quarter-comma meantone, near enough, and meantone is exactly the trade where you flatten the fifth to buy the third.

## Every interval

| Interval | Steps | Cents | Nearest just ratio | Error |
|---|---|---|---|---|
| Chromatic semitone | 2 | 77.4 | 25/24 | +6.7¢ |
| Minor second | 3 | 116.1 | 16/15 | +4.4¢ |
| Major second | 5 | 193.5 | 9/8 | −10.4¢ |
| Septimal minor third | 7 | 271.0 | 7/6 | +4.1¢ |
| Minor third | 8 | 309.7 | 6/5 | −6.0¢ |
| Major third | 10 | 387.1 | 5/4 | +0.8¢ |
| Perfect fourth | 13 | 503.2 | 4/3 | +5.2¢ |
| Septimal tritone | 15 | 580.6 | 7/5 | −1.9¢ |
| Septimal tritone (wide) | 16 | 619.4 | 10/7 | +1.9¢ |
| Perfect fifth | 18 | 696.8 | 3/2 | −5.2¢ |
| Minor sixth | 21 | 812.9 | 8/5 | −0.8¢ |
| Major sixth | 23 | 890.3 | 5/3 | +6.0¢ |
| Harmonic seventh | 25 | 967.7 | 7/4 | −1.1¢ |
| Minor seventh | 26 | 1006.5 | 9/5 | −11.1¢ |
| Major seventh | 28 | 1083.9 | 15/8 | −4.4¢ |
| Octave | 31 | 1200 | 2/1 | 0 |

::: warning The 5-limit minor seventh is the weak spot
26 steps lands 11.1 cents below `9/5`. That is the worst interval in the table — worse than the major second at −10.4¢. If you want a good seventh in 31-TET, use the **harmonic** seventh at 25 steps (−1.1¢), which is the septimal `7/4`. Reaching for a 5-limit minor seventh here is fighting the temperament.
:::

## 7-limit harmony

This is 31-TET's real argument. Most temperaments approximate the 5-limit and give up on the 7th harmonic. 31-TET nails it:

| Ratio | Steps | Error |
|---|---|---|
| 7/6 (septimal minor third) | 7 | +4.1¢ |
| 7/5 (septimal tritone) | 15 | −1.9¢ |
| 7/4 (harmonic seventh) | 25 | −1.1¢ |

Which means a **4:5:6:7** harmonic seventh chord — the barbershop chord, the one that locks — is playable in 31-TET at 0, 10, 18, 25 steps and lands within about a cent of pure. That chord does not exist in 12-TET at all; the nearest thing is 31 cents sharp.

```
base.f                   # 4
base.f * 2 ^ (10/31)     # 5
base.f * 2 ^ (18/31)     # 6
base.f * 2 ^ (25/31)     # 7
```

The library's **Harmonic 7th** chord module (4:5:6:7) gives you the pure-ratio version of the same chord for comparison. Drop both, listen to the difference — it is very small, which is the point.

## Writing 31-TET expressions

```
2 ^ (1/31)              # one step
2 ^ (10/31)             # major third
2 ^ (18/31)             # perfect fifth
base.f * 2 ^ (10/31)    # major third above the BaseNote
[1].f * 2 ^ (1/31)      # one step above note 1
```

A 31-TET major triad:

```
base.f
base.f * 2 ^ (10/31)
base.f * 2 ^ (18/31)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(10, 31)))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(18, 31)))
```
</details>

## The shipped module

The library's **Scale Systems** section ships a **31-TET** module (file `scale-systems/TET-31.json`; the tile reads **31-TET**).

| | |
|---|---|
| Notes | 32 — thirty-one steps plus the note you start on |
| Base frequency | 440 Hz |
| Tempo | 120 |
| Beats per measure | 4 |
| Instrument | `sine-wave` |
| Note duration | `beat(base) * (1/4)` |
| Step | `[n].f * 2 ^ (1/31)` |

The short note duration matters: at 120 BPM with sixteenth-note steps, all 31 degrees go by in about four seconds, which is what you want when you are listening for the shape of the scale rather than individual pitches.

To load it, drag the tile from **Scale Systems** (or search `31` or the `microtonal` tag with the library magnifier) onto a note or onto the BaseNote circle — a drop on empty canvas is refused. The full loading workflow is on [Equal Temperament](/user-guide/tuning/equal-temperament#loading-one).

Thirty-one of the thirty-two notes carry the **≈** prefix and cross-hatching. This is the module where that display earns its keep — the approximated ratios next to each note are the quickest way to see which just interval each degree is standing in for.

## Meantone repertoire

31-TET is a very close cousin of quarter-comma meantone, the tuning most 16th- and 17th-century keyboard music was actually written for. Music from that period played in 31-TET sounds the way its composers heard it: pure thirds, slightly narrow fifths, and wolf intervals that genuinely bite.

## The Tesla companion

If the septimal material on this page interests you, the same **Scale Systems** section ships **Tesla** — an 81-note scale built entirely from odd-harmonic ratios rather than tempered steps. Because every step is a pure ratio, none of its notes are hatched or marked with ≈ — the visual opposite of the page you are reading. It is described with the rest of the section on [Equal Temperament](/user-guide/tuning/equal-temperament#the-scale-systems-section).

## Challenges

**Thirty-one pitches per octave.** Organising them is real work. Start from the diatonic subset and add the accidentals you actually need.

**No instruments.** A handful of 31-tone keyboards exist. In practice this is a tuning you compose in software.

**The major second.** At −10.4¢ it is the interval most likely to sound wrong to a 12-TET-trained ear. It is a consequence of the flat fifth (two fifths make a second), and it is the bill for the third.

## Next steps

- [Bohlen–Pierce](/user-guide/tuning/bohlen-pierce) — a system with no octave at all
- [19-TET](/user-guide/tuning/19-tet) — the same trade, made more cheaply
- [Pure Ratios](/user-guide/tuning/ratios) — the 7-limit intervals 31-TET is approximating
- [Custom TET](/user-guide/tuning/custom-tet) — 53-TET and beyond
