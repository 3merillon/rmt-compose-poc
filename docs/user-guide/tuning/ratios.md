---
title: Pure Ratios
description: Just intonation in RMT Compose — the harmonic series, interval ratios, the 46 shipped interval modules, and how to write ratios in the DSL.
---

# Pure Ratios

A pure ratio is an interval written as an exact fraction: a fifth is `3/2`, not 1.4983. RMT Compose stores it that way and evaluates it with exact rational arithmetic, so `3/2 × 5/4` is `15/8` and nothing rounds.

This page covers just intonation: where the ratios come from, how to type them, and the 46 interval modules the app ships so you don't have to type them.

## Where the ratios come from

A vibrating string produces a fundamental plus overtones at integer multiples of it:

| Harmonic | Multiple | Interval above the fundamental |
|---|---|---|
| 1 | 1× | unison |
| 2 | 2× | octave (2/1) |
| 3 | 3× | octave + fifth (3/1) |
| 4 | 4× | two octaves (4/1) |
| 5 | 5× | two octaves + major third (5/1) |
| 6 | 6× | two octaves + fifth (6/1) |
| 7 | 7× | the harmonic seventh (7/1) |

Reduce any two harmonics into the same octave and you get an interval ratio: 3 against 2 is the fifth `3/2`, 5 against 4 is the major third `5/4`, 6 against 5 is the minor third `6/5`. That is all just intonation is.

The **limit** of a ratio is its largest prime factor. `3/2` and `9/8` are 3-limit (Pythagorean). `5/4` and `6/5` are 5-limit (classical). `7/4` and `7/5` are 7-limit (septimal). The library groups its intervals by limit and colours the icons by family.

## Writing a ratio

Type the expression into the note widget's **Raw:** field for `frequency`, then press **Save**. Nothing changes while you type.

```
base.f * (3/2)          # a fifth above the BaseNote
base.f / (5/4)          # a major third below
base.f * (3/2) * (5/4)  # fifth then third = 15/8
[1].f * (7/4)           # harmonic seventh above note 1
```

The parentheses are part of the fraction literal — `(3/2)` is one exact rational, not a division of two numbers. Write ratios that way and they stay exact.

::: tip The app writes the coefficient first
Every shipped interval module stores its ratio coefficient-first — the fifth is `(3/2) * base.f` — and when you drag a note or click an arrow, RMT folds the factor into that leading coefficient. `base.f * (3/2)` is equally valid and evaluates to the same pitch; it survives a save exactly as you typed it. The coefficient-first form is what the app writes when it writes for you, not something it imposes on what you write.
:::

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.baseNote.getVariable('frequency').div(new Fraction(5, 4))
module.getNoteById(1).getVariable('frequency').mul(new Fraction(7, 4))
```
</details>

## The Intervals section of the library

You rarely need to type a ratio at all. The module library — the bar under the top bar — ships **46 interval modules** in its **Intervals** section. Each one is a single note whose frequency is `(N/D) * base.f`. Drop it on a note and you get that interval above that note.

| Family | Count | Members |
|---|---|---|
| 3-limit | 11 | Unison 1/1 · Major 2nd 9/8 · Pythagorean minor 3rd 32/27 · Pythagorean major 3rd 81/64 · Perfect 4th 4/3 · Pythagorean tritone 729/512 · Perfect 5th 3/2 · Pythagorean major 6th 27/16 · Pythagorean minor 7th 16/9 · Pythagorean major 7th 243/128 · Octave 2/1 |
| 5-limit | 10 | Just minor 2nd 16/15 · Minor whole tone 10/9 · Just minor 3rd 6/5 · Just major 3rd 5/4 · Just augmented 4th 45/32 · Just diminished 5th 64/45 · Just minor 6th 8/5 · Just major 6th 5/3 · Just minor 7th 9/5 · Just major 7th 15/8 |
| 7-limit | 10 | Septimal whole tone 8/7 · Septimal minor 3rd 7/6 · Septimal major 3rd 9/7 · Septimal tritone 7/5 · Septimal tritone (wide) 10/7 · Septimal narrow 5th 32/21 · Septimal minor 6th 14/9 · Septimal major 6th 12/7 · Harmonic 7th 7/4 · Septimal major 7th 63/32 |
| higher | 9 | Undecimal tritone 11/8 · Undecimal neutral 3rd 11/9 · Undecimal neutral 7th 11/6 · Tridecimal neutral 2nd 13/12 · Tridecimal diminished 5th 13/9 · Tridecimal neutral 6th 13/8 · 17th harmonic 17/16 · 19th harmonic 19/16 · 23rd harmonic 23/16 |
| comma | 6 | Schisma 32805/32768 · Diaschisma 2048/2025 · Syntonic comma 81/80 · Pythagorean comma 531441/524288 · Septimal comma 64/63 · Enharmonic diesis 128/125 |

Each tile draws its ratio as a stacked fraction, with the interval's size in cents underneath. The cents caption is controlled by **Show cents** in **Settings → Library** (on by default).

To find one fast, click the **magnifier** in the library toolbar and type into **Search name, ratio, tag…**. It matches the display name, the ratio, the family, the cents value and the tags — so `3/2`, `fifth`, `septimal` and `comma` all work, and matches surface even inside collapsed sections.

::: warning A module must land on a note
Drag the tile onto an existing note or onto the BaseNote circle. Dropping it on empty canvas is rejected with *"Drop onto a note or the BaseNote circle to import a module."*, and dropping it on a silence is rejected with *"Cannot drop onto a silence. Drop on a note or the BaseNote instead."*
:::

## The Chords section

The **Chords** section ships 11 chords, each written as a ratio over its own root. The root is `base.f`; every chord tone is a ratio of the root, so the chord is a subtree, not three loose pitches. Move or retune the root and the whole chord follows.

| Chord | Ratio | Tones above the root |
|---|---|---|
| Major | 4:5:6 | 1/1, 5/4, 3/2 |
| Minor | 10:12:15 | 1/1, 6/5, 3/2 |
| Dominant 7th | 36:45:54:64 | 1/1, 5/4, 3/2, 16/9 |
| Harmonic 7th | 4:5:6:7 | 1/1, 5/4, 3/2, 7/4 |
| Minor 7th | 10:12:15:18 | 1/1, 6/5, 3/2, 9/5 |
| Major 7th | 8:10:12:15 | 1/1, 5/4, 3/2, 15/8 |
| Diminished | 5:6:7 | 1/1, 6/5, 7/5 |
| Augmented | 16:20:25 | 1/1, 5/4, 25/16 |
| Sus4 | 6:8:9 | 1/1, 4/3, 3/2 |
| Base-3 chord | 3:5:7:9 | 1/1, 5/3, 7/3, 3/1 |
| Base-5 chord | 5:7:9:11 | 1/1, 7/5, 9/5, 11/5 |

Two of these deserve a note. **Dominant 7th** uses `16/9` for its seventh, not `7/4` — `16/9` against the `5/4` third gives the classic `64/45` tritone. The septimal chord with `7/4` in it is the separate **Harmonic 7th** (4:5:6:7). And **Base-3** / **Base-5** are the RMT-native shapes: consecutive odd harmonics stacked over an odd root.

The shipped Major chord looks like this:

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f",         "startTime": "base.t", "duration": "beat(base) * 2" },
    { "id": 2, "frequency": "(5/4) * [1].f",  "startTime": "[1].t",  "duration": "beat(base) * 2" },
    { "id": 3, "frequency": "(3/2) * [1].f",  "startTime": "[1].t",  "duration": "beat(base) * 2" }
  ]
}
```

## Building scales by hand

### Just major scale

| Degree | Ratio | Interval from the root |
|---|---|---|
| 1 | 1/1 | unison |
| 2 | 9/8 | major second |
| 3 | 5/4 | major third |
| 4 | 4/3 | perfect fourth |
| 5 | 3/2 | perfect fifth |
| 6 | 5/3 | major sixth |
| 7 | 15/8 | major seventh |
| 8 | 2/1 | octave |

### Just natural minor scale

| Degree | Ratio | Interval from the root |
|---|---|---|
| 1 | 1/1 | unison |
| 2 | 9/8 | major second |
| 3 | 6/5 | minor third |
| 4 | 4/3 | perfect fourth |
| 5 | 3/2 | perfect fifth |
| 6 | 8/5 | minor sixth |
| 7 | 9/5 | minor seventh |
| 8 | 2/1 | octave |

Each degree is one note with `frequency` set to `(ratio) * base.f`. [Build a Major Scale](/tutorials/beginner/major-scale) walks the whole thing.

## Arrows: step by any interval, not just the octave

Every note with a frequency carries **▲ / ▼** arrows — on its left edge in the workspace, and in the note widget's frequency row. They multiply the frequency expression by a ratio you choose in **Settings → Arrows**; the octave is only the default.

Set the interval to **3/2** and every ▲ click walks the note up a pure fifth. Set it to **81/80** and the arrows become a comma nudge — the finest useful tool in a just-intonation workflow. The factor is folded into the expression's rational coefficient rather than stacked on the front, so ▲ then ▼ returns you to exactly `base.f`, not `(1/2) * 2 * base.f`.

The interval must be a ratio of positive integers between 1/16 and 16 — you cannot bind an arrow to a TET step like `2^(1/12)`, and an invalid ratio resets to the default octave 2/1. The controls, the quick-pick chips and the folding rules are all on [Transposing with Arrows](/user-guide/notes/transposing).

## Pure ratios never show ≈

A note built from ratios evaluates to an exact fraction. It renders with a plain fraction label and no hatching. The moment a note's frequency involves an irrational power — a TET step — it gets flagged: the label picks up an **≈** prefix and the note is cross-hatched.

That contrast is the fastest way to see, at a glance, which parts of a piece are just and which are tempered. See [Equal Temperament](/user-guide/tuning/equal-temperament) for what happens on the other side of the line.

## Just versus 12-TET

| Interval | Just ratio | Just cents | 12-TET cents | 12-TET is off by |
|---|---|---|---|---|
| Minor second | 16/15 | 111.7 | 100 | −11.7¢ |
| Major second | 9/8 | 203.9 | 200 | −3.9¢ |
| Minor third | 6/5 | 315.6 | 300 | −15.6¢ |
| Major third | 5/4 | 386.3 | 400 | +13.7¢ |
| Perfect fourth | 4/3 | 498.0 | 500 | +2.0¢ |
| Perfect fifth | 3/2 | 702.0 | 700 | −2.0¢ |
| Minor sixth | 8/5 | 813.7 | 800 | −13.7¢ |
| Major sixth | 5/3 | 884.4 | 900 | +15.6¢ |
| Major seventh | 15/8 | 1088.3 | 1100 | +11.7¢ |

The fifth is nearly right. The thirds and sixths are off by more than a seventh of a semitone, which is why a just major triad sounds so much calmer than a piano one.

## Playing ratios back

Any frequency plays on any instrument. The sampled **piano** and **violin** are multisampled and pitch-shift each zone by `frequency / rootHz`, so an 11/8 or a 531441/524288 comes out at exactly the pitch you asked for — they are not quantized to a keyboard. The synth voices (`sine-wave`, `square-wave`, `sawtooth-wave`, `triangle-wave`, `organ`, `vibraphone`, `fm-epiano`) are oscillators and have never cared.

Pick the default in **Settings → Audio → Default instrument**, or set `instrument` on an individual note.

## Considerations

**Instrument compatibility.** Acoustic instruments and fixed-pitch keyboards are built for 12-TET. A just-intonation piece will not line up with a recording of one.

**Harmony gets more specific.** Intervals that 12-TET conflates split apart. A minor seventh could be `16/9` (two fourths stacked), `9/5` (the 5-limit one), or `7/4` (the harmonic seventh) — three different pitches, three different meanings. You have to decide which one you meant. That is the cost, and it is also the point.

## Next steps

- [Equal Temperament](/user-guide/tuning/equal-temperament) — the other approach, and how RMT stores it
- [Build a Major Scale](/tutorials/beginner/major-scale) — a worked scale from scratch
- [Expression Syntax Reference](/reference/expressions/syntax) — the full grammar
