# Workspace

The **Workspace** is the main canvas where you view and edit your composition. It's a high-performance WebGL2 rendering surface that displays notes on a frequency/time grid.

## Overview

The workspace shows your composition as a 2D grid:

- **Vertical axis (Y)**: Logarithmic frequency - higher pitches appear higher. Because it's logarithmic, equal intervals (like octaves or fifths) always appear as equal distances regardless of register
- **Horizontal axis (X)**: Time - notes to the right play later
- **Note rectangles**: Each colored rectangle represents a note with a frequency
- **Silences**: Notes without frequency (duration only) - used for rests or spacing in sequences. Silences have start time and duration but produce no sound
- **BaseNote indicator**: Orange circle at the origin point
- **Measure bars**: Vertical lines dividing time into measures
- **Octave guides**: Dashed horizontal lines marking octave boundaries

## Navigation

### Pan (Move the View)

- **Mouse drag**: Click and drag on empty space to pan
- **Touch**: On touch devices, drag with one finger

### Zoom

- **Mouse wheel**: Scroll to zoom in/out
- **Pinch zoom**: On touch devices, pinch with two fingers to zoom
- **Scale controls**: Use the dot in the bottom-left corner to adjust X/Y density independently. Useful for spacing out note rectangles, or for seeing very short notes that appear too small horizontally due to duration or tempo

### Reset View

Click the **Reset View** button in the top bar to center the origin (BaseNote position) on the screen. This only changes the pan position, not the zoom level. Useful when you've lost sight of the workspace due to excessive panning or zooming.

::: tip
Reset View is disabled when playhead tracking is enabled, since tracking controls the view automatically.
:::

## Selecting Notes

### Click to Select

Click on any note rectangle to select it. The selected note is highlighted, and the Variable Widget appears showing its properties.

### Selection Feedback

When a note is selected:
- The note rectangle is highlighted
- Dependency lines appear, color-coded by property:
  - **Orange lines**: Frequency dependencies
  - **Teal/Cyan lines**: Start time dependencies
  - **Purple lines**: Duration dependencies
- Line thickness indicates direction:
  - **Thick lines**: Parent dependencies (what this note depends on)
  - **Thin lines**: Child dependencies (what depends on this note)
- The Variable Widget shows editable properties

### Deselecting

Click on empty workspace area to deselect the current note.

## Editing Notes

### Moving Notes

1. Select a note by clicking on it
2. Drag the **note body** (center of the rectangle) to move it
3. The note snaps to the grid (sixteenth-note intervals)
4. Dependent notes show a preview of their new positions

### Resizing Notes (Duration)

1. Select a note by clicking on it
2. Drag the **right edge** (resize handle) to change duration
3. Duration snaps to grid intervals

### Octave Transposition

1. Select a note
2. Click the **+** or **-** buttons in the octave regions:
   - **+** (above the note): Transpose up one octave (multiply frequency by 2)
   - **-** (below the note): Transpose down one octave (divide frequency by 2)

## Measure Bars

Measure bars divide time into sections.

### Viewing Measures

- **Dashed vertical lines**: Measure boundaries
- **Solid vertical lines**: Module start and end boundaries only
- **Triangles at bottom**: Drag handles for measure positions

### Editing Measures

1. Click on a measure bar to select it
2. Drag the **triangle handle** at the bottom to adjust the measure position
3. Notes that depend on this measure's position show a preview

## Visual Elements

### Note Labels

Each note displays its frequency ratio as a label (e.g., "3/2", "5/4").

- **Clean fractions**: Pure ratios are shown exactly
- **≈ prefix**: Indicates an irrational value (TET approximation)

### Color Coding

Notes can have custom colors set via the `color` property. Default colors are assigned automatically.

### Dependency Lines

When a note is selected, dependency lines are color-coded by property type:

| Line Color | Property Type |
|------------|---------------|
| Orange | **Frequency** dependencies |
| Teal/Cyan | **Start time** dependencies |
| Purple | **Duration** dependencies |

Line thickness indicates dependency direction:
- **Thick lines**: Parent dependencies (notes this note depends on)
- **Thin lines**: Child dependencies (notes that depend on this note)

### Playhead

During playback, a vertical line shows the current playback position.

- **Line color**: Orange
- **Movement**: Moves left-to-right with playback time
- **Tracking mode**: Keeps the playhead centered (optional)

## Grid Snapping

When moving or resizing notes, positions snap to a grid:

- **Time grid**: Sixteenth-note intervals (based on tempo)
- **Frequency grid**: No automatic snapping (free placement)

Snapping helps align notes to rhythmic positions.

## Performance

The workspace uses WebGL2 for rendering:

- **Instanced rendering**: Hundreds of notes rendered efficiently
- **GPU picking**: Fast selection even with many notes
- **Smooth pan/zoom**: Hardware-accelerated camera transforms

::: info System Requirements
WebGL2 is required. If not available, the workspace will not initialize. Most modern browsers support WebGL2 by default.
:::

## Keyboard Shortcuts

These shortcuts work anywhere in the app:

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |

## Tips

1. **Use Reset View** if you've lost sight of the workspace - it re-centers the origin on screen
2. **Watch dependency lines** when editing - they show what will be affected
3. **Enable tracking** during playback to follow along with long compositions
4. **Adjust scale controls** to space out notes or see short notes that appear too small
