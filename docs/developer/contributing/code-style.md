# Code Style

Guidelines for consistent code style in RMT Compose.

## JavaScript

### Formatting

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Line length**: 100 characters max

### Naming Conventions

```javascript
// Classes: PascalCase
class ExpressionCompiler { }

// Functions/methods: camelCase
function compileExpression(source) { }

// Constants: UPPER_SNAKE_CASE
const MAX_ZOOM_LEVEL = 10.0

// Private members: underscore prefix
this._internalState = null
```

### Functions

```javascript
// Prefer arrow functions for callbacks
array.map(item => item.value)

// Use regular functions for methods
class Module {
  addNote(variables) {
    // ...
  }
}

// Document parameters for complex functions
/**
 * Compiles an expression to bytecode.
 * @param {string} source - Expression text
 * @returns {BinaryExpression} Compiled expression
 */
function compile(source) {
  // ...
}
```

### Classes

```javascript
class Module {
  // Constructor first
  constructor(baseNoteVariables = {}) {
    this._notes = new Map();
    this._dirtyNotes = new Set();
  }

  // Public methods
  addNote(variables) {
    // ...
  }

  // Private methods (underscore prefix)
  _registerDependencies(noteId) {
    // ...
  }

  // Static methods last
  static fromJSON(json) {
    // ...
  }
}
```

### Imports

```javascript
// Order: external, then internal
import Fraction from 'fraction.js';

import { Module } from './module.js';
import { Note } from './note.js';
import { compile } from './expression-compiler.js';

// Group related imports
import {
  OPCODES,
  LOAD_CONST,
  LOAD_REF,
  ADD,
  MUL
} from './bytecode.js';
```

### Error Handling

```javascript
// Use specific error types
if (!note) {
  throw new ReferenceError(`Note ${id} not found`);
}

// Provide context in error messages
if (hasCycle) {
  throw new Error(`Circular dependency: ${path.join(' -> ')}`);
}

// Handle expected errors
try {
  const expr = compile(source);
} catch (e) {
  if (e instanceof SyntaxError) {
    showUserError(`Invalid expression: ${e.message}`);
  } else {
    throw e;  // Re-throw unexpected errors
  }
}
```

## Rust

### Formatting

Use `rustfmt` with default settings:

```bash
cargo fmt
```

### Naming Conventions

```rust
// Structs/Enums: PascalCase
struct Evaluator { }
enum Value { }

// Functions/methods: snake_case
fn evaluate_bytecode(bytecode: &[u8]) -> Value { }

// Constants: UPPER_SNAKE_CASE
const MAX_STACK_SIZE: usize = 1024;

// Type parameters: single uppercase letter
fn process<T: Clone>(value: T) -> T { }
```

### Documentation

```rust
/// Evaluates a binary expression.
///
/// # Arguments
///
/// * `bytecode` - The compiled bytecode
///
/// # Returns
///
/// The evaluated value, or an error.
///
/// # Example
///
/// ```
/// let result = evaluator.evaluate(&bytecode)?;
/// ```
pub fn evaluate(&mut self, bytecode: &[u8]) -> Result<Value, EvalError> {
    // ...
}
```

### Error Handling

```rust
// Use Result for fallible operations
fn compile(source: &str) -> Result<Bytecode, CompileError> {
    // ...
}

// Use Option for optional values
fn get_note(&self, id: u32) -> Option<&Note> {
    self.notes.get(&id)
}

// Provide context with error types
#[derive(Debug)]
pub enum EvalError {
    StackUnderflow,
    DivisionByZero,
    InvalidOpcode(u8),
    NoteNotFound(u32),
}
```

## Comments

### When to Comment

```javascript
// Good: Explain WHY, not WHAT
// Use BigInt to avoid overflow with large numerators
const num = BigInt(fraction.n);

// Bad: Restating the code
// Add x and y
const sum = x + y;
```

### TODO Comments

```javascript
// TODO: Implement batch evaluation optimization
// TODO(username): Fix memory leak in audio engine
```

### Documentation Comments

```javascript
/**
 * Compiles an expression string to binary bytecode.
 *
 * Supports:
 * - Fraction constants: new Fraction(3, 2)
 * - BaseNote references: module.baseNote.getVariable('frequency')
 * - Note references: module.getNoteById(1).getVariable('startTime')
 * - Arithmetic: .add(), .sub(), .mul(), .div(), .pow()
 *
 * @param {string} source - The expression text
 * @returns {BinaryExpression} Compiled bytecode
 * @throws {SyntaxError} If the expression is invalid
 */
```

## File Organization

### Module Files

```javascript
// module.js

// 1. Imports
import { Note } from './note.js';

// 2. Constants
const DEFAULT_TEMPO = 60;

// 3. Main class
export class Module {
  // ...
}

// 4. Helper functions (if any)
function validateId(id) {
  // ...
}
```

### Index Files

```javascript
// index.js - Re-exports for public API
export { Module } from './module.js';
export { Note } from './note.js';
export { compile } from './expression-compiler.js';
```

## Performance Guidelines

### Avoid in Hot Paths

```javascript
// Bad: Creating objects in render loop
function render() {
  const cache = new Map();  // Allocates every frame
}

// Good: Reuse objects
const cache = new Map();
function render() {
  cache.clear();  // Reuse existing Map
}
```

### Prefer Primitives

```javascript
// Bad: Object for simple flag
const state = { isDirty: true };

// Good: Primitive
let isDirty = true;
```

## See Also

- [Development Setup](/developer/contributing/setup) - Environment setup
- [Pull Requests](/developer/contributing/pull-requests) - Contribution process
