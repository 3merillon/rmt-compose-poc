---
title: Reading the canon and its cadences
description: Trace a forward pitch reference in the opening canon and hear octave placement resolve a dominant seventh.
---

# Reading the canon and its cadences

Save your current score with **+ → Save Module**. Choose **+ → Load Module → Reset Default Module**, then **Yes, Reset**, to open the eight-bar canon with the startup IDs. Listen for the red theme, the blue bass, and the green bass entering four time units after the blue one. At the opening pace, one unit is 3/5 second (100 BPM), so the answering voice enters 2.4 seconds later. Its rhythm follows the blue line. Its pitch answers at the fifth in 57 of its 58 notes.

## Follow the exception in bar 5

Select the green A under the held red F. Open its frequency expression. These are the local IDs when you open each complete file on its own. Dropping a module into another score assigns new IDs.

| Pitch | Startup score | Library canon |
|---|---|---|
| Held F in the theme | Note 72 reads `(8/5) * [81].f` | Note 23 reads `(8/5) * [127].f` |
| A in the answering bass | Note 81 reads `(2/3) * [83].f` | Note 127 reads `(2/3) * [24].f` |
| Following E in the theme | Note 83 | Note 24 |

![White-outlined green A, note 81, with pitch links to the red theme in bar 5](/img/canon-bar-five.png)

*The red F at upper left reads the selected green A. The A reads the next red note, E, at upper right.*

Read the pitches from the E backward. The A sits a fifth below the E, and the held F sits a minor sixth above the A. That puts the F at `16/15` of the following E. The pitches resolve down by a just semitone. Time runs the other way. In the startup score the E begins at `[72].t + [72].d`, while the green A copies note 63’s duration and begins four units after its start. Pitch and start time can follow different parents, including a pitch that sounds later.

To hear the dependency, select startup note 81. On its **Frequency** row, replace the **Raw** expression with `(3/4) * [83].f` and press **Save**. The green A and the held red F both rise by 9/8. The following E holds its pitch. Undo the edit with **Ctrl/Cmd+Z** and play bar 5 again.

Loop the complete canon to hear the next entry a whole tone higher. Its BaseNote stores the repeat ratio `9/8`. **Custom → canon base** and **canon melody** isolate the leading bass and theme and omit the repeat setting. [Loop playback](/user-guide/playback/transport#rising-or-falling-each-time-round)

## Hear octave placement in a cadence

Select the BaseNote, choose **Clean Slate**, then **Yes, Clean Slate**. Open the module bar and drag **Progressions → V7 – I** onto the BaseNote circle. Press **Play** and listen for the lowest voice stepping down. Each chord takes its pitch from a sounding root. In the first chord, the fifth sits below the root and the harmonic seventh sits at the top. Read the voices from low to high, with both columns measured against the tonic.

| Voice | V7 | I | Motion |
|---|---|---|---|
| Bass | 9/16 | 1/2 | Down a whole tone |
| Next voice | 3/4 | 3/4 | Common tone |
| Next voice | 15/16 | 1 | Up to the tonic |
| Top voice | 21/16 | 5/4 | Down to the third |

To trace the bass, inspect the first chord’s fifth. Its frequency is `(3/4) * [1].f`, a perfect fifth voiced one octave down. The sounding dominant root is at `3/4` of the tonic, so the bass begins at `3/4 × 3/4 = 9/16`. It resolves to `1/2` when the tonic chord enters.

Undo the drop before trying another progression. Try **ii – V – I** for the same resolution with a preparation. Compare **I – IV – V – I**, **I – vi – IV – V**, and the four cadences **Authentic**, **Plagal**, **Deceptive**, and **Half**. Each of the eight files places individual chord tones by octave. Listen for common tones first, then follow the bass across the chord change.

To return to your earlier composition, choose **+ → Load Module → Load Module from file…** and select the file you saved. On the prepared local Wi-Fi development app, you can also open `/listen/` on the same host for the listening room. That development resource is available separately from the shipped composer.
