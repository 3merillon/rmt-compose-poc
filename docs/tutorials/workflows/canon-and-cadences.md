---
title: Reading the canon and its cadences
description: Trace a forward pitch reference in the opening canon and hear octave placement resolve a dominant seventh.
---

# Reading the canon and its cadences

Open the eight-bar startup score or **Custom → canon**. Listen for the red theme, the blue bass, and the green bass entering four time units after the blue one. At the opening pace, one unit is 3/5 second (100 BPM), so the answering voice enters 2.4 seconds later. Its rhythm follows the blue line. Its pitch answers at the fifth in 57 of its 58 notes.

## Follow the exception in bar 5

Select the green A under the held red F. Open its frequency expression. These are the local IDs when you open each complete file on its own. Dropping a module into another score assigns new IDs.

| Pitch | Startup score | Library canon |
|---|---|---|
| Held F in the theme | Note 72 reads `(8/5) * [81].f` | Note 23 reads `(8/5) * [127].f` |
| A in the answering bass | Note 81 reads `(2/3) * [83].f` | Note 127 reads `(2/3) * [24].f` |
| Following E in the theme | Note 83 | Note 24 |

Read the pitches from the E backward. The A sits a fifth below the E, and the held F sits a minor sixth above the A. That puts the F at `16/15` of the following E. The pitches resolve down by a just semitone. Time runs the other way. In the startup score the E begins at `[72].t + [72].d`, while the green A copies note 63’s duration and begins four units after its start. Pitch and start time can follow different parents, including a pitch that sounds later.

Loop the complete canon to hear the next entry a whole tone higher. Its BaseNote stores the repeat ratio `9/8`. **Custom → canon base** and **canon melody** isolate the leading bass and theme and omit the repeat setting. [Loop playback](/user-guide/playback/transport#rising-or-falling-each-time-round)

## Hear octave placement in a cadence

Open **Progressions → V7 – I** and listen for the lowest voice stepping down. Each chord has a durationless pitch anchor representing its harmonic root. The sounding notes refer to that root and can sit in another octave. The dominant uses the harmonic seventh. Here are its voices ordered by sounding pitch, with both columns measured against the tonic.

| Voice | V7 | I | Motion |
|---|---|---|---|
| Bass | 9/16 | 1/2 | Down a whole tone |
| Next voice | 3/4 | 3/4 | Common tone |
| Next voice | 15/16 | 1 | Up to the tonic |
| Top voice | 21/16 | 5/4 | Down to the third |

To trace the bass, inspect the first chord’s fifth. Its ratio to the dominant root is `3/8`, a fifth displaced down two octaves. Multiplying that by the dominant’s `3/2` gives the sounding `9/16`. The harmonic root still moves from V to I even though the bass starts on scale degree two.

Try **ii – V – I** for the same resolution with a preparation. Compare **I – IV – V – I**, **I – vi – IV – V**, and the four cadences **Authentic**, **Plagal**, **Deceptive**, and **Half**. Each of the eight files places individual chord tones by octave. Listen for common tones first, then follow the bass across the chord change.
