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

1. Click the **BaseNote** (orange circle) to select it
2. In the Variable Widget, find **"Add Note / Silence"** section
3. Select **"Note"**, then click **"Create Note"**
4. Select the new note and set:
   - Frequency: `base.f`
   - StartTime: `base.t`
   - Duration: `beat(base)`
5. Click **Save**

This note inherits from BaseNote (440 Hz by default).

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency: module.baseNote.getVariable('frequency')
startTime: module.baseNote.getVariable('startTime')
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

</details>

### Step 2: Create a Dependent Note

1. Select Note 1
2. In **"Add Note / Silence"**, keep **"Note"** and **"At End"** selected, click **"Create Note"**
3. Select the new note and set:
   - Frequency (perfect fifth): `[1].f * (3/2)`
   - StartTime (chains automatically with "At End"): `[1].t + [1].d`
   - Duration: `beat(base)`
4. Click **Save**

Now Note 2 plays a perfect fifth above Note 1, starting right after it ends.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
startTime: module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
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
2. Dependency lines are colored by property type:
   - **Orange lines**: frequency dependencies
   - **Teal lines**: startTime dependencies
   - **Purple lines**: duration dependencies
3. Line thickness indicates direction:
   - **Thick lines**: parent dependencies (what the selected note depends on)
   - **Thin lines**: child dependencies (what depends on the selected note)

### Understanding the Flow

```
BaseNote (440 Hz)
    ↓ (orange line - frequency dependency)
Note 1 (440 Hz) - inherits from BaseNote
    ↓ (orange + teal lines - frequency and timing)
Note 2 (660 Hz) - depends on Note 1
    ↓ (orange + teal lines)
Note 3 (880 Hz) - depends on Note 2
```

## Practical Example: Ascending Scale

Build a major scale where each note depends on the previous:

```
// Note 1 (Root)
frequency: base.f
startTime: base.t
duration: beat(base)

// Note 2 (Major Second - 9:8 ratio)
frequency: [1].f * (9/8)
startTime: [1].t + [1].d
duration: beat(base)

// Note 3 (Major Third - 5:4 ratio from root, or 10:9 from Note 2)
frequency: [1].f * (5/4)
startTime: [2].t + [2].d
duration: beat(base)

// Continue the pattern...
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1 (Root)
frequency: module.baseNote.getVariable('frequency')
startTime: module.baseNote.getVariable('startTime')
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Note 2 (Major Second - 9:8 ratio)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(9, 8))
startTime: module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Note 3 (Major Third - 5:4 ratio from root, or 10:9 from Note 2)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

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

### Shared Duration

You can make multiple notes share the same duration by referencing a common note. This is useful for chord tones or any group of notes that should have identical lengths:

```
// Note 1: The "duration master" - set this note's duration
duration: beat(base) * 2

// Notes 2, 3, 4: All reference Note 1's duration
duration: [1].d
```

Now changing Note 1's duration updates all notes that reference it. This creates a single control point for duration across multiple notes.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: The "duration master"
duration: new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Notes 2, 3, 4: All reference Note 1's duration
duration: module.getNoteById(1).getVariable('duration')
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
- Look for typos in property shortcuts (use `f`, `t`, `d` for frequency, startTime, duration)

### Unexpected Values

- Click the note to see both Raw and Evaluated values in the Variable Widget
- Trace the dependency chain to find where values diverge
- Check for conflicting dependencies

## Next Steps

- [Working with Octaves](./octaves) - Octave manipulation techniques
- [Measure-Based Timing](./measures) - Tempo and beat dependencies
- [Expression Syntax Reference](/reference/expressions/syntax) - Full expression guide

