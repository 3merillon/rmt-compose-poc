---
title: Bohlen-Pierce
description: The Bohlen–Pierce scale in RMT Compose — thirteen equal divisions of the tritave, the 3:5:7 chord, and the shipped Bohlen–Pierce module.
---

# Bohlen-Pierce

Bohlen–Pierce throws away the octave. Instead of dividing 2/1, it divides the **tritave** — the ratio 3/1 — into thirteen equal steps. Notes a tritave apart are treated as the "same" note, the way notes an octave apart are in every other system you know.

The result sounds genuinely foreign, and it is not a gimmick: BP is built on odd harmonics, and it has consonances of its own.

| Property | Value |
|---|---|
| Interval of equivalence | tritave, 3/1 |
| Steps per tritave | 13 |
| Step ratio | `3 ^ (1/13)` ≈ 1.088182 |
| Step size | 146.30 cents |
| Tritave | 1901.96 cents, exact |

## Why the tritave

Take a clarinet, or a square wave. Its spectrum has **only odd harmonics**: 1, 3, 5, 7, 9… The even ones are missing, and so the 2/1 octave — which is where harmonic 2 lives — has nothing to reinforce it.

Build a scale for that spectrum and the octave stops being special. The strongest simple ratio available is 3/1, and the consonances that fall out are ratios of odd numbers: 3, 5, 7, 9. Bohlen–Pierce is what you get when you take that seriously and divide 3/1 into thirteen equal parts.

Thirteen is not arbitrary: it is the division that best approximates the just BP intervals (see the table below), the same way twelve best approximates 5-limit just intonation for the octave.

## The scale

The shipped module is *equal-tempered* BP: every step is exactly `3 ^ (1/13)` = 146.30 cents. Just BP — the ratio-based version the temperament approximates — is a different set of numbers. Both are given here, side by side, because they are easy to confuse.

| Step | Equal-tempered cents | Nearest just BP ratio | Just cents | ET error |
|---|---|---|---|---|
| 0 | 0 | 1/1 | 0 | 0 |
| 1 | 146.30 | 27/25 | 133.2 | +13.1¢ |
| 2 | 292.61 | 25/21 | 301.8 | −9.2¢ |
| 3 | 438.91 | 9/7 | 435.1 | +3.8¢ |
| 4 | 585.22 | 7/5 | 582.5 | +2.7¢ |
| 5 | 731.52 | 75/49 | 736.9 | −5.4¢ |
| 6 | 877.83 | 5/3 | 884.4 | −6.5¢ |
| 7 | 1024.13 | 9/5 | 1017.6 | +6.5¢ |
| 8 | 1170.43 | 49/25 | 1165.0 | +5.4¢ |
| 9 | 1316.74 | 15/7 | 1319.4 | −2.7¢ |
| 10 | 1463.04 | 7/3 | 1466.9 | −3.8¢ |
| 11 | 1609.35 | 63/25 | 1600.1 | +9.2¢ |
| 12 | 1755.65 | 25/9 | 1768.7 | −13.1¢ |
| 13 | 1901.96 | 3/1 | 1902.0 | 0 |

The best-tuned degrees are 3, 4, 9 and 10 — and those are exactly the ones the BP chords are built from.

## BP chords

Traditional triads do not transfer: they are stacks of 5-limit ratios that assume an octave. BP has its own.

### The BP major chord — 3:5:7

The characteristic Bohlen–Pierce sonority. Take the odd harmonics 3, 5 and 7 and build a chord on them. Over a root, the tones are `1/1`, `5/3` and `7/3`.

In equal-tempered BP those land on **steps 0, 6 and 10**:

```
base.f                   # 3
base.f * 3 ^ (6/13)      # 5   (877.8¢ — just 5/3 is 884.4¢)
base.f * 3 ^ (10/13)     # 7   (1463.0¢ — just 7/3 is 1466.9¢)
```

Both tones land within 7 cents of pure. This chord locks the way a just major triad does — it is the reason BP works as music rather than as noise.

### The BP minor chord — 5:7:9

The same three odd harmonics with the root moved to 5. Over the root, the tones are `1/1`, `7/5` and `9/5`, which fall on **steps 0, 4 and 7**:

```
base.f                   # 5
base.f * 3 ^ (4/13)      # 7   (585.2¢ — just 7/5 is 582.5¢)
base.f * 3 ^ (7/13)      # 9   (1024.1¢ — just 9/5 is 1017.6¢)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// BP major chord (3:5:7)
module.baseNote.getVariable('frequency')
module.baseNote.getVariable('frequency').mul(new Fraction(3).pow(new Fraction(6, 13)))
module.baseNote.getVariable('frequency').mul(new Fraction(3).pow(new Fraction(10, 13)))
```
</details>

::: tip Hear the just version too
The library ships both chords as pure ratios. **Base-3 chord** (3:5:7:9) and **Base-5 chord** (5:7:9:11) are in the **Chords** section. Drop one next to a tempered BP chord and compare — the tempered one is a few cents off and beats very slowly.
:::

## Writing BP expressions

```
3 ^ (1/13)              # one BP step
3 ^ (6/13)              # six steps
3 ^ (13/13)             # a full tritave = 3
base.f * 3 ^ (4/13)     # four steps above the BaseNote
[1].f * 3 ^ (1/13)      # one step above note 1
```

The base is 3, not 2. That is the only structural difference from the TET pages — everything else about the syntax is the same.

RMT keeps base-2 and base-3 powers as **separate** terms rather than merging them into one number. That is why you can mix them in a single scale (see Mixed-Base, below) and why `3^(1/13)` stays symbolic across saves.

## The shipped module

The library's **Scale Systems** section ships a **Bohlen–Pierce** module (file `scale-systems/BP-13.json`; the tile reads **Bohlen–Pierce**).

| | |
|---|---|
| Notes | 14 — thirteen steps plus the note you start on |
| Base frequency | 440 Hz |
| Tempo | 80 |
| Beats per measure | 4 |
| Instrument | `sine-wave` |
| Note duration | `beat(base) * (1/2)` |
| Step | `[n].f * 3 ^ (1/13)` |

Note 1 is `base.f`; every later note is the previous one times `3 ^ (1/13)`. Note 14 is therefore exactly three times note 1 — the tritave, not an octave. Listen for it: the scale closes somewhere your ear does not expect.

To load it, drag the tile from **Scale Systems** (or search `bohlen`, `tritave` or `base-3` with the library magnifier) onto a note or onto the BaseNote circle — a drop on empty canvas is refused. The full loading workflow is on [Equal Temperament](/user-guide/tuning/equal-temperament#loading-one).

All thirteen steps after the first show a **≈** prefix and cross-hatching, because `3^(k/13)` is irrational.

## Timbre matters more here than anywhere else

BP is a scale designed for odd-harmonic spectra. Play it on a timbre with strong even harmonics and the consonances stop working — the chords will beat against overtones that the scale has no notes for.

Use an odd-harmonic voice. Of the built-in instruments, **`square-wave`** is the one to reach for: a square wave's spectrum is odd harmonics only, which is precisely what BP was designed around. `sine-wave` (the module's default) is also safe, because a sine has no harmonics at all to clash with.

The full instrument list is `sine-wave`, `square-wave`, `sawtooth-wave`, `triangle-wave`, `organ`, `vibraphone`, `fm-epiano`, `piano`, `violin`. Set the default in **Settings → Audio → Default instrument**, or set `instrument` on a single note.

::: warning Sawtooth and the sampled voices will fight the scale
`sawtooth-wave` has all harmonics, even ones included, and the sampled `piano` and `violin` are recordings of instruments with full harmonic spectra. They will play BP pitches accurately — the samplers pitch-shift by `frequency / rootHz`, so the frequencies are correct — but the harmonic clash is real, and BP chords will not lock on them.
:::

## Neighbours in the same section

Two other modules sit alongside BP in **Scale Systems**, and both are natural next stops from here.

**Tesla** is an 81-note scale of pure odd-harmonic ratios on a base-3 frame — the *just* expression of the same odd-harmonic idea BP tempers. Because every step is rational, **no Tesla note is hatched or marked with ≈**.

**Mixed-Base** is a 12-note experiment that alternates step bases in a single line — `2^(1/12)`, then `3^(1/13)`, with a `5^(1/7)` partway through. It only works because the app keeps 2-, 3- and 5-based powers as independent terms.

Both are described in full on [Equal Temperament](/user-guide/tuning/equal-temperament#the-scale-systems-section).

## What to expect

**No octave return.** The sense of arriving home an octave up is simply absent. This is disorienting for about a minute, and then it is not.

**Consonance still exists.** 3:5:7 is a stable, restful chord. It is not a major triad, but it does the same job.

**Major and minor stop meaning what they meant.** BP's "major" and "minor" chords are two rotations of the same odd-harmonic set. They do not carry the emotional loading of their octave-world namesakes, and you should not expect them to.

**There is almost no repertoire.** You are not learning a tradition. You are starting one.

## Next steps

- [31-TET](/user-guide/tuning/31-tet) — septimal harmony inside the octave
- [Custom TET](/user-guide/tuning/custom-tet) — divide any interval you like
- [Pure Ratios](/user-guide/tuning/ratios) — the odd-harmonic chords in just intonation
- [12-TET](/user-guide/tuning/12-tet) — to hear what BP is not
