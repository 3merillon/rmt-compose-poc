# Module Format

This page documents the JSON schema used by RMT Compose modules.

## Overview

Modules are JSON files containing:
- A `baseNote` object with default values
- A `notes` array with note definitions
- Optional metadata

## Complete Schema

```json
{
  "baseNote": {
    "frequency": "<expression>",
    "startTime": "<expression>",
    "tempo": "<expression>",
    "beatsPerMeasure": "<expression>",
    "instrument": "<string>"
  },
  "notes": [
    {
      "id": "<number>",
      "frequency": "<expression>",
      "startTime": "<expression>",
      "duration": "<expression>",
      "color": "<css-color>",
      "instrument": "<string>"
    }
  ],
  "measures": [
    {
      "id": "<number>",
      "startTime": "<expression>",
      "beatsPerMeasure": "<expression>"
    }
  ]
}
```

## BaseNote Properties

The `baseNote` object provides default values for the module.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `frequency` | expression | Yes | Reference frequency (Hz) |
| `startTime` | expression | Yes | Reference start time |
| `tempo` | expression | Yes | Beats per minute |
| `beatsPerMeasure` | expression | No | Time signature numerator |
| `instrument` | string | No | Default instrument |

### Example BaseNote

```json
{
  "baseNote": {
    "frequency": "440",
    "startTime": "0",
    "tempo": "120",
    "beatsPerMeasure": "4",
    "instrument": "sine-wave"
  }
}
```

<details>
<summary>Legacy JavaScript syntax (also supported)</summary>

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "tempo": "new Fraction(120)",
    "beatsPerMeasure": "new Fraction(4)",
    "instrument": "sine-wave"
  }
}
```
</details>

## Note Properties

Each note in the `notes` array has these properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | number | Yes | Unique identifier (positive integer) |
| `frequency` | expression | Yes | Pitch expression |
| `startTime` | expression | Yes | When the note starts |
| `duration` | expression | Yes | How long the note plays |
| `color` | string | No | CSS color value |
| `instrument` | string | No | Instrument name |

### Example Note

```json
{
  "id": 1,
  "frequency": "base.f * (3/2)",
  "startTime": "base.t",
  "duration": "60 / tempo(base)",
  "color": "rgba(255, 100, 100, 0.7)",
  "instrument": "sine-wave"
}
```

<details>
<summary>Legacy JavaScript syntax (also supported)</summary>

```json
{
  "id": 1,
  "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  "startTime": "module.baseNote.getVariable('startTime')",
  "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
  "color": "rgba(255, 100, 100, 0.7)",
  "instrument": "sine-wave"
}
```
</details>

## Expression Format

Expressions are DSL strings that get compiled to bytecode. The modern DSL format is recommended, but legacy JavaScript syntax is also supported.

### Constants

```
// Integer
"440"

// Fraction
"3/2"

// Negative
"-1/4"
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
"new Fraction(440)"
"new Fraction(3, 2)"
"new Fraction(-1, 4)"
```
</details>

### References

```
// BaseNote property
"base.f"

// Other note property
"[5].t"
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
"module.baseNote.getVariable('frequency')"
"module.getNoteById(5).getVariable('startTime')"
```
</details>

### Operations

```
// Addition
"a + b"

// Subtraction
"a - b"

// Multiplication
"a * b"

// Division
"a / b"

// Power
"a ^ b"

// Negation
"-a"
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
"a.add(b)"
"a.sub(b)"
"a.mul(b)"
"a.div(b)"
"a.pow(b)"
"a.neg()"
```
</details>

### Lookup Functions

```
// Find tempo (walks inheritance chain)
"tempo(base)"

// Find measure length
"measure(base)"
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
"module.findTempo(module.baseNote)"
"module.findMeasureLength(module.baseNote)"
```
</details>

## Measure Properties

Measures define time markers in the composition.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | number | Yes | Unique identifier |
| `startTime` | expression | Yes | Position of the measure bar |
| `beatsPerMeasure` | expression | No | Beats in this measure |

### Example Measure

```json
{
  "id": 1,
  "startTime": "base.t + beat(base) * 4",
  "beatsPerMeasure": "4"
}
```

<details>
<summary>Legacy JavaScript syntax</summary>

```json
{
  "id": 1,
  "startTime": "module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(4)))",
  "beatsPerMeasure": "new Fraction(4)"
}
```
</details>

## Color Format

Colors use CSS color syntax:

```javascript
// RGBA (recommended)
"rgba(255, 100, 100, 0.7)"

// RGB
"rgb(255, 100, 100)"

// Hex
"#ff6464"

// Named
"red"
```

The alpha channel (0.7 in rgba) controls transparency.

## Instrument Names

Built-in instruments:

| Name | Type | Description |
|------|------|-------------|
| `sine-wave` | Synth | Pure sine tone |
| `square-wave` | Synth | Square wave |
| `sawtooth-wave` | Synth | Sawtooth wave |
| `triangle-wave` | Synth | Triangle wave |
| `organ` | Synth | Organ-like |
| `vibraphone` | Synth | Vibraphone-like |
| `piano` | Sample | Piano samples |
| `violin` | Sample | Violin samples |

## ID Rules

- **BaseNote**: Always ID 0 (implicit, not in notes array)
- **Notes and Measures**: Positive integers, assigned sequentially as items are added
- **Uniqueness**: All IDs must be unique within the module (notes and measures share the same ID space)
- **Reordering**: Use **Reorder Module** to renumber all IDs sequentially (measures first, then notes)

## Complete Example

```json
{
  "baseNote": {
    "frequency": "263",
    "startTime": "0",
    "tempo": "100",
    "beatsPerMeasure": "4"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f",
      "startTime": "base.t",
      "duration": "60 / tempo(base)",
      "color": "rgba(100, 150, 255, 0.7)",
      "instrument": "sine-wave"
    },
    {
      "id": 2,
      "frequency": "[1].f * (5/4)",
      "startTime": "[1].t + [1].d",
      "duration": "60 / tempo(base)",
      "color": "rgba(255, 150, 100, 0.7)",
      "instrument": "sine-wave"
    },
    {
      "id": 3,
      "frequency": "[2].f * (6/5)",
      "startTime": "[2].t + [2].d",
      "duration": "60 / tempo(base) * 2",
      "color": "rgba(150, 255, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```

<details>
<summary>Legacy JavaScript syntax (also supported)</summary>

```json
{
  "baseNote": {
    "frequency": "new Fraction(263)",
    "startTime": "new Fraction(0)",
    "tempo": "new Fraction(100)",
    "beatsPerMeasure": "new Fraction(4)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency')",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "rgba(100, 150, 255, 0.7)",
      "instrument": "sine-wave"
    },
    {
      "id": 2,
      "frequency": "module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))",
      "startTime": "module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "rgba(255, 150, 100, 0.7)",
      "instrument": "sine-wave"
    },
    {
      "id": 3,
      "frequency": "module.getNoteById(2).getVariable('frequency').mul(new Fraction(6, 5))",
      "startTime": "module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))",
      "color": "rgba(150, 255, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```
</details>

## Validation

When loading a module, RMT Compose validates:

1. **JSON syntax**: Must be valid JSON
2. **Required fields**: baseNote, notes array
3. **Expression syntax**: All expressions must parse correctly
4. **ID uniqueness**: No duplicate note IDs
5. **Reference validity**: Referenced note IDs must exist
6. **No circular dependencies**: No A→B→A reference chains

## Common Errors

### Invalid JSON

```json
{
  "baseNote": {
    frequency: "new Fraction(440)"  // Missing quotes on key
  }
}
```

### Invalid Expression

```json
{
  "frequency": "(3/2 * ("  // Syntax error - missing closing parens
}
```

### Circular Dependency

```json
{
  "notes": [
    { "id": 1, "frequency": "[2].f" },
    { "id": 2, "frequency": "[1].f" }
  ]
}
```

### Missing Reference

```json
{
  "notes": [
    { "id": 1, "frequency": "[99].f" }
    // Note 99 doesn't exist!
  ]
}
```
