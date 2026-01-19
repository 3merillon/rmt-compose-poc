# Data Flow

This document describes how data flows through RMT Compose from user input to audio output.

## High-Level Overview

```
User Input → Module → Expression Compiler → Binary Evaluator → Renderer/Audio
```

## Complete Data Flow

### 1. User Edits Expression

When a user modifies a note's expression in the Variable Widget:

```
User types expression text
       ↓
Note.setVariable(name, value)
       ↓
Note._setExpression(name, exprText)
       ↓
ExpressionCompiler.compile(exprText) → BinaryExpression
       ↓
Note._notifyChange()
       ↓
EventBus.emit('player:invalidateModuleEndTimeCache')
```

### 2. Module Marks Dirty

The module tracks which notes need re-evaluation:

```
Module.markNoteDirty(noteId)
       ↓
_registerNoteDependencies(noteId)
  - Extract dependencies from bytecode
  - Update dependency graph
       ↓
Mark all dependent notes dirty (cascade)
       ↓
_incrementalEvaluator.invalidate(noteId)
```

### 3. Evaluation

When evaluation is triggered (e.g., before rendering or playback):

```
Module.evaluateModule()
       ↓
_incrementalEvaluator.evaluateDirty()
       ↓
Topological sort dirty notes
  - Ensures dependencies evaluate before dependents
       ↓
For each note in sorted order:
  - Register bytecode with WASM (if changed)
  - Evaluate expression
       ↓
Single WASM call: evaluateDirty(sortedIds)
       ↓
Returns evaluation cache (Map<noteId, values>)
       ↓
_updateCorruptionFlags(cache)
  - Mark irrational values for TET visualization
```

### 4. Rendering

The renderer reads from the evaluation cache:

```
evaluateModule() returns cache
       ↓
Renderer.render(module, cache)
       ↓
For each note:
  - Read evaluated values: startTime, duration, frequency
  - Convert to world coordinates
  - Add to instance buffers
       ↓
GPU instanced draw call
```

### 5. Audio Playback

Audio uses a streaming model with lookahead:

```
Player.preparePlayback(module, fromTime)
       ↓
evaluateModule() → cache
       ↓
Build noteDataList from cache
  - {id, startTime, duration, frequency, instrument}
       ↓
AudioEngine.play(noteDataList)
       ↓
Streaming loop (every 100ms):
  - Find notes within LOOKAHEAD window (2 seconds)
  - Schedule oscillators for those notes
  - Apply envelopes
       ↓
Web Audio API plays scheduled notes
```

## Dependency Propagation

When a note changes, dependents are updated:

```
Note 1 frequency changes
       ↓
Module.markNoteDirty(1)
       ↓
DependencyGraph.getDependentNotes(1)
  → Returns [2, 3, 5] (notes that reference Note 1)
       ↓
markNoteDirty(2), markNoteDirty(3), markNoteDirty(5)
       ↓
Topological sort ensures Note 1 evaluates before 2, 3, 5
```

## Caching Strategy

### Expression Cache
- Compiled bytecode cached in BinaryExpression objects
- Only recompiles when expression text changes

### Evaluation Cache
- Map<noteId, {startTime, duration, frequency, ...}>
- Invalidated when note is marked dirty
- Lazy conversion from WASM fractions to Fraction.js

### Render Cache
- Instance buffers rebuilt each frame
- Position/color data cached per note
- Only dirty notes update their buffer entries

## WASM vs JavaScript Path

```
                    ┌─────────────────┐
                    │ WASM Available? │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ Yes                         │ No
              ▼                             ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│ WasmPersistentEvaluator │    │ JavaScript Evaluator    │
│ - O(N) batch evaluation │    │ - Per-note evaluation   │
│ - Cache in WASM memory  │    │ - Cache in JS Map       │
│ - No serialization      │    │ - Fraction.js objects   │
└─────────────────────────┘    └─────────────────────────┘
```

## Event Flow

Key events in the system:

| Event | Trigger | Handler |
|-------|---------|---------|
| `player:invalidateModuleEndTimeCache` | Note change | Player clears end time cache |
| Note dirty | Expression change | Module re-registers dependencies |
| Playback start | User clicks play | AudioEngine schedules notes |
| Playback stop | User clicks stop | AudioEngine stops all oscillators |

## Performance Optimizations

1. **Incremental evaluation**: Only dirty notes re-evaluate
2. **Topological sort**: O(V + E) ensures correct order
3. **WASM batch evaluation**: Single call for all dirty notes
4. **Instanced rendering**: All notes in one draw call
5. **Streaming audio**: Notes scheduled just-in-time

## See Also

- [System Architecture](/developer/architecture/overview) - Component overview
- [Module System](/developer/architecture/module-system) - Module internals
- [Binary Evaluator](/developer/core/binary-evaluator) - Evaluation details
- [Dependency Graph](/developer/core/dependency-graph) - Dependency tracking
