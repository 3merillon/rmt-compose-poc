---
title: MIDI Export
description: Reference for src/midi/midi-export.js — a pure function from a Module to the bytes of a Standard MIDI File, its options, its report, and the byte layout it writes.
---

# MIDI Export

`src/midi/midi-export.js` turns a `Module` into a Standard MIDI File that keeps the module's tuning.
It is **pure** — module in, bytes out, no DOM and no Web Audio — so the same code runs behind the
**Export MIDI** menu entry and in Node.

```javascript
import { readFileSync, writeFileSync } from 'node:fs'
import { Module } from './src/module.js'
import { planMidi, encodeMidi } from './src/midi/midi-export.js'

const module = await Module.loadFromJSON(JSON.parse(readFileSync('module.json', 'utf8')))

const plan = planMidi(module)              // what the file will contain, as plain data
writeFileSync('module.mid', encodeMidi(plan))

for (const warning of plan.report.warnings) console.warn(warning)
```

What a user sees of this is in [Exporting MIDI](/user-guide/modules/exporting-midi).

## The approach

MIDI has 128 fixed keys and one pitch bend per channel. To carry an exact frequency, each note is
written on its nearest 12-TET key with a 14-bit pitch bend for the remainder, and each sounding
note gets a channel to itself.

Which channels is the `layout` option. The default, `'general'`, is for ordinary General MIDI
players: such a player merges all tracks onto one port, so the whole piece shares that port's
fifteen usable channels (never channel 10, which is percussion), and every note is preceded by its
instrument's program change and its bend. `'mpe'` writes one **MPE lower zone** per instrument
track instead — channel 1 as the master, channels 2–16 as members, no program — for a DAW with one
MPE instrument per track. In an ordinary player that layout plays wrong: the tracks collide on the
same channels, some notes land on channel 10 and sound as drums, and everything else is piano.

Two decisions keep the file exact where it can be:

- **Time is converted exactly, then rounded once.** `seconds × tempo ÷ 60 × ppq` is computed in
  BigInt fractions; a start and an end are each rounded to the nearest tick (ties upward) and a
  length is the difference of the two. Rounding the length separately would let two notes that
  touch in the module overlap or gap in the file.
- **The grid follows the exact tempo.** MIDI stores a tempo as whole microseconds per quarter
  note, so `66` BPM is written as 909091 µs. Ticks are computed from the exact tempo, not from
  the stored one; only the tempo event is rounded.

### Tempo and time signature

A module stores no tempo, so the file's tempo is derived: the BaseNote's duration is the time unit
and the export writes it as **one quarter note**, which makes the tempo `60 / base.d` BPM (`base.d`
of `1/2` writes 120 BPM). A BaseNote duration that is not positive writes 60 BPM.

The time signature comes from the **first measure bar**, the one with the earliest start (a note
for which `isMeasureNote()` is true). Its duration in time units is the numerator over a quarter-
note denominator: a bar of `base.d * 4` writes 4/4, a bar of `base.d * 7/2` writes 7/8. Later bars
do not add meter changes; the file has one time signature. **No time signature is written** when
the module has no measure bar, or when the first bar's length cannot be written as one (a length
such as 5/3 time units, or more than 255). Only the second case adds a warning.

`toNumber()` (`src/utils/fraction-num.js`) is the only place a fraction becomes a float, as
everywhere else: for the frequency (its key and bend need a logarithm), for the gain, and for the
numbers in the report.

## API

### moduleToMidi()

```javascript
const bytes = moduleToMidi(module, options)
```

`encodeMidi(planMidi(module, options))`. Use it when the report is not needed.

Returns: `Uint8Array`.

### planMidi()

```javascript
const plan = planMidi(module, options)
```

Evaluates the module (`module.evaluateModule()`) and works out everything the file will contain,
without encoding it.

| Parameter | Type | Description |
|---|---|---|
| `module` | `Module` | The module to export |
| `options` | object | Optional — see [Options](#options) |

Returns an object:

| Field | Description |
|---|---|
| `ppq` | Ticks per quarter note |
| `bendRange` | Pitch-bend range of the member channels, in semitones |
| `usPerQuarter` | The tempo as stored: microseconds per quarter note (derived from `60 / base.d`) |
| `timeSignature` | `{ numerator, denominator }` from the first measure bar, or `null` when there is no bar or its length has no such form |
| `title` | Name of the conductor track |
| `endTick` | Where the file ends: the last note end or the end of the last measure bar (its start plus its duration) |
| `tracks` | One entry per note track: `{ name, instrument, zone, memberChannels, notes }` |
| `report` | See [The report](#the-report) |

Each entry of `tracks[i].notes` is `{ id, startTick, endTick, key, bend, cents, velocity,
frequency, channel }`. `channel` is the zero-based MIDI channel, 1–15 — member channels 2–16.

Throws `RangeError` for an option outside its range.

### encodeMidi()

```javascript
const bytes = encodeMidi(plan)
```

Encodes a plan as a Standard MIDI File, format 1. Returns `Uint8Array`. The same plan always gives
the same bytes.

### Options

`MIDI_EXPORT_DEFAULTS` holds the defaults. The menu entry uses all of them.

| Option | Default | Range | Meaning |
|---|---|---|---|
| `ppq` | `960` | 1–32767 | Ticks per quarter note |
| `bendRange` | `2` | 1–96 | Pitch-bend range of the member channels, in semitones, declared with RPN 0 |
| `unityVelocity` | `64` | 1–127 | The velocity amplitude 1 is written as |
| `a4` | `440` | > 0 | Frequency of key 69, the reference of the key grid |
| `title` | `'RMT Compose'` | — | Name of the conductor track |
| `layout` | `'general'` | `'general'`, `'mpe'` | How notes are given channels — see [The approach](#the-approach) |

`bendRange` trades resolution for compatibility. A bend has 16 384 steps across twice the range:

| `bendRange` | One step | Worst pitch error |
|---|---|---|
| `2` | 0.0244 cent | 0.0122 cent |
| `12` | 0.146 cent | 0.073 cent |
| `48` | 0.586 cent | 0.293 cent |

`48` is what an MPE instrument is set to before it is told otherwise. Exporting with it suits an
instrument whose range cannot be changed, at 24 times the pitch error.

## What is written

### Pitch

```
semitones = 69 + 12 × log2(frequency / a4)
key       = round(semitones), kept within 0–127
bend      = 8192 + round((semitones − key) × 8192 / bendRange), kept within 0–16383
```

Keys stop at 0 and 127, but a note just past either end is still reachable by bending further. A
note more than `bendRange` semitones beyond the last key is not exported.

### Loudness

```
velocity = round(unityVelocity × √gain), kept within 1–127
```

`gain` is `amplitudeToGain(module.findAmplitude(note))` — the same clamp to 0–4 the audio engine
applies (`src/player/amplitude.js`). A gain of 0 is not exported: playback builds no voice for it
either. Note-off velocity is always 64.

### Channels

**`'general'`.** All notes, sorted by start, draw on one pool: channels 1–9 and 11–16. A note takes
a free channel that last played its own instrument (`module.findInstrument(note)`, lower-cased) —
so a release tail is not re-voiced — and otherwise the one silent longest. A channel counts as free
on the very tick its note ends only for the same instrument: that note-off and the new note-on are
then in one track and keep their order. Past fifteen notes at once the surplus fills a second
pool, written as tracks `<instrument> (port 2)` with a MIDI-port meta event (`FF 21`).
`GM_PROGRAMS` maps instruments to programs; an unknown one is written as piano and reported.

**`'mpe'`.** Notes are grouped by instrument, sorted by start, and
each takes the member channel that fell silent longest ago; ties go to the lowest channel. That
rotation leaves a release tail the most time before the channel's bend moves for the next note.

A channel is free for a note that starts on the tick the previous one ended. When all fifteen are
sounding, the note opens — or joins — a further zone, written as a further track named
`<instrument> (2)`, `<instrument> (3)`, … The report counts them.

### What is skipped

| Note | Outcome | Report field |
|---|---|---|
| A measure bar (no duration) | Not written; its measure extends `endTick` | — |
| A silence (no frequency) | Not written | `notes.silences` |
| Amplitude 0 | Not written | `notes.skipped.silent` |
| Pitch beyond the reach of keys 0–127 | Not written | `notes.skipped.outOfRange` |
| No usable frequency | Not written | `notes.skipped.noPitch` |
| No usable length | Not written | `notes.skipped.noLength` |
| Over before time zero | Not written | `notes.skipped.beforeStart` |
| Starts before zero, ends after | Written from tick 0 | `notes.clippedAtStart` |
| Shorter than one tick | Written one tick long | `notes.lengthened` |

Irrational (corrupted) values are exported by their evaluated value, like playback.

## The file, byte by byte

```
MThd  format 1, ntrks, division = ppq

MTrk  conductor
      FF 03  title
      FF 01  "RMT Compose export: one MPE lower zone per track, member pitch-bend range +/-2 semitones"
      FF 58  time signature              (omitted when there is none)
      FF 51  tempo, µs per quarter note
      FF 2F  end of track, at endTick

The note tracks below are the `'mpe'` layout. In `'general'` a note track holds its name, `FF 21 pp`
when it is for a further port, RPN 0 on all fifteen channels, and per note `Cn pp` (program),
`En lsb msb`, `9n key vel`, then `8n key 40`.

```
MTrk  one per instrument zone
      FF 03  track name
      B0 65 00  B0 64 06  B0 06 0F       MPE Configuration Message: RPN 6 = 15 member channels
      B0 65 7F  B0 64 7F                 RPN null
      for each member channel n = 1..15:
        Bn 65 00  Bn 64 00  Bn 06 rr  Bn 26 00     RPN 0, pitch-bend sensitivity = rr semitones
        Bn 65 7F  Bn 64 7F                         RPN null
      then, per note:
        En lsb msb      pitch bend
        9n key vel      note on
        8n key 40       note off, at the note's end
      FF 2F  end of track, at the last note end
```

Events that share a tick are ordered note-offs, then bends, then note-ons, so a channel reused on
the tick it fell free reads off → bend → on. Running status is not used. A gap too long for one
delta time (more than `0x0FFFFFFF` ticks) is bridged with empty text events.

The pitch-bend sensitivity is written on every member channel, although MPE applies one member
channel's setting to the whole zone, so that a plain multi-channel receiver ends up with the same
range.

## The report

`plan.report` describes what was done. The menu entry turns it into the toast and the console
lines; a script can read it directly.

| Field | Contents |
|---|---|
| `ppq`, `bendRange`, `bendStepCents`, `unityVelocity`, `a4` | The options in effect, and the size of one bend step |
| `tempo` | `exactBpm` (a fraction string), `usPerQuarter`, `storedBpm`, `relativeError`, `driftAtEndSeconds` |
| `timeSignature` | As in the plan |
| `tickSeconds`, `endTick`, `durationSeconds` | The grid and the length of the file |
| `notes` | `exported`, `silences`, `skipped` (ids by cause), `skippedTotal`, `clippedAtStart`, `lengthened`, `amplitudeClamped`, `velocityFloored` |
| `polyphony` | `channelsPerTrack` (15), `max`, `overflowNotes`, `overflowTracks` |
| `instruments` | Per instrument: `notes`, `maxPolyphony`, `tracks` |
| `tracks` | Per track: `index`, `name`, `notes` |
| `accuracy` | `maxPitchErrorCents`, `maxStartErrorTicks`, `maxLengthErrorTicks` |
| `warnings` | Sentences for a person: one per instrument that overflowed, one per cause of skipped notes, and one each for a clamped amplitude, a floored velocity, a lengthened note, a first measure bar that cannot be written as a time signature and an unstorable tempo |

`driftAtEndSeconds` is how far a player using the stored (rounded) tempo is from the module's own
clock at the end of the file.

## The check

`scripts/test-midi-export.mjs` runs as part of `npm test`. It exports modules, reads the bytes
back with a Standard MIDI File parser that shares no code with the exporter, and compares every
note in the file with the module's evaluated values:

- **Pitch** — key plus bend, using the bend range the *file* declares, within 0.1 cent.
- **Time** — start and length within one tick.
- **Loudness** — the velocity the amplitude calls for.
- **Channels** — no two notes sound on one channel at once, no bend moves under a sounding note.
  In the default layout this holds across all tracks, nothing is on channel 10, and every note
  carries its instrument's program; in `'mpe'` every note sits on a member channel of a declared zone.
- **Coverage** — every sounding note is in the file, and nothing else is.

It covers the default module, every library module, and synthetic modules for what real ones do
not reach: more notes at once than a zone holds, channel rotation, the velocity curve, irrational
pitches, pitches out of range, and the export options.

To check a module of your own:

```bash
node scripts/test-midi-export.mjs path/to/module.json
```

::: info What the check cannot see
It proves the bytes say what the module says. It does not open a DAW: whether a given host applies
the zone and the bend range it finds in a file is outside it.
:::

## See also

- [Exporting MIDI](/user-guide/modules/exporting-midi) — the user's view
- [Module Class](/developer/api/module) — `evaluateModule()`, `findAmplitude()`, `findInstrument()`
- [Audio Engine](/developer/audio/audio-engine) — the other consumer of `amplitudeToGain()`
