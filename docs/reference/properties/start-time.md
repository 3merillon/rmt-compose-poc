---
title: startTime
description: Reference for the startTime property - aliases, defaults, valid expressions, dragging, measure chains, and worked examples.
---

# startTime

`startTime` is when a note begins, in **seconds from the start of the composition**. Like every
note property it is stored as an expression string, compiled to bytecode, and evaluated with exact
rational arithmetic.

Almost every note in a real module expresses its start *relative to another note* rather than as an
absolute number. That is what makes a composition editable: move one note and everything anchored
to it follows.

## Aliases

| Write | Meaning |
|---|---|
| `t` | canonical short form — what the app writes and what the widget shows |
| `s` | accepted, rewritten to `t` on save |
| `start` | accepted, rewritten to `t` on save |
| `startTime` | accepted, rewritten to `t` on save |

`base.t` and `[0].t` are the same thing: note id 0 *is* the BaseNote.

## Defaults

| Situation | Value |
|---|---|
| BaseNote in a module created from scratch | `0` |
| BaseNote in `defaultModule.json` | `0` |
| A note with no `startTime` expression | none — the note is never scheduled |
| An expression referencing a note whose startTime cannot be resolved | `0` (silent fallback, console warning only) |

`startTime` does **not** inherit: `[5].t` on a note with no startTime expression falls back to the
hard-coded `0`, it does not walk up to a parent.

## Where you edit it

- **The note widget.** Select the note; the `startTime` row has an `Evaluated:` readout and a
  `Raw:` input with a `Save` button. Edits apply on **Save**, not while typing. An invalid
  expression is rejected with the reason shown in red under the Save button.
- **Dragging.** Drag a note's body left or right. Notes only move horizontally — dragging never
  changes pitch.
- **Group drag.** With several notes selected, dragging one applies the same time delta to every
  selected note that is not already anchored to another selected note. Notes anchored to a moved
  note are left alone: they follow their anchor anyway, and rewriting them would double-move them.
- **Measure triangles.** A measure bar's start is dragged by its triangle handle.

### What a drag writes

Dragging snaps the start to a **quarter of a beat** — a sixteenth note, when a beat is a quarter —
and clamps it so it can never land before the
BaseNote. The app then picks the nearest suitable **anchor** — the ancestor (or, going forward
along a measure chain, the next measure) that starts at or before the new position — and writes the
start relative to it:

| Situation | Expression written |
|---|---|
| Dropped exactly at the anchor's start | `[P].t` |
| Dropped exactly at the anchor's end | `[P].t + [P].d` |
| Dropped elsewhere | `[P].t + beat([P]) * (n/d)` (or `- beat([P]) * (n/d)`) |

When the anchor is the BaseNote, `[P]` is written as `base`. Moving a note can also rewrite *other*
notes' expressions: if a move would leave a note referencing a note that now starts after it, the
app re-anchors that dependent to an earlier note.

## Expression examples

### Absolute time

```
0        # start of the composition
1        # one second in
(5/2)    # 2.5 seconds in
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(0)
new Fraction(1)
new Fraction(5, 2)
```
</details>

### Relative to the BaseNote

```
base.t                       # same start as the BaseNote
base.t + 1                   # one second after it
base.t + beat(base) * (1/4)  # a quarter of a beat after it (a sixteenth note)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('startTime')
module.baseNote.getVariable('startTime').add(new Fraction(1))
```
</details>

### Sequential notes

The single most common pattern — start when note 1 ends:

```
[1].t + [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
```
</details>

### Beat- and measure-relative

```
beat(base) * 2         # two beats after time zero
base.t + beat(base)    # one beat after the BaseNote
[3].t + beat(base)     # one beat after note 3 starts
[1].t + measure([1])   # one measure after note 1 starts
```

`beat(x)` is `60 / tempo(x)` in seconds. `measure(x)` is `x`'s measure length in seconds.

::: tip
`measure([1])` is written back as `[1].ml` when the module is saved — the two compile to identical
bytecode. `beat()` is the one helper the decompiler reconstructs, so it survives a save.
:::

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(3).getVariable('startTime')
  .add(new Fraction(60).div(module.findTempo(module.baseNote)))

module.getNoteById(1).getVariable('startTime')
  .add(module.findMeasureLength(module.getNoteById(1)))
```
</details>

### Simultaneous notes (chords)

Give every note of the chord the same start:

```
[1].t
```

### A melody

```
# note 1
base.t

# note 2
[1].t + [1].d

# note 3
[2].t + [2].d
```

::: warning
There is no `[prev]` reference. A note reference must be a literal, non-negative integer id:
`[2].t`, not `[prev].t`.
:::

## Measure bars and measure chains

A note that has a `startTime` but **no `duration` and no `frequency`** is a **measure bar**. It is
drawn as a vertical dashed line, it never sounds, and it is the backbone of the timing grid. A
measure chain is just measure bars linked through `startTime`:

```json
{ "id": 1, "startTime": "base.t" },
{ "id": 2, "startTime": "[1].t + measure([1])" },
{ "id": 3, "startTime": "[2].t + measure([2])" }
```

Because each link uses the *previous measure's own* measure length, giving a single measure bar its
own `beatsPerMeasure` changes the length of that bar and shifts every later one. See
[beatsPerMeasure](/reference/properties/beats-per-measure).

## Dependencies

Referencing another note's start creates a **startTime dependency**:

```
[1].t + [1].d      # depends on BOTH note 1's startTime and its duration
```

That expression makes this note follow note 1 when note 1 is *moved* and when it is *resized*.

Select a note and the workspace outlines the notes involved: **teal** for startTime, **orange** for
frequency, **purple** for duration. A thick outline is a note the selection depends on; a thin
outline is a note that depends on the selection.

## In the workspace

- Horizontal position is `seconds * 200 * xScaleFactor`.
- The **playhead** is the vertical line that tracks playback position.
- The **vertical dashed lines** are measure bars, drawn from the measure chain.

## In playback

A note is scheduled only if it has both a `startTime` and a `duration`. Its voice starts at
`startTime` (offset by wherever playback began) and its envelope runs entirely inside
`[startTime, startTime + duration]`.

## See also

- [duration](/reference/properties/duration)
- [tempo](/reference/properties/tempo)
- [beatsPerMeasure](/reference/properties/beats-per-measure)
- [Creating Notes](/user-guide/notes/creating-notes)
- [Dependencies](/user-guide/notes/dependencies)
