---
title: Picking
description: How a click becomes a note in RMT Compose — an indexed CPU hit test against rounded note rectangles, plus the unused GPU picking scaffold and why it stays unused.
---

# Picking

This page explains how a pointer position becomes a note, a measure triangle, or the BaseNote —
which methods run, in what order, and what each one costs. If you are changing hit-testing or
selection, start here.

::: warning GPU picking does not ship
`src/renderer/webgl2/picking.ts` describes itself as a scaffold: *"This is a scaffold. No draw
integration yet — `readAt()` will typically return null."* The file remains on disk but is
**imported by nothing** — it is never constructed or initialized, it is not in the bundle, and the
canvas-sized FBO it would allocate never exists. (`Workspace` keeps a `this.picking` slot; it
stays `null`.)

The workspace resolves point and rectangle hits on the CPU.
:::

## What actually runs

```javascript
const hit = workspace.pickAt(clientX, clientY);        // top-most hit, or null
// -> { type: 'note' | 'measure' | 'base' | 'reference', id: number }

const stack = workspace.pickStackAt(clientX, clientY); // every hit, top-most first
```

`Workspace.pickAt()` returns the first hit from `RendererAdapter.pickTopAt()`. The first click with
no previous selection needs only that hit. To cycle through overlaps, the workspace can request
the complete stack from `RendererAdapter.pickAllAt()`.

Both paths use the same priority, in order.

1. Measure triangles use a barycentric point-in-triangle test in CSS pixels, in reverse draw order.
2. The BaseNote uses a circle-radius test in CSS pixels.
3. Notes use the indexed rounded-rectangle test described below.
4. Reference lines respond within four CSS pixels of their drawn height, starting at their drawn left edge.

### `RendererAdapter.pickAt(clientX, clientY, expandCssPx = 2)`

`InstanceRanges` indexes blocks of 64 consecutive draw slots by their world-space extents on both
axes. The renderer queries the pointer bounds with the requested tolerance, visits candidate
ranges backwards, and checks individual note bounds and rounded corners. `pickAt()` returns on
the first hit. `pickStackAt()` collects every matching note. Scores with fewer than 512 instances
and active geometry previews use the same exact test over the instance array.

Three details matter:

- **Reverse order.** `sync()` writes the selected note last, so the instance arrays are already in
  draw order and iterating backwards yields the top-most hit first. No depth sort at pick time.
- **The precise test is a rounded-rect SDF**, the same one the body shader uses
  (`_isPointInsideRoundedNote`). An AABB alone would let you select a note by
  clicking the empty pixels in its rounded corner.
- **`expandCssPx` only applies along straight edges.** Inside the corner arcs the tolerance is
  dropped entirely — otherwise the expansion would reintroduce exactly the corner-selection artifact
  the SDF exists to prevent.

A selection swap refreshes the bounds of both affected blocks.

### `hitTestSubRegion(clientX, clientY)`

The result identifies which part of a note was hit.

```javascript
// -> { id, region } where region is 'body' | 'tab' | 'octaveUp' | 'octaveDown'
```

Hover reuses one note probe for the note ring, mixed hit and subregion. A note whose controls
are hidden in the current overview returns `body`. Visible controls use the following regions.

- **Pull tab** — a full-height band on the inner right,
  `max(10, round(noteHeightCss * overlays.tabWidthFactor) - border)` px wide.
- **Arrow columns** — on the inner left, split into upper/lower halves with a 0.5 px dead zone
  around the midline so a click on the centre reads as `body`. They are **gated on
  `drawNoteArrows`**: turning arrows off in Settings removes their click zones too, so there are no
  invisible hit regions left behind. The region names are still `octaveUp` / `octaveDown`, but the
  arrows apply whatever interval is configured under **Settings → Arrows** (default 2/1) — the names
  are historical.
- **Silence notes report no arrow regions** at all.

### `pickRect(x0, y0, x1, y1)` — the marquee

The workspace tracks Shift + pointer movement even when the pointer starts over a note body or measure handle. A stationary Shift-click toggles one item. A 500 ms touch hold on an item toggles it and arms a marquee at the same origin. Subsequent taps toggle group members.

`pickRectIds()` returns the intersected IDs. `pickRect()` labels each result as `measure` or `note`.

- **Measures.** `_measureRectHits()` tests the triangle in canvas CSS pixels. It compares the rectangle with the widest horizontal slice of the triangle within their vertical overlap. The dashed vertical bar line has no hit area. Ordered triangles allow a binary search for the first candidate.
- **Notes and silences.** The renderer transforms the selection rectangle to world coordinates, queries candidate instance ranges, and checks rectangle overlap against each instance. Skimming a rounded corner still counts.
- **BaseNote and reference lines.** Neither supplies a selectable rectangle or triangle. The note instance pass also excludes ID 0.

See [Selection](/user-guide/notes/selection) for the gestures.

## Instance indices go stale

A note keeps its ID across a sync. Its instance slot can change when the current selection moves
to the end of the draw list. Full sync rebuilds the ID-to-slot map. Incremental sync updates the
existing map and repairs the index bounds for the slots it changed. Consumers holding an instance
slot across a sync must resolve it again.

## Performance

Run `node scripts/perf/bench-dense-playback.mjs 500000 http://localhost:3000 short --pointer` against
a running dev server. During playback, the driver sweeps real mouse events over notes and empty
space, records event durations and frame times, checks scheduled audio starts, and clicks through
overlapping notes. `scripts/perf/bench-pick.mjs` measures isolated note queries.

With 500,000 notes visible, one 80-event sweep over notes and another over empty space each
measured 0.1 ms at the 95th percentile in headless Edge. Frame intervals measured 8.4 ms at
the 95th percentile and every scheduled note was scheduled ahead of its deadline. Three clicks
advanced through a 695-note stack. Hardware, score layout, and pointer location affect these timings.

## The scaffold, for the record

If you do pick the GPU path back up, the existing class is close to correct but its API is not what
the old docs claimed:

```javascript
const picking = new Picking();              // NO arguments
picking.init(gl, canvasForCoords);          // sizes itself from the canvas rect x DPR
picking.resizeFromCanvas(canvasForCoords);  // NOT resize(w, h)
const hit = picking.readAt(clientX, clientY);  // -> { type: 'note', id } or null
picking.destroy();
```

- It allocates an RGBA8 colour texture plus a `DEPTH_COMPONENT16` renderbuffer, and checks
  `FRAMEBUFFER_COMPLETE`.
- `begin()` stashes the previous FBO binding, viewport, and the blend/depth/scissor enables, then
  disables blending, enables depth, disables scissor, and clears to transparent black (id 0 = no
  hit). `end()` restores all of it.
- ID encoding is **little-endian across the channels**:
  `_encodeId24(id) → [id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF]` and
  `_decodeId24(r, g, b) → r | (g << 8) | (b << 16)`. R is the **low** byte, not the high one. 24 bits,
  so ids 1–16,777,215.
- What is missing is the draw integration: an ID pass that renders the note instances with their
  encoded ids, and a shader to do it. Any such shader must be **GLSL ES 3.00**
  (`#version 300 es`, `layout(location=…) in`, `out vec4`) — this is a WebGL2 renderer and a WebGL1
  `attribute` / `gl_FragColor` shader will not compile.
- Also note `readAt()` would be a synchronous `readPixels` — a GPU stall on the main thread. At the
  pointer frequencies, that stall would share the audio scheduler’s main thread.

## See also

- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) — the instance arrays picking reads
- [Camera Controller](/developer/rendering/camera-controller) — the basis behind `RendererAdapter.screenToWorld()`, which every pick starts with
- [Selection](/user-guide/notes/selection) — marquee, shift-click, and stack cycling
- [Workspace](/user-guide/interface/workspace) — the gestures from the user's side
