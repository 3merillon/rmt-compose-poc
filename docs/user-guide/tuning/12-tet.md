---
title: 12-TET
description: Twelve-tone equal temperament in RMT Compose — the step table, cents deviations from just intonation, and the shipped 12-TET module.
---

# 12-TET

12-TET divides the octave into twelve equal semitones. It is the tuning of every piano, every fretted guitar, and almost every recording made in the last two centuries. In RMT Compose it is one option among several, and it is the useful reference point for all the others.

| Property | Value |
|---|---|
| Steps per octave | 12 |
| Step ratio | `2 ^ (1/12)` ≈ 1.059463 |
| Step size | 100 cents (by definition) |
| Octave | 2/1, exact |

## The chromatic scale

| Step | Note | Expression | Cents |
|---|---|---|---|
| 0 | C | `base.f` | 0 |
| 1 | C♯/D♭ | `2^(1/12)` | 100 |
| 2 | D | `2^(2/12)` | 200 |
| 3 | D♯/E♭ | `2^(3/12)` | 300 |
| 4 | E | `2^(4/12)` | 400 |
| 5 | F | `2^(5/12)` | 500 |
| 6 | F♯/G♭ | `2^(6/12)` | 600 |
| 7 | G | `2^(7/12)` | 700 |
| 8 | G♯/A♭ | `2^(8/12)` | 800 |
| 9 | A | `2^(9/12)` | 900 |
| 10 | A♯/B♭ | `2^(10/12)` | 1000 |
| 11 | B | `2^(11/12)` | 1100 |
| 12 | C | `2^(12/12)` = 2 | 1200 |

In 12-TET, C♯ and D♭ are the same pitch. That collapse is exactly what 19-TET and 31-TET undo.

## Writing 12-TET expressions

```
2 ^ (1/12)              # one semitone
2 ^ (7/12)              # a perfect fifth (7 semitones)
2 ^ (4/12)              # a major third (4 semitones)
base.f * 2 ^ (4/12)     # a major third above the BaseNote
[1].f * 2 ^ (1/12)      # one semitone above note 1
```

`^` binds tighter than `*`, so `base.f * 2 ^ (4/12)` needs no extra brackets.

You can reduce the exponent by hand — `4/12` is `1/3`, so `2^(1/3)` is the same major third — but you do not have to. Save the expression and the simplifier reduces the fraction for you.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(2).pow(new Fraction(7, 12))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(4, 12)))
module.getNoteById(1).getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 12)))
```
</details>

## Every interval

| Interval | Semitones | Expression | Nearest just ratio | 12-TET is off by |
|---|---|---|---|---|
| Minor second | 1 | `2^(1/12)` | 16/15 | −11.7¢ |
| Major second | 2 | `2^(1/6)` | 9/8 | −3.9¢ |
| Minor third | 3 | `2^(1/4)` | 6/5 | −15.6¢ |
| Major third | 4 | `2^(1/3)` | 5/4 | +13.7¢ |
| Perfect fourth | 5 | `2^(5/12)` | 4/3 | +2.0¢ |
| Tritone | 6 | `2^(1/2)` = √2 | 45/32 | +9.8¢ |
| Perfect fifth | 7 | `2^(7/12)` | 3/2 | −2.0¢ |
| Minor sixth | 8 | `2^(2/3)` | 8/5 | −13.7¢ |
| Major sixth | 9 | `2^(3/4)` | 5/3 | +15.6¢ |
| Minor seventh | 10 | `2^(5/6)` | 9/5 | −17.6¢ |
| Major seventh | 11 | `2^(11/12)` | 15/8 | +11.7¢ |
| Octave | 12 | `2` | 2/1 | 0 |

The fifth is within 2 cents of pure — inaudible in most contexts. The thirds and sixths are off by 13–16 cents, which is a *lot*: it is why a 12-TET major triad beats audibly and a just one does not. The minor seventh at −17.6¢ is the worst interval in the system.

## The shipped module

The library's **Scale Systems** section ships a **12-TET** module. (The file is `scale-systems/TET-12.json`, but the tile is labelled **12-TET**.)

| | |
|---|---|
| Notes | 13 — twelve steps plus the note you start on |
| Base frequency | `(263/4)` = 65.75 Hz |
| Tempo | 100 |
| Beats per measure | 4 |
| Instrument | `sine-wave` |
| Note duration | `beat(base) * (3/4)` |
| Step | `[n].f * 2 ^ (1/12)` |

Note 1 is `base.f`. Every later note is the previous note times one semitone, so the scale is a chain — lift note 1 and all thirteen move with it.

To load it, drag the tile from **Scale Systems** (or search `12` with the library magnifier) onto a note or onto the BaseNote circle — a drop on empty canvas is refused. The module's `base` references are rewritten to your drop target, so the scale re-roots onto that note. The full loading workflow is on [Equal Temperament](/user-guide/tuning/equal-temperament#loading-one).

Once loaded, twelve of the thirteen notes show a **≈** prefix and cross-hatching. That is correct: `2^(1/12)` is irrational, and the fraction the app draws is the note's approximate ratio to the BaseNote, not its exact value. Only note 1 — plain `base.f` — is unhatched.

## Why 12-TET won

**All keys are usable.** No key is more in tune than another, so you can modulate anywhere.

**Twelve is enough, barely.** Twelve fifths land 23.5 cents from seven octaves. Spread that comma across twelve fifths and each is only 2 cents flat — a compromise nobody notices.

**Instruments could be built for it.** A twelve-key-per-octave keyboard is playable by a human hand. A 31-key-per-octave one is not, without help.

## What it costs

**The thirds.** Fourteen cents sharp on the major third is the single loudest compromise in Western music, and it is baked into every piano you have heard.

**Every key sounds the same.** The historical character of keys — the reason a composer chose E♭ major over D major — is gone by construction.

**No septimal anything.** 7/4 has no representation. The nearest 12-TET seventh is 31 cents away.

## Practical use

**Matching other instruments.** If your piece has to sit alongside a piano recording or a guitar, use 12-TET.

**Transposing.** Multiply by a power of the step:

```
base.f * 2 ^ (5/12)     # up a fourth
[1].f * 2 ^ (-3/12)     # down a minor third from note 1
```

A negative exponent is legal. The simplifier reduces it on save, so `[1].f * 2 ^ (-3/12)` comes back as `[1].f / 2^(1/4)` — the same pitch, written as a division.

**Mixing with just intonation.** Nothing stops you. Put a just `3/2` fifth over a 12-TET root and the fifth will be the pure one. The hatching tells you which notes are which at a glance.

## Next steps

- [19-TET](/user-guide/tuning/19-tet) — thirds that are actually in tune
- [31-TET](/user-guide/tuning/31-tet) — thirds *and* sevenths
- [Pure Ratios](/user-guide/tuning/ratios) — what 12-TET is approximating
- [Custom TET](/user-guide/tuning/custom-tet) — any division you like
