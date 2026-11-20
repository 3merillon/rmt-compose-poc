---
title: Data Flow
description: Trace one edit through RMT Compose — compile, mark dirty, order the variables, evaluate, sync the renderer, schedule audio.
---

# Data Flow

This page follows a single edit all the way from a keystroke to pixels and sound. Every step names
the function that actually runs.

## The short version

```
edit → compile to bytecode → mark dirty (+ transitive dependents)
     → order the dirty notes' variables → evaluate on the stack VM
     → evaluation cache → renderer.sync() → one frame
                        → audio scheduler → AudioGraph → speakers
```

## 1. An expression changes

The note widget's `Raw:` field commits **on Save**, not while typing.

```
Save clicked
  → validateExpression()            src/modals/validation.js:6
  → simplify (simplifyDSL)          src/utils/simplify.js:66
  → Note.setVariable('frequencyString', text)
      → Note._setExpression()       src/note.js:305
          → compiler.compile(text)   → BinaryExpression
          → note._depsEpoch++
          → Note._notifyChange()    src/note.js:349
              → module.markNoteDirty(note.id)
              → eventBus.emit('player:invalidateModuleEndTimeCache')
```

`compiler` is the singleton exported from `src/expression-compiler.js`. It probes a 4000-entry LRU
cache keyed on the raw text, compiles the DSL (refusing the retired method-chain syntax with its DSL
form), and returns a **clone** of the cached `BinaryExpression`.

There is a silent path too: **`Module.batchSetExpressions(updates)`** takes
`[{ noteId, varName, expr }]`, applies every change through `_setExpressionSilent()` (no per-note
notification), re-registers dependencies once, and marks everything dirty in one pass. Its one caller
is **Evaluate Module** (`evaluateEntireModule()`, `src/modals/index.js:810`). **Evaluate to
BaseNote** does *not* use it: `evaluateNoteToBaseNote()` (`src/modals/index.js:758`) writes each
property with `note.setVariable(name + 'String', expr)` and then calls `markNoteDirty()`.

::: info Drag and resize do not use the batch path
A move commit writes each moved note individually with `n.setVariable('startTimeString', raw)` inside
`commitNoteStartGL()` (`src/player.js:4960`), then runs the dependent-retarget passes, then evaluates
once. A group move does the same per mover.
:::

## 2. The module marks dirty

`Module.markNoteDirty(noteId)` (`src/module.js:221`):

1. Adds the id to `_dirtyNotes`.
2. `_registerNoteDependencies(note)` — re-scans the note's bytecode and rewrites its rows in the
   dependency graph. **This is memoized**: the key is
   `` `${_depsRegGeneration}:${note.id}:${note._depsEpoch}` ``, so an unchanged note (the common case
   when cascading over hundreds of dependents) is skipped entirely.
3. `graph.getEvaluationDependents(id)` collects everything downstream: the transitive dependents,
   **across the BaseNote**. The BaseNote is deliberately *not* an edge in the graph (that would be a
   self-cycle), so when the walk reaches note 0 it steps over explicitly — into every note that
   reads the BaseNote by name or by inheritance, and on through whatever reads those. This is how
   `base.f` edits reach a note that only says `[1].f * (5/4)`.
4. `_incrementalEvaluator.invalidate(noteId, dependents)` — this note's bytecode may have changed.
5. Every one of those dependents is added to the dirty set with `markDirtyOnly(depId)` — they need
   re-evaluating, but their bytecode did not change, so they must not be re-registered.

Callers (octave buttons, drags, modals) then mark each dependent again. A note already reached by a
walk of the same dirty cycle now only re-registers its own bytecode (`Module._dirtyClosed`,
`src/module.js:236`, cleared whenever the dirty set is), so a cycle costs one walk. Before, a commit
in the middle of `chain-1000` ran 501 walks over 125,000 notes. Both engines do this.

## 3. Evaluation

`Module.evaluateModule()` (`src/module.js:659`) delegates to
`IncrementalEvaluator.evaluateDirty()` (`src/binary-evaluator.js:1022`):

```
evaluateDirty()
  → evaluator.beginBatch()      // rewinds the FractionPool bump allocator
  → a blank record for every dirty note
  → evaluateVariables(dirty)    // each variable after the variables it reads
  → reportProblems()            // true cycles, unresolved references
  → clear the dirty set
  → return Map<noteId, result>
```

**The order is per variable, on the evaluator, not the graph.** The dirty set is a set of *notes*;
inside it, `evaluateVariables()` (`binary-evaluator.js:659`) walks depth-first from every variable
and evaluates whatever it reads first. Each variable is one node: `[1].f` may read `[2].f` while
`[2].t` reads `[1].t` and `[1].d`, and a note's own variables may read each other in any direction.
What a variable reads comes straight from its bytecode, `base.x` included. Notes start in ascending
id, so the order is deterministic. On a true cycle — a variable that reads itself — it does **not**
throw: it `console.error`s `Dependency cycle detected!` with the loop named, and evaluates the
members in a fixed order against defaults.

`evaluateVariable()` (`binary-evaluator.js:802`) evaluates one expression into the note's record
and ORs a corruption bit for that property when its expression made an irrational `^` result or an approximation. Irrational values stay exact (`record.exact`); see [Exact Values](/developer/core/symbolic-power).

A cache entry is:

```javascript
{ startTime, duration, frequency, amplitude, attack, release, corruptionFlags }
```

The first three are the language; `amplitude`, `attack` and `release` are `null` unless the note
defines them. There is no stored tempo, beats-per-measure or measure length: the BaseNote's
`duration` is the time unit (`base.d`), and a measure bar is an ordinary note whose `duration` is its
length.

::: warning A gotcha in the cache
Pooled fractions are never cached — `evaluateVariable()` copies each result into a fresh
`new Fraction(...)` first, because the pool is rewound at the start of the next batch.
:::

An unresolvable reference does **not** throw. `LOAD_REF` falls back to the BaseNote for the three
interpretation variables (`amplitude`, `attack`, `release`, the indices from `FIRST_INTERPRETATION_VAR`),
and otherwise pushes a hard-coded default: `startTime 0`, `duration 1`, `frequency 440`, `amplitude 1`,
`attack 0`, `release 0`. This is why deleting a note does not break its dependents — they pick up these
defaults, and the evaluation says so with a `console.error` naming the note and variable on both
ends of every such reference. An `amplitude` nobody sets is the one exception: its `1` is the
variable's value, not a stand-in, and reading it is reported only when the note it names does not exist.

Finally, `Module._updateCorruptionFlags(cache, dirtyIds)` pushes each result's `corruptionFlags`
into `DependencyGraph.setCorruptionFlags()` — scoped to the dirty set, not all notes.

::: info Which evaluator runs
In a browser the Rust core is the default. A `Module` usually exists before the core is ready, so it
starts on the JS `BinaryEvaluator` / `IncrementalEvaluator` and hot-swaps to Rust when the binary
is ready: `isEvaluatorHotSwapEnabled()` (`src/wasm/evaluator-adapter.js:114-116`) is the gate.
`?evaluator=js` keeps JavaScript and skips the fetch. Both evaluators produce the same records. See [WASM Overview](/developer/wasm/overview).
:::

## 4. Rendering

`RendererAdapter.sync()` (`renderer.js:681`) is the CPU rebuild:

```javascript
renderer.sync({
  evaluatedNotes,          // the evaluation cache
  module,
  xScaleFactor, yScaleFactor,
  selectedNoteId,          // default null
  tempOverrides            // default null — per-note value overrides (unused by the live drag path)
})
```

It rebuilds every instance array (posSize, colours, flags, silence masks, fraction label strings),
rebuilds `_noteIdToIndex`, computes the corruption type per note, and uploads to the GPU.

::: info There is no per-note dirty tracking in the renderer
`sync()` reallocates and re-uploads **all N** instance arrays with
`gl.bufferData(..., gl.DYNAMIC_DRAW)` every call. There are 151 `bufferData` calls in `renderer.js`
against 4 `bufferSubData`. Making this incremental is the single biggest remaining perf item.
:::

The corruption scan is the one part that is genuinely clever. Rather than asking "what does note *i*
depend on?" for every note (a transitive BFS per note — O(N²) on deep chains), it inverts the
question: *i* transitively depends on a corrupt note **iff** *i* is a transitive dependent of one. So
a single multi-source BFS over the `dependents` graph, seeded by the (usually empty) corrupt set,
answers it for all notes at once in O(N+E) — and is a complete no-op when nothing is corrupt
(`renderer.js:1015-1062`).

The result lands in `_corruptionType`, a `Float32Array` bound to vertex attribute 7:

| Value | Meaning | Shader draws |
|---|---|---|
| `0.0` | clean | nothing |
| `1.0` | transitively corrupted | single 45° diagonal hatch |
| `2.0` | directly corrupted | crosshatch |

`sync()` sets `needsRedraw = true`. The rAF loop's `_render()` picks it up on the next frame and
draws. When nothing changed, `_render()` returns immediately and the frame costs zero draw calls.

`player.js` calls `sync()` on every commit. A drag does **not** call it: the workspace previews the
gesture through the renderer's preview setters (`setDragOffsetPreview()` shifts moving notes on the
GPU), and `sync()` runs once, on the drop. `player.js`'s rAF loop still carries a `tempOverrides`
re-sync branch (`player.js:1882`), but nothing assigns `glTempOverrides` today, so it never fires.
See [WebGL2 Renderer](/developer/rendering/webgl2-renderer).

## 5. Audio playback

```
Play pressed
  → module.evaluateModule() → cache
  → build noteDataList: { id, startTime, duration, frequency, instrument, amplitude, attack, release }
  → AudioEngine.play(noteDataList)
  → every BATCH_INTERVAL (100 ms):
      schedule every note starting within LOOKAHEAD (2.0 s)
      → build voice → voiceGain(envelope) → [StereoPanner]
      → connect into graph.getBus(instrumentName)
```

Downstream of the voice, `AudioGraph` (`src/player/audio-graph.js`) is a persistent graph that
survives across the play/stop seam:

```
instrumentBus ─┬─ dry ─────────────────────────────┐
               └─ reverbSend → reverbInput          │
                                                    ▼
reverbInput → preDelay → Convolver(IR) → reverbReturn(wet) → masterGain → [limiter] → destination
```

A note's own `attack` and `release`, or the BaseNote's, travel with it as shares of its duration and
reach `applyEnvelope()` as a `shape`; with neither set, the instrument's own envelope (in seconds) applies. See
[Audio Engine](/developer/audio/audio-engine).

`instrument` is resolved by `module.findInstrument(note, memo)`, which follows the note's **start time**
along its line (its player), terminating at the BaseNote's instrument or the module-level default
instrument (driven by the `audio.defaultInstrument` setting). `module.findPlayer(note, memo)` adds `player`
(the id of the first note of the line) and `prev` (the line predecessor) to each note's data.

Reverb defaults **on** (`wet` 0.25, `decaySec` 1.8), the limiter defaults **on** (−6 dB threshold,
knee 6, ratio 12), stereo spread defaults **off**. So the documented flow above is what a user
actually hears out of the box.

## Dependency propagation, concretely

```
Note 1's frequency changes
  → module.markNoteDirty(1)
  → graph.getEvaluationDependents(1) → transitive closure, say {2, 3, 5}
  → dirty = {1, 2, 3, 5}
  → every variable of those four notes is evaluated once, after the variables it reads
```

For *visualisation* — the coloured dependency lines and rings — the module asks a different question.
`module.getDependentsByProperty(noteId)` (`src/module.js:434`) returns

```javascript
{ frequency: [...], startTime: [...], duration: [...] }
```

backed by three BFS traversals in the graph (`getAllAffectedByFrequencyChange` and friends). The
semantics are "which notes would **move** if I changed this property of this note?" — which is why
the colours are property-specific: orange = frequency, teal = startTime, purple = duration.

## Caching

| Cache | Where | Lifetime |
|---|---|---|
| Compile cache | `ExpressionCompiler`, LRU **4000** entries, keyed on raw text | One, the singleton's ([compile cache](/developer/core/expression-compiler#the-compile-cache)). |
| Compiled bytecode | Inside each `BinaryExpression` | Until the expression text changes. |
| Evaluation cache | `Map<noteId, result>` on the module and the incremental evaluator | Invalidated per note when marked dirty. |
| Module end time | A **module-level** `let` in `src/module.js`, not a per-instance field | Cleared by `invalidateModuleEndTimeCache()`, emitted on every expression change. |
| Renderer instance arrays | `RendererAdapter` | Rebuilt wholesale on every `sync()`. No per-note tracking. |
| Children-tree (drag preview) | `renderer.js:10498`, keyed `anchorId\|_posEpoch\|_sceneEpoch` | Survives a drag (which changes neither key), invalidated by any real edit. |

## Events

`src/utils/event-bus.js` carries 25 event names. The ones a data-flow reader needs:

| Event | Emitted by | Does |
|---|---|---|
| `workspace:noteMoveCommit` | `note.js:354` | `{noteId, newStartSec}` → rewrite startTime, retarget violated dependents, evaluate, sync, snapshot. |
| `workspace:noteResizeCommit` | `workspace.js:1756` | `{noteId, newDurationSec}` |
| `workspace:measureResizeCommit` | `workspace.js:1765` | `{measureId, newStartSec}` |
| `workspace:groupMoveCommit` | `workspace.js:1737` | `{ids, deltaSec}` → clamps the batch so it can't cross the BaseNote, then commits each mover. |
| `workspace:marqueeCommit` | `workspace.js:1727` | `{ids, additive}` → sets the multi-selection. |
| `workspace:multiSelectToggle` | `workspace.js:2072` | `{id}` — shift-click / long-press adds or removes one note. |
| `player:octaveChange` | note widget arrows, GL arrow regions | `{noteId, direction}` → multiplies the frequency expression by the arrow interval. |
| `player:invalidateModuleEndTimeCache` | `note.js:354` | Any expression change. |
| `player:importModuleAtTarget` | `menu-bar.js` | `{targetNoteId, moduleData, clientX, clientY}` |
| `player:selectNote`, `player:requestPause` | various | Selection and transport. |
| `history:capture` / `seedIfEmpty` / `undo` / `redo` / `requestRestore` / `stackChanged` | everywhere an edit commits | Undo. `player.js` also listens to `history:capture` to write the localStorage autosave. |
| `settings:changed` / `settings:loaded` / `settings:panelToggled` | `settings-store.js`, `settings-panel.js` | `{path, value, settings}` |
| `modals:show` / `requestRefresh` / `cleared` / `init` | modals | Widget lifecycle. |
| `audio:masterVolumeInput` | `player.js:4298` | Live echo from the transport slider so the Settings panel tracks it mid-drag. |

## Settings → runtime

A settings write fans out through one event:

```
settingsStore.set('audio.reverb.wet', 0.4)
  → validate the whole tree
  → persist to localStorage rmt:settings:v1
  → eventBus.emit('settings:changed', { path, value, settings })
      → AudioGraph._onSettings()        live param, or debounced IR regen
      → themeManager                    CSS vars + renderer.setConfig/setThemeColors
      → player.js                       volume, default instrument, arrows, scale
      → menu-bar.js                     library icon size / cents
```

::: warning `resetSection` emits a bare path
`resetSection('library')` emits `path === 'library'`, and `resetAll()` emits `path === ''` — not a
dotted path. A consumer that only matches `path.startsWith('library.')` will silently ignore
"Reset this tab" and "Reset all".
:::

## Loading a module

```
Module.loadFromJSON(source)
  → fetch (when source is a URL) or take the object
  → migrateTimeModel(data)          src/migrate/relational-time.js
  → migrateSyntax(data)             src/migrate/legacy-syntax.js
  → new Module(baseNote)            the BaseNote
  → one Note per entry in data.notes, each expression compiled
  → invalidateAll()                 every note dirty, ready to evaluate
```

`migrateTimeModel()` and then `migrateSyntax()` run before any note is built. Both leave a module
in the current form untouched. A module of the old time model (tempo, beats per measure, `beat()`,
`measure()`, `module.findTempo` chains) or in the retired method-chain syntax is converted exactly,
on the JSON text; either conversion refuses (`TimeMigrationError`, `SyntaxMigrationError`) rather
than guess. See [Module System](/developer/architecture/module-system#loading-old-modules).

At startup `src/player.js` loads the saved session (`rmt:moduleSnapshot:v1`) or
`modules/defaultModule.json`. If the saved session cannot be loaded, it is kept under
`rmt:moduleSnapshot:v1:unloadable` before the autosave replaces it, and the default module opens.

## History

```
any committing edit
  → captureSnapshot(label)              player.js:5631
      → module.createModuleJSON()
      → JSON.stringify once → snapshotStr   (shared, not serialized twice)
      → eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot, snapshotStr })
      → eventBus.emit('history:capture',     { label, snapshot, snapshotStr })
          → HistoryManager stores the STRING (≈3–5× less retained heap than an object graph)
          → clears the redo stack
          → _enforceCaps(): 50 entries / 12 MB, never below 2
      → player.js also writes snapshotStr to localStorage rmt:moduleSnapshot:v1
```

Undo emits `history:requestRestore`, and `player.js` rebuilds the module with the proven
`Module.loadFromJSON` path. Reverse-patch history was considered and declined: it does not reduce the
dominant per-undo recompile-and-evaluate cost, and it is the most delicate correctness surface in the
app.

## See also

- [System Architecture](/developer/architecture/overview)
- [Module System](/developer/architecture/module-system)
- [Binary Evaluator](/developer/core/binary-evaluator)
- [Dependency Graph](/developer/core/dependency-graph)
- [Audio Graph](/developer/audio/audio-graph)
