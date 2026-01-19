# Rendering Pipeline

RMT Compose uses WebGL2 for hardware-accelerated rendering of the workspace.

## Architecture Overview

```
Module + Cache → Renderer → WebGL2 → Canvas
                    ↓
              Instance Buffers
                    ↓
              Shader Programs
                    ↓
              Draw Calls
```

## Coordinate Systems

### World Coordinates

Musical values map to world space:

```javascript
// Time (X-axis)
worldX = seconds * 200 * xScaleFactor

// Frequency (Y-axis) - logarithmic
worldY = log2(baseFreq / freq) * 100 * yScaleFactor
```

### Screen Coordinates

Camera transformation converts world to screen:

```javascript
screenPos = cameraMatrix * worldPos
```

### CSS Coordinates

For hit testing, CSS pixels map to world:

```javascript
worldPos = inverseCameraMatrix * cssPos
```

## Renderer Components

### RendererAdapter

Main rendering coordinator:

```javascript
class RendererAdapter {
  constructor(canvas, gl)
  render(module, cache, selection)
  resize(width, height)
  dispose()
}
```

### Shader Programs

| Program | Purpose |
|---------|---------|
| `rectProgram` | Note rectangles |
| `rectBorderProgram` | Selection borders |
| `playheadProgram` | Playhead line |
| `measureDashProgram` | Measure markers |

### Instance Buffers

All notes rendered in a single instanced draw call:

```javascript
rectInstancePosSizeBuffer    // [x, y, w, h] per instance
rectInstanceColorBuffer      // [r, g, b, a] per instance
rectInstanceFlagsBuffer      // Corruption flags
rectInstanceDragFlagsBuffer  // Drag state
```

## Rendering Loop

### Per-Frame Update

```javascript
function render(module, cache, selection) {
  // 1. Clear buffers
  gl.clear(GL_COLOR_BUFFER_BIT)

  // 2. Update instance data for dirty notes
  for (note of dirtyNotes) {
    updateInstanceData(note, cache.get(note.id))
  }

  // 3. Upload instance buffers
  uploadBuffers()

  // 4. Draw measure lines
  drawMeasures()

  // 5. Draw notes (instanced)
  gl.drawArraysInstanced(GL_TRIANGLES, 0, 6, noteCount)

  // 6. Draw selection borders
  drawSelectionBorders(selection)

  // 7. Draw playhead
  drawPlayhead(currentTime)
}
```

### Instance Data Layout

Per-note data in buffers:

```
Position/Size Buffer (16 bytes per instance):
┌────────┬────────┬────────┬────────┐
│   x    │   y    │ width  │ height │
│ float  │ float  │ float  │ float  │
└────────┴────────┴────────┴────────┘

Color Buffer (16 bytes per instance):
┌────────┬────────┬────────┬────────┐
│   r    │   g    │   b    │   a    │
│ float  │ float  │ float  │ float  │
└────────┴────────┴────────┴────────┘

Flags Buffer (4 bytes per instance):
┌────────────────────────────────────┐
│         corruption bitmask         │
│              uint32                │
└────────────────────────────────────┘
```

## Corruption Visualization

Irrational values (TET) are visualized with hatching:

```javascript
// Corruption flags
const CORRUPTED_FREQUENCY = 0x04

// In fragment shader
if (flags & CORRUPTED_FREQUENCY) {
  // Apply diagonal hatching pattern
  applyHatchPattern()
}
```

## Camera System

### CameraController

Handles pan, zoom, and coordinate transformation:

```javascript
class CameraController {
  pan(dx, dy)
  zoom(factor, centerX, centerY)
  getMatrix()           // World → Screen
  getInverseMatrix()    // Screen → World
  worldToScreen(x, y)
  screenToWorld(x, y)
}
```

### Zoom Limits

```javascript
const MIN_ZOOM = 0.1
const MAX_ZOOM = 10.0
```

### Input Handling

| Input | Action |
|-------|--------|
| Mouse wheel | Zoom at cursor |
| Mouse drag | Pan |
| Touch pinch | Zoom |
| Touch drag | Pan |

## Selection Rendering

Selected notes have additional visual treatment:

```javascript
// Selection border
drawBorder(note, SELECTION_COLOR, BORDER_WIDTH)

// Dependency lines
if (showDependencies) {
  drawDependencyLines(note, dependents, DEPENDENT_COLOR)
  drawDependencyLines(note, dependencies, DEPENDENCY_COLOR)
}
```

## Performance Optimizations

### Instanced Rendering

All notes in one draw call:
- Reduces CPU-GPU communication
- Batches state changes
- Scales to thousands of notes

### Dirty Tracking

Only update changed notes:
```javascript
if (note.isDirty) {
  updateInstanceData(noteIndex, newValues)
  note.isDirty = false
}
```

### Frustum Culling

Skip notes outside viewport:
```javascript
if (!isInViewport(note.bounds)) {
  continue
}
```

### Buffer Streaming

Double-buffered updates:
```javascript
gl.bufferSubData(target, offset, data)
// Only uploads changed regions
```

## Shader Details

### Vertex Shader (Notes)

```glsl
attribute vec4 a_posSize;      // Instance: x, y, w, h
attribute vec4 a_color;        // Instance: r, g, b, a
uniform mat3 u_matrix;         // Camera transform

void main() {
  vec2 worldPos = a_posSize.xy + position * a_posSize.zw;
  vec3 clipPos = u_matrix * vec3(worldPos, 1.0);
  gl_Position = vec4(clipPos.xy, 0.0, 1.0);
}
```

### Fragment Shader (Notes)

```glsl
uniform float u_corruption;    // Corruption flags

void main() {
  vec4 color = v_color;

  if (u_corruption > 0.0) {
    // Apply hatching for corrupted values
    float pattern = mod(gl_FragCoord.x + gl_FragCoord.y, 8.0);
    if (pattern < 4.0) {
      color.rgb *= 0.8;
    }
  }

  gl_FragColor = color;
}
```

## See Also

- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) - Detailed renderer API
- [Camera Controller](/developer/rendering/camera-controller) - Camera details
- [GPU Picking](/developer/rendering/picking) - Selection via GPU
