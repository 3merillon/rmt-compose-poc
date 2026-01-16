# Property-Colored Dependency Visualization

## Summary
Extend the dependency display system to show three distinct colors for the three dependency property types (frequency, startTime, duration), with different visual treatments for dependencies vs dependents, and appropriate dimming during drag operations.

## Color Scheme
| Property   | Dependency (brighter, thicker) | Dependent (dimmer, thinner) |
|------------|--------------------------------|-----------------------------|
| Frequency  | Orange [1.0, 0.5, 0.0, 0.9]    | Orange [1.0, 0.5, 0.0, 0.4] |
| StartTime  | Teal [0.0, 1.0, 1.0, 0.9]      | Teal [0.0, 1.0, 1.0, 0.4]   |
| Duration   | Purple [0.615, 0.0, 1.0, 0.9]  | Purple [0.615, 0.0, 1.0, 0.4] |

During drag: frequency/duration links dimmed to alpha ~0.15, startTime links full brightness.

---

## Phase 1: Extend DependencyGraph for Frequency/Duration Tracking

**File:** `src/dependency-graph.js`

Currently tracks startTime-specific dependencies. Add parallel tracking for frequency and duration expressions.

### Add New Properties (after line 34):
```javascript
// Frequency-specific dependency tracking
this.frequencyDependencies = new Map();      // noteId -> Set<noteId its frequency depends on>
this.frequencyDependents = new Map();        // noteId -> Set<noteId whose frequency depends on it>
this.frequencyOnFrequencyDependents = new Map();  // noteId -> Set<noteId whose freq depends on this note's freq>
this.frequencyOnStartTimeDependents = new Map();
this.frequencyOnDurationDependents = new Map();
this.frequencyBaseNoteDependents = new Set();

// Duration-specific dependency tracking
this.durationDependencies = new Map();
this.durationDependents = new Map();
this.durationOnFrequencyDependents = new Map();
this.durationOnStartTimeDependents = new Map();
this.durationOnDurationDependents = new Map();
this.durationBaseNoteDependents = new Set();
```

### Add New Methods:
1. `registerFrequencyDependencies(noteId, frequencyExpr)` - mirrors `registerStartTimeDependencies`
2. `registerDurationDependencies(noteId, durationExpr)` - mirrors `registerStartTimeDependencies`
3. `_updateFrequencyDependencies(noteId, newDeps, referencesBase)` - update forward/inverse maps
4. `_updateDurationDependencies(noteId, newDeps, referencesBase)` - update forward/inverse maps
5. `_updateFrequencyPropertyDependencies(noteId, propDeps)` - track which property of each dep is referenced
6. `_updateDurationPropertyDependencies(noteId, propDeps)` - track which property of each dep is referenced
7. `getFrequencyDependents(noteId)`, `getDurationDependents(noteId)` - O(1) lookups
8. `getAllFrequencyDependents(noteId)`, `getAllDurationDependents(noteId)` - BFS traversals

### Update `removeNote(noteId)`:
Clear entries from all new maps when a note is deleted.

### Update `clear()`:
Clear all new maps.

---

## Phase 2: Register Frequency/Duration Dependencies in Module

**File:** `src/module.js`

### Modify `_registerNoteDependencies(note)` (around line 89):
```javascript
_registerNoteDependencies(note) {
  const allDeps = note.getAllDependencies();
  const refsBase = note.referencesBaseNote();
  this._dependencyGraph._updateDependencies(note.id, allDeps, refsBase);

  // Existing: startTime-specific registration
  const startTimeExpr = note.getExpression('startTime');
  this._dependencyGraph.registerStartTimeDependencies(note.id, startTimeExpr);

  // NEW: frequency-specific registration
  const freqExpr = note.getExpression('frequency');
  this._dependencyGraph.registerFrequencyDependencies(note.id, freqExpr);

  // NEW: duration-specific registration
  const durExpr = note.getExpression('duration');
  this._dependencyGraph.registerDurationDependencies(note.id, durExpr);
}
```

### Add New Query Methods:
```javascript
/**
 * Get dependencies categorized by which expression of THIS note references them
 * @returns {{ frequency: number[], startTime: number[], duration: number[] }}
 */
getDirectDependenciesByProperty(noteId) {
  const note = this.getNoteById(noteId);
  if (!note) return { frequency: [], startTime: [], duration: [] };

  const graph = this._dependencyGraph;
  return {
    frequency: Array.from(graph.frequencyDependencies.get(noteId) || new Set()),
    startTime: Array.from(graph.startTimeDependencies.get(noteId) || new Set()),
    duration: Array.from(graph.durationDependencies.get(noteId) || new Set())
  };
}

/**
 * Get dependents categorized by which property of THIS note they reference
 * @returns {{ frequency: number[], startTime: number[], duration: number[] }}
 */
getDependentsByProperty(noteId) {
  const graph = this._dependencyGraph;
  // Notes whose expression references this note's frequency/startTime/duration
  const freqSet = new Set([
    ...(graph.frequencyOnFrequencyDependents.get(noteId) || []),
    ...(graph.startTimeOnFrequencyDependents?.get(noteId) || []),  // if tracked
    ...(graph.durationOnFrequencyDependents?.get(noteId) || [])
  ]);
  // etc. for startTime and duration
  return {
    frequency: Array.from(freqSet),
    startTime: Array.from(startTimeSet),
    duration: Array.from(durationSet)
  };
}
```

---

## Phase 3: Extend Renderer Highlight System for 3 Colors

**File:** `src/renderer/webgl2/renderer.js`

### Replace Single-Color Arrays with Property-Categorized (around line 225):
```javascript
// Replace:
// this._relDepsIdx = null;
// this._relRdepsIdx = null;

// With:
this._relDepsIdxByProperty = { frequency: null, startTime: null, duration: null };
this._relRdepsIdxByProperty = { frequency: null, startTime: null, duration: null };
this._relDepsMeasureIdsByProperty = { frequency: null, startTime: null, duration: null };
this._relRdepsMeasureIdsByProperty = { frequency: null, startTime: null, duration: null };
this._relDepsHasBaseByProperty = { frequency: false, startTime: false, duration: false };
this._relRdepsHasBaseByProperty = { frequency: false, startTime: false, duration: false };
```

### Update `_depHighlightCache` Structure (line 236):
```javascript
this._depHighlightCache = {
  noteId: null,
  posEpoch: null,
  depsByProperty: { frequency: null, startTime: null, duration: null },
  rdepsByProperty: { frequency: null, startTime: null, duration: null },
  // ... indices, measures, base flags per property
};
```

### Modify `sync()` Dependency Computation:
When selection changes, call `module.getDirectDependenciesByProperty(selId)` and `module.getDependentsByProperty(selId)` to populate the categorized arrays.

### Modify Highlight Ring Drawing:
```javascript
const HIGHLIGHT_COLORS = {
  frequency: { dep: [1.0, 0.5, 0.0, 0.9], rdep: [1.0, 0.5, 0.0, 0.4] },
  startTime: { dep: [0.0, 1.0, 1.0, 0.9], rdep: [0.0, 1.0, 1.0, 0.4] },
  duration:  { dep: [0.615, 0.0, 1.0, 0.9], rdep: [0.615, 0.0, 1.0, 0.4] }
};
const DEP_THICKNESS = 2.5;
const RDEP_THICKNESS = 1.5;

for (const prop of ['startTime', 'frequency', 'duration']) {
  const depsIdx = this._relDepsIdxByProperty?.[prop];
  const rdepsIdx = this._relRdepsIdxByProperty?.[prop];
  if (depsIdx?.length) drawIdxList(depsIdx, HIGHLIGHT_COLORS[prop].dep, DEP_THICKNESS);
  if (rdepsIdx?.length) drawIdxList(rdepsIdx, HIGHLIGHT_COLORS[prop].rdep, RDEP_THICKNESS);
}
```

---

## Phase 4: Extend Link Line Rendering for Multiple Colors

**File:** `src/renderer/webgl2/renderer.js`

### Option: Per-Property Buffer Pairs
Create 6 endpoint buffers (2 per property: deps + rdeps):
```javascript
this._linkBuffersByProperty = {
  frequency: { depsEndpoints: null, rdepsEndpoints: null, depsCount: 0, rdepsCount: 0 },
  startTime: { depsEndpoints: null, rdepsEndpoints: null, depsCount: 0, rdepsCount: 0 },
  duration:  { depsEndpoints: null, rdepsEndpoints: null, depsCount: 0, rdepsCount: 0 }
};
```

### Modify Link Line Building:
When rebuilding link endpoints, separate by property:
```javascript
for (const prop of ['frequency', 'startTime', 'duration']) {
  const depsIdx = this._relDepsIdxByProperty[prop];
  const rdepsIdx = this._relRdepsIdxByProperty[prop];
  // Build endpoints for each...
}
```

### Modify Link Line Drawing:
Draw 6 batches with appropriate colors:
```javascript
const LINE_COLORS = {
  frequency: { dep: [1.0, 0.5, 0.0, 0.6], rdep: [1.0, 0.5, 0.0, 0.25] },
  startTime: { dep: [0.0, 1.0, 1.0, 0.6], rdep: [0.0, 1.0, 1.0, 0.25] },
  duration:  { dep: [0.615, 0.0, 1.0, 0.6], rdep: [0.615, 0.0, 1.0, 0.25] }
};

for (const prop of ['frequency', 'startTime', 'duration']) {
  gl.uniform4fv(uColor, LINE_COLORS[prop].dep);
  gl.uniform1f(uThickness, 2.0);
  // Draw deps lines...

  gl.uniform4fv(uColor, LINE_COLORS[prop].rdep);
  gl.uniform1f(uThickness, 1.0);
  // Draw rdeps lines...
}
```

---

## Phase 5: Handle Overlapping Dependencies

When a note appears in multiple property categories (e.g., both frequency AND startTime):
- Draw ALL applicable rings/lines (visual stacking)
- Each ring drawn separately in its property color
- This clearly communicates multi-property relationships

---

## Phase 6: Drag/Resize Display with Dimmed Non-Moving Links

**File:** `src/renderer/webgl2/renderer.js`

### During Active Drag:
Apply different alphas based on property type:
```javascript
const isDragging = this._dragActive;

const DRAG_LINE_COLORS = isDragging ? {
  // StartTime: full brightness (these actually change)
  startTime: { dep: [0.0, 1.0, 1.0, 0.6], rdep: [0.0, 1.0, 1.0, 0.3] },
  // Frequency/Duration: heavily dimmed (informational only, don't move)
  frequency: { dep: [1.0, 0.5, 0.0, 0.15], rdep: [1.0, 0.5, 0.0, 0.08] },
  duration:  { dep: [0.615, 0.0, 1.0, 0.15], rdep: [0.615, 0.0, 1.0, 0.08] }
} : LINE_COLORS;  // Use normal colors when not dragging
```

### Preserve Current Behavior:
- Only startTime-dependent notes move (already handled by `getAllStartTimeOnStartTimeDependents`)
- Frequency/duration link endpoints stay static (notes don't move)
- Shows user which relationships exist but won't be affected by the drag

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/dependency-graph.js` | Add frequency/duration tracking maps, registration methods, cleanup |
| `src/module.js` | Call new registration methods, add `getDirectDependenciesByProperty`, `getDependentsByProperty` |
| `src/renderer/webgl2/renderer.js` | Property-categorized highlight arrays, multi-color ring drawing, multi-color link lines, drag dimming |
| `src/binary-note.js` | No changes needed (VAR indices already defined: 0=startTime, 1=duration, 2=frequency) |

---

## Verification Plan

1. **Selection Test:**
   - Select a note that has dependencies on different properties
   - Verify orange rings for frequency deps, teal for startTime, purple for duration
   - Verify dependents shown in same colors but dimmer/thinner

2. **Link Line Test:**
   - Select a note with mixed dependencies
   - Verify link lines match ring colors (orange/teal/purple)

3. **Drag Test:**
   - Drag a note that has dependents
   - Verify startTime links remain bright, frequency/duration links dim
   - Verify only startTime-dependent notes move (existing behavior preserved)

4. **Resize Test:**
   - Resize a note that has duration-dependents
   - Verify duration links remain bright, others dim
   - Verify only duration-affected notes move

5. **Base Note Test:**
   - Select a note that depends on baseNote
   - Verify baseNote highlight ring shows appropriate property color

6. **Performance Test:**
   - Select notes with many dependencies
   - Verify no frame rate degradation (3x buffer count but same GPU operations)
