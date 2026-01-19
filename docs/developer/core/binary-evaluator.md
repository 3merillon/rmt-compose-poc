# Binary Evaluator

The **Binary Evaluator** is a stack-based virtual machine that executes compiled bytecode expressions.

## Overview

```
Bytecode → Stack VM → Fraction or SymbolicPower
```

**Location**: `src/binary-evaluator.js`

## Architecture

### Stack Machine

The evaluator maintains:

- **Stack**: Array of values (Fraction or SymbolicPower)
- **PC**: Program counter (byte index)
- **Pool**: Reusable Fraction objects

```javascript
class BinaryEvaluator {
  constructor(module) {
    this.module = module;
    this.stack = new Array(32);
    this.sp = 0;  // Stack pointer
    this.pool = new FractionPool(256);
  }
}
```

### Evaluation Loop

```javascript
evaluate(expr, cache = null) {
  let pc = 0;
  const bytecode = expr.bytecode;

  while (pc < bytecode.length) {
    const op = bytecode[pc++];

    switch (op) {
      case OP.LOAD_CONST: {
        const num = this.readInt32(bytecode, pc); pc += 4;
        const den = this.readInt32(bytecode, pc); pc += 4;
        this.push(this.pool.alloc(num, den));
        break;
      }

      case OP.ADD: {
        const b = this.pop();
        const a = this.pop();
        this.push(this.pool.allocFrom(a.add(b)));
        break;
      }

      // ... more opcodes
    }
  }

  return this.pop();
}
```

## Value Types

### Fraction

Most evaluations produce Fraction values (from Fraction.js):

```javascript
// Exact rational number
new Fraction(3, 2)  // 3/2 = 1.5
```

Properties:
- Arbitrary precision numerator/denominator
- Exact arithmetic (no rounding)
- Automatically simplified (GCD reduction)

### SymbolicPower

For irrational values (TET systems), the evaluator uses SymbolicPower:

```javascript
// 2^(1/12) - an irrational number
SymbolicPower {
  coefficient: Fraction(1),
  powers: [{ base: 2, exponent: Fraction(1, 12) }]
}
```

See [SymbolicPower](./symbolic-power) for details.

### MusicValue Wrapper

The evaluator wraps values in a MusicValue that tracks corruption:

```javascript
class MusicValue {
  constructor(value, corruption = 0) {
    this.value = value;      // Fraction or SymbolicPower
    this.corruption = corruption;  // Bitmask
  }
}
```

Corruption flags indicate which properties contain irrational values.

## Opcodes

### Load Operations

| Opcode | Bytes | Stack Effect | Description |
|--------|-------|--------------|-------------|
| LOAD_CONST | 9 | → value | Push Fraction(num, den) |
| LOAD_CONST_BIG | var | → value | Push BigInt Fraction |
| LOAD_REF | 4 | → value | Push note property |
| LOAD_BASE | 2 | → value | Push baseNote property |

### Arithmetic Operations

| Opcode | Bytes | Stack Effect | Description |
|--------|-------|--------------|-------------|
| ADD | 1 | a, b → sum | a + b |
| SUB | 1 | a, b → diff | a - b |
| MUL | 1 | a, b → prod | a × b |
| DIV | 1 | a, b → quot | a ÷ b |
| NEG | 1 | a → neg | -a |
| POW | 1 | a, b → pow | a^b |

### Lookup Operations

| Opcode | Bytes | Stack Effect | Description |
|--------|-------|--------------|-------------|
| FIND_TEMPO | var | note → tempo | Find inherited tempo |
| FIND_MEASURE | var | note → len | Find measure length |

## LOAD_REF Implementation

```javascript
case OP.LOAD_REF: {
  const noteId = this.readUint16(bytecode, pc); pc += 2;
  const varIdx = bytecode[pc++];

  // Get from cache or evaluate recursively
  let noteCache = cache?.get(noteId);
  if (!noteCache) {
    const note = this.module.getNoteById(noteId);
    noteCache = this.evaluateNote(note, cache);
    cache?.set(noteId, noteCache);
  }

  // Extract the requested variable
  const value = noteCache[VAR_NAMES[varIdx]];
  this.push(value);
  break;
}
```

## POW Implementation

The POW opcode handles both rational and irrational results:

```javascript
case OP.POW: {
  const exp = this.pop();
  const base = this.pop();

  // Check if result is rational
  if (this.isRationalPower(base, exp)) {
    // Compute exact Fraction result
    const result = this.computeRationalPower(base, exp);
    this.push(result);
  } else {
    // Create SymbolicPower for irrational result
    const sp = SymbolicPower.fromPower(base.valueOf(), exp);
    this.push(sp);
    this.markCorrupted();  // Flag as irrational
  }
  break;
}
```

## Fraction Pool

To reduce garbage collection during interactive operations:

```javascript
class FractionPool {
  constructor(size) {
    this.pool = new Array(size);
    this.index = 0;
    for (let i = 0; i < size; i++) {
      this.pool[i] = new Fraction(0);
    }
  }

  alloc(num, den) {
    const f = this.pool[this.index];
    this.index = (this.index + 1) % this.pool.length;
    f.s = num < 0 ? -1 : 1;
    f.n = Math.abs(num);
    f.d = den;
    return f;
  }

  allocFrom(other) {
    return this.alloc(other.s * other.n, other.d);
  }
}
```

Benefits:
- No allocation during evaluation
- Reduced GC pauses
- Smooth 60fps during dragging

## Incremental Evaluator

For efficiency, only dirty notes are re-evaluated:

```javascript
class IncrementalEvaluator {
  constructor(module, evaluator) {
    this.module = module;
    this.evaluator = evaluator;
    this.cache = new Map();
    this.dirty = new Set();
  }

  markDirty(noteId) {
    // Mark this note and all dependents as dirty
    this.dirty.add(noteId);
    const dependents = this.module.getDependencyGraph().getDependents(noteId);
    for (const dep of dependents) {
      this.dirty.add(dep);
    }
  }

  evaluateDirty() {
    if (this.dirty.size === 0) return this.cache;

    // Sort dirty notes by dependency order
    const sorted = this.topoSort(this.dirty);

    // Evaluate in sequence
    for (const noteId of sorted) {
      const note = this.module.getNoteById(noteId);
      const result = this.evaluator.evaluateNote(note, this.cache);
      this.cache.set(noteId, result);
    }

    this.dirty.clear();
    return this.cache;
  }
}
```

## Evaluation Cache Structure

```javascript
// Cache maps noteId to evaluated properties
cache.get(noteId) = {
  startTime: Fraction,
  duration: Fraction,
  frequency: Fraction | SymbolicPower,
  tempo: Fraction,
  beatsPerMeasure: Fraction,
  corruption: number  // Bitmask
}
```

## Error Handling

### Stack Underflow

```javascript
pop() {
  if (this.sp <= 0) {
    throw new Error('Stack underflow');
  }
  return this.stack[--this.sp];
}
```

### Invalid Reference

```javascript
const note = this.module.getNoteById(noteId);
if (!note) {
  throw new Error(`Note ${noteId} not found`);
}
```

### Circular Dependency

Prevented by the dependency graph, not the evaluator. If somehow triggered:

```javascript
if (evaluating.has(noteId)) {
  throw new Error(`Circular dependency detected at note ${noteId}`);
}
```

## Performance

### Benchmark (1000 notes)

| Operation | Time |
|-----------|------|
| Full evaluation | ~50ms |
| Single note change | ~0.5ms |
| Drag preview (20 affected) | ~1ms |

### Optimization Techniques

1. **Pool allocation**: No new Fraction per operation
2. **Incremental evaluation**: Only dirty notes
3. **Topological sort**: Correct evaluation order
4. **Cache reuse**: Across multiple evaluations

## See Also

- [Expression Compiler](./expression-compiler) - How bytecode is generated
- [SymbolicPower](./symbolic-power) - Irrational number handling
- [Dependency Graph](./dependency-graph) - Dependency tracking
