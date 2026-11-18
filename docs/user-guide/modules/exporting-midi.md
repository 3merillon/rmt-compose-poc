---
title: Exporting MIDI
description: Export the workspace as a Standard MIDI File that keeps its exact tuning — what the file contains, what an instrument needs to play it in tune, and what is rounded.
---

# Exporting MIDI

**Export MIDI** writes the composition as a Standard MIDI File, `module.mid`, for a DAW or a synthesizer.

MIDI has 128 fixed keys; a module has exact frequencies. So the file carries the tuning itself: every note is written on its **nearest key together with a pitch bend** that puts it back on its exact frequency.

::: warning It is a one-way export
A MIDI file holds evaluated values — pitches, times, loudness. It does not hold the relationships between notes, and there is no MIDI import. Keep the `module.json` from [Save Module](/user-guide/modules/saving-modules); that file is the composition.
:::

## Export the composition

1. Open the **+** menu (the plus/minus button at the right of the top bar).
2. Click **Export MIDI**.
3. A file called **`module.mid`** downloads. Toast: `Exported 153 notes to module.mid`.

The filename is fixed, like `module.json`. Rename it as soon as it lands.

## What is in the file

| | |
|---|---|
| Format | Standard MIDI File, type 1, 960 ticks per quarter note |
| First track | The tempo and the time signature, both from the BaseNote |
| One track per instrument | Named after the instrument — `organ`, `fm-epiano`, `sine-wave` |
| Pitch | The nearest 12-TET key (A4 = 440 Hz) plus a 14-bit pitch bend |
| Channels | Every sounding note has a channel to itself |
| Loudness | Velocity, from the note's [amplitude](/reference/properties/amplitude) |

### Why every note has its own channel

A pitch bend moves a whole channel, not one note. Two notes of a pure chord need two different bends, so they cannot share a channel.

Each track is therefore laid out as an **MPE lower zone** (MIDI Polyphonic Expression): channel 1 is the zone's master and carries no notes; channels 2–16 are its fifteen member channels, one note at a time on each. A new note takes the channel that has been silent longest, which leaves the previous note's release the most time before that channel's bend moves.

## Playing it in tune

Three things have to be true of the instrument each track plays into:

1. **MPE is on.** Without it an instrument treats channels 2–16 as fifteen unrelated parts, or listens to one channel only.
2. **Its per-note pitch-bend range is 2 semitones.** MPE instruments start at 48. An instrument left there plays every bend 24 times too wide — if an imported file sounds wildly out of tune, this is the setting to check first.
3. **Each track has an instrument of its own.** Every track uses channels 1–16 for itself.

::: info The file declares all of this
Each track opens with an MPE Configuration Message (RPN 6 on channel 1: fifteen member channels) and sets the pitch-bend sensitivity (RPN 0) to 2 semitones on every member channel. A receiver that follows the MPE specification needs no manual setup. Not every DAW passes these messages from a file on to its instruments, which is why the list above is worth knowing.
:::

The tracks carry instrument **names**, not sounds. Nothing in the file selects a patch; you choose the instrument for each track.

## What is rounded

A module is exact; a MIDI file is a grid. This is all the rounding there is.

| | Rounded to | At worst |
|---|---|---|
| Start and end of a note | The nearest tick (960 per quarter note) | Half a tick — 0.3 ms at 100 BPM |
| Length | The difference of the two rounded ends | One tick |
| Pitch | One of 16 384 bend steps across ±2 semitones | 0.0122 cent |
| Tempo | Whole microseconds per quarter note | 66 BPM is stored as 65.999993 |
| Loudness | A velocity from 1 to 127 | See below |

Two details follow from how the times are rounded:

- **Notes that touch in the module touch in the file.** A length is never rounded on its own, so a note that ends where the next begins still does.
- **Beats land on the DAW's grid.** Tick positions are computed from the exact tempo; only the tempo number written into the file is rounded.

`npm test` exports the default module and every library module, reads the bytes back with an independent parser, and requires every note within 0.1 cent and one tick of its evaluated value. What a particular DAW does with the file on import is outside that check.

### Amplitude becomes velocity

`velocity = 64 × √amplitude`, rounded, kept within 1–127.

| Amplitude | Velocity |
|---|---|
| `(1/4)` | 32 |
| `(1/2)` | 45 |
| `1` — also every note that sets none | 64 |
| `(121/100)` | 70 |
| `2` | 91 |
| `4` | 127 |

The square root is the inverse of a square-law velocity response (gain proportional to velocity squared), the curve the Downloadable Sounds (DLS) standard specifies. An instrument with that curve gives back the gain the module asked for; one with a different curve keeps the order of loud and soft but not the exact ratios. Amplitude 1 sits on 64, the value MIDI itself uses for "no velocity information", and the engine's maximum, 4, sits on the top of the scale.

An amplitude above 4 is written as 4, as in playback.

## What the export reports

A plain export answers with a cyan toast. When the file could not carry something as written, the toast is orange, stays for six seconds and points to the browser console, which lists each case with the note ids. Notes that moved to extra tracks or were left out are counted in the toast itself: `Exported 41 notes to module.mid (25 on extra tracks, 2 not exported) — see the console`.

| Situation | What the export does |
|---|---|
| More than 15 notes of one instrument sound at once | The surplus goes to further tracks for the same instrument — `piano (2)`, `piano (3)` — each to be given its own instrument. |
| A pitch no key can reach | Below about 7.3 Hz or above 14 080 Hz: the note is not exported. |
| Amplitude 0 | The note is not exported. It is silent in playback too. |
| A note shorter than one tick | It is given a length of one tick. |
| A note that starts before time zero | It starts at zero, as in playback. One that also ends before zero is not exported. |
| A `beatsPerMeasure` with no time signature | `4` is written as 4/4 and `(7/2)` as 7/8; `(5/3)` has no such form, and no time signature is stored. |
| A tempo below 3.58 BPM | MIDI cannot store it. The nearest storable tempo is used for the whole file. |

If nothing could be written, no file is downloaded and a red toast says so.

**Irrational values** — the ones shown with `≈` — are exported by their evaluated value, exactly as they are played.

## What is not in the file

- **The sound.** Instrument names only; no patches, no samples.
- **Reverb, stereo spread and the limiter.** Those are playback settings, not part of the module.
- **Colours.**
- **Silences.** A silence is a rest; nothing is written for it.
- **Measure bars as events.** They make no sound. The last measure does set where the file ends, so a piece that closes on an empty bar keeps it.
- **The expressions.** `[1].f * (3/2)` leaves as a key and a bend.

## Tips

1. **Save the module as well.** The MIDI file cannot be turned back into a composition.
2. **Set the bend range before judging the result.** One wrong setting makes every pure interval sound wrong.
3. **Keep each instrument to fifteen notes at once** if you want one track per instrument.
4. **Rename the download.** Every export is `module.mid`.

## See also

- [Saving Modules](/user-guide/modules/saving-modules) — the file that keeps the relationships
- [amplitude](/reference/properties/amplitude) — where the velocity comes from
- [Instruments](/user-guide/playback/instruments) — the names the tracks carry
- [MIDI Export](/developer/api/midi-export) — the function behind the menu entry, for scripts
