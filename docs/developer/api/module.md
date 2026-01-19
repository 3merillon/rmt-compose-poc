# Module Class

The Module class is the central data structure managing notes, dependencies, and evaluation.

## Constructor

```javascript
const module = new Module(baseNoteVariables = {})
```

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `baseNoteVariables` | object | `{}` | Initial values for BaseNote |

### BaseNote Defaults

```javascript
{
  frequency: 440,
  startTime: 0,
  duration: 1,
  tempo: 60,
  beatsPerMeasure: 4
}
```

## Properties

### baseNote

```javascript
module.baseNote  // Note (ID 0)
```

The reference note providing default values.

### notes

```javascript
module.notes  // Map<number, Note>
```

All notes in the module (excluding BaseNote).

## Note Management

### addNote()

```javascript
const note = module.addNote(variables = {})
```

Creates a new note with auto-assigned ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `variables` | object | Expression strings for properties |

Returns: The created `Note` object.

Example:
```javascript
const note = module.addNote({
  frequency: "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  startTime: "new Fraction(0)",
  duration: "new Fraction(1)"
})
```

### getNoteById()

```javascript
const note = module.getNoteById(id)
```

O(1) lookup of a note by ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | number | Note ID |

Returns: `Note` or `undefined`.

### removeNote()

```javascript
module.removeNote(id)
```

Removes a note and updates the dependency graph.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | number | Note ID to remove |

## Dependency Graph

### getDirectDependencies()

```javascript
const deps = module.getDirectDependencies(noteId)
// → Set<number>
```

Returns note IDs that this note directly references.

### getDependentNotes()

```javascript
const dependents = module.getDependentNotes(noteId)
// → Set<number>
```

Returns note IDs that reference this note.

### getDependentsByProperty()

```javascript
const byProp = module.getDependentsByProperty(noteId)
// → { frequency: [2, 5], startTime: [3], duration: [] }
```

Returns dependents categorized by which property they depend on.

### getParentChainByProperty()

```javascript
const chain = module.getParentChainByProperty(noteId, 'frequency')
// → [noteId, parentId, grandparentId, ...]
```

Returns the ancestor chain for a specific property.

### getChildrenTreeByProperty()

```javascript
const tree = module.getChildrenTreeByProperty(noteId, 'frequency')
// → [{id, depth}, ...]
```

Returns the descendant tree with depth information.

## Evaluation

### markNoteDirty()

```javascript
module.markNoteDirty(noteId)
```

Marks a note for re-evaluation. Cascades to dependents.

### markNotesDirtyBatch()

```javascript
module.markNotesDirtyBatch([1, 2, 3])
```

Efficiently marks multiple notes dirty.

### evaluateModule()

```javascript
const cache = module.evaluateModule()
// → Map<number, EvaluatedNote>
```

Evaluates all dirty notes and returns the cache.

### getEvaluationCache()

```javascript
const cache = module.getEvaluationCache()
```

Returns the current evaluation cache without re-evaluating.

### invalidateAll()

```javascript
module.invalidateAll()
```

Clears all caches and marks all notes dirty.

## Musical Lookups

### findTempo()

```javascript
const tempo = module.findTempo(note)
// → Fraction (BPM)
```

Finds the effective tempo for a note by walking the inheritance chain.

### findMeasureLength()

```javascript
const length = module.findMeasureLength(note)
// → Fraction (seconds)
```

Computes measure duration: `beatsPerMeasure / tempo * 60`.

### findInstrument()

```javascript
const instrument = module.findInstrument(note)
// → string
```

Traces frequency source to determine instrument name.

### generateMeasures()

```javascript
const measures = module.generateMeasures(fromNote, count)
// → Array<{time: number, index: number}>
```

Generates measure markers for visualization.

## Batch Operations

### batchSetExpressions()

```javascript
module.batchSetExpressions([
  { noteId: 1, property: 'frequency', expression: '...' },
  { noteId: 2, property: 'startTime', expression: '...' }
])
```

Efficiently updates multiple expressions with single dependency recalculation.

## Serialization

### toJSON()

```javascript
const json = module.toJSON()
// → { baseNote: {...}, notes: [...] }
```

Serializes module to JSON format.

### fromJSON() (static)

```javascript
const module = Module.fromJSON(json)
```

Creates a module from JSON data.

## Events

The module emits events through the EventBus:

| Event | When |
|-------|------|
| `player:invalidateModuleEndTimeCache` | Any note changes |

## Example Usage

```javascript
// Create module
const module = new Module({ tempo: 120 })

// Add notes
const note1 = module.addNote({
  frequency: "module.baseNote.getVariable('frequency')",
  startTime: "new Fraction(0)",
  duration: "new Fraction(60).div(module.findTempo(module.baseNote))"
})

const note2 = module.addNote({
  frequency: "module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))",
  startTime: "module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))",
  duration: "new Fraction(60).div(module.findTempo(module.baseNote))"
})

// Evaluate
const cache = module.evaluateModule()

// Read values
const freq = cache.get(note1.id).frequency.valueOf()  // 440
const freq2 = cache.get(note2.id).frequency.valueOf() // 660
```

## See Also

- [Note Class](/developer/api/note) - Note API
- [Module System](/developer/architecture/module-system) - Architecture
- [Dependency Graph](/developer/core/dependency-graph) - Dependency tracking
