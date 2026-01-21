# Expression Compiler

The **Expression Compiler** transforms text expressions into binary bytecode for efficient evaluation.

## Overview

```
Text Expression → Parser → AST → Emitter → Binary Bytecode
```

**Location**: `src/expression-compiler.js`

## Why Compile?

| Approach | Parse Time | Eval Time | Security |
|----------|------------|-----------|----------|
| `eval()` | Every time | Slow | Dangerous |
| Compiled bytecode | Once | Fast | Safe |

Benefits:
- **Performance**: 100x faster than runtime eval
- **Security**: No arbitrary code execution
- **Portability**: Bytecode is serializable

## Expression Syntax

The compiler supports both DSL and legacy JavaScript syntax.

### DSL Syntax (Recommended)

```
// Constants
440
(3/2)

// References
base.f
[5].t

// Arithmetic
a + b
a - b
a * b
a / b
a ^ b
-a

// Lookups
tempo(base)
measure(base)
```

### Legacy JavaScript Syntax

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Constants
new Fraction(440)
new Fraction(3, 2)

// References
module.baseNote.getVariable('frequency')
module.getNoteById(5).getVariable('startTime')

// Arithmetic
.add(expr)
.sub(expr)
.mul(expr)
.div(expr)
.pow(expr)
.neg()

// Lookups
module.findTempo(note)
module.findMeasureLength(note)
```
</details>

### Grammar (Informal)

```
expression := term (('add' | 'sub' | '+' | '-') term)*
term       := factor (('mul' | 'div' | '*' | '/') factor)*
factor     := base ('pow' | '^') base)?
base       := ('neg' | '-')? atom
atom       := constant | reference | lookup | '(' expression ')'
constant   := number | '(' number '/' number ')'
reference  := 'base.' property | '[' integer '].' property
lookup     := 'tempo(' ... ')' | 'measure(' ... ')'
```

## Parser Implementation

### Tokenization

The parser doesn't use a separate lexer. Instead, it scans the string directly with position tracking:

```javascript
class ExpressionCompiler {
  parse(text) {
    this.text = text;
    this.pos = 0;
    return this.parseExpression();
  }

  peek(pattern) {
    return this.text.slice(this.pos).startsWith(pattern);
  }

  consume(pattern) {
    if (this.peek(pattern)) {
      this.pos += pattern.length;
      return true;
    }
    return false;
  }
}
```

### AST Structure

The parser produces an AST with these node types:

```javascript
// Constant
{ type: 'const', num: 3, den: 2 }

// Big constant (arbitrary precision)
{ type: 'constBig', num: BigInt, den: BigInt }

// BaseNote reference
{ type: 'baseRef', varName: 'frequency' }

// Note reference
{ type: 'noteRef', noteId: 5, varName: 'startTime' }

// Binary operation
{ type: 'add', left: node, right: node }
{ type: 'mul', left: node, right: node }
{ type: 'pow', base: node, exp: node }

// Unary operation
{ type: 'neg', operand: node }

// Lookup
{ type: 'findTempo', note: node }
{ type: 'findMeasure', note: node }
```

## Bytecode Format

### Opcode Definitions

```javascript
// From src/binary-note.js
export const OP = {
  LOAD_CONST:     0x01,  // Push Fraction(num, den)
  LOAD_REF:       0x02,  // Push note variable
  LOAD_BASE:      0x03,  // Push baseNote variable
  LOAD_CONST_BIG: 0x04,  // Push BigInt Fraction

  ADD:            0x10,  // Pop 2, push sum
  SUB:            0x11,  // Pop 2, push difference
  MUL:            0x12,  // Pop 2, push product
  DIV:            0x13,  // Pop 2, push quotient
  NEG:            0x14,  // Pop 1, push negation
  POW:            0x15,  // Pop 2, push power

  FIND_TEMPO:     0x20,  // Module lookup
  FIND_MEASURE:   0x21,  // Module lookup
};
```

### Instruction Encoding

```
LOAD_CONST:     [0x01][num: i32][den: i32]     (9 bytes)
LOAD_REF:       [0x02][noteId: u16][varIdx: u8] (4 bytes)
LOAD_BASE:      [0x03][varIdx: u8]              (2 bytes)
LOAD_CONST_BIG: [0x04][sign: u8][numLen: u16][numBytes...][denLen: u16][denBytes...]

ADD/SUB/MUL/DIV/NEG/POW: [opcode]              (1 byte)

FIND_TEMPO:     [0x20][...recursive expr for note]
FIND_MEASURE:   [0x21][...recursive expr for note]
```

### Variable Indices

```javascript
const VAR_INDEX = {
  startTime: 0,
  duration: 1,
  frequency: 2,
  tempo: 3,
  beatsPerMeasure: 4,
  measureLength: 5,
};
```

## Emitter Implementation

### AST to Bytecode

```javascript
emit(node, buffer) {
  switch (node.type) {
    case 'const':
      buffer.push(OP.LOAD_CONST);
      this.writeInt32(buffer, node.num);
      this.writeInt32(buffer, node.den);
      break;

    case 'noteRef':
      buffer.push(OP.LOAD_REF);
      this.writeUint16(buffer, node.noteId);
      buffer.push(VAR_INDEX[node.varName]);
      break;

    case 'add':
      this.emit(node.left, buffer);
      this.emit(node.right, buffer);
      buffer.push(OP.ADD);
      break;

    // ... more cases
  }
}
```

### Complete Compilation

```javascript
compile(text, varName = null) {
  const ast = this.parse(text);
  const buffer = [];
  this.emit(ast, buffer);
  return new BinaryExpression(new Uint8Array(buffer));
}
```

## Decompiler

For JSON serialization, bytecode can be decompiled back to text:

```javascript
decompile(expr) {
  const stack = [];
  let pc = 0;

  while (pc < expr.length) {
    const op = expr[pc++];
    switch (op) {
      case OP.LOAD_CONST: {
        const num = this.readInt32(expr, pc); pc += 4;
        const den = this.readInt32(expr, pc); pc += 4;
        stack.push(den === 1 ? `${num}` : `(${num}/${den})`);
        break;
      }
      case OP.ADD: {
        const b = stack.pop();
        const a = stack.pop();
        stack.push(`${a} + ${b}`);
        break;
      }
      // ... more cases
    }
  }

  return stack[0];
}
```

<details>
<summary>Legacy decompiler output</summary>

The decompiler can also output legacy JavaScript format:

```javascript
decompileLegacy(expr) {
  const stack = [];
  let pc = 0;

  while (pc < expr.length) {
    const op = expr[pc++];
    switch (op) {
      case OP.LOAD_CONST: {
        const num = this.readInt32(expr, pc); pc += 4;
        const den = this.readInt32(expr, pc); pc += 4;
        stack.push(den === 1
          ? `new Fraction(${num})`
          : `new Fraction(${num}, ${den})`);
        break;
      }
      case OP.ADD: {
        const b = stack.pop();
        const a = stack.pop();
        stack.push(`${a}.add(${b})`);
        break;
      }
      // ... more cases
    }
  }

  return stack[0];
}
```
</details>

## Caching

The compiler caches compiled expressions:

```javascript
class ExpressionCompiler {
  cache = new Map();

  compile(text) {
    if (this.cache.has(text)) {
      return this.cache.get(text);
    }
    const expr = this.doCompile(text);
    this.cache.set(text, expr);
    return expr;
  }

  clearCache() {
    this.cache.clear();
  }
}
```

## Error Handling

### Parse Errors

```javascript
try {
  compiler.compile('base.f * (3/2')  // Missing closing paren
} catch (e) {
  // "Unexpected token at position 12"
}
```

### Validation

The compiler validates:
- Balanced parentheses
- Known method names
- Integer operands for Fraction
- Valid variable names

## Example

### Input (DSL)

```
[1].f * (3/2)
```

<details>
<summary>Legacy JavaScript equivalent</summary>

```javascript
"module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))"
```
</details>

### AST

```javascript
{
  type: 'mul',
  left: { type: 'noteRef', noteId: 1, varName: 'frequency' },
  right: { type: 'const', num: 3, den: 2 }
}
```

### Bytecode

```
[0x02, 0x00, 0x01, 0x02,     // LOAD_REF noteId=1, var=frequency
 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x02,  // LOAD_CONST 3/2
 0x12]                       // MUL
```

### Decompiled

```
[1].f * (3/2)
```

Round-trip preserves the expression exactly.

## See Also

- [Binary Evaluator](./binary-evaluator) - How bytecode is executed
- [Module Format](/reference/module-schema) - JSON expression format
- [Expression Syntax](/reference/expressions/syntax) - User reference
