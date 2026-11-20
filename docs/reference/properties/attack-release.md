---
title: attack and release
description: Reference for the attack and release variables - how a note's envelope is shaped as shares of its duration, the defaults, the floors, inheritance from the BaseNote, and worked examples.
---

# attack and release

`attack` and `release` shape the envelope of a note: how quickly it rises to full level at its start, and how long it takes to fall to silence once the note has ended. A note's end is a **note-off**, like lifting a key: the sound does not stop there, it dies away. Each is written as a **share of the note's own duration**, a plain number. The attack runs from the note's start; the release runs from the note's end.

```
(1/8)       # attack: the first eighth of the note. release: an eighth of the note's length, after its end
(1/2)       # half the note's length
0           # as short as the anti-click floor allows
```

Like [amplitude](/reference/properties/amplitude), they are **interpretation variables**. They do not belong to the notation: a module with none of them is complete, and the app never writes a pitch or a start from one. They say how a note is *played*, not which note it *is*. The notation itself is only [frequency](/reference/properties/frequency), [startTime](/reference/properties/start-time) and [duration](/reference/properties/duration).

Because they are shares of the duration, they stay proportional when the note is resized, and when the time unit changes (see [the time unit](/reference/properties/duration#the-time-unit)). A note with `attack` `(1/4)` always spends a quarter of its length rising, and one with `release` `(1/4)` always rings for a quarter of its length after its end.

## Aliases

| Write | Meaning |
|---|---|
| `attack` | the saved spelling |
| `atk` | accepted, rewritten to `attack` on save |
| `release` | the saved spelling |
| `rel` | accepted, rewritten to `release` on save |

`[3].attack`, `[3].atk`, `base.release` and `base.rel` are all valid references.

## Defaults

| Situation | Value |
|---|---|
| A note with its own expression | that expression's value |
| A note without one | the BaseNote's, when the BaseNote has one |
| Neither the note nor the BaseNote | the instrument's own envelope time, in seconds |

Like `amplitude`, these are the only variables that fall back to the BaseNote when a note defines none. A single `attack` on the BaseNote therefore gives a whole module the same rise; one note's own value replaces it for that note. `frequency`, `startTime` and `duration` never inherit.

An unset value is not stored. A module that never mentions `attack` or `release` loads, plays and saves exactly as it did before, and no key is written for a note that does not define one.

## What they do to the sound

The attack and any decay start at the note's start, the sustain (or the instrument's natural decay) lasts until the note's end, and the release starts there. The release is not inside the note: it sounds **after** `startTime + duration`, and the voice is kept alive until it has finished. The note's length on the grid, in the dependency graph and in a MIDI export is unchanged; MIDI still writes the note-off at the note's end.

- The attack takes `duration × attack` seconds from the note's start; the release takes `duration × release` seconds from the note's end. With no value set, the instrument's own times in seconds apply (see [Instruments](/user-guide/playback/instruments)), so a short note keeps the shape of a long one.
- **Floors.** However small the share, the attack lasts at least **3 ms** and the release at least **15 ms**, so a very short note, or a share of `0`, does not click.
- **Fit.** The attack must fit inside the note: a note shorter than its attack is attacked over its whole length. Nothing else has to fit, because the release comes after the note.
- **Range.** The attack is clamped to `0`-`1` and the release to `0`-`4` (a release may ring for up to four times the note's length), for the sound only. The module keeps the exact value, and an expression that reads `[N].attack` sees it unclamped.
- A release that rings into the next note simply overlaps it, as a lifted key does.

See `envelopeTimes`, `applyVoiceEnvelope` and `noteShape` in `src/instruments/instrument-manager.js`, and how the engine passes the shares in `src/player/audio-engine.js`.

## Where you edit them

The note widget has an `attack` row and a `release` row below `amplitude`, with the same `Evaluated:` readout and `Raw:` input as the other rows. Both carry the hint "A share of the note's duration, e.g. 1/8".

| The readout says | Meaning |
|---|---|
| `Default:` instrument envelope | Neither the note nor the BaseNote sets one. The instrument's own time applies. |
| `Inherited:` and a value | The note has none of its own; the BaseNote sets one. |
| `Evaluated:` and a value | The note has its own. |

Type an expression into `Raw:` and press **Save** to give the note its own. Clear the field and press **Save** to remove it; the note goes back to inheriting. The BaseNote has rows too, and shows `Default:` until you give it one.

Silences and measure bars have no `attack` or `release` row, because neither makes a sound.

## Expression examples

### A piece-wide shape on the BaseNote

```
(1/20)      # on the BaseNote's attack: every note rises over a twentieth of its length
(1/4)       # on the BaseNote's release: every note rings for a quarter of its length after its end
```

### A note that swells

```
1           # attack: the whole note is a rise
0           # release: only the 15 ms floor after the note's end
```

### Relative to another note

```
[3].attack              # the same rise as note 3
[3].attack * 2          # twice as long a rise
base.release * (1/2)    # half the piece's release
```

## In the editor

The editor draws the envelope inside each note. When a note, or the BaseNote, sets an `attack` or a
`release` (or for every sounding note, with Settings → Appearance → **Envelope inside notes** at
*Every note*), the note body shows a band about its centre line whose height follows the loudness the
note sounds with, on a decibel scale: full height at the peak, nothing at 48 dB below it. On that scale
an exponential fall is a straight line, so:

- the attack rises from nothing (steeply at first: half the gain is already −6 dB);
- the instrument's decay, or its natural decay (vibraphone, fm-epiano), falls in a straight line to the
  level the sound has at the note's end;
- the hold runs level.

The note's right edge is where the key is lifted. The release rings after it, and with **Tails after
the note's end** on, the editor draws it there: the band continues past the note, in the note's colour
at reduced strength and without a border, falling in a straight line from the level at the note's end
to silence (−80 dB; the band reaches nothing at −48 dB). A tail is display only. Picking, hover,
the marquee, drags, resizes, snapping to a note's end, dependency lines, the module's end time and the
playhead all use the note's written rectangle; tails are hidden while a drag previews new positions.
A recording's own decay (the piano's, the violin's) is not drawn yet: their band holds level.

The note's full colour is inside the band; outside it the colour is dimmed (alpha × 0.3). The shape
comes from the same function as playback, `envelopeShares` and `envelopeTimes` in
`src/instruments/instrument-manager.js`, so the part that is drawn includes the instrument's own
times for whatever the note leaves unset, the 3 ms floor, and the fit of the attack inside the note.
A note with neither set, its own or the BaseNote's, is drawn as before, with no band. The
renderer side is `_envelopeSharesFor` and the envelope block in `rectBorderFS` in
`src/renderer/webgl2/renderer.js`.

## Dependencies

Referencing another note's `attack` or `release` creates a real dependency, as `[3].f` does. Evaluated values can be irrational: a power such as `2^(1/12)` in either is kept exact and flags the value corrupted (tempered, not a pure ratio), with the crosshatch and display described under [Corruption](/reference/glossary#corruption). The corruption flags are `0x10` for attack and `0x20` for release.

## See also

- [amplitude](/reference/properties/amplitude), the other interpretation variable
- [duration](/reference/properties/duration), the length they are shares of
- [Instruments](/user-guide/playback/instruments)
- [Module JSON Schema](/reference/module-schema)
