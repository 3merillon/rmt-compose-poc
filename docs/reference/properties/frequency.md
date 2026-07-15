---
title: frequency
description: Reference for the frequency property - aliases, defaults, valid expressions, the transpose arrows, corruption, instrument inheritance, and worked examples.
---

# frequency

`frequency` is the pitch of a note, in Hertz. Like every note property it is stored as an
**expression string**, compiled to bytecode, and evaluated with exact rational arithmetic.

A note with a `duration` but no `frequency` is a **silence** (it occupies time but never sounds). A
note with a `startTime` but neither `frequency` nor `duration` is a **measure bar**.

## Aliases

| Write | Meaning |
|---|---|
| `f` | canonical short form — what the app writes and what the widget shows |
| `freq` | accepted, rewritten to `f` on save |
| `frequency` | accepted, rewritten to `f` on save |

`[1].f`, `[1].freq` and `[1].frequency` compile to identical bytecode. `base.f` and `[0].f` are the
same thing: note id 0 *is* the BaseNote.

## Defaults

| Situation | Value |
|---|---|
| BaseNote in a module created from scratch | `440` |
| BaseNote in `defaultModule.json` (what you get on first load) | `263` |
| A note with no `frequency` expression | none — the note is a silence |
| An expression referencing a note whose frequency cannot be resolved | `440` (silent fallback, console warning only) |

::: warning
Frequency does **not** inherit. `[5].f` on a note that has no frequency expression does not walk up
to its parent — it falls back to the hard-coded `440`. Only `tempo`, `beatsPerMeasure` and
`measureLength` inherit from the BaseNote.
:::

## Where you edit it

Select a note to open the note widget. The `frequency` row has:

- an **`Evaluated:`** line (read-only, the computed value), with **▲ / ▼** transpose buttons at its
  right end,
- a **`Raw:`** text input plus a **`Save`** button (the button appears once you type).

A note with a frequency also carries ▲ / ▼ arrow regions on its **left edge** in the workspace:
click the upper half to transpose up, the lower half to transpose down. Silences have none, and
turning arrows off in Settings removes both the drawing and the click zones.

::: warning Edits apply on save
Typing in `Raw:` changes nothing. The expression is validated, simplified and compiled when you
press **Save**. If the expression is invalid, the save is silently dropped — the error only reaches
the browser console, not the screen.
:::

Dragging a note **does not** change its frequency directly (dragging is horizontal only, and moves
`startTime`). Dragging can still *rewrite* the frequency expression: if a move would leave a note
referencing a note that now starts after it, the app re-anchors the frequency to an earlier note
and rewrites the expression so the evaluated pitch is unchanged.

## The transpose arrows

The arrows multiply the frequency expression by a user-chosen ratio.

| Setting | Default | Range |
|---|---|---|
| Up ratio | `2/1` (an octave) | ratio in `[1/16, 16]`, never exactly 1 |
| Down ratio | `1/2` | same |
| Mode | `reciprocal` — you set up, down derives as its inverse | or `independent` |
| Enabled | on | off hides the arrows entirely |

Change them in **Settings → Arrows** (the gear in the top bar).

The factor is **folded into the expression's rational coefficient** instead of being prepended, so
stepping up and back down returns you to exactly where you were:

| Before | ▲ (×2) | ▼ (×1/2) |
|---|---|---|
| `base.f` | `2 * base.f` | `(1/2) * base.f` |
| `(1/2) * base.f` | `base.f` | `(1/4) * base.f` |
| `base.f * 2^(7/12)` | `2 * base.f * 2^(7/12)` | `(1/2) * base.f * 2^(7/12)` |

A power term is never absorbed into the coefficient, so a TET note stays TET.

## Expression examples

### Fixed frequency

```
440
263
(263/4)
```

### Relative to the BaseNote

```
base.f                 # same pitch as the BaseNote
base.f * (3/2)         # perfect fifth above
(3/2) * base.f         # identical - the app writes the coefficient first
base.f * 2             # octave above
base.f / (4/3)         # perfect fourth below
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.baseNote.getVariable('frequency').mul(new Fraction(2))
module.baseNote.getVariable('frequency').div(new Fraction(4, 3))
```
</details>

### Relative to another note

```
[1].f * (5/4)          # major third above note 1
[3].f / 2              # octave below note 3
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
module.getNoteById(3).getVariable('frequency').div(new Fraction(2))
```
</details>

### Equal temperament

```
base.f * 2^(1/12)      # one 12-TET semitone above base
[1].f * 2^(1/12)       # one 12-TET semitone above note 1
base.f * 2^(7/12)      # 12-TET perfect fifth
[1].f * 3^(1/13)       # one Bohlen-Pierce step above note 1
base.f * 2^(1/19)      # one 19-TET step
```

Exponents are reduced on save: `base.f * 2^(4/12)` is stored as `base.f * 2^(1/3)`.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 12)))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(7, 12)))
```
</details>

## Just-intonation ratios

| Interval | Ratio | Expression |
|---|---|---|
| Unison | 1/1 | `base.f` |
| Minor second | 16/15 | `base.f * (16/15)` |
| Major second | 9/8 | `base.f * (9/8)` |
| Minor third | 6/5 | `base.f * (6/5)` |
| Major third | 5/4 | `base.f * (5/4)` |
| Perfect fourth | 4/3 | `base.f * (4/3)` |
| Tritone | 45/32 | `base.f * (45/32)` |
| Perfect fifth | 3/2 | `base.f * (3/2)` |
| Minor sixth | 8/5 | `base.f * (8/5)` |
| Major sixth | 5/3 | `base.f * (5/3)` |
| Minor seventh | 9/5 | `base.f * (9/5)` |
| Major seventh | 15/8 | `base.f * (15/8)` |
| Octave | 2/1 | `base.f * 2` |

## Irrational frequencies (corruption)

A `^` whose result is irrational marks the property **corrupted**. `2^(1/12)` corrupts;
`4^(1/2)` does not, because it is exactly 2 — `base.f * 4^(1/2)` is simplified to `base.f * 2` on
save.

A corrupted frequency shows in the widget with an **`≈`** prefix and in italics. In the workspace the
note is **hatched**: a crosshatch means the note is corrupted at the source, a single diagonal hatch
means it merely depends on something corrupted.

Simplification merges like bases: `2^(1/12) * 2^(1/12) * base.f` saves as `2^(1/6) * base.f`.

## Dependencies

Referencing another note's frequency creates a **frequency dependency** on that note:

```
[1].f * (3/2)          # this note depends on note 1's frequency
```

Change note 1's frequency and this note follows. Select a note and the workspace outlines the
notes involved: **orange** for frequency, **teal** for startTime, **purple** for duration. A thick
outline is a note the selection depends on (its ancestor chain); a thin outline is a note that
depends on the selection.

Referencing the BaseNote (`base.f`) is not recorded as a graph edge — it is a flag on the
expression — but it behaves the same: edit the BaseNote and every note anchored to it moves.

## Instrument inheritance follows frequency

If a note has no `instrument` of its own, the app resolves one by walking the **frequency
expression**: a note whose frequency is `[7].f * (3/2)` inherits note 7's instrument; a note whose
frequency is `base.f * (5/4)` inherits the BaseNote's. If nothing along that chain pins an
instrument, the fallback is the **Settings → Audio → default instrument** (`sine-wave` out of the
box).

So retuning a note against a different parent can also change what it sounds like.

## In the workspace

- Vertical position is `log2(baseFreq / freq) * 100 * yScaleFactor` — higher frequency, higher on
  screen, logarithmic so equal ratios are equal distances.
- Each note is labelled with its frequency as a fraction of the BaseNote frequency (a rational
  approximation). A note with no frequency is labelled `silence`.
- **Horizontal dotted lines** are the octave guides. They are drawn at `ref × 2^k` and labelled
  `BaseNote` (or `Note [N]` when a note with a frequency is selected — the guides re-reference
  themselves to the selection), plus `+1`, `+2`, `-1`, … for the octaves around it.
- The **vertical dashed lines** are measure bars, not octaves. See
  [beatsPerMeasure](/reference/properties/beats-per-measure).

## In playback

The evaluated frequency is converted to a floating-point number at schedule time.

- Synth instruments (`sine-wave`, `square-wave`, `sawtooth-wave`, `triangle-wave`, `organ`,
  `vibraphone`, `fm-epiano`) set oscillator frequency directly.
- `piano` and `violin` are multisampled: the nearest zone is picked and played back at
  `frequency / zone.rootHz`. There is no oscillator.
- With **Settings → Audio → stereo** enabled (off by default), frequency also drives the pan
  position: `clamp(log2(freq / baseFreq) / 3, -1, 1)`, scaled by the stereo width. Three octaves
  span the full left-to-right field.

A note with no frequency is never scheduled to sound, but still occupies its span of time.

## See also

- [Pure Ratios](/user-guide/tuning/ratios)
- [Equal Temperament](/user-guide/tuning/equal-temperament)
- [Expression Syntax](/reference/expressions/syntax)
- [Dependencies](/user-guide/notes/dependencies)
