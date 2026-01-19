# Module System

The Module class is the central data structure in RMT Compose, managing notes, dependencies, and evaluation.

## Module Class

### Constructor

```javascript
const module = new Module(baseNoteVariables = {})
```

Creates a new module with:
- BaseNote (ID 0) with default or provided values
- Empty note collection
- Initialized dependency graph
- Incremental evaluator

### Default BaseNote Values

```javascript
{
  frequency: 440,      // Hz (A4)
  startTime: 0,        // seconds
  duration: 1,         // seconds
  tempo: 60,           // BPM
  beatsPerMeasure: 4,  // 4/4 time
  measureLength: 4     // seconds (computed)
}
```

## Note Management

### Adding Notes

```javascript
const note = module.addNote({
  frequency: "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  startTime: "module.baseNote.getVariable('startTime')",
  duration: "new Fraction(1)"
})
```

- Auto-assigns unique ID (incrementing)
- Compiles expressions to bytecode
- Registers dependencies
- Marks note dirty for evaluation

### Removing Notes

```javascript
module.removeNote(noteId)
```

- Removes note from collection
- Clears from dependency graph
- Updates dependents (they may error without this note)

### Accessing Notes

```javascript
module.getNoteById(id)     // O(1) lookup
module.baseNote            // Reference note (ID 0)
module.notes               // Map<id, Note>
```

## Dependency Graph

The module maintains a bidirectional dependency graph:

```javascript
// Forward: What does note X depend on?
module.getDirectDependencies(noteId)  // → Set<noteId>

// Inverse: What notes depend on X?
module.getDependentNotes(noteId)      // → Set<noteId>

// Property-specific dependents
module.getDependentsByProperty(noteId)
// → { frequency: [2, 5], startTime: [3], duration: [3] }
```

### Dependency Registration

When a note's expression changes:

```javascript
module._registerNoteDependencies(noteId)
```

1. Parse bytecode for LOAD_REF and LOAD_BASE opcodes
2. Extract referenced note IDs and properties
3. Update forward and inverse dependency maps
4. O(1) insertion per dependency

## Evaluation Lifecycle

### Marking Dirty

```javascript
module.markNoteDirty(noteId)
```

1. Add to dirty set
2. Cascade to all dependents (recursive)
3. Notify incremental evaluator

### Batch Dirty

```javascript
module.markNotesDirtyBatch(noteIds)
```

Efficiently marks multiple notes dirty without redundant cascade.

### Evaluation

```javascript
const cache = module.evaluateModule()
```

1. Get dirty note IDs
2. Topological sort (dependencies before dependents)
3. Batch evaluate via WASM or JS
4. Return evaluation cache Map

### Cache Access

```javascript
const cache = module.getEvaluationCache()
// → Map<noteId, { startTime, duration, frequency, tempo, ... }>

const values = cache.get(noteId)
// → { startTime: Fraction, duration: Fraction, frequency: Fraction, ... }
```

## Musical Lookups

### Find Tempo

```javascript
module.findTempo(note)  // → Fraction (BPM)
```

Walks inheritance chain to find effective tempo.

### Find Measure Length

```javascript
module.findMeasureLength(note)  // → Fraction (seconds)
```

Computes: `beatsPerMeasure / tempo * 60`

### Find Instrument

```javascript
module.findInstrument(note)  // → string
```

Traces frequency source to determine instrument.

### Generate Measures

```javascript
module.generateMeasures(fromNote, count)  // → Array<MeasureMarker>
```

Creates measure boundary markers for visualization.

## Batch Operations

### Batch Expression Update

```javascript
module.batchSetExpressions([
  { noteId: 1, property: 'frequency', expression: '...' },
  { noteId: 2, property: 'startTime', expression: '...' },
])
```

- Single dependency graph update
- Single dirty cascade
- More efficient than individual updates

### Invalidate All

```javascript
module.invalidateAll()
```

- Clears all caches
- Marks all notes dirty
- Used on module load

## Serialization

### Export

```javascript
const json = module.toJSON()
// → { baseNote: {...}, notes: [...] }
```

Serializes module to JSON format with expression source text.

### Import

```javascript
const module = Module.fromJSON(json)
```

1. Parse JSON
2. Create module with baseNote values
3. Add each note with expressions
4. Compile all expressions
5. Build dependency graph
6. Initial evaluation

## Internal State

```javascript
module._notes           // Map<id, Note>
module._nextId          // Next auto-increment ID
module._dependencyGraph // DependencyGraph instance
module._incrementalEvaluator // IncrementalEvaluator instance
module._dirtyNotes      // Set<noteId>
module._evaluationCache // Map<noteId, values>
```

## Thread Safety

The module is designed for single-threaded operation:
- WASM evaluation is synchronous
- No concurrent modification support
- UI updates should batch changes

## See Also

- [Data Flow](/developer/architecture/data-flow) - How data moves through the system
- [Note Class](/developer/api/note) - Note API reference
- [Dependency Graph](/developer/core/dependency-graph) - Dependency tracking details
- [Binary Evaluator](/developer/core/binary-evaluator) - Evaluation internals
