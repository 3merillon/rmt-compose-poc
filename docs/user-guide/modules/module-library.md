---
title: The Module Library
description: The 81 shipped modules — intervals, chords, progressions, melodies, scale systems — including their ratios, progression timings, scale periods and canon parts.
---

# The Module Library

Choose from **81 shipped modules**. An interval adds one pitch, a progression adds several chords, and a complete canon adds three voices. For a first comparison, open the module bar, choose **Start**, and drag **Intervals → Perfect 5th** onto a sounding note. The new pitch begins with its target and follows it at 3/2. Choose **End** to hear the interval after the target instead.

![The Intervals section begins with 1/1, 9/8, 32/27, 81/64 and 4/3 tiles](/img/module-library-icons.png)

*Read each interval as a fraction. The small line underneath gives its size in cents.*

## What ships

| Section | Modules | What's in it |
|---|---|---|
| **Intervals** | 46 | Every interval as a single note above the root, from the unison to the schisma |
| **Chords** | 11 | Triads and sevenths in just intonation, plus two RMT-native harmonic chords |
| **Progressions** | 8 | Four progressions and four cadences, each a chain of chord roots |
| **Melodies** | 7 | Public-domain tunes |
| **Scale Systems** | 6 | 12-, 19-, 31-TET, Bohlen–Pierce, Tesla, Mixed-Base |
| **Custom** | 3 | Where copied selections land, and the obvious home for your uploads |

Drag a tile from the [module bar](/user-guide/interface/module-bar) onto a note. Every built-in tile adds only sounding notes. Modules you upload or copy keep any rests, bars or pitch references you included.

## How the catalog is built

Open a module file on its own to use its saved BaseNote pitch and time unit. Drop its tile into a workspace to use that workspace’s time unit (`base.d`). On a sounding target, the target supplies the pitch anchor, and the **Start** or **End** control places the imported passage in time. A drop on the BaseNote begins at its start in either mode. [Loading modules](/user-guide/modules/loading-modules)

| Musical structure | What to inspect |
|---|---|
| Single interval | **Perfect 5th** contains one note at `(3/2) * base.f`, lasting `base.d`. Drop it onto another fifth to hear two stacked fifths. |
| Chord | **Major** has three simultaneous pitches, all written against `base.f`. The third and fifth copy the first tone’s start and duration. Retune the drop target to move all three together. |
| Progression | In **ii – V – I**, each chord follows its sounding root. In the module file, the V root (note 4) reads `(4/3) * [1].f`, and the I root (note 8) reads `(2/3) * [4].f`. |
| Melody | Pitch can be a scale degree against the tonic while time follows a preceding note’s end. Lengthen the first note of **Ode to Joy** and listen to the later entrances move. |
| Scale | In **12-TET** each successive pitch multiplies the previous one by `2^(1/12)`. Twelve steps reach the octave exactly. **Mixed-Base** ends with a fresh `base.f` reference. |
| Canon | A pitch can refer across voices or forward in score time, while its onset and duration follow another line. [Trace bar 5 and a cadence](/tutorials/workflows/canon-and-cadences). |

## Intervals — 46 modules

Each is a single note, one time unit long, at a fixed ratio above whatever you drop it on. The tile shows the ratio as a fraction with its size in cents underneath.

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

Each is a root plus its tones, all starting together, two time units long. The tile shows the name with the chord's harmonic ratio underneath.

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

**Dominant 7th and Harmonic 7th are not the same chord.** The Dominant 7th takes its seventh from 16/9, which gives the classic 64/45 tritone against the 5/4 third — the tense, wants-to-resolve sound of functional harmony. The Harmonic 7th (4:5:6:7) uses four consecutive harmonics. Its 7/4 is lower than 16/9. Play them back to back.

**Base-3 and Base-5 are RMT's own chords.** They are runs of consecutive *odd* harmonics stacked over an odd root: 3:5:7:9 and 5:7:9:11. There is no common-practice name for them because common practice was built on the octave, and these are not.

## Progressions and cadences — 8 modules

Both live in the **Progressions** section. Each sounding root takes its pitch from the previous root. The table gives the harmonic roots relative to the tonic before octave placement.

| Module | Chords | Harmonic roots | Chord lengths |
|---|---|---|---|
| V7 – I | Harmonic 7th → Major (with octave) | 3/2 → 1/1 | 2 + 2 |
| ii – V – I | Minor → Harmonic 7th → Major (with octave) | 9/8 → 3/2 → 1/1 | 2 + 2 + 4 |
| I – IV – V – I | Major → Major → Major → Major (with octave) | 1/1 → 4/3 → 3/2 → 1/1 | 2 + 2 + 2 + 2 |
| I – vi – IV – V | Major → Minor → Major → Major | 1/1 → 5/3 → 4/3 → 3/2 | 2 + 2 + 2 + 2 |
| Authentic (V–I) | Major → Major (with octave) | 3/2 → 1/1 | 2 + 2 |
| Plagal (IV–I) | Major → Major (with octave) | 4/3 → 1/1 | 2 + 2 |
| Deceptive (V–vi) | Major → Minor | 3/2 → 5/3 | 2 + 2 |
| Half (I–V) | Major → Major | 1/1 → 3/2 | 2 + 2 |

Read the last column as successive chord lengths in units of `base.d`. In **ii – V – I** the tonic lasts as long as the first two chords together.

Transpose the first chord’s sounding root to move the whole progression. Transpose a later root to move that chord and the ones that follow.

## Melodies — 7 modules

Public-domain tunes, written as scale degrees against the BaseNote.

| Name | Notes | BaseNote duration | Reads as |
|---|---|---|---|
| Ode to Joy | 15 | `1/2` | 120 BPM |
| Twinkle Twinkle | 14 | `1/2` | 120 BPM |
| Frère Jacques | 32 | `1/2` | 120 BPM |
| Amazing Grace | 32 | `2/5` | 150 BPM |
| Greensleeves | 19 | `3/10` | 200 BPM |
| Bach Minuet in G | 16 | `2/5` | 150 BPM |
| Scarborough Fair | 15 | `2/5` | 150 BPM |

Each melody's pace is its BaseNote's duration, the time unit, and every note length is written against it. The "Reads as" column is `60 / base.d`, which the note widget shows next to the duration. Dropped on a note, a melody takes that note's start and pitch and keeps the workspace's time unit (`base.d` stays `base.d`); see [Loading Modules](/user-guide/modules/loading-modules#drop-a-library-module-onto-a-note).
For a round with **Frère Jacques**, choose **Start** and drop a second copy onto a note partway through the first. The target pitch and start time determine the second entry.

## Scale Systems — 6 modules

Chained scales: each note is a step above the previous one, so the scale is a ladder, not a list. Each note starts when the one before it ends, and the note length is set per module — the wider the scale, the shorter the note, so a 31-note run does not take half a minute.

| Name | Notes | Step | Note length | Repeats at |
|---|---|---|---|---|
| 12-TET | 13 | `× 2 ^ (1/12)` | ¾ time unit | the octave |
| 19-TET | 20 | `× 2 ^ (1/19)` | ½ time unit | the octave |
| 31-TET | 32 | `× 2 ^ (1/31)` | ¼ time unit | the octave |
| Bohlen–Pierce | 14 | `× 3 ^ (1/13)` | ½ time unit | the **tritave** (3/1) |
| Tesla | 81 | odd harmonics — see below | 1 time unit | never |
| Mixed-Base | 12 | mixed 2-, 3- and 5-based steps | ½ time unit | returns to `base.f` |

Each equal temperament runs one full period plus the note it started on, so you hear it close.

**Bohlen–Pierce** divides the tritave (3/1) into 13 equal steps instead of dividing the octave. It has no octave at all. It sounds like nothing else here, and it is the fastest way to hear that "the octave" is a choice.

### The Tesla scale {#the-tesla-scale-honestly}

**Tesla is not an equal temperament**, and it does not repeat at the octave — or anywhere. It is a construction, named for the 3-6-9 idea, not a historical tuning.

Here is exactly what it is: take the **odd numbers from 9 to 169** and divide each by 9.

```
9/9, 11/9, 13/9, 15/9, 17/9, … 167/9, 169/9
```

That is 81 notes (81 = 3⁴), anchored on the 9th harmonic (9 = 3²). In the file it is written as a chain, so each step is the next odd harmonic over the current one — `11/9`, then `13/11`, then `15/13`, all the way down to `169/167`.

The consequence is the interesting part. The steps **shrink as the scale climbs**: the first step is 347 cents — a neutral third — and the last is 21 cents, barely a comma.  The whole thing spans 169/9, about 5077 cents, or 4.23 octaves, which is why its BaseNote is set an octave low (131.5 Hz).

Listen for the gap between successive notes narrowing as the pitches climb. And unlike the equal temperaments sitting beside it, every note in it is an **exact ratio** — nothing in Tesla is approximated.

**Mixed-Base** is an experiment: 12 notes whose steps mix octave-based, tritave-based and 5-based roots (`2^(1/12)`, `3^(1/13)`, `5^(1/7)`, and some inverses), and whose final note jumps straight back to `base.f`. It goes wandering and comes home.

## Custom — 3 modules

**Custom** includes the eight-bar canon per tonos that opens the app (153 sounding notes), the leading bass `canon base` (70 notes), and the theme `canon melody` (25 notes). The full canon tile carries all three voices. Its measure markers belong to the startup score only.

The answering bass enters one bar later. Of its 58 notes, 57 are exact fifths above the notes they answer. In bar 5, open the green A (library note 127, startup note 81). It takes its frequency from the following red E by a factor of 2/3. The held F takes its pitch from that A by a factor of 8/5. **Copy to Modules** also puts selections in Custom. Uploaded files go into whichever section’s **+** tile you choose.

## Where to go next

- [Module Bar](/user-guide/interface/module-bar) — searching, dropping, and managing the library
- [Loading Modules](/user-guide/modules/loading-modules) — drop targets and the **Start** / **End** drop-mode buttons
- [Dependencies](/user-guide/notes/dependencies) — what the trees in these modules are made of
- [Expressions](/user-guide/notes/expressions) — the DSL every module is written in
- [Ratios](/user-guide/tuning/ratios) — why 3/2 and not 700 cents
- [Bohlen–Pierce](/user-guide/tuning/bohlen-pierce) — the scale with no octave
