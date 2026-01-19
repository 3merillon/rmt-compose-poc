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
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "tempo": "new Fraction(120)",
    "beatsPerMeasure": "new Fraction(4)",
    "instrument": "sine-wave"
  }
}
```

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
  "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  "startTime": "module.baseNote.getVariable('startTime')",
  "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
  "color": "rgba(255, 100, 100, 0.7)",
  "instrument": "sine-wave"
}
```

## Expression Format

Expressions are JavaScript-like strings that get compiled to bytecode.

### Constants

```javascript
// Integer
"new Fraction(440)"

// Fraction
"new Fraction(3, 2)"

// Negative
"new Fraction(-1, 4)"
```

### References

```javascript
// BaseNote property
"module.baseNote.getVariable('frequency')"

// Other note property
"module.getNoteById(5).getVariable('startTime')"
```

### Operations

```javascript
// Addition
"a.add(b)"

// Subtraction
"a.sub(b)"

// Multiplication
"a.mul(b)"

// Division
"a.div(b)"

// Power
"a.pow(b)"

// Negation
"a.neg()"
```

### Lookup Functions

```javascript
// Find tempo (walks inheritance chain)
"module.findTempo(module.baseNote)"

// Find measure length
"module.findMeasureLength(module.baseNote)"
```

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
  "id": 100,
  "startTime": "module.baseNote.getVariable('startTime').add(new Fraction(4))",
  "beatsPerMeasure": "new Fraction(4)"
}
```

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
- **Notes**: Positive integers (1, 2, 3, ...)
- **Measures**: Typically 100+ to distinguish from notes
- **Uniqueness**: All IDs must be unique within the module

## Complete Example

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
  "frequency": "new Fraction(3, 2.mul()"  // Syntax error
}
```

### Circular Dependency

```json
{
  "notes": [
    { "id": 1, "frequency": "module.getNoteById(2).getVariable('frequency')" },
    { "id": 2, "frequency": "module.getNoteById(1).getVariable('frequency')" }
  ]
}
```

### Missing Reference

```json
{
  "notes": [
    { "id": 1, "frequency": "module.getNoteById(99).getVariable('frequency')" }
    // Note 99 doesn't exist!
  ]
}
```
