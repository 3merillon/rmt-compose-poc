---
title: amplitude
description: Reference for the amplitude property - a note's loudness as a relative gain, inheritance from the BaseNote, the playback range, and worked examples.
---

# amplitude

`amplitude` is how loud a note is, written as a **relative gain**: a plain number that scales the
level the note plays at. `1` is the level every note has when nothing says otherwise. `2` is twice
that amplitude, `(1/2)` is half of it.

It is an expression like any other property, so loudness can be written the way pitch is — as a
relationship to another note rather than as an absolute:

```
(121/100) * [3].a      # a touch louder than note 3, whatever note 3 is
```

Change note 3's amplitude and this note follows, keeping its 121 : 100 ratio exactly.

## Aliases

| Write | Meaning |
|---|---|
| `a` | amplitude (the saved spelling) |
| `amp` | the same |
| `amplitude` | the same |

`base.a`, `[3].a`, `[3].amp` and `[3].amplitude` are all valid. Aliases are normalized on save:
type `[3].amplitude`, and it comes back as `[3].a`.

## Defaults

| Situation | Value |
|---|---|
| A note with an `amplitude` expression | that expression's value |
| A note without one | the BaseNote's amplitude |
| The BaseNote without one | `1` |

Amplitude is one of the four **inheriting** properties, along with `tempo`, `beatsPerMeasure` and
`measureLength`. `[5].a` on a note that defines no amplitude of its own yields the BaseNote's. That
is what makes a single `amplitude` on the BaseNote scale a whole piece.

An unset amplitude is not stored. A module that never mentions the property loads, plays and saves
exactly as it did before the property existed — no `amplitude` key is ever written for a note that
does not define one.

::: warning Inheriting is not multiplying
A note that defines its own amplitude **replaces** the BaseNote's; it does not scale it. Write the
relationship if you want it:

| On the note | BaseNote at `(1/2)` | Follows the BaseNote? |
|---|---|---|
| *(nothing)* | `1/2` | yes — inherited |
| `base.a * 2` | `1` | yes — it is written against it |
| `2` | `2` | no — a constant |
:::

## Where you edit it

The note widget has an `amplitude` row with the same `Evaluated:` readout and `Raw:` input as the
other expression rows. On a note it sits between `frequency` and `color`; on the BaseNote it
follows `beatsPerMeasure`.

- A note with no amplitude of its own shows **`Inherited:`** and the value it is sounding at, in
  grey, with an empty `Raw:` field — the same presentation as an inherited instrument. The
  BaseNote has nothing to inherit from, so without one it shows `Evaluated: 1`.
- Type an expression into `Raw:` and press **Save** to give the note its own.
- Clear the `Raw:` field and press **Save** to remove it again. The note goes back to inheriting.

Silences and measure bars have no `amplitude` row: neither makes a sound.

## What it does to the sound

Each note's envelope peaks at `0.2 × amplitude` (a sampled instrument's own gain trim still
applies). Everything downstream — the master volume, the reverb send, the limiter — is unchanged
and applies on top.

| `amplitude` | Level | Envelope peak |
|---|---|---|
| `4` | +12.04 dB | 0.8 |
| `2` | +6.02 dB | 0.4 |
| `(3/2)` | +3.52 dB | 0.3 |
| `(121/100)` | +1.66 dB | 0.242 |
| `1` | 0 dB | 0.2 |
| `(1/2)` | −6.02 dB | 0.1 |
| `(1/4)` | −12.04 dB | 0.05 |
| `(1/10)` | −20 dB | 0.02 |

**Playback clamps amplitude to the range `0` to `4`.** Above `4` a note plays at `4`; at `0` it is
silent and no voice is created for it; a negative amplitude has no meaning for a level and plays
as `0`. The clamp is applied to the sound only. The module keeps the exact value, and an expression
that reads `[N].a` sees it unclamped.

Loud notes add up. The limiter (**Settings → Audio**) is on by default and catches the peaks of a
dense, loud passage; with it off, several notes at `4` can clip.

In a MIDI export the same clamped value becomes the note's velocity, `64 × √amplitude` — see
[Exporting MIDI](/user-guide/modules/exporting-midi#amplitude-becomes-velocity).

## Expression examples

### A piece-wide level on the BaseNote

```
(1/2)       # every note that defines no amplitude now plays at half level
```

### Relative to the BaseNote

```
base.a * (3/2)      # an accent: half again as loud as the piece's level
base.a * (1/2)      # a ghost note
base.a              # the piece's level, stated explicitly
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('amplitude').mul(new Fraction(3, 2))
module.baseNote.getVariable('amplitude').mul(new Fraction(1, 2))
```
</details>

### Relative to another note

```
[3].a                   # exactly as loud as note 3
(121/100) * [3].a       # a touch louder
[3].a * (4/5)           # an echo of note 3
```

Chained, this writes a crescendo as a ratio per step — each note `(11/10)` of the one before it:

```
[1].a * (11/10)         # on note 2
[2].a * (11/10)         # on note 3
[3].a * (11/10)         # on note 4
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(3).getVariable('amplitude')
module.getNoteById(3).getVariable('amplitude').mul(new Fraction(121, 100))
```
</details>

### Decibels

A gain of *d* decibels is `10^(d/20)`:

```
base.a * 10^(-6/20)     # 6 dB below the piece's level, ≈ 0.501
```

Unless the power happens to be rational this is an irrational number, so the value is shown with
`≈` and the note is drawn crosshatched like any note carrying an irrational value. See
[Corruption](/reference/glossary#corruption). If you want an exact fraction instead, `(1/2)` is
−6.02 dB.

## Dependencies

Referencing another note's amplitude (`[3].a`) creates a real dependency on note 3, exactly as
`[3].f` does:

- **Liberate Dependencies** and **Delete → Keep Dependencies** on note 3 substitute note 3's own
  amplitude expression into the notes that read it — or `base.a`, if note 3 was only inheriting —
  so they keep their level.
- **Delete → Delete Dependencies** on note 3 removes the notes that read its amplitude too.
- **Evaluate to BaseNote** rewrites a note's amplitude as a ratio of the BaseNote's:
  `base.a * (121/100)`. An irrational amplitude is left as written, so its power is not replaced
  by an approximation — which also means it keeps any dependency its expression names.
- Dropping a module onto a note re-roots `base.a` onto that note (`[N].a`), like every other
  `base.` reference. Dropped onto a measure bar it stays `base.a` — a measure bar has no level.

Amplitude dependencies have no dependency line of their own: the coloured lines cover
`frequency`, `startTime` and `duration` only.

An amplitude edit on the BaseNote re-evaluates every note that reads `base.a`, and every note that
reads another note's amplitude — because that other note may be inheriting.

## In the workspace

A note's **height** shows its amplitude. The height is the normal one times the square root of the
gain playback uses, kept between 0.6× and 2×: amplitude `(1/2)` draws at 0.71×, `2` at 1.41×, `4`
at twice the height, and anything at or below `(9/25)` at 0.6×, so that the quietest note still
holds its labels. The note stays centred on its pitch line.

Amplitude `1` — and so every note of a module that sets none — draws exactly as before. Silences
are never scaled. The exact value is in the widget row.

::: info The optional WASM evaluator
The Rust evaluator behind the opt-in `?evaluator=wasm` flag does not know this property yet. On
that path every note plays at `1`, and an expression that reads `.a` fails to evaluate there. The
default JavaScript evaluator — what the app runs unless you add the flag — supports it fully.
:::

## See also

- [frequency](/reference/properties/frequency)
- [tempo](/reference/properties/tempo) — the other property a note inherits from the BaseNote
- [Module API](/reference/expressions/module-api#inheritance) — inheritance rules
- [Module JSON Schema](/reference/module-schema)
- [Instruments](/user-guide/playback/instruments)
- [Exporting MIDI](/user-guide/modules/exporting-midi) — amplitude as velocity
