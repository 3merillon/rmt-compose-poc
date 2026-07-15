---
title: Expression Compiler
description: How RMT Compose turns a text expression into bytecode — DSL routing, the legacy parser, the opcode format, the LRU compile cache, and the two decompilers.
---

# Expression Compiler

Every note property in RMT Compose is stored as a **text expression**. Before it can be evaluated it is compiled to a compact **bytecode** that a stack VM executes. Nothing is ever passed to `eval()` or `new Function()`.

```
text → [ routing ] → DSL lexer → parser → compiler ──┐
                  └→ legacy parser → emitter ────────┴→ BinaryExpression (bytecode + deps)
```

Two source formats compile to **the same bytecode**:

| Format | Example | Where it lives |
|---|---|---|
| **DSL** (primary) | `base.f * (3/2)` | `src/dsl/` — lexer, parser, compiler, decompiler |
| Legacy method chain | `module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))` | `src/expression-compiler.js` |

Every shipped module JSON is DSL. The legacy parser exists so old modules still load.

## Entry point

`ExpressionCompiler.compile(textExpr, varName)` (`src/expression-compiler.js:53`) is the only door in. `Note._setExpression()` calls the module-level singleton `compiler` exported at `expression-compiler.js:1042`.

The routing is worth reading closely, because one of its branches can silently zero a note:

1. **Cache probe.** On a hit the key is deleted and re-inserted (an LRU touch) and a **clone** is returned (`:56-63`).
2. **`isDSLSyntax(textExpr)`** → `compileDSL()`. If the DSL compiler throws, it logs a warning and **falls through to the legacy parser** (`:66-75`).
3. **Legacy path** → `parse()` → `emitBytecode()`.
4. If the *legacy* parser throws, it **retries `compileDSL()`** (`:89-95`). The routing check in step 2 is a regex sniff, not a parse, so it can misclassify a DSL expression as legacy; without this retry the next step would zero the note.
5. If nothing parses, it emits a **constant `0`** with a `console.warn` (`:97-103`).

`compile()` always returns `binary.clone()`, never the cached instance.

::: danger The constant-0 fallback is silent
Step 5 does not throw. An expression the compiler cannot understand becomes `0` — a note's frequency drops to zero and the only trace is a console warning. This is reachable from real input: see [Known footgun](#known-footgun-1-f-becomes-0) below.
:::

## The compile cache

```javascript
const COMPILE_CACHE_MAX = 4000;  // src/expression-compiler.js:22
```

A plain `Map` keyed on the raw expression text, used as an **LRU**: `_cacheSet()` evicts `cache.keys().next().value` — the oldest insertion — when at cap and the key is new (`:34-41`). The cap exists because drag and resize commits mint a fresh fraction string on every commit, so an unbounded cache grows for the life of the session.

::: warning The cache is per-instance, not global
`src/note.js` uses the exported singleton, but `src/modals/validation.js`, `src/modals/variable-controls.js`, `src/modals/note-creation.js`, `src/utils/safe-expression-validator.js`, `src/utils/simplify.js` and `src/module-serializer.js` each construct their **own** `new ExpressionCompiler()`. That is seven independent 4000-entry caches in a running app. `clearCache()` only clears the one you call it on.
:::

## Format detection — `isDSLSyntax()`

`src/dsl/index.js:23-72`. Returns `false` for non-strings and blanks, then checks in this exact order:

1. **DSL** if any of: `^[N].`, `^base.`, a leading fraction literal `^(n/d)`, a leading `tempo(`/`measure(`/`beat(`, `[N].` anywhere, or `base.<lowercase>` anywhere.
2. **Legacy** if any of: `new Fraction(`, `module.getNoteById`, `module.baseNote`, `.getVariable(`, `.mul|.div|.add|.sub|.pow|.neg(`, `module.findTempo|findMeasureLength`.
3. **DSL** if the whole string is **reference-free arithmetic** — `/^[-+*\/^().\d\s]+$/`. This matches `263`, `2 * 263`, `(1/2) * 263`.
4. Otherwise **legacy** (the safe default).

Rule 3 is not cosmetic. The BaseNote's frequency references nothing — in the default module it is the literal `263` — so a reference-free edit to it is the common case. Legacy cannot spell infix arithmetic without `new Fraction(` or a `.mul()` chain, so routing it to the legacy parser makes it fail, and the failure path emits constant `0`. Confirmed against the legacy parser:

| Expression | Legacy parser yields |
|---|---|
| `2 * 263` | `const 0` |
| `789/2` | `const 0` |
| `526` | `const 526/1` — a bare number is the one case legacy handles |

Rule 3 sends all three to the DSL compiler instead. The rule is commented as such at `dsl/index.js:60-67` (that comment still says "octave arrows"; the arrows now fold their factor into the coefficient, so they write `526`, not `2 * 263` — but a user can type either into the `Raw:` box).

## The DSL pipeline

| File | Exports | Role |
|---|---|---|
| `src/dsl/lexer.js` | `tokenize(source)` | text → tokens. `#` starts a comment to end of line. |
| `src/dsl/parser.js` | `parse(tokens)` | recursive descent → AST. The grammar is written out verbatim at `parser.js:6-17`. |
| `src/dsl/ast.js` | `NodeType`, `collectDependencies`, `referencesBase` | node factories + AST walks |
| `src/dsl/compiler.js` | `compile(ast, sourceText)` | AST → `BinaryExpression` |
| `src/dsl/decompiler.js` | `decompile(binaryExpr)` | bytecode → DSL text |
| `src/dsl/constants.js` | `TokenType`, `PropertyMap`, `HelperFunctions`, `Precedence` | the tables |
| `src/dsl/errors.js` | `DSLLexerError`, `DSLParseError`, `DSLCompileError`, `ErrorMessages` | typed errors with a `userMessage` |
| `src/dsl/index.js` | `isDSLSyntax`, `compileDSL`, `decompileToDSL`, `validateDSL` | the public API |
| `src/dsl/simplify.js` | `simplifyDSL`, `scaleDSL` | DSL-native canonicaliser (see [SymbolicPower](/developer/core/symbolic-power)) |

`compileDSL('')` returns bytecode for the constant `0/1` rather than throwing (`dsl/index.js:84-92`).

### Properties

`src/dsl/constants.js:42-69`. These aliases and no others:

| Canonical | Accepted spellings | Canonical short form |
|---|---|---|
| `frequency` | `f`, `freq`, `frequency` | `f` |
| `startTime` | `t`, `s`, `start`, `startTime` | `t` |
| `duration` | `d`, `dur`, `duration` | `d` |
| `tempo` | `tempo` | `tempo` |
| `beatsPerMeasure` | `bpm`, `beatsPerMeasure` | `bpm` |
| `measureLength` | `ml`, `measureLength` | `ml` |

`[0].prop` is parsed as `base.prop` — note id 0 **is** the BaseNote (`parser.js:262-267`).

### Helper functions

Exactly three (`constants.js:86`), arity 1, and the argument must be a **bare note reference** — `[N]` or `base`, never an expression (`parser.js:308-358`).

| Call | Lowers to |
|---|---|
| `tempo(x)` | `LOAD_REF x, VAR.TEMPO` — byte-for-byte identical to `x.tempo` (`dsl/compiler.js:220-231`) |
| `measure(x)` | `LOAD_REF x, VAR.MEASURE_LENGTH` — identical to `x.ml` (`:237-248`) |
| `beat(x)` | `LOAD_CONST 60`, `tempo(x)`, `DIV` (`:254-261`) |

`beat(base)` is the idiomatic way to write one beat in seconds. Do not hand-write `60 / tempo(base)`.

## Bytecode format

`src/binary-note.js:9-32`:

```javascript
export const OP = {
  LOAD_CONST:      0x01,
  LOAD_REF:        0x02,
  LOAD_BASE:       0x03,
  LOAD_CONST_BIG:  0x04,

  ADD:             0x10,
  SUB:             0x11,
  MUL:             0x12,
  DIV:             0x13,
  NEG:             0x14,
  POW:             0x15,

  FIND_TEMPO:      0x20,   // dead — see below
  FIND_MEASURE:    0x21,   // dead
  FIND_INSTRUMENT: 0x22,   // dead

  DUP:             0x30,   // dead
  SWAP:            0x31,   // dead
};
```

::: warning `FIND_*`, `DUP` and `SWAP` are never emitted
No compiler produces them. The legacy `emitFindTempo` / `emitFindMeasure` (`expression-compiler.js:745-774`) lower to a plain `LOAD_BASE`/`LOAD_REF` with `VAR.TEMPO` or `VAR.MEASURE_LENGTH`, and the DSL compiler does the same. `FIND_TEMPO`, `FIND_MEASURE`, `DUP` and `SWAP` are implemented in the VM but unreachable from any compiled expression; `FIND_INSTRUMENT` is not even handled there. Treat them as reserved bytes.
:::

### Instruction encoding

```
LOAD_CONST      [0x01][num: i32 BE][den: i32 BE]                        9 bytes
LOAD_REF        [0x02][noteId: u16 BE][varIndex: u8]                    4 bytes
LOAD_BASE       [0x03][varIndex: u8]                                    2 bytes
LOAD_CONST_BIG  [0x04][sign: u8][numLen: u16][num…][denLen: u16][den…]  variable

ADD SUB MUL DIV NEG POW                                                 1 byte
```

Operands are pushed **before** the opcode — it is a stack machine, nothing nests.

### Variable indices

The export is `VAR`, with a `VAR_NAMES` reverse map (`binary-note.js:35-52`):

```javascript
export const VAR = {
  START_TIME: 0,
  DURATION: 1,
  FREQUENCY: 2,
  TEMPO: 3,
  BEATS_PER_MEASURE: 4,
  MEASURE_LENGTH: 5,
};
```

### Constant emission

`emitConstant()` (`expression-compiler.js:648`) and `emitFraction()` (`dsl/compiler.js:86-113`) both GCD-normalise the fraction, move the sign to the numerator, then pick the opcode by magnitude: `LOAD_CONST` if numerator and denominator both fit in i32 (`-2147483648 … 2147483647`), otherwise `LOAD_CONST_BIG`. There is no `constBig` AST node — the choice is made at emit time.

::: info `LOAD_CONST_BIG` carries BigInts, but they do not survive
The evaluator immediately downcasts: `new Fraction(numBig.toString(), denBig.toString())` (`binary-evaluator.js:914`), and `fraction.js@4.3.7` stores `n`/`d` as JS **doubles**. The big encoding preserves the *bytecode*, not the precision.
:::

## `BinaryExpression`

`binary-note.js:77-315`. `new BinaryExpression(initialSize = 64)` — the constructor takes a **byte count**, not a buffer.

| Field | Type | Notes |
|---|---|---|
| `bytecode` | `Uint8Array` | starts at 64 bytes, doubles on demand |
| `length` | number | bytes written |
| `dependencies` | `Uint16Array` | starts at 16 entries, doubles |
| `depCount` | number | |
| `sourceText` | string | the original text, kept for round-trip |
| `referencesBase` | boolean | set by `LOAD_BASE` emission |

Key methods: `addDependency()`, `getDependencySet()`, `getPropertyDependencies()` (scans the bytecode into a `Map<noteId, Set<varIndex>>` — this is where the [dependency graph](/developer/core/dependency-graph) gets its property-level edges), `referencesProperty()`, `isEmpty()`, `clone()`.

A `LOAD_BASE` does **not** add note 0 as a dependency. Recording it would give the BaseNote a self-cycle; the `referencesBase` flag is tracked separately instead (comments at `expression-compiler.js:725-728`).

## The legacy parser

There is no lexer and no position cursor. `parse()` is a recursive **string splitter**:

```
parse(expr)
  └ splitAddSub    → sum    { terms: [{ sign, node }] }
      └ parseProduct
          └ splitMulDiv → product { base, operations: [{ op, node }] }
          └ splitPow    → power   { base, exponent }
              └ parseAtomic
```

`parseAtomic` (`expression-compiler.js:167-313`) regex-matches, in order: `new Fraction(n[, d])`, `module.baseNote.getVariable('x')`, `module.getNoteById(N).getVariable('x')`, `module.findTempo(ref)`, `module.findMeasureLength(ref)`, the beat pattern `new Fraction(60).div(module.findTempo(ref))`, a bare number, a `.pow()` chain, a `new Fraction(...).mul(...)` chain, a bare variable name — and if none match, it **returns `{type: 'const', num: 0, den: 1}` without throwing** (`:310-312`).

The legacy AST node types (`emitBytecode`, `:593-641`):

```javascript
{ type: 'const',       num, den }
{ type: 'baseRef',     varName }
{ type: 'noteRef',     noteId, varName }
{ type: 'findTempo',   ref }              // ref = {kind:'base'} | {kind:'note', id}
{ type: 'findMeasure', ref }
{ type: 'beatUnit',    ref }
{ type: 'sum',         terms:      [{ sign, node }] }
{ type: 'product',     base, operations: [{ op, node }] }
{ type: 'power',       base, exponent }
```

The DSL AST is a different set entirely (`src/dsl/ast.js`).

## Decompilers

There are two, and they are not interchangeable.

| Class | Singleton | Emits |
|---|---|---|
| `ExpressionDecompiler` (`expression-compiler.js:844`) | `decompiler` | **legacy** method-chain text |
| `DSLExpressionDecompiler` (`:1051`) | `dslDecompiler` | **DSL** text (delegates to `decompileToDSL`) |

`ExpressionDecompiler.decompile()` **returns `binary.sourceText` verbatim if it is set** (`:852-855`), so for anything compiled from text it is a pass-through; its stack-based path only runs for synthesised expressions.

The DSL decompiler (`src/dsl/decompiler.js`) is a stack machine over the bytecode that re-emits DSL, inserting parentheses from the `Precedence` table, printing fractions as `(n/d)` and integers bare. It pattern-matches `60 / <ref>.tempo` back into `beat(<ref>)` (`:112-119`, `:236-240`).

The note widget's `Raw:` box always shows DSL: `convertToDSLDisplay()` decompiles the note's compiled bytecode regardless of the stored format (`src/modals/variable-controls.js:87-101`).

### Round-trip is lossy in specific, harmless ways

| You type | It is saved as |
|---|---|
| `tempo(base)` | `base.tempo` |
| `measure([2])` | `[2].ml` |
| `beat(base) * (1/4)` | `beat(base) * (1/4)` — survives |
| `base.freq`, `base.s`, `base.dur` | `base.f`, `base.t`, `base.d` |
| `[0].f` | `base.f` |
| `0.5 * base.f` | `(1/2) * base.f` |
| `3.14159` | `(9563/3044)` |
| `base.f # a comment` | `base.f` — comments are dropped |
| `2^-1` | `2^(-1)` |

`tempo()` and `measure()` are **write-only sugar**: they compile to the same bytecode as the property form and never come back. `beat()` is the only helper the decompiler reconstructs.

## Validation

The compiler is not the validator. It warns and degrades; validation is a separate gate.

| Gate | Where | What it does |
|---|---|---|
| UI edits | `validateExpression()`, `src/modals/validation.js:13` | self-reference check, `validateDSL()`, circular-dependency BFS, then `compileDSL()` to prove it yields bytecode |
| DSL syntax | `validateDSL()`, `src/dsl/index.js:142` | tokenize + parse; returns `{valid, error}` with `error` = the `DSLError.userMessage` |
| JSON import | `validateExpressionSyntax()`, `src/utils/safe-expression-validator.js:30` | rejects strings over 10 000 chars and a blocklist (`eval(`, `Function(`, `import(`, `document.`, `__proto__`, `<script`, …) |

Nothing anywhere calls `eval()` or `new Function()` on an expression.

::: warning Errors never reach the screen
The `Save` handler catches validation errors and only does `console.error(...)` — there is no alert, no inline message, no red border (`src/modals/variable-controls.js:1375-1377`). The error strings in `src/dsl/errors.js` are user-grade and go nowhere but the console.
:::

## Worked example

Input (DSL):

```
[1].f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

Bytecode (verified against the real compiler):

```
0x02 0x00 0x01 0x02                        LOAD_REF  note=1, var=2 (frequency)
0x01 0x00 0x00 0x00 0x03 0x00 0x00 0x00 0x02   LOAD_CONST 3/2
0x12                                       MUL
```

`dependencies = [1]`, `referencesBase = false`, `getPropertyDependencies() = {1 → {2}}`.

Decompiled with `decompileToDSL()`: `[1].f * (3/2)` — exact round-trip.

## Known footgun: `[1]f` becomes `0`

Omit the dot and the note silently evaluates to zero. Confirmed by running the real compiler:

```
isDSLSyntax('[1]f')  → false     // the DSL regexes all require `[N].`
  → legacy parser
  → parseAtomic falls through to `{const 0}` WITHOUT throwing  (expression-compiler.js:310-312)
  → the DSL-retry in compile()'s catch block never runs, because nothing threw
  → bytecode: LOAD_CONST 0/1  → the note's frequency is 0
```

Validation does not save you either: `modals/validation.js` sees a valid, reference-free expression and canonicalises it. Always include the dot.

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — the stack VM that runs this bytecode
- [Dependency Graph](/developer/core/dependency-graph) — what consumes `getPropertyDependencies()`
- [SymbolicPower](/developer/core/symbolic-power) — what `POW` does with an irrational result
- [Expression Syntax](/reference/expressions/syntax) — the user-facing reference
