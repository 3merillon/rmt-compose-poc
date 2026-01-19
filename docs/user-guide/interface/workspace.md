# Workspace

The **Workspace** is the main canvas where you view and edit your composition. It's a high-performance WebGL2 rendering surface that displays notes on a frequency/time grid.

## Overview

The workspace shows your composition as a 2D grid:

- **Vertical axis (Y)**: Frequency - higher pitches appear higher
- **Horizontal axis (X)**: Time - notes to the right play later
- **Note rectangles**: Each colored rectangle represents a note
- **BaseNote indicator**: Orange circle at the origin point
- **Measure bars**: Vertical lines dividing time into measures
- **Octave guides**: Dashed horizontal lines marking octave boundaries

## Navigation

### Pan (Move the View)

- **Mouse drag**: Click and drag on empty space to pan
- **Touch**: On touch devices, drag with one finger

### Zoom

- **Mouse wheel**: Scroll to zoom in/out
- **Scale controls**: Use the dot in the bottom-left corner to adjust X/Y density independently

### Reset View

Click the **Reset View** button in the top bar to center the view on the BaseNote.

::: tip
Reset View is disabled when playhead tracking is enabled, since tracking controls the view automatically.
:::

## Selecting Notes

### Click to Select

Click on any note rectangle to select it. The selected note is highlighted, and the Variable Widget appears showing its properties.

### Selection Feedback

When a note is selected:
- The note rectangle is highlighted
- Dependency lines appear:
  - **Blue/cyan lines**: Notes this note depends on
  - **Red/orange lines**: Notes that depend on this note
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

- **Solid vertical lines**: Measure boundaries
- **Dashed vertical lines**: Beat subdivisions
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

When a note is selected:

| Line Color | Meaning |
|------------|---------|
| Blue/Cyan | This note **depends on** the connected note |
| Red/Orange | The connected note **depends on** this note |

### Playhead

During playback, a vertical line shows the current playback position.

- **Line color**: Typically red or highlighted
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

## Keyboard Controls

While the workspace is focused:

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |

## Tips

1. **Use Reset View** after zooming out too far - it's faster than panning back
2. **Watch dependency lines** when editing - they show what will be affected
3. **Enable tracking** during playback to follow along with long compositions
4. **Adjust scale controls** to see more notes vertically or horizontally
