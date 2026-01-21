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

```
// Note 3 depends on Note 1 for frequency, Note 2 for timing
frequency: [1].f * (5/4)
startTime: [2].t
duration: [2].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(2).getVariable('startTime')
duration: module.getNoteById(2).getVariable('duration')
```

</details>

### Use Case: Harmony Following Melody

```
// Melody note (Note 1)
frequency: base.f * (3/2)
startTime: 0
duration: 1

// Harmony note - follows melody timing but uses different pitch
frequency: [1].f * (5/4)
startTime: [1].t  // Same timing
duration: [1].d

// Bass note - same timing as melody, octave below
frequency: [1].f / 2
startTime: [1].t
duration: [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

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

```
// Root (Note 1)
frequency: base.f
startTime: 0
duration: 4

// Branch A: Perfect fifth up
frequency: [1].f * (3/2)
startTime: [1].t
duration: 2

// Branch B: Major third up
frequency: [1].f * (5/4)
startTime: [1].t + 2
duration: 2

// Branch C: Octave up
frequency: [1].f * 2
startTime: [1].t
duration: 4
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

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

```
// Note 1: Fifth up from base
frequency: base.f * (3/2)
startTime: 0
duration: 2

// Note 2: Third up from base
frequency: base.f * (5/4)
startTime: 2
duration: 2

// Note 3: Combines Note 1's timing with Note 2's pitch relationship
frequency: [2].f * (3/2)
startTime: [1].t + [1].d
duration: 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

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
2. Dependency lines show all relationships:
   - **Orange lines**: frequency dependents
   - **Teal lines**: startTime dependents
   - **Purple lines**: duration dependents
   - **Thick lines**: parents (what this note depends on)
   - **Thin lines**: children (what depends on this note)
3. Edit the root's frequency
4. Watch all connected notes update on save

## Tempo Hierarchies

Create sections with different tempos by establishing tempo-defining notes:

```
// BaseNote: tempo = 100 BPM (global default)

// Section A root (Note 10)
tempo: 120  // Section A at 120 BPM
startTime: 0
duration: beat([10])  // Uses own tempo

// Section A notes depend on Note 10 for tempo
startTime: [10].t + [10].d
duration: beat([10])

// Section B root (Note 20)
tempo: 80  // Section B at 80 BPM
startTime: measure([10]) * 8  // After 8 measures of Section A
duration: beat([20])

// Section B notes depend on Note 20 for tempo
duration: beat([20])
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

## Relative Timing Patterns

### Call and Response

```
// Call (Note 1)
startTime: 0
duration: 2

// Response (Note 2) - starts after call with a gap
startTime: [1].t + [1].d + (1/2)  // Half-second gap
duration: [1].d  // Same duration as call
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

### Echo Effect

```
// Original note
frequency: base.f
startTime: 0
duration: 1

// Echo 1 (delayed)
frequency: [1].f
startTime: [1].t + (1/4)
duration: [1].d
// Note: Per-note volume isn't implemented yet

// Echo 2 (even more delayed)
frequency: [1].f
startTime: [1].t + (1/2)
duration: [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Original note
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)

// Echo 1 (delayed)
frequency: module.getNoteById(1).getVariable('frequency')
startTime: module.getNoteById(1).getVariable('startTime').add(new Fraction(1, 4))
duration: module.getNoteById(1).getVariable('duration')
// Note: Per-note volume isn't implemented yet

// Echo 2 (even more delayed)
frequency: module.getNoteById(1).getVariable('frequency')
startTime: module.getNoteById(1).getVariable('startTime').add(new Fraction(1, 2))
duration: module.getNoteById(1).getVariable('duration')
```

</details>

## Parallel Voice Leading

Create multiple voices that move together.

> **Tip**: When building chords from saved modules, use the Module Bar's **"Drop at: Start"** mode to stack notes at the same start time.



```
// Soprano (Note 1)
frequency: base.f * 2  // 880 Hz
startTime: 0
duration: 1

// Alto - always a third below soprano
frequency: [1].f * (4/5)  // Down major third
startTime: [1].t
duration: [1].d

// Tenor - always a fifth below soprano
frequency: [1].f * (2/3)  // Down perfect fifth
startTime: [1].t
duration: [1].d

// Bass - always an octave below soprano
frequency: [1].f / 2
startTime: [1].t
duration: [1].d

// When soprano changes, all voices update maintaining their intervals
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

## Sequential Pattern Generation

> **Tip**: When building scales or sequences from saved modules, use the Module Bar's **"Drop at: End"** mode to chain notes one after another.

### Rhythmic Sequence

```
// Beat 1
startTime: 0
duration: beat(base)

// Each subsequent beat references previous
startTime: [PREV].t + [PREV].d
duration: beat(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Beat 1
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Each subsequent beat references previous
startTime: module.getNoteById(PREV).getVariable('startTime')
  .add(module.getNoteById(PREV).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

</details>

### Melodic Sequence (Stepwise)

```
// Start note
frequency: base.f

// Each subsequent note is a step higher
frequency: [PREV].f * (9/8)  // Major second up
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start note
frequency: module.baseNote.getVariable('frequency')

// Each subsequent note is a step higher
frequency: module.getNoteById(PREV).getVariable('frequency')
  .mul(new Fraction(9, 8))  // Major second up
```

</details>

## Dependency Graph Analysis

### Viewing Dependencies

Click on any note to see dependency lines:
- **Orange lines**: frequency relationships
- **Teal lines**: startTime relationships
- **Purple lines**: duration relationships
- **Thick lines**: Parents (notes this note depends on)
- **Thin lines**: Children (notes that depend on this note)

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

