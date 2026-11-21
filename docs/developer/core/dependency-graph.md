---
title: Dependency Graph
description: The 22 forward and inverse indexes that make note dependencies O(1) — how they are registered, how property-coloured queries work, where cycles are checked, and how corruption is tracked.
---

# Dependency Graph

When a note's expression references another note, that is a dependency:

```
# note 5's frequency
[1].f * (3/2)      →  note 5 depends on note 1
```

`src/dependency-graph.js` indexes those references so that both questions are **O(1)**:

- *What does note 5 depend on?* → the forward index
- *What depends on note 1?* → the **inverse** index

The inverse index is the whole reason the class exists. Without it, "what depends on note 1?" means scanning every note in the module on every drag frame:

```javascript
// O(N) — what the graph replaces
getDependents(targetId) {
  return allNotes.filter(n => n.references(targetId));
}

// O(1) — what the graph does
getDependents(noteId) {
  return this.dependents.get(noteId) || new Set();
}
```

## The indexes

`DependencyGraph`'s constructor (`src/dependency-graph.js`) builds **22 index maps and sets**, plus a corruption map and an epoch counter — 23 `Map`/`Set` fields in all. They fall into four groups.

### 1. All-property (any expression → any expression)

| Field | Shape |
|---|---|
| `dependencies` | `Map<id, Set<id>>` — forward |
| `dependents` | `Map<id, Set<id>>` — inverse |
| `baseNoteDependents` | **`Set<id>`** — notes whose expressions reference `base` |
| `implicitBaseDependents` | **`Set<id>`** — notes that can follow the BaseNote *without* writing `base`; only re-evaluation reads it ([below](#the-basenote-is-not-an-edge)) |

### 2. Per-property forward / inverse / base

The same triple exists for `startTime`, `frequency` and `duration`:

| Property | Forward | Inverse | Base refs |
|---|---|---|---|
| startTime | `startTimeDependencies` | `startTimeDependents` | `startTimeBaseNoteDependents` |
| frequency | `frequencyDependencies` | `frequencyDependents` | `frequencyBaseNoteDependents` |
| duration | `durationDependencies` | `durationDependents` | `durationBaseNoteDependents` |

### 3. Property-pair inverse maps (9 of them)

These answer *"whose **X** depends on this note's **Y**?"* — the discrimination that makes a move drag differ from a resize drag, and that colours the dependency lines.

|  | …on startTime | …on duration | …on frequency |
|---|---|---|---|
| **startTime** depends… | `startTimeOnStartTimeDependents` | `startTimeOnDurationDependents` | `startTimeOnFrequencyDependents` |
| **frequency** depends… | `frequencyOnStartTimeDependents` | `frequencyOnDurationDependents` | `frequencyOnFrequencyDependents` |
| **duration** depends… | `durationOnStartTimeDependents` | `durationOnDurationDependents` | `durationOnFrequencyDependents` |

Each is `Map<dependencyId, Set<dependentId>>`.

::: info Only three properties get property-level indexes
`startTime`, `frequency` and `duration`, the three language variables (VAR 0 to 2). The interpretation variables (`amplitude`, `attack`, `release`; VAR 3 to 5) do not get them: a reference to `[N].a` still lands in the all-property and `implicitBaseDependents` indexes, but in no property-pair map. A reference to `[N].d` registers in the `…OnDuration…` maps and nothing else does. The old `measureLength` variable, which used to be bucketed with duration, is removed.
:::

### 4. Corruption

| Field | Shape | Purpose |
|---|---|---|
| `corruptionFlags` | `Map<id, u8>` | which properties of a note are tempered or approximate by their own expression |
| `_corruptionEpoch` | number | lets the renderer skip a buffer upload when nothing changed |

## The BaseNote is not an edge

`base.f` sets `BinaryExpression.referencesBase` and lands the note in `baseNoteDependents`. It **never** appears in `dependencies` or `dependents` as an edge to note 0 — that would make the BaseNote depend on itself, and the BaseNote *is* note 0 (`emitNoteReference()`, `src/dsl/compiler.js`).

Consumers simulate the edge instead. `Module.getDependentNotes(0)` unions `getAllDependents(0)` with `getBaseNoteDependents()` (`src/module.js`) — one level deep, which is what the UI wants.

Re-evaluation needs more than that, and gets it from `getEvaluationDependents(id)`: the transitive closure over `dependents` that, whenever it reaches note 0, continues into `baseNoteDependents` **and** `implicitBaseDependents` and on through everything that reads those. Before it existed, a BaseNote edit dirtied only the notes that wrote `base` themselves; a note defined purely against another note (`[1].f * (5/4)`) kept its old value.

`implicitBaseDependents` covers the one way a note depends on the BaseNote without naming it (`inheritsFromBase()`, `src/variable-deps.js`): a reference to another note's `amplitude`, `attack` or `release` (`[5].a`, `[5].attack`), which inherits the BaseNote's when note 5 has none of its own. Only the interpretation variables (indices from `FIRST_INTERPRETATION_VAR`) inherit; a reference to `[5].t`, `[5].d` or `[5].f` never reaches the BaseNote unless it is written. A measure bar is an ordinary note and no longer inherits anything: there is no computed measure length, and no tempo or beats-per-measure for it to follow.

The evaluator does not simulate anything for *ordering*: it reads `base.x` straight from the bytecode as a dependency on that one variable of note 0 (see [Binary Evaluator](/developer/core/binary-evaluator#evaluation-order-per-variable)).

Any diagram showing note 0 as a graph edge target is wrong.

## Registration

The graph does not build itself. It has no `buildFromModule()`. **The module drives registration**, one note at a time, from `Module._registerNoteDependencies(note)` (`src/module.js`) — which takes a **Note object**, not an id:

```javascript
_registerNoteDependencies(note) {
  const regKey = !this._depsRegGeneration && !note._depsEpoch
    ? note.id : `${this._depsRegGeneration}:${note.id}:${note._depsEpoch || 0}`;
  if (note._depsRegKey === regKey && note._depsRegModule === this) return;   // ← skipped when nothing changed

  this._dependencyGraph._updateDependencies(note.id, note.getAllDependencies(), note.referencesBaseNote());
  this._dependencyGraph.setImplicitBaseDependent(note.id, inheritsFromBase(note));
  this._dependencyGraph.registerStartTimeDependencies(note.id, note.getExpression('startTime'));
  this._dependencyGraph.registerFrequencyDependencies(note.id, note.getExpression('frequency'));
  this._dependencyGraph.registerDurationDependencies(note.id, note.getExpression('duration'));

  note._depsRegKey = regKey;
  note._depsRegModule = this;
}
```

::: tip Re-registration is skipped when dependencies cannot have changed
Dependencies derive purely from a note's compiled expressions. If the note's id, its expression epoch (`Note._depsEpoch`, in `src/note.js`, incremented on expression changes) and the graph generation are all unchanged, the note is already registered identically.

This matters because `markNoteDirty()` calls this for **every** marked note — on an interval-arrow change that is every dependent in the closure. The skip avoids rewriting up to 22 maps per untouched note.
:::

The bytecode scan that finds the references lives on the expression, not the graph: `BinaryExpression.getPropertyDependencies()` (`src/binary-note.js`) walks the bytecode for `LOAD_REF` instructions and returns `Map<noteId, Set<varIndex>>`. `getDependencySet()` returns the flat id set. A third scan, `getVariableRefs()` (`src/binary-note.js`), returns every (note, variable) pair *including* `base.x` reads; it is what evaluation order and cycle checks are built on, and it is cached per expression.

`_updateDependencies()` diffs old against new, patches the inverse index, and **bumps `_corruptionEpoch` if the dependency set actually changed** — because changing a note's dependencies can change whether *other* notes render as transitively corrupted, even if no corruption flag moved.

## Query surface

These are the real method names.

### Basic

| Method | Returns |
|---|---|
| `getDependencies(id)` | `IdSet` (or an empty `Set`) — direct, O(1) |
| `getDependents(id)` | `IdSet` (or an empty `Set`) — direct, O(1) |
| `getAllDependents(id)` | `Set` — transitive closure (BFS); stops at the BaseNote |
| `getEvaluationDependents(id)` | `Set` — transitive closure that crosses the BaseNote: everything to re-evaluate when `id` changes |
| `getAllDependencies(id)` | `Set` — transitive, upward |
| `getBaseNoteDependents()` | `Set` |

`Module.getDirectDependencies(id)` and `Module.getDependentNotes(id)` wrap these and return **Arrays**, not Sets (`src/module.js`).

### Property-scoped traversals

These back the property-coloured dependency lines and the drag preview. Each is a BFS that propagates *across* properties — changing a frequency can move a note's startTime, which moves its dependents' startTimes in turn.

| Method | Answers |
|---|---|
| `getAllAffectedByFrequencyChange(id)` | everything that moves if this note's **frequency** changes |
| `getAllAffectedByStartTimeChange(id)` | …its **startTime** changes |
| `getAllAffectedByDurationChange(id)` | …its **duration** changes |

`Module.getDependentsByProperty(id)` (`src/module.js`) calls all three and returns `{frequency: [], startTime: [], duration: []}` — which is exactly what the renderer colours:

![Dependency lines radiating from a selected note, coloured by property: orange for frequency, teal for startTime, purple for duration](/img/dependency-lines.png)

Thicker lines are what the selected note **depends on**; thinner lines are what **depends on it**.

The drag path uses the narrower startTime traversals directly: `getAllStartTimeOnStartTimeDependents(id)`, `getAllStartTimeOnDurationDependents(id)`, `getAllStartTimeOnFrequencyDependents(id)`. A note whose *frequency* references the dragged note does not move when you drag it, and these are how that is known.

### Trees and chains

| Method | Returns |
|---|---|
| `getChildrenTreeByProperty(id, property)` | `{edges: [{parentId, childId, depth}], maxDepth}` — `property` is `'frequency' \| 'startTime' \| 'duration'` |
| `getChildrenTreeByAllProperties(id)` | `{edgesByProperty: {frequency: [], startTime: [], duration: []}, maxDepth}` — all three in one traversal. **Not** the same shape as above: the edges are bucketed by originating property, not flat |
| `getMeasureChain(measureId, isMeasure, getStartTime, isChainLink?)` | `[{id, startSec}]` — the linear measure chain, earliest to latest, O(chain length) |

`getMeasureChain()` is live: `src/player.js` and `src/renderer/webgl2/workspace.js` both use it.

### Structural

| Method | Returns |
|---|---|
| `hasDependencyPath(source, target)` | boolean — BFS up the forward index |
| `detectCycles()` | `Array<Array<id>>` — recursive DFS |
| `getEvaluationOrder(noteIds)` | `Array<id>` — Kahn topological sort |
| `removeNote(id)` | — unlinks the note from every index |
| `clear()` | — empties every index |
| `stats()` | `{noteCount, totalDependencies, avgDependencies, maxDependencies, maxDependents, baseNoteDependents, corruptedNotes}` |
| `debug()` | console dump |

::: warning `getEvaluationOrder`, `detectCycles` and `hasDependencyPath` have no callers in the app
They are API surface, and they work on **whole notes**. **Evaluation does not use them**, and neither does the cycle guard — both work per variable, below.
:::

## Cycles are checked per variable

The indexes on this page say which *note* depends on which. That is the right granularity for dirty propagation, dependency lines and drag previews, and the wrong one for deciding what is circular:

```
[1].f = (3/2) * [2].f        # note 1 depends on note 2
[2].t = [1].t + [1].d        # note 2 depends on note 1
```

Between notes that is a loop. Between variables there is none: `[1].f` needs `[2].f`, and `[2].t` needs `[1].t` and `[1].d`. So neither evaluation order nor the cycle guard asks this graph. Both read the expressions themselves, through `src/variable-deps.js`:

| Function | Answers |
|---|---|
| `getVariableRefs(note, varIndex)` | what one variable reads, as written | `src/variable-deps.js` |
| `resolveVariableRef(getNote, ref)` | the variable a reference really reads — the BaseNote's when an `amplitude`, `attack` or `release` is inherited (indices `>= FIRST_INTERPRETATION_VAR`), nothing when no note defines it | `src/variable-deps.js` |
| `findVariableCycle(getNote, start)` | the loop through one variable, or `null` | `src/variable-deps.js` |
| `findDependencyCycle(module, noteId, variableName, expr)` | the loop that saving `expr` as that variable **would** create — nothing is changed | `src/variable-deps.js` |

A variable is addressed as one integer, `(noteId << 3) | varIndex`; `base.x` is note 0.

The guard a user actually hits is `validateExpression()` (`src/modals/validation.js`), behind the note widget's `Save`. It compiles the candidate, calls `findDependencyCycle()`, and throws one of the two messages the widget shows in red:

| Result | Message |
|---|---|
| the variable would read itself directly | `Expression cannot reference itself directly` |
| a longer loop | `Circular dependency detected in expression` |

Reading a *different* variable of the same note, or a note that reads this one through a different variable, is neither. The same rule covers the BaseNote, where it used to have a hole: `base.f = [3].f * 2` while `[3].f = base.f * (3/2)` was accepted, because `base` is not an edge.

The evaluator applies the identical rule when it orders a batch, so a cycle that arrives in a hand-written JSON file is reported by name rather than refused — see [True cycles](/developer/core/binary-evaluator#true-cycles).

::: warning The move and resize gestures still think in whole notes
After a drag, `player.js` re-anchors the moved note (and dependents that would now start before it) on an ancestor found by walking **start-time parents**, so that nothing references a note that starts later. That walk assumes two notes never read each other; with cross-variable relationships it can arrive back at the note being rewritten. A re-anchor that would close a loop is now skipped (`__retargetWouldCycleGL()`, `src/player.js`) and the note keeps its expression. The gestures do not otherwise understand cross-variable relationships: a move still rewrites the moved note's start, duration and frequency into their canonical forms.
:::

## Corruption tracking

The graph owns this and nothing else does. A property is *corrupted* when its own expression made a value that is not an exact rational — an irrational `^` such as `2^(1/12)` (kept exact), a `~` number, a division by zero. See [Exact Values](/developer/core/symbolic-power).

| Method | Effect |
|---|---|
| `setCorruptionFlags(id, flags)` | stores the u8 bitmask. **Bumps `_corruptionEpoch` only if the value changed**; a `0` deletes the entry. |
| `getCorruptionFlags(id)` | u8, `0` if clean |
| `getCorruptionEpoch()` | number |
| `isNoteCorrupted(id)` | any bit set |
| `isPropertyCorrupted(id, flag)` | e.g. `flag = 0x04` for frequency |
| `getCorruptedNotes()` | `Set<id>` — usually empty |
| `isFrequencyTransitivelyCorrupted(id)` | direct check, then BFS **up** the frequency chain |
| `getAllFrequencyDependencies(id)` | transitive frequency ancestors |
| `clearCorruptionFlags(id)` | delete |

Flags arrive from `Module._updateCorruptionFlags()` after each evaluation (`src/module.js`), scoped to the dirty set.

### How the renderer consumes it

`RendererAdapter.sync()` needs, for every note, "is anything in my dependency closure corrupt?". Because `dependents` is the maintained inverse of `dependencies`, that is answered for all notes at once by **one multi-source BFS over the `dependents` graph, seeded by `getCorruptedNotes()`** — O(N+E) instead of a transitive BFS per note, and a complete no-op when the corrupt set is empty, which is the common case (`renderer.js`). The scan produces the per-note `a_corruptionType` attribute the shader hatches from (`0` clean, `1` transitive → single diagonal hatch, `2` direct → crosshatch); the before/after numbers are in [Performance](/developer/performance).

`_corruptionEpoch` is what lets the renderer know it can skip this work. It is bumped from **two** places — `setCorruptionFlags()` when a flag changes, and `_updateDependencies()` when a note's dependency set changes. Both can alter transitive corruption.

## Space

There is no single multiplier. The graph keeps:

- 2 all-property maps + 2 base sets = **4**
- 3 × (forward + inverse + base set) = **9** per-property structures
- **9** property-pair inverse maps
- **1** corruption map

22 indexes, plus the corruption map. An edge is recorded in the all-property pair **and** in each per-property structure it belongs to **and** in the relevant property-pair map. The honest source is `stats()` — call it on a real module rather than trusting a constant factor.

The value of every per-note entry in these maps is an `IdSet`, not a `Set`. It does what a
`Set` does — `size`, `has`, `add`, `delete`, `clear`, iteration in insertion order, `forEach`, `values`,
`keys`, `entries` — and keeps up to two ids in its own fields, becoming a `Set` from the third on.
Most entries hold one or two ids, for which a `Set` costs 152 B in Node (76 B in Edge) and an
`IdSet` 56 B (28 B); with nine such maps per note in a typical module, the graph went from about
1,770 to about 910 B per note in Node on `voices-100000`. The forward maps keep an entry, possibly
empty, for every registered note: `dependencies.size` is the count of registered notes that
`getEvaluationDependents()` stops at. Iterating an `IdSet` that holds its ids inline walks a copy of
them; the graph never changes an `IdSet` while iterating it, and neither should a caller — treat
what `getDependencies()` and `getDependents()` return as read-only, as before.

## See also

- [Binary Evaluator](/developer/core/binary-evaluator) — `getEvaluationDependents()` decides what is re-evaluated; the order is per variable
- [Expression Compiler](/developer/core/expression-compiler) — `getPropertyDependencies()` is where the edges come from
- [Exact Values](/developer/core/symbolic-power) — what sets a corruption flag
- [Dependencies](/user-guide/notes/dependencies) — the user-facing view
