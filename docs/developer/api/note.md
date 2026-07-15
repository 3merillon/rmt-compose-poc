---
title: Note Class
description: API reference for the Note class in src/note.js — expression storage, variable get/set, dependency introspection, and the legacy variables proxy.
---

# Note Class

A `Note` (`src/note.js`) is six compiled expressions plus two plain properties. It stores no
numbers: every musical value is an expression, and reading one goes through the module's evaluator.

```javascript
import { Note } from './note.js'
```

## Constructor

```javascript
const note = new Note(id, variables = {})
```

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Note id. `0` is the BaseNote. |
| `variables` | object | Expression strings (DSL or legacy), plus optional `color` / `instrument`. |

::: warning Create notes through the module
`module.addNote(variables)` or `Module.loadFromJSON()`. A `Note` built directly has
`note.module === null`, so `getVariable()` returns `null` for every **evaluated** property (there
is no evaluator to ask) and no dependency registration happens. Source text and `color` /
`instrument` still read back.
:::

The constructor accepts a value per property in several shapes (`_initFromVariables`,
`src/note.js:53-104`): a plain string (compiled), a `*String` key (preferred over the plain key
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

```javascript
{
  startTime: BinaryExpression,
  duration: BinaryExpression,
  frequency: BinaryExpression,
  tempo: BinaryExpression,
  beatsPerMeasure: BinaryExpression,
  measureLength: BinaryExpression
}
```

### properties

```javascript
note.properties  // { color: string | null, instrument: string | null }
```

Both default to `null` — including on the BaseNote. A `null` instrument is what lets
`module.findInstrument()` fall through to the configurable default instrument.

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

It is not decorative: `Module.findTempo()` and `Module.findMeasureLength()` walk the `parentId`
chain to resolve inherited tempo and measure length. It is also **not** part of the module JSON
schema, so it does not survive a save/load round-trip.

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
| `startTime`, `duration`, `frequency`, `tempo`, `beatsPerMeasure`, `measureLength` | `Fraction` |
| `color`, `instrument` | `string \| null` (straight from `note.properties` — no module needed) |
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

```javascript
note.setVariable('frequency', 'base.f * (3/2)')
note.setVariable('frequencyString', 'base.f * (3/2)')   // identical
note.setVariable('color', '#ff0000')
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
note.setVariable('frequency', "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))")
```

The compiler sniffs the format per string (`isDSLSyntax()`), so a legacy string and its DSL
equivalent produce identical bytecode.
</details>

::: warning Compilation failures do not throw out of `setVariable()`
`ExpressionCompiler.compile()` **throws** on an expression neither parser can read, after emitting
a `console.error` naming the expression. `_setExpression()` and the constructor catch that throw
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
which emits **legacy** syntax. For DSL output from bytecode use `decompileToDSL()` instead.

### getExpression() / hasExpression()

```javascript
note.getExpression('frequency')   // → BinaryExpression (possibly empty)
note.hasExpression('frequency')   // → boolean — true only when it has bytecode
```

`hasExpression()` is how note kinds are told apart: a **measure** has `startTime` but no `duration`
and no `frequency`; a **silence** has `startTime` and `duration` but no `frequency`.

### getAllVariables()

```javascript
note.getAllVariables()
// → {
//   startTime: Fraction,  startTimeString: '[1].t + [1].d',
//   duration: Fraction,   durationString: 'beat(base)',
//   frequency: Fraction,  frequencyString: '[1].f * (3/2)',
//   color: 'rgba(255,0,0,0.5)'
// }
```

Every defined expression appears **twice**: once evaluated, once as its source string. `color` and
`instrument` are included only when set. Code iterating this object will hit string values —
`Object.entries(note.getAllVariables())` is not six Fractions.

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
// → { id: 2, startTime: '[1].t + [1].d', duration: 'beat(base)', frequency: '[1].f * (3/2)', color: '…' }
```

One entry per non-empty expression, plus `color` / `instrument` when set.

::: info This is not the app's save path
`toJSON()` runs each expression through the **legacy** decompiler. That decompiler returns
`sourceText` verbatim when it has it, so for a note loaded from text you get your DSL back — but a
synthesised expression comes out as a legacy method chain.

The app saves through `Module.createModuleJSON()`, which uses `getExpressionSource()`. Reach for
that one.
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
| `duration` | how long it sounds, in seconds |
| `frequency` | pitch in Hz |
| `tempo` | BPM (inheritable — falls back to the BaseNote) |
| `beatsPerMeasure` | time-signature numerator (inheritable) |
| `measureLength` | measure duration in seconds (inheritable) |

| Non-expression property | Meaning |
|---|---|
| `color` | CSS colour string used by the renderer |
| `instrument` | pins the timbre; `null` means "inherit down the frequency chain" |

## Example

```javascript
const module = await Module.loadFromJSON({
  baseNote: { frequency: '263', startTime: '0', tempo: '120', beatsPerMeasure: '4' },
  notes: [{ id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: 'base.f' }]
})

const note = module.addNote({
  frequency: '[1].f * (5/4)',
  startTime: '[1].t + [1].d',
  duration: 'beat(base)'
})

note.setVariable('color', '#4a90d9')
note.setVariable('frequency', '[1].f * (3/2)')   // retune to a fifth

note.getVariable('frequency').valueOf()   // 394.5
note.getExpressionSource('frequency')     // '[1].f * (3/2)'
note.getAllDependencies()                 // Set(1) { 1 }  — BaseNote is never in here
note.referencesBaseNote()                 // true (duration reads beat(base))
note.hasExpression('tempo')               // false
```

## See also

- [Module Class](/developer/api/module) — creation, evaluation, dependency queries
- [BinaryExpression](/developer/api/binary-expression) — what `note.expressions` holds
- [Expression Syntax](/reference/expressions/syntax) — the DSL these strings are written in
- [Creating Notes](/user-guide/notes/creating-notes) — the user-facing side
