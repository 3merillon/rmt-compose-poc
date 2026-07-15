---
title: The Module Library
description: The 79 shipped modules — intervals, chords, progressions, melodies, scale systems — and why each one is a relational tree you can re-root onto any note.
---

# The Module Library

RMT Compose ships **79 modules**. Not one of their notes carries an absolute pitch.

That is the point. A module does not store "A4 = 440 Hz followed by C♯5". It stores *a fifth above the root*, *a major third above the chord root*, *a fourth above the previous chord's root*. Every note is written against the module's own `base`, and dropping the module throws that `base` away and substitutes the note you dropped on. So you get a real chord, in a real key, at a real pitch — the one that note is at. Drop the same module on a different note and you get the same shape somewhere else, with exactly the same ratios.

So the library is not a bag of samples to paste. It is a set of relationships you graft onto what you already have.

![Module library tiles: coloured squares showing stacked fractions with cents for intervals, chord names with colon ratios, and wrapped names for melodies and scales](/img/module-library-icons.png)

## What ships

| Section | Modules | What's in it |
|---|---|---|
| **Intervals** | 46 | Every interval as a single note above the root, from the unison to the schisma |
| **Chords** | 11 | Triads and sevenths in just intonation, plus two RMT-native harmonic chords |
| **Progressions** | 8 | Four progressions and four cadences, each a chain of chord roots |
| **Melodies** | 7 | Public-domain tunes |
| **Scale Systems** | 6 | 12-, 19-, 31-TET, Bohlen–Pierce, Tesla, Mixed-Base |
| **Custom** | 1 | Where copied selections land, and the obvious home for your uploads |

They live in the [module bar](/user-guide/interface/module-bar) under the top bar. Drag one out and drop it on a note.

## How the catalog is built

Every module is a tree. The root of the tree is `base` — the module's own reference note — and everything else hangs off it, or off another note in the module. When you drop the module onto a note, `base` **becomes** that note, and the whole tree comes with it.

### An interval is one note

The Perfect 5th module holds exactly one note (plus its own `baseNote` block and a colour):

```json
{
  "id": 1,
  "startTime": "base.t",
  "duration": "beat(base)",
  "frequency": "(3/2) * base.f"
}
```

Drop it on a note and `base.f` becomes that note's frequency. You get a fifth above *that* note — exactly 3/2, not 700 cents of approximation. Drop it on a note that is itself a fifth above something, and you have stacked two exact fifths.

### A chord is a root, with tones hanging off it

The Major chord, frequencies only (note 1 starts at `base.t`, notes 2 and 3 at `[1].t`, and all three last `beat(base) * 2`):

```json
{ "id": 1, "frequency": "base.f" }
{ "id": 2, "frequency": "(5/4) * [1].f" }
{ "id": 3, "frequency": "(3/2) * [1].f" }
```

Note 1 is the **root**. Notes 2 and 3 are not independent pitches — they are *defined as* a major third and a fifth above note 1. Move note 1 and the third and the fifth follow it, still a third and a fifth.

This is the difference between a chord and three notes that happen to sound like a chord.

### A progression is a chain of roots

This is where it gets interesting. Here is **ii – V – I**, stripped to its frequencies:

```
[1]  (9/8) * base.f      ← the ii root — the only note that touches base
[2]  (6/5) * [1].f       ← minor third of ii
[3]  (3/2) * [1].f       ← fifth of ii

[4]  (4/3) * [1].f       ← the V root, a fourth above the ii root
[5]  (5/4) * [4].f       ← third of V
[6]  (3/2) * [4].f       ← fifth of V
[7]  (7/4) * [4].f       ← harmonic seventh of V

[8]  (2/3) * [4].f       ← the I root, a fifth below the V root
[9]  (5/4) * [8].f       ← third of I
[10] (3/2) * [8].f       ← fifth of I
[11] (2/1) * [8].f       ← octave of I
```

Read down the roots: note 1 comes from `base`. Note 4 comes from **note 1**. Note 8 comes from **note 4**. The roots move *by interval* — up a fourth, then down a fifth — exactly as a musician would describe the progression. Nothing in the module is in any key. The absolute pitches only exist once you drop it somewhere.

::: tip Try this
Drop **ii – V – I** onto a note. Now open the ii chord's root — the first note — in the [note widget](/user-guide/interface/variable-widget) and press the **▲** next to its frequency. That transposes it by the arrow interval, which is 2/1 until you change it in **Settings → Arrows**.

The **entire progression** goes with it. Every chord, every third, every seventh. The V root is still a fourth above the ii root, because that is literally what it says. You did not transpose eleven notes; you moved one note, and ten notes were defined relative to it.

Now try retuning instead of transposing: open that same root and multiply its frequency by `81/80`, a syntonic comma. The whole progression shifts with it, still perfectly in tune with itself.
:::

Cadences work the same way, with two chords instead of three or four.

### Melodies and scales chain too

Melodies are written as scale degrees against `base`, with start times in beats: `(5/4) * base.f`, `base.t + beat(base) * 3`. Change the BaseNote and the whole tune transposes. Drop it on a note and it plays from there.

Scale systems are **chained note to note** — each step lifts off the one below it:

```
[1]  base.f
[2]  [1].f * 2 ^ (1/12)
[3]  [2].f * 2 ^ (1/12)
...
```

Only the first note touches `base`. Lift note 5 and every note above it rises with it, because they are all defined as steps above their predecessor. This is what makes the scale modules useful for experimenting with tunings rather than only hearing them.

::: info
The scale systems are the only part of the catalog that deliberately makes notes **irrational**. `2 ^ (1/12)` cannot be written as a fraction, so notes built on it are flagged as corrupted in the workspace — shown with a `≈` and a hatched fill. That is honest labelling, not an error. See [Equal Temperament](/user-guide/tuning/equal-temperament).

The **Tesla** scale is the exception: it is built entirely from whole-number ratios, so every note in it stays exact.
:::

## Intervals — 46 modules

Each is a single note, one beat long, at a fixed ratio above whatever you drop it on. The tile shows the ratio as a fraction with its size in cents underneath.

**3-limit** — built from 2s and 3s only. Pythagorean tuning.

| Name | Ratio | Cents |
|---|---|---|
| Unison | 1/1 | 0 |
| Major 2nd | 9/8 | 203.910 |
| Pythagorean minor 3rd | 32/27 | 294.135 |
| Pythagorean major 3rd | 81/64 | 407.820 |
| Perfect 4th | 4/3 | 498.045 |
| Pythagorean tritone | 729/512 | 611.730 |
| Perfect 5th | 3/2 | 701.955 |
| Pythagorean major 6th | 27/16 | 905.865 |
| Pythagorean minor 7th | 16/9 | 996.090 |
| Pythagorean major 7th | 243/128 | 1109.775 |
| Octave | 2/1 | 1200 |

**5-limit** — the classic just intervals, the ones that beat cleanly.

| Name | Ratio | Cents |
|---|---|---|
| Just minor 2nd | 16/15 | 111.731 |
| Minor whole tone | 10/9 | 182.404 |
| Just minor 3rd | 6/5 | 315.641 |
| Just major 3rd | 5/4 | 386.314 |
| Just augmented 4th | 45/32 | 590.224 |
| Just diminished 5th | 64/45 | 609.776 |
| Just minor 6th | 8/5 | 813.686 |
| Just major 6th | 5/3 | 884.359 |
| Just minor 7th | 9/5 | 1017.596 |
| Just major 7th | 15/8 | 1088.269 |

**7-limit** — septimal. The blues-adjacent territory that 12-TET cannot reach.

| Name | Ratio | Cents |
|---|---|---|
| Septimal whole tone | 8/7 | 231.174 |
| Septimal minor 3rd | 7/6 | 266.871 |
| Septimal major 3rd | 9/7 | 435.084 |
| Septimal tritone | 7/5 | 582.512 |
| Septimal tritone (wide) | 10/7 | 617.488 |
| Septimal narrow 5th | 32/21 | 729.219 |
| Septimal minor 6th | 14/9 | 764.916 |
| Septimal major 6th | 12/7 | 933.129 |
| Harmonic 7th | 7/4 | 968.826 |
| Septimal major 7th | 63/32 | 1172.736 |

**Higher limits** — 11, 13, 17, 19 and 23. Neutral thirds and other intervals with no name in common practice.

| Name | Ratio | Cents |
|---|---|---|
| 17th harmonic | 17/16 | 104.955 |
| Tridecimal neutral 2nd | 13/12 | 138.573 |
| 19th harmonic | 19/16 | 297.513 |
| Undecimal neutral 3rd | 11/9 | 347.408 |
| Undecimal tritone | 11/8 | 551.318 |
| 23rd harmonic | 23/16 | 628.274 |
| Tridecimal diminished 5th | 13/9 | 636.618 |
| Tridecimal neutral 6th | 13/8 | 840.528 |
| Undecimal neutral 7th | 11/6 | 1049.363 |

**Commas** — the tiny discrepancies that tuning systems exist to hide. Drop one on a note and you get a second note a comma away from it. The two beat slowly against each other, which is what a comma actually sounds like.

| Name | Ratio | Cents |
|---|---|---|
| Schisma | 32805/32768 | 1.954 |
| Diaschisma | 2048/2025 | 19.553 |
| Syntonic comma | 81/80 | 21.506 |
| Pythagorean comma | 531441/524288 | 23.460 |
| Septimal comma | 64/63 | 27.264 |
| Enharmonic diesis | 128/125 | 41.059 |

## Chords — 11 modules

Each is a root plus its tones, all starting together, two beats long. The tile shows the name with the chord's harmonic ratio underneath.

| Name | Ratio | Tones above the root |
|---|---|---|
| Major | 4:5:6 | 1/1, 5/4, 3/2 |
| Minor | 10:12:15 | 1/1, 6/5, 3/2 |
| Diminished | 5:6:7 | 1/1, 6/5, 7/5 |
| Augmented | 16:20:25 | 1/1, 5/4, 25/16 |
| Sus4 | 6:8:9 | 1/1, 4/3, 3/2 |
| Dominant 7th | 36:45:54:64 | 1/1, 5/4, 3/2, 16/9 |
| Harmonic 7th | 4:5:6:7 | 1/1, 5/4, 3/2, 7/4 |
| Minor 7th | 10:12:15:18 | 1/1, 6/5, 3/2, 9/5 |
| Major 7th | 8:10:12:15 | 1/1, 5/4, 3/2, 15/8 |
| Base-3 chord | 3:5:7:9 | 1/1, 5/3, 7/3, 3/1 |
| Base-5 chord | 5:7:9:11 | 1/1, 7/5, 9/5, 11/5 |

Two of these deserve a note:

**Dominant 7th and Harmonic 7th are not the same chord.** The Dominant 7th takes its seventh from 16/9, which gives the classic 64/45 tritone against the 5/4 third — the tense, wants-to-resolve sound of functional harmony. The Harmonic 7th (4:5:6:7) takes 7/4 instead: four consecutive harmonics, and the flattest, sweetest seventh there is. It does not want to resolve. Play them back to back.

**Base-3 and Base-5 are RMT's own chords.** They are runs of consecutive *odd* harmonics stacked over an odd root: 3:5:7:9 and 5:7:9:11. There is no common-practice name for them because common practice was built on the octave, and these are not.

## Progressions and cadences — 8 modules

Both live in the **Progressions** section. Every root is expressed as a move from the previous root, so the roots you see below are what the chain resolves to — not what is written in the file.

| Module | Chords | Roots resolve to |
|---|---|---|
| V7 – I | Harmonic 7th → Major (with octave) | 3/2 → 1/1 |
| ii – V – I | Minor → Harmonic 7th → Major (with octave) | 9/8 → 3/2 → 1/1 |
| I – IV – V – I | Major → Major → Major → Major (with octave) | 1/1 → 4/3 → 3/2 → 1/1 |
| I – vi – IV – V | Major → Minor → Major → Major | 1/1 → 5/3 → 4/3 → 3/2 |
| Authentic (V–I) | Major → Major (with octave) | 3/2 → 1/1 |
| Plagal (IV–I) | Major → Major (with octave) | 4/3 → 1/1 |
| Deceptive (V–vi) | Major → Minor | 3/2 → 5/3 |
| Half (I–V) | Major → Major | 1/1 → 3/2 |

Each chord lasts two beats; the resolving chord in **ii – V – I** lasts four.

Because the roots chain, a progression is a single object with a single handle. Grab the first root and the progression moves. That is not a feature that was added — it falls out of writing the music down honestly.

## Melodies — 7 modules

Public-domain tunes, written as scale degrees against the BaseNote.

| Name | Notes | Tempo | Beats/measure |
|---|---|---|---|
| Ode to Joy | 15 | 120 | 4 |
| Twinkle Twinkle | 14 | 120 | 4 |
| Frère Jacques | 32 | 120 | 4 |
| Amazing Grace | 32 | 150 | 3 |
| Greensleeves | 19 | 200 | 3 |
| Bach Minuet in G | 16 | 150 | 3 |
| Scarborough Fair | 15 | 150 | 3 |

Drop one on a note and it plays from there, in tune with everything around it. Frère Jacques is a round: drop a second copy onto a note partway through the first and it sings against itself.

## Scale Systems — 6 modules

Chained scales: each note is a step above the previous one, so the scale is a ladder, not a list. Each note starts when the one before it ends, and the note length is set per module — the wider the scale, the shorter the note, so a 31-note run does not take half a minute.

| Name | Notes | Step | Note length | Repeats at |
|---|---|---|---|---|
| 12-TET | 13 | `× 2 ^ (1/12)` | ¾ beat | the octave |
| 19-TET | 20 | `× 2 ^ (1/19)` | ½ beat | the octave |
| 31-TET | 32 | `× 2 ^ (1/31)` | ¼ beat | the octave |
| Bohlen–Pierce | 14 | `× 3 ^ (1/13)` | ½ beat | the **tritave** (3/1) |
| Tesla | 81 | odd harmonics — see below | 1 beat | never |
| Mixed-Base | 12 | mixed 2-, 3- and 5-based steps | ½ beat | returns to `base.f` |

Each equal temperament runs one full period plus the note it started on, so you hear it close.

**Bohlen–Pierce** divides the tritave (3/1) into 13 equal steps instead of dividing the octave. It has no octave at all. It sounds like nothing else here, and it is the fastest way to hear that "the octave" is a choice.

### The Tesla scale, honestly

**Tesla is not an equal temperament**, and it does not repeat at the octave — or anywhere. It is a construction, named for the 3-6-9 idea, not a historical tuning.

Here is exactly what it is: take the **odd numbers from 9 to 169** and divide each by 9.

```
9/9, 11/9, 13/9, 15/9, 17/9, … 167/9, 169/9
```

That is 81 notes (81 = 3⁴), anchored on the 9th harmonic (9 = 3²). In the file it is written as a chain, so each step is the next odd harmonic over the current one — `11/9`, then `13/11`, then `15/13`, all the way down to `169/167`.

The consequence is the interesting part. The steps **shrink as the scale climbs**: the first step is 347 cents — a neutral third — and the last is 21 cents, barely a comma. It starts as a chord and ends as a shimmer. The whole thing spans 169/9, about 5077 cents, or 4.23 octaves, which is why its BaseNote is set an octave low (131.5 Hz) — otherwise the top of it would be out of hearing.

It is a harmonic series segment stretched over four octaves, not a scale in the usual sense. Play it and you will hear that immediately. And unlike the equal temperaments sitting beside it, every note in it is an **exact ratio** — nothing in Tesla is approximated.

**Mixed-Base** is an experiment: 12 notes whose steps mix octave-based, tritave-based and 5-based roots (`2^(1/12)`, `3^(1/13)`, `5^(1/7)`, and some inverses), and whose final note jumps straight back to `base.f`. It goes wandering and comes home.

## Custom — 1 module

**Custom** ships with `canon base`, a 74-note canon with four silences in it — a real composition to take apart. It is also where **Copy to Modules** files anything you build from a multi-note selection. Uploaded `.json` files land in whichever section's dashed **`+`** tile you clicked, so Custom is the obvious place to put them, not the only one.

## Where to go next

- [Module Bar](/user-guide/interface/module-bar) — searching, dropping, and managing the library
- [Loading Modules](/user-guide/modules/loading-modules) — drop targets and the **Start** / **End** drop-mode buttons
- [Dependencies](/user-guide/notes/dependencies) — what the trees in these modules are made of
- [Expressions](/user-guide/notes/expressions) — the DSL every module is written in
- [Ratios](/user-guide/tuning/ratios) — why 3/2 and not 700 cents
- [Bohlen–Pierce](/user-guide/tuning/bohlen-pierce) — the scale with no octave
