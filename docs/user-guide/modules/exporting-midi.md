---
title: Exporting MIDI
description: Export the workspace as a Standard MIDI File with per-note pitch bends — what the file contains, what an instrument needs to play it in tune, and what is rounded.
---

# Exporting MIDI

**Export MIDI** writes the composition as a Standard MIDI File, `module.mid`, for a DAW or a synthesizer.

A tuning between MIDI keys is exported as the **nearest available key plus a 14-bit pitch bend**. The bend approximates the evaluated pitch. Save the module JSON to retain its exact ratios, symbolic powers and editable dependencies.

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
| First track | The tempo, from the BaseNote's duration, and the time signature, from the first measure bar |
| One track per instrument | Named after the instrument — `organ`, `fm-epiano`, `sine-wave` |
| Sound | A General MIDI program for each instrument, set before every note |
| Pitch | The nearest 12-TET key (A4 = 440 Hz) plus a 14-bit pitch bend |
| Channels | Every sounding note has a channel to itself — never channel 10 |
| Loudness | Velocity, from the note's [amplitude](/reference/properties/amplitude) |

### Why every note has its own channel

A pitch bend moves a whole channel, not one note. Two notes of a pure chord need two different bends, so they cannot share a channel.

The whole piece shares the fifteen channels of one MIDI port: 1–9 and 11–16. **Channel 10 is never used** — General MIDI reserves it for percussion, and a note written there plays as a drum. A new note takes a free channel that last played its own instrument, or else the one that has been silent longest, and sets that channel's program and bend before it sounds.

## Playing it

Use a player that honors independent per-channel pitch bends and program changes. Check these two settings if a chord sounds different from the workspace:

- **a pitch-bend range of 2 semitones.** That is the General MIDI default, and the file also sets it on every channel (RPN 0). A device left on another range plays every bend too wide or too narrow — if a file sounds wildly out of tune, this is the setting to check first.
- **program changes.** Each instrument maps to a General MIDI program:

| Instrument | Program |
|---|---|
| `piano` | 1 Acoustic Grand Piano |
| `fm-epiano` | 6 Electric Piano 2 |
| `vibraphone` | 12 Vibraphone |
| `organ` | 20 Church Organ |
| `harmonium` | 21 Reed Organ |
| `harmonium-soft` | 1 Acoustic Grand Piano (fallback) |
| `violin` | 41 Violin |
| `triangle-wave` | 74 Flute |
| `sine-wave` | 21 Reed Organ |
| `square-wave` | 81 Lead 1 (square) |
| `sawtooth-wave` | 82 Lead 2 (sawtooth) |

These are the nearest General MIDI sounds, not the app's own; how they sound depends on the player's sound set. General MIDI has no sine, so `sine-wave` exports as the reed organ: its Ocarina breathes at every note, and a piano adds strings tuned in twelve equal steps.

::: warning In a DAW
A track holds one instrument's notes, but spread over many channels. Give the track an instrument that listens on all channels with a bend of its own per channel — a multitimbral General MIDI synth, or an MPE instrument with its bend range at 2 semitones. An instrument that listens on one channel plays only part of the track.
:::

## Tempo and time signature

A module stores no tempo, so the export reads one off the time unit. The time unit, `base.d`, is taken as the quarter note:

| Written | From |
|---|---|
| Tempo | `60 / base.d` BPM. A BaseNote duration of `3/5` s is 100 BPM. |
| Time signature | The **first measure bar** supplies the meter. An explicit `"6/8"` on a three-unit bar preserves its two dotted-quarter beats. Without a matching spelling, four units give 4/4 and seven half units give 7/8. |

When the module has no measure bar, or the first bar's length cannot be written as a time signature, none is stored. A bar of `5/3` time units is such a length. See [Measure bars](/reference/module-schema#measure-bars).

## What is rounded

The MIDI file stores evaluated events on finite pitch, time and velocity grids. The table assumes the default export settings.

| | Rounded to | At worst |
|---|---|---|
| Start and end of a note | The nearest tick (960 per quarter note) | Half a tick — 0.3 ms at 100 BPM |
| Length | The difference of the two rounded ends | One tick |
| Pitch | One of 16 384 bend steps across ±2 semitones | About 0.0122 cent for a nearest bend, up to one bend step (0.0244 cent) at the positive range limit |
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
| More than 15 notes sound at once | One port has fifteen channels. The surplus goes to tracks marked for a second port — `piano (port 2)` — which a player with a single port will mistune. |
| An instrument with no program in the table | It is written as piano. |
| A pitch no key can reach | Below about 7.3 Hz or above 14 080 Hz: the note is not exported. |
| Amplitude 0 | The note is not exported. It is silent in playback too. |
| A note shorter than one tick | It is given a length of one tick. |
| A note that starts before time zero | It starts at zero, as in playback. One that also ends before zero is not exported. |
| A first measure bar with no representable meter | The exporter tries a matching explicit spelling, then derives a meter from the bar length. Five-thirds of a quarter note has no representable denominator, so the file omits its time signature. |
| A tempo below 3.58 BPM | MIDI cannot store it. The nearest storable tempo is used for the whole file. |

If nothing could be written, no file is downloaded and a red toast says so.

**Irrational and approximate values** are exported by the nearest double of their exact value, exactly as they are played.

## What is not in the file

- **The sound.** A General MIDI program number, not the app's own synthesis or samples.
- **Reverb, stereo spread and the limiter.** Those are playback settings, not part of the module.
- **Colours.**
- **Silences.** A silence is a rest; nothing is written for it.
- **Measure bars as events.** They make no sound. The last bar does set where the file ends (its start plus its duration), so a piece that closes on an empty bar keeps it.
- **The expressions.** `[1].f * (3/2)` leaves as a key and a bend.

## Tips

1. **Save the module as well.** The MIDI file cannot be turned back into a composition.
2. **Check the bend range before judging the result.** One wrong setting makes every pure interval sound wrong.
3. **Keep the piece to fifteen notes at once** if it has to play on a single port.
4. **Rename the download.** Every export is `module.mid`.

## See also

- [Saving Modules](/user-guide/modules/saving-modules) — the file that keeps the relationships
- [amplitude](/reference/properties/amplitude) — where the velocity comes from
- [Instruments](/user-guide/playback/instruments) — the names the tracks carry
- [MIDI Export](/developer/api/midi-export) — the function behind the menu entry, for scripts
