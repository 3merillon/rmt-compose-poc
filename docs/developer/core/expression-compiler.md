---
title: Expression Compiler
description: How RMT Compose turns a text expression into bytecode — the DSL pipeline, the opcode format, the LRU compile cache, the decompiler, and the load-time conversion of the retired method-chain syntax.
---

# Expression Compiler

Every note property in RMT Compose is stored as a **text expression**. Before it can be evaluated it is compiled to a compact **bytecode** that a stack VM executes. Nothing is ever passed to `eval()` or `new Function()`.

```
text → DSL lexer → parser → compiler → BinaryExpression (bytecode + deps)
```

There is **one** expression language, the DSL (`base.f * (3/2)`, `[1].t + [1].d`, `src/dsl/`). Every shipped module JSON is DSL.

Older modules can hold two retired forms, and both are converted on load, before anything is compiled, by `Module.loadFromJSON()`:

1. the old time model (tempo, beats per measure, `beat()`, `measure()`, `module.findTempo` chains): `migrateTimeModel()` (`src/migrate/relational-time.js`) rewrites it as relations of `base.d`;
2. then the method-chain syntax (`module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))`): `migrateSyntax()` (`src/migrate/legacy-syntax.js`) rewrites it as DSL. See [The retired method-chain syntax](#the-retired-method-chain-syntax) below and [Module System](/developer/architecture/module-system#loading-old-modules).

An expression relates a note to other notes through **six variables** (`VAR`, see [below](#variable-indices)): `startTime`, `duration` and `frequency`, and the interpretation variables `amplitude`, `attack` and `release`. The DSL has no functions.

## Entry point

`ExpressionCompiler.compile(textExpr)` (`src/expression-compiler.js:45`) is the app's door in. `Note._setExpression()`, the validators and the editor all use the module-level singleton `compiler` (`src/expression-compiler.js:79`).

1. **Cache probe.** On a hit the key is deleted and re-inserted (an LRU touch) and a **clone** is returned.
2. **Retired syntax.** Text that carries a method-chain marker (`new Fraction(`, `module.`, `.getVariable(`, `.mul(` …, or a bare variable name such as `frequency`; `isLegacyExpression()`, `src/migrate/legacy-syntax.js:57`) is refused (`src/expression-compiler.js:53`) with `The method-chain syntax was retired; write expressions in the DSL, e.g. [3].f * (3/2). In the DSL this reads: …`, the last sentence giving the converter's DSL form of what was typed when it has one. Loaded modules never reach this: they were converted before compiling.
3. **`compileDSL()`**, which throws a `DSLError` with a `userMessage` on a syntax error. There is no constant-0 fallback: interactive callers (the note widget's Save, the validators) surface the message, while the load paths catch per note and leave the property unset.

`compile()` always returns `binary.clone()`, never the cached instance.

## The compile cache

```javascript
const COMPILE_CACHE_MAX = 4000;  // src/expression-compiler.js:22
```

A plain `Map` keyed on the raw expression text, used as an **LRU**: when it is full, the oldest insertion (`cache.keys().next().value`) is evicted. The cap exists because drag and resize commits mint a fresh fraction string on every commit, so an unbounded cache grows for the life of the session. There is one cache, the singleton's; the validators and the simplifier use the singleton too, or `compileDSL()` directly, which does not cache.

## The DSL pipeline

| File | Exports | Role |
|---|---|---|
| `src/dsl/lexer.js` | `tokenize(source)` | text → tokens. `#` starts a comment to end of line. |
| `src/dsl/parser.js` | `parse(tokens)` | recursive descent → AST. The grammar is written out verbatim at `src/dsl/parser.js:6-18`. |
| `src/dsl/ast.js` | `NodeType`, `collectDependencies`, `referencesBase` | node factories + AST walks |
| `src/dsl/compiler.js` | `compile(ast, sourceText)` | AST → `BinaryExpression` |
| `src/dsl/decompiler.js` | `decompile(binaryExpr)` | bytecode → DSL text |
| `src/dsl/constants.js` | `TokenType`, `PropertyMap`, `RetiredTimeFunctions`, `RetiredTimeProperties`, `Precedence` | the tables; the two `Retired*` lists exist only to explain the removed names |
| `src/dsl/errors.js` | `DSLLexerError`, `DSLParseError`, `DSLCompileError`, `ErrorMessages` | typed errors with a `userMessage` |
| `src/dsl/index.js` | `compileDSL`, `decompileToDSL`, `validateDSL` | the public API |
| `src/dsl/simplify.js` | `simplifyDSL`, `scaleDSL` | DSL-native canonicaliser (see [Exact Values](/developer/core/symbolic-power#the-simplifier)) |

`compileDSL('')` returns bytecode for the constant `0/1` rather than throwing (`src/dsl/index.js:28-36`).

### Properties

`src/dsl/constants.js:43-71`. These aliases and no others:

| Canonical | Accepted spellings | Canonical short form |
|---|---|---|
| `frequency` | `f`, `freq`, `frequency` | `f` |
| `startTime` | `t`, `s`, `start`, `startTime` | `t` |
| `duration` | `d`, `dur`, `duration` | `d` |
| `amplitude` | `a`, `amp`, `amplitude` | `a` |
| `attack` | `atk`, `attack` | `attack` |
| `release` | `rel`, `release` | `release` |

`[0].prop` is parsed as `base.prop` — note id 0 **is** the BaseNote (`src/dsl/parser.js:296-299`).

### No functions

The DSL has no functions (`src/dsl/parser.js` header). `beat()`, `tempo()` and `measure()` are refused, not compiled, with a message that names the replacement:

| You type | Refused with |
|---|---|
| `beat(base)`, `beat([N])` | `'beat()' was removed: the reference note's duration is the time unit, so write base.d for beat(base), or [N].d to relate to note N` |
| `measure([N])` | `'measure()' was removed: a measure bar is a silent note with a duration, so write [N].d for measure([N])` |
| `tempo(x)` | `'tempo()' was removed: tempo is no longer stored; durations relate to other durations (base.d is the time unit, 60 / base.d the tempo)` |
| `x.tempo`, `x.bpm`, `x.beatsPerMeasure`, `x.ml`, `x.measureLength` | `'.name' was removed: tempo, beats per measure and measure length are no longer stored. Relate durations instead (base.d is the time unit; a measure bar's length is its .d)` |

Any other function name gets `Unknown function 'name'. Expressions have no functions: write references such as [3].d or base.d` (`ErrorMessages` in `src/dsl/errors.js`). The time unit, one beat in seconds, is simply the BaseNote's duration: write `base.d`. Do not look for `60 / tempo(base)`; no tempo exists to divide by.

## Bytecode format

`src/binary-note.js:18-42`:

```javascript
export const OP = {
  LOAD_CONST:      0x01,
  LOAD_REF:        0x02,
  LOAD_BASE:       0x03,
  LOAD_CONST_BIG:  0x04,
  LOAD_REF_WIDE:   0x05,

  ADD:             0x10,
  SUB:             0x11,
  MUL:             0x12,
  DIV:             0x13,
  NEG:             0x14,
  POW:             0x15,

  // 0x20 and 0x21 (FIND_TEMPO, FIND_MEASURE) are retired: do not reuse them
  FIND_INSTRUMENT: 0x22,   // dead

  DUP:             0x30,   // dead
  SWAP:            0x31,   // dead
};
```

::: warning `FIND_INSTRUMENT`, `DUP` and `SWAP` are never emitted
No compiler produces them. `DUP` and `SWAP` are implemented in the VM but unreachable from any compiled expression; `FIND_INSTRUMENT` is not even handled there. Treat them as reserved bytes.
:::

::: warning Retired: `FIND_TEMPO` and `FIND_MEASURE`
Opcodes `0x20` (`FIND_TEMPO`) and `0x21` (`FIND_MEASURE`) were removed from `OP` together with the tempo and measure-length variables. A byte with either value is now an unknown opcode in the VM. `src/binary-note.js` marks both values as not to be reused.
:::

### Instruction encoding

```
LOAD_CONST      [0x01][num: i32 BE][den: i32 BE]                        9 bytes
LOAD_REF        [0x02][noteId: u16 BE][varIndex: u8]                    4 bytes
LOAD_BASE       [0x03][varIndex: u8]                                    2 bytes
LOAD_CONST_BIG  [0x04][sign: u8][numLen: u16][num…][denLen: u16][den…]  variable
LOAD_REF_WIDE   [0x05][noteId: u32 BE][varIndex: u8]                    6 bytes

ADD SUB MUL DIV NEG POW                                                 1 byte
```

Operands are pushed **before** the opcode — it is a stack machine, nothing nests.

### Variable indices

The export is `VAR`, with a `VAR_NAMES` reverse map (`binary-note.js:50-70`):

```javascript
export const VAR = {
  START_TIME: 0,
  DURATION: 1,
  FREQUENCY: 2,
  AMPLITUDE: 3,
  ATTACK: 4,
  RELEASE: 5,
};

export const FIRST_INTERPRETATION_VAR = VAR.AMPLITUDE;   // 3
```

Indices 0 to 2 are the language: they relate a note to other notes. Indices from `FIRST_INTERPRETATION_VAR` up (`amplitude`, `attack`, `release`) interpret a note when it sounds, and they are the only variables that fall back to the BaseNote when a note does not define them (see [Binary Evaluator](/developer/core/binary-evaluator#value-resolution-load-ref-and-load-base)). The corruption flags are `1 << varIndex` (`0x01` start to `0x20` release); see [BinaryExpression](/developer/api/binary-expression#corruption-flags).

### Constant emission

`emitFraction()` (`src/dsl/compiler.js:89-120`) GCD-normalises the fraction **in BigInt** (`bigGcd` from `src/utils/fraction-num.js`), moves the sign to the numerator, then picks the opcode by magnitude: `LOAD_CONST` if numerator and denominator both fit in i32 (`-2147483648 … 2147483647`), otherwise `LOAD_CONST_BIG`. There is no `constBig` AST node — the choice is made at emit time.

Number literals are exact at any size: the digits are parsed straight into a BigInt fraction by `decimalStringToBigFraction()` (`src/utils/fraction-num.js:36`), never through `parseFloat`. A decimal literal is **exact as written** — `3.14159` is `314159/100000` and `0.333333` is `333333/1000000`, not `1/3`.

::: info `LOAD_CONST_BIG` carries BigInts, and they survive
The evaluator decodes the variable-length BigInts straight into a pooled BigInt-backed fraction (`binary-evaluator.js:442-452`), so a big constant keeps every digit through parse → emit → decode → evaluate → decompile — `scripts/test-exactness.mjs` (part of `npm test`) proves it with a ~98-digit literal. The old path routed the decode through a double-backed `Fraction` constructor, which silently rounded anything past 2^53: the encoding preserved the *bytecode* but not the precision.
:::

## `BinaryExpression`

`binary-note.js:95-430`. `new BinaryExpression(initialSize = 64)` — the constructor takes a **byte count**, not a buffer.

| Field | Type | Notes |
|---|---|---|
| `bytecode` | `Uint8Array` | starts at 64 bytes, doubles on demand |
| `length` | number | bytes written |
| `dependencies` | `Uint32Array` | starts at 16 entries, doubles |
| `depCount` | number | |
| `sourceText` | string | the original text, kept for round-trip |
| `referencesBase` | boolean | set by `LOAD_BASE` emission |

Key methods: `addDependency()`, `getDependencySet()`, `getPropertyDependencies()` (scans the bytecode into a `Map<noteId, Set<varIndex>>` — this is where the [dependency graph](/developer/core/dependency-graph) gets its property-level edges), `referencesProperty()`, `isEmpty()`, `clone()`.

A `LOAD_BASE` does **not** add note 0 as a dependency. Recording it would give the BaseNote a self-cycle; the `referencesBase` flag is tracked separately instead (`emitNoteReference()`, `src/dsl/compiler.js:126`).

## The retired method-chain syntax

Earlier versions also compiled a JavaScript-like method chain:

```
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))   →   [1].f * (3/2)
module.baseNote.getVariable('duration')                                  →   base.d
new Fraction(2).pow(new Fraction(1, 12)).mul(module.baseNote.getVariable('frequency'))   →   2^(1/12) * base.f
```

Its compiler and its simplifier were removed. `src/migrate/legacy-syntax.js` keeps only what converting it needs:

- `parseLegacy()` (`src/migrate/legacy-syntax.js:89`), a strict recursive-descent parser for exactly the old building blocks (`new Fraction(a[, b])` with decimal arguments, bare decimals, `module.baseNote.getVariable('x')`, `module.getNoteById(N).getVariable('x')`, a bare variable name, parentheses, `.mul .div .add .sub .pow`), which builds a DSL syntax tree;
- `legacyToDSL()` (`src/migrate/legacy-syntax.js:227`), which compiles that tree, decompiles it to DSL text, compiles the text again and refuses unless both give the same bytecode;
- `migrateSyntax()` (`src/migrate/legacy-syntax.js:261`), which converts every expression of a module object and is called by `Module.loadFromJSON()` (`src/module.js:878`) right after `migrateTimeModel()`. `scripts/migrate-modules.mjs` applies both conversions to files in place.

**It refuses rather than guesses.** The old compiler was a string splitter that read a chain correctly only when its methods came in the order `.pow`, then `.mul`/`.div`, then `.add`/`.sub` (`RANK`, `src/migrate/legacy-syntax.js:48`). It silently dropped a `.mul()` or `.div()` that followed an `.add()` (`a.add(b).mul(c)` evaluated as `a + b`), a `.pow()` that followed a `.mul()`, and every `.neg()`. For those the text and the old engine disagree, so the converter throws a `SyntaxMigrationError`, and `migrateSyntax()` adds the note and variable: the module does not load rather than load with a value nobody wrote. A note id above 16777215, an unknown variable (`'tempo'`), a quoted fraction (`new Fraction('1/3')`) and a division by zero are refused too.

`scripts/test-legacy-syntax.mjs` (part of `npm test`) loads every module of `scripts/fixtures/legacy-syntax-oracle.json`, the library plus fixtures in the old syntax (`scripts/fixtures/legacy-syntax/`: four library modules as the old decompiler wrote them, and `shapes.json` with every accepted building block and call order), and requires every start, duration, frequency, amplitude, attack, release and corruption flag to equal the value recorded with the old compiler.

## The decompiler

`ExpressionDecompiler.decompile()` (`src/expression-compiler.js:78`, singleton `decompiler`) returns `binary.sourceText` when it is set, so for anything compiled from text it is a pass-through; otherwise it returns the DSL the bytecode decompiles to (`decompileToDSL()`). `Note.getExpressionSource()` and `Note.toJSON()` use it, so a saved module is always DSL.

The DSL decompiler (`src/dsl/decompiler.js`) is a stack machine over the bytecode that re-emits DSL, inserting parentheses from the `Precedence` table, printing fractions as `(n/d)` and integers bare. Constants come out of the bytecode as BigInts and are stringified directly (`pushConst`, `src/dsl/decompiler.js:200-206`), so a big constant is printed **digit-exact** — it used to be coerced through `Number()`, which rounded and could emit unparseable scientific notation. It prints every `LOAD_REF` / `LOAD_BASE` as a property access (`[N].d`, `base.f`) and reconstructs nothing else: with no functions in the language there is nothing to fold back into a helper.

The note widget's `Raw:` box shows the decompiled DSL of the note's bytecode (`convertToDSLDisplay()`, `src/modals/variable-controls.js:172`).

### Round-trip is lossy in specific, harmless ways

| You type | It is saved as |
|---|---|
| `base.freq`, `base.s`, `base.dur` | `base.f`, `base.t`, `base.d` |
| `base.d * (1/4)` | `base.d * (1/4)` — survives |
| `base.rel`, `base.atk` | `base.release`, `base.attack` (the short names `a`, `t`, `d`, `f` are kept; attack and release print in full) |
| `[0].f` | `base.f` |
| `0.5 * base.f` | `(1/2) * base.f` |
| `3.14159` | `(314159/100000)` — decimals are exact as written |
| `base.f # a comment` | `base.f` — comments are dropped |
| `2^-1` | `2^(-1)` |

Aliases (`freq`, `s`, `dur`, `amp`, `atk`, `rel`) compile to the same bytecode as the canonical name and never come back as typed; the decompiler prints each variable's preferred short name from `PropertyShortNames`.

## Validation

The compiler refuses garbage by throwing, but validation is still a separate gate — it is what checks self-references and cycles, and what turns a parser failure into a structured result.

| Gate | Where | What it does |
|---|---|---|
| UI edits | `validateExpression()`, `src/modals/validation.js:6` | refuses the retired syntax with its DSL form, then `validateDSL()`, `compileDSL()` to prove it yields bytecode, then the self-reference and cycle check on that bytecode — per (note, variable), see [Dependency Graph](/developer/core/dependency-graph#cycles-are-checked-per-variable) |
| DSL syntax | `validateDSL()`, `src/dsl/index.js:71` | tokenize + parse; returns `{valid, error}` with `error` = the `DSLError.userMessage` |
| JSON import | `validateExpressionSyntax()`, `src/utils/safe-expression-validator.js:26` | rejects strings over 10 000 chars and a blocklist (`eval(`, `Function(`, `import(`, `document.`, `__proto__`, `<script`, …), then proves the string compiles — a compiler throw comes back as `{valid: false, error}` |

Nothing anywhere calls `eval()` or `new Function()` on an expression.

The `Save` handler catches validation errors and shows them **inline**: `showError()` prints the message in red under the Save button and gives the raw input a red border, cleared on the next edit or save attempt (`src/modals/variable-controls.js:222-237`, `src/modals/variable-controls.js:991`). The user-grade error strings in `src/dsl/errors.js` are what the user actually reads.

## Worked example

Input (DSL):

```
[1].f * (3/2)
```

Bytecode (verified against the real compiler):

```
0x02 0x00 0x01 0x02                        LOAD_REF  note=1, var=2 (frequency)
0x01 0x00 0x00 0x00 0x03 0x00 0x00 0x00 0x02   LOAD_CONST 3/2
0x12                                       MUL
```

`dependencies = [1]`, `referencesBase = false`, `getPropertyDependencies() = {1 → {2}}`.

Decompiled with `decompileToDSL()`: `[1].f * (3/2)` — exact round-trip.

## Worked failure: `[1]f` is rejected

Omit the dot and the expression is refused with a real error rather than compiling to zero:

```
compiler.compile('[1]f')
  → not the retired syntax (no method-chain marker)
  → compileDSL('[1]f') → the DSL parser throws a DSLParseError
  → compile() rethrows it; validateExpression() reports it
```

In the widget the message lands under the Save button; the validators return `valid: false`; on a file load the property is left unset.

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — the stack VM that runs this bytecode
- [Dependency Graph](/developer/core/dependency-graph) — what consumes `getPropertyDependencies()`
- [Exact Values](/developer/core/symbolic-power) — what `POW` returns, and `~`
- [Expression Syntax](/reference/expressions/syntax) — the user-facing reference
