---
title: BinaryExpression Class
description: Reference for BinaryExpression in src/binary-note.js — the compiled bytecode container, the exact instruction encoding, compilation and decompilation.
---

# BinaryExpression Class

`BinaryExpression` (`src/binary-note.js`) is the compiled form of one note property. It holds a
bytecode buffer, an explicit list of the note ids the expression references, and the original
source text.

An expression like

```
base.f * (3/2)
```

compiles to **12 bytes**, which the stack VM in `src/binary-evaluator.js` runs with exact rational
arithmetic. Nothing in this pipeline uses `eval()` or `new Function()`.

```javascript
import { BinaryExpression, OP, VAR, VAR_NAMES, CORRUPT, getCorruptionFlag } from './binary-note.js'
```

## Constructor

```javascript
const expr = new BinaryExpression(initialSize = 64)
```

Creates an empty expression with a 64-byte bytecode buffer (it doubles as needed). You rarely
build one by hand — the compilers do it. A note's unset variables share one frozen empty
expression, `EMPTY_EXPRESSION` (`src/binary-note.js:442-450`); its `clone()` is an ordinary, writable
one.

## Properties

| Property | Type | Notes |
|---|---|---|
| `bytecode` | `Uint8Array` | The instruction stream. Capacity, not content — read only the first `length` bytes. |
| `length` | `number` | Bytes actually used. |
| `dependencies` | `Uint32Array` | Note ids referenced by `LOAD_REF` and `LOAD_REF_WIDE`. Initial capacity 16, doubles. |
| `depCount` | `number` | Entries used in `dependencies`. |
| `sourceText` | `string` | The original text, verbatim and untrimmed. `''` for a synthesised expression. |
| `referencesBase` | `boolean` | True when the expression contains a `LOAD_BASE`. |

::: info The BaseNote is never a dependency
`base.f` emits `LOAD_BASE` and sets `referencesBase`; it does **not** add `0` to `dependencies`.
An explicit edge to note 0 would make the BaseNote a cycle in the graph. The evaluator does not
need the edge: it orders by [`getVariableRefs()`](#getvariablerefs), where `base.f` is simply a read
of the BaseNote's frequency.
:::

## Methods

### isEmpty()

```javascript
expr.isEmpty()  // → boolean — true when length === 0
```

An unset note property is an *empty* expression, not a missing one. This is the check that
distinguishes notes from silences from measures.

### clear()

```javascript
expr.clear()  // resets length, depCount, sourceText, referencesBase
```

### clone()

```javascript
const copy = expr.clone()
```

Deep copy. `ExpressionCompiler.compile()` always hands back a clone, never the cached instance.

The clone's `dependencies` array starts at the default capacity of 16 but is regrown from
`this.depCount` when the original tracks more — an expression referencing 17 or more distinct
notes clones (and therefore compiles) correctly.

### addDependency()

```javascript
expr.addDependency(noteId)
```

Appends a note id if it is not already tracked. Called by the compilers when they emit a `LOAD_REF`.

### getDependencySet()

```javascript
expr.getDependencySet()  // → Set<number>
```

### getPropertyDependencies()

```javascript
compileDSL('[1].t + [1].d').getPropertyDependencies()
// → Map(1) { 1 => Set(2) { 0, 1 } }
```

Scans the bytecode for `LOAD_REF` and returns **`Map<noteId, Set<varIndex>>`** — the values are
sets of numeric variable indices (0-5), not property names. BaseNote reads do not appear.

### referencesProperty()

```javascript
expr.referencesProperty(1, VAR.FREQUENCY)  // → boolean
```

Convenience wrapper over `getPropertyDependencies()`. Always `false` for `noteId === 0`, for the
reason above.

### getVariableRefs()

```javascript
expr.getVariableRefs()  // → number[]
```

Every (note, variable) the expression reads, in order of first appearance, each packed as
`(noteId << 3) | varIndex`. Unlike `getPropertyDependencies()` it **includes BaseNote reads**, as
note 0: `(3/2) * [2].f + base.t` gives `[(2 << 3) | 2, 0]`. Evaluation order and cycle checks are
built on it. The array is decoded once and cached on the expression — treat it as read-only.

### Writer methods

Used by the compilers; you need these only if you emit bytecode yourself.

| Method | Writes |
|---|---|
| `ensureCapacity(n)` | grows the buffer if `n` more bytes will not fit |
| `writeByte(v)` | 1 byte |
| `writeUint16(v)` | 2 bytes, big-endian |
| `writeUint32(v)` | 4 bytes, big-endian |
| `writeInt32(v)` | 4 bytes, big-endian, signed |
| `writeBigIntSigned(v)` | `[sign(1)][len(2)][bytes]` |
| `writeBigIntUnsigned(v)` | `[len(2)][bytes]`; throws above 65535 bytes |

## Bytecode format

### Opcodes

| Opcode | Byte | Operand bytes | Stack effect |
|---|---|---|---|
| `LOAD_CONST` | `0x01` | 8 — i32 num, i32 den | → fraction |
| `LOAD_REF` | `0x02` | 3 — u16 noteId, u8 varIndex | → note property |
| `LOAD_BASE` | `0x03` | 1 — u8 varIndex | → BaseNote property |
| `LOAD_CONST_BIG` | `0x04` | variable (see below) | → big fraction |
| `LOAD_REF_WIDE` | `0x05` | 5 — u32 noteId, u8 varIndex | → note property |
| `ADD` | `0x10` | — | a, b → a+b |
| `SUB` | `0x11` | — | a, b → a−b |
| `MUL` | `0x12` | — | a, b → a×b |
| `DIV` | `0x13` | — | a, b → a÷b |
| `NEG` | `0x14` | — | a → −a |
| `POW` | `0x15` | — | a, b → a^b (may corrupt) |

`OP` also declares `FIND_INSTRUMENT` (`0x22`), `DUP` (`0x30`) and `SWAP` (`0x31`). **No compiler
emits any of them.** `FIND_INSTRUMENT` is not even handled by the VM. Treat all three as reserved.

::: warning Removed: FIND_TEMPO and FIND_MEASURE
The opcodes `FIND_TEMPO` (`0x20`) and `FIND_MEASURE` (`0x21`) are retired together with the tempo
and measure-length variables. They are no longer in `OP`, and `src/binary-note.js` says not to
reuse the two byte values.
:::

### Variable indices

`VAR` (and its reverse map `VAR_NAMES`) are exported constants:

| Index | `VAR` name | Variable | Kind |
|---|---|---|---|
| 0 | `START_TIME` | `startTime` | language |
| 1 | `DURATION` | `duration` | language |
| 2 | `FREQUENCY` | `frequency` | language |
| 3 | `AMPLITUDE` | `amplitude` | interpretation |
| 4 | `ATTACK` | `attack` | interpretation |
| 5 | `RELEASE` | `release` | interpretation |

`FIRST_INTERPRETATION_VAR` is `VAR.AMPLITUDE` (3). Indices below it relate a note to other notes;
indices from it up interpret the note when it sounds, and **only those fall back to the BaseNote**
when the note does not define them (`src/variable-deps.js` resolves inheritance for indices
`>= FIRST_INTERPRETATION_VAR` and nothing else). The variables `tempo`, `beatsPerMeasure` and
`measureLength` that held indices 3 to 5 before are removed; the indices were reused for amplitude,
attack and release.

### Instruction encoding

```
LOAD_CONST      01 [num:i32 BE] [den:i32 BE]
                   └─ 4 bytes ─┘└─ 4 bytes ─┘        no sign byte: the ints are signed

LOAD_REF        02 [noteId:u16 BE] [varIndex:u8]
                   └─ 2 bytes ───┘└─ 1 byte ──┘

LOAD_REF_WIDE   05 [noteId:u32 BE] [varIndex:u8]
                   └─ 4 bytes ───┘└─ 1 byte ──┘

LOAD_BASE       03 [varIndex:u8]

LOAD_CONST_BIG  04 [sign:u8] [numLen:u16] [num bytes…] [denLen:u16] [den bytes…]
                   0=pos 1=neg
```

Constants are GCD-normalised and the sign moved to the numerator before emission. `LOAD_CONST_BIG`
is used only when the numerator or denominator falls outside the i32 range
(−2 147 483 648 … 2 147 483 647) — which happens with exact ratios that have very large terms.

`LOAD_REF` encodes the id as a `u16`, for ids up to 65535. `LOAD_REF_WIDE` encodes it as a `u32`,
for ids 65536 to 16,777,215. The DSL compiler writes the 2-byte form whenever the id fits, so a
module whose ids fit compiles to the same bytecode as before. `dependencies` is a `Uint32Array`.

`MAX_NOTE_ID` (`0xFFFFFF`, 16,777,215, exported from `src/binary-note.js`) is the largest id a note
can have. The renderer's picking draws each id in 24 bits of colour, and 2^24 − 1 is also the
largest integer a float32 vertex attribute holds exactly. `Module.loadFromJSON()` rejects (skips,
with a console warning) any note whose id is outside `0 … MAX_NOTE_ID`. The DSL parser enforces the
same range at compile time — `[16777216].f` is a parse error (`src/dsl/parser.js:283-284`), and so is
`module.getNoteById(16777216)` in the converter of the retired method-chain syntax — so an id can
never wrap.

## Worked example

`base.f * (3/2)` — 12 bytes:

```
Offset  Bytes         Instruction
0x00    03            LOAD_BASE
0x01    02            varIndex 2 (frequency)
0x02    01            LOAD_CONST
0x03    00 00 00 03   numerator = 3
0x07    00 00 00 02   denominator = 2
0x0B    12            MUL

Stack:
  LOAD_BASE  → [263]
  LOAD_CONST → [263, 3/2]
  MUL        → [394.5]
```

`[1].t + [1].d` — 9 bytes:

```
0x00    02 00 01 00   LOAD_REF note 1, varIndex 0 (startTime)
0x04    02 00 01 01   LOAD_REF note 1, varIndex 1 (duration)
0x08    10            ADD
```

`base.d` — 2 bytes, the time unit (what `beat(base)` used to be):

```
0x00    03 01         LOAD_BASE varIndex 1 (duration)
```

`base.d * 4` — 12 bytes, the length of a four-unit measure bar:

```
0x00    03 01                        LOAD_BASE varIndex 1 (duration)
0x02    01 00 00 00 04 00 00 00 01   LOAD_CONST 4/1
0x0B    12                           MUL
```

## Corruption flags

A property whose own expression makes a value that is not an exact rational marks it as
**corrupted**: a `POW` with an irrational result (`2^(1/12)`, kept exact — see
[Exact Values](/developer/core/symbolic-power)), a `~` number, a division by zero, or a fallback
of the exact algebra to an approximation. The bitmask lives in the same file:

| Flag | Value |
|---|---|
| `CORRUPT.START_TIME` | `0x01` |
| `CORRUPT.DURATION` | `0x02` |
| `CORRUPT.FREQUENCY` | `0x04` |
| `CORRUPT.AMPLITUDE` | `0x08` |
| `CORRUPT.ATTACK` | `0x10` |
| `CORRUPT.RELEASE` | `0x20` |

```javascript
getCorruptionFlag(VAR.FREQUENCY)  // → 4, i.e. 1 << varIndex
```

`evaluateVariable()` ORs the flag for whichever property was being evaluated when such a value
appeared, and returns it as `corruptionFlags` on the evaluated record. `Module.evaluateModule()`
forwards those into the dependency graph, which is what lets the renderer hatch directly-corrupted
notes and, through `isFrequencyTransitivelyCorrupted()`, their descendants.

A power with an exact result is **not** corrupt: `4^(1/2)` evaluates to a rational 2 and the note
stays clean.

## Compilation

```javascript
import { compiler } from './expression-compiler.js'

const expr = compiler.compile('base.f * (3/2)')
```

`compiler` is the shared `ExpressionCompiler` singleton — there is no bare `compile()` export.
`compile(text)`:

1. Checks its LRU cache (`COMPILE_CACHE_MAX = 4000`, keyed on the raw text) and returns a **clone**
   on a hit.
2. Refuses text in the retired method-chain syntax, with its DSL form in the message (modules in
   that syntax are converted when they load; see
   [Expression Compiler](/developer/core/expression-compiler#the-retired-method-chain-syntax)).
3. Compiles with `compileDSL()`, which **throws** a `DSLError` on a syntax error — there is no
   constant-0 fallback.

To compile DSL directly, without the cache:

```javascript
import { compileDSL, validateDSL } from './dsl/index.js'

const expr = compileDSL('[1].f * 2^(7/12)')
```

The pipeline is lexer → parser → compiler (`src/dsl/`), producing the AST node types in
`src/dsl/ast.js`.

## Decompilation

```javascript
import { decompiler } from './expression-compiler.js'
import { decompileToDSL } from './dsl/index.js'

decompiler.decompile(expr)   // sourceText verbatim if present, else decompileToDSL(expr)
decompileToDSL(expr)         // always walks the bytecode, always emits DSL
```

`ExpressionDecompiler.decompile()` short-circuits on `sourceText` (`src/expression-compiler.js:80`),
so for anything compiled from text it is a pass-through. A synthesised expression (empty
`sourceText`) is decompiled to DSL.

`decompileToDSL()` prints each `LOAD_REF` / `LOAD_BASE` as a property access (`base.d`, `[2].f`).
The DSL has no functions, so there is nothing to reconstruct beyond the six variables.

## Error handling

`compiler.compile()` **throws** on an unparseable expression: the `DSLError` of the DSL parser, or
the retired-syntax refusal. Callers that can show the message do (the note widget's inline error,
the validators); load paths catch per-note and leave the property unset rather than zeroing it.

The DSL layer *does* throw, with its own error classes (`src/dsl/errors.js`) — `DSLError` and its
subclasses `DSLLexerError`, `DSLParseError`, `DSLCompileError`. Each carries a `position` and a
`userMessage` getter, plus `formatWithContext(source)` for a caret-annotated dump.

```javascript
import { compileDSL, validateDSL } from './dsl/index.js'
import { DSLError } from './dsl/errors.js'

validateDSL('[1].t +')
// → { valid: false, error: "Unexpected '', expected expression (at column 8)" }

try {
  compileDSL('base.z')   // throws DSLParseError
} catch (e) {
  if (e instanceof DSLError) console.error(e.formatWithContext('base.z'))
}
// Unknown property 'z'. Valid properties: f (frequency), t (startTime), d (duration), a (amplitude), attack, release (at column 6)
//
// base.z
//      ^
```

Validate before you compile if you want a structured `{ valid, error }` result rather than a
thrown `Error`.

The names of the old time model are refused with a message that names the replacement. `beat()`,
`tempo()` and `measure()` are not functions any more (the DSL has no functions), and `.tempo`,
`.bpm`, `.beatsPerMeasure`, `.ml` and `.measureLength` are not properties:

```javascript
validateDSL('beat(base)')
// → { valid: false, error: "'beat()' was removed: the reference note's duration is the time unit, so write base.d for beat(base), or [N].d to relate to note N (at column 1)" }
```

## Performance

No numbers are quoted here on purpose. Measure them:

```bash
npm run perf:bench     # scripts/perf/bench-node.mjs
```

## The other two classes in this file

`src/binary-note.js` also exports `BinaryNote` (six `BinaryExpression`s plus cached values) and
`BinaryModule` (a `Map` of them). **Neither is on the live path** — nothing imports them (their
last consumer, the dead `src/module-serializer.js`, has been deleted from the repo). The live
containers are `Note` and `Module`. Do not build against them without checking that first.

## See also

- [Expression Compiler](/developer/core/expression-compiler) — the DSL pipeline, the cache, the retired syntax
- [Binary Evaluator](/developer/core/binary-evaluator) — the stack VM, `POW`, and the fallback defaults
- [Note Class](/developer/api/note) — the owner of six of these
- [Expression Syntax](/reference/expressions/syntax) — the DSL grammar
