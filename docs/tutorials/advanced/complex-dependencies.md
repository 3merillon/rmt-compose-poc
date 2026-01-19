# Complex Dependencies

Master advanced dependency patterns for sophisticated compositions with intricate note relationships.

## Beyond Simple Chains

Basic dependencies link one note to another. Complex dependencies involve:
- Multiple inheritance paths
- Property-specific dependencies
- Conditional relationships
- Hierarchical structures

## Multi-Property Dependencies

A single note can depend on different notes for different properties:

```javascript
// Note 3 depends on Note 1 for frequency, Note 2 for timing
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(2).getVariable('startTime')
duration: module.getNoteById(2).getVariable('duration')
```

### Use Case: Harmony Following Melody

```javascript
// Melody note (Note 1)
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
startTime: new Fraction(0)
duration: new Fraction(1)

// Harmony note - follows melody timing but uses different pitch
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(1).getVariable('startTime')  // Same timing
duration: module.getNoteById(1).getVariable('duration')

// Bass note - same timing as melody, octave below
frequency: module.getNoteById(1).getVariable('frequency').div(new Fraction(2))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')
```

## Branching Dependencies

Create tree structures where one note feeds multiple branches:

```
        Root (Note 1)
       /     |      \
   Note 2  Note 3  Note 4
    |        |        |
 Note 5   Note 6   Note 7
```

### Implementation

```javascript
// Root (Note 1)
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(4)

// Branch A: Perfect fifth up
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
startTime: module.getNoteById(1).getVariable('startTime')
duration: new Fraction(2)

// Branch B: Major third up
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(1).getVariable('startTime').add(new Fraction(2))
duration: new Fraction(2)

// Branch C: Octave up
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(2))
startTime: module.getNoteById(1).getVariable('startTime')
duration: new Fraction(4)
```

## Diamond Dependencies

A note can depend on multiple notes that share a common ancestor:

```
      BaseNote
       /    \
   Note 1  Note 2
       \    /
       Note 3
```

### Implementation

```javascript
// Note 1: Fifth up from base
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
startTime: new Fraction(0)
duration: new Fraction(2)

// Note 2: Third up from base
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
startTime: new Fraction(2)
duration: new Fraction(2)

// Note 3: Combines Note 1's timing with Note 2's pitch relationship
frequency: module.getNoteById(2).getVariable('frequency').mul(new Fraction(3, 2))
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(2)
```

## Cascading Property Changes

When you change a property at the top of a hierarchy, all dependent notes update:

```javascript
// If BaseNote.frequency changes from 440 to 330:

// Note 1 (depends on BaseNote): 330 × 3/2 = 495 Hz
// Note 2 (depends on Note 1): 495 × 5/4 = 618.75 Hz
// Note 3 (depends on Note 2): 618.75 × 6/5 = 742.5 Hz
// ... entire chain updates
```

### Visualizing the Cascade

1. Select the root note
2. Red lines show all dependents
3. Edit the root's frequency
4. Watch all connected notes update instantly

## Tempo Hierarchies

Create sections with different tempos by establishing tempo-defining notes:

```javascript
// BaseNote: tempo = 100 BPM (global default)

// Section A root (Note 10)
tempo: new Fraction(120)  // Section A at 120 BPM
startTime: new Fraction(0)
duration: new Fraction(60).div(new Fraction(120))  // Uses own tempo

// Section A notes depend on Note 10 for tempo
startTime: module.getNoteById(10).getVariable('startTime')
  .add(module.getNoteById(10).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.getNoteById(10)))

// Section B root (Note 20)
tempo: new Fraction(80)  // Section B at 80 BPM
startTime: module.findMeasureLength(module.getNoteById(10)).mul(new Fraction(8))  // After 8 measures of Section A
duration: new Fraction(60).div(new Fraction(80))

// Section B notes depend on Note 20 for tempo
duration: new Fraction(60).div(module.findTempo(module.getNoteById(20)))
```

## Relative Timing Patterns

### Call and Response

```javascript
// Call (Note 1)
startTime: new Fraction(0)
duration: new Fraction(2)

// Response (Note 2) - starts after call with a gap
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
  .add(new Fraction(1, 2))  // Half-second gap
duration: module.getNoteById(1).getVariable('duration')  // Same duration as call
```

### Echo Effect

```javascript
// Original note
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)

// Echo 1 (quieter, delayed)
frequency: module.getNoteById(1).getVariable('frequency')
startTime: module.getNoteById(1).getVariable('startTime').add(new Fraction(1, 4))
duration: module.getNoteById(1).getVariable('duration')
// Note: Volume would be handled by instrument/gain, not shown here

// Echo 2 (even more delayed)
frequency: module.getNoteById(1).getVariable('frequency')
startTime: module.getNoteById(1).getVariable('startTime').add(new Fraction(1, 2))
duration: module.getNoteById(1).getVariable('duration')
```

## Parallel Voice Leading

Create multiple voices that move together:

```javascript
// Soprano (Note 1)
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(2))  // 880 Hz
startTime: new Fraction(0)
duration: new Fraction(1)

// Alto - always a third below soprano
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(4, 5))  // Down major third
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// Tenor - always a fifth below soprano
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(2, 3))  // Down perfect fifth
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// Bass - always an octave below soprano
frequency: module.getNoteById(1).getVariable('frequency').div(new Fraction(2))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// When soprano changes, all voices update maintaining their intervals
```

## Sequential Pattern Generation

### Rhythmic Sequence

```javascript
// Beat 1
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Each subsequent beat references previous
startTime: module.getNoteById(PREV).getVariable('startTime')
  .add(module.getNoteById(PREV).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

### Melodic Sequence (Stepwise)

```javascript
// Start note
frequency: module.baseNote.getVariable('frequency')

// Each subsequent note is a step higher
frequency: module.getNoteById(PREV).getVariable('frequency')
  .mul(new Fraction(9, 8))  // Major second up
```

## Dependency Graph Analysis

### Viewing Dependencies

Click on any note to see:
- **Blue lines**: Notes this note depends on
- **Red lines**: Notes that depend on this note

### Understanding Propagation

When Note 1 changes:
1. All notes with blue lines to Note 1 are marked dirty
2. Evaluation propagates through the dependency tree
3. Only affected notes are recalculated (efficient!)

### Cycle Prevention

RMT Compose automatically prevents circular dependencies:

```javascript
// This would be rejected:
Note 1: depends on Note 2
Note 2: depends on Note 1  // ERROR: Circular dependency
```

## Performance Considerations

### Deep Dependency Chains

Very deep chains (Note 1 → Note 2 → ... → Note 100) work but may have evaluation latency.

**Tip**: Consider flattening structures where possible:

```javascript
// Instead of: Note 10 → Note 9 → ... → Note 1 → BaseNote
// Consider:   All notes → BaseNote (flat)
```

### Wide Dependency Trees

Many notes depending on one note is efficient due to the inverted index lookup.

```javascript
// This is fine:
100 notes all depending on BaseNote.frequency
```

## Debugging Complex Dependencies

### Trace the Chain

1. Select the final note in your chain
2. Follow blue lines back to the source
3. Check each intermediate value

### Verify Evaluation

1. Change a root value
2. Check that intermediate notes updated
3. Verify final values are correct

### Common Issues

- **Wrong note ID**: Double-check `getNoteById(N)` numbers
- **Property typo**: Ensure `getVariable('frequency')` spelling
- **Missing dependency**: Check that the referenced note exists

## Best Practices

### 1. Document Your Structure

Keep a mental (or written) map of your dependency hierarchy.

### 2. Test Incrementally

Build complex structures step-by-step, testing each addition.

### 3. Use Meaningful IDs

When planning, assign note IDs purposefully:
- 1-10: Melody
- 11-20: Harmony
- 21-30: Bass
- etc.

### 4. Avoid Unnecessary Depth

Direct dependencies on common ancestors are more efficient than long chains.

## Next Steps

- [Module Library Creation](/tutorials/workflows/module-library) - Save and reuse patterns
- [Interval Exploration](/tutorials/workflows/intervals) - Experiment with different intervals
- [Dependency Graph Architecture](/developer/core/dependency-graph) - Technical details

