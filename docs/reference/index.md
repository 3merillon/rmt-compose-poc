---
title: Reference
description: Reference documentation for RMT Compose — the expression language, note properties, the module JSON format, and the internal bytecode.
---

# Reference

Exhaustive documentation for the expression language, note properties, and file formats. If you
are looking for how to *do* something, start with the [User Guide](/user-guide/). This section
tells you what is true.

## Expression language

- [Syntax](/reference/expressions/syntax) — the complete grammar: tokens, literals, references,
  functions, operators, precedence, error behaviour
- [Operators](/reference/expressions/operators) — per-operator semantics and result types
- [Module API](/reference/expressions/module-api) — note references and built-in functions
- [Fraction API](/reference/expressions/fraction-api) — exact numbers, and the legacy
  `new Fraction()` compatibility surface

## Note properties

- [frequency](/reference/properties/frequency) — pitch
- [startTime](/reference/properties/start-time) — when a note begins
- [duration](/reference/properties/duration) — how long it lasts
- [tempo](/reference/properties/tempo) — beats per minute
- [beatsPerMeasure](/reference/properties/beats-per-measure) — meter

The sixth property, `measureLength`, has no page of its own: it is derived from `tempo` and
`beatsPerMeasure` and has no UI. It is covered under
[tempo](/reference/properties/tempo#tempo-and-measure-length).

## Formats

- [Module JSON Schema](/reference/module-schema) — the saved-module format
- [Settings Reference](/reference/settings-reference) — every setting, its default and its range
- [Glossary](/reference/glossary) — term definitions

## Quick reference

The exhaustive tables live on the pages that own them. These are the ones you look up most.

- **Just-intonation ratios** — the interval-to-expression table is on
  [frequency](/reference/properties/frequency#just-intonation-ratios). For the musical reasoning,
  see [Pure Ratios](/user-guide/tuning/ratios).

### Equal-temperament steps

| System | One step | Value |
|---|---|---|
| 12-TET | `2^(1/12)` | ≈ 1.059463 |
| 19-TET | `2^(1/19)` | ≈ 1.037155 |
| 31-TET | `2^(1/31)` | ≈ 1.022611 |
| Bohlen-Pierce (13 divisions of the tritave) | `3^(1/13)` | ≈ 1.088182 |

`n` steps is `2^(n/12)`, `2^(n/19)`, and so on. All of these are irrational, so a note using one
is flagged corrupted and drawn crosshatched. See [Operators](/reference/expressions/operators).

### Note lengths

| Note | Beats | Expression |
|---|---|---|
| Whole | 4 | `beat(base) * 4` |
| Half | 2 | `beat(base) * 2` |
| Quarter | 1 | `beat(base)` |
| Eighth | 1/2 | `beat(base) * (1/2)` |
| Sixteenth | 1/4 | `beat(base) * (1/4)` |
| Dotted quarter | 3/2 | `beat(base) * (3/2)` |

`beat(x)` is one beat of `x` in seconds — that is, `60 / tempo(x)`. It is what the note-length
buttons in the note widget write for you. The full table, including dotted values, is on
[duration](/reference/properties/duration#standard-note-values).

### Property shortnames

| Property | Accepted spellings | Saved as |
|---|---|---|
| frequency | `f`, `freq`, `frequency` | `f` |
| startTime | `t`, `s`, `start`, `startTime` | `t` |
| duration | `d`, `dur`, `duration` | `d` |
| tempo | `tempo` | `tempo` |
| beatsPerMeasure | `bpm`, `beatsPerMeasure` | `bpm` |
| measureLength | `ml`, `measureLength` | `ml` |

### Keyboard shortcuts

| Action | Windows/Linux | Mac |
|---|---|---|
| Undo | Ctrl+Z | Cmd+Z |
| Redo | Ctrl+Y | Cmd+Y |

Both are ignored while the focus is in a text field, so they never fight with editing an
expression.

### Pointer gestures

| Action | Gesture |
|---|---|
| Marquee-select notes | Shift + drag on empty background |
| Add or remove one note from the selection | Shift + click the note |
| Loop playback | Shift + click **Play** |

See [Keyboard Shortcuts](/user-guide/interface/keyboard-shortcuts) for the full list.

## Internals

These are implementation details. You do not need them to use the app, but they are stable and
they are what the file format and the evaluator agree on.

### Variable indices

| Index | Property |
|---|---|
| 0 | startTime |
| 1 | duration |
| 2 | frequency |
| 3 | tempo |
| 4 | beatsPerMeasure |
| 5 | measureLength |

### Corruption flags

A bitmask, one bit per property, recording which of a note's values came out irrational.

| Flag | Property |
|---|---|
| `0x01` | startTime |
| `0x02` | duration |
| `0x04` | frequency |
| `0x08` | tempo |
| `0x10` | beatsPerMeasure |
| `0x20` | measureLength |

### Bytecode opcodes

| Opcode | Byte | Effect |
|---|---|---|
| `LOAD_CONST` | `0x01` | Push a constant fraction (two 32-bit integers) |
| `LOAD_REF` | `0x02` | Push a property of note N (16-bit id, 8-bit variable index) |
| `LOAD_BASE` | `0x03` | Push a property of the BaseNote (8-bit variable index) |
| `LOAD_CONST_BIG` | `0x04` | Push a constant fraction with arbitrary-precision parts |
| `ADD` | `0x10` | Pop 2, push sum |
| `SUB` | `0x11` | Pop 2, push difference |
| `MUL` | `0x12` | Pop 2, push product |
| `DIV` | `0x13` | Pop 2, push quotient |
| `NEG` | `0x14` | Pop 1, push negation |
| `POW` | `0x15` | Pop base and exponent, push the power; may set a corruption flag |
| `FIND_TEMPO` | `0x20` | Defined, **never emitted** |
| `FIND_MEASURE` | `0x21` | Defined, **never emitted** |
| `FIND_INSTRUMENT` | `0x22` | Defined, **never emitted**, not implemented in the evaluator |
| `DUP` | `0x30` | Defined, **never emitted** |
| `SWAP` | `0x31` | Defined, **never emitted** |

`tempo(x)` and `measure(x)` compile to a plain property load, not to `FIND_TEMPO` /
`FIND_MEASURE`. `beat(x)` compiles to `LOAD_CONST 60`, a tempo load, then `DIV`.

### Fallbacks and limits

| Thing | Value |
|---|---|
| Value used when a reference cannot be resolved | startTime 0, duration 1, frequency 440, tempo 60, beatsPerMeasure 4, measureLength 4 |
| Division by zero at evaluation time | Result 1, plus a console warning; the property is flagged corrupted (crosshatch) |
| An expression neither compiler can parse | Compile error — `console.error` plus a thrown message naming both parser failures; validators return `valid: false`; on a file load the note's property is left unset |
| Decimal → fraction, largest denominator | 10 000 |
| Constant fits `LOAD_CONST` when both parts are within | −2 147 483 648 to 2 147 483 647 |
| Maximum expression length accepted on import | 10 000 characters |
| Compiled-expression cache | 4 000 entries, least-recently-used eviction |

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — how the bytecode runs
- [Expression Compiler](/developer/core/expression-compiler) — how text becomes bytecode
- [Dependency Graph](/developer/core/dependency-graph) — how references become edges
