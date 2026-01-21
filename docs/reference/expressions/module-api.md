# Module API

The Module object provides methods for accessing notes and computing musical values within expressions.

## DSL vs Legacy Syntax

| DSL | Legacy JavaScript |
|-----|-------------------|
| `base.f` | `module.baseNote.getVariable('frequency')` |
| `base.t` | `module.baseNote.getVariable('startTime')` |
| `base.d` | `module.baseNote.getVariable('duration')` |
| `[1].f` | `module.getNoteById(1).getVariable('frequency')` |
| `tempo(base)` | `module.findTempo(module.baseNote)` |
| `measure(base)` | `module.findMeasureLength(module.baseNote)` |

## Note References

### BaseNote (base)

The reference note (ID 0) that provides default values for the entire module:

```
base.f     // Base frequency (default: 440 Hz)
base.t     // Base start time
base.d     // Base duration
tempo(base)      // Base tempo (default: 60 BPM)
measure(base)    // Measure length
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')      // Base frequency (default: 440 Hz)
module.baseNote.getVariable('tempo')          // Base tempo (default: 60 BPM)
module.baseNote.getVariable('beatsPerMeasure') // Time signature (default: 4)
```
</details>

The BaseNote is a reference point, not a playable note. All other notes can inherit from or reference its values.

### Note by ID: `[n]`

References a note by its numeric ID:

```
[1].f    // Note 1's frequency
[5].t    // Note 5's start time
[10].d   // Note 10's duration
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency')   // Note 1's frequency
module.getNoteById(5).getVariable('startTime')   // Note 5's start time
module.getNoteById(10).getVariable('duration')   // Note 10's duration
```
</details>

::: warning Note IDs
Note IDs are positive integers starting from 1. ID 0 is reserved for the BaseNote. Referencing a non-existent ID will cause an error.
:::

## Musical Lookup Functions

### tempo(note)

Walks the inheritance chain to find the effective tempo for a note:

```
tempo(base)  // Returns tempo in BPM
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findTempo(module.baseNote)  // Returns tempo in BPM (Fraction)
```
</details>

Used in duration calculations:

```
// One beat duration in seconds
60 / tempo(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// One beat duration in seconds
new Fraction(60).div(module.findTempo(module.baseNote))
```
</details>

### measure(note)

Computes the duration of one measure in seconds:

```
measure(base)  // Measure duration in seconds
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findMeasureLength(module.baseNote)  // Measure duration (Fraction)
```
</details>

Calculated as: `beatsPerMeasure / tempo * 60`

Example at 120 BPM with 4/4 time:
```
// 4 beats / 120 BPM * 60 = 2 seconds per measure
```

### beat(note)

Returns the duration of one beat in seconds:

```
beat(base)  // = 60 / tempo(base)
```

### instrument(note)

Traces the frequency source to determine which instrument to use:

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findInstrument(module.baseNote)  // Instrument name string
```
</details>

## Property Shortcuts

| Property | Shortcut | Legacy |
|----------|----------|--------|
| frequency | `.f` | `.getVariable('frequency')` |
| startTime | `.t` | `.getVariable('startTime')` |
| duration | `.d` | `.getVariable('duration')` |
| beatsPerMeasure | `.bpm` | `.getVariable('beatsPerMeasure')` |

## Available Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `frequency` / `f` | Pitch in Hz | 440 |
| `startTime` / `t` | When note plays (seconds) | 0 |
| `duration` / `d` | How long note plays (seconds) | 1 |
| `tempo` | Speed in BPM | 60 |
| `beatsPerMeasure` / `bpm` | Time signature numerator | 4 |
| `measureLength` | Computed measure duration | 4 |

## Common Expression Patterns

### Relative Frequency

```
// Perfect fifth above BaseNote
base.f * (3/2)

// Major third above another note
[1].f * (5/4)

// Octave below BaseNote
base.f / 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Perfect fifth above BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Major third above another note
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Octave below BaseNote
module.baseNote.getVariable('frequency').div(new Fraction(2))
```
</details>

### Sequential Notes

```
// Start when previous note ends
[prev].t + [prev].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start when previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```
</details>

### Tempo-Relative Duration

```
// One beat
60 / tempo(base)

// One measure
measure(base)

// Half a beat
60 / tempo(base) * (1/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// One beat
new Fraction(60).div(module.findTempo(module.baseNote))

// One measure
module.findMeasureLength(module.baseNote)

// Half a beat
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```
</details>

### TET Intervals

```
// 12-TET semitone above BaseNote
base.f * 2 ^ (1/12)

// 12-TET major third (4 semitones)
base.f * 2 ^ (4/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// 12-TET semitone above BaseNote
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 12)))

// 12-TET major third (4 semitones)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(4, 12)))
```
</details>

## Dependency Tracking

When an expression references another note, a dependency is automatically created:

```
// This creates a dependency: Note 2 depends on Note 1
// Note 2's frequency expression:
[1].f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// This creates a dependency: Note 2 depends on Note 1
// Note 2's frequency expression:
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

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
