# Creating Notes

Learn how to add new notes to your composition.

## Methods of Creating Notes

### Method 1: From the Variable Widget

1. **Select** an existing note in the workspace
2. Open the **Variable Widget**
3. Find the **"Add Note"** section
4. Choose an option:
   - **Add at Start+Duration**: New note starts when the selected note ends
   - **Add at Same Time**: New note starts at the same time (for building chords)

### Method 2: Load a Module

1. Open the **Module Bar**
2. **Drag** a module onto the workspace
3. The module's notes are loaded

### Method 3: Edit Module JSON Directly

For advanced users, notes can be added by editing the module JSON:

```json
{
  "notes": [
    {
      "id": 1,
      "frequency": "base.f * (3/2)",
      "startTime": "base.t",
      "duration": "1",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```

<details>
<summary>Legacy JavaScript syntax (also supported)</summary>

```json
{
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(1)",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```
</details>

## Note Properties

Every note has these core properties:

| Property | Required | Description |
|----------|----------|-------------|
| `id` | Yes | Unique identifier (auto-assigned) |
| `frequency` | Yes | Pitch as a ratio or expression |
| `startTime` | Yes | When the note begins |
| `duration` | Yes | How long the note plays |
| `color` | No | Display color (default assigned) |
| `instrument` | No | Sound to use (default: sine-wave) |

## Default Values

When you add a note via the Variable Widget, it inherits sensible defaults:

### Add at Start+Duration

The new note inherits properties from the selected note:

```
frequency: [selected].f
startTime: [selected].t + [selected].d
duration: [selected].d
```

The new note:
- Starts immediately after the selected note
- Has the same frequency
- Has the same duration

### Add at Same Time

The new note inherits properties and gets a frequency 5/4 times the selected note (major third):

```
frequency: [selected].f * (5/4)
startTime: [selected].t
duration: [selected].d
```

The new note:
- Starts at the same time (for chords)
- Has frequency 5/4 times the selected note (major third)
- Has the same duration

## Building Sequences

To create a melody (notes playing one after another):

1. Create the first note
2. Select it and choose **"Add at Start+Duration"**
3. Edit the new note's frequency
4. Repeat for each note in the sequence

Each note's start time automatically references the previous note's end time.

## Building Chords

To create a chord (notes playing together):

1. Create the root note
2. Select it and choose **"Add at Same Time"**
3. Edit the new note's frequency (e.g., 5/4 for major third)
4. Select the root again and add another note
5. Edit its frequency (e.g., 3/2 for perfect fifth)

All notes share the same start time.

## Note ID Assignment

- IDs are auto-generated sequentially (1, 2, 3, ...)
- ID 0 is reserved for the **BaseNote**
- IDs are stable - deleting a note doesn't renumber others
- References use IDs: `[5].f` (or legacy: `module.getNoteById(5)`)

::: warning
Avoid manually editing note IDs in JSON. Duplicate IDs cause undefined behavior.
:::

## Tips

1. **Start from presets**: Load an interval or chord module as a starting point
2. **Use dependencies**: New notes automatically depend on the selected note
3. **Build incrementally**: Add one note at a time, test with playback
4. **Check dependency lines**: Blue lines show what your new note depends on
