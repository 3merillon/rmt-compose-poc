# Camera Controller

The CameraController manages viewport transformation, handling pan, zoom, and coordinate conversion.

## Class: CameraController

### Constructor

```javascript
const camera = new CameraController(canvas)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `canvas` | HTMLCanvasElement | Target canvas for size reference |

### Properties

```javascript
camera.scale      // Current zoom level (1.0 = 100%)
camera.translateX // Horizontal pan offset
camera.translateY // Vertical pan offset
camera.lockX      // Prevent horizontal panning
```

## Transformation Matrix

The camera uses a 3x3 affine transformation matrix:

```
┌─────────────────────────┐
│  scale    0    translateX │
│   0     scale  translateY │
│   0       0       1       │
└─────────────────────────┘
```

### getMatrix()

```javascript
const matrix = camera.getMatrix()
// Returns Float32Array[9] for WebGL uniform
```

Transforms world coordinates to clip space.

### getInverseMatrix()

```javascript
const inverse = camera.getInverseMatrix()
```

Transforms screen coordinates to world coordinates.

## Pan Operations

### pan()

```javascript
camera.pan(deltaX, deltaY)
```

Moves the viewport by the specified pixel amounts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `deltaX` | number | Horizontal movement in CSS pixels |
| `deltaY` | number | Vertical movement in CSS pixels |

### panTo()

```javascript
camera.panTo(worldX, worldY)
```

Centers the viewport on a world coordinate.

### lockX

```javascript
camera.lockX = true  // Prevent horizontal panning
```

Used during playback to keep the playhead in view while allowing vertical panning.

## Zoom Operations

### zoom()

```javascript
camera.zoom(factor, centerX, centerY)
```

Zooms the viewport around a point.

| Parameter | Type | Description |
|-----------|------|-------------|
| `factor` | number | Zoom multiplier (>1 zooms in, <1 zooms out) |
| `centerX` | number | Zoom center X in CSS pixels |
| `centerY` | number | Zoom center Y in CSS pixels |

### Zoom Limits

```javascript
const MIN_ZOOM = 0.1   // 10%
const MAX_ZOOM = 10.0  // 1000%
```

### zoomToFit()

```javascript
camera.zoomToFit(bounds)
```

Adjusts zoom and pan to fit the given world bounds in the viewport.

| Parameter | Type | Description |
|-----------|------|-------------|
| `bounds` | Object | `{minX, minY, maxX, maxY}` in world coords |

## Coordinate Conversion

### worldToScreen()

```javascript
const [screenX, screenY] = camera.worldToScreen(worldX, worldY)
```

Converts world coordinates to CSS pixel coordinates.

### screenToWorld()

```javascript
const [worldX, worldY] = camera.screenToWorld(screenX, screenY)
```

Converts CSS pixel coordinates to world coordinates.

### getVisibleBounds()

```javascript
const bounds = camera.getVisibleBounds()
// → { minX, minY, maxX, maxY } in world coordinates
```

Returns the world-space rectangle currently visible in the viewport.

## Input Handling

### Mouse Wheel

```javascript
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const factor = e.deltaY > 0 ? 0.9 : 1.1
  camera.zoom(factor, e.clientX, e.clientY)
})
```

### Mouse Drag

```javascript
let dragging = false
let lastX, lastY

canvas.addEventListener('mousedown', (e) => {
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
})

canvas.addEventListener('mousemove', (e) => {
  if (dragging) {
    camera.pan(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX
    lastY = e.clientY
  }
})

canvas.addEventListener('mouseup', () => {
  dragging = false
})
```

### Touch Gestures

```javascript
// Single touch: pan
// Two-finger pinch: zoom

let initialPinchDistance = null

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const distance = getPinchDistance(e.touches)
    if (initialPinchDistance) {
      const factor = distance / initialPinchDistance
      camera.zoom(factor, centerX, centerY)
    }
    initialPinchDistance = distance
  }
})
```

## Viewport Maintenance

### maintainFocusOnResize()

```javascript
camera.maintainFocusOnResize(newWidth, newHeight)
```

Keeps the center of the viewport stable when the canvas resizes.

### DPI Awareness

```javascript
const dpr = window.devicePixelRatio || 1
camera.setDPR(dpr)
```

Handles high-resolution displays by scaling appropriately.

## Animation

### animateTo()

```javascript
camera.animateTo({
  scale: 2.0,
  translateX: 500,
  translateY: 200
}, duration)
```

Smoothly animates to a target camera state.

### followPlayhead()

```javascript
camera.followPlayhead(playheadX, viewportWidth)
```

Keeps the playhead visible during playback, scrolling as needed.

## State Serialization

### getState()

```javascript
const state = camera.getState()
// → { scale, translateX, translateY }
```

### setState()

```javascript
camera.setState({ scale: 1.5, translateX: 100, translateY: 50 })
```

## See Also

- [Rendering Pipeline](/developer/architecture/rendering) - Architecture overview
- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) - Renderer details
- [Workspace](/user-guide/interface/workspace) - User guide
