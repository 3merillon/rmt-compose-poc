# startTime

The `startTime` property defines when a note begins playing, measured in seconds from the start of the composition.

## Default Value

```javascript
new Fraction(0)  // Starts at the beginning
```

## Expression Examples

### Fixed Time

```javascript
new Fraction(0)     // Start immediately
new Fraction(1)     // Start at 1 second
new Fraction(5, 2)  // Start at 2.5 seconds
```

### Relative to BaseNote

```javascript
// Same start as BaseNote
module.baseNote.getVariable('startTime')

// One second after BaseNote
module.baseNote.getVariable('startTime').add(new Fraction(1))
```

### Sequential Notes

The most common pattern chains notes sequentially:

```javascript
// Start when previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```

### Beat-Relative Timing

```javascript
// Start at beat 2 (tempo-aware)
new Fraction(60).div(module.findTempo(module.baseNote))
  .mul(new Fraction(2))

// Start at measure 2
module.findMeasureLength(module.baseNote)
  .mul(new Fraction(2))
```

### Offset from Another Note

```javascript
// Start 0.5 seconds after Note 3 starts
module.getNoteById(3).getVariable('startTime')
  .add(new Fraction(1, 2))

// Start 1 beat after Note 3 starts
module.getNoteById(3).getVariable('startTime')
  .add(new Fraction(60).div(module.findTempo(module.baseNote)))
```

### Simultaneous Notes (Chords)

```javascript
// Same start time as Note 1 (plays together)
module.getNoteById(1).getVariable('startTime')
```

## Common Patterns

### Building a Melody

```javascript
// Note 1: starts at 0
new Fraction(0)

// Note 2: starts when Note 1 ends
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))

// Note 3: starts when Note 2 ends
module.getNoteById(2).getVariable('startTime')
  .add(module.getNoteById(2).getVariable('duration'))
```

### Building a Chord

```javascript
// All notes share the same start time
// Notes 2, 3, 4 reference Note 1:
module.getNoteById(1).getVariable('startTime')
```

### Staggered Entry (Arpeggio)

```javascript
// Each note starts 0.1 seconds after the previous
module.getNoteById(prev).getVariable('startTime')
  .add(new Fraction(1, 10))
```

## Visualization

- **Horizontal position** on the workspace represents time
- Notes further right start later
- The X-axis scales as: `seconds * 200 * xScaleFactor`
- The **playhead** (vertical line) shows current playback position

## Dependencies

When startTime references another note, both notes are linked:

```javascript
// Changing Note 1's timing affects Note 2
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
```

This creates dependencies on both `startTime` and `duration` of Note 1.

## See Also

- [duration](/reference/properties/duration) - Note length
- [tempo](/reference/properties/tempo) - Speed in BPM
- [Creating Notes](/user-guide/notes/creating-notes) - Adding notes
- [Dependencies](/user-guide/notes/dependencies) - Linking notes
