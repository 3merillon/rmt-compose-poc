---
title: Rendering Pipeline
description: The WebGL2 pipeline in RMT Compose — world coordinates, 22 shader programs, instanced passes, the epoch system, redraw gating and CPU picking.
---

# Rendering Pipeline

The entire score — notes, measure bars, dependency lines, rings, text — is drawn in **one WebGL2
canvas**. There is no DOM element per note. Each visual class is uploaded into per-instance typed
arrays and drawn with a single `drawArraysInstanced` call.

## Architecture

```
evaluation cache + module
        │
        ▼
RendererAdapter.sync()          ← CPU: rebuild all instance arrays, upload
        │  needsRedraw = true
        ▼
rAF → _render()                 ← early-returns when nothing changed
        │
        ├─ note bodies          1 instanced draw for the whole score
        ├─ selection / dependency rings
        ├─ octave guides, measure bars, dependency link-lines
        └─ per-note overlays    ← viewport-culled: tabs, arrows, fractions, text
```

## Coordinate systems

Musical values map to world space (`renderer-config.js:12-19`):

```javascript
// Time → X
worldX = seconds * 200 * xScaleFactor          // scales.secondsToWorldX = 200

// Frequency → Y, logarithmic (so an octave is always the same height)
worldY = log2(baseFreq / freq) * 100 * yScaleFactor   // scales.freqToWorldY = 100
```

A note's vertical **centre** sits on that line, not its top edge. The top-left is derived as
`centerAnchorWU - heightWU / 2` (defaults 10 and 22). This is why changing note height makes notes
thinner or thicker *about their own frequency* instead of drifting off it.

The camera supplies a 2-D affine basis `(a, b, c, d, e, f)` mapping world → screen CSS pixels.
`RendererAdapter.updateViewportBasis(raw)` installs it; `camera.screenToWorld()` maps page CSS
pixels back to world. (The camera's `worldToScreen()` is **not** its exact inverse — see
[Camera Controller](/developer/rendering/camera-controller#coordinate-conversion).)

## RendererAdapter

The real surface (`src/renderer/webgl2/renderer.js`):

```javascript
class RendererAdapter {
  constructor(config = null)          // normalized against defaultRendererConfig
  init(containerEl)                   // creates the canvas + GL context, starts the rAF loop
  destroy()

  sync({ evaluatedNotes, module, xScaleFactor, yScaleFactor,
         selectedNoteId = null, tempOverrides = null })

  updateViewportBasis(raw)            // {a,b,c,d,e,f} from the camera
  setConfig(partial)                  // deep-merged into the config
  setThemeColors(colors)              // accent, noteBorder, measureBar, rings, dep colours
  setPlayhead(timeSec)
  setScaleFactors(x, y)
  setDrawNoteArrows(enabled)

  setMultiSelection(ids)  getMultiSelection()
  setMarqueeRect(rect)    pickRect(x0, y0, x1, y1)

  pickAt(clientX, clientY, expandCssPx = 2)
  pickAllAt(clientX, clientY, expandCssPx = 2)
  pickStackAt(clientX, clientY, expandCssPx = 2)
  hitTestSubRegion(clientX, clientY)

  setTempOverridesPreviewMap(map)     setDragOffsetPreview({ dxWorld, dwWorld, noteIds, anchorId })
  setMeasurePreviewMap(map)           setModuleEndPreviewSec(sec)
}
```

There is no `render()`, no `resize()`, no `dispose()` — the frame loop is internal and started by
`init()`.

## Shader programs

**22 programs**, all GLSL ES 3.00. If you write a shader here, it must start `#version 300 es` and
use `in` / `out` / `layout(location=…)`. There is not a single `gl_FragColor` in the file — a
WebGL 1 snippet will fail to compile.

| Program | Draws |
|---|---|
| `rectProgram` | note bodies (the one that scales with N) |
| `rectBorderProgram`, `borderOnlyProgram` | note borders |
| `selectionRingProgram`, `selectionFillProgram` | selection and dependency-highlight rings |
| `tabMaskProgram` | the pull-tab region |
| `silenceDashRingProgram`, `silenceVLineProgram` | silences |
| `measureDashProgram` | measure bars |
| `measureTriProgram`, `measureTriOutlineProgram` | measure triangles |
| `baseCircleProgram` | the BaseNote circle |
| `octaveLineProgram`, `octaveLineInstProgram` | octave guide lines |
| `playheadProgram` | the playhead |
| `linkLineProgram` | dependency link-lines |
| `marqueeProgram` | the multi-select marquee |
| `textProgram`, `atlasTextProgram` | text (canvas textures, and the glyph atlas) |
| `solidCssProgram`, `textCircMaskProgram`, `solidCssCircMaskProgram` | overlay fills and circular masks |

## Instance buffers

Per-instance attributes on the note-body program:

```glsl
layout(location=0) in vec2  a_unit;          // the unit quad
layout(location=1) in vec4  a_posSize;       // (x, y, w, h) in world units
layout(location=2) in vec4  a_color;         // RGBA
layout(location=3) in vec2  a_noteSize;      // CSS px (deprecated, kept for compatibility)
layout(location=5) in float a_flags;         // 1.0 = silence
layout(location=6) in float a_dragFlag;      // 1.0 = apply u_dragOffset
layout(location=7) in float a_corruptionType;// 0 = clean, 1 = transitive, 2 = direct
```

Note that `a_corruptionType` is a **float with three states**, not a bitmask. The `CORRUPT` bitmask
from `binary-note.js` never reaches the GPU; it is collapsed CPU-side inside `sync()` into this
one value.

| Value | Meaning | Visual |
|---|---|---|
| `0.0` | clean | none |
| `1.0` | transitively corrupted (depends on something irrational) | single 45° diagonal hatch |
| `2.0` | directly corrupted (irrational, no corrupt dependency) | crosshatch |

## `sync()` — the per-edit rebuild

`sync()` (`renderer.js:589`) rebuilds every instance array, rebuilds `_noteIdToIndex`, computes the
corruption types, and uploads.

The corruption scan inside `sync()` used to be the dominant cost of a commit — a transitive BFS per
note, O(N²) on deep chains. It is now one multi-source BFS over the *dependents* graph, seeded by
the corrupt set: O(N+E), and a complete no-op when nothing is corrupt, which is the common case
(`renderer.js:823-898`). [Performance](/developer/performance) tells the full before/after story.

::: warning `sync()` has no per-note dirty tracking
It reallocates the CPU-side `Float32Array`s for **all N notes** and re-uploads them wholesale with
`gl.bufferData(..., gl.DYNAMIC_DRAW)` — 151 `bufferData` call sites against 4 `bufferSubData`. There
is no double-buffering and no partial upload. This is why `sync()` is 63 ms p50 at 100k notes, and it
is the biggest remaining performance item.
:::

## The frame

`_render()` starts with:

```javascript
if (!this.needsRedraw) return;
this.needsRedraw = false;
```

The rAF loop always ticks (`renderer.js:501-505`), and so does `player.js`'s own loop. What is gated
is the **body** of `_render()`. On an idle canvas, that gate holds and the frame costs **zero draw
calls** — verified at 5k, 20k and 100k notes (0 of 100 frames redrawn).

Two guards make the gate real, and both are load-bearing:

- **`setPlayhead()`** (`renderer.js:1262`) returns early when the time did not change. `player.js`
  calls it every frame whether playing or not; dirtying unconditionally kept `needsRedraw`
  permanently true.
- **`updateViewportBasis()`** (`renderer.js:551-555`) returns early on an unchanged basis.
  `player.js`'s rAF pushed a camera update every frame (to release the tracking X-lock), which bumped
  `_viewEpoch` 60×/s on a perfectly still canvas and invalidated every view-keyed cache.

### Epochs

Caches are keyed on epochs. Get these wrong and you will ship a stale frame.

| Epoch | Bumped by | Guards |
|---|---|---|
| `_viewEpoch` | a real camera basis change (pan/zoom) | zoom-dependent screen-space buffers, measure bars, glyph runs |
| `_posEpoch` | every `sync()` | glyph runs (text holds *absolute* CSS positions, so it goes stale when notes move), tab/arrow regions |
| `_sceneEpoch` | end of `sync()` | overlay passes; part of the link-tree cache key |
| `_dragEpoch` | every pointermove of a drag | glyph runs, dependency-line endpoints |

A drag deliberately does **not** bump `_posEpoch` — rebuilding link-line endpoints for thousands of
dependents on every pointermove is too expensive, and the moving notes are shifted on the GPU via
`u_dragOffset` rather than in `posSize`. But the drag **anchor's** `posSize` *is* rewritten on the CPU
each move, so anything derived from absolute positions genuinely does go stale. `_dragEpoch` is that
signal.

### Viewport culling

The per-note overlay loop — pull tab, interval arrows, fraction divider, silence band, and all of a
note's text runs — is culled against the viewport (`renderer.js:6847-6878`). Every overlay is
scissored to that note's own rect, so a note entirely off-canvas cannot produce a single pixel; the
cull is *exact*, not an approximation, which is why the picture stays pixel-identical.

```javascript
cullPadX = 2 + (dragActive ? |m[0]·dragOffsetX| + |m[0]·dragOffsetW| : 0)
```

The horizontal bound is widened during a drag because moving notes are offset on the *GPU*, not in
`posSize`; without the slack, a note dragged in from off-screen would arrive with no overlays. Drags
only shift x and width, so the vertical bound needs no slack.

**Note bodies are not culled** — they are one instanced draw regardless of how many are on screen.

### Batched rings

`_drawRingIdxList()` (`renderer.js:2548`) is the one remaining per-instance loop that could approach
O(N): it fires when a hub note with ~1000 dependents is selected.

- **No drag active:** `u_dragOffset` is `(0,0)` for every ring, so the whole bucket shares identical
  uniforms. The indices are gathered into one reused buffer and drawn in **one** instanced call —
  999 draws collapse to 6. Pixel-identical: the ring shader reads only `a_posSize` per instance.
- **Drag active:** per-instance drag offsets differ (moving vs anchor vs static), so the exact
  per-instance loop is kept for correctness.

## Dependency highlights

![Dependency lines radiating from a selected note, colour-coded by property](/img/dependency-lines.png)

Selecting a note lights up its relatives, colour-coded by **which property** of the selected note
would move them (`renderer.js:2760-2818`):

| Property | Colour | RGBA (dependency / dependent) |
|---|---|---|
| frequency | orange | `[1.0, 0.5, 0.0, 0.9]` / `[…, 0.4]` |
| startTime | teal | `[0.0, 1.0, 1.0, 0.9]` / `[…, 0.4]` |
| duration | purple | `[0.615, 0.0, 1.0, 0.9]` / `[…, 0.4]` |

Ring thickness carries the direction: the **dependency** ring (what the selected note depends on) is
`ringThicknessPxAtZoom1 × 1.5` = 3 px; the **dependent** ring is `× 1.0` = 2 px. Draw order is
startTime → frequency → duration, so overlapping relationships all stay visible.

During a drag the property being edited stays at full brightness and the other two dim to alpha
`0.15` / `0.08` — a move dims frequency and duration, a resize dims frequency and startTime.

::: warning The dependency colours are not themeable today
Every theme preset defines `depFrequency` / `depStartTime` / `depDuration`, `themeManager` passes them
to `renderer.setThemeColors()`, and the renderer stores them on `this._themeColors`
(`renderer.js:363-365`) — but **nothing reads them back**. Every draw path uses the hard-coded
literals above (`renderer.js:2774-2792`, `5396-5404`). Switching theme does not change a dependency
ring or link-line colour. Do not document these tokens as working.
:::

## Camera

`CameraController` (`src/renderer/webgl2/camera-controller.js`) owns pan, zoom and pinch. It
installs its own pointer and wheel listeners on the workspace container and hands the renderer the
affine basis above; pan and zoom are **not public methods** — the whole surface is six methods
(`getBasis`, `screenToWorld`, `worldToScreen`, `setInputEnabled`, `setSingleFingerPanEnabled`,
`destroy`).

Zoom is smooth and exponential (factor `exp(-deltaY * 0.0015)`), always around the pointer or the
pinch centre, clamped to scale `0.1`–`10.0`. Ctrl/⌘+wheel drives the *same* camera zoom — browser
page-zoom is suppressed app-wide — which is also what makes trackpad pinch work for free. On touch,
a second finger always wins over any other gesture, and lifting one finger mid-pinch hands over to
pan with no jump. `lockX` is playhead-tracking mode: horizontal panning is suppressed and zoom
re-centres on the container's mid-X, so the view does not drift sideways while following the
playhead. On container resize, the camera keeps the world point that was at the viewport centre at
the new centre.

The field defaults, the gesture table, and the input-gating that lets note drags coexist with
camera gestures on touch are in [Camera Controller](/developer/rendering/camera-controller).

## Picking is 100% CPU

::: warning GPU picking is not shipped
`src/renderer/webgl2/picking.js` is a self-described scaffold: *"No draw integration yet."* It is
**imported by nothing** — never constructed, never initialized, not bundled — so the FBO it would
allocate never exists. `Workspace.pickAt()` goes straight to `renderer.pickAllAt()`. Do not
document or build on it.
:::

The live path:

- `RendererAdapter.pickAllAt()` (`renderer.js:9109`) — measure triangles (top) → base circle → the
  note stack. Returns hits top-most first.
- `RendererAdapter.pickAt()` (`renderer.js:3363`) — a **reverse linear scan** over `_instanceNoteIds`
  (last-drawn is top-most), a fast world-space AABB reject, then a precise **rounded-rect** test so
  the corners of a note are not selectable.
- `hitTestSubRegion()` (`renderer.js:3426`) — which *sub-region* was hit (pull tab, arrow column).
  Only runs once a note body is hit, and respects the rounded interior.

There is **no spatial index**, and measurement says none is warranted: `pickAt` is **0.017 ms at 5,000
notes and 0.314 ms at 100,000**.

## Configuration

Every geometry constant lives in `defaultRendererConfig` (`renderer-config.js`) and is deep-merged by
`setConfig(partial)`. The keys that define the coordinate mapping:

| Key | Default | Unit |
|---|---|---|
| `scales.secondsToWorldX` | `200` | world units / second |
| `scales.freqToWorldY` | `100` | world units / log2 ratio |
| `note.heightWU` | `22` | world units |
| `note.centerAnchorWU` | `10` | world units |

The full key-by-key table — borders, overlays, selection rings, measure dashes, the text and
glyph-atlas settings — is in
[WebGL2 Renderer](/developer/rendering/webgl2-renderer#runtime-configuration).

`appearance.note.heightWU`, `borderPxAtZoom1` and `roundedCornerPxAtZoom1` are exposed in
Settings → Appearance and reach the renderer through `themeManager` →
`renderer.setConfig()`. See [Theming](/developer/theming).

The glyph atlas can be forced on or off with `?atlas=1` / `?atlas=0` or the `rmt:atlas`
localStorage key. It defaults **on**.

## Rules for changing the renderer

The renderer used to rebuild everything every frame, which hid at least six real bugs — an
arrow-region buffer clobbered by the hover overlay, an upload gated on an epoch pair that could not
change during a drag, a text cache not keyed on note position. They only surfaced once redraws were
gated. Assume any new cache will unmask another one.

So: **measure and pixel-diff every renderer change. Never eyeball it.** At minimum, run
`node scripts/perf/converge.mjs` (does **one** redraw produce the final image?) and
`node scripts/perf/visual-regress.mjs --capture` / `--compare` against a running dev server, always
passing `--url http://localhost:3000` — several harness scripts default to the wrong port. Expect a
small nonzero diff: MSAA sample resolution is not bit-deterministic across runs, which is why
`visual-regress.mjs` defaults to a 300-pixel tolerance.

The full harness — per-pass profiling, drag and pick benches, `who-dirties.mjs` — is documented in
[Performance](/developer/performance#the-benchmark-harness), and the verification workflow in
[WebGL2 Renderer](/developer/rendering/webgl2-renderer#verifying-a-change).

## See also

- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) — the full `RendererAdapter` reference
- [Camera Controller](/developer/rendering/camera-controller)
- [Picking](/developer/rendering/picking)
- [Performance](/developer/performance) — the benchmark harness and the measured numbers
- [Theming](/developer/theming) — how colours and geometry reach the canvas
