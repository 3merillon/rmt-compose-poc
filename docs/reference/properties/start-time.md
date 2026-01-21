# startTime

The `startTime` property defines when a note begins playing, measured in seconds from the start of the composition.

## Default Value

```
0  // Starts at the beginning
```

## Expression Examples

### Fixed Time

```
0       // Start immediately
1       // Start at 1 second
(5/2)   // Start at 2.5 seconds
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(0)     // Start immediately
new Fraction(1)     // Start at 1 second
new Fraction(5, 2)  // Start at 2.5 seconds
```
</details>

### Relative to BaseNote

```
// Same start as BaseNote
base.t

// One second after BaseNote
base.t + 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Same start as BaseNote
module.baseNote.getVariable('startTime')

// One second after BaseNote
module.baseNote.getVariable('startTime').add(new Fraction(1))
```
</details>

### Sequential Notes

The most common pattern chains notes sequentially:

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

### Beat-Relative Timing

```
// Start at beat 2 (tempo-aware)
60 / tempo(base) * 2

// Start at measure 2
measure(base) * 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start at beat 2 (tempo-aware)
new Fraction(60).div(module.findTempo(module.baseNote))
  .mul(new Fraction(2))

// Start at measure 2
module.findMeasureLength(module.baseNote)
  .mul(new Fraction(2))
```
</details>

### Offset from Another Note

```
// Start 0.5 seconds after Note 3 starts
[3].t + (1/2)

// Start 1 beat after Note 3 starts
[3].t + 60 / tempo(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start 0.5 seconds after Note 3 starts
module.getNoteById(3).getVariable('startTime')
  .add(new Fraction(1, 2))

// Start 1 beat after Note 3 starts
module.getNoteById(3).getVariable('startTime')
  .add(new Fraction(60).div(module.findTempo(module.baseNote)))
```
</details>

### Simultaneous Notes (Chords)

```
// Same start time as Note 1 (plays together)
[1].t
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Same start time as Note 1 (plays together)
module.getNoteById(1).getVariable('startTime')
```
</details>

## Common Patterns

### Building a Melody

```
// Note 1: starts at 0
0

// Note 2: starts when Note 1 ends
[1].t + [1].d

// Note 3: starts when Note 2 ends
[2].t + [2].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

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
</details>

### Building a Chord

```
// All notes share the same start time
// Notes 2, 3, 4 reference Note 1:
[1].t
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// All notes share the same start time
// Notes 2, 3, 4 reference Note 1:
module.getNoteById(1).getVariable('startTime')
```
</details>

### Staggered Entry (Arpeggio)

```
// Each note starts 0.1 seconds after the previous
[prev].t + (1/10)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Each note starts 0.1 seconds after the previous
module.getNoteById(prev).getVariable('startTime')
  .add(new Fraction(1, 10))
```
</details>

## Visualization

- **Horizontal position** on the workspace represents time
- Notes further right start later
- The X-axis scales as: `seconds * 200 * xScaleFactor`
- The **playhead** (vertical line) shows current playback position

## Dependencies

When startTime references another note, both notes are linked:

```
// Changing Note 1's timing affects Note 2
[1].t + [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Changing Note 1's timing affects Note 2
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
```
</details>

This creates dependencies on both `startTime` and `duration` of Note 1.

## See Also

- [duration](/reference/properties/duration) - Note length
- [tempo](/reference/properties/tempo) - Speed in BPM
- [Creating Notes](/user-guide/notes/creating-notes) - Adding notes
- [Dependencies](/user-guide/notes/dependencies) - Linking notes
