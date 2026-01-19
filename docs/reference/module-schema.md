# Module JSON Schema

RMT Compose modules are saved as JSON files. This document describes the complete schema.

## Top-Level Structure

```json
{
  "baseNote": { ... },
  "notes": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `baseNote` | object | Reference note with default values |
| `notes` | array | Array of note objects |

## BaseNote Object

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "duration": "new Fraction(1)",
    "tempo": "new Fraction(120)",
    "beatsPerMeasure": "new Fraction(4)"
  }
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `frequency` | string | `"new Fraction(440)"` | Base frequency in Hz |
| `startTime` | string | `"new Fraction(0)"` | Start time reference |
| `duration` | string | `"new Fraction(1)"` | Default duration |
| `tempo` | string | `"new Fraction(60)"` | Tempo in BPM |
| `beatsPerMeasure` | string | `"new Fraction(4)"` | Time signature numerator |

## Note Object

```json
{
  "id": 1,
  "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
  "startTime": "module.baseNote.getVariable('startTime')",
  "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
  "color": "#4a90d9",
  "instrument": "sine-wave"
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | number | Yes | Unique note identifier (positive integer) |
| `frequency` | string | No | Frequency expression |
| `startTime` | string | No | Start time expression |
| `duration` | string | No | Duration expression |
| `tempo` | string | No | Tempo override (rare) |
| `beatsPerMeasure` | string | No | Time signature override (rare) |
| `color` | string | No | CSS color for visualization |
| `instrument` | string | No | Instrument name |

## Expression Strings

All expression properties are stored as strings that will be compiled at load time:

```json
// Constant value
"new Fraction(440)"

// Reference to BaseNote
"module.baseNote.getVariable('frequency')"

// Reference to another note
"module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))"

// Complex expression
"module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))"
```

## Complete Example

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "duration": "new Fraction(1)",
    "tempo": "new Fraction(120)",
    "beatsPerMeasure": "new Fraction(4)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency')",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "#4a90d9"
    },
    {
      "id": 2,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))",
      "startTime": "module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "#e74c3c"
    },
    {
      "id": 3,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
      "startTime": "module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "#2ecc71"
    }
  ]
}
```

This creates a simple C-E-G arpeggio using just intonation ratios.

## Instruments

Built-in instrument names:

| Name | Type | Description |
|------|------|-------------|
| `sine-wave` | Synth | Pure sine wave |
| `square-wave` | Synth | Square wave |
| `sawtooth-wave` | Synth | Sawtooth wave |
| `triangle-wave` | Synth | Triangle wave |
| `organ` | Synth | Organ with harmonics |
| `vibraphone` | Synth | Vibraphone with vibrato |
| `piano` | Sample | Piano samples |
| `violin` | Sample | Violin samples |

## File Extension

RMT Compose modules use the `.json` extension. When saving, the suggested filename is `module.json`.

## Validation

When loading a module:

1. **ID uniqueness**: All note IDs must be unique
2. **ID validity**: Referenced note IDs must exist
3. **No circular dependencies**: Expressions cannot form dependency cycles
4. **Valid expressions**: All expression strings must be syntactically valid

## Binary Format (Internal)

Internally, expressions are compiled to binary bytecode for efficient evaluation. The JSON format stores the human-readable source; bytecode is generated at load time.

## See Also

- [Saving Modules](/user-guide/modules/saving-modules) - How to save
- [Loading Modules](/user-guide/modules/loading-modules) - How to load
- [Expression Syntax](/reference/expressions/syntax) - Expression language
