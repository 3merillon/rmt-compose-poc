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

```
# Frequency: Perfect fifth above BaseNote
base.f * (3/2)

# Start time: After note 5 ends
[5].t + [5].d

# Duration: Quarter note at current tempo
beat(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Frequency: Perfect fifth above BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Start time: After note 5 ends
module.getNoteById(5).getVariable('startTime')
  .add(module.getNoteById(5).getVariable('duration'))

// Duration: Quarter note at current tempo
new Fraction(60).div(module.findTempo(module.baseNote))
```
</details>

::: warning Syntax Matters
Expressions must follow the exact syntax. Missing parentheses or typos will cause errors. Use Ctrl+Z to undo if something goes wrong.
:::

## Action Sections

### Add Note / Silence

Create new notes or silences relative to the selected one:

| Option | Behavior |
|--------|----------|
| **At End** | New note starts when the selected note ends (for sequences) |
| **At Start** | New note starts at the same time as the selected note (for chords) |

You can choose between creating a **Note** (with frequency) or a **Silence** (duration only, no sound).

### Add Measure

This section only appears when selecting:
- **BaseNote**: Shows "Add New Measure Chain" to start a new chain
- **Last measure in a chain**: Shows "Add Measure" to extend the existing chain

You can only create new measure chains (from BaseNote) or add measures to the end of existing chains.

### Evaluate Functions

| Function | Description |
|----------|-------------|
| **Evaluate to BaseNote** | Rewrites this note's references to use only BaseNote |
| **Evaluate Module** | Evaluates all notes in the module to BaseNote references |
| **Liberate Dependencies** | Substitutes this note's expressions into dependent notes, bypassing it in the dependency chain |

#### Evaluate to BaseNote

Converts complex dependency chains to direct BaseNote references.

**Before:**
```
[3].f * (5/4)
# Where note 3's frequency is: base.f * (3/2)
```

**After:**
```
base.f * (15/8)
# Direct computation: 3/2 × 5/4 = 15/8
```

<details>
<summary>Legacy JavaScript syntax</summary>

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
</details>

#### Liberate Dependencies

Substitutes this note's raw expressions into all notes that depend on it, effectively bypassing this note in the dependency chain.

**Example:** If Note 2 has `[1].t + [1].d` and Note 1's expressions are `base.t` and `beat(base)`:
- After liberating Note 1, Note 2's expression becomes `base.t + beat(base)`
- Note 2 no longer depends on Note 1

Use this before deleting a note that other notes depend on:
1. Select the note you want to delete
2. Click **Liberate Dependencies**
3. Dependent notes now reference what this note referenced (bypassing it)
4. Safely delete the original note

### Delete Section

| Option | Behavior |
|--------|----------|
| **Delete and Remove Dependencies** | Deletes this note AND all notes that depend on it |
| **Delete and Keep Dependencies** | Liberates the note first (substitutes its expressions into dependents), then deletes it. Dependent notes remain but now reference what this note referenced. |

::: danger Delete with Caution
"Delete and Remove Dependencies" can delete many notes at once. Check the dependency lines before deleting (thin lines indicate notes that depend on this one).
:::

## Visual Feedback

### Dependency Highlighting

When editing an expression:
- Dependent notes highlight in the workspace when you save changes
- Shows which notes are affected by the modification

### The ≈ Symbol and Hatching

Properties showing **≈** contain irrational or approximated values (often from TET expressions). Both directly and transitively corrupted values display as `≈` followed by a fractional approximation (e.g., `≈3/2`).

**Visual indicators on notes:**
- **Directly corrupted** (contains irrational values like TET): Crosshatch pattern (X) on the note rectangle
- **Transitively corrupted** (depends on a corrupted note): Single diagonal hatch pattern on the note rectangle

The underlying symbolic value is preserved internally.

## Widget Positioning

- **Default**: Bottom-left corner of the workspace
- **Draggable**: Click and drag the header to reposition
- **Anchored**: Stays anchored to the bottom of the window

## Tips

1. **Use direct manipulation first** - Dragging and resizing notes in the workspace is faster than editing expressions
2. **Watch dependencies** - The workspace shows what will be affected by your changes
3. **Use Liberate to extract notes** - If you want to remove a note from a complex dependency tree while preserving the chain, liberate it first to bypass it in the dependency structure
4. **Copy expressions** - Select and copy working expressions as templates for new notes
