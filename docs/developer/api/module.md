---
title: Module Class
description: API reference for the Module class in src/module.js — notes, dependency queries, evaluation, musical lookups, and JSON round-trip.
---

# Module Class

`Module` (`src/module.js`) owns a composition: the BaseNote, every other note, the dependency
graph, and the incremental evaluator that turns compiled expressions into numbers.

```javascript
import { Module, invalidateModuleEndTimeCache, setDefaultInstrument, getDefaultInstrument } from './module.js'
```

The class holds no DOM and no audio state. It is importable from Node — the perf benches
(`scripts/perf/bench-node.mjs`) do exactly that.

## Constructor

```javascript
const module = new Module(baseNoteVariables = {})
```

Creates a module with a BaseNote (id `0`) and nothing else.

| Parameter | Type | Description |
|---|---|---|
| `baseNoteVariables` | object | Overrides for the BaseNote. Values must be **strings** (expression text) or functions; `color` and `instrument` are passed through as-is. |

::: warning Numbers are silently ignored
The constructor only honours values that are a `string`, a `function`, a `*String` key, or
`color` / `instrument` (`src/module.js:92-113`). `new Module({ tempo: 120 })` drops the `120`
and leaves the BaseNote at 60 BPM. Write `new Module({ tempo: '120' })`.
:::

### BaseNote defaults

Any key you do not override falls back to these — note that they are **expression strings**, and
that they are still in the legacy format (`src/module.js:76-88`):

| Property | Default expression | Value |
|---|---|---|
| `frequency` | `new Fraction(440)` | 440 Hz |
| `startTime` | `new Fraction(0)` | 0 s |
| `tempo` | `new Fraction(60)` | 60 BPM |
| `beatsPerMeasure` | `new Fraction(4)` | 4 |
| `measureLength` | `'beat(base) * base.bpm'` | 4 s at the defaults |

There is **no `duration` default** — the BaseNote has no duration.

Because `measureLength` is seeded from that DSL string and `createModuleJSON()` writes source text
verbatim, a saved pure-DSL module stays pure DSL.

## Properties

### notes

```javascript
module.notes  // { [id: number]: Note } — a plain object, not a Map
```

Keyed by note id, and it **includes the BaseNote at key `0`**. `module.notes.get(1)` throws;
use `module.getNoteById(1)`. Iterating with `Object.values(module.notes)` yields the BaseNote
too, which is why `createModuleJSON()` skips `note.id === 0` (`src/module.js:918`).

### baseNote

```javascript
module.baseNote  // Note — the same object as module.notes[0]
```

The reference note. Everything else in a composition is ultimately expressed against it.

### nextId

```javascript
module.nextId  // number — the id addNote() will hand out next
```

## Note management

### addNote()

```javascript
const note = module.addNote(variables = {})
```

Creates a `Note` with an auto-assigned id, registers its dependencies, marks it dirty, and
invalidates the module end-time cache. Returns the new `Note`.

```javascript
const note = module.addNote({
  frequency: 'base.f * (3/2)',
  startTime: 'base.t',
  duration: 'beat(base)'
})
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
const note = module.addNote({
  frequency: "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  startTime: "module.baseNote.getVariable('startTime')",
  duration: "new Fraction(60).div(module.findTempo(module.baseNote))"
})
```
</details>

### getNoteById()

```javascript
const note = module.getNoteById(id)  // Note | undefined
```

O(1). `getNoteById(0)` returns the BaseNote.

### removeNote()

```javascript
module.removeNote(id)
```

Deletes the note, drops its evaluation-cache entry, and unregisters it from the dependency graph.
It does **not** rewrite expressions in other notes that referenced it — but it now emits a
`console.warn` listing every dependent left dangling before it deletes, since a dangling
`LOAD_REF` evaluates to hardcoded defaults (440 Hz / 0 s / 1 s). The app's delete flows deal with
dependents first — deleting them too, or re-pointing them at the deleted note's parent — and only
then call this; the warning guards programmatic callers.

## Evaluation

Evaluation is lazy and incremental: you mark notes dirty, and the next read evaluates only the
dirty set (plus what it topologically depends on).

### markNoteDirty()

```javascript
module.markNoteDirty(noteId)
```

Marks the note dirty, re-registers its dependencies, and cascades to every transitive dependent.
When `noteId` is `0`, it also marks every note whose expressions reference `base`.

### markNotesDirtyBatch()

```javascript
module.markNotesDirtyBatch([1, 2, 3])
```

The same thing for many notes in one pass: it registers dependencies once, collects dependents
**and** the transitive dependencies of the marked notes, then invalidates the incremental
evaluator selectively rather than wholesale. Collecting the *dependencies* matters — without them
an imported note's parent may not be in the cache when the child evaluates. The module-import path
(`src/player.js:2070`) uses it after grafting a library module onto a target note.

### batchSetExpressions()

```javascript
module.batchSetExpressions([
  { noteId: 1, varName: 'frequency', expr: 'base.f * (5/4)' },
  { noteId: 2, varName: 'startTime', expr: '[1].t + [1].d' }
])
```

Compiles all the expressions with per-note notifications suppressed, re-registers dependencies
once, then calls `markNotesDirtyBatch()`. The widget's **Evaluate Module** action
(`src/modals/index.js:1435`) rewrites every note in the composition through this in one pass.

::: danger The keys are `varName` and `expr`
Not `property` and `expression`. The update objects are destructured as
`{ noteId, varName, expr }` (`src/module.js:336`); passing the wrong keys throws
`TypeError: Cannot read properties of undefined (reading 'endsWith')`.
:::

`varName` accepts either the plain name (`frequency`) or the `*String` form (`frequencyString`) —
the suffix is stripped.

### evaluateModule()

```javascript
const cache = module.evaluateModule()  // Map<number, EvaluatedNote>
```

Evaluates the dirty set in topological order and returns the whole evaluation cache. Returns the
existing cache untouched when nothing is dirty. Re-entrant calls (an evaluation callback that
reads `getEvaluationCache()`) get the in-progress cache rather than recursing.

Each cache entry is:

```javascript
{
  startTime: Fraction,
  duration: Fraction,
  frequency: Fraction,
  tempo: Fraction,
  beatsPerMeasure: Fraction,
  measureLength: Fraction,   // may be a plain {s, n, d, valueOf} object when derived
  corruptionFlags: number    // CORRUPT bitmask; 0 when clean
}
```

`corruptionFlags` is the per-property irrational marker — see
[BinaryExpression](/developer/api/binary-expression#corruption-flags). After each evaluation the
module pushes those flags into the dependency graph, which is what drives the hatched rendering of
TET notes.

### getEvaluationCache()

```javascript
const cache = module.getEvaluationCache()
```

**Evaluates first if anything is dirty**, then returns the cache (`src/module.js:664-670`). This
is the lazy entry point that `Note.getVariable()` goes through; it is not a peek.

### evaluateNoteVariable()

```javascript
const freq = module.evaluateNoteVariable(noteId, 'frequency')  // Fraction | null
```

Cache-backed single-property read. Returns `null` when the note or property has no value.

### invalidateAll()

```javascript
module.invalidateAll()
```

Clears the evaluation cache and marks **every** note — BaseNote included — dirty.

::: warning Build a module by hand? Call `invalidateAll()` before you read values
`new Module()` marks the BaseNote dirty on the module, but not on the incremental evaluator, so
a module you assemble with `addNote()` evaluates its notes *without* ever evaluating note 0. Base
references then fall back to the VM's hard-coded defaults (440 Hz, 60 BPM, 4 beats), and a
`beat(base)` duration comes out at 1 s no matter what tempo you set. `Module.loadFromJSON()` ends
with `invalidateAll()`, which is why the app never hits this. See
[Known rough edges](#known-rough-edges) below.
:::

## Dependency-graph queries

All of these are O(1)-ish index lookups on the [dependency graph](/developer/core/dependency-graph);
none of them re-scan bytecode.

::: info The BaseNote is not a graph edge
`base.f` sets a `referencesBase` flag on the expression instead of adding note `0` to the
dependency set — an explicit edge would make note 0 a cycle. So `getDirectDependencies(n)` omits
`0` even for a note that reads `base.f`. `getDirectDependenciesByProperty()` and
`getParentChainByProperty()` splice `0` back in for you.
:::

### getDirectDependencies()

```javascript
module.getDirectDependencies(2)  // → [1]   (Array<number>, not a Set)
```

Note ids that this note's expressions reference directly.

### getDependentNotes()

```javascript
module.getDependentNotes(1)  // → [2]   (Array<number>, not a Set)
```

Every note that transitively depends on this one. For `noteId === 0` the BaseNote dependents are
folded in.

### getDependentsByProperty()

```javascript
module.getDependentsByProperty(1)
// → { frequency: [2], startTime: [2], duration: [2] }
```

Which notes move if you change *this* note's frequency / startTime / duration. This is the query
behind the property-coloured dependency lines: orange = frequency, teal = startTime, purple =
duration.

### getDirectDependenciesByProperty()

```javascript
module.getDirectDependenciesByProperty(2)
// → { frequency: [1], startTime: [1], duration: [0] }
```

The inverse: which notes *this* note's frequency / startTime / duration expressions read. BaseNote
references appear here as id `0`.

### getParentChainByProperty()

```javascript
module.getParentChainByProperty(2, 'frequency')  // → [1, 0]
```

The ancestor chain for one property, walking back to the BaseNote. **The starting note is not in
the result** (`src/module.js:522`) — `chain[0]` is its parent. `property` is one of
`'frequency' | 'startTime' | 'duration'`.

### getChildrenTreeByProperty()

```javascript
module.getChildrenTreeByProperty(1, 'frequency')
// → { edges: [{ parentId: 1, childId: 2, depth: 1 }], maxDepth: 1 }
```

The descendant tree as **edges**, not a node list.

### getChildrenTreeByAllProperties()

```javascript
module.getChildrenTreeByAllProperties(1)
// → { edgesByProperty: { frequency: [...], startTime: [...], duration: [...] }, maxDepth: 1 }
```

All three trees in a single traversal. The renderer uses this instead of three separate calls.

### getDependencyGraph()

```javascript
const graph = module.getDependencyGraph()  // DependencyGraph
```

Escape hatch to the raw indexes (`detectCycles()`, `hasDependencyPath()`, `getCorruptedNotes()`,
`stats()`, …).

## Musical lookups

### findTempo()

```javascript
const tempo = module.findTempo(note)  // Fraction (BPM)
```

Returns the note's own `tempo` expression if it has one, otherwise walks the `parentId` chain,
otherwise the BaseNote's tempo (falling back to `new Fraction(60)`).

### findMeasureLength()

```javascript
const seconds = module.findMeasureLength(note)  // Fraction
```

`beatsPerMeasure / tempo × 60`. `beatsPerMeasure` comes from the note, else from the nearest
non-measure ancestor, else from the BaseNote.

### findInstrument()

```javascript
const name = module.findInstrument(note)  // string
```

Returns `note.properties.instrument` when it is pinned. Otherwise it follows the note's
**frequency expression** to its parent (`[N].f` in DSL, `module.getNoteById(N).getVariable('frequency')`
in legacy) and asks that note, recursively. A note that bottoms out at `base.f` — or at nothing —
resolves to the module-level default instrument.

That default is a module-scoped value, not a constant: `player.js` calls `setDefaultInstrument()`
whenever the `audio.defaultInstrument` setting changes (`src/player.js:1176-1188`). This is the
bridge between the Settings panel and note timbre.

```javascript
import { setDefaultInstrument, getDefaultInstrument } from './module.js'

setDefaultInstrument('piano')
getDefaultInstrument()  // → 'piano'
```

Initial value: `'sine-wave'`.

### generateMeasures()

```javascript
const measures = module.generateMeasures(fromNote, n)  // → Note[]
```

**This mutates the module.** It creates `n` new measure bars (notes with a `startTime` and
nothing else), chains each to the previous one, sets `parentId`, and returns the created `Note`
objects. It is a factory, not a read-only helper for the renderer.

The chained expression is written in the format of the note you started from — it sniffs
`fromNote`'s `startTime` source with `isDSLSyntax()`:

```
base.t + measure(base)      # first, when fromNote is the BaseNote
[3].t + measure([3])        # each subsequent measure
```

<details>
<summary>Legacy JavaScript syntax</summary>

A BaseNote whose `startTime` is still the constructor default (`new Fraction(0)`) sniffs as
**legacy**, so a module built with a bare `new Module()` gets legacy measure chains instead:

```javascript
module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))
```

Modules loaded from a saved file have a DSL `startTime` (`'0'`) on the BaseNote and get the DSL
form above.
</details>

## Serialization

### createModuleJSON()

```javascript
const data = module.createModuleJSON()  // { baseNote: {...}, notes: [...] }
```

Synchronous. Emits each expression's **verbatim source text** (via `Note.getExpressionSource()`),
plus `color` / `instrument` when set. Notes are sorted by id and the BaseNote is excluded from
`notes[]`. This is what the app snapshots for undo/redo and localStorage.

### exportOrderedModule()

```javascript
const json = await module.exportOrderedModule()  // pretty-printed JSON string
```

**Async.** `createModuleJSON()` → `loadFromJSON()` → `reindexModule()` → `JSON.stringify(…, null, 2)`.
This is what the **Save Module** button downloads, which is why ids in a saved file differ from the
ids you saw on screen.

### loadFromJSON() (static, async)

```javascript
const module = await Module.loadFromJSON(source)
```

`source` is either a URL string (which gets `fetch`ed) or a plain object. Ends with
`invalidateAll()`, so the returned module is ready to evaluate.

Per-note id guards (`src/module.js:864-880`): ids that are not integers, are `< 0`, or are
`> 65535` (the `u16` ceiling of `LOAD_REF`) are skipped with a `[RMT Security]` warning; the
literal ids `__proto__`, `constructor` and `prototype` are blocked outright. There is no `eval()`
anywhere in this path — expressions are compiled to bytecode.

::: warning There is no `Module.fromJSON()` and no `module.toJSON()`
Both appeared in older docs. The real methods are the three above.
:::

### reindexModule()

```javascript
module.reindexModule()
```

Renumbers in place, from 1: measure bars first (sorted by evaluated `startTime`), then regular
notes. Rewrites every `[N]` and `module.getNoteById(N)` reference to match, rebuilds the dependency
graph, and re-evaluates (which repopulates corruption flags).

## Timing and diagnostics

### getModuleEndTime()

```javascript
const seconds = module.getModuleEndTime()
```

The later of (last measure start + its measure length) and (last note start + its duration).
Memoized in a module-file-level cache that is cleared by `invalidateModuleEndTimeCache()` — a
plain exported function, **not** an event.

```javascript
import { invalidateModuleEndTimeCache } from './module.js'
```

`Note._notifyChange()` also emits `player:invalidateModuleEndTimeCache` on the event bus, which
`player.js` listens for. `Module` itself emits nothing.

### getPoolStats()

```javascript
module.getPoolStats()  // → { used: 23, total: 256, utilization: '9.0%' }
```

Fraction-pool occupancy from the evaluator. Used by the perf harness.

## Evaluator hot-swap

The module builds its evaluators through `src/wasm/evaluator-adapter.js`. When the WASM hot-swap
is enabled it registers an `onWasmReady` callback that replaces both evaluators mid-session
(`_upgradeEvaluators()`, `src/module.js:133`), marks everything dirty, and warms the new engine on
an idle callback.

::: danger WASM evaluation does not ship
The hot-swap only arms when the page is loaded with `?evaluator=wasm`
(`isEvaluatorHotSwapEnabled()`, `src/wasm/evaluator-adapter.js:36-40`), and that flag exists
because the WASM wrapper's in-browser behaviour has never been verified — before the hot-swap
existed, module creation always won the race against WASM init, so the wrapper never actually ran.
**Every user session runs on the JS evaluator.** Treat the WASM path as unverified scaffolding, not
a feature. See [WASM Adapters](/developer/wasm/adapters).
:::

## Example

```javascript
const module = await Module.loadFromJSON({
  baseNote: { frequency: '263', startTime: '0', tempo: '120', beatsPerMeasure: '4' },
  notes: [
    { id: 1, startTime: 'base.t',        duration: 'beat(base)', frequency: 'base.f' },
    { id: 2, startTime: '[1].t + [1].d', duration: 'beat(base)', frequency: '[1].f * (3/2)' }
  ]
})

const cache = module.evaluateModule()

cache.get(1).frequency.valueOf()   // 263
cache.get(1).duration.valueOf()    // 0.5   — beat(base) at 120 BPM
cache.get(2).frequency.valueOf()   // 394.5 — a just fifth above note 1
cache.get(2).startTime.valueOf()   // 0.5   — starts when note 1 ends

module.getDirectDependencies(2)    // [1]
module.getDependentNotes(1)        // [2]
module.getModuleEndTime()          // 1

// Retune note 2 to a major third and re-read.
module.batchSetExpressions([{ noteId: 2, varName: 'frequency', expr: '[1].f * (5/4)' }])
module.evaluateModule().get(2).frequency.valueOf()  // 328.75
```

## Known rough edges

- A module built with `new Module()` + `addNote()` never evaluates its BaseNote until you call
  `invalidateAll()` (or `markNoteDirty(0)`). Always do one of those before reading values from a
  hand-assembled module.
- `findInstrument(null)` returns the literal string `'sine-wave'`, ignoring the configured default.
  Every real call site passes a note.

## See also

- [Note Class](/developer/api/note) — the objects `module.notes` holds
- [BinaryExpression](/developer/api/binary-expression) — what a compiled expression is
- [Dependency Graph](/developer/core/dependency-graph) — the indexes behind the queries above
- [Binary Evaluator](/developer/core/binary-evaluator) — the stack VM and its fallback defaults
- [Module Schema](/reference/module-schema) — the JSON `loadFromJSON()` accepts
