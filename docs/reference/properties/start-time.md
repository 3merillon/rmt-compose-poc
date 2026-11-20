---
title: startTime
description: Reference for the startTime property - aliases, defaults, valid expressions, dragging, measure chains, and worked examples.
---

# startTime

`startTime` is when a note begins, in **seconds from the start of the composition**. Like every
note property it is stored as an expression string, compiled to bytecode, and evaluated with exact
rational arithmetic.

It is one of the three variables of the notation, with [frequency](/reference/properties/frequency)
and [duration](/reference/properties/duration).

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

Dragging snaps the start to a **quarter of a time unit** (`base.d`, one beat if you count in beats;
a sixteenth note, when the unit is a quarter note) and clamps it so it can never land before the
BaseNote. The app then picks the nearest suitable **anchor** — the ancestor (or, going forward
along a measure chain, the next measure) that starts at or before the new position — and writes the
start relative to it:

| Situation | Expression written |
|---|---|
| Dropped exactly at the end of **any** note (it now follows that note) | `[P].t + [P].d`, P being that note |
| Dropped exactly at the anchor's start | `[P].t` |
| Dropped exactly at the anchor's end | `[P].t + [P].d` |
| Dropped elsewhere | `[P].t + base.d * (n/d)` (or `- base.d * (n/d)`) |

The first row is a relation, not an offset: the moved note now starts wherever P ends, so it moves
when P's start or length changes. It applies to a single-note move. P can be any sounding note or
silence, not a measure bar (a bar's end is the next bar's start, which the bar chain already offers),
and not a note that depends on the moved one (that would be a cycle). When several notes end there,
the note's current anchor wins, then the one that starts latest. A group move keeps the anchor rule,
because the other notes in the group are still moving while each commits. Offsets that land anywhere
else stay in time units (`base.d`): time is the workspace's, not the followed note's.

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

### Relative to the BaseNote

```
base.t                       # same start as the BaseNote
base.t + 1                   # one second after it
base.t + base.d * (1/4)      # a quarter of a time unit after it (a sixteenth note)
```

### Sequential notes

The single most common pattern — start when note 1 ends:

```
[1].t + [1].d
```

### In time units and bars

```
base.t + base.d * 2    # two time units after the BaseNote starts
base.t + base.d        # one time unit after the BaseNote
[3].t + base.d         # one time unit after note 3 starts
[1].t + [1].d          # when measure bar 1 ends, which is where bar 2 starts
```

`base.d` is the time unit, the BaseNote's duration: see
[the time unit](/reference/properties/duration#the-time-unit). There is no function to fetch a beat or
a measure; a measure bar's length is its own `.d`.

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

## Measure bars

A measure bar is a silent note with a start and a duration, no frequency, and the flag
`"measure": true`. It is drawn as a vertical dashed line with a triangle, it never sounds, and a chain
of them is the timing grid. Each bar starts where the previous one ends:

```json
{ "id": 1, "startTime": "base.t", "duration": "base.d * 4", "measure": true },
{ "id": 2, "startTime": "[1].t + [1].d", "duration": "[1].d", "measure": true },
{ "id": 3, "startTime": "[2].t + [2].d", "duration": "[2].d", "measure": true }
```

Because each link reads the previous bar's own start and duration, giving one bar a different
duration changes that bar's length and moves every later start. See
[Measure bars](/reference/module-schema#measure-bars) for the full rules, including how a bar differs
from a silence and from a plain marker.

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
- [Measure bars](/reference/module-schema#measure-bars)
- [Creating Notes](/user-guide/notes/creating-notes)
- [Dependencies](/user-guide/notes/dependencies)
