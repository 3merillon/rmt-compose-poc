# Dependency Graph

The **Dependency Graph** tracks relationships between notes, enabling O(1) lookup for both dependencies and dependents.

## Overview

When a note's expression references another note, a dependency is created:

```
// Note 5 depends on Note 1
note5.frequency = [1].f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 5 depends on Note 1
note5.frequency = module.getNoteById(1).getVariable('frequency').mul(...)
```
</details>

The dependency graph maintains:
- **Forward index**: What does a note depend on?
- **Inverse index**: What depends on a note?

**Location**: `src/dependency-graph.js`

## Data Structures

### Forward Dependencies

```javascript
// dependencies: Map<noteId, Set<noteId>>
// "Note X depends on these notes"

dependencies = {
  5: Set([1, 2]),    // Note 5 depends on Notes 1 and 2
  3: Set([1]),       // Note 3 depends on Note 1
  4: Set([3]),       // Note 4 depends on Note 3
}
```

### Inverse Dependencies (Dependents)

```javascript
// dependents: Map<noteId, Set<noteId>>
// "These notes depend on Note X"

dependents = {
  1: Set([3, 5]),    // Notes 3 and 5 depend on Note 1
  2: Set([5]),       // Note 5 depends on Note 2
  3: Set([4]),       // Note 4 depends on Note 3
}
```

### Property-Specific Dependencies

The graph also tracks dependencies by property type:

```javascript
// Which notes' startTime depends on Note X's startTime
startTimeOnStartTimeDeps = {
  1: Set([2, 3]),
}

// Which notes' startTime depends on Note X's duration
startTimeOnDurationDeps = {
  1: Set([2]),
}

// Which notes' frequency depends on Note X's frequency
frequencyOnFrequencyDeps = {
  1: Set([2, 3, 4]),
}
```

## Class Structure

```javascript
class DependencyGraph {
  constructor() {
    // General dependencies
    this.dependencies = new Map();
    this.dependents = new Map();

    // Property-specific
    this.startTimeOnStartTime = new Map();
    this.startTimeOnDuration = new Map();
    this.frequencyOnFrequency = new Map();
    this.durationOnDuration = new Map();

    // BaseNote dependents
    this.baseNoteDependents = {
      startTime: new Set(),
      duration: new Set(),
      frequency: new Set(),
      tempo: new Set(),
    };
  }
}
```

## Building the Graph

### From Expression Bytecode

```javascript
buildFromModule(module) {
  this.clear();

  for (const note of module.notes) {
    this.analyzeNote(note);
  }
}

analyzeNote(note) {
  for (const varName of ['startTime', 'duration', 'frequency']) {
    const expr = note.getExpression(varName);
    const refs = this.extractReferences(expr);

    for (const ref of refs) {
      this.addDependency(note.id, ref.noteId, varName, ref.varName);
    }
  }
}
```

### Extracting References from Bytecode

```javascript
extractReferences(expr) {
  const refs = [];
  let pc = 0;

  while (pc < expr.length) {
    const op = expr[pc++];

    if (op === OP.LOAD_REF) {
      const noteId = this.readUint16(expr, pc); pc += 2;
      const varIdx = expr[pc++];
      refs.push({ noteId, varName: VAR_NAMES[varIdx] });
    } else if (op === OP.LOAD_BASE) {
      const varIdx = expr[pc++];
      refs.push({ noteId: 0, varName: VAR_NAMES[varIdx] });
    } else {
      pc += OPCODE_SIZES[op] - 1;
    }
  }

  return refs;
}
```

### Adding Dependencies

```javascript
addDependency(fromNoteId, toNoteId, fromVar, toVar) {
  // Forward
  if (!this.dependencies.has(fromNoteId)) {
    this.dependencies.set(fromNoteId, new Set());
  }
  this.dependencies.get(fromNoteId).add(toNoteId);

  // Inverse
  if (!this.dependents.has(toNoteId)) {
    this.dependents.set(toNoteId, new Set());
  }
  this.dependents.get(toNoteId).add(fromNoteId);

  // Property-specific (e.g., startTime on duration)
  const key = `${fromVar}On${capitalize(toVar)}`;
  if (this[key]) {
    if (!this[key].has(toNoteId)) {
      this[key].set(toNoteId, new Set());
    }
    this[key].get(toNoteId).add(fromNoteId);
  }
}
```

## Query Operations

### Get Dependencies

```javascript
// What does Note 5 depend on?
getDependencies(noteId) {
  return this.dependencies.get(noteId) || new Set();
}
// Returns: Set([1, 2])
```

### Get Dependents

```javascript
// What depends on Note 1?
getDependents(noteId) {
  return this.dependents.get(noteId) || new Set();
}
// Returns: Set([3, 5])
```

### Get Cascade (Transitive Dependents)

```javascript
// All notes affected if Note 1 changes
getCascade(noteId) {
  const affected = new Set();
  const queue = [noteId];

  while (queue.length > 0) {
    const current = queue.shift();
    const deps = this.getDependents(current);

    for (const dep of deps) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);
      }
    }
  }

  return affected;
}
```

### Property-Specific Query

```javascript
// Which notes' startTime depends on Note 2's duration?
// (Used for drag previews)
getStartTimeDependentsOnDuration(noteId) {
  return this.startTimeOnDuration.get(noteId) || new Set();
}
```

## Use Cases

### Smart Drag Preview

When dragging Note 1:

```javascript
// Only move notes whose startTime actually depends on Note 1
const affectedNotes = graph.getStartTimeDependentsOnDuration(1);

for (const noteId of affectedNotes) {
  // Show preview position for this note
  previewNote(noteId, newPosition);
}
```

Notes with only frequency dependencies don't move in the preview.

### Incremental Evaluation

When Note 3 changes:

```javascript
// Mark Note 3 and all dependents as dirty
const dirtySet = graph.getCascade(3);
dirtySet.add(3);

// Evaluate only dirty notes
for (const noteId of topologicalSort(dirtySet)) {
  evaluate(noteId);
}
```

### Circular Dependency Detection

```javascript
wouldCreateCycle(fromNoteId, toNoteId) {
  // Check if toNoteId eventually depends on fromNoteId
  const reachable = this.getCascade(toNoteId);
  return reachable.has(fromNoteId);
}

// Before adding a new reference:
if (graph.wouldCreateCycle(noteA, noteB)) {
  throw new Error('Circular dependency detected');
}
```

### Dependency Visualization

```javascript
// For UI: get all lines to draw
getVisualizationData(selectedNoteId) {
  return {
    // Blue lines: what this note depends on
    dependencies: this.getDependencies(selectedNoteId),
    // Red lines: what depends on this note
    dependents: this.getDependents(selectedNoteId),
  };
}
```

## Topological Sort

For correct evaluation order:

```javascript
topologicalSort(notes) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  const visit = (noteId) => {
    if (visited.has(noteId)) return;
    if (visiting.has(noteId)) {
      throw new Error('Circular dependency');
    }

    visiting.add(noteId);

    // Visit dependencies first
    for (const dep of this.getDependencies(noteId)) {
      visit(dep);
    }

    visiting.delete(noteId);
    visited.add(noteId);
    sorted.push(noteId);
  };

  for (const noteId of notes) {
    visit(noteId);
  }

  return sorted;
}
```

## Performance

### O(1) Operations

| Operation | Time |
|-----------|------|
| getDependencies(id) | O(1) |
| getDependents(id) | O(1) |
| addDependency() | O(1) |
| removeDependency() | O(1) |

### Space Complexity

| Storage | Size |
|---------|------|
| Forward index | O(edges) |
| Inverse index | O(edges) |
| Property-specific | O(edges) |

Total: ~3× the number of dependency edges.

### Comparison

Without inverted index:
```javascript
// Slow: O(n) scan
getDependents(targetId) {
  const result = [];
  for (const note of allNotes) {
    if (note.references(targetId)) {
      result.push(note);
    }
  }
  return result;
}
```

With inverted index:
```javascript
// Fast: O(1) lookup
getDependents(targetId) {
  return this.dependents.get(targetId) || new Set();
}
```

## Maintaining the Graph

### On Note Update

```javascript
onNoteUpdated(noteId, oldExpr, newExpr) {
  // Remove old dependencies
  const oldRefs = this.extractReferences(oldExpr);
  for (const ref of oldRefs) {
    this.removeDependency(noteId, ref.noteId);
  }

  // Add new dependencies
  const newRefs = this.extractReferences(newExpr);
  for (const ref of newRefs) {
    this.addDependency(noteId, ref.noteId);
  }
}
```

### On Note Delete

```javascript
onNoteDeleted(noteId) {
  // Remove from all indices
  this.dependencies.delete(noteId);

  // Remove from inverse index
  for (const [depId, dependents] of this.dependents) {
    dependents.delete(noteId);
  }
  this.dependents.delete(noteId);

  // Update property-specific indices similarly
}
```

## See Also

- [Binary Evaluator](./binary-evaluator) - Uses graph for evaluation order
- [Expression Compiler](./expression-compiler) - Source of reference extraction
- [Dependencies](/user-guide/notes/dependencies) - User documentation
