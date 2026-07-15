---
title: Camera Controller
description: CameraController turns pointer, wheel and pinch input into a 2-D affine basis for the WebGL2 renderer — and gates itself so note drags work on touch.
---

# Camera Controller

`CameraController` (`src/renderer/webgl2/camera-controller.js`, ~400 lines) is the whole camera. It
installs its own pointer and wheel listeners, maintains a uniform scale plus a translation, and hands
the renderer a 2-D affine basis in CSS pixels.

It has **six public methods**. That is the entire surface:

```javascript
destroy()
getBasis()
setInputEnabled(enabled)
setSingleFingerPanEnabled(enabled)
screenToWorld(sx, sy)   // -> { x, y }
worldToScreen(wx, wy)   // -> { x, y }
```

## Construction

```javascript
import { CameraController } from './renderer/webgl2/camera-controller.js';

const camera = new CameraController(containerEl);   // a DOM CONTAINER, not the canvas
camera.onChange = () => renderer.updateViewportBasis(camera.getBasis());
```

The constructor takes the **workspace container element**, not the canvas — the canvas is a
`position: fixed` overlay with `pointer-events: none`, so it never receives input. Every listener and
every `getBoundingClientRect()` call targets the container.

The constructor also **installs all its event listeners immediately** (`_initEvents()`). There is no
separate `init()` and no `attach()`. `destroy()` removes them.

### The `onChange` contract

`onChange` is a plain assignable property, not a registration method. Every mutator calls it after
it has updated `scale`/`tx`/`ty`. Nothing redraws without it — `Workspace.init()` wires it to
`renderer.updateViewportBasis(camera.getBasis())` and that is the only thing that pushes camera
state into the renderer.

`updateViewportBasis()` early-returns on an unchanged basis, so calling `onChange` on a no-op move is
harmless. See [the redraw gate](/developer/rendering/webgl2-renderer#the-frame-loop-and-the-redraw-gate).

## State

These are plain instance fields. There are no module-level constants and no getters.

| Field | Default | Meaning |
|---|---|---|
| `scale` | `1.0` | Zoom. Uniform on both axes. |
| `tx` / `ty` | `0` / `0` | Translation in CSS px. **Not** `translateX` / `translateY`. |
| `minScale` | `0.1` | Hard floor. |
| `maxScale` | `10.0` | Hard ceiling. |
| `lockX` | `false` | Suppress user-driven X panning (playhead tracking). |
| `inputEnabled` | `true` | When false, **all** pan/zoom input is ignored. |
| `singleFingerPanEnabled` | `true` | When false, one-finger pan is ignored but pinch still works. |
| `maintainFocusOnResize` | `true` | A **boolean flag**, not a method. |
| `canvasOffset` | `{x, y}` | The container's page position, refreshed on resize and scroll. |

## The basis

```javascript
const { a, b, c, d, e, f } = camera.getBasis();
```

`getBasis()` returns a **plain object**, not a `Float32Array`. It is the world → screen affine, in
CSS pixels:

```
[ a  c  e ]     [ scale    0     tx + canvasOffset.x ]
[ b  d  f ]  =  [   0    scale   ty + canvasOffset.y ]
[ 0  0  1 ]     [   0      0              1          ]
```

Note that `getBasis()` **folds `canvasOffset` into the translation column**. The renderer's matrix is
therefore in *page* CSS px, not container-local px, which is why
`RendererAdapter.screenToWorld(clientX, clientY)` can take raw client coordinates straight from a
pointer event.

## Coordinate conversion

Both return `{ x, y }` objects. Neither returns an array.

```javascript
const w = camera.screenToWorld(e.clientX, e.clientY);  // page CSS px  -> world
const s = camera.worldToScreen(wx, wy);                // world -> CONTAINER-local CSS px
```

::: danger These two are not inverses
`screenToWorld` subtracts `canvasOffset` (it consumes **page** coordinates); `worldToScreen` does not
add it back (it produces **container-local** coordinates). Round-tripping a point through both gives
you back the original minus `canvasOffset`. `worldToScreen` currently has **zero callers** in the
app; use the renderer's basis for forward mapping, or add the offset yourself.
:::

## Gestures

All input arrives through **Pointer Events**, captured at the document level once a gesture starts.
There is no separate mouse/touch code path.

| Gesture | Input | Behaviour |
|---|---|---|
| Zoom | Wheel / trackpad scroll over the container | Zooms **around the pointer** — the world point under the cursor stays fixed |
| Zoom | **Ctrl / ⌘ + wheel** | Drives the **same camera zoom**. Browser page-zoom is suppressed. |
| Zoom | Trackpad pinch | Arrives as ctrl+wheel; the same handler picks it up for free |
| Pan | Left-button drag | Pans both axes |
| Pan | One-finger drag | Pans. Can be disabled independently of pinch. |
| Zoom + pan | Two-finger pinch | Zooms around the **pinch centre** and pans by the centre's movement, simultaneously |
| Pinch → pan | Lift one finger mid-pinch | Hands over to one-finger pan with no jump |

Zoom is smooth and exponential, not stepped:

```javascript
const zoom = Math.exp(-e.deltaY * 0.0015);            // per wheel event
const newScale = clamp(oldScale * zoom, minScale, maxScale);
// then: tx = mx - k * (mx - tx), ty = my - k * (my - ty)   where k = newScale / oldScale
```

### Ctrl+wheel is captured on purpose

Once past the `inputEnabled` gate, `_onWheel` calls `preventDefault()` on **every** wheel event,
modified or not (`camera-controller.js:141`). Reaching for a
modifier to zoom is a normal desktop reflex, and page-zooming the app on that reflex is jarring — so
over the canvas, ctrl/⌘+wheel drives the *camera*, exactly like a plain wheel. The page-zoom default
is killed app-wide in `main.js` (capture phase, `passive: false`, `preventDefault()` only — it does
**not** stop propagation, so the camera still receives the event). Over the UI chrome, ctrl+wheel
therefore does nothing at all.

This is a deliberate, load-bearing decision, not an oversight. It is also what makes trackpad pinch
work for free.

### Pinch

Touch pointers are tracked in a `Map` keyed by `pointerId`. The **second finger always wins**: two
touches begin a pinch and cancel any single-finger drag in progress. On `pointerup`, dropping back to
one finger re-seeds `_lastX`/`_lastY` from the remaining touch and continues as a pan — that is the
seamless handoff, and it is why lifting a finger mid-pinch does not snap the view.

### `lockX` — playhead tracking

Setting `camera.lockX = true` does two things, and the second is the one people forget:

1. Pan skips the X axis entirely (`if (!this.lockX) this.tx += dx;`).
2. **The zoom/pinch centre is forced to the container's mid-X.** Wheel zoom, pinch start and pinch
   move all clamp `mx`/`center.x` to `rect.width * 0.5`.

Without (2) the view would drift sideways as you zoomed, because the pointer is almost never on the
playhead. `lockX` is set from `player.js` when Playhead Tracking is toggled on. A user who "can't pan
sideways" has tracking on — see [Playhead Tracking](/user-guide/playback/tracking).

## Input gating — how note drags work on a touchscreen

This is the most useful thing this class does, and it is two one-line setters.

```javascript
camera.setInputEnabled(false);            // suppress ALL pan and zoom
camera.setSingleFingerPanEnabled(false);  // suppress one-finger pan, KEEP pinch-zoom
```

- **`setInputEnabled(false)`** is asserted by `Workspace` for the duration of a GL interaction (note
  move, resize, measure drag). Without it, dragging a note would pan the canvas underneath it. It is
  restored in `_endInteraction()`.
- **`setSingleFingerPanEnabled(false)`** is asserted while a note long-press is *pending*. The finger
  is down on a note and might become a drag, so a pan would be wrong — but a second finger must still
  be able to take the gesture back for the camera. Gating only single-finger pan is what makes both
  true at once.

When single-finger pan is disabled the handler still tracks `_lastX`/`_lastY` without applying the
delta, so re-enabling mid-gesture does not produce a jump.

::: warning Dead hook
`shouldAllowSingleFingerPanStart` is now entirely unreferenced: the `workspace.js` assignment that
used to set it has been removed, and **`CameraController` never called it** in the first place. The
behaviour it was meant to provide is delivered by `setSingleFingerPanEnabled(false)`. Do not treat
it as an extension point.
:::

## Resize

`maintainFocusOnResize` (default `true`) keeps the world point that was at the viewport centre at the
new centre. The resize handler computes that world point **before** updating `canvasOffset`, then
solves for the translation that puts it back in the middle:

```javascript
this.tx = (r.width * 0.5) - keepWorld.x * s;
this.ty = (r.height * 0.5) - keepWorld.y * s;
```

It only fires when the size actually changed — pure position or scroll changes just refresh
`canvasOffset` and do not move the camera. Both `resize` and `scroll` are listened for on `window`
in the capture phase, because the canvas is `position: fixed` and must stay glued to a container that
can move under it.

## Mobile

The constructor sets these on the container:

```javascript
containerEl.style.touchAction = 'none';
containerEl.style.webkitTapHighlightColor = 'transparent';
```

`touch-action: none` is what stops the browser stealing a workspace gesture for scroll or zoom.
Without it, no amount of `preventDefault()` in a pointer handler would reliably win on Android.

## See also

- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) — the basis consumer
- [Picking](/developer/rendering/picking) — turning a pointer position into a note
- [Workspace](/user-guide/interface/workspace) — the gestures from the user's side
- [Playhead Tracking](/user-guide/playback/tracking) — what `lockX` looks like in the app
