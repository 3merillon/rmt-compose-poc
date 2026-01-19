# Note Class

The Note class represents a single musical note with expressions defining its properties.

## Constructor

```javascript
const note = new Note(id, variables = {})
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `id` | number | Unique note identifier |
| `variables` | object | Initial expression strings |

::: warning
Notes should be created via `module.addNote()`, not directly.
:::

## Properties

### id

```javascript
note.id  // number (read-only)
```

Unique identifier. BaseNote has ID 0, other notes have positive IDs.

### expressions

```javascript
note.expressions  // object
```

Map of property names to BinaryExpression objects:

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
note.properties  // object
```

Non-expression properties:

```javascript
{
  color: string | null,      // CSS color
  instrument: string | null  // Instrument name
}
```

### parentId

```javascript
note.parentId  // number | null
```

Optional parent note ID for hierarchical organization.

## Variable Access

### getVariable()

```javascript
const value = note.getVariable(name)
```

Returns the evaluated value from the module's cache.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Property name |

Returns: `Fraction` object.

Example:
```javascript
const freq = note.getVariable('frequency')  // Fraction
freq.valueOf()  // 440 (JavaScript number)
```

### setVariable()

```javascript
note.setVariable(name, value)
```

Sets an expression or property.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Property name |
| `value` | string | Expression text (for expressions) or value (for properties) |

Example:
```javascript
// Set expression
note.setVariable('frequency', "module.baseNote.getVariable('frequency').mul(new Fraction(2))")

// Set property
note.setVariable('color', '#ff0000')
```

### getExpressionSource()

```javascript
const source = note.getExpressionSource(name)
// → "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))"
```

Returns the original expression text.

### getExpression()

```javascript
const expr = note.getExpression(name)
// → BinaryExpression
```

Returns the compiled BinaryExpression object.

### hasExpression()

```javascript
const has = note.hasExpression(name)
// → boolean
```

Checks if an expression is defined.

### getAllVariables()

```javascript
const all = note.getAllVariables()
// → { startTime: Fraction, duration: Fraction, frequency: Fraction, ... }
```

Returns all evaluated values.

## Dependency Tracking

### getAllDependencies()

```javascript
const deps = note.getAllDependencies()
// → Set<number>
```

Returns IDs of all notes referenced in any expression.

### referencesBaseNote()

```javascript
const refs = note.referencesBaseNote()
// → boolean
```

Checks if any expression references the BaseNote.

## Expression Properties

| Property | Type | Description |
|----------|------|-------------|
| `startTime` | Fraction | When note plays (seconds) |
| `duration` | Fraction | How long note plays (seconds) |
| `frequency` | Fraction | Pitch in Hz |
| `tempo` | Fraction | Tempo in BPM |
| `beatsPerMeasure` | Fraction | Time signature numerator |
| `measureLength` | Fraction | Computed measure duration |

## Non-Expression Properties

| Property | Type | Description |
|----------|------|-------------|
| `color` | string | CSS color for visualization |
| `instrument` | string | Instrument name |

## Internal Methods

### _setExpression()

```javascript
note._setExpression(name, exprText)
```

Compiles expression and notifies module.

### _setExpressionSilent()

```javascript
note._setExpressionSilent(name, exprText)
```

Sets expression without notification (used in batch operations).

### _notifyChange()

```javascript
note._notifyChange()
```

Triggers module cache invalidation and event emission.

## Serialization

### toJSON()

```javascript
const json = note.toJSON()
// → { id, frequency, startTime, duration, color, instrument, ... }
```

Serializes note with expression source text.

## Example Usage

```javascript
// Create via module
const note = module.addNote({
  frequency: "module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))",
  startTime: "new Fraction(0)",
  duration: "new Fraction(60).div(module.findTempo(module.baseNote))"
})

// Set color
note.setVariable('color', '#4a90d9')

// Change frequency
note.setVariable('frequency', "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))")

// Read values (after evaluation)
const freq = note.getVariable('frequency')
console.log(freq.valueOf())  // 660

// Check dependencies
const deps = note.getAllDependencies()
console.log(deps.has(0))  // true (references BaseNote)

// Get source
const source = note.getExpressionSource('frequency')
console.log(source)  // "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))"
```

## See Also

- [Module Class](/developer/api/module) - Module API
- [BinaryExpression](/developer/api/binary-expression) - Expression objects
- [Creating Notes](/user-guide/notes/creating-notes) - User guide
