# Creating Modules

Learn how to build modules from scratch for your personal library or sharing.

## Starting Fresh

### Clean the Workspace

1. Select the **BaseNote** (orange circle)
2. In the Variable Widget, click **Clean Slate**
3. This removes all notes except the BaseNote

### The BaseNote

Every module starts with the **BaseNote** (orange circle):

1. Click the BaseNote to select it
2. Set the properties in the Variable Widget:
   - **frequency**: Reference pitch (e.g., 440 for A4)
   - **tempo**: Beats per minute
   - **beatsPerMeasure**: Time signature numerator

## Building Your Composition

### Adding Notes

1. Select a note (including the BaseNote for an empty workspace)
2. In the Variable Widget, find **"Add Note / Silence"**
3. Choose:
   - **At End**: Sequential notes (placed after selected note)
   - **At Start**: Chords (same start time as selected note)

### Setting Frequencies

For each note, set its frequency expression:

```
# Just intonation intervals
base.f * (3/2)              # Perfect fifth
base.f * (5/4)              # Major third

# TET intervals
base.f * 2^(7/12)           # 12-TET fifth

# Relative to another note
[1].f * (5/4)               # Major third above Note 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Just intonation intervals
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))  // Fifth
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))  // Third

// TET intervals
module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(7, 12))  // 12-TET fifth
)

// Relative to another note
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
```
</details>

### Setting Timing

For sequential notes:

```
# Start after previous note ends
[1].t + [1].d               # Start when Note 1 ends
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start after previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```
</details>

For chords (simultaneous notes):

```
# Same start time as root
[1].t                       # Same start as Note 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Same start time as root
module.getNoteById(root).getVariable('startTime')
```
</details>

### Setting Duration

```
# Beat-relative duration
beat(base)                  # 1 beat (60/tempo)
beat(base) * 2              # 2 beats

# Fixed duration
(1/2)                       # 0.5 seconds

# Same as another note
[1].d                       # Same duration as Note 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Beat-relative duration
new Fraction(60).div(module.findTempo(module.baseNote))  // 1 beat

// Fixed duration
new Fraction(0.5)  // 0.5 seconds

// Same as another note
module.getNoteById(1).getVariable('duration')
```
</details>

## Module Design Patterns

### Interval Module

A simple two-note interval:

```json
{
  "baseNote": {
    "frequency": "440",
    "tempo": "120"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f",
      "startTime": "base.t",
      "duration": "beat(base)"
    },
    {
      "id": 2,
      "frequency": "base.f * (3/2)",
      "startTime": "base.t",
      "duration": "beat(base)"
    }
  ]
}
```

By referencing `base.t` and `beat(base)`, the module will adapt when dropped onto different notes in the workspace.

### Chord Module

Notes with the same start time (major triad):

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "base.f * (5/4)", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 3, "frequency": "base.f * (3/2)", "startTime": "base.t", "duration": "beat(base)" }
  ]
}
```

### Scale Module

Each note references the previous:

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "[1].f * (9/8)", "startTime": "[1].t + [1].d", "duration": "beat(base)" },
    { "id": 3, "frequency": "[2].f * (10/9)", "startTime": "[2].t + [2].d", "duration": "beat(base)" }
  ]
}
```

### Melody Module

Custom frequencies and timings:

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "base.f * (9/8)", "startTime": "[1].t + [1].d", "duration": "beat(base) * (1/2)" },
    { "id": 3, "frequency": "base.f * (5/4)", "startTime": "[2].t + [2].d", "duration": "beat(base) * (3/2)" }
  ]
}
```

## Testing Your Module

### Playback Test

1. Click **Play** to hear the module
2. Listen for:
   - Correct pitches
   - Correct timing
   - Smooth playback

### Visual Check

1. Look at the workspace
2. Verify:
   - Notes are positioned correctly
   - Dependency lines make sense
   - No unexpected overlaps

### Edit and Iterate

1. Select notes that need adjustment
2. Modify expressions
3. Test again

## Saving Your Module

When you're satisfied:

1. Click **Menu > Save Module**
2. Rename the file appropriately
3. Add to your Module Bar (optional)

## Designing for Module Bar Drops

When you drag a module from the Module Bar onto a note, the `base` references get remapped to that target note. How you structure your dependencies determines how the module behaves when dropped:

### All Notes Reference Base

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "base.f * (5/4)", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 3, "frequency": "base.f * (3/2)", "startTime": "base.t", "duration": "beat(base)" }
  ]
}
```

When dropped on Note 5, all notes inherit Note 5's frequency, timing, and tempo. Good for chords that should match the target note.

### Chain Dependencies

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f", "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "[1].f * (9/8)", "startTime": "[1].t + [1].d", "duration": "[1].d" },
    { "id": 3, "frequency": "[2].f * (9/8)", "startTime": "[2].t + [2].d", "duration": "[2].d" }
  ]
}
```

Only Note 1 references base; Notes 2-3 chain from previous notes. Good for sequences where you want consistent intervals regardless of the drop target.

### Mixed Dependencies

Design modules with the drop behavior you want—notes referencing `base` will adapt to the target, while notes referencing other notes maintain their internal relationships.

## Advanced Techniques

### Parameterized Modules

Create modules where changing one value affects everything:

```
# All notes relative to a "root" note
# Root (Note 1): base.f * (someInterval)
# Third (Note 2): [1].f * (5/4)
# Fifth (Note 3): [1].f * (3/2)
# Change root's interval, and the whole chord moves!
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// All notes relative to a "root" note
root.frequency = baseNote.frequency.mul(new Fraction(someInterval))
third.frequency = root.frequency.mul(new Fraction(5, 4))
fifth.frequency = root.frequency.mul(new Fraction(3, 2))
// Change root's interval, and the whole chord moves!
```
</details>

### Template Modules

Create skeleton modules for common patterns:

- **4-bar phrase template**
- **Chord progression template**
- **Scale template**

Load these as starting points for new compositions.

### Hybrid Tuning

Mix just intonation and TET:

```
# Just fifth
[2].f = base.f * (3/2)

# TET third above that
[3].f = [2].f * 2^(4/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Just fifth
note2.frequency = baseNote.frequency.mul(new Fraction(3, 2))

// TET third above that
note3.frequency = note2.frequency.mul(new Fraction(2).pow(new Fraction(4, 12)))
```
</details>

## Tips

1. **Plan before building** - Sketch your structure first
2. **Start simple** - Add complexity incrementally
3. **Use `base.t` not `0`** - Reference BaseNote timing so modules adapt when dropped
4. **Use `beat(base)` for duration** - Keeps timing relative to tempo
5. **Design your dependency tree** - It determines how the module behaves when dropped from the Module Bar
6. **Test frequently** - Catch errors early
7. **Save versions** - Keep backups as you iterate
