# Variable Widget

The **Variable Widget** is a floating panel that appears when you select a note or measure. It allows you to view and edit all properties of the selected element.

## Overview

The Variable Widget displays:

- **Header**: Note/Measure ID and type
- **Property rows**: Each variable with evaluated and raw values
- **Action sections**: Add notes, evaluate, delete

## Opening the Widget

1. **Click** on any note or measure in the workspace
2. The Variable Widget appears on the right side
3. Click **empty workspace** to close it

## Widget Sections

### Header

Shows:
- **Element type**: Note, Measure, or BaseNote
- **ID**: The unique identifier of the element

### Property Rows

Each property has two values:

| Field | Description |
|-------|-------------|
| **Evaluated** | The computed result (e.g., "660 Hz", "1.5 seconds") |
| **Raw** | The expression that produces the evaluated value |

### Common Properties

| Property | Description |
|----------|-------------|
| **frequency** | The pitch of the note (in Hz or as ratio) |
| **startTime** | When the note begins playing |
| **duration** | How long the note plays |
| **tempo** | Beats per minute (inherited from BaseNote) |
| **beatsPerMeasure** | Time signature numerator |
| **color** | Visual color in the workspace |
| **instrument** | Sound used for playback |

## Editing Properties

### Quick Controls

#### Frequency
- **Octave +/-**: Click to transpose up/down by octave (×2 or ÷2)

#### Duration
- **Note icons**: Click preset durations:
  - Whole note (4 beats)
  - Half note (2 beats)
  - Quarter note (1 beat)
  - Eighth note (1/2 beat)
  - Sixteenth note (1/4 beat)
- **Dot modifiers**: Add 50% or 75% to duration

#### Instrument
- **Dropdown**: Select from available instruments

### Raw Expression Editing

1. Click on the **Raw** field for any property
2. Edit the expression text
3. Click **Save** to apply changes
4. The Evaluated value updates

Example expressions:

```javascript
// Frequency: Perfect fifth above BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Start time: After note 5 ends
module.getNoteById(5).getVariable('startTime')
  .add(module.getNoteById(5).getVariable('duration'))

// Duration: Quarter note at current tempo
new Fraction(60).div(module.findTempo(module.baseNote))
```

::: warning Syntax Matters
Expressions must follow the exact syntax. Missing parentheses or typos will cause errors. Use Ctrl+Z to undo if something goes wrong.
:::

## Action Sections

### Add Note

Create new notes relative to the selected one:

| Option | Behavior |
|--------|----------|
| **Add at Start+Duration** | New note starts when this note ends |
| **Add at Same Time** | New note starts at same time (for chords) |

### Add Measure

Add a measure bar:
- Creates a measure marker at a position relative to the selected element

### Evaluate Functions

| Function | Description |
|----------|-------------|
| **Evaluate to BaseNote** | Rewrites all references to use only BaseNote |
| **Evaluate Module** | Evaluates all notes in the module |
| **Liberate Dependencies** | Replaces references with raw values |

#### Evaluate to BaseNote

Converts complex dependency chains to direct BaseNote references.

**Before:**
```javascript
module.getNoteById(3).getVariable('frequency').mul(new Fraction(5, 4))
// Where note 3's frequency is: baseNote × 3/2
```

**After:**
```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(15, 8))
// Direct computation: 3/2 × 5/4 = 15/8
```

#### Liberate Dependencies

Replaces references to this note with their evaluated values.

Use this before deleting a note that other notes depend on:
1. Select the note you want to delete
2. Click **Liberate Dependencies**
3. Dependent notes now have their own independent values
4. Safely delete the original note

### Delete Section

| Option | Behavior |
|--------|----------|
| **Delete and Remove Dependencies** | Deletes this note AND all notes that depend on it |
| **Delete and Keep Dependencies** | Deletes this note but keeps dependent notes (they update their references) |

::: danger Delete with Caution
"Delete and Remove Dependencies" can delete many notes at once. Check the dependency lines (red = dependents) before deleting.
:::

## Visual Feedback

### Dependency Highlighting

When editing an expression, dependent notes highlight in the workspace:
- Shows which notes will be affected by your change
- Updates in real-time as you type

### The ≈ Symbol

Properties showing **≈** contain irrational values (from TET expressions):

- Cannot be expressed as exact fractions
- Display shows decimal approximation
- Underlying value is preserved symbolically

## Widget Positioning

- **Default**: Right side of the workspace
- **Draggable**: Click and drag the header to move
- **Auto-sizing**: Expands to fit content
- **Bounds**: Stays within the window

## Tips

1. **Use quick controls first** - Note duration icons and octave buttons are faster than editing expressions
2. **Watch dependencies** - The workspace shows what will be affected by your changes
3. **Liberate before deleting** - If other notes depend on the one you're deleting
4. **Copy expressions** - Select and copy working expressions as templates for new notes
5. **Check evaluated values** - Verify your expression produces the expected result before saving
