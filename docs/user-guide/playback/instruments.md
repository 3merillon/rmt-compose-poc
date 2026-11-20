---
title: Instruments
description: The eleven built-in instruments in RMT Compose — nine synth voices, two CC0 multisampled ones — and how a note gets one from the player (the line of notes) it belongs to.
---

# Instruments

Every note plays through a named **instrument**. There are eleven: nine synthesized live from Web Audio oscillators, and two built from recorded samples.

Most notes do not carry an instrument of their own. A note takes the instrument of its **player**: the line of notes, each starting where the previous one ends, that it belongs to. Setting an instrument on a note starts a new player with that instrument. If nothing along the way sets one, the BaseNote's applies, and failing that a global default.

## The eleven instruments

The app shows these names exactly as written.

| Name | Kind | Character |
|---|---|---|
| `sine-wave` | synth | A single sine. Pure, no harmonics. The default. |
| `square-wave` | synth | Square, thickened by a 3-oscillator unison and tamed by a lowpass that tracks the pitch |
| `sawtooth-wave` | synth | Sawtooth, same unison and lowpass treatment, slightly darker filter |
| `triangle-wave` | synth | A single triangle. Soft, flute-like. |
| `organ` | synth | A 10-harmonic wave held at full level, with a short release |
| `vibraphone` | synth | A 16-harmonic wave struck at once and left to die away, longer for low notes than for high ones; the note's end damps it. Bell-like. |
| `fm-epiano` | synth | A 2-operator FM electric piano — bright, percussive attack settling into a mellow Rhodes-like tine |
| `harmonium` | synth | A steady reed-organ voice with every harmonic from the 1st to the 16th. Made for hearing pure intervals. |
| `harmonium-soft` | synth | The same voice, darker, quieter and slower to speak. A bed under a tune. |
| `piano` | sampled | Upright piano, 14 recorded zones |
| `violin` | sampled | Sustained bowed violin, 15 recorded zones |

## Picking an instrument

### On one note

Click a note to open the note widget. The `instrument` row is the last of the variable rows, below `color` and above the Add Note / Silence section.

![The note widget for a selected note, showing its variables and the instrument row](/img/note-widget.png)

Above the dropdown, one line tells you where the note's instrument comes from:

- **`Inherited: piano · plays with [9]`** — the note has no instrument of its own and takes the one of its player; `[9]` is the first note of that line. The `· plays with` part is left out when the note is itself the first note of its line.
- **`Current: piano`** — the note pins that instrument itself.

Choose a name from the dropdown and a **`Save`** button appears. Click it to pin the instrument on that note. If the note already pins one, a **`Use Inherited`** button sits above the dropdown; click it to remove the pin and go back to inheriting.

Both actions pause playback and can be undone.

Measure bars have no instrument — they carry only a start time, so the row is absent.

### For everything else

**Settings → Audio → Default instrument** (the gear in the [top bar](/user-guide/interface/top-bar)) sets what a note plays when neither it, nor its player, nor the BaseNote sets an instrument. It defaults to `sine-wave` and is remembered across reloads.

The change applies to the **next** playback, not the one in progress — an instrument is resolved once per note when playback is prepared. Press Stop, then Play.

### In module JSON

`instrument` is a plain string property, not an expression. It is written out only when a note explicitly pins one.

```json
{
  "baseNote": { "frequency": "263", "startTime": "0", "duration": "3/5" },
  "notes": [
    { "id": 1, "startTime": "base.t", "duration": "base.d", "frequency": "base.f", "instrument": "piano" },
    { "id": 2, "startTime": "[1].t + [1].d", "duration": "base.d", "frequency": "[1].f * (3/2)" }
  ]
}
```

Note 2 has no `instrument` of its own, and its start is written from the end of note 1 (`[1].t + [1].d`) — so note 2 is in note 1's player and plays as `piano` too. Its frequency plays no part.

## Players

A **player** is a line: notes joined by the relation "starts where the previous one ends". A note's instrument is decided as follows:

1. If the note sets an `instrument`, use it. The note starts a new player, and the line goes on from it with that instrument.
2. Otherwise, if its start is written from the end of a note or a silence *p* (`[p].t + [p].d`, or that plus a rest such as `[p].t + [p].d + base.d * (1/2)`), use *p*'s instrument: the note is in *p*'s player. A silence carries the line, so a player can have a silence in his score.
3. Otherwise, if the note is a copy of a note *k* of a line (start `[k].t + X`, frequency `r * [k].f`) and the copy of *k*'s predecessor exists (written from it with the same `X`), use that copy's instrument: a copy of a line is a line, a canon voice.
4. Otherwise the note starts a line. It takes the instrument of the note its **start time** is written from (`[k].t …`; a measure bar does not count), else the BaseNote's, else **Settings → Audio → Default instrument**.

The source is `src/players.js`, whose header states the same rule.

In the shipped canon (the default module) this gives exactly three players: the theme (25 notes from note 9), the first bass (70 notes from note 10) and the second bass (58 notes from note 24, a note-by-note copy of the first). Setting note 9's instrument changes the whole theme; note 24's changes the second bass; note 10's changes the first bass, and also the second one while note 24 sets none, because note 24's start is written from note 10.

Three consequences worth knowing:

**The frequency no longer decides the instrument.** A bass note tuned from the melody (`[9].f * (1/2)`) is still the bass: its player is the line it starts where the previous bass note ends. Retargeting a note's frequency does not change its instrument; retargeting its start time may.

**A note that starts a line takes the instrument of the note its start is written from.** If that is a note of another line, the new line begins with that note's instrument, but it is a player of its own: setting an instrument on it changes only its line.

**The BaseNote normally sets nothing**, so a line whose first note is written from the BaseNote lands on the default-instrument setting. That is what makes the setting reach anything at all.

::: warning A BaseNote that does set an instrument overrides the setting
Five of the shipped modules pin `"instrument": "sine-wave"` on their BaseNote — the five scale systems (`BP-13`, `Mixed-Base`, `TET-12`, `TET-19`, `TET-31`). Load one of those and changing "Default instrument" appears to do nothing, because every line ends at `sine-wave` from the BaseNote. Change the BaseNote's instrument in the note widget instead. `defaultModule` does not pin one, so the setting works there.
:::

The BaseNote's widget row agrees with playback: with no instrument of its own it reads `Inherited: <name>`, where the name is your "Default instrument" setting.

### Several notes at once

The [group widget](/user-guide/notes/selection) has an INSTRUMENT section with the list of instruments and two buttons:

- **Each note its own player** sets the instrument on every selected note: each becomes the first note of a player.
- **One player** sets it on the notes that start the selection's lines (a selected note whose line predecessor is not selected) and removes it from the other selected notes, which then take it along their lines. The notice adds the number of players.

Choosing *inherited* in the list makes every selected note inherit again with either button.

### Modules saved before this rule

A module file without `"instrumentRule": "start-time"` is older than the rule. On load, every sounding note whose instrument the rule would change gets its old instrument written onto it (it then starts its own player), so the module keeps its sound, and a console line says how many notes were pinned. Saving writes `instrumentRule: "start-time"`, so the module is not migrated again. No note of any shipped library module changes instrument.

### Deleting a note keeps its instrument alive

When you delete a note with **Keep Dependencies** (the note widget's DELETE NOTE section), the instrument each direct dependent is playing is resolved and **written onto** it, for every direct dependent that didn't already set one (a dependent that sets its own keeps it). Those notes stop inheriting from that point on — including from the default-instrument setting — and each starts a player of its own. **Delete all** on a multi-selection does the same thing to every dependent that survives outside the group.

See [Dependencies](/user-guide/notes/dependencies) for what else that operation rewrites.

## Attack and release

Every instrument has an envelope: how a note swells in at its start and dies away after its end. The end of a note is a **note-off**, like lifting a key: the sound does not stop there, it rings briefly after it. Each instrument carries its own envelope, written in seconds, so a short note keeps the shape of a long one. A note can override two of its parts with the interpretation variables **`attack`** (alias `atk`) and **`release`** (alias `rel`).

- Both are **shares of the note's own duration**, such as `1/8`. The attack runs from the note's start (clamped to 0–1); the release runs from the note's end and rings after it (clamped to 0–4).
- A note's own value replaces the instrument's time for that part. When neither the note nor the BaseNote sets one, the instrument's own envelope applies. Each is replaced on its own: setting only `attack` leaves the instrument's release.
- The BaseNote's `attack` and `release` apply to every note that sets none of its own, like `amplitude`.
- Set them in the `ATTACK` and `RELEASE` rows of the [note widget](/user-guide/interface/variable-widget#attack-and-release), which read `Default: instrument envelope`, `Inherited: <value>` or `Evaluated: <value>`.

The anti-click floors stay: an attack is never shorter than 3 ms and a release never shorter than 15 ms, so a very short note cannot click. The attack has to fit inside the note: a note shorter than its attack is attacked over its whole length, and an `attack` of `1` is a swell to the very end. The release comes after the note, so nothing has to fit around it.

Each instrument's times, in seconds:

| Instrument | Attack | After the note's start | Release after the note's end |
|---|---|---|---|
| `sine-wave` | 0.015 | held at full level | 0.1 |
| `triangle-wave` | 0.015 | held at full level | 0.12 |
| `square-wave`, `sawtooth-wave` | 0.008 | falls over 0.25 s to 70% of the peak, then held | 0.1 |
| `organ` | 0.03 | held at full level | 0.06 |
| `vibraphone` | 0.002 | dies away on its own: a 60 dB fall takes 6 s at 65 Hz and 2 s at 2000 Hz | 0.4 |
| `fm-epiano` | 0.002 | dies away on its own: 5 s at 65 Hz, 1.5 s at 2000 Hz | 0.25 |
| `harmonium` | 0.03 | held at full level | 0.08 |
| `harmonium-soft` | 0.06 | held at full level | 0.12 |
| `piano` | 0.002 | held (the recording carries its own decay) | 0.30 at C1 down to 0.10 at C6, so the bass is damped more slowly; 1.5 above F#6, where a piano has no dampers |
| `violin` | 0.005 | held (the recording carries its own bowing, and stops after 3.5 s) | 0.12 |

The harmonium voices are overridden the same way. See [attack and release](/reference/properties/attack-release) for the exact rules.

## The synth voices

`sine-wave` and `triangle-wave` are one oscillator each — a pure sine, and a triangle with a gentler harmonic series.

`square-wave` and `sawtooth-wave` are **not** bare waveforms. Each is three oscillators detuned by up to ±4 cents (a slight chorusing thickness) behind a lowpass filter whose cutoff tracks the note: 12× the note's frequency for square, 10× for sawtooth. The raw square/sawtooth harmonic series is still underneath, but the top of it is rolled off, which is why they sound rounder than a textbook oscillator.

`organ` and `vibraphone` are custom harmonic waves — 10 and 16 partials respectively. The organ holds its level until the note's end and then lets go quickly; the vibraphone is struck at once and decays on its own, so a long note is not held level, and the end of the note damps it.

`fm-epiano` is 2-operator FM: a sine carrier frequency-modulated by another sine at the same pitch. The modulation index starts high and falls over the first quarter-second, which is the bright ping-then-mellow of an electric piano tine.

### The harmonium voices

`harmonium` and `harmonium-soft` are built for one thing: making the difference between a pure interval and a mistuned one as plain as it can be. The model is the reed organ, the instrument nineteenth-century acousticians such as Helmholtz and Bosanquet made their tuning experiments on, because its steady, overtone-rich tone makes mistuning plain.

Two notes a ratio `p/q` apart share an overtone: the `p`-th harmonic of the lower note is the `q`-th of the upper. When the interval is pure the two are one steady tone. When it is not, they beat. That beat is the loudest cue to tuning there is. It is not the only one — on `sine-wave`, which has no overtones to share, pure and tempered still differ audibly, in the pitches themselves and in the difference tones the ear adds — but it needs the harmonics to be there and to hold still. So these two are made differently from the other synths:

| | `harmonium` / `harmonium-soft` | The other synth voices |
|---|---|---|
| Harmonics | **Every one from the 1st to the 16th** | `sine-wave` has one; `organ` has no 2nd and no 7th; `triangle-wave` and `square-wave` have only the odd ones |
| Steadiness | One oscillator. No unison, no detune, no vibrato | `square-wave` and `sawtooth-wave` detune three oscillators by ±4 cents, which makes even a single note waver |
| Attack and release | **Fixed times**: 30 ms and 80 ms (`harmonium`), 60 ms and 120 ms (`harmonium-soft`), unless a note sets its own [attack and release](#attack-and-release) | Times in seconds too, each its own (see the table above); the release rings after the note's end |
| Between them | Full level, held | Some hold full level; `square-wave` and `sawtooth-wave` fall to a lower level, `vibraphone` and `fm-epiano` decay on their own |

So a `7/4` has the 7th harmonic to meet on, an `11/8` the 11th, a `13/8` the 13th.

`harmonium` is the full voice, for a tune or for chords that should show their tuning: its harmonics fall away like a sawtooth's (6 dB per octave) up to the 8th and twice as fast above it. `harmonium-soft` is the same reed behind a darker filter — it falls away faster from the 3rd harmonic on — and is about 3 dB quieter and slower to speak: it is made to sit under a tune rather than beside it. One `harmonium` note is about as loud as one `organ` note.

To hear what they are for, put a chord on [loop](/user-guide/playback/transport#loop-playback) and turn on **Settings → Audio → Play tempered**: the notes that start after the switch are tempered, and their shared overtones beat. See [Pure / Tempered](/user-guide/playback/audio#pure-tempered).

## The sampled instruments

`piano` and `violin` are **multisampled**: several recordings across the range, each covering a band of frequencies, so a played note is pitch-shifted by at most a few semitones from a nearby recording rather than stretched across the whole keyboard from one.

| | Zones | Recorded roots |
|---|---|---|
| `piano` | 14 | C1, G1, C2, G2, C3, G3, C4, G4, C5, G5, C6, G6, C7, G7 |
| `violin` | 15 | G3, A3, C4, E4, G4, A4, C5, E5, G5, A5, C6, E6, G6, A6, C7 |

Both are mono. If you want them placed across the stereo field, that comes from the app's [stereo width](/user-guide/playback/audio) stage, not from the samples.

### Where they come from

The samples are cut from **[VSCO-2 Community Edition](https://github.com/sgossner/VSCO-2-CE)**, released under **CC0 1.0** (public domain dedication) by **Versilian Studios** — recorded by Sam Gossner and Simon Dalzell, sample cutting by Elan Hickler / Soundemote. The piano is "Upright Nr1"; the violin is "Solo Violin — Arco Vib". They were downmixed to mono and encoded as AAC so every browser can decode them.

CC0 requires no attribution. The credit is here because it should be.

### They load when you first play them

Only a small manifest is fetched when the app starts. The audio itself is fetched and decoded when playback is prepared, and only the zones the upcoming notes actually need. So the first press of Play after switching to `piano` or `violin` does the loading; after that, playback starts instantly for the rest of the session.

If a zone hasn't finished decoding, or the fetch failed, that note falls back to a **plain sine tone** for that playback. It still sounds; it is not sampled. If a piano suddenly sounds like a test tone, that's what happened — play it again.

::: warning Long held notes go silent
Sampled notes do not loop. Every source sample is capped at **3.5 seconds**. A `piano` or `violin` note held longer than that plays its sample out and is then **silent for the rest of its duration**. It bites hardest on long sustained violin notes — use a synth voice for drones.
:::

## Mixing instruments

Different notes can use different instruments, which is how you get ensemble textures out of one module. Pin an instrument on the head of each voice's dependency chain and the rest of that voice follows it for free.

Every instrument gets its own mix bus internally, but there are **no per-instrument volume, mute or solo controls** — the only levels you can change are the master volume and the reverb amount. See [Audio & Reverb](/user-guide/playback/audio).

## Tips

1. **Start with `sine-wave`.** It is the clearest voice for hearing whether an interval is in tune.
2. **Switch to `harmonium` to make the difference louder.** Its harmonics coincide when an interval is pure and beat when it is not: what you hear on a sine, with the most salient cue added.
3. **Pin the instrument high in the chain.** One pin on the note everything hangs off is worth twenty pins on leaves.
4. **Use synths for long notes.** The sample cap makes drones a poor fit for `piano` and `violin`; `harmonium` holds its level for as long as the note lasts.
5. **An unknown instrument name is silently ignored.** A module saved with `"instrument": "cello"` loads fine and plays as `sine-wave`.

## See also

- [Audio & Reverb](/user-guide/playback/audio) — the reverb, stereo placement and limiter every instrument runs through
- [Module Format](/user-guide/modules/module-format#instruments) — the `instrument` key in module JSON
- [Dependencies](/user-guide/notes/dependencies) — the relations that make up a line
