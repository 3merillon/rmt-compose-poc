---
title: Picking
description: How a click becomes a note in RMT Compose — a CPU rounded-rect scan over the instance arrays, plus the unused GPU picking scaffold and why it stays unused.
---

# Picking

This page explains how a pointer position becomes a note, a measure triangle, or the BaseNote —
which methods run, in what order, and what each one costs. If you are changing hit-testing or
selection, start here.

::: warning GPU picking does not ship
`src/renderer/webgl2/picking.js` describes itself as a scaffold: *"This is a scaffold. No draw
integration yet — `readAt()` will typically return null."* Nothing in the codebase ever draws into
the picking framebuffer. `Picking.begin()` and `Picking.end()` have **zero call sites**, and
`_encodeId24` is annotated "Not used yet".

It is also unreachable. `Workspace.pickAt()` tries `renderer.pickAllAt()` **first**, and that method
always exists — so the GPU branch below it can never run.

**All picking is CPU-side.** That is not a stopgap: it costs **0.31 ms per call at 100,000 notes**,
which is why no one has finished the GPU path.
:::

## What actually runs

```javascript
const hit = workspace.pickAt(clientX, clientY);        // top-most hit, or null
// -> { type: 'note' | 'measure' | 'base', id: number }

const stack = workspace.pickStackAt(clientX, clientY); // every hit, top-most first
```

`Workspace.pickAt()` delegates straight to `RendererAdapter.pickAllAt()` and takes the first entry.
`pickStackAt()` takes the whole list.

### `pickAllAt(clientX, clientY, expandCssPx = 2)`

The mixed-type entry point (`renderer.js:9109`). It concatenates three probes, in visual top-to-bottom
order:

1. **Measure triangles** — `pickTrianglesAt()`, a barycentric point-in-triangle test against cached
   CSS-space triangles. Triangles sit on top of notes visually, so they are probed first.
2. **The BaseNote circle** — `pickBaseCircleAt()`, a radius test against the cached circle.
3. **Notes** — `pickStackAt()`, the rounded-rect scan below.

Measure bars and the BaseNote **are** pickable. Any code that assumes a hit is a note will
mis-handle a click on a measure triangle.

### `pickAt(clientX, clientY, expandCssPx = 2)` — the note scan

`RendererAdapter.pickAt()` (`renderer.js:3363`) walks the **instance arrays**, not `module.notes`:

```javascript
for (let i = N - 1; i >= 0; i--) {   // reverse: last-drawn is top-most
  // 1. cheap AABB reject in world units, expanded by expandCssPx converted to WU
  if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) continue;
  // 2. precise rounded-rect containment
  if (this._isPointInsideRoundedNote(i, p.x, p.y, expandCssPx)) return { type: 'note', id };
}
return null;
```

Three details matter:

- **Reverse order.** `sync()` writes the selected note last, so the instance arrays are already in
  draw order and iterating backwards yields the top-most hit first. No depth sort at pick time.
- **The precise test is a rounded-rect SDF**, the same one the body shader uses
  (`_isPointInsideRoundedNote`, `renderer.js:3308`). An AABB alone would let you select a note by
  clicking the empty pixels in its rounded corner.
- **`expandCssPx` only applies along straight edges.** Inside the corner arcs the tolerance is
  dropped entirely — otherwise the expansion would reintroduce exactly the corner-selection artifact
  the SDF exists to prevent.

There is **no spatial index**, and none is warranted: see the numbers below.

### `hitTestSubRegion(clientX, clientY)`

Resolves *which part* of a note was hit (`renderer.js:3426`):

```javascript
// -> { id, region } where region is 'body' | 'tab' | 'octaveUp' | 'octaveDown'
```

It calls `pickAt()` first, so it inherits the rounded-rect interior and only runs when a note body is
genuinely hit. Then:

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

`renderer.js:1452`. The multi-select hit test (shift+drag on desktop, 500 ms long-press on touch).

- Selects by **intersection**, not containment — any overlap with the rectangle counts.
- **AABB only.** No rounded-rect refinement: a rubber band that skims a corner should still catch the
  note.
- **The BaseNote (id 0) is structurally excluded** (`if (id === 0) continue`), and measure bars are
  never returned. A measure's `startTime` is its link in the measure chain, so a group move could
  neither re-anchor it (that reflows the grid under the whole score) nor leave it behind (the group
  tears on drop).

See [Selection](/user-guide/notes/selection) for the gestures.

## Instance indices go stale

Ids are stable across a `sync()`. **Instance indices are not.** `sync()` mints a brand-new
`_noteIdToIndex` Map and reorders instances (the selected note moves to the end so it draws on top).
Any cached index silently starts pointing at a *different note*.

This is why `_resolveMultiSelIndices()` re-derives the multi-selection's index cache after every
rebuild of `_noteIdToIndex`, and why `_ensureMultiSelIndices()` compares the **Map identity** it was
built from before trusting the cache. If you cache an instance index anywhere, key it on the Map
identity or re-resolve it on every sync.

## Performance

Measured with `node scripts/perf/bench-pick.mjs --url http://localhost:3000`, headless Chromium with
a real GPU:

| Module | Notes | `pickAt` | `pickStackAt` | `hitTestSubRegion` |
|---|---|---|---|---|
| `voices-5000` | 5,000 | 0.017 ms | 0.018 ms | 0.017 ms |
| `voices-100000` | 100,000 | **0.314 ms** | 0.351 ms | 0.318 ms |

A linear scan of 100,000 notes costs a third of a millisecond — about 2% of a 16.6 ms frame, on a
path that runs at most once per pointermove. Hover at 100k notes still holds 60 fps end to end.

Neither a spatial index nor a GPU ID pass would buy anything a user could perceive, and both would
add a cache to keep in step with `sync()`. That is the whole reason `picking.js` was never finished.

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
  measured CPU cost above, that trade is not obviously a win.

## See also

- [WebGL2 Renderer](/developer/rendering/webgl2-renderer) — the instance arrays picking reads
- [Camera Controller](/developer/rendering/camera-controller) — the basis behind `RendererAdapter.screenToWorld()`, which every pick starts with
- [Selection](/user-guide/notes/selection) — marquee, shift-click, and stack cycling
- [Workspace](/user-guide/interface/workspace) — the gestures from the user's side
