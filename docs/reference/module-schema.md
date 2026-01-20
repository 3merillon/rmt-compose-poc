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

## Expression Formats

RMT Compose supports two expression formats in JSON files:

### DSL Format (Recommended)

Concise, mathematical notation:

```json
{
  "baseNote": {
    "frequency": "440",
    "tempo": "120"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f * (3/2)",
      "startTime": "base.t",
      "duration": "beat(base)"
    }
  ]
}
```

### Legacy Format

JavaScript-like method chaining (still fully supported):

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "tempo": "new Fraction(120)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))"
    }
  ]
}
```

Both formats can be mixed within the same file - each expression is detected independently.

## BaseNote Object

### DSL Format

```json
{
  "baseNote": {
    "frequency": "440",
    "startTime": "0",
    "duration": "1",
    "tempo": "120",
    "beatsPerMeasure": "4"
  }
}
```

### Legacy Format

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
| `frequency` | string | `"440"` | Base frequency in Hz |
| `startTime` | string | `"0"` | Start time reference |
| `duration` | string | `"1"` | Default duration |
| `tempo` | string | `"60"` | Tempo in BPM |
| `beatsPerMeasure` | string | `"4"` | Time signature numerator |

## Note Object

### DSL Format

```json
{
  "id": 1,
  "frequency": "base.f * (3/2)",
  "startTime": "base.t",
  "duration": "beat(base)",
  "color": "#4a90d9",
  "instrument": "sine-wave"
}
```

### Legacy Format

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

## Expression Syntax Quick Reference

### DSL Syntax

```
440               # Integer
(3/2)             # Fraction
[1].f             # Note 1 frequency
base.t            # BaseNote startTime
a + b             # Add
a * b             # Multiply
2^(1/12)          # Power
tempo(base)       # Get tempo
measure([1])      # Get measure length
beat(base)        # Get beat duration
```

### Legacy Syntax

```javascript
new Fraction(440)
new Fraction(3, 2)
module.getNoteById(1).getVariable('frequency')
module.baseNote.getVariable('startTime')
a.add(b)
a.mul(b)
new Fraction(2).pow(new Fraction(1, 12))
module.findTempo(module.baseNote)
module.findMeasureLength(module.getNoteById(1))
new Fraction(60).div(module.findTempo(module.baseNote))
```

## Complete Example (DSL Format)

```json
{
  "baseNote": {
    "frequency": "440",
    "startTime": "0",
    "duration": "1",
    "tempo": "120",
    "beatsPerMeasure": "4"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f",
      "startTime": "base.t",
      "duration": "beat(base)",
      "color": "#4a90d9"
    },
    {
      "id": 2,
      "frequency": "base.f * (5/4)",
      "startTime": "[1].t + [1].d",
      "duration": "beat(base)",
      "color": "#e74c3c"
    },
    {
      "id": 3,
      "frequency": "base.f * (3/2)",
      "startTime": "[2].t + [2].d",
      "duration": "beat(base)",
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
4. **Valid expressions**: All expression strings must be syntactically valid (DSL or legacy)

## Format Detection

The loader automatically detects whether each expression uses DSL or legacy format:

- **DSL indicators**: `[id].`, `base.`, `(n/n)`, `tempo(`, `measure(`, `beat(`
- **Legacy indicators**: `new Fraction`, `module.`, `.getVariable(`, `.mul(`, `.div(`
- **Plain numbers** (e.g., `440`) are valid in both formats

## Binary Format (Internal)

Internally, expressions are compiled to binary bytecode for efficient evaluation. The JSON format stores the human-readable source; bytecode is generated at load time.

## See Also

- [Saving Modules](/user-guide/modules/saving-modules) - How to save
- [Loading Modules](/user-guide/modules/loading-modules) - How to load
- [Expression Syntax](/reference/expressions/syntax) - Complete expression reference
