# GPU Picking

GPU picking enables efficient note selection by rendering note IDs to an offscreen buffer.

## Overview

Instead of iterating through all notes to find which one is under the cursor, GPU picking:

1. Renders notes to an offscreen framebuffer
2. Encodes note IDs as colors
3. Reads the pixel at the cursor position
4. Decodes the color back to a note ID

This provides O(1) selection regardless of note count.

## Class: Picking

### Constructor

```javascript
const picking = new Picking(gl, width, height)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `gl` | WebGL2RenderingContext | WebGL2 context |
| `width` | number | Framebuffer width |
| `height` | number | Framebuffer height |

### Methods

#### begin()

```javascript
picking.begin()
```

Binds the picking framebuffer for rendering.

#### end()

```javascript
picking.end()
```

Unbinds the picking framebuffer, returning to default framebuffer.

#### readAt()

```javascript
const noteId = picking.readAt(x, y)
```

Reads the note ID at the specified pixel coordinates.

| Parameter | Type | Description |
|-----------|------|-------------|
| `x` | number | X coordinate in CSS pixels |
| `y` | number | Y coordinate in CSS pixels |

Returns `null` if no note at that position, or the note ID.

#### resize()

```javascript
picking.resize(width, height)
```

Resizes the framebuffer when canvas size changes.

## ID Encoding

Note IDs are encoded into RGB values:

```javascript
function encodeId(id) {
  return [
    (id >> 16) & 0xFF,  // R
    (id >> 8) & 0xFF,   // G
    id & 0xFF           // B
  ]
}

function decodeId(r, g, b) {
  return (r << 16) | (g << 8) | b
}
```

This supports up to 16,777,215 unique note IDs (24-bit).

## Framebuffer Setup

```javascript
// Create framebuffer
const fbo = gl.createFramebuffer()
gl.bindFramebuffer(GL_FRAMEBUFFER, fbo)

// Create color texture
const colorTexture = gl.createTexture()
gl.bindTexture(GL_TEXTURE_2D, colorTexture)
gl.texImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, null)
gl.framebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTexture, 0)

// Optional: depth buffer for correct overlap handling
const depthBuffer = gl.createRenderbuffer()
gl.bindRenderbuffer(GL_RENDERBUFFER, depthBuffer)
gl.renderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT16, width, height)
gl.framebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depthBuffer)
```

## Picking Shader

```glsl
// Vertex shader (same as main render)
attribute vec4 a_posSize;
uniform mat3 u_matrix;

void main() {
  vec2 worldPos = a_posSize.xy + position * a_posSize.zw;
  vec3 clipPos = u_matrix * vec3(worldPos, 1.0);
  gl_Position = vec4(clipPos.xy, 0.0, 1.0);
}

// Fragment shader (ID output)
uniform vec3 u_id;  // Encoded ID as normalized RGB

void main() {
  gl_FragColor = vec4(u_id, 1.0);
}
```

## Usage Pattern

```javascript
// 1. Begin picking pass
picking.begin()

// 2. Clear with background color (ID 0 = no note)
gl.clearColor(0, 0, 0, 1)
gl.clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

// 3. Render each note with its ID
for (const note of notes) {
  const [r, g, b] = encodeId(note.id)
  gl.uniform3f(u_id, r / 255, g / 255, b / 255)
  drawNote(note)
}

// 4. End picking pass
picking.end()

// 5. On click, read ID
canvas.addEventListener('click', (e) => {
  const noteId = picking.readAt(e.clientX, e.clientY)
  if (noteId !== null) {
    selectNote(noteId)
  }
})
```

## Reading Pixels

```javascript
readAt(x, y) {
  // Bind framebuffer
  gl.bindFramebuffer(GL_FRAMEBUFFER, this.fbo)

  // Flip Y coordinate (WebGL origin is bottom-left)
  const glY = this.height - y

  // Read single pixel
  const pixel = new Uint8Array(4)
  gl.readPixels(x, glY, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel)

  // Decode ID
  const id = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]

  // ID 0 means no note (background)
  return id === 0 ? null : id
}
```

## Current Implementation

The current implementation uses a CPU fallback for simplicity:

```javascript
function findNoteAtPosition(module, cache, worldX, worldY) {
  for (const [id, note] of module.notes) {
    const values = cache.get(id)
    const bounds = calculateBounds(values)
    if (pointInBounds(worldX, worldY, bounds)) {
      return id
    }
  }
  return null
}
```

GPU picking is scaffolded but not yet the primary path.

## Performance Comparison

| Method | Complexity | Notes per Frame |
|--------|------------|-----------------|
| CPU iteration | O(n) | ~1,000 |
| GPU picking | O(1) | ~100,000+ |

GPU picking becomes beneficial with large note counts.

## Limitations

- Requires WebGL2 framebuffer support
- Single pixel read has GPU sync cost
- Must re-render on viewport change

## See Also

- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) - Main renderer
- [Camera Controller](/developer/rendering/camera-controller) - Coordinate conversion
