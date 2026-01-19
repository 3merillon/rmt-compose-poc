# Measure-Based Timing

Learn how to work with tempo, beats, and measures to create rhythmically structured compositions.

## Understanding Tempo in RMT Compose

Tempo is stored in the `tempo` property as beats per minute (BPM). The BaseNote has a default tempo of 60 BPM.

### Finding the Tempo

Use `module.findTempo(note)` to get the effective tempo for any note:

```javascript
module.findTempo(module.baseNote)  // Returns Fraction(60) by default
```

This walks up the dependency chain to find the nearest defined tempo.

## Converting Beats to Seconds

The fundamental formula:

```
seconds = beats × (60 / tempo)
```

In expression form:

```javascript
// One beat at current tempo
new Fraction(60).div(module.findTempo(module.baseNote))

// Two beats
new Fraction(2).mul(new Fraction(60).div(module.findTempo(module.baseNote)))

// Half beat
new Fraction(1, 2).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

## Setting Note Duration by Beats

### Whole Note (4 beats)

```javascript
duration: new Fraction(4).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

### Half Note (2 beats)

```javascript
duration: new Fraction(2).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

### Quarter Note (1 beat)

```javascript
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

### Eighth Note (1/2 beat)

```javascript
duration: new Fraction(1, 2).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

### Sixteenth Note (1/4 beat)

```javascript
duration: new Fraction(1, 4).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

## Working with Measures

### Measure Length

A measure's length depends on:
1. **Tempo** - How fast beats occur
2. **beatsPerMeasure** - How many beats in each measure (time signature numerator)

```javascript
// Measure length in seconds
module.findMeasureLength(module.baseNote)

// Or manually:
// beatsPerMeasure × (60 / tempo)
new Fraction(4).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
```

### Positioning Notes by Measure

#### Start of Measure 1

```javascript
startTime: new Fraction(0)
```

#### Start of Measure 2

```javascript
startTime: module.findMeasureLength(module.baseNote)
```

#### Start of Measure N

```javascript
// Measure N (0-indexed)
startTime: module.findMeasureLength(module.baseNote).mul(new Fraction(N))
```

### Beat Offsets Within Measures

Position a note at beat 3 of measure 2:

```javascript
// Measure 2 starts at one measure length
// Beat 3 is 2 beats into the measure (0-indexed)
startTime: module.findMeasureLength(module.baseNote)
  .add(new Fraction(2).mul(new Fraction(60).div(module.findTempo(module.baseNote))))
```

## Practical Example: 4/4 Drum Pattern

Build a simple kick-snare pattern:

```javascript
// Set tempo to 120 BPM in BaseNote
// BaseNote: tempo = new Fraction(120)

// Beat helper (for reference)
// 1 beat at 120 BPM = 60/120 = 0.5 seconds

// Kick on beat 1 (measure 1)
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Snare on beat 3 (measure 1)
startTime: new Fraction(2).mul(new Fraction(60).div(module.findTempo(module.baseNote)))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Kick on beat 1 (measure 2)
startTime: module.findMeasureLength(module.baseNote)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Snare on beat 3 (measure 2)
startTime: module.findMeasureLength(module.baseNote)
  .add(new Fraction(2).mul(new Fraction(60).div(module.findTempo(module.baseNote))))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

## Chaining Rhythmic Notes

### Sequential Quarter Notes

```javascript
// Note 1: Beat 1
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Note 2: Beat 2 (starts after Note 1)
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Note 3: Beat 3 (starts after Note 2)
startTime: module.getNoteById(2).getVariable('startTime')
  .add(module.getNoteById(2).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

### Mixed Rhythms

```javascript
// Half note (2 beats)
duration: new Fraction(2).mul(new Fraction(60).div(module.findTempo(module.baseNote)))

// Followed by two quarter notes (1 beat each)
// ...chain as above
```

## Changing Tempo Mid-Composition

You can set a different tempo for a note, and all notes that depend on it will inherit that tempo.

### Creating a Tempo Change

```javascript
// Note at new tempo section
tempo: new Fraction(140)  // New tempo: 140 BPM
startTime: module.findMeasureLength(module.baseNote).mul(new Fraction(4))  // Starts at measure 5
duration: new Fraction(60).div(new Fraction(140))  // Uses its own tempo
```

### Notes Inheriting New Tempo

When notes reference a note with a custom tempo:

```javascript
// This note inherits tempo from Note 5 (which has tempo = 140)
duration: new Fraction(60).div(module.findTempo(module.getNoteById(5)))
```

## Time Signatures

### 4/4 Time (Default)

- 4 beats per measure
- Quarter note gets the beat

```javascript
beatsPerMeasure: new Fraction(4)
```

### 3/4 Time (Waltz)

- 3 beats per measure
- Quarter note gets the beat

```javascript
beatsPerMeasure: new Fraction(3)
```

### 6/8 Time

- 6 beats per measure (compound duple)
- Eighth note gets the beat

```javascript
beatsPerMeasure: new Fraction(6)
// Adjust duration calculations for eighth note = 1 beat
```

## Practical Example: Tempo Hierarchy

Build a composition with verse and chorus at different tempos:

```javascript
// BaseNote: tempo = 100 BPM, beatsPerMeasure = 4

// Verse root note (inherits BaseNote tempo)
// ID: 1
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// More verse notes depend on Note 1...

// Chorus root note (new tempo)
// ID: 10
frequency: module.baseNote.getVariable('frequency')
tempo: new Fraction(120)  // Faster chorus!
startTime: module.findMeasureLength(module.baseNote).mul(new Fraction(8))  // After 8 measures of verse
duration: new Fraction(60).div(new Fraction(120))

// Chorus notes depend on Note 10 and use its tempo
startTime: module.getNoteById(10).getVariable('startTime')
  .add(module.getNoteById(10).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.getNoteById(10)))  // Uses 120 BPM
```

## Quick Reference: Note Durations

At 60 BPM (1 beat = 1 second):

| Note Type | Beats | Duration Expression |
|-----------|-------|---------------------|
| Whole | 4 | `new Fraction(4).mul(...)` |
| Half | 2 | `new Fraction(2).mul(...)` |
| Quarter | 1 | `new Fraction(60).div(tempo)` |
| Eighth | 1/2 | `new Fraction(1, 2).mul(...)` |
| Sixteenth | 1/4 | `new Fraction(1, 4).mul(...)` |
| Triplet eighth | 1/3 | `new Fraction(1, 3).mul(...)` |
| Dotted quarter | 1.5 | `new Fraction(3, 2).mul(...)` |

## Tips for Rhythmic Composition

### 1. Start with Tempo in BaseNote

Set your base tempo early - changing it later will cascade through all dependent notes.

### 2. Create a Beat Reference

Consider creating a dedicated "beat reference" note that other notes can depend on for consistent timing.

### 3. Use Measure Calculations

For complex pieces, position notes by measure and beat rather than absolute time:

```javascript
// Measure 3, Beat 2
startTime: module.findMeasureLength(module.baseNote).mul(new Fraction(2))  // Measures 1-2
  .add(new Fraction(1).mul(new Fraction(60).div(module.findTempo(module.baseNote))))  // + 1 beat
```

## Next Steps

- [Microtonal Composition](/tutorials/advanced/microtonal) - Explore non-standard tunings
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) - Advanced note relationships
- [Module Library Creation](/tutorials/workflows/module-library) - Build reusable modules

