---
title: attack and release
description: Reference for the attack and release variables - how a note's envelope is shaped as shares of its duration, the defaults, the floors, inheritance from the BaseNote, and worked examples.
---

# attack and release

`attack` and `release` shape the envelope of a note: how quickly it rises to full level at its start, and how long it takes to fall to silence at its end. Each is written as a **share of the note's own duration**, a plain number between `0` and `1`.

```
(1/8)       # the first (or last) eighth of the note
(1/2)       # half the note
0           # as short as the anti-click floor allows
```

Like [amplitude](/reference/properties/amplitude), they are **interpretation variables**. They do not belong to the notation: a module with none of them is complete, and the app never writes a pitch or a start from one. They say how a note is *played*, not which note it *is*. The notation itself is only [frequency](/reference/properties/frequency), [startTime](/reference/properties/start-time) and [duration](/reference/properties/duration).

Because they are shares of the duration, they stay proportional when the note is resized, and when the time unit changes (see [the time unit](/reference/properties/duration#the-time-unit)). A note with `attack` `(1/4)` always spends a quarter of its length rising.

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
| Neither the note nor the BaseNote | the instrument's own envelope ratio |

Like `amplitude`, these are the only variables that fall back to the BaseNote when a note defines none. A single `attack` on the BaseNote therefore gives a whole module the same rise; one note's own value replaces it for that note. `frequency`, `startTime` and `duration` never inherit.

An unset value is not stored. A module that never mentions `attack` or `release` loads, plays and saves exactly as it did before, and no key is written for a note that does not define one.

## What they do to the sound

The envelope is fitted inside `[startTime, startTime + duration]` and reaches zero at the end, so the audible length is always the duration you wrote.

- The attack takes `duration × attack` seconds; the release takes `duration × release` seconds.
- **Floors.** However small the share, the attack lasts at least **3 ms** and the release at least **15 ms**, so a very short note, or a share of `0`, does not click.
- **Fitting.** When a note's own attack and release add up to more than its duration, both are scaled down together to fit. An instrument's default ratios are held back further: they leave at least 10% of the note as its body.
- Each share is clamped to `0`–`1` for the sound only. The module keeps the exact value, and an expression that reads `[N].attack` sees it unclamped.

See `envelopeTimes`, `applyVoiceEnvelope` and `noteShape` in `src/instruments/instrument-manager.js`, and how the engine passes the shares in `src/player/audio-engine.js`.

## Where you edit them

The note widget has an `attack` row and a `release` row below `amplitude`, with the same `Evaluated:` readout and `Raw:` input as the other rows. Both carry the hint "A share of the note's duration, e.g. 1/8".

| The readout says | Meaning |
|---|---|
| `Default:` instrument envelope | Neither the note nor the BaseNote sets one. The instrument's own ratio applies. |
| `Inherited:` and a value | The note has none of its own; the BaseNote sets one. |
| `Evaluated:` and a value | The note has its own. |

Type an expression into `Raw:` and press **Save** to give the note its own. Clear the field and press **Save** to remove it; the note goes back to inheriting. The BaseNote has rows too, and shows `Default:` until you give it one.

Silences and measure bars have no `attack` or `release` row, because neither makes a sound.

## Expression examples

### A piece-wide shape on the BaseNote

```
(1/20)      # on the BaseNote's attack: every note rises over a twentieth of its length
(1/4)       # on the BaseNote's release: every note fades over its last quarter
```

### A note that swells

```
1           # attack: the whole note is a rise
0           # release: nothing after it but the floor
```

### Relative to another note

```
[3].attack              # the same rise as note 3
[3].attack * 2          # twice as long a rise
base.release * (1/2)    # half the piece's release
```

## In the editor

The editor draws the envelope inside each note. When a note, or the BaseNote, sets an `attack` or a
`release`, the note body shows a band about its centre line whose height follows the gain the note
sounds with:

- the attack ramps up from a point;
- the instrument's decay falls to its sustain level;
- the hold runs level;
- the release ramps down to a point at the note's end.

The note's full colour is inside the band; outside it the colour is dimmed (alpha × 0.3). The shape
comes from the same function as playback, `envelopeShares` and `envelopeTimes` in
`src/instruments/instrument-manager.js`, so it includes the instrument's own ratios for whatever the
note leaves unset, the 3 ms and 15 ms floors, and the fit inside the note: what you see is what you
hear. A note with neither set, its own or the BaseNote's, is drawn as before, with no band. The
renderer side is `_envelopeSharesFor` and the envelope block in `rectBorderFS` in
`src/renderer/webgl2/renderer.js`.

## Dependencies

Referencing another note's `attack` or `release` creates a real dependency, as `[3].f` does. Evaluated values can be irrational: a power such as `2^(1/12)` in either is kept exact and flags the value corrupted (tempered, not a pure ratio), with the crosshatch and display described under [Corruption](/reference/glossary#corruption). The corruption flags are `0x10` for attack and `0x20` for release.

## See also

- [amplitude](/reference/properties/amplitude), the other interpretation variable
- [duration](/reference/properties/duration), the length they are shares of
- [Instruments](/user-guide/playback/instruments)
- [Module JSON Schema](/reference/module-schema)
