---
title: Instruments
description: The nine built-in instruments in RMT Compose — seven synth voices, two CC0 multisampled ones — and how a note inherits one from its frequency chain.
---

# Instruments

Every note plays through a named **instrument**. There are nine: seven synthesized live from Web Audio oscillators, and two built from recorded samples.

Most notes do not carry an instrument of their own. They **inherit** one by following their frequency dependency chain, and fall back to a global default if nothing in the chain pins one.

## The nine instruments

The app shows these names exactly as written.

| Name | Kind | Character |
|---|---|---|
| `sine-wave` | synth | A single sine. Pure, no harmonics. The default. |
| `square-wave` | synth | Square, thickened by a 3-oscillator unison and tamed by a lowpass that tracks the pitch |
| `sawtooth-wave` | synth | Sawtooth, same unison and lowpass treatment, slightly darker filter |
| `triangle-wave` | synth | A single triangle. Soft, flute-like. |
| `organ` | synth | A 10-harmonic wave with a high sustain and a short release |
| `vibraphone` | synth | A 16-harmonic wave with a fast attack and a long decay. Bell-like. |
| `fm-epiano` | synth | A 2-operator FM electric piano — bright, percussive attack settling into a mellow Rhodes-like tine |
| `piano` | sampled | Upright piano, 14 recorded zones |
| `violin` | sampled | Sustained bowed violin, 15 recorded zones |

## Picking an instrument

### On one note

Click a note to open the note widget. The `instrument` row is the last of the variable rows, below `color` and above the Add Note / Silence section.

![The note widget for a selected note, showing its variables and the instrument row](/img/note-widget.png)

Above the dropdown, one line tells you where the note's instrument comes from:

- **`Inherited: piano`** — the note has no instrument of its own and is following its frequency chain.
- **`Current: piano`** — the note pins that instrument itself.

Choose a name from the dropdown and a **`Save`** button appears. Click it to pin the instrument on that note. If the note already pins one, a **`Use Inherited`** button sits above the dropdown; click it to remove the pin and go back to inheriting.

Both actions pause playback and can be undone.

Measure bars have no instrument — they carry only a start time, so the row is absent.

### For everything else

**Settings → Audio → Default instrument** (the gear in the [top bar](/user-guide/interface/top-bar)) sets what a note plays when nothing in its frequency chain pins an instrument. It defaults to `sine-wave` and is remembered across reloads.

The change applies to the **next** playback, not the one in progress — an instrument is resolved once per note when playback is prepared. Press Stop, then Play.

### In module JSON

`instrument` is a plain string property, not an expression. It is written out only when a note explicitly pins one.

```json
{
  "baseNote": { "frequency": "263", "startTime": "0", "tempo": "100", "beatsPerMeasure": "4" },
  "notes": [
    { "id": 1, "startTime": "base.t", "duration": "beat(base)", "frequency": "base.f", "instrument": "piano" },
    { "id": 2, "startTime": "[1].t + [1].d", "duration": "beat(base)", "frequency": "[1].f * (3/2)" }
  ]
}
```

Note 2 has no `instrument` of its own, and its frequency depends on note 1 — so note 2 plays as `piano` too.

## How inheritance works

For each note, in order:

1. If the note pins an `instrument`, use it. An explicit pin always wins.
2. Otherwise read the note's **frequency expression**:
   - the first note reference in it (`[3].f`) → look at note 3, and repeat;
   - failing that, if the expression mentions `base.f` → look at the BaseNote, and repeat.
3. If nothing in the chain pins an instrument, use **Settings → Audio → Default instrument**.

Three consequences worth knowing:

**Inheritance follows frequency only.** A note whose *start time* depends on note 5 but whose frequency is a bare number inherits nothing from note 5. Set an instrument on it directly, or make its frequency depend on note 5.

**Only the first reference is followed.** A frequency of `[3].f * [7].f / base.f` inherits from note 3. Note 7 has no say.

**The BaseNote normally pins nothing**, so an ordinary composition chains all the way up to it and lands on the default-instrument setting. That is what makes the setting reach anything at all.

::: warning A BaseNote that does pin an instrument overrides the setting
Six of the shipped modules pin `"instrument": "sine-wave"` on their BaseNote — `canon base` and the five scale systems (`BP-13`, `Mixed-Base`, `TET-12`, `TET-19`, `TET-31`). Load one of those and changing "Default instrument" appears to do nothing, because every note is inheriting `sine-wave` from the BaseNote. Change the BaseNote's instrument in the note widget instead. `defaultModule` does not pin one, so the setting works there.
:::

::: warning The BaseNote's widget always reports `Current: sine-wave`
When the BaseNote has no instrument of its own, its widget row shows `Current: sine-wave` regardless of what "Default instrument" is set to — and playback uses the *setting*, not what the widget says. Every other note reports its inherited instrument correctly. Do not trust the BaseNote row.
:::

### Deleting a note keeps its instrument alive

When you delete a note with **Keep Dependencies** (the note widget's DELETE NOTE section), the deleted note's instrument is resolved and **written onto** every direct dependent that didn't already pin one. Those notes stop inheriting from that point on — including from the default-instrument setting. **Delete all** on a multi-selection does the same thing to every dependent that survives outside the group.

See [Dependencies](/user-guide/notes/dependencies) for what else that operation rewrites.

## The synth voices

`sine-wave` and `triangle-wave` are one oscillator each — a pure sine, and a triangle with a gentler harmonic series.

`square-wave` and `sawtooth-wave` are **not** bare waveforms. Each is three oscillators detuned by up to ±4 cents (a slight chorusing thickness) behind a lowpass filter whose cutoff tracks the note: 12× the note's frequency for square, 10× for sawtooth. The raw square/sawtooth harmonic series is still underneath, but the top of it is rolled off, which is why they sound rounder than a textbook oscillator.

`organ` and `vibraphone` are custom harmonic waves — 10 and 16 partials respectively. The organ sustains almost flat and releases fast; the vibraphone snaps in and decays for a long time.

`fm-epiano` is 2-operator FM: a sine carrier frequency-modulated by another sine at the same pitch. The modulation index starts high and falls over the first quarter-second, which is the bright ping-then-mellow of an electric piano tine.

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
2. **Pin the instrument high in the chain.** One pin on the note everything hangs off is worth twenty pins on leaves.
3. **Use synths for long notes.** The sample cap makes drones a poor fit for `piano` and `violin`.
4. **An unknown instrument name is silently ignored.** A module saved with `"instrument": "cello"` loads fine and plays as `sine-wave`.

## See also

- [Audio & Reverb](/user-guide/playback/audio) — the reverb, stereo placement and limiter every instrument runs through
- [Module Format](/user-guide/modules/module-format#instruments) — the `instrument` key in module JSON
- [Dependencies](/user-guide/notes/dependencies) — the frequency chains inheritance follows
