# WASM Overview

RMT Compose uses WebAssembly (WASM) for high-performance evaluation of musical expressions, written in Rust.

## Why WASM?

| Operation | JavaScript | WASM | Speedup |
|-----------|------------|------|---------|
| Fraction arithmetic | 10µs | 1µs | 10x |
| Expression evaluation | 50µs | 5µs | 10x |
| Batch evaluation (100 notes) | 5ms | 0.5ms | 10x |

WASM provides:
- Near-native performance
- Consistent execution speed
- Efficient memory usage
- Zero GC pauses during evaluation

## Architecture

```
JavaScript                        WASM (Rust)
┌─────────────────┐              ┌─────────────────┐
│ Expression Text │              │                 │
│        ↓        │   compile    │    Compiler     │
│    Compiler     │ ──────────→  │        ↓        │
│        ↓        │              │    Bytecode     │
│    Bytecode     │              │                 │
│        ↓        │   evaluate   │    Evaluator    │
│   JS Evaluator  │ ──────────→  │        ↓        │
│   (fallback)    │              │    Results      │
└─────────────────┘              └─────────────────┘
```

## WASM Module: `rmt_core`

The Rust crate `rmt_core` provides:

### Fraction Arithmetic

```rust
// Arbitrary-precision rationals
pub struct Fraction {
    numerator: BigInt,
    denominator: BigInt,
}

impl Fraction {
    pub fn add(&self, other: &Fraction) -> Fraction;
    pub fn mul(&self, other: &Fraction) -> Fraction;
    pub fn pow(&self, exponent: &Fraction) -> Value;
}
```

### Expression Compiler

```rust
pub fn compile(source: &str) -> Result<Bytecode, CompileError>;
```

Parses JavaScript-like expressions into bytecode.

### Binary Evaluator

```rust
pub struct Evaluator {
    stack: Vec<Value>,
    cache: HashMap<NoteId, EvaluatedNote>,
}

impl Evaluator {
    pub fn evaluate(&mut self, bytecode: &[u8]) -> Value;
    pub fn evaluate_batch(&mut self, notes: &[NoteId]) -> Vec<EvaluatedNote>;
}
```

### Dependency Graph

```rust
pub struct DependencyGraph {
    forward: HashMap<NoteId, HashSet<NoteId>>,
    inverse: HashMap<NoteId, HashSet<NoteId>>,
}

impl DependencyGraph {
    pub fn add_dependency(&mut self, from: NoteId, to: NoteId);
    pub fn get_dependents(&self, id: NoteId) -> &HashSet<NoteId>;
    pub fn topological_sort(&self, dirty: &[NoteId]) -> Vec<NoteId>;
}
```

## Value Types

The evaluator handles both rational and irrational values:

```rust
pub enum Value {
    Rational(Fraction),        // Exact: 3/2, 440/1
    Irrational(SymbolicPower), // Algebraic: 2^(1/12)
}
```

### SymbolicPower

Preserves algebraic structure for TET calculations:

```rust
pub struct SymbolicPower {
    base: Fraction,     // e.g., 2
    exponent: Fraction, // e.g., 1/12
    cached_float: f64,  // Numeric approximation
}
```

## EvaluatedNote Format

Results are serialized as:

```rust
pub struct EvaluatedNote {
    // Rational representation (may be approximate for irrationals)
    start_time_s: i64,  // sign
    start_time_n: Vec<u8>,  // numerator (big-endian)
    start_time_d: Vec<u8>,  // denominator

    duration_s: i64,
    duration_n: Vec<u8>,
    duration_d: Vec<u8>,

    frequency_s: i64,
    frequency_n: Vec<u8>,
    frequency_d: Vec<u8>,

    // Corruption flags for irrationals
    corruption: u32,
}
```

### Corruption Flags

```rust
const CORRUPTED_START_TIME: u32 = 0x01;
const CORRUPTED_DURATION: u32 = 0x02;
const CORRUPTED_FREQUENCY: u32 = 0x04;
const CORRUPTED_TEMPO: u32 = 0x08;
const CORRUPTED_BEATS_PER_MEASURE: u32 = 0x10;
const CORRUPTED_MEASURE_LENGTH: u32 = 0x20;
```

## JavaScript Integration

### Loading WASM

```javascript
import init, { Evaluator, Compiler } from './pkg/rmt_core.js'

await init()  // Load and instantiate WASM module
```

### Using Adapters

```javascript
import { createEvaluator, createCompiler } from './wasm/adapters.js'

const compiler = await createCompiler()  // Uses WASM if available
const evaluator = await createEvaluator(module)
```

## Fallback Strategy

WASM may not be available (older browsers, disabled):

```javascript
const useWasm = WASM_CONFIG.enabled && wasmModule !== null

if (useWasm) {
  return new WasmEvaluatorWrapper(wasmModule)
} else {
  return new JavaScriptEvaluator()
}
```

The JavaScript evaluator provides identical results, just slower.

## Memory Management

### WASM Linear Memory

WASM uses a fixed linear memory buffer:
- Initial: 16 pages (1MB)
- Maximum: 256 pages (16MB)
- Grows automatically as needed

### Avoiding Copies

The `PersistentEvaluator` keeps results in WASM memory:

```javascript
// Bad: copies on every read
const value = evaluator.getNote(1).frequency

// Good: lazy conversion
const cache = evaluator.getCache()  // Returns proxy
const value = cache.get(1).frequency  // Converts on access
```

## Performance Tips

1. **Batch evaluation**: Evaluate all dirty notes in one call
2. **Use persistent evaluator**: Keeps cache in WASM memory
3. **Lazy conversion**: Only convert needed values to JS
4. **Avoid repeated compilation**: Cache compiled bytecode

## See Also

- [Building WASM](/developer/wasm/building) - Compilation guide
- [JS/WASM Adapters](/developer/wasm/adapters) - Integration layer
- [Binary Evaluator](/developer/core/binary-evaluator) - Evaluation details
