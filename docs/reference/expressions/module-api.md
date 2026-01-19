# Module API

The Module object provides methods for accessing notes and computing musical values within expressions.

## Note References

### module.baseNote

The reference note (ID 0) that provides default values for the entire module:

```javascript
module.baseNote.getVariable('frequency')      // Base frequency (default: 440 Hz)
module.baseNote.getVariable('tempo')          // Base tempo (default: 60 BPM)
module.baseNote.getVariable('beatsPerMeasure') // Time signature (default: 4)
```

The BaseNote is a reference point, not a playable note. All other notes can inherit from or reference its values.

### module.getNoteById(id)

Returns a note by its numeric ID for referencing in expressions:

```javascript
module.getNoteById(1).getVariable('frequency')   // Note 1's frequency
module.getNoteById(5).getVariable('startTime')   // Note 5's start time
module.getNoteById(10).getVariable('duration')   // Note 10's duration
```

::: warning Note IDs
Note IDs are positive integers starting from 1. ID 0 is reserved for the BaseNote. Referencing a non-existent ID will cause an error.
:::

## Musical Lookup Functions

### module.findTempo(note)

Walks the inheritance chain to find the effective tempo for a note:

```javascript
module.findTempo(module.baseNote)  // Returns tempo in BPM (Fraction)
```

Used in duration calculations:

```javascript
// One beat duration in seconds
new Fraction(60).div(module.findTempo(module.baseNote))
```

### module.findMeasureLength(note)

Computes the duration of one measure in seconds:

```javascript
module.findMeasureLength(module.baseNote)  // Measure duration (Fraction)
```

Calculated as: `beatsPerMeasure / tempo * 60`

Example at 120 BPM with 4/4 time:
```javascript
// 4 beats / 120 BPM * 60 = 2 seconds per measure
```

### module.findInstrument(note)

Traces the frequency source to determine which instrument to use:

```javascript
module.findInstrument(module.baseNote)  // Instrument name string
```

## Variable Access

### note.getVariable(name)

Returns the evaluated value of a note property:

```javascript
module.baseNote.getVariable('frequency')       // Frequency in Hz
module.baseNote.getVariable('startTime')       // Start time in seconds
module.baseNote.getVariable('duration')        // Duration in seconds
module.baseNote.getVariable('tempo')           // Tempo in BPM
module.baseNote.getVariable('beatsPerMeasure') // Beats per measure
```

All values are returned as Fraction objects for exact arithmetic.

## Available Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `frequency` | Pitch in Hz | 440 |
| `startTime` | When note plays (seconds) | 0 |
| `duration` | How long note plays (seconds) | 1 |
| `tempo` | Speed in BPM | 60 |
| `beatsPerMeasure` | Time signature numerator | 4 |
| `measureLength` | Computed measure duration | 4 |

## Common Expression Patterns

### Relative Frequency

```javascript
// Perfect fifth above BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Major third above another note
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Octave below BaseNote
module.baseNote.getVariable('frequency').div(new Fraction(2))
```

### Sequential Notes

```javascript
// Start when previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```

### Tempo-Relative Duration

```javascript
// One beat
new Fraction(60).div(module.findTempo(module.baseNote))

// One measure
module.findMeasureLength(module.baseNote)

// Half a beat
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```

### TET Intervals

```javascript
// 12-TET semitone above BaseNote
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 12)))

// 12-TET major third (4 semitones)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(4, 12)))
```

## Dependency Tracking

When an expression references another note, a dependency is automatically created:

```javascript
// This creates a dependency: Note 2 depends on Note 1
// Note 2's frequency expression:
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
```

If Note 1's frequency changes, Note 2 will automatically re-evaluate.

The dependency graph ensures:
- Dependencies are evaluated before dependents
- Circular dependencies are detected and prevented
- Only affected notes are re-evaluated (incremental updates)

## See Also

- [Expression Syntax](/reference/expressions/syntax) - Complete syntax reference
- [Fraction API](/reference/expressions/fraction-api) - Fraction methods
- [Dependencies](/user-guide/notes/dependencies) - Dependency visualization
- [Dependency Graph](/developer/core/dependency-graph) - Technical details
