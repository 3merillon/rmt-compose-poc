# WebGL2 Renderer

The WebGL2 renderer provides hardware-accelerated visualization of the workspace.

## Class: RendererAdapter

### Constructor

```javascript
const renderer = new RendererAdapter(canvas, gl)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `canvas` | HTMLCanvasElement | Target canvas element |
| `gl` | WebGL2RenderingContext | WebGL2 context |

### Methods

#### render()

```javascript
renderer.render(module, cache, selection, options)
```

Renders the complete workspace.

| Parameter | Type | Description |
|-----------|------|-------------|
| `module` | Module | The module to render |
| `cache` | Map | Evaluation cache |
| `selection` | Set | Selected note IDs |
| `options` | Object | Render options |

Options:
```javascript
{
  showDependencies: boolean,  // Draw dependency lines
  playheadTime: number,       // Current playhead position
  dragPreview: Object,        // Drag preview state
}
```

#### resize()

```javascript
renderer.resize(width, height)
```

Updates viewport and projection for new canvas size.

#### dispose()

```javascript
renderer.dispose()
```

Releases all WebGL resources.

## Shader Programs

### rectProgram

Renders note rectangles with instancing.

**Attributes:**
- `a_position` - Vertex position (unit quad)
- `a_posSize` - Instance: [x, y, width, height]
- `a_color` - Instance: [r, g, b, a]
- `a_flags` - Instance: corruption bitmask

**Uniforms:**
- `u_matrix` - Camera transformation matrix

### rectBorderProgram

Renders selection and drag borders.

**Uniforms:**
- `u_matrix` - Camera transformation
- `u_color` - Border color
- `u_thickness` - Border thickness in pixels

### playheadProgram

Renders the vertical playhead line.

**Uniforms:**
- `u_matrix` - Camera transformation
- `u_position` - Playhead X position (world coords)
- `u_color` - Playhead color

### measureDashProgram

Renders dashed measure boundary lines.

**Uniforms:**
- `u_matrix` - Camera transformation
- `u_dashSize` - Dash pattern size

## Instance Buffers

### Position/Size Buffer

```javascript
// Layout: [x, y, width, height] per instance
// Type: Float32Array
// Size: noteCount * 4 * 4 bytes

const posSizeBuffer = gl.createBuffer()
gl.bindBuffer(GL_ARRAY_BUFFER, posSizeBuffer)
gl.bufferData(GL_ARRAY_BUFFER, posSizeData, GL_DYNAMIC_DRAW)
```

### Color Buffer

```javascript
// Layout: [r, g, b, a] per instance
// Type: Float32Array
// Size: noteCount * 4 * 4 bytes

const colorBuffer = gl.createBuffer()
```

### Flags Buffer

```javascript
// Layout: uint32 bitmask per instance
// Type: Uint32Array
// Size: noteCount * 4 bytes

const flagsBuffer = gl.createBuffer()
```

## Coordinate Conversion

### World to Screen

```javascript
const [screenX, screenY] = renderer.worldToScreen(worldX, worldY)
```

### Screen to World

```javascript
const [worldX, worldY] = renderer.screenToWorld(screenX, screenY)
```

### Note to World Coordinates

```javascript
function noteToWorld(note, cache) {
  const values = cache.get(note.id)

  // X: time in seconds → world X
  const x = values.startTime.valueOf() * 200 * xScale

  // Y: frequency → logarithmic Y
  const freq = values.frequency.valueOf()
  const y = Math.log2(baseFreq / freq) * 100 * yScale

  // Width: duration in seconds
  const width = values.duration.valueOf() * 200 * xScale

  // Height: fixed or frequency-dependent
  const height = NOTE_HEIGHT

  return { x, y, width, height }
}
```

## Corruption Visualization

Irrational values (from TET calculations) are marked with visual patterns:

```javascript
// Corruption flag bits
const CORRUPTED_START_TIME = 0x01
const CORRUPTED_DURATION = 0x02
const CORRUPTED_FREQUENCY = 0x04
const CORRUPTED_TEMPO = 0x08

// In shader
if ((flags & CORRUPTED_FREQUENCY) != 0) {
  // Apply diagonal hatching
}
```

## Render Order

1. **Clear** - Clear color buffer
2. **Octave lines** - Background reference lines
3. **Measure lines** - Vertical dashed lines
4. **Notes** - Instanced rectangles
5. **Selection borders** - Highlighted notes
6. **Dependency lines** - Blue/red connection lines
7. **Drag preview** - Ghost rectangles during drag
8. **Playhead** - Vertical time indicator

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Max instances | 65,536 (16-bit index) |
| Draw calls | 5-7 per frame |
| Buffer updates | O(dirty notes) |
| GPU memory | ~100 bytes per note |

## Error Handling

```javascript
// Check for WebGL2 support
if (!gl) {
  throw new Error('WebGL2 not supported')
}

// Check for shader compilation errors
const status = gl.getShaderParameter(shader, GL_COMPILE_STATUS)
if (!status) {
  console.error(gl.getShaderInfoLog(shader))
}
```

## See Also

- [Rendering Pipeline](/developer/architecture/rendering) - Architecture overview
- [Camera Controller](/developer/rendering/camera-controller) - Pan and zoom
- [GPU Picking](/developer/rendering/picking) - Selection via GPU
