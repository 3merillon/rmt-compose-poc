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
`color` / `instrument` (`src/module.js:103-123`). `new Module({ duration: 0.5 })` drops the `0.5`
and leaves the time unit at 1 s. Write `new Module({ duration: '1/2' })`.
:::

### BaseNote defaults

Any key you do not override falls back to these. They are **expression strings** in the DSL
(`src/module.js:87-100`):

| Property | Default expression | Value |
|---|---|---|
| `frequency` | `'440'` | 440 Hz |
| `startTime` | `'0'` | 0 s |
| `duration` | `'1'` | 1 s, the time unit |

The BaseNote holds the only absolute values in a module: a frequency in Hz, a start and a duration
in seconds. Its duration is the *time unit* every other duration relates to (`base.d`), one beat if
you count in beats. Nothing stores a tempo; `60 / module.getTimeUnit()` is the tempo as a view. See
[`getTimeUnit()`](#gettimeunit). `createModuleJSON()` writes source text verbatim, so a saved
module stays in the syntax it was written in.

## Properties

### notes

```javascript
module.notes  // { [id: number]: Note } — a plain object, not a Map
```

Keyed by note id, and it **includes the BaseNote at key `0`**. `module.notes.get(1)` throws;
use `module.getNoteById(1)`. Iterating with `Object.values(module.notes)` yields the BaseNote
too, which is why `createModuleJSON()` skips `note.id === 0` (`src/module.js:963`).

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
  duration: 'base.d'
})
```

Pass `measure: true` to create a [measure bar](#generatemeasures) (a silent note with a start and
a duration).

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
It does **not** rewrite expressions in other notes that referenced it — but it emits a
`console.warn` listing every dependent left dangling before it deletes, and marks those dependents
dirty, since a dangling `LOAD_REF` evaluates to hardcoded defaults (440 Hz / 0 s / 1 s). The next
evaluation therefore shows what a reload would show, and names each broken reference in a
`console.error`. The app's delete flows deal with dependents first — deleting them too, or
re-pointing them at the deleted note's parent — and only then call this; the warning guards
programmatic callers.

## Evaluation

Evaluation is lazy and incremental: you mark notes dirty, and the next read evaluates only the
dirty set (plus what it topologically depends on).

### markNoteDirty()

```javascript
module.markNoteDirty(noteId)
```

Marks the note dirty, re-registers its dependencies, and cascades to everything downstream —
transitively, and across the BaseNote: when the cascade reaches note `0` it continues into every
note that reads the BaseNote (by writing `base`, or by inheriting an amplitude, attack or release)
and on through whatever reads those.

Callers often mark a note and then each of its dependents. A note already reached by a walk of the
same dirty cycle only re-registers its own bytecode (`Module._dirtyClosed`, `src/module.js:236`),
so the cycle costs one walk. The set is cleared whenever the dirty set is.

### markNotesDirtyBatch()

```javascript
module.markNotesDirtyBatch([1, 2, 3])
```

The same thing for many notes in one pass: it registers dependencies once, collects dependents
**and** the transitive dependencies of the marked notes, then invalidates the incremental
evaluator selectively rather than wholesale. Collecting the *dependencies* matters — without them
an imported note's parent may not be in the cache when the child evaluates. The module-import path
(`src/player.js:1833`) uses it after grafting a library module onto a target note.

### batchSetExpressions()

```javascript
module.batchSetExpressions([
  { noteId: 1, varName: 'frequency', expr: 'base.f * (5/4)' },
  { noteId: 2, varName: 'startTime', expr: '[1].t + [1].d' }
])
```

Compiles all the expressions with per-note notifications suppressed, re-registers dependencies
once, then calls `markNotesDirtyBatch()`. The widget's **Evaluate Module** action
(`src/modals/index.js:810`) rewrites every note in the composition through this in one pass.

::: danger The keys are `varName` and `expr`
Not `property` and `expression`. The update objects are destructured as
`{ noteId, varName, expr }` (`src/module.js:358`); passing the wrong keys throws
`TypeError: Cannot read properties of undefined (reading 'endsWith')`.
:::

`varName` accepts either the plain name (`frequency`) or the `*String` form (`frequencyString`) —
the suffix is stripped.

### evaluateModule()

```javascript
const cache = module.evaluateModule()  // Map<number, EvaluatedNote>
```

Evaluates the dirty set — each variable after the variables it reads — and returns the whole
evaluation cache. A true cycle or an unresolvable reference does not throw; it is reported with a
`console.error` naming the notes and variables involved. Returns the
existing cache untouched when nothing is dirty. Re-entrant calls (an evaluation callback that
reads `getEvaluationCache()`) get the in-progress cache rather than recursing.

Each cache entry is:

```javascript
{
  startTime: Fraction,
  duration: Fraction,
  frequency: Fraction,
  amplitude: Fraction,       // null unless the note defines one — see findAmplitude()
  attack: Fraction,          // null unless the note defines one; a share of the note's duration, from its start
  release: Fraction,         // null unless the note defines one; a share of the note's duration, from its end (it rings after the note)
  corruptionFlags: number    // CORRUPT bitmask; 0 when clean
}
```

The three language variables (`startTime`, `duration`, `frequency`) are always filled. The three
interpretation variables stay `null` when the note does not define them; readers fall back to the
BaseNote's. Index and flag values are in the
[VAR table](/developer/api/binary-expression#variable-indices).

`corruptionFlags` is the per-property "tempered or approximate" marker — see
[BinaryExpression](/developer/api/binary-expression#corruption-flags). After each evaluation the
module pushes those flags into the dependency graph, which is what drives the hatched rendering of
TET notes.

### getEvaluationCache()

```javascript
const cache = module.getEvaluationCache()
```

**Evaluates first if anything is dirty**, then returns the cache (`src/module.js:719-725`). This
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
references then fall back to the VM's hard-coded defaults (440 Hz, start 0, duration 1 s), and a
`base.d` duration comes out at 1 s no matter what duration you gave the BaseNote. `Module.loadFromJSON()` ends
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
the result** (`src/module.js:539`) — `chain[0]` is its parent. `property` is one of
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

### getTimeUnit()

```javascript
const unit = module.getTimeUnit()  // Fraction, seconds
```

The BaseNote's evaluated duration: the time unit, one beat if you count in beats. Returns
`new Fraction(1)` when that duration is not positive. `60 / unit` is the tempo in BPM, a read-only
view (the note widget shows it as "= 100 BPM" beside the BaseNote's duration; the MIDI export
writes it as the tempo). Nothing stores a tempo.

### getMeasureNotes()

```javascript
const bars = module.getMeasureNotes()  // Note[], unordered
```

Every note for which [`isMeasureNote()`](/developer/api/note#ismeasurenote) is true, in
`Object.values(module.notes)` order. `getModuleEndTime()` and `reindexModule()` use it.

::: warning Removed: findTempo() and findMeasureLength()
`module.findTempo(note)` and `module.findMeasureLength(note)` no longer exist, and neither do the
`tempo`, `beatsPerMeasure` and `measureLength` variables they read. A beat in seconds is
`module.getTimeUnit()`; the length of a bar is the bar's own `duration`.
:::

### findAmplitude()

```javascript
const gain = module.findAmplitude(note)  // Fraction — exact, unclamped
```

The amplitude a note sounds at: its own `amplitude` expression if it has one, otherwise the
BaseNote's, otherwise `new Fraction(1)`. This is the same fallback the evaluator applies to
`[id].a`. There is no `parentId` walk. Consumers clamp for their medium — the audio engine through
`amplitudeToGain()` in `src/player/amplitude.js` (0–4).

### findInstrument()

```javascript
const name = module.findInstrument(note)  // string
```

Returns `note.properties.instrument` when it is set. Otherwise the instrument follows the note's
**start time**, not its frequency (the rule is in `src/players.js`; `findInstrument()` delegates to
`instrumentOf()`):

1. a note whose start is written from the end of a note or a silence *p* (`[p].t + [p].d`, with or
   without a rest added) takes *p*'s instrument: the same player;
2. a copy of a note *k* of a line (start `[k].t + X`, frequency `r * [k].f`) whose predecessor's copy
   exists (written from it with the same `X`) takes that copy's instrument;
3. otherwise the note starts a line and takes the instrument of the note its start time is written
   from (`[k].t …`; a measure bar does not count), else the BaseNote's, else the module-level default
   instrument.

The optional second argument is a `Map` memo, shared by a caller that resolves many notes in one pass
(the audio engine, the renderer and the MIDI export do), so each line is walked once rather than once
per note on it.

That default is a module-scoped value, not a constant: `player.js` calls `setDefaultInstrument()`
whenever the `audio.defaultInstrument` setting changes (`src/player.js:1045-1060`). This is the
bridge between the Settings panel and note timbre.

```javascript
import { setDefaultInstrument, getDefaultInstrument } from './module.js'

setDefaultInstrument('piano')
getDefaultInstrument()  // → 'piano'
```

### findPlayer()

```javascript
const { head, prev } = module.findPlayer(note, memo)  // {head: number, prev: number|null}
```

A note's player: `head` is the id of the first note of its line (the note that decides the
instrument), and `prev` the id of the note it follows in the line, `null` for a first note and for a
note that sets its own instrument, which starts a new player. `preparePlayback()` puts both on each
note's data as `player` and `prev`; nothing audible uses them yet. The note widget's
`Inherited: <name> · plays with [N]` line shows `head`.

A module file saved before this rule is migrated by `loadFromJSON()`, and `createModuleJSON()` writes
`instrumentRule: "start-time"` at the top level; see [Module System](/developer/architecture/module-system).

Initial value: `'sine-wave'`.

### generateMeasures()

```javascript
const measures = module.generateMeasures(fromNote, n)  // → Note[]
```

**This mutates the module.** It creates `n` new measure bars, chains each to the previous one, sets
`parentId`, and returns the created `Note` objects. It is a factory, not a read-only helper for the
renderer.

A measure bar is a silent note (a start and a duration, no frequency) flagged `measure: true`; see
[`isMeasureNote()`](/developer/api/note#ismeasurenote). The expressions are always DSL:

```
startTime: base.t         duration: base.d * 4     # first bar: fromNote is the BaseNote
                                                   # or is not a measure bar
startTime: [3].t + [3].d  duration: [3].d          # each next bar, [3] being the previous bar
```

Each bar starts where the previous one ends and lasts as long, so a meter change is one bar's
duration: change it and the bars after it follow. Nothing is computed from a tempo or a
beats-per-measure value. The module ends at the later of the last bar's start plus its duration and
the last note's end (`getModuleEndTime()`).

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

Before it builds any note, it runs the data through two conversions, in this order:

1. `migrateTimeModel()` (`src/migrate/relational-time.js`): a module written for the old time
   model (tempo, beats per measure, `beat()`, `measure()`, `module.findTempo` chains) is rewritten
   in relational time. A module it cannot convert throws a `TimeMigrationError`. A converted load
   logs one `[RMT] Converted a module to relational time` line.
2. `migrateSyntax()` (`src/migrate/legacy-syntax.js`): every expression in the retired method-chain
   syntax becomes DSL. One it cannot read as written throws a `SyntaxMigrationError` naming the
   note and variable. A converted load logs `[RMT] N expression(s) converted from the method-chain
   syntax to the DSL`.

Both are exact: every start, duration, frequency and interpretation value keeps the same fraction.
See [Module System](/developer/architecture/module-system#loading-old-modules).

Per-note id guards (`src/module.js:885-897`): ids that are not integers, are `< 0`, or are
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

Renumbers in place, from 1: measure bars (`isMeasureNote()`) first, sorted by evaluated `startTime`, then regular
notes. Rewrites every `[N]` reference to match, rebuilds the dependency
graph, and re-evaluates (which repopulates corruption flags).

## Timing and diagnostics

### getModuleEndTime()

```javascript
const seconds = module.getModuleEndTime()
```

The later of (last measure bar's start + its duration) and (last note start + its duration).
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
(`_upgradeEvaluators()`, `src/module.js:146`), marks everything dirty, and warms the new engine on
an idle callback.

::: info WASM is the default
In a browser the hot-swap is armed unless the URL has `?evaluator=js`
(`isEvaluatorHotSwapEnabled()`, `src/wasm/evaluator-adapter.js:114-116`). A `Module` usually exists
before the core is ready, so it starts on the JS evaluator and swaps to WASM when the core loads.
If the core fails to load, the JS evaluator stays. `WASM_MATCHES_VARIABLE_LAYOUT`
(`src/wasm/evaluator-adapter.js:46`) is `true`; set to `false`, it turns the WASM evaluator off
everywhere, and `?evaluator=wasm` is ignored with a console warning. See
[WASM Adapters](/developer/wasm/adapters).
:::

## Example

```javascript
const module = await Module.loadFromJSON({
  baseNote: { frequency: '263', startTime: '0', duration: '1/2' },
  notes: [
    { id: 1, startTime: 'base.t',        duration: 'base.d', frequency: 'base.f' },
    { id: 2, startTime: '[1].t + [1].d', duration: 'base.d', frequency: '[1].f * (3/2)' }
  ]
})

const cache = module.evaluateModule()

module.getTimeUnit().valueOf()     // 0.5   — 120 BPM as a view: 60 / 0.5
cache.get(1).frequency.valueOf()   // 263
cache.get(1).duration.valueOf()    // 0.5   — base.d, one time unit
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
