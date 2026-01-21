# Chaining Notes with Dependencies

Learn how to create musical relationships between notes using expressions that reference other notes.

## Understanding Dependencies

In RMT Compose, notes can reference other notes' properties. When you write an expression like:

```
[1].f
```

You create a **dependency** - Note 2 depends on Note 1's frequency. When Note 1 changes, Note 2 automatically updates.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency')
```

</details>

## Why Use Dependencies?

### Traditional Approach (Absolute Values)

```
Note 1: frequency = 440 Hz
Note 2: frequency = 660 Hz  (manually calculated 440 × 3/2)
Note 3: frequency = 880 Hz  (manually calculated 440 × 2)
```

**Problem**: If you want to transpose everything up, you must edit every note.

### RMT Approach (Relative Values)

```
Note 1: frequency = 440 Hz
Note 2: frequency = Note1.frequency × 3/2
Note 3: frequency = Note1.frequency × 2
```

**Benefit**: Change Note 1 to 330 Hz, and Notes 2 and 3 update automatically to 495 Hz and 660 Hz.

## Creating Your First Dependency Chain

### Step 1: Create the Root Note

1. Double-click the workspace to create a note
2. In the frequency field, enter:
   ```
   base.f
   ```
3. Set startTime: `0`
4. Set duration: `1`

This note inherits from BaseNote (440 Hz by default).

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)
```

</details>

### Step 2: Create a Dependent Note

1. Create a second note
2. For frequency, reference Note 1 (assuming ID is 1):
   ```
   [1].f * (3/2)
   ```
3. For startTime, chain to Note 1's end:
   ```
   [1].t + [1].d
   ```
4. Duration: `1`

Now Note 2 plays a perfect fifth above Note 1, starting right after it ends.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
startTime: module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(1)
```

</details>

### Step 3: Extend the Chain

Create Note 3 that depends on Note 2:

```
// Frequency: Perfect fourth above Note 2
[2].f * (4/3)

// StartTime: After Note 2
[2].t + [2].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Frequency: Perfect fourth above Note 2
module.getNoteById(2).getVariable('frequency').mul(new Fraction(4, 3))

// StartTime: After Note 2
module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))
```

</details>

## Viewing Dependencies

### Visual Feedback

1. Select a note by clicking on it
2. **Blue lines** show notes this note depends on (parents)
3. **Red lines** show notes that depend on this note (children)

### Understanding the Flow

```
BaseNote (440 Hz)
    ↓ (blue line)
Note 1 (440 Hz) - inherits from BaseNote
    ↓ (blue line)
Note 2 (660 Hz) - depends on Note 1
    ↓ (blue line)
Note 3 (880 Hz) - depends on Note 2
```

## Practical Example: Ascending Scale

Build a major scale where each note depends on the previous:

```
// Note 1 (Root)
frequency: base.f
startTime: 0
duration: 1

// Note 2 (Major Second - 9:8 ratio)
frequency: [1].f * (9/8)
startTime: [1].t + [1].d

// Note 3 (Major Third - 5:4 ratio from root, or 10:9 from Note 2)
frequency: [1].f * (5/4)
startTime: [2].t + [2].d

// Continue the pattern...
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1 (Root)
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)

// Note 2 (Major Second - 9:8 ratio)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(9, 8))
startTime: module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))

// Note 3 (Major Third - 5:4 ratio from root, or 10:9 from Note 2)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))

// Continue the pattern...
```

</details>

## Timing Dependencies

### Sequential Notes

Each note starts when the previous ends:

```
[PREV_ID].t + [PREV_ID].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(PREV_ID).getVariable('startTime')
  .add(module.getNoteById(PREV_ID).getVariable('duration'))
```

</details>

### Simultaneous Notes (Chords)

Multiple notes share the same start time:

```
// All chord notes reference the same start time
[ROOT_ID].t
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(ROOT_ID).getVariable('startTime')
```

</details>

### Offset Timing

Add a delay from a reference:

```
[1].t + (1/2)  // Half-second offset
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('startTime')
  .add(new Fraction(1, 2))
```

</details>

## Complex Dependencies

### Multi-Property Dependencies

A note can depend on different notes for different properties:

```
// Frequency from Note 1
frequency: [1].f * (5/4)

// Timing from Note 3
startTime: [3].t
duration: [3].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Frequency from Note 1
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Timing from Note 3
startTime: module.getNoteById(3).getVariable('startTime')
duration: module.getNoteById(3).getVariable('duration')
```

</details>

### Inherited Duration

Make all notes share a duration:

```
// All notes reference BaseNote's duration
duration: base.d
```

Now changing BaseNote's duration affects all notes.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
duration: module.baseNote.getVariable('duration')
```

</details>

## Avoiding Circular Dependencies

RMT Compose prevents circular references:

```
Note 1 → depends on → Note 2
Note 2 → depends on → Note 1  // ERROR!
```

If you try to create a circular dependency, you'll see an error message.

### How to Fix Circular Dependencies

1. Identify the loop in your dependency chain
2. Break the cycle by referencing a common ancestor
3. Use BaseNote as the ultimate root for shared properties

## Best Practices

### 1. Plan Your Hierarchy

Sketch out your dependency structure before building:

```
BaseNote (tempo, base frequency)
├── Melody Root
│   ├── Melody Note 2
│   └── Melody Note 3
└── Bass Root
    ├── Bass Note 2
    └── Bass Note 3
```

### 2. Use Meaningful Chains

- **Frequency chains**: Keep related pitches connected
- **Timing chains**: Sequential notes should link their timing
- **Duration chains**: Notes that share duration should reference a common source

### 3. Test by Changing Root Values

After building your dependencies:
1. Select the root note
2. Change its frequency or timing
3. Verify all dependent notes update correctly

## Troubleshooting

### Note Not Updating

- Check that the dependency expression is correct
- Verify the referenced note ID exists
- Look for typos in `getVariable()` property names

### Unexpected Values

- Click the note to see both Raw and Evaluated values
- Trace the dependency chain to find where values diverge
- Check for conflicting dependencies

## Next Steps

- [Working with Octaves](./octaves) - Octave manipulation techniques
- [Measure-Based Timing](./measures) - Tempo and beat dependencies
- [Expression Syntax Reference](/reference/expressions/syntax) - Full expression guide

