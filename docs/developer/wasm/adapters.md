# JS/WASM Adapters

The adapter layer provides a unified interface for WASM and JavaScript implementations.

## Overview

```
Application Code
       ↓
   Adapters (unified API)
       ↓
┌──────┴──────┐
│             │
WASM       JavaScript
(fast)     (fallback)
```

## Configuration

```javascript
// src/wasm/config.js
export const WASM_CONFIG = {
  enabled: true,              // Use WASM if available
  usePersistentCache: true,   // Keep cache in WASM memory
  fallbackOnError: true,      // Fall back to JS on WASM error
  debug: false                // Enable debug logging
}
```

## Evaluator Adapter

### createEvaluator()

```javascript
import { createEvaluator } from './wasm/evaluator-adapter.js'

const evaluator = await createEvaluator(module)
```

Returns a WASM or JavaScript evaluator based on availability.

### Evaluator Interface

```javascript
interface Evaluator {
  // Evaluate a single note
  evaluate(noteId: number): EvaluatedNote

  // Batch evaluate dirty notes
  evaluateDirty(noteIds: number[]): Map<number, EvaluatedNote>

  // Invalidate cached value
  invalidate(noteId: number): void

  // Get all cached values
  getCache(): Map<number, EvaluatedNote>
}
```

### WasmEvaluatorWrapper

Wraps the WASM evaluator with JS-friendly interface:

```javascript
class WasmEvaluatorWrapper {
  constructor(wasmModule) {
    this._evaluator = new wasmModule.Evaluator()
  }

  evaluate(noteId) {
    const result = this._evaluator.evaluate(noteId)
    return this._convertResult(result)
  }

  _convertResult(wasmResult) {
    return {
      startTime: new Fraction(wasmResult.start_time_n, wasmResult.start_time_d),
      duration: new Fraction(wasmResult.duration_n, wasmResult.duration_d),
      frequency: new Fraction(wasmResult.frequency_n, wasmResult.frequency_d),
      corruption: wasmResult.corruption
    }
  }
}
```

### WasmPersistentEvaluatorWrapper

Keeps evaluation cache in WASM memory for better performance:

```javascript
class WasmPersistentEvaluatorWrapper {
  evaluateDirty(noteIds) {
    // Single WASM call for all notes
    this._evaluator.evaluate_batch(noteIds)

    // Return lazy proxy - converts on access
    return new LazyWasmCacheProxy(this._evaluator)
  }
}
```

### LazyWasmCacheProxy

Defers conversion from WASM to JavaScript:

```javascript
class LazyWasmCacheProxy {
  constructor(evaluator) {
    this._evaluator = evaluator
    this._converted = new Map()
  }

  get(noteId) {
    if (!this._converted.has(noteId)) {
      const wasmValue = this._evaluator.get_note(noteId)
      this._converted.set(noteId, convertToJS(wasmValue))
    }
    return this._converted.get(noteId)
  }
}
```

## Compiler Adapter

### createCompiler()

```javascript
import { createCompiler } from './wasm/compiler-adapter.js'

const compiler = await createCompiler()
```

### Compiler Interface

```javascript
interface Compiler {
  // Compile expression text to bytecode
  compile(source: string): BinaryExpression

  // Clear compilation cache
  clearCache(): void
}
```

### WasmCompilerWrapper

```javascript
class WasmCompilerWrapper {
  constructor(wasmModule) {
    this._compiler = new wasmModule.Compiler()
    this._cache = new Map()
  }

  compile(source) {
    // Check cache first
    if (this._cache.has(source)) {
      return this._cache.get(source)
    }

    // Compile via WASM
    const bytecode = this._compiler.compile(source)

    // Cache and return
    const expr = new BinaryExpression(bytecode)
    this._cache.set(source, expr)
    return expr
  }
}
```

## Incremental Evaluator

### WasmIncrementalEvaluator

Handles dirty tracking and topological sort:

```javascript
class WasmIncrementalEvaluator {
  constructor(module, wasmModule) {
    this._module = module
    this._evaluator = new wasmModule.PersistentEvaluator()
    this._dirty = new Set()
  }

  invalidate(noteId) {
    this._dirty.add(noteId)
    // Cascade to dependents
    for (const dep of this._module.getDependentNotes(noteId)) {
      this._dirty.add(dep)
    }
  }

  evaluateDirty() {
    if (this._dirty.size === 0) {
      return this._evaluator.getCache()
    }

    // Topological sort dirty notes
    const sorted = this._topologicalSort([...this._dirty])

    // Register any changed bytecode
    for (const id of sorted) {
      const note = this._module.getNoteById(id)
      this._evaluator.register_bytecode(id, note.getBytecode())
    }

    // Batch evaluate
    this._evaluator.evaluate_batch(sorted)
    this._dirty.clear()

    return new LazyWasmCacheProxy(this._evaluator)
  }
}
```

## Error Handling

### Fallback on Error

```javascript
try {
  return wasmCompiler.compile(source)
} catch (e) {
  if (WASM_CONFIG.fallbackOnError) {
    console.warn('WASM compile failed, using JS fallback:', e)
    return jsCompiler.compile(source)
  }
  throw e
}
```

### WASM Availability Check

```javascript
async function isWasmAvailable() {
  try {
    await init()
    return true
  } catch (e) {
    console.warn('WASM not available:', e)
    return false
  }
}
```

## Performance Comparison

| Operation | WASM | JavaScript |
|-----------|------|------------|
| Compile 1 expr | 0.1ms | 1ms |
| Evaluate 1 note | 0.01ms | 0.1ms |
| Batch 100 notes | 0.5ms | 5ms |
| Memory (100 notes) | 10KB | 50KB |

## Debug Mode

Enable debug logging:

```javascript
WASM_CONFIG.debug = true

// Logs:
// [WASM] Compiling: module.baseNote.getVariable('frequency')
// [WASM] Bytecode size: 24 bytes
// [WASM] Evaluating batch: [1, 2, 3]
// [WASM] Evaluation time: 0.3ms
```

## Testing

### Mock WASM for Tests

```javascript
// In tests
jest.mock('./wasm/evaluator-adapter.js', () => ({
  createEvaluator: () => new MockEvaluator()
}))
```

### Compare Results

```javascript
// Verify WASM matches JS
const wasmResult = wasmEvaluator.evaluate(1)
const jsResult = jsEvaluator.evaluate(1)
expect(wasmResult.frequency.equals(jsResult.frequency)).toBe(true)
```

## See Also

- [WASM Overview](/developer/wasm/overview) - Architecture
- [Building WASM](/developer/wasm/building) - Compilation
- [Binary Evaluator](/developer/core/binary-evaluator) - Evaluation details
