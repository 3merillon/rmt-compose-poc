---
title: Note Class
description: API reference for the Note class in src/note.js — expression storage, variable get/set, dependency introspection, and the legacy variables proxy.
---

# Note Class

A `Note` (`src/note.js`) is six compiled expressions plus three plain properties. It stores no
numbers: every musical value is an expression, and reading one goes through the module's evaluator.

```javascript
import { Note, EXPRESSION_VARS, isMeasureNote } from './note.js'
```

`EXPRESSION_VARS` lists the six evaluated variables, in
[VAR](/developer/api/binary-expression#variable-indices) index order:

```javascript
EXPRESSION_VARS  // ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release']
```

The first three are the language: each relates the note to other notes. The last three interpret
the note when it sounds, and only those fall back to the BaseNote when a note does not set them.
`tempo`, `beatsPerMeasure` and `measureLength` are no longer variables.

## Constructor

```javascript
const note = new Note(id, variables = {})
```

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Note id. `0` is the BaseNote. |
| `variables` | object | Expression strings (DSL), plus optional `color` / `instrument`. |

::: warning Create notes through the module
`module.addNote(variables)` or `Module.loadFromJSON()`. A `Note` built directly has
`note.module === null`, so `getVariable()` returns `null` for every **evaluated** property (there
is no evaluator to ask) and no dependency registration happens. Source text and `color` /
`instrument` still read back.
:::

The constructor accepts a value per property in several shapes (`_initFromVariables`,
`src/note.js:123-190`): a plain string (compiled), a `*String` key (preferred over the plain key
when both are present), a legacy function (its `return` expression is extracted), or an existing
`BinaryExpression` (adopted as-is).

## Properties

### id

```javascript
note.id  // number
```

A plain writable field. `reindexModule()` does not mutate it — it builds fresh `Note` objects.

### expressions

```javascript
note.expressions  // { [name: string]: BinaryExpression }
```

Always all six keys, always a `BinaryExpression` object — an *unset* property is an **empty**
expression, not a missing one. Use `hasExpression(name)` rather than a truthiness check.

Every unset property holds the same object, `EMPTY_EXPRESSION` (`src/binary-note.js:442-450`), which
is frozen: setting a variable replaces it, and a write into it throws rather than reaching every
note. Six expressions made for each note, each with its own buffers, cost about 1.8 KB per note in
Node for the three a typical note leaves unset. Replace an expression; never write into one a note
holds.

```javascript
{
  startTime: BinaryExpression,
  duration: BinaryExpression,
  frequency: BinaryExpression,
  amplitude: BinaryExpression,
  attack: BinaryExpression,
  release: BinaryExpression
}
```

### properties

```javascript
note.properties  // { color: string | null, instrument: string | null, measure: boolean }
```

`color` and `instrument` default to `null` — including on the BaseNote. A `null` instrument is what
lets `module.findInstrument()` resolve it from the note's player, and failing that the configurable default instrument. `measure`
defaults to `false` and marks a measure bar; see [`isMeasureNote()`](#ismeasurenote).

### module

```javascript
note.module  // Module | null
```

Back-reference, set by `addNote()` / `loadFromJSON()`. Without it, `getVariable()` cannot evaluate.

### parentId

```javascript
note.parentId  // number | undefined
```

**Undefined until something assigns it** — the constructor never initialises it. It is written in
four places: `Module.generateMeasures()` (chains each measure to the previous one),
`Module.reindexModule()` (remaps it through the new ids), the measure-creation path in
`src/modals/note-creation.js`, and the module-import path in `src/player.js`.

Evaluation does not read it (the `findTempo()` and `findMeasureLength()` walks that used it are
gone). The editor still does, to find a note's parent when the expression names none. It is **not**
part of the module JSON schema, so it does not survive a save/load round-trip.

### lastModifiedTime

```javascript
note.lastModifiedTime  // number — Date.now() of the last mutation
```

Seeded at construction, then rewritten by `setVariable()` and `_setExpressionSilent()`.

### _depsEpoch / _depsRegKey

Bumped on every expression mutation. `Module._registerNoteDependencies()` builds a key from
`graphGeneration:id:_depsEpoch` and skips re-registration (~15 graph maps) when it is unchanged —
which matters because `markNoteDirty()` re-registers every dependent it touches.

## Variable access

### getVariable()

```javascript
const value = note.getVariable(name)
```

Reads through `module.getEvaluationCache()`, which evaluates first if anything is dirty.

| `name` | Returns |
|---|---|
| `startTime`, `duration`, `frequency`, `amplitude`, `attack`, `release` | `Fraction` |
| `color`, `instrument` | `string \| null` (straight from `note.properties` — no module needed) |
| `measure` | `boolean` (straight from `note.properties`) |
| any `<name>String` | `string \| null` — the expression **source text**, via `getExpressionSource()` (no module needed) |
| any of the six expression names, when unresolvable or when `note.module` is `null` | `null` |
| any other name | `null` |

```javascript
note.getVariable('frequency').valueOf()   // 394.5
note.getVariable('frequencyString')       // '[1].f * (3/2)'
note.getVariable('color')                 // 'rgba(255,0,0,0.5)'
```

### setVariable()

```javascript
note.setVariable(name, value)
```

| `name` | `value` | Effect |
|---|---|---|
| an expression name, or `<name>String` | string | Compile and store; mark the module dirty |
| an expression name | function | Extract the `return` expression, then compile |
| an expression name | `BinaryExpression` | Adopt it directly |
| `color` / `instrument` | string | Set the property; mark the module dirty |
| `measure` | boolean | Set the measure-bar flag (`true` only for a strict `true`); mark the module dirty |

```javascript
note.setVariable('frequency', 'base.f * (3/2)')
note.setVariable('frequencyString', 'base.f * (3/2)')   // identical
note.setVariable('color', '#ff0000')
```

::: warning Compilation failures do not throw out of `setVariable()`
`ExpressionCompiler.compile()` **throws** on an expression it cannot read (a DSL syntax error, or
text in the retired method-chain syntax). `_setExpression()` and the constructor catch that throw
per-property, so a typo leaves the property **unset** (or keeps the previous expression) rather
than silently zeroing it — but the caller of `setVariable()` sees no exception either. Validate
first with `validateDSL()` from `src/dsl/index.js` if you need a structured answer.
:::

### getExpressionSource()

```javascript
const source = note.getExpressionSource('frequency')  // → '[1].f * (3/2)'
```

Returns `expr.sourceText` when the expression was compiled from text — so a DSL note gives you back
exactly the DSL you wrote. Returns `null` for an unset property.

If `sourceText` is empty (a synthesised expression), it falls back to `decompiler.decompile(expr)`,
which decompiles the bytecode to DSL.

### getExpression() / hasExpression()

```javascript
note.getExpression('frequency')   // → BinaryExpression (possibly empty)
note.hasExpression('frequency')   // → boolean — true only when it has bytecode
```

`hasExpression()` tells note kinds apart together with the `measure` flag: a note with `startTime`
and `duration` but no `frequency` is a **measure bar** when `isMeasureNote()` is true and a
**silence** (rest) when it is not. A note with only a `startTime` is a plain marker, not a bar.

### clearExpression()

```javascript
note.clearExpression('amplitude')   // → boolean — false when there was nothing to remove
```

Replaces the expression with an empty one, bumps `_depsEpoch` and notifies the module, so the note
no longer defines the property and the key is no longer serialized. It exists for the three
interpretation variables, `amplitude`, `attack` and `release`, which the note widget lets you
remove: the note then inherits again (the BaseNote's value, else `1` for amplitude, else the
instrument's own envelope for attack and release; see `Module.findAmplitude()`).

### getAllVariables()

```javascript
note.getAllVariables()
// → {
//   startTime: Fraction,  startTimeString: '[1].t + [1].d',
//   duration: Fraction,   durationString: 'base.d',
//   frequency: Fraction,  frequencyString: '[1].f * (3/2)',
//   color: 'rgba(255,0,0,0.5)'
// }
```

Every defined expression appears **twice**: once evaluated, once as its source string. `color` and
`instrument` are included only when set, and `measure: true` only on a measure bar. Code iterating
this object will hit string values — `Object.entries(note.getAllVariables())` is not six
Fractions.

## Dependency tracking

### getAllDependencies()

```javascript
note.getAllDependencies()  // → Set<number>
```

Ids referenced across all six expressions. **The BaseNote is not in it** — base references set the
`referencesBase` flag on the expression instead of adding an edge to note 0.

### referencesBaseNote()

```javascript
note.referencesBaseNote()  // → boolean
```

True when any expression carries `referencesBase`.

## Serialization

### toJSON()

```javascript
note.toJSON()
// → { id: 2, startTime: '[1].t + [1].d', duration: 'base.d', frequency: '[1].f * (3/2)', color: '…' }
```

One entry per non-empty expression, plus `color` / `instrument` when set and `measure: true` on a
measure bar.

::: info This is not the app's save path
`toJSON()` runs each expression through `decompiler.decompile()`, which returns `sourceText`
verbatim when it has it and otherwise decompiles the bytecode to DSL.

The app saves through `Module.createModuleJSON()`, which uses `getExpressionSource()`, and
`Module.createModuleJSONString()`, its text. Reach for those.
:::

## Internal methods

| Method | Contract |
|---|---|
| `_setExpression(name, text)` | Compile, bump `_depsEpoch`, call `_notifyChange()`. |
| `_setExpressionSilent(name, text)` | Compile and bump `_depsEpoch`, but do **not** notify. The caller must mark the note dirty — `Module.batchSetExpressions()` does this, then batches one `markNotesDirtyBatch()`. |
| `_notifyChange()` | `module.markNoteDirty(this.id)` + emit `player:invalidateModuleEndTimeCache`. |

## The `variables` proxy (legacy compatibility)

```javascript
note.variables  // Proxy
```

A compatibility shim, still used across `player.js`, `module.js` and the renderer. It is memoized
per note (it used to allocate a fresh `Proxy` on every access, on hot paths).

| Access | Result |
|---|---|
| `note.variables.frequencyString` | the expression source text |
| `note.variables.frequency` | a **function wrapper**, not a value — call it to get the `Fraction` |
| `String(note.variables.frequency)` | the expression source (its `toString()` is overridden) |
| `note.variables.frequency` on an unset property | `undefined` |
| `note.variables.color` / `.instrument` | the property value |
| `note.variables.x = 'base.f'` | write-through to `setVariable()` |
| `Object.keys(note.variables)` | defined expression names **and** their `*String` twins, plus any set properties |

```javascript
note.variables.frequency()          // Fraction — note the call
String(note.variables.frequency)    // '[1].f * (3/2)'
note.variables.frequencyString      // '[1].f * (3/2)'
```

New code should use `getVariable()` / `setVariable()` / `getExpressionSource()` instead.

## Property reference

| Expression property | Meaning |
|---|---|
| `startTime` | when the note starts, in seconds |
| `duration` | how long it sounds, in seconds. On the BaseNote it is the time unit (`base.d`) |
| `frequency` | pitch in Hz |
| `amplitude` | relative gain, default 1 (inheritable; playback clamps it to 0–4) |
| `attack` | a share of the note's own duration, counted from its start, clamped to 0–1 (inheritable); alias `atk` in the DSL |
| `release` | a share of the note's own duration, counted from the note's end (it rings after the note), clamped to 0–4 (inheritable); alias `rel` in the DSL |

The first three are the language; the last three are interpretation and are the only ones that
fall back to the BaseNote. With no attack or release on the note or the BaseNote, the instrument's
own envelope applies.

| Non-expression property | Meaning |
|---|---|
| `color` | CSS colour string used by the renderer |
| `instrument` | pins the timbre; `null` means "take the instrument of the note's player" (see `Module.findInstrument`) |
| `measure` | `true` marks a measure bar (saved in JSON as `"measure": true`) |

## Example

```javascript
const module = await Module.loadFromJSON({
  baseNote: { frequency: '263', startTime: '0', duration: '1/2' },
  notes: [{ id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' }]
})

const note = module.addNote({
  frequency: '[1].f * (5/4)',
  startTime: '[1].t + [1].d',
  duration: 'base.d'
})

note.setVariable('color', '#4a90d9')
note.setVariable('frequency', '[1].f * (3/2)')   // retune to a fifth

note.getVariable('frequency').valueOf()   // 394.5
note.getExpressionSource('frequency')     // '[1].f * (3/2)'
note.getAllDependencies()                 // Set(1) { 1 }  — BaseNote is never in here
note.referencesBaseNote()                 // true (duration reads base.d)
note.hasExpression('attack')              // false
```

## isMeasureNote()

```javascript
isMeasureNote(note)  // → boolean
```

Exported from `src/note.js`. True for a note whose `measure` property is `true`, and never for the
BaseNote (id `0`). It accepts a `Note` or a plain note object from JSON (it reads
`note.properties.measure` on the first and `note.measure` on the second).

A measure bar is a silent note with a start and a duration, no frequency, and the flag. The flag is
display only: evaluation treats a bar like any other note, and the editor draws it as a dashed line
with a triangle instead of a rest. A silent note without the flag is a silence (rest). It is saved
as `"measure": true` in the module JSON. `Module.getMeasureNotes()` collects every bar;
`Module.generateMeasures()` creates them.

## See also

- [Module Class](/developer/api/module) — creation, evaluation, dependency queries
- [BinaryExpression](/developer/api/binary-expression) — what `note.expressions` holds
- [Expression Syntax](/reference/expressions/syntax) — the DSL these strings are written in
- [Creating Notes](/user-guide/notes/creating-notes) — the user-facing side
