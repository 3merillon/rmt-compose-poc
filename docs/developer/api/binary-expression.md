# BinaryExpression Class

The BinaryExpression class holds compiled bytecode for efficient expression evaluation.

## Overview

Expressions like `module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))` are compiled to compact bytecode for fast evaluation.

## Class: BinaryExpression

### Constructor

```javascript
const expr = new BinaryExpression()
```

Creates an empty expression. Typically populated by the compiler.

## Properties

### bytecode

```javascript
expr.bytecode  // Uint8Array
```

The compiled instruction stream.

### length

```javascript
expr.length  // number
```

Number of bytes used in the bytecode array.

### dependencies

```javascript
expr.dependencies  // Uint32Array
```

Note IDs referenced by this expression.

### depCount

```javascript
expr.depCount  // number
```

Number of dependencies.

### referencesBase

```javascript
expr.referencesBase  // boolean
```

Whether the expression references `module.baseNote`.

### sourceText

```javascript
expr.sourceText  // string
```

Original expression text (for debugging/serialization).

## Methods

### isDirty()

```javascript
const dirty = expr.isDirty()
// → boolean
```

Returns true if the expression needs recompilation.

### isEmpty()

```javascript
const empty = expr.isEmpty()
// → boolean
```

Returns true if no bytecode has been compiled.

### addDependency()

```javascript
expr.addDependency(noteId)
```

Adds a note ID to the dependency list.

### getDependencySet()

```javascript
const deps = expr.getDependencySet()
// → Set<number>
```

Returns all dependencies as a Set.

### getPropertyDependencies()

```javascript
const propDeps = expr.getPropertyDependencies()
// → Map<number, string>
```

Returns dependencies with their property names:
```javascript
Map {
  1 => 'frequency',
  2 => 'startTime',
  2 => 'duration'
}
```

### clone()

```javascript
const copy = expr.clone()
```

Deep copies the expression for caching.

## Bytecode Format

### Opcodes

| Opcode | Hex | Stack Effect | Description |
|--------|-----|--------------|-------------|
| LOAD_CONST | 0x01 | → value | Push fraction constant |
| LOAD_REF | 0x02 | → value | Push note variable |
| LOAD_BASE | 0x03 | → value | Push baseNote variable |
| LOAD_CONST_BIG | 0x04 | → value | Push BigInt fraction |
| ADD | 0x10 | a, b → a+b | Addition |
| SUB | 0x11 | a, b → a-b | Subtraction |
| MUL | 0x12 | a, b → a×b | Multiplication |
| DIV | 0x13 | a, b → a÷b | Division |
| NEG | 0x14 | a → -a | Negation |
| POW | 0x15 | a, b → a^b | Power |
| FIND_TEMPO | 0x20 | note → tempo | Tempo lookup |
| FIND_MEASURE | 0x21 | note → length | Measure length lookup |

### Variable Indices

| Index | Variable |
|-------|----------|
| 0 | startTime |
| 1 | duration |
| 2 | frequency |
| 3 | tempo |
| 4 | beatsPerMeasure |
| 5 | measureLength |

### Instruction Encoding

```
LOAD_CONST [sign:1] [num:4] [den:4]
           ↑        ↑       ↑
           0=pos    numerator denominator
           1=neg    (big-endian u32)

LOAD_REF [noteId:4] [varIndex:1]
         ↑          ↑
         note ID    which variable

LOAD_BASE [varIndex:1]
          ↑
          which baseNote variable
```

## Example Bytecode

Expression: `module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))`

```
Offset  Bytes         Instruction
0x00    03 02         LOAD_BASE frequency (varIndex=2)
0x02    01 00         LOAD_CONST positive
0x04    00 00 00 03   numerator = 3
0x08    00 00 00 02   denominator = 2
0x0C    12            MUL

Stack trace:
1. LOAD_BASE → [440]
2. LOAD_CONST → [440, 3/2]
3. MUL → [660]
```

## Compilation

### From Text

```javascript
import { compile } from './expression-compiler.js'

const expr = compile("new Fraction(3, 2)")
```

### Parse Tree

The compiler first parses to an AST:

```javascript
{
  type: 'call',
  method: 'mul',
  target: {
    type: 'call',
    method: 'getVariable',
    target: { type: 'baseNote' },
    args: ['frequency']
  },
  args: [{ type: 'fraction', num: 3, den: 2 }]
}
```

Then emits bytecode from the AST.

## Decompilation

### To Text

```javascript
import { decompile } from './expression-compiler.js'

const source = decompile(expr)
// → "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))"
```

Used for serialization and display.

## Performance

| Operation | Time |
|-----------|------|
| Compile | 0.1-1ms |
| Evaluate | 0.01-0.1ms |
| Clone | 0.001ms |

Bytecode evaluation is 10-100x faster than interpreting source text.

## Error Handling

```javascript
try {
  const expr = compile(source)
} catch (e) {
  if (e instanceof SyntaxError) {
    // Invalid expression syntax
  } else if (e instanceof ReferenceError) {
    // Unknown note ID or method
  }
}
```

## See Also

- [Expression Compiler](/developer/core/expression-compiler) - Compilation details
- [Binary Evaluator](/developer/core/binary-evaluator) - Evaluation details
- [Expression Syntax](/reference/expressions/syntax) - Syntax reference
