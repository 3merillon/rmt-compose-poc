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
  operators, precedence, the removed `beat()` / `tempo()` / `measure()` forms, error behaviour
- [Operators](/reference/expressions/operators) — per-operator semantics and result types
- [Module API](/reference/expressions/module-api) — note references, the six properties and inheritance
- [Fraction API](/reference/expressions/fraction-api) — exact numbers

## Note properties

A note has six variables, in two groups. The first three are the **language**, the notation: each is
an exact relation to other notes, and the BaseNote holds the only absolute values. The last three are
**interpretation**: how the note sounds, not part of the notation.

The language:

- [frequency](/reference/properties/frequency) — pitch
- [startTime](/reference/properties/start-time) — when a note begins
- [duration](/reference/properties/duration) — how long it lasts; on the BaseNote it is the
  [time unit](/reference/properties/duration#the-time-unit), `base.d`

Interpretation:

- [amplitude](/reference/properties/amplitude) — loudness, as a relative gain
- [attack and release](/reference/properties/attack-release) — the envelope, as shares of the note's
  duration

There is no tempo or meter variable. A tempo is 60 / `base.d`, a read-only view; a meter is the
length of a [measure bar](/reference/module-schema#measure-bars).

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

`n` steps is `2^(n/12)`, `2^(n/19)`, and so on. All of these are irrational and kept exact, so a note using one
is drawn crosshatched (tempered, not a pure ratio); twelve 12-TET steps are exactly 2. See [Operators](/reference/expressions/operators).

### Note lengths

| Note | Time units | Expression |
|---|---|---|
| Whole | 4 | `base.d * 4` |
| Half | 2 | `base.d * 2` |
| Quarter | 1 | `base.d` |
| Eighth | 1/2 | `base.d * (1/2)` |
| Sixteenth | 1/4 | `base.d * (1/4)` |
| Dotted quarter | 3/2 | `base.d * (3/2)` |

`base.d` is the BaseNote's duration, the time unit: one beat, if you count in beats. It is what the
note-length buttons in the note widget write for you. The full table, including dotted values, is on
[duration](/reference/properties/duration#standard-note-values).

### Property shortnames

| Group | Property | Accepted spellings | Saved as |
|---|---|---|---|
| Language | frequency | `f`, `freq`, `frequency` | `f` |
| Language | startTime | `t`, `s`, `start`, `startTime` | `t` |
| Language | duration | `d`, `dur`, `duration` | `d` |
| Interpretation | amplitude | `a`, `amp`, `amplitude` | `a` |
| Interpretation | attack | `attack`, `atk` | `attack` |
| Interpretation | release | `release`, `rel` | `release` |

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

| Index | Variable | Group |
|---|---|---|
| 0 | startTime | language |
| 1 | duration | language |
| 2 | frequency | language |
| 3 | amplitude | interpretation |
| 4 | attack | interpretation |
| 5 | release | interpretation |

Indices 3 and up are the interpretation variables (`FIRST_INTERPRETATION_VAR` in
`src/binary-note.js`), and only those fall back to the BaseNote when unset.

### Corruption flags

A bitmask, one bit per property, recording which of a note's values are tempered or approximate (an irrational power, a `~` number, a fallback).

| Flag | Property |
|---|---|
| `0x01` | startTime |
| `0x02` | duration |
| `0x04` | frequency |
| `0x08` | amplitude |
| `0x10` | attack |
| `0x20` | release |

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
| `FIND_TEMPO` | `0x20` | Retired with the tempo variable; not reused |
| `FIND_MEASURE` | `0x21` | Retired with the measure-length variable; not reused |
| `FIND_INSTRUMENT` | `0x22` | Defined, **never emitted**, not implemented in the evaluator |
| `DUP` | `0x30` | Defined, **never emitted** |
| `SWAP` | `0x31` | Defined, **never emitted** |

The language has no functions, so nothing compiles to a call. A reference such as `base.d` is a
plain `LOAD_BASE` of variable index 1.

### Fallbacks and limits

| Thing | Value |
|---|---|
| Value used when a reference cannot be resolved | startTime 0, duration 1, frequency 440, amplitude 1, attack 0, release 0 |
| Division by zero at evaluation time | Result 1, plus a console warning; the property is flagged corrupted (crosshatch) |
| An expression the compiler cannot parse | Compile error — `console.error` plus a thrown message; validators return `valid: false`; on a file load the note's property is left unset |
| Decimal → fraction | Exact as written — the digits over the matching power of ten, reduced (`0.333333` is `333333/1000000`) |
| Constant fits `LOAD_CONST` when both parts are within | −2 147 483 648 to 2 147 483 647 (bigger constants use `LOAD_CONST_BIG`, exact at any size) |
| Note id in a reference | 0 – 65 535, enforced when the expression compiles |
| Exact `^` caps | Integer exponent ≤ 65 536 and result ≤ ~1 Mbit per component; past either, the value is approximate and flagged corrupted |
| Maximum expression length accepted on import | 10 000 characters |
| Compiled-expression cache | 4 000 entries, least-recently-used eviction |

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — how the bytecode runs
- [Expression Compiler](/developer/core/expression-compiler) — how text becomes bytecode
- [Dependency Graph](/developer/core/dependency-graph) — how references become edges
