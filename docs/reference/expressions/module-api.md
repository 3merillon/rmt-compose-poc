---
title: Module API
description: Note references in RMT Compose expressions — base, [N], the six properties, inheritance — plus the Module methods getTimeUnit() and getMeasureNotes().
---

# Module API

An expression reaches other notes through **references**. That is the whole surface: two ways to
name a note, six properties. The language has no functions.

```
base.f                 # the BaseNote's frequency
[1].t + [1].d          # note 1's start plus note 1's duration
base.d * 2             # two time units
```

::: info There is no `module` object
In the DSL there is nothing called `module` and nothing to call methods on.
:::

## Note references

### The BaseNote: `base`

The BaseNote is note **0**. It is the module's reference point: the frequency, the start and the
duration everything else is measured against. It is not a playable note.

```
base.f                 # frequency, in Hz
base.t                 # start time, in seconds
base.d                 # duration, in seconds: the time unit
base.a                 # amplitude, a relative gain
base.attack            # attack, a share of each note's duration
base.release           # release, a share of each note's duration, counted from the note's end
```

`[0].p` means exactly the same thing as `base.p`. Saving rewrites `[0]` to `base`.

`base.d` is the **time unit**, one beat if you count in beats. It is what `beat(base)` used to be.
`60 / base.d` is the tempo in BPM, a read-only view in the note widget; nothing stores a tempo. See
[the time unit](/reference/properties/duration#the-time-unit).

What the BaseNote defines:

| Variable | Defined on the BaseNote? |
|---|---|
| `frequency` | Yes. Default 440 Hz. |
| `startTime` | Yes. Default 0 s. |
| `duration` | Yes. Default 1 s. The time unit. |
| `amplitude` | Only if you set it. Otherwise `base.a` reads as 1. |
| `attack`, `release` | Only if you set them. Otherwise the instrument's own envelope applies. |

The module that ships as the default puts the BaseNote at 263 Hz with a duration of 3/5 s (100 BPM).
Loading a different module replaces all of that: a module file defines its own BaseNote.

### Another note: `[N]`

```
[1].f                  # note 1's frequency
[5].t                  # note 5's start time
[10].d                 # note 10's duration
```

`N` must be a literal non-negative integer. There is no `[prev]`, no arithmetic in the brackets,
and no variables.

On a measure bar, `[N].d` is the bar's length. That is what `measure([N])` used to be.

Referencing a note that does not exist is not an error. Evaluation substitutes a fixed default
and carries on — `startTime` 0, `duration` 1, `frequency` 440. The three
[inheriting](#inheritance) variables read the BaseNote's value instead, exactly as they would on
a note that exists but does not define them. Nothing on screen tells you this happened, so check
the `Evaluated:` line.

## Properties

Six properties, in two groups, each with one or more accepted spellings.

| Group | Property | Accepted spellings | Saved as | Unit |
|---|---|---|---|---|
| Language | frequency | `f`, `freq`, `frequency` | `f` | Hz |
| Language | startTime | `t`, `s`, `start`, `startTime` | `t` | seconds |
| Language | duration | `d`, `dur`, `duration` | `d` | seconds |
| Interpretation | amplitude | `a`, `amp`, `amplitude` | `a` | none, a relative gain |
| Interpretation | attack | `attack`, `atk` | `attack` | none, a share of the note's duration |
| Interpretation | release | `release`, `rel` | `release` | none, a share of the note's duration |

The first three are the **language**: the notation, each variable a relation to other notes. The
last three **interpret** a note: they say how it sounds, and are not part of the notation.

Anything else is rejected: there is no `l`, `len`, `st`, `pitch`, `vol` or `velocity`, and the
removed `tempo`, `bpm` and `ml` are refused with a message naming the replacement (see
[Expression Syntax](/reference/expressions/syntax#there-are-no-functions)).

### Inheritance

`amplitude`, `attack` and `release` **fall back to the BaseNote** when the note you reference does
not define them. `[5].a` on a note with no amplitude of its own returns the BaseNote's. This is what
makes a single `amplitude` on the BaseNote scale the whole piece.

If the BaseNote does not define the variable either, the last resort is a fixed default:
`amplitude` 1. For `attack` and `release`, a note that reads neither its own nor the BaseNote's
sounds with the instrument's own envelope; a reference that cannot be resolved at all reads as 0.

`startTime`, `duration` and `frequency` do **not** inherit. Each note either has its own
expression or it does not. There is no fallback of timing to the BaseNote.

## No functions

There is no `beat()`, `tempo()` or `measure()`, and no `instrument()`. The three time forms were
removed, and typing one is refused with the replacement:

| Old | New |
|---|---|
| `beat(base)`, `beat([N])` | `base.d` |
| `measure([N])` on a bar | `[N].d` |

```
base.d                       # one time unit
base.d * 2                   # two (a half note in 4/4)
base.d * (1/2)               # half of one (an eighth note)
base.d * (3/2)               # a dotted unit
base.d * 4                   # a measure of four, if you count in fours
```

`base.d * (n/d)` is also what the note-length buttons in the note widget write for you.

An instrument is not an expression value. See
[Which instrument a note plays](#which-instrument-a-note-plays) below for what decides it.

## The Module object, from JavaScript

Outside an expression, the application's `Module` has two methods for the new time model
(`src/module.js`):

| Method | Returns |
|---|---|
| `getTimeUnit()` | The BaseNote's evaluated duration, as a `Fraction`, or `1` when it is not positive. `60 / getTimeUnit()` is the tempo. |
| `getMeasureNotes()` | Every measure bar, unordered: the notes flagged `"measure": true`. |

`findTempo()` and `findMeasureLength()` are gone, and the bytecode opcodes `FIND_TEMPO` and
`FIND_MEASURE` are retired. `EXPRESSION_VARS` (the six variable names) and `isMeasureNote(note)` are exported from
`src/note.js`.

## Dependencies

Referencing another note creates a **dependency**, automatically:

```
# Note 2's frequency
[1].f * (3/2)          # note 2 now depends on note 1
```

Change note 1's frequency and note 2 re-evaluates. Dependencies are tracked per *variable*, not
per note: the expression above records "note 2's frequency depends on note 1's frequency",
which is what lets the workspace draw dependency lines in variable colours — orange for
frequency, teal for startTime, purple for duration.

![Dependency lines between notes, colour-coded by property](/img/dependency-lines.png)

The graph guarantees:

- Dependencies are evaluated before the things that depend on them.
- Circular dependencies are rejected when you save, and self-reference is rejected too.
- Only the notes actually affected by a change are re-evaluated.

Referencing `base` is tracked differently. It sets a flag on the expression rather than adding a
graph edge to note 0 — an edge to note 0 would make the BaseNote depend on itself. The effect
is the same (edit the BaseNote and everything referencing it updates), but the BaseNote does
not appear as an ordinary parent in the graph.

See [Dependencies](/user-guide/notes/dependencies) and
[Dependency Graph](/developer/core/dependency-graph).

## Which instrument a note plays

There is no expression for this, but it is worth knowing here because it is the one property
that is decided by *other* properties' expressions.

A note's instrument is resolved like this:

1. If the note has an explicit `instrument` field, use it. The note starts a new player.
2. Otherwise, if its start is written from the end of a note or a silence (`[p].t + [p].d`, with
   or without a rest added), take that note's instrument: the note is in the same player.
3. Otherwise, if it is a copy of a note of a line (start `[k].t + X`, frequency `r * [k].f`) and
   the copy of that note's predecessor exists, take that copy's instrument.
4. Otherwise it starts a line: take the instrument of the note its start time is written from
   (`[k].t …`), else the BaseNote's, else the global default instrument
   (Settings → Audio → default instrument; `sine-wave` out of the box).

So the instrument follows the *start time*, not the frequency. See
[Instruments](/user-guide/playback/instruments#players).

## Worked patterns

### Relative frequency

```
base.f * (3/2)         # a perfect fifth above the BaseNote
[1].f * (5/4)          # a major third above note 1
base.f / 2             # an octave below the BaseNote
```

### Sequential notes

```
[7].t + [7].d          # start the instant note 7 ends
```

### Time-unit-relative timing

```
base.d                           # one time unit
base.d * (1/2)                   # half of one
[1].d                            # as long as note 1
base.t + base.d * (1/4)          # a quarter of a time unit after the BaseNote starts
```

### Equal temperament

```
base.f * 2^(1/12)      # one 12-TET semitone above the BaseNote
base.f * 2^(4/12)      # a 12-TET major third
[1].f * 3^(1/13)       # one Bohlen-Pierce step above note 1
```

## See also

- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Operators](/reference/expressions/operators) — precedence and result types
- [Fraction API](/reference/expressions/fraction-api) — exact numbers
- [Dependencies](/user-guide/notes/dependencies) — dependency lines in the workspace
- [Dependency Graph](/developer/core/dependency-graph) — how the graph is built
