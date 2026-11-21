---
title: Audio & Reverb
description: The reverb, stereo width, limiter and master volume in RMT Compose, the switch that plays a module tempered, and how the Settings Audio tab drives them live during playback.
---

# Audio & Reverb

What comes out of the speakers is more than the notes. Every voice runs through a shared reverb, an optional stereo placement stage, the master volume, and a limiter. All of it is controlled from one place — and so is the switch that lets you hear a module pure and tempered.

## Out of the box

| | Default |
|---|---|
| Master volume | **100%** |
| Tempered playback | **Off** — every note sounds at the module's own frequency |
| Reverb | **On** — a medium room, mixed in at 25% |
| Stereo width | **Off** — no pitch-based placement; every note comes out of the centre |
| Limiter | **On** |

So a fresh module already has a little room around it. If you want the raw, dry sound, turn reverb off.

## When playback ends

A note's end is a note-off: its sound rings briefly after it, as a key lifted or a bow leaving the string
(see [Instruments](/user-guide/playback/instruments)). When the playhead reaches the end of the module,
the last notes therefore ring out to silence instead of being cut. **Stop** fades the current playback over 20 ms, and **Pause** fades it over 200 ms. A new playback opens over 8 ms. Existing room reverberation can continue after the dry sound fades. When a loop is switched off, the last pass ends the same
way. **Most voices at once** defaults to 256 and can be set as high as 4096 in
Settings → Audio. When more notes arrive, the player fades older release tails
first. Held notes play through their written ends, even in a chord larger than
the selected limit.

## Where the controls are

Click the **gear** in the [top bar](/user-guide/interface/top-bar) and choose the **Audio** tab. The panel is not modal — leave it open and keep composing; every change applies immediately, during playback.

![The Settings panel, Audio tab: master volume, default instrument, the Play tempered switch, the reverb section, and the start of the stereo width section](/img/settings-audio.png)

| Control | Range | Default | What it does |
|---|---|---|---|
| **Master volume** | 0–100% | 100% | The same value as the transport slider |
| **Default instrument** | the eleven names | `sine-wave` | What a note plays when neither it, nor its player, nor the BaseNote sets an instrument — see [Instruments](/user-guide/playback/instruments) |
| **Play tempered (12-TET)** | on/off | **off** | Plays each note on the nearest key of a keyboard tuned from the BaseNote — see [Pure / Tempered](#pure-tempered) |
| **Enable reverb** | on/off | **on** | Adds spatial ambience to the output |
| **Room size** | 0–1 | 0.5 | How big the space sounds |
| **Decay** | 0.1–12 s | 1.8 s | How long the tail rings |
| **Damping** | 0–1 | 0.5 | How fast the highs die away in the tail |
| **Pre-delay** | 0–200 ms | 20 ms | The gap between the note and the start of its reverb |
| **Reverb amount** | 0–100% | 25% | How much reverb is mixed in on top of the dry signal |
| **Spread notes by pitch** | on/off | **off** | Stereo placement by pitch |
| **Amount** | 0–100% | 60% | How far that placement spreads |
| **Limiter** | on/off | **on** | Gentle output limiting to avoid clipping |

## Pure / Tempered

**Play tempered (12-TET)** plays the module the way a keyboard would. Every note is moved to the nearest of twelve equal steps to the octave, counted from the **BaseNote**, and sounds there instead of at its own frequency. Turn it off and the exact ratios are back.

It exists for one comparison: the same module, pure and then tempered. It works on every instrument, `sine-wave` included.

| Interval | Pure | Tempered | Moves by |
|---|---|---|---|
| Fifth | `3/2` | 7 steps | −2.0 cents |
| Major third | `5/4` | 4 steps | +13.7 cents |
| Harmonic seventh | `7/4` | 10 steps | +31.2 cents |
| Eleventh harmonic | `11/8` | 6 steps | +48.7 cents |

What it does and does not touch:

- **Frequency only.** Start times, durations, instruments and stereo placement are the same either way.
- **The BaseNote and its octaves never move.** The grid is `BaseNote × 2^(k/12)`; change the BaseNote's frequency and the whole keyboard moves with it.
- **Two notes a comma apart usually become one.** `10/9` and `9/8` both land on the keyboard's whole tone, which is exactly what a keyboard does to them.
- **The module is not changed.** The note widget, the fraction labels on the notes and a saved file all keep the exact ratios. Only the sound is tempered.

::: tip The difference is there on every voice; overtones make it louder
On `sine-wave` it is subtle but clear. The pitches themselves move — the tempered third is 13.7 cents higher — and so do the difference tones your ear adds: under a pure chord they coincide, under a tempered one they drift apart and beat (5.7 times a second for a major triad on a 263 Hz root).

A voice with overtones adds the loudest cue of all. Two notes a ratio `p/q` apart share an overtone, and that overtone stands still when the interval is pure and beats when it is not. To hear it, set **Default instrument** to `harmonium`, or pin it on the note the others hang from, and put a chord on [loop](/user-guide/playback/transport#loop-playback). Rendered and measured: on `harmonium` the overtone a pure major third shares stands still, and with the switch on it beats — 10.4 times a second for a third on a 263 Hz root. See [the harmonium voices](/user-guide/playback/instruments#the-harmonium-voices).
:::

::: tip
Each note takes its playback pitch when scheduled. Previously scheduled notes retain that pitch. To compare a held chord immediately, stop, change the switch, and play the chord again.
:::

::: warning It stays on until you turn it off
Play tempered is remembered across reloads like every other setting, and nothing outside the Settings panel shows that it is on. If a module's pure chords sound restless, look here first.
:::

## Reverb

The reverb is a **send**, not a wet/dry crossfade. The dry signal is always there at full level; **Reverb amount** decides how much wet is added on top. At 0% you hear the module dry; at 100% you hear it dry *plus* a very wet reverb, not a reverb-only signal.

The room itself is generated in the browser at runtime — no impulse-response files are downloaded.

### The two kinds of control

**Room size, Decay and Damping rebuild the room.** Changing one of them re-renders the reverb, which happens a quarter-second after you let go of the slider — so dragging renders once at the end of the drag, not on every pixel. The new room swaps in when it's ready.

**Enable reverb, Pre-delay and Reverb amount are instant.** They change a level or a delay, and the change is smoothed, so you can toggle reverb on and off mid-playback without a click. Notes already ringing keep their tails.

### Using it

- **Room size** is the early-reflection cue — the sense of how far the walls are. Small values feel like a booth, large ones like a hall.
- **Decay** is the length of the tail. Short (under a second) keeps a fast piece legible; long (several seconds) turns sustained notes into a wash.
- **Damping** rolls the highs off the tail faster than the lows, the way real surfaces absorb sound. High damping = a soft, dark room; low damping = a bright, tiled one.
- **Pre-delay** buys clarity. A few tens of milliseconds keeps the attack of a note in front of its own reverb.

::: info A sustained tone's reverb tail shimmers
Hold a long steady note with a lot of reverb and the tail will waver a little rather than decaying perfectly smoothly. Try a shorter **Decay** or lower **Reverb amount** to reduce the effect.
:::

## Stereo width

Off by default: every note comes out of the centre. (The reverb is still a stereo effect — its impulse response is decorrelated left and right — so a dry-centred module with reverb on is not a mono signal.)

Turn **Spread notes by pitch** on and each note is placed left-to-right according to its pitch, as if you were sitting at a keyboard — low notes to the left, high notes to the right. The **BaseNote is dead centre**. Three octaves above it is hard right, three below is hard left, and **Amount** scales how far the whole spread reaches.

It is a musical effect, not a mixing tool: it makes a dense module easier to hear apart, and it makes a wide-ranging melody sweep across the stereo field.

::: tip
The setting applies when each voice is scheduled. Already scheduled notes retain their placement. The scheduling window can reach two seconds in sparse music and is shorter in dense passages.
:::

Both sampled instruments are mono recordings. Their stereo position comes entirely from this stage.

## Limiter

With **Limiter** enabled, the master output passes through two stages. The first reduces loud passages. The second catches sharp peaks such as many notes striking together. A gain adjustment compensates for the second stage’s makeup gain.

Switching the limiter off bypasses both stages. Use **Master volume** to set the listening level.

## Master volume

Two knobs, one value: the top-bar slider and **Settings → Audio → Master volume** are the same thing. Drag either and the other follows. The level is saved and restored on your next visit.

## The signal path

```
each note → its instrument's bus ─┬─ dry ──────────────────────────┐
                                  └─ reverb send → the room → wet ─┤
                                                                   ▼
                                              master volume → limiter → speakers
```

Every instrument gets its own bus, but the buses are plumbing, not a mixer: there are **no per-instrument volume, mute, solo or send controls**. Master volume changes the whole mix. Use a note’s amplitude expression to adjust that note or its dependents.

## Where these settings live

Audio settings are stored **in your browser**, not in the module. Share a module file and the person opening it hears it through *their* reverb settings, not yours — and pure or tempered according to *their* switch.

They are also outside Undo — `Ctrl/Cmd + Z` covers the module, not the settings panel. To get back to the defaults, use **Reset this tab** (audio only) or **Reset all** (every tab) at the end of the panel. Both ask for confirmation before they run, and neither can be undone.

## See also

- [Instruments](/user-guide/playback/instruments) — the eleven voices these controls are downstream of
- [Transport Controls](/user-guide/playback/transport) — the other master-volume knob, and how playback is scheduled
- [Settings Reference](/reference/settings-reference) — every setting, range and default in one table
