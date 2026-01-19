# Creating Modules

Learn how to build modules from scratch for your personal library or sharing.

## Starting Fresh

### Reset the Workspace

1. Click **Menu** (☰)
2. Select **Load Module > Reset to Default Module**
3. Or load a simple interval module as a starting point

### The BaseNote

Every module starts with the **BaseNote** (orange circle):

1. Click the BaseNote to select it
2. Set the properties in the Variable Widget:
   - **frequency**: Reference pitch (e.g., 440 for A4)
   - **tempo**: Beats per minute
   - **beatsPerMeasure**: Time signature numerator

## Building Your Composition

### Adding Notes

1. Select an existing note
2. In the Variable Widget, find **"Add Note"**
3. Choose:
   - **Add at Start+Duration**: Sequential notes
   - **Add at Same Time**: Chords

### Setting Frequencies

For each note, set its frequency expression:

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

### Setting Timing

For sequential notes:

```javascript
// Start after previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```

For chords (simultaneous notes):

```javascript
// Same start time as root
module.getNoteById(root).getVariable('startTime')
```

### Setting Duration

```javascript
// Beat-relative duration
new Fraction(60).div(module.findTempo(module.baseNote))  // 1 beat

// Fixed duration
new Fraction(0.5)  // 0.5 seconds

// Same as another note
module.getNoteById(1).getVariable('duration')
```

## Module Design Patterns

### Interval Module

A simple two-note interval:

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency')",
      "startTime": "new Fraction(0)",
      "duration": "new Fraction(1)"
    },
    {
      "id": 2,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
      "startTime": "new Fraction(0)",
      "duration": "new Fraction(1)"
    }
  ]
}
```

### Chord Module

Notes with the same start time:

```json
{
  "notes": [
    { "id": 1, "frequency": "baseNote × 1", "startTime": "0" },
    { "id": 2, "frequency": "baseNote × 5/4", "startTime": "0" },
    { "id": 3, "frequency": "baseNote × 3/2", "startTime": "0" }
  ]
}
```

### Scale Module

Each note references the previous:

```json
{
  "notes": [
    { "id": 1, "frequency": "baseNote", "startTime": "0" },
    { "id": 2, "frequency": "note1 × step", "startTime": "note1.end" },
    { "id": 3, "frequency": "note2 × step", "startTime": "note2.end" }
  ]
}
```

### Melody Module

Custom frequencies and timings:

```json
{
  "notes": [
    { "id": 1, "frequency": "baseNote × 1", "startTime": "0", "duration": "1 beat" },
    { "id": 2, "frequency": "baseNote × 9/8", "startTime": "note1.end", "duration": "0.5 beat" },
    { "id": 3, "frequency": "baseNote × 5/4", "startTime": "note2.end", "duration": "1.5 beats" }
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

## Advanced Techniques

### Parameterized Modules

Create modules where changing one value affects everything:

```javascript
// All notes relative to a "root" note
root.frequency = baseNote.frequency.mul(new Fraction(someInterval))
third.frequency = root.frequency.mul(new Fraction(5, 4))
fifth.frequency = root.frequency.mul(new Fraction(3, 2))
// Change root's interval, and the whole chord moves!
```

### Template Modules

Create skeleton modules for common patterns:

- **4-bar phrase template**
- **Chord progression template**
- **Scale template**

Load these as starting points for new compositions.

### Hybrid Tuning

Mix just intonation and TET:

```javascript
// Just fifth
note2.frequency = baseNote.frequency.mul(new Fraction(3, 2))

// TET third above that
note3.frequency = note2.frequency.mul(new Fraction(2).pow(new Fraction(4, 12)))
```

## Tips

1. **Plan before building** - Sketch your structure first
2. **Start simple** - Add complexity incrementally
3. **Use dependencies** - They make modules flexible
4. **Test frequently** - Catch errors early
5. **Document your work** - Add comments for complex modules
6. **Save versions** - Keep backups as you iterate
