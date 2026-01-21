# Measure-Based Timing

Learn how to work with tempo, beats, and measures to create rhythmically structured compositions.

## Understanding Tempo in RMT Compose

Tempo is stored in the `tempo` property as beats per minute (BPM). The BaseNote has a default tempo of 60 BPM.

### Finding the Tempo

Use `tempo(note)` to get the effective tempo for any note:

```
tempo(base)  // Returns 60 by default
```

This walks up the dependency chain to find the nearest defined tempo.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findTempo(module.baseNote)  // Returns Fraction(60) by default
```

</details>

## Converting Beats to Seconds

The fundamental formula:

```
seconds = beats × (60 / tempo)
```

In expression form, use the `beat()` helper for cleaner code:

```
// One beat at current tempo (preferred)
beat(base)

// Two beats
beat(base) * 2

// Half beat
beat(base) * (1/2)
```

The `beat(base)` helper is equivalent to `60 / tempo(base)`.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// One beat at current tempo
new Fraction(60).div(module.findTempo(module.baseNote))

// Two beats
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Half beat
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```

</details>

## Setting Note Duration by Beats

### Whole Note (4 beats)

```
duration: beat(base) * 4
```

### Half Note (2 beats)

```
duration: beat(base) * 2
```

### Quarter Note (1 beat)

```
duration: beat(base)
```

### Eighth Note (1/2 beat)

```
duration: beat(base) * (1/2)
```

### Sixteenth Note (1/4 beat)

```
duration: beat(base) * (1/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Whole Note (4 beats)
duration: new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(4))

// Half Note (2 beats)
duration: new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Quarter Note (1 beat)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Eighth Note (1/2 beat)
duration: new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))

// Sixteenth Note (1/4 beat)
duration: new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 4))
```

</details>

## Working with Measures

### Measure Length

A measure's length depends on:
1. **Tempo** - How fast beats occur
2. **beatsPerMeasure** - How many beats in each measure (time signature numerator)

```
// Measure length in seconds
measure(base)

// Or manually:
// beatsPerMeasure × (60 / tempo)
4 * (60 / tempo(base))
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Measure length in seconds
module.findMeasureLength(module.baseNote)

// Or manually:
// beatsPerMeasure × (60 / tempo)
new Fraction(4).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

</details>

### Positioning Notes by Measure

#### Start of Measure 1

```
startTime: 0
```

#### Start of Measure 2

```
startTime: measure(base)
```

#### Start of Measure N

```
// Measure N (0-indexed)
startTime: measure(base) * N
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start of Measure 1
startTime: new Fraction(0)

// Start of Measure 2
startTime: module.findMeasureLength(module.baseNote)

// Start of Measure N (0-indexed)
startTime: module.findMeasureLength(module.baseNote).mul(new Fraction(N))
```

</details>

### Beat Offsets Within Measures

Position a note at beat 3 of measure 2:

```
// Measure 2 starts at one measure length
// Beat 3 is 2 beats into the measure (0-indexed)
startTime: measure(base) + beat(base) * 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
startTime: module.findMeasureLength(module.baseNote)
  .add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2)))
```

</details>

## Practical Example: 4/4 Drum Pattern

Build a simple kick-snare pattern:

```
// Set tempo to 120 BPM in BaseNote
// BaseNote: tempo = 120

// Beat helper (for reference)
// 1 beat at 120 BPM = 60/120 = 0.5 seconds

// Kick on beat 1 (measure 1)
startTime: base.t
duration: beat(base)

// Snare on beat 3 (measure 1)
startTime: base.t + beat(base) * 2
duration: beat(base)

// Kick on beat 1 (measure 2)
startTime: base.t + measure(base)
duration: beat(base)

// Snare on beat 3 (measure 2)
startTime: base.t + measure(base) + beat(base) * 2
duration: beat(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Set tempo to 120 BPM in BaseNote
// BaseNote: tempo = new Fraction(120)

// Beat helper (for reference)
// 1 beat at 120 BPM = 60/120 = 0.5 seconds

// Kick on beat 1 (measure 1)
startTime: module.baseNote.getVariable('startTime')
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Snare on beat 3 (measure 1)
startTime: module.baseNote.getVariable('startTime')
  .add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2)))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Kick on beat 1 (measure 2)
startTime: module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Snare on beat 3 (measure 2)
startTime: module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))
  .add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2)))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

</details>

## Chaining Rhythmic Notes

### Sequential Quarter Notes

```
// Note 1: Beat 1
startTime: base.t
duration: beat(base)

// Note 2: Beat 2 (starts after Note 1)
startTime: [1].t + [1].d
duration: beat(base)

// Note 3: Beat 3 (starts after Note 2)
startTime: [2].t + [2].d
duration: beat(base)
```

### Mixed Rhythms

```
// Half note (2 beats)
duration: beat(base) * 2

// Followed by two quarter notes (1 beat each)
// ...chain as above
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: Beat 1
startTime: module.baseNote.getVariable('startTime')
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Note 2: Beat 2 (starts after Note 1)
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Note 3: Beat 3 (starts after Note 2)
startTime: module.getNoteById(2).getVariable('startTime')
  .add(module.getNoteById(2).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Half note (2 beats)
duration: new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))
```

</details>

## Changing Tempo Mid-Composition

You can set a different tempo for a note, and all notes that depend on it will inherit that tempo.

### Creating a Tempo Change

```
// Note at new tempo section
tempo: 140  // New tempo: 140 BPM
startTime: base.t + measure(base) * 4  // Starts at measure 5
duration: beat(base)  // Uses inherited tempo
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note at new tempo section
tempo: new Fraction(140)  // New tempo: 140 BPM
startTime: module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote).mul(new Fraction(4)))  // Starts at measure 5
duration: new Fraction(60).div(module.findTempo(module.baseNote))  // Uses inherited tempo
```

</details>

### Notes Inheriting New Tempo

When notes reference a note with a custom tempo:

```
// This note inherits tempo from Note 5 (which has tempo = 140)
duration: 60 / tempo([5])
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
duration: new Fraction(60).div(module.findTempo(module.getNoteById(5)))
```

</details>

## Time Signatures

### 4/4 Time (Default)

- 4 beats per measure
- Quarter note gets the beat

```
beatsPerMeasure: 4
```

### 3/4 Time (Waltz)

- 3 beats per measure
- Quarter note gets the beat

```
beatsPerMeasure: 3
```

### 6/8 Time

- 6 beats per measure (compound duple)
- Eighth note gets the beat

```
beatsPerMeasure: 6
// Adjust duration calculations for eighth note = 1 beat
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// 4/4 Time
beatsPerMeasure: new Fraction(4)

// 3/4 Time (Waltz)
beatsPerMeasure: new Fraction(3)

// 6/8 Time
beatsPerMeasure: new Fraction(6)
```

</details>

## Practical Example: Tempo Hierarchy

Build a composition with verse and chorus at different tempos:

```
// BaseNote: tempo = 100 BPM, beatsPerMeasure = 4

// Verse root note (inherits BaseNote tempo)
// ID: 1
frequency: base.f
startTime: base.t
duration: beat(base)

// More verse notes depend on Note 1...

// Chorus root note (new tempo)
// ID: 10
frequency: base.f
tempo: 120  // Faster chorus!
startTime: base.t + measure(base) * 8  // After 8 measures of verse
duration: beat([10])  // Uses its own tempo

// Chorus notes depend on Note 10 and use its tempo
startTime: [10].t + [10].d
duration: beat([10])  // Uses 120 BPM
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// BaseNote: tempo = 100 BPM, beatsPerMeasure = 4

// Verse root note (inherits BaseNote tempo)
// ID: 1
frequency: module.baseNote.getVariable('frequency')
startTime: module.baseNote.getVariable('startTime')
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// More verse notes depend on Note 1...

// Chorus root note (new tempo)
// ID: 10
frequency: module.baseNote.getVariable('frequency')
tempo: new Fraction(120)  // Faster chorus!
startTime: module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote).mul(new Fraction(8)))  // After 8 measures of verse
duration: new Fraction(60).div(module.findTempo(module.getNoteById(10)))  // Uses its own tempo

// Chorus notes depend on Note 10 and use its tempo
startTime: module.getNoteById(10).getVariable('startTime')
  .add(module.getNoteById(10).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.getNoteById(10)))  // Uses 120 BPM
```

</details>

## Quick Reference: Note Durations

At 60 BPM (1 beat = 1 second):

| Note Type | Beats | Duration Expression |
|-----------|-------|---------------------|
| Whole | 4 | `beat(base) * 4` |
| Half | 2 | `beat(base) * 2` |
| Quarter | 1 | `beat(base)` |
| Eighth | 1/2 | `beat(base) * (1/2)` |
| Sixteenth | 1/4 | `beat(base) * (1/4)` |
| Triplet eighth | 1/3 | `beat(base) * (1/3)` |
| Dotted quarter | 1.5 | `beat(base) * (3/2)` |

## Tips for Rhythmic Composition

### 1. Start with Tempo in BaseNote

Set your base tempo early - changing it later will cascade through all dependent notes.

### 2. Create a Beat Reference

Consider creating a dedicated "beat reference" note that other notes can depend on for consistent timing.

### 3. Use Measure Calculations

For complex pieces, position notes by measure and beat rather than absolute time:

```
// Measure 3, Beat 2
startTime: base.t + measure(base) * 2 + beat(base)  // Measures 1-2 + 1 beat
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Measure 3, Beat 2
startTime: module.baseNote.getVariable('startTime')
  .add(module.findMeasureLength(module.baseNote).mul(new Fraction(2)))  // Measures 1-2
  .add(new Fraction(60).div(module.findTempo(module.baseNote)))  // + 1 beat
```

</details>

## Next Steps

- [Microtonal Composition](/tutorials/advanced/microtonal) - Explore non-standard tunings
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) - Advanced note relationships
- [Module Library Creation](/tutorials/workflows/module-library) - Build reusable modules

