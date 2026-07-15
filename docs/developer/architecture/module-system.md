---
title: Module System
description: The Module class in RMT Compose — construction, notes, dependency queries, evaluation, JSON load and save, reindexing, and the WASM hot-swap.
---

# Module System

`Module` (`src/module.js`) is the composition. It owns the notes, the dependency graph, the
evaluators, the dirty set, and both ends of the JSON pipeline. Everything else in the app reaches a
note through it.

## Construction

```javascript
const module = new Module(baseNoteVariables = {})
```

This creates:

- **The BaseNote** — a `Note` with id `0`, stored both as `module.baseNote` and as `module.notes[0]`.
- `module.notes` — a **plain object** keyed by numeric-string id. Not a `Map`.
- `module.nextId = 1` — the auto-increment counter for `addNote()`.
- A `DependencyGraph`, a `BinaryEvaluator` and an `IncrementalEvaluator`.
- An empty `_evaluationCache` and a `_dirtyNotes` set seeded with `0`.

```javascript
module.notes[5]          // ✅ a Note, or undefined
module.getNoteById(5)    // ✅ the same thing
module.notes.get(5)      // ❌ TypeError — notes is not a Map
```

### BaseNote defaults

With no JSON, the BaseNote is seeded from `defaultBaseNoteVariables` (`src/module.js:76-88`):

| Property | Stored expression | Evaluates to |
|---|---|---|
| `frequency` | `new Fraction(440)` | 440 Hz |
| `startTime` | `new Fraction(0)` | 0 s |
| `tempo` | `new Fraction(60)` | 60 BPM |
| `beatsPerMeasure` | `new Fraction(4)` | 4 |
| `measureLength` | `new Fraction(60).div(module.findTempo(module.baseNote)).mul(module.baseNote.getVariable('beatsPerMeasure'))` | 4 s |

There is **no `duration` default on the BaseNote** — it has none.

::: warning These defaults are still legacy-format strings
The DSL migration did not touch them. Every *shipped* module JSON is DSL, so a user never sees these,
but "everything is DSL now" is not true of the code-level fallback. It also means
`createModuleJSON()` emits that `measureLength` legacy chain on the BaseNote **even when the source
file omitted the key** — so a saved file is almost never pure DSL.
:::

The BaseNote a fresh user actually sees comes from `public/modules/defaultModule.json`:
frequency `263`, startTime `0`, tempo `100`, beatsPerMeasure `4`.

## Note management

### Adding

```javascript
const note = module.addNote({
  frequency: 'base.f * (3/2)',
  startTime: 'base.t',
  duration:  'beat(base)'
})
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
const note = module.addNote({
  frequency: "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  startTime: "module.baseNote.getVariable('startTime')",
  duration:  "new Fraction(60).div(module.findTempo(module.baseNote))"
})
```
</details>

`addNote()` assigns `id = this.nextId++`, compiles each expression to bytecode, registers the note's
dependencies, marks it dirty, invalidates the module end-time cache, and returns the `Note`.

Any of the six expression keys is optional. Which ones a note *has* is what determines its kind:

| Kind | Rule |
|---|---|
| Measure bar | has `startTime`, no `duration`, no `frequency` |
| Silence | has `startTime` and `duration`, no `frequency` |
| Note | has `startTime`, `duration` and `frequency` |

### Removing

```javascript
module.removeNote(id)
```

Deletes the note from `notes`, drops its evaluation-cache entry, removes it from the dependency
graph, and invalidates the end-time cache.

::: warning `removeNote()` does not touch dependents
Their expressions still reference the deleted id. On the next evaluation, `LOAD_REF` fails to resolve
and pushes a hard-coded default (`frequency 440`, `startTime 0`, `duration 1`) without warning. If
you want the dependents' *meaning* preserved, liberate them first — that is exactly what the note
widget's **Keep Dependencies** delete does.
:::

### Accessing

```javascript
module.getNoteById(id)   // O(1) — just notes[id]
module.baseNote          // the id-0 note
module.notes             // plain object: { '0': Note, '1': Note, … }
module.nextId            // next id addNote() will hand out
```

## Dependency queries

All of these delegate to the `DependencyGraph`. **They return Arrays**, not Sets.

```javascript
module.getDirectDependencies(noteId)   // → number[] — what this note references, one hop
module.getDependentNotes(noteId)       // → number[] — TRANSITIVE closure of what depends on it
```

`getDependentNotes(0)` additionally folds in `getBaseNoteDependents()` — every note whose expression
mentions `base.*` — because the BaseNote is deliberately not a graph edge.

### Property-specific

The coloured dependency lines and the drag preview both come from here:

```javascript
module.getDependentsByProperty(noteId)
// → { frequency: [2, 5], startTime: [3], duration: [3] }
```

Read it as *"which notes would **move** if I changed this property of this note?"* — orange =
frequency, teal = startTime, purple = duration. It is backed by three BFS traversals
(`getAllAffectedByFrequencyChange`, `…ByStartTimeChange`, `…ByDurationChange`), so it follows chains
across properties: note A's duration can move note B's startTime, which can move note C's frequency.

```javascript
module.getDirectDependenciesByProperty(noteId)
// → { frequency: [...], startTime: [...], duration: [...] } — the other direction, one hop

module.getParentChainByProperty(noteId, 'frequency')
// → number[] walking back to the root, EXCLUDING noteId, terminating with 0 if it references base

module.getChildrenTreeByProperty(noteId, 'startTime')
// → { edges: [{parentId, childId, depth}], maxDepth }

module.getChildrenTreeByAllProperties(noteId)
// → { edgesByProperty: { frequency: [], startTime: [], duration: [] }, maxDepth }
```

`getChildrenTreeByAllProperties()` does all three in one traversal — the renderer calls it every
frame during a drag, so it is cached on `anchorId|_posEpoch|_sceneEpoch`.

### Registration

```javascript
module._registerNoteDependencies(note)   // takes a Note OBJECT, not an id
```

It scans the note's compiled bytecode for `LOAD_REF` / `LOAD_BASE` and rewrites the note's rows in
roughly fifteen graph maps — the all-property pair, plus the startTime, frequency and duration
indexes.

It is **memoized and usually skipped**. The key is
`` `${module._depsRegGeneration}:${note.id}:${note._depsEpoch}` ``. `_depsEpoch` is bumped on every
expression mutation; `_depsRegGeneration` is bumped whenever the graph is rebuilt. So the cascade
that calls this for every dependent of an edited note does almost no work for the ones that did not
actually change.

## Evaluation lifecycle

### Marking dirty

```javascript
module.markNoteDirty(noteId)        // one note + its transitive dependents
module.markNotesDirtyBatch(noteIds) // many notes, one pass
```

`markNoteDirty()` re-registers the note, calls `invalidate()` on the incremental evaluator (its
bytecode may have changed), then marks every transitive dependent with **`markDirtyOnly()`** — they
need re-evaluating but must not be re-registered. If the note *is* the BaseNote, every
`baseNoteDependents` entry is marked too.

`markNotesDirtyBatch()` additionally pulls in the transitive **dependencies** of the dirty notes, not
just the dependents. This matters: an evaluator cache clear would otherwise leave a dependency's
value missing when its dependent tries to load it.

### Batch expression writes

```javascript
module.batchSetExpressions([
  { noteId: 1, varName: 'frequency', expr: 'base.f * (3/2)' },
  { noteId: 2, varName: 'startTime', expr: '[1].t + [1].d' },
])
```

The payload keys are **`noteId`, `varName`, `expr`** — not `property` / `expression`. A `varName` may
carry the `String` suffix (`'frequencyString'`); it is stripped.

Three phases: apply every change silently (no per-note `_notifyChange`), re-register each affected
note once, then one `markNotesDirtyBatch()`.

Its only caller is **Evaluate Module** (`evaluateEntireModule()`). **Evaluate to BaseNote** rewrites a
single note and goes through the ordinary `setVariable()` path instead.

### Evaluating

```javascript
const cache = module.evaluateModule()   // → Map<noteId, result>
```

Returns the existing cache immediately if nothing is dirty. Otherwise it snapshots the dirty set,
runs `IncrementalEvaluator.evaluateDirty()` (Kahn topo-sort → stack VM), pushes each result's
`corruptionFlags` into the graph via `_updateCorruptionFlags(cache, dirtyIds)`, and clears the dirty
set.

It is **reentrancy-guarded**. Bytecode evaluation can re-enter through `getEvaluationCache()`; on a
reentrant call it serves the in-progress cache rather than restarting the whole dirty set.

A result:

```javascript
{ startTime, duration, frequency, tempo, beatsPerMeasure, measureLength, corruptionFlags }
```

```javascript
module.getEvaluationCache()               // evaluates first if dirty, then returns the Map
module.evaluateNoteVariable(id, 'frequency')  // one value, or null
module.invalidateAll()                    // clear caches, mark every note dirty
module.getPoolStats()                     // FractionPool stats from the evaluator
module.getDependencyGraph()               // the graph, for debugging
```

## Musical lookups

```javascript
module.findTempo(note)          // → Fraction (BPM)
module.findMeasureLength(note)  // → Fraction (seconds) = beatsPerMeasure / tempo * 60
module.findInstrument(note)     // → string
```

`findTempo` and `findMeasureLength` walk up `note.parentId` looking for a note that declares the
property, falling back to the BaseNote.

::: danger `parentId` is not persisted
`Note` never initializes `parentId`, and `createModuleJSON()` never writes it. It is only ever set
imperatively — by `generateMeasures()`, by module import, and by `reindexModule()`. So for a module
loaded from JSON, every note's `parentId` is `undefined` and the ancestry walk in `findTempo()` /
`findMeasureLength()` terminates immediately at the BaseNote. Do not rely on it surviving a
save-and-reload.
:::

`findInstrument(note)` is different — it does not use `parentId`. It reads the note's own
`properties.instrument`, and if absent, parses the note's **frequency expression** for a parent
reference (`[N].f` in DSL, `module.getNoteById(N).getVariable('frequency')` in legacy) and recurses
into that note. The terminal fallback is the module-level default instrument, driven by the
`audio.defaultInstrument` setting through `setDefaultInstrument()` (default `sine-wave`).

## Measures

```javascript
module.generateMeasures(fromNote, n)   // → Note[] (already added to the module)
```

These are **real notes**, not markers — measure-bar notes, which is to say notes with a `startTime`
and nothing else. Each is chained to the previous one and gets a `parentId`. The expression it writes
depends on the format of the previous note's startTime:

```
[5].t + measure([5])       # DSL
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(5).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(5)))
```
</details>

## Serialization

There is **no `toJSON()` and no `fromJSON()`**. `src/module-serializer.js` exists but is imported by
nothing — it is dead code.

### Load

```javascript
const module = await Module.loadFromJSON(source)   // static, ASYNC
```

`source` is either a **URL string** (fetched) or a **plain object**. The steps:

1. Copy `data.baseNote`'s keys into the BaseNote variables and `new Module(baseVars)`.
2. For each entry in `data.notes`, validate the id, build a `Note`, install it at `notes[id]`,
   register its dependencies, and advance `nextId`.
3. `invalidateAll()` — mark everything dirty. It does **not** evaluate; the first
   `evaluateModule()` does that.

Ids are guarded (`module.js:844-861`): non-integer, `< 0` or `> 100000` ids are skipped with a
`[RMT Security] Invalid note ID` warning, and `__proto__` / `constructor` / `prototype` are blocked
outright as prototype-pollution vectors.

### Save

```javascript
const obj  = module.createModuleJSON()        // → { baseNote: {...}, notes: [...] }
const text = await module.exportOrderedModule()  // → pretty JSON string (2-space)
```

`createModuleJSON()` emits each note's **verbatim expression source text**
(`note.getExpressionSource(name)`) plus `color` and `instrument` when set, sorted by id. Saving does
**not** convert legacy expressions to DSL.

`exportOrderedModule()` is what the **Save Module** button downloads. It is *not* a byte copy of what
you loaded: it round-trips through `createModuleJSON()` → `loadFromJSON()` → `reindexModule()` →
`stringify`.

### Reindexing

```javascript
module.reindexModule()
```

Renumbers from 1 — **measures first** (sorted by evaluated `startTime`), then regular notes (also by
`startTime`) — and rewrites every `[N]` and `module.getNoteById(N)` reference to match. Then it
rebuilds the dependency graph and re-evaluates.

::: warning Ids change on save
Because `exportOrderedModule()` reindexes, the ids in a downloaded `module.json` will generally
differ from the ids you saw on screen. There is no byte-stable round-trip.
:::

## Module end time

```javascript
module.getModuleEndTime()   // → seconds
```

The later of (last measure's start + its measure length) and (last note's start + duration).

::: warning The memo is module-level, not per-instance
`memoizedModuleEndTime` is a file-scope `let` in `src/module.js`, shared by every `Module` in the
process. It is cleared by the exported `invalidateModuleEndTimeCache()`, which `Note._notifyChange()`
fires (via `player:invalidateModuleEndTimeCache`) on every expression change. If you ever hold two
`Module` instances at once — `exportOrderedModule()` transiently does — they share this memo.
:::

## The WASM hot-swap

WASM init is async and normally loses the race against `Module` construction, which used to strand
every module on the JS evaluator for the whole session. The constructor therefore registers an
`onWasmReady` callback holding a `WeakRef(this)`, and `_upgradeEvaluators()` (`module.js:133`)
atomically swaps `_binaryEvaluator` and `_incrementalEvaluator` for the WASM versions, clears the
evaluation cache, and marks everything dirty so the next evaluation runs on the new engine. Values are
identical across engines, so nothing goes visually stale mid-swap.

::: warning It never runs in a browser
The registration is gated on `isEvaluatorHotSwapEnabled()`, which returns `false` in a browser unless
the URL carries `?evaluator=wasm`. In production, `_upgradeEvaluators()` is never called. It runs in
headless Node so the benches and `scripts/perf/test-wasm-swap.mjs` can exercise it.
:::

The practical consequence for anyone holding an evaluator reference: it can be **replaced between
synchronous operations**, and so can the whole `_evaluationCache`. Do not cache them.

## Threading

Single-threaded by design. Evaluation is synchronous, there is no concurrent-modification support,
and UI code should batch its writes rather than interleave them with reads.

## See also

- [Data Flow](/developer/architecture/data-flow) — where these calls happen in a real edit
- [Module Class API](/developer/api/module) — the reference table
- [Note Class](/developer/api/note)
- [Dependency Graph](/developer/core/dependency-graph)
- [Binary Evaluator](/developer/core/binary-evaluator)
- [Module Schema](/reference/module-schema) — the JSON on disk
