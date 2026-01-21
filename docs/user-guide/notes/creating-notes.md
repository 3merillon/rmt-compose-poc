# Creating Notes

Learn how to add new notes to your composition.

## Methods of Creating Notes

### Method 1: From the Variable Widget

1. **Select** an existing note in the workspace
2. The **Variable Widget** appears with the **"Add Note / Silence"** section
3. Choose a type: **Note** or **Silence**
4. Choose a position:
   - **At End**: New note starts when the selected note ends (for sequences)
   - **At Start**: New note starts at the same time as the selected note (for chords)
5. Optionally edit the pre-filled Frequency, Duration, and Start Time fields
6. Click **Create Note**

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

When you add a note via the Variable Widget, it inherits sensible defaults from the selected note:

### At End (default)

```
frequency: [selected].f
startTime: [selected].t + [selected].d
duration: [selected].d
```

The new note:
- Starts immediately after the selected note ends
- Has the same frequency as the selected note
- Has the same duration as the selected note

### At Start

```
frequency: [selected].f
startTime: [selected].t
duration: [selected].d
```

The new note:
- Starts at the same time as the selected note (for building chords)
- Has the same frequency as the selected note
- Has the same duration as the selected note

## Building Sequences

To create a melody (notes playing one after another):

1. Select the BaseNote or an existing note
2. In the Variable Widget, keep position set to **"At End"** (default)
3. Edit the Frequency field to set the pitch for the new note
4. Click **Create Note**
5. Repeat: select the new note and add another

Each note's start time automatically references the previous note's end time.

## Building Chords

To create a chord (notes playing together):

1. Select the root note
2. In the Variable Widget, change position to **"At Start"**
3. Edit the Frequency field (e.g., `[1].f * (5/4)` for a major third above Note 1)
4. Click **Create Note**
5. Select the root again and repeat for additional chord tones (e.g., `[1].f * (3/2)` for perfect fifth)

All chord notes share the same start time as the root.

## Note ID Assignment

- IDs are auto-generated sequentially (1, 2, 3, ...)
- ID 0 is reserved for the **BaseNote**
- IDs are stable - deleting a note doesn't renumber others
- References use IDs: `[5].f` (or legacy: `module.getNoteById(5).getVariable('frequency')`)

::: warning
Avoid manually editing note IDs in JSON. Duplicate IDs cause undefined behavior.
:::

## Tips

1. **Start from presets**: Load an interval or chord module as a starting point
2. **Use dependencies**: New notes automatically depend on the selected note
3. **Build incrementally**: Add one note at a time, test with playback
4. **Check dependency lines**: Colored lines show dependencies (orange=frequency, teal=startTime, purple=duration)
