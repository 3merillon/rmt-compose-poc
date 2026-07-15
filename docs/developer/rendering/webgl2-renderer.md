---
title: WebGL2 Renderer
description: How RendererAdapter draws the whole score in one WebGL2 canvas — the instanced passes, sync(), the corruption scan, the glyph atlas, and the redraw gate.
---

# WebGL2 Renderer

`RendererAdapter` (`src/renderer/webgl2/renderer.js`) draws the entire score — note bodies,
selection rings, measure bars, octave guides, dependency lines, and all text — into a single
WebGL2 canvas. There is no DOM element per note.

The pipeline is **instanced**. Every visual class that scales with note count is uploaded once
into per-instance typed arrays and drawn with **one `drawArraysInstanced` call**, not one call
per note. The file issues 53 `drawArraysInstanced` calls across all its passes and **zero**
`drawElements` — there is no index buffer anywhere, so there is no 16-bit instance cap.

The renderer is a passive drawing surface. It owns no interaction state: `Workspace`
(`src/renderer/webgl2/workspace.js`) feeds it a camera basis and preview state, and `player.js` feeds
it evaluated notes.

## Lifecycle

```javascript
import { RendererAdapter } from './renderer/webgl2/renderer.js';

const renderer = new RendererAdapter();     // optional partial config
const ok = renderer.init(containerEl);      // false if WebGL2 is unavailable
// ...
renderer.destroy();
```

| Member | Notes |
|---|---|
| `constructor(config = null)` | Takes a **partial renderer config**, deep-merged over `defaultRendererConfig`. It does **not** take a canvas or a GL context. |
| `init(containerEl)` | Creates the canvas and the GL context itself, compiles 22 programs, builds the glyph atlas, starts the rAF loop. Returns `true`, or `false` if `getContext('webgl2')` fails. |
| `destroy()` | Cancels the rAF loop, disconnects the `ResizeObserver`, removes the window listeners, and detaches the canvas. |

`init()` appends its own canvas to `document.body` with `position: fixed`, `pointer-events: none`
and `z-index: 1004`, then mirrors `containerEl`'s bounding rect onto it on every resize and scroll.
The canvas is fixed rather than a child of the container so it escapes the workspace's transformed
stacking contexts; it is non-interactive because all hit testing is CPU-side against the instance
arrays. The GL context is created with `{ alpha: true, antialias: true, premultipliedAlpha: true }`
— the `antialias: true` matters later (see [Verifying a change](#verifying-a-change)).

Backing-store size is DPR-driven and internal (`_resizeCanvasToDisplaySize()`). There is no
`resize(width, height)` method.

## The frame loop and the redraw gate

The rAF loop always ticks. What is gated is the work inside it:

```javascript
// renderer.js:501
const loop = () => {
  this._render();
  this.animHandle = window.requestAnimationFrame(loop);
};
```

An **idle canvas issues zero draw calls**. This does not mean rAF is descheduled — both this loop
and `player.js`'s own loop keep running every frame. What is gated is the body of `_render()`.

`_render()` is assembled by prototype wrapping. The class defines the base pass; three IIFEs at the
bottom of the file wrap it in turn. The outermost wrapper is the one that matters:

```javascript
// renderer.js:10725 — the gate
const _prevRender = proto._render;
proto._render = function () {
  if (!this.needsRedraw) return;
  _prevRender.call(this);
  try { this._renderDependencyLinesAndDragOverlay(); } catch {}
};
```

::: warning The overlay passes are not frame-idempotent
The innermost `_render()` has *always* early-returned on `!this.needsRedraw` (`renderer.js:2663`),
but that alone was never enough. The passes layered on top of it by the wrappers — note overlays,
measure bars, dependency lines, marquee — were called **unconditionally**, so an idle frame still
paid the full per-note cost of every one of them and re-blended their output onto an uncleared
canvas. Measured before the outer gate landed: **46 ms/frame at 5k notes, 1034 ms/frame at 100k**,
with the picture on screen never changing.

If you add a pass, add it **inside** the gate, and assume it is *not* safe to run twice on the same
frame. The marquee wrapper (`renderer.js:10877`) has to snapshot `needsRedraw` *before* delegating
and bail if it was false, precisely because re-blending a translucent rectangle over itself darkens
it.
:::

Two change-guards are what make the gate actually effective. Both are load-bearing; removing either
silently pins `needsRedraw` to `true` forever and you get the old always-redraw behaviour back with
no visible symptom:

| Guard | Why |
|---|---|
| `setPlayhead()` — `if (t === this.playheadTimeSec) return;` (`renderer.js:1262`) | `player.js` calls this from its rAF loop on **every** frame, playing or not. |
| `updateViewportBasis()` — unchanged-basis early return (`renderer.js:551-555`) | `player.js`'s rAF loop pushes a camera update every frame to release the tracking X-lock. Without the guard `_viewEpoch` was bumped 60×/s on a still canvas, invalidating every view-keyed cache. |

Every mutation that can change the image sets `needsRedraw`; no render pass sets it. So the gate
cannot drop a frame that matters, and it cannot spin.

### Epochs

Caches are keyed on monotonic epoch counters rather than on booleans, so a cache can tell *what*
changed. Get these right — they are subtle, and the per-frame rebuild used to hide the mistakes.

| Epoch | Bumped by | Guards |
|---|---|---|
| `_viewEpoch` | Any real camera basis change; canvas resize; `setThemeColors()`; `setDrawNoteArrows()` | Zoom-dependent screen-space buffers, measure bars, glyph runs |
| `_posEpoch` | Every `sync()` (at the **start**); the preview setters (`setTempOverridesPreview*`, `setMeasurePreviewMap`, `setProspectiveParentId`) | Glyph runs (text holds *absolute* CSS positions, so it goes stale when notes **move**, not only when its content changes); tab/arrow regions |
| `_sceneEpoch` | End of `sync()` | Overlay passes; part of the link-tree cache key |
| `_dragEpoch` | Every pointermove of a drag | Glyph runs and dependency-line endpoints |
| `_colorEpoch` | `setThemeColors()` | Canvas-textured labels baked in the old accent |

`_dragEpoch` exists because a drag deliberately **does not** bump `_posEpoch`: rebuilding link-line
endpoints for thousands of dependents on every pointermove is too expensive, so moving notes are
shifted on the GPU via `u_dragOffset` instead. But the **anchor's** `posSize` *is* rewritten on the
CPU each move, so anything derived from absolute positions really does go stale. `_dragEpoch` is
that signal.

## `sync()` — the per-edit rebuild

```javascript
renderer.sync({
  evaluatedNotes,      // Map or object: id -> evaluated note
  module,
  xScaleFactor,
  yScaleFactor,
  selectedNoteId = null,
  tempOverrides = null
});
```

This is the only entry point that takes the module; it caches a `_moduleRef` for the on-the-fly
lookups the link-line pass needs mid-drag. It rebuilds the instance arrays (`posSize`, `colors`,
silence flags, corruption types, fraction label strings), rebuilds `_noteIdToIndex`, recomputes the
dependency-highlight index sets, and uploads to the GPU.

`sync()` runs on every re-evaluation of the module — a commit, an import, a module load — and on a
selection change (the selected note moves to the end of the instance arrays so it draws on top). A
drag does **not** call it: moving notes are offset on the GPU via `setDragOffsetPreview()`, and
`sync()` runs once on the drop.

`sync()` is the renderer's real cost centre — not drawing. At 100,000 notes a full redraw is
**~4.3 ms** but `sync()` is **~63 ms (p50)**. Panning and idling a 100k module is 60 fps; *editing*
one is not interactive. Incremental sync (stable slots, `bufferSubData` bookkeeping) is not
implemented.

### The corruption scan — O(N+E)

Corruption is **not** a bitmask and it never reaches a shader as one. `sync()` computes a 3-value
enum per note into `_corruptionType`, a `Float32Array` bound as instance attribute 7:

| Value | Meaning | Drawn as |
|---|---|---|
| `0.0` | clean | nothing |
| `1.0` | **transitive** — depends on something corrupt | single 45° diagonal hatch |
| `2.0` | **direct** — corrupt, with no corrupt dependency | crosshatch |

The scan (`renderer.js:823-898`) used to call `depGraph.getAllDependencies(noteId)` — a full
transitive BFS — **for every note on every sync**, so cost scaled with dependency *depth*: 28.5 ms
for `chain-1000` (depth 1000) against 1.4 ms for `fan-1000` (depth 1) at identical note counts.

The fix inverts the question. Because `dependents` is the maintained inverse of `dependencies`:

> *i* transitively depends on corrupt *C*  ⟺  *i* is a transitive dependent of *C*

So **one multi-source BFS over the dependents graph, seeded by the corrupt set**, answers it for
every note at once — O(N+E). The corrupt set is empty in the overwhelmingly common case, and
`_corruptionType` is zero-filled first, so a clean module does **no work at all**.

The old per-note logic is retained verbatim as a fallback branch (`renderer.js:871`) for graph
objects that lack `getCorruptedNotes` / `getDependents`.

See [Dependency Graph](/developer/core/dependency-graph) for the graph itself, and
[Dependencies](/user-guide/notes/dependencies) for what the hatching means to a user.

## Instance attributes

These are the attribute slots on the shared note VAO. The note-body program (`rectBorderProgram`)
declares 0, 1, 2, 3, 5, 6 and 7; slot 4 belongs to the tab/arrow overlay programs and rides on the
same VAO. Note that `a_flags` is **silence**, not corruption:

| Loc | Name | Type | Meaning |
|---|---|---|---|
| 0 | `a_unit` | `vec2` | Unit quad, divisor 0 (not per-instance) |
| 1 | `a_posSize` | `vec4` | `(x, y, w, h)` in world units |
| 2 | `a_color` | `vec4` | RGBA note body colour (per-note user data) |
| 3 | `a_noteSize` | `vec2` | CSS px size — **deprecated**, derived in-shader from `u_scale` |
| 4 | `a_tabRegion` | `vec4` | Note-local CSS px region, shared buffer; enabled per pass via `_setAttr4Enabled()` |
| 5 | `a_flags` | `float` | `1.0` = silence, `0.0` = normal |
| 6 | `a_dragFlag` | `float` | `1.0` = apply `u_dragOffset` |
| 7 | `a_corruptionType` | `float` | `0` = none, `1` = transitive, `2` = direct |

All flag attributes are declared `in float` and uploaded as `Float32Array`. Attribute 4 is shared
across programs on one VAO and must be disabled during the body pass and re-enabled afterwards
(an ANGLE/D3D safety measure) — `_setAttr4Enabled()`, `renderer.js:1529`.

## Passes, in draw order

There are 22 GL programs. The order below is the flattened wrapper chain; nothing is drawn before
the clear, and octave guides are drawn **late**, not first.

1. Clear (colour + depth)
2. **Note bodies** — one `drawArraysInstanced` for the whole score (`renderer.js:2751`)
3. Dependency-highlight rings, then the multi-selection ring — `_drawRingIdxList()`
4. Selection ring / fill wash, hover ring
5. Playhead

Everything below is added by the prototype wrappers at the bottom of the file:

6. **Note overlays** — tab masks, pull tab, interval-arrow column, silence dashed rings, fraction
   divider; enqueues text runs
7. **Measure bars, measure triangles, octave guides**
8. BaseNote fraction
9. **Glyph atlas flush** — every glyph on screen in one instanced draw
10. **Dependency / link lines + drag overlay**
11. **Marquee** rectangle

### Viewport culling

The per-note overlay loop (step 6) is culled against the viewport (`renderer.js:6847-6878`). Every
overlay it emits is scissored to that note's own rect, so a note entirely off-canvas cannot produce
a single pixel — the cull is **exact**, not an approximation, which is why the picture stays
pixel-identical. Without it, overlay cost scaled with the size of the *module*; with it, it scales
with what is on screen. This is what makes 100k notes tractable.

The horizontal bound is widened during a drag:

```
cullPadX = 2 + (dragActive ? |m[0]·dragOffsetX| + |m[0]·dragOffsetW| : 0)
```

because moving notes are offset on the **GPU**, not in `posSize` — without the slack, a note dragged
in from off-screen would arrive with no overlays. Drags only shift x and width, so the vertical
bound needs no slack.

Note bodies need no cull: they are one instanced draw regardless of how many are off-screen.

### The dependency-ring pass

`_drawRingIdxList(indices, rgba, borderPx)` (`renderer.js:2548`) draws one bucket of rings. It has
two paths:

- **No drag active** — `u_dragOffset` is `(0,0)` for every ring, so the whole bucket shares
  identical uniforms. The indices are gathered into one reused buffer and drawn in **one instanced
  call**. Selecting a hub note with ~1000 dependents costs 6 draws, not 999. This is pixel-identical:
  the ring shader reads only `a_posSize` per instance, and WebGL rasterizes instances in order, so
  same-colour overlap blends the same.
- **Drag active** — per-instance drag offsets differ (moving vs anchor vs static), so the exact
  per-instance loop is kept for correctness.

Ring colours are **hardcoded** in `_render()` (`renderer.js:2774-2792`), one triple per property,
with dimmed variants used during a drag:

| Property | Colour | Parent chain (`dep`) | Dependents (`rdep`) |
|---|---|---|---|
| frequency | orange | `[1.0, 0.5, 0.0, 0.9]` | `[1.0, 0.5, 0.0, 0.4]` |
| startTime | teal | `[0.0, 1.0, 1.0, 0.9]` | `[0.0, 1.0, 1.0, 0.4]` |
| duration | purple | `[0.615, 0.0, 1.0, 0.9]` | `[0.615, 0.0, 1.0, 0.4]` |

During a **move** drag the startTime colour stays at full alpha and the other two drop to
`0.15`/`0.08`; during a **resize** drag duration stays full instead. Parent-chain rings are drawn at
`ringThicknessPxAtZoom1 × 1.5` (3 px), dependents at `× 1.0` (2 px). Draw order is startTime →
frequency → duration so overlapping dependencies all stay visible.

### The glyph atlas

All on-note text — ID labels, fraction numerators/denominators, the word "silence", the ▲/▼ arrow
glyphs, measure and octave-guide labels — is drawn through a single texture atlas and a single
instanced call (`_drawAtlasGlyphInstances`, `renderer.js:8718`).

- One RGBA atlas texture, `min(1024, MAX_TEXTURE_SIZE)` square, glyphs rasterized on demand at
  `text.glyphBasePx` (64) in `Roboto Mono` and packed into rows. A seed set
  (`0123456789[]/+-▲▼silenceBaseNoteNote `) is pre-warmed at init.
- 8 per-instance attributes per glyph (plus the shared unit quad at location 0), including
  `a_clipRect` and a rounded-rect mask (`a_rrCenterSize`, `a_rrRadius`) — the atlas shader
  **emulates scissoring per instance**, which is what lets thousands of glyphs across hundreds of
  notes collapse into one draw instead of one scissored draw per run.
- `a_dragFlagGlyph` + the `u_dragCssX` uniform shift a moving note's glyphs on the GPU during a drag,
  matching the body offset.
- The atlas is **on by default**. Disable it with `?atlas=0` or `localStorage['rmt:atlas'] = '0'`;
  force it on with `?atlas=1`. With it off, the renderer falls back to the legacy `textProgram` path:
  one scissored draw call per text run.

## Runtime configuration

`setConfig(partial)` deep-merges into the live config and marks a redraw. This is the supported way
to tune the renderer; `src/renderer/webgl2/renderer-config.js` holds the defaults.

| Key | Default | Unit |
|---|---|---|
| `scales.secondsToWorldX` | `200` | world units per second |
| `scales.freqToWorldY` | `100` | world units per log2 ratio |
| `note.heightWU` | `22` | world units |
| `note.centerAnchorWU` | `10` | world units |
| `note.roundedCornerPxAtZoom1` | `6` | CSS px @ zoom 1 |
| `note.borderPxAtZoom1` | `1` | CSS px @ zoom 1 |
| `baseNote.circleSizeWU` | `40` | world units |
| `playhead.color` | `[1.0, 0.66, 0.0, 1.0]` | RGBA (`#ffa800`) |
| `playhead.thicknessPx` | `1` | CSS px |
| `measures.dashPx` / `measures.gapPx` | `6` / `6` | CSS px |
| `silenceRing.dashPx` / `gapPx` / `alignBiasPx` | `3` / `3` / `0.25` | CSS px |
| `overlays.tabWidthFactor` | `0.5` | × note height |
| `overlays.arrowColumnWidthFactor` | `0.5` | × note height |
| `overlays.innerTabBarWidthFactor` | `0.1` | × note height |
| `overlays.idLabelFontFactor` | `0.12` | × note height |
| `overlays.fractionFontFactor` | `0.26` | × note height |
| `overlays.dividerThicknessFactor` | `0.12` | × fraction font px |
| `selection.ringThicknessPxAtZoom1` | `2` | CSS px @ zoom 1 |
| `selection.hoverThicknessPxAtZoom1` | `1` | CSS px @ zoom 1 |
| `text.useGlyphAtlasDefault` | `true` | — |
| `text.glyphBasePx` | `64` | px |
| `text.maxOnscreenFontPx` | `96` | CSS px |
| `text.softTextureCapPx` | `1024` | device px (soft cap; hard cap queried from the GPU) |

::: info
`selection.multiRingThicknessPxAtZoom1` is read at `renderer.js:1526` with a `?? 4.0` fallback but is
**absent from `defaultRendererConfig`**. Its effective default is 4.0 px, and it will not appear if
you dump the config.
:::

Three of these keys are user-facing: `note.heightWU`, `note.borderPxAtZoom1` and
`note.roundedCornerPxAtZoom1` are driven by the Appearance sliders in
[Settings](/user-guide/interface/settings).

## Theme colours

`setThemeColors(colors)` takes hex strings, converts them to RGBA floats, clears the canvas-label
cache, and bumps `_colorEpoch` and `_viewEpoch` so baked text regenerates. It is called by
`src/theme/theme-manager.js`.

```javascript
renderer.setThemeColors({
  accent: '#ffa800',
  noteBorder: '#636363',
  measureBar: '#ffffff',
  selectionRing: '#ffffff',
  hoverRing: '#ffffff',
  depFrequency: '#ff8000', depStartTime: '#00ffff', depDuration: '#9d00ff',
  textPrimary: '#ffffff'
});
```

| Key | Read by |
|---|---|
| `accent` | BaseNote circle fill, octave guide lines, note ID labels, canvas label textures, the multi-select **marquee rectangle** |
| `noteBorder` | Every note body border, silence dashed rings, base-circle border |
| `measureBar` | Measure bars (dashed interior @ 0.35 alpha, solid start/end @ 0.8) |
| `selectionRing` | The selected-note ring and fill wash, the multi-select group ring, and selected BaseNote / measure-triangle outlines |
| `hoverRing` | The hover ring on notes, the BaseNote and measure triangles |
| `depFrequency` / `depStartTime` / `depDuration` | The dependency-highlight rings and dependency link lines |
| `textPrimary` | Stored as `noteText` / `noteTextHex` — all on-note glyph text: fraction digits, "silence", ▲/▼ glyphs, the BaseNote fraction |

Every key reaches a draw path; the accessors (`renderer.js:378-392`) carry fallbacks matching the
pre-theme literals so an unthemed boot renders identically.

Note **body** colours are deliberately not themed — they are per-note user data (`note.color`).

## Interaction and preview API

Every one of these is a separate setter. There is no `render(module, cache, selection, options)`
call; drawing is driven off `needsRedraw`.

| Method | Purpose |
|---|---|
| `updateViewportBasis({a,b,c,d,e,f})` | Push a new camera basis. See [Camera Controller](/developer/rendering/camera-controller). |
| `setPlayhead(timeSec)` | Move the playhead. Change-guarded. |
| `setScaleFactors(x, y)` | Update X/Y scale without rebuilding the scene (avoids a 1-frame playhead pop). |
| `setTrackingMode(enabled)` | Render the playhead at viewport centre in screen space. |
| `setDrawNoteArrows(enabled)` | Show/hide the ▲/▼ interval-arrow column. Use this rather than assigning `drawNoteArrows` directly — the ID label, fraction and divider are laid out **around** the column, so toggling it must relayout them (it bumps `_viewEpoch`), and a bare `needsRedraw` would just redraw the stale layout. |
| `setHoverNoteId(id)` / `setHoverMeasureId(id)` / `setHoverBase(flag)` / `setHoverSubRegion({id, region})` | Hover highlighting. All change-guarded. |
| `setMultiSelection(ids)` / `getMultiSelection()` | The marquee / shift-click group. Notes only. |
| `setMarqueeRect({x0,y0,x1,y1})` | The live rubber-band rectangle, in client CSS px. `null` hides it. |
| `setDragOffsetPreview({dxWorld, dwWorld, noteIds, anchorId})` | Shift `noteIds` on the GPU during a drag. Short-circuits on an **identity check** against the caller's Set. |
| `setDragOverlay(state)` | Drag-time dependency lines and origin guide bars. |
| `setTempOverridesPreview(id, startSec, durationSec)` / `setTempOverridesPreviewMap(map)` | Per-note preview overrides. |
| `setMeasurePreviewMap(map)` / `setModuleEndPreviewSec(sec)` | Measure-drag preview. |
| `setProspectiveParentId(id)` | Live link-line retargeting during a drag. |

::: danger Identity, not size
`setDragOffsetPreview` and `setDragOverlay` both short-circuit when the caller hands back the same
array/Set it handed in last time. `_dragMovingIds` has **two producers with different membership** —
`setDragOverlay` writes a set that **excludes the anchor**. Keying a fast path off the wrong one
stops the dragged note tracking the cursor. Both now derive from the set actually passed in. Neither
uses a size-only comparison, which would be unsound.
:::

## Coordinates

```javascript
const { x, y } = renderer.screenToWorld(clientX, clientY);   // an OBJECT, not an array
```

`RendererAdapter` has **no `worldToScreen`**. Forward mapping is done inline with the basis matrix.

A note's world rect is derived from the evaluated values and the config:

```
x = startTimeSec * scales.secondsToWorldX * xScaleFactor          // 200 by default
w = durationSec  * scales.secondsToWorldX * xScaleFactor
y = log2(baseFreq / freq) * scales.freqToWorldY * yScaleFactor    // 100 by default
h = note.heightWU                                                 // 22 by default
```

`_frequencyToY(freq)` returns the **line** for that frequency. A note's vertical **centre** sits on
that line: the top-left is `_frequencyToY(freq) + centerAnchorWU - heightWU/2`. That is why changing
`note.heightWU` makes notes thinner or thicker *about* their frequency instead of sliding them off
it. Octave guides, the BaseNote circle and dependency-line endpoints all sit on the same line.

## Picking

All picking is CPU-side, against the instance arrays. See [Picking](/developer/rendering/picking).

## Verifying a change

The renderer used to rebuild everything every frame, which **hid at least six real bugs** (an
arrow-region buffer clobbered by the hover overlay; an upload gated on an epoch pair that could not
change during a drag; a text cache not keyed on note position; font-load staleness; a drag/resize
with no invalidation signal). They only surfaced once redraws were gated. Assume any cache you add
will unmask another one.

**Measure and pixel-diff every renderer change. Never eyeball it.**

Load the harness with `?perf` (e.g. `http://localhost:3000/?perf=1`) — it exposes `window.__rmtPerf`
plus `window.__rmtRenderer` / `window.__rmtWorkspace`. `main.js` `await import()`s
`src/dev/perf-harness.js` only when the flag is present, so it is never fetched otherwise.

| `__rmtPerf` method | Does |
|---|---|
| `loadStress(name)` | Load a stress module and reload the page |
| `measureSync(n, selId?)` | Time `sync()` in isolation |
| `measureRedraw(n, selId?)` | Time a full forced `_render()` |
| `measureIdleFrame(n)` | Cost of a frame with `needsRedraw = false` |
| `profileFrame(n, selId?)` | **Per-pass breakdown**, ms/frame |
| `measureCommit(n, noteId?)` | True end-to-end commit (rewrite + eval + sync + history) |
| `pickHubNoteId()` | The most-connected note — worst case for the ring pass |
| `report()` | eval + commit + sync + redraw, as a `console.table` |

::: warning `loadStress()` overwrites your work
It writes the stress module into the `rmt:moduleSnapshot:v1` boot key and reloads. Call
`restoreDefault()` to get the default module back. Do not run it in a session you care about.
:::

Only **two** perf npm scripts exist: `npm run perf:gen` (writes stress modules into
`public/modules/perf/`) and `npm run perf:bench` (headless Node, **evaluation only** — no renderer).
Every other tool is run directly:

| Script | Purpose |
|---|---|
| `node scripts/perf/bench-render.mjs` | Per-pass profile + true rAF frame timing for idle and pan |
| `node scripts/perf/bench-drag.mjs` | Drags a hub note, samples **every** frame so hitches show instead of averaging away |
| `node scripts/perf/bench-pick.mjs` | `pickAt` / `pickStackAt` / `hitTestSubRegion` ms per call |
| `node scripts/perf/who-dirties.mjs` | Traps writes to `needsRedraw` and reports the call sites during idle frames |
| `node scripts/perf/converge.mjs` | Proves **one** redraw produces the final image |
| `node scripts/perf/visual-regress.mjs` | `--capture` / `--compare`: pixel diff across scenes and modules |

`converge.mjs` is non-negotiable now that idle frames are gated: a pass that needs a *second* frame
to settle leaves the user staring at a stale one forever.

::: warning A trap in the harness
**The pixel-diff tolerance is 300 px, not 0.** The GL context is created with `antialias: true`, and
MSAA sample resolution is not bit-deterministic across runs — re-comparing an *unchanged* build still
flips a handful of pixels out of ~1,024,000. A zero-pixel gate would be permanently red.
`visual-regress.mjs` defaults `--tolerance 300`, far above that noise floor and far below any real
regression. (Its own usage comment still says "default 0 pixels" — the code says 300.)
:::

The scripts all default to `--url http://localhost:3000`, matching `npm run dev`'s pinned port —
pass `--url` only for a non-default server.

The `voices-*` stress modules (5k / 20k / 100k) are **gitignored** — 100k notes is 16 MB. Run
`npm run perf:gen` before any render benchmark.

## Measured performance

Headless Chromium (real GPU), 1600×900, frame budget 16.6 ms.

| Module | Notes | Idle | Pan | `sync()` p50 | Full redraw | Redraw, hub selected |
|---|---|---|---|---|---|---|
| `voices-5000` | 5,001 | 60 fps, **0/100 frames redrawn** | 60 fps | 2.0 ms | 0.77 ms | 1.20 ms |
| `voices-20000` | 20,001 | 60 fps, **0/100 redrawn** | 60 fps | 13.1 ms | 1.75 ms | 1.98 ms |
| `voices-100000` | 100,001 | 60 fps, **0/100 redrawn** | 60 fps | **63.3 ms** | 4.27 ms | 7.97 ms |

Per-pass at 100k, nothing selected: note overlays 2.34 ms, measure bars 1.82 ms, octave guides
0.10 ms, base fraction 0.04 ms, glyph atlas flush 0.007 ms, dependency lines 0.01 ms.

Dragging `hub-5000` (one anchor, 4,999 direct dependents): p50 16.7 ms, p99 18.0 ms. Exactly one
frame exceeds 33 ms, and it is the **drop** — the commit and re-sync.

**The GPU is not the bottleneck. `sync()` is.**

## See also

- [Rendering Pipeline](/developer/architecture/rendering) — architecture overview
- [Camera Controller](/developer/rendering/camera-controller) — pan, zoom, and the affine basis
- [Picking](/developer/rendering/picking) — how a click maps to a note
- [Dependency Graph](/developer/core/dependency-graph) — the graph the corruption scan walks
- [Workspace](/user-guide/interface/workspace) — the user-facing view
