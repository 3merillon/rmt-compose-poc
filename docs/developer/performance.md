---
title: Performance
description: How RMT Compose stays at 60 fps — the O(N+E) corruption scan, batched ring pass, viewport cull, idle gating, chunk splitting, and the benchmark harness that proves it.
---

# Performance

RMT Compose draws the whole score — notes, measure bars, dependency lines, text, rings — in one
WebGL2 canvas with instanced draws. The GPU has never been the bottleneck. Every performance win
in this document is a **CPU** win: work removed from `renderer.sync()`, allocations removed from
the drag path, and frames that are never drawn at all.

This page tells you what was measured, why the code looks the way it does, and how to reproduce
the numbers yourself.

## The measured picture

**Setup for every number below:** headless Chromium via Playwright (`--use-angle=default
--enable-gpu`), viewport 1600×900, against the Vite dev server on a fast Windows desktop. The
frame budget for 60 fps is **16.6 ms**. Your machine will differ; the *shape* of the curve is what
matters.

### Render scaling — `bench-render.mjs`

The following small-module results are historical. At `c14d112` the same camera
movement exceeded the frame budget. In a fresh headless Edge context at 1600×900,
with compact `voices-*` fixtures served by Vite, CDP CPU sampling gave these times:

| Workload | 100,000 | 250,000 | 500,000 |
|---|---:|---:|---:|
| Fetch to first drawn frame | 2.57 s | 6.41 s | 12.67 s |
| JS heap after autosave and GC (decimal MB) | 237 | 540 | 1,064 |
| Octave edit, warm p50 | 84 ms | 209 ms | 407 ms |
| Undo / redo through draw | 2.17 / 2.25 s | 6.23 / 6.25 s | 13.44 / 14.13 s |
| Redraw / pan frame, p50 | 13 / 64 ms | 35 / 167 ms | 72 / 341 ms |
| Hover frame, p50 | 17 ms | 43 ms | 91 ms |
| Point pick (mean) | 0.22 ms | 0.55 ms | 1.16 ms |

At 250k / 500k, a 12-note marquee took 63 / 109 ms per mouse move (median).
Moving a chain note took 57 / 107 ms per move and 1.90 / 3.83 s to drop.
Replacing the first 5,000 notes in each fixture with a 4,999-dependent hub
took 1.77 / 3.94 s to select its anchor, 76 / 122 ms per move and 1.74 / 3.76 s
to drop it. Selection and drop include two animation callbacks. These are
elapsed times in one browser run, including the cost of profiling.

The load profile at 500k attributed 29% of non-idle time to compilation
(including its callees), 20% to dependency registration and 8% to evaluation.
Undo and redo repeated compilation and registration. The largest costs during
panning were in the note overlays, including rebuilding and uploading the
tab and arrow regions. The add-note form's `refreshEvaluations` also appeared
on selection and drop. Each field built a new cache of every variable of every note.

At 500k, `sync` accounted for 50% of non-idle samples in the commit recording,
including time in `toNumber`. During undo, compilation took 24% and dependency
registration 19%. Compilation accounted for 23% during redo. During a chain or
hub drop the note widget's preview evaluation took 29%. Selecting the hub spent
34% in `sync`. The render loop took 34% during hover and 35% during marquee,
while the player's end-time lookup took 8% and 16% respectively. These percentages
include callees and overlap. The gesture recordings include pointer dispatch and
the frames drawn during the gesture.

The add-note form now reads the explicit references of the compiled preview
expression and the BaseNote for inherited values. The text and tooltips for
valid, irrational, missing-reference, invalid and large-fraction inputs matched
the previous build. Selecting the 4,999-dependent hub took 774 → 521 ms at 100k,
1,826 → 1,156 ms at 250k, and 3,987 → 2,169 ms at 500k. Dropping it after a
move took 669 → 392, 1,670 → 1,087 and 3,690 → 1,857 ms respectively.

A horizontal index bounds groups of 64 consecutive draw slots. Note bodies, overlay loops
and GPU region uploads visit the ranges intersecting the camera, in their original draw
order. A stationary redraw fell from 12.5 to 0.9 ms at 100k, 10.5 to 1.0 ms at
250k and 63.2 to 1.0 ms at 500k. Pan frame intervals fell from 51.8 to 8.2 ms,
124.1 to 8.3 ms and 279.1 to 13.4 ms respectively. All 33 comparison scenes
were pixel-identical. A view showing the whole score still draws the whole score.

| Module | Notes | Idle | Pan | `sync()` p50 | Redraw, no selection | Redraw, hub selected |
|---|---|---|---|---|---|---|
| `voices-5000` | 5,001 | 60.2 fps, **0/100 frames redrawn** | 60.2 fps | 2.0 ms (p95 5.2) | 0.77 ms | 1.20 ms |
| `voices-20000` | 20,001 | 60.2 fps, **0/100 redrawn** | 60.2 fps | 13.1 ms (p95 24.6) | 1.75 ms | 1.98 ms |
| `voices-100000` | 100,001 | 59.9 fps, **0/100 redrawn** | 60.2 fps | 63.3 ms (p95 111.1) | 4.27 ms | 7.97 ms |

Per-pass breakdown of a full redraw at 100k notes with nothing selected: `_renderNoteOverlays`
2.34 ms, `_renderMeasureBars` 1.82 ms, `_renderOctaveGuides` 0.10 ms,
`_renderBaseFractionIfMissing` 0.04 ms, `_flushGlyphRunsAtlas` 0.007 ms,
`_renderDependencyLinesAndDragOverlay` 0.01 ms. Select a hub note and `_renderNoteOverlays` rises
to 5.44 ms, total 7.97 ms — still half the budget.

The historical table timed a full instance rebuild. Current workspace edits use the
evaluation change set when the existing slots can be reused.

### Picking — `bench-pick.mjs`, CPU, per call

| Module | N | `pickAt` | `pickStackAt` | `hitTestSubRegion` |
|---|---|---|---|---|
| `voices-5000` | 5,000 | 0.017 ms | 0.018 ms | 0.017 ms |
| `voices-100000` | 100,000 | 0.314 ms | 0.351 ms | 0.318 ms |

### Hub drag — `bench-drag.mjs --module hub-5000 --steps 200`

Note `[1]` in `hub-5000` has **4,999 direct dependents**. Over 216 sampled frames:

> p50 **16.7 ms** · p90 17.5 ms · p99 **18.0 ms** · max 36.2 ms.
> One frame over 33 ms, zero over 50 ms — and that one frame is **the drop** (commit + re-sync),
> a one-off at the end of the gesture.

Before the allocation work described [below](#mid-drag-gc-hitches), the same drag ran at p99 32 ms
with periodic multi-frame GC hitches all the way through.

### Evaluation — `npm run perf:bench` (Node, `BinaryEvaluator`)

Measured on the BigInt-backed evaluator (fraction.js 5.x):

| Module | Full eval (p50) | Mid-module commit (p50) | BaseNote edit (p50) |
|---|---|---|---|
| `chain-1000` (1000 notes, depth 1000) | 2.98 ms | 0.96 ms | 1.70 ms |
| `fan-1000` (1000, depth 1) | 1.60 ms | 0.01 ms | 1.78 ms |
| `lattice-1000` (1000, depth ~100) | 1.85 ms | 0.99 ms | 2.50 ms |
| `chords-dense` (800, depth ~4) | 0.93 ms | 0.51 ms | 1.10 ms |
| `comma-chain-400` (400, `(81/80)^k` growth) | 122.98 ms | 99.40 ms | 121.25 ms |

`comma-chain-400` is the outlier by design. BigInt arithmetic costs time proportional to
operand size, and its fractions grow without bound — ~760 digits by note 400 — so **digit
count**, not note count, is what it measures. The four bounded shapes keep their fractions
small at any depth, so they isolate graph and op-count cost; against the old double-backed
fraction.js they moved by well under 2×.

## Idle is genuinely idle

With nothing happening, the renderer issues **zero draw calls**. Verified two ways: `who-dirties.mjs`
traps every write to `needsRedraw` over ~100 idle frames and reports *"(never — the canvas is
properly idle)"*, and `bench-render.mjs` reports **0/100 idle frames redrawn** at 5k, 20k and 100k
notes.

This does **not** mean rAF is descheduled. Both loops still tick every frame — the renderer's
(`renderer.js:594-598`) and the player's (`player.js:1847-1867`, which updates the DOM playhead and
measure-bar transforms). What is gated is the *body* of `_render()`:

```javascript
// renderer.js:3186
if (!this.needsRedraw) return;
this.needsRedraw = false;
```

That inner gate existed before, and did nothing, for two reasons. First, the passes layered on top of
`_render()` by the prototype wrappers ran unconditionally, so an idle frame still paid for all of
them — an outer gate now wraps the whole chain (`renderer.js:11272`; see
[the redraw gate](/developer/rendering/webgl2-renderer#the-frame-loop-and-the-redraw-gate)). Second,
two callers dirtied the scene on every frame. Both now short-circuit:

- **`setPlayhead()`** (`renderer.js:1560`) — `if (t === this.playheadTimeSec) return;`. `player.js`
  calls this every frame whether or not audio is playing; dirtying unconditionally kept
  `needsRedraw` permanently true.
- **`updateViewportBasis()`** (`renderer.js:644-648`) — an unchanged-basis early return. The
  player's rAF pushed a camera update every frame (to release the playhead-tracking X-lock), which
  bumped `_viewEpoch` 60×/s on a perfectly still canvas and invalidated every view-keyed cache.

The guards live in the renderer, not the call sites, so any future caller gets them for free.

::: danger Gating changes the rules for every cache you add.
Before gating, the renderer rebuilt everything every frame — which silently *hid* at least six real
bugs (an arrow-region buffer clobbered by the hover overlay; an upload gated on an epoch pair that
could not change during a drag; a text cache not keyed on note position; font-load staleness;
drag/resize having no invalidation signal at all). They only surfaced once frames stopped being
redrawn. Assume your new cache will unmask another one, and run `converge.mjs`.
:::

### The epoch system

Caches are keyed on epochs. Get these wrong and you ship a stale frame.

| Epoch | Bumped by | Guards |
|---|---|---|
| `_viewEpoch` | Any *real* camera basis change (pan/zoom) | zoom-dependent screen-space buffers, measure bars, glyph runs |
| `_posEpoch` | Every `sync()` | glyph runs (text holds absolute CSS positions, so it goes stale when notes move); tab/arrow regions |
| `_sceneEpoch` | End of `sync()` | overlay passes; part of the link-tree cache key |
| `_dragEpoch` | Every pointermove of a drag | glyph runs + dependency-line endpoints |

A drag deliberately does **not** bump `_posEpoch` — moving notes are shifted on the GPU via
`u_dragOffset`, not in `posSize` — but the anchor's `posSize` *is* rewritten each move, so
`_dragEpoch` exists as the invalidation signal for anything derived from absolute positions. The
full epoch reference, including `_colorEpoch`, is in
[WebGL2 Renderer](/developer/rendering/webgl2-renderer#epochs).

## `sync()` — the per-edit rebuild

```javascript
// renderer.js:682
sync({ evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId, tempOverrides, incremental })
```

An initial or full sync builds the instance arrays, label strings, slot map and
corruption flags and uploads them to the GPU. Ordinary moves, resizes, octave steps,
compatible restores and selections can reuse those slots. The evaluator keeps eight
recent batches of up to 8,192 invalidated IDs each. The renderer consumes the union
since its last sync, recalculates those bodies and uploads contiguous changed slots.
On selection it reverses the previous swap with the last slot, then performs the new
swap, preserving draw and pick order. The same calculation builds geometry and labels
on both paths.

Warm octave commits fell from 60.7 to 1.4 ms at 100k, 171.9 to 1.7 ms at 250k
and 421.0 to 1.8 ms at 500k. These timings end when the edit handler returns.
Drawing and the deferred IndexedDB write take additional time.

Full synchronization handles module or scale changes, an expired journal, complicated
body geometry, corruption, an edited measure or reference line, and a latest note that
moves earlier. Shader-based dragging still updates previews on pointer moves.

### The headline fix: O(N²) → O(N+E) corruption scan

`renderer.js:1074-1121`. The old code asked, for every note, *"does anything in my dependency closure
have a corrupt value?"* — by calling `depGraph.getAllDependencies(noteId)`, a full transitive BFS,
**once per note per sync**. Cost therefore scaled with dependency *depth*, not just note count. At
identical note counts: **28.5 ms for `chain-1000`** (depth 1000) versus **1.4 ms for `fan-1000`**
(depth 1).

The fix inverts the question. `dependents` is the maintained inverse of `dependencies`, so:

> *i* transitively depends on corrupt *C* ⟺ *i* is a transitive dependent of *C*

One **multi-source BFS over the dependents graph, seeded by the corrupt set**, answers it for every
note at once — O(N+E). And because the corrupt set is empty in the overwhelmingly common case, and
`_corruptionType` is zero-filled up front, the whole block becomes a **no-op** when nothing is
corrupt.

The result is that `sync()` is now flat in dependency depth — roughly **1–1.4 ms at 1000 notes for
every stress shape**, chain or fan.

| Scenario (~1000 notes) | `sync` before → after | End-to-end commit before → after |
|---|---|---|
| `chain-1000` (depth 1000) | **28.5 → 1.4 ms (20×)** | 45.8 → 17.6 ms |
| `lattice-1000` (depth ~100) | 18.9 → 1.8 ms | 34.0 → 15.3 ms |
| `chords-dense` (depth ~4) | 5.6 → 1.1 ms | 9.1 → 4.7 ms |
| `fan-1000` (depth 1) | 1.4 → 1.2 ms | 2.2 → 1.9 ms |
| Default module (170 notes) | 0.7 → 0.5 ms | 0.8 → 0.6 ms |

The new algorithm was proven identical to the old one by a randomised differential test — 5,600
trials, zero mismatches. A fallback branch preserving the exact old per-note logic is kept at
`renderer.js:1122` for graph objects that lack `getCorruptedNotes` / `getDependents`.

Corruption is encoded in `_corruptionType` (a `Float32Array`, vertex attribute 7), which the note
shader turns into hatching:

| Value | Meaning | Visual |
|---|---|---|
| `0.0` | clean | none |
| `1.0` | transitive — depends on something corrupt | single 45° diagonal hatch |
| `2.0` | direct — corrupt, with no corrupt dependency | crosshatch |

See [Dependencies](/user-guide/notes/dependencies) for what corruption means musically.

### Cached zero-buffer

`renderer.js:1453-1457`. The per-sync region-buffer resets reuse a cached `_zeros4Cache`
`Float32Array` instead of allocating a fresh one each sync. It is only ever read, so it stays
all-zeros. Same GPU behaviour, no GC churn during a drag.

## The instanced pipeline

Everything that scales with note count N is a **single** `gl.drawArraysInstanced` call. There is no
DOM per note and no draw call per note.

| Pass | Where |
|---|---|
| Note bodies in visible instance ranges | `renderer.js:3281` |
| Silence dashed rings, fraction dividers, pull-tab and arrow backgrounds | `src/renderer/webgl2/renderer.js:7050`, `:7063`, `:7980`, `:8037`, `:8112` |
| Octave guides | `renderer.js:5674` |
| Measure bars and measure triangles | `renderer.js:6383`, `:6405` |
| Dependency link-lines | instanced, per-property buckets |
| All overlay text | glyph atlas run, `renderer.js:9305` |

The shared rect VAO (`renderer.js:2816-2905`) binds one per-vertex attribute — the unit quad
`a_unit` (location 0, divisor 0) — plus **six per-instance** attributes: `a_posSize` (1), `a_color`
(2), `a_tabRegion` (4), `a_flags` silence mask (5), `a_dragFlag` (6) and `a_corruptionType` (7).
Location 3 (`a_noteSize`) is still declared in the note-body shader but is no longer bound — note
CSS size is derived in-shader from `u_scale`.

This is why Phase 8 got reframed: the renderer was *already* batched, so the per-commit hotspot was
never draw-call count. The governing rule is **keep it O(visible), not O(module)**.

### The batched dependency-highlight ring pass

`_drawRingIdxList()` — `renderer.js:2988`. This is the one remaining per-instance loop that could
approach O(N): it fires when a highly-connected note is selected (a hub with ~1000 dependents) and
the scene keeps redrawing for other reasons (hover, playhead).

- **No drag active** (`renderer.js:3028`): `u_dragOffset` is `(0,0)` for every ring, so the whole
  bucket shares identical uniforms. The indices are gathered into one reused `_depRingBatch` buffer
  and drawn in **one** instanced call — 999 draws and 999 `bufferData` uploads collapse to 6 and 6
  per selection. It is pixel-identical: the ring shader reads only `a_posSize` per instance, and
  WebGL rasterises instances in order, so same-colour overlap blends the same.
- **Drag active** (`renderer.js:3062`): per-instance drag offsets differ (moving vs anchor vs
  static), so the exact per-instance loop is kept for correctness.

Three callers share it: the dependents rings, the full parent-chain rings, and the multi-selection
ring.

Ring colours (`renderer.js:3310-3328`) are property-specific — orange = frequency, teal = startTime,
purple = duration — and dim the properties a drag is *not* changing. Parent-chain rings are drawn at
`ringThicknessPxAtZoom1 × 1.5` (3 px), dependents at `× 1.0` (2 px), in the order startTime →
frequency → duration so overlapping dependencies all stay visible.

### Viewport culling

`renderer.js:7381-7412`. The per-note overlay loop — pull tab, interval arrows, fraction divider,
silence band, and **all** of that note's text runs — is culled against the viewport. Every overlay
it emits is scissored to that note's own rect, so a note entirely off-canvas cannot produce a single
pixel. The cull is therefore *exact*, not an approximation, which is why the picture stays
pixel-identical.

```javascript
cullPadX = 2 + (dragActive ? |m[0]·dragOffsetX| + |m[0]·dragOffsetW| : 0)
```

The horizontal bound is widened during a drag because moving notes are offset on the *GPU*, not in
`posSize` — without the slack, a note dragged in from off-screen would arrive with no overlays.
Drags only shift x and width, so the vertical bound needs no slack.

The horizontal index also limits the slots submitted for instanced note bodies. The per-note
rectangle test handles partially visible groups and the vertical bounds.

## Mid-drag GC hitches

Dragging a hub note (a measure bar with ~5,000 dependents) used to be smooth and then *hitch*
periodically after moving some distance. The cause was **garbage, not compute**: several paths
rebuilt the entire dependent set from scratch on every pointermove, so allocation rate scaled with
dependent count and a major GC fired once enough had piled up.

Rebuilt every pointermove → now built **once per gesture**:

- The `workspace.js` measure-drag path copied its cached moving-id `Set` into a new `Set` each move,
  then `Array.from()`'d it. Both are now created once and handed back by reference.
- The `workspace.js` note-drag path built `new Set([noteId, ...cachedDependents])` per move. Now
  cached on the interaction.
- `renderer.setDragOffsetPreview` (`renderer.js:4137`) re-derived `_dragMovingIds` plus an index
  array it then **sorted** — every move. Now short-circuits on an identity check against the
  caller's `Set`.
- `renderer.setDragOverlay` (`renderer.js:10206`) rebuilt a `Set` via `movingIds.map(Number)` every
  move. Now identity-checked, with an allocation-free exact content comparison as the fallback.
  Deliberately *not* a size-only test — that would be unsound.

Per-frame allocations removed from the drag render path:

- **Dependency-line endpoints** were accumulated into boxed JS arrays and copied into fresh
  `Float32Array`s every frame (~20,000 elements *per property* at 5,000 dependents). They now go
  into pooled, growable `Float32Array`s that hand out `subarray` views (`_linkWriter`,
  `renderer.js:10037-10071`). A steady-state drag now allocates **nothing**.
- The "legacy combined" deps/rdeps arrays were built with `push(...spread)`, converted, uploaded
  every frame — **and never drawn from**. Removed.
- `getChildrenTreeByAllProperties()` re-ran a full BFS every pointermove, allocating an edge object
  per dependent per property. It is a pure function of the anchor plus module structure, neither of
  which a drag changes, so it is now cached on `anchorId|_posEpoch|_sceneEpoch`
  (`renderer.js:10670-10677`) — any real edit still invalidates it.
- Tab/arrow region arrays were re-minted (4 × `Float32Array(N*4)`) every drag frame. Reused.
- Note-local overlay regions are now keyed on the note's **width**, not on "a drag happened". A
  *move* changes no note's width, so a move-drag no longer recomputes N regions and re-uploads N×4
  floats per pointermove. Only a **resize** can change them, and it still does.

::: warning `_dragMovingIds` has two producers with different membership.
`setDragOverlay` writes a set that **excludes the anchor**. Keying the fast path (and
`anchorIsMoving`) off it stops the dragged note tracking the cursor. Both now derive from the set
actually passed in. The pixel diff caught this; eyeballing would not have.
:::

## Picking is 100% CPU

- `Workspace.pickAt(clientX, clientY, expandCssPx = 2)` (`workspace.js:1931`) tries
  `renderer.pickAllAt()` first, which always exists.
- `RendererAdapter.pickAllAt` (`renderer.js:9668`) resolves measure triangles (top) → base circle →
  note stack.
- `RendererAdapter.pickAt` (`renderer.js:3872`) is a **reverse linear scan** over `_instanceNoteIds`
  (last-drawn is top-most), with a fast world-space AABB reject followed by a precise rounded-rect
  test so corners do not select.
- `hitTestSubRegion` (`renderer.js:3935`) resolves *which* sub-region of a note was hit (pull tab,
  arrow column), and only runs once a body hit is confirmed.

The CPU point pick took 1.16 ms per call at 500,000 notes in the initial Edge profile.
The measured drag and marquee costs were dominated by other work, so picking still uses the scan. See [Picking](/developer/rendering/picking).

## Cheap history

`src/store/history.js`.

- Each history entry keeps the canonical minified module text. The history manager and autosave
  share that string. Editor checkpoints also retain 128-ID pages of note text and row offsets.
  A move, resize or octave step serializes its changed rows, then joins the shared page texts
  in ID order. The public serializer still checks direct writes to exposed note fields.
- Two caps, both in `_enforceCaps()` (`history.js:35-43`): a count cap of **50** entries and a byte
  cap of **12 MB**. The byte cap drops oldest but always keeps **≥ 2** entries, so undo survives even
  one enormous snapshot.
- `canUndo()` is `_undo.length > 1` — the bottom entry is the "Initial" seed. Any new capture clears
  the redo stack.
- Restoring two versions of the same canonically ordered score compares shared pages by identity.
  Changed records go through the note constructor and the usual dependency invalidation.
  Structural edits, different variable references, unscoped edits and noncanonical state use
  the full loader to reestablish graph insertion order. History consumers can still request
  an independently parsed snapshot.

For an octave edit on `voices-*`, the paired Edge run timed the restore event
through two animation callbacks. The heap is decimal MB after initial load and GC.

| Notes | Undo before → after | Redo before → after | Loaded heap before → after |
|---|---:|---:|---:|
| 100,000 | 1.95 → 0.21 s | 1.94 → 0.21 s | 235 → 213 MB |
| 250,000 | 6.92 → 0.58 s | 5.67 → 0.61 s | 536 → 479 MB |
| 500,000 | 10.62 → 1.36 s | 11.31 → 1.30 s | 1,056 → 943 MB |

## The commit: what an edit costs

An octave step (`window.__rmtPerf.measureCommit()`, the `player:octaveChange` path) rewrites one
expression, marks its dependents dirty, evaluates, syncs the renderer, and captures a snapshot.
The player also reads the module end on animation frames. Each module keeps the maximum sounding
end for blocks of 128 IDs. A changed evaluation updates the affected blocks. Unchanged frames
read the cached result. The end of a sounding note is still its exact start plus its duration
before conversion to seconds. On an edited duration the audio end lookup fell from
35.9 to 0.3 ms at 100k, 84.6 to 0.3 ms at 250k and 193.2 to 0.2 ms at 500k. The last
measure is still chosen by each caller's existing tie-break. In the same three modules,
undo through the restored frame took 85 → 32, 327 → 73 and 464 → 111 ms.
Redo took 87 → 44, 216 → 77 and 720 → 140 ms.

Three parts of it used to cost the size of the whole module, whatever the edit changed:

- **The rewrite check.** `multiplyExpressionByFraction()` keeps the folded expression only when it
  evaluates to exactly the factor times the old one. Each check built a record of every note of the
  module first, twice per step (240,000 `getExactVariable` calls at 20,000 notes). The evaluator
  only reads the notes the expression references and the BaseNote, so the records are now built
  when first read (`noteRecords()`, `src/utils/simplify.js:118`): the same records, for the same
  ids. The simplifiers share the check.
- **The snapshot.** History and autosave use canonical note text. The usual workspace edits
  serialize the changed rows. The general save API checks all fields (`src/module.js:1031`).
- **`toNumber()`.** It wrote both BigInts of a fraction out in decimal to count their digits, for
  every value `sync()` reads. A comparison with 10^300 decides the same (`src/utils/fraction-num.js:90`).

`scripts/test-edit-cost.mjs` (in `npm test`) holds all three to what they replaced, and
`scripts/perf/compare-edits.mjs` runs the same edits and undos on two servers and compares the
autosave, both history stacks, evaluated values and the renderer's CPU and GPU buffers.
The sequence also swaps selection, edits notes and groups through their widgets, resets
inherited instruments, and undoes and redoes a group edit.

The note and group widgets now pass the edited IDs to history and request an incremental
renderer sync. The IDs include properties written directly, such as a reset to an inherited
instrument. Timings below cover the synchronous Save or Apply handler in headless Edge.

| Edit | 100,000 notes | 250,000 notes | 500,000 notes |
|---|---:|---:|---:|
| Note colour | 188 → 5.8 ms | 409 → 6.8 ms | 929 → 6.5 ms |
| Note frequency | 132 → 7.3 ms | 329 → 7.0 ms | 880 → 9.7 ms |
| Two-note group colour | 138 → 1.5 ms | 348 → 1.6 ms | 792 → 2.0 ms |

Headless Edge, `bench-commit-pairs.mjs`, the median of the commit p50s over 5 back-to-back pairs
(the server that goes first alternates):

| Module | Before | After | Before / after |
|---|---|---|---|
| `voices-20000` | 44.7 ms | 26.1 ms | 1.71x |
| `chain-1000` | 3.4 ms | 2.2 ms | 1.55x |

In the earlier field-caching implementation, at 20,000 notes (`profile-commit.mjs`): `sync()` about 15 ms,
since it rebuilds every instance on every commit (see
[Deferred](#deferred-and-not-shipped)); and `createModuleJSONString()` about 4 ms, since it still
reads every note's fields to find the ones that changed.

The autosave's `localStorage.setItem` (about 9 ms at 20,000 notes, the whole 3 MB text, written
synchronously) is out of the edit too. The text now goes to IndexedDB after the frame that shows the
edit (`src/store/autosave.js`), and only the latest: edits within one frame make one write. Only
`put()`'s copy of the text runs on the main thread, after the frame: 19 ms for the 15.5 million
characters of `voices-100000`, which `localStorage` could not hold at all. The same pairs, before
(v2 with the `localStorage` autosave) and after:

| Module | Before | After | Before / after |
|---|---|---|---|
| `voices-20000` | 29.0 ms | 18.1 ms | 1.60x |

`measureCommit()` runs its edits in one task, so their writes make one after the last frame and the
"after" column holds none of them. In the app each edit is its own task and is written once, after
its own frame. `scripts/perf/check-autosave.mjs` checks the store in the running app.

## Bundle splitting

`vite.config.js:21-35`. `manualChunks(id)` normalises `id` to forward slashes (for Windows) and
splits the entry monolith into independently-cacheable leaves. Each split is a verified
**singleton-free** leaf, so `eventBus`, `app-state` and `settingsStore` stay coalesced in the entry
chunk and are never duplicated.

| Chunk | Contents | Why |
|---|---|---|
| `vendor` | `/node_modules/` (just fraction.js) | effectively immutable, highest cache value |
| `renderer` | `renderer.js` + `renderer-config.js` | clean leaf — imports only renderer-config |
| `dsl` | `/src/dsl/` + `binary-note.js` + `binary-utils.js` | bundling the bytecode foundation here **breaks the core↔dsl cross-chunk cycle** |
| `instruments` | `/src/instruments/` | singleton-free leaf |
| *(entry)* | everything else: player, module, workspace, menu-bar, modals, engine, audio, theme, settings | keeps the singletons in one chunk |

The chunk-by-chunk byte sizes of a production build are in
[Build & Deploy](/developer/contributing/build-and-deploy#what-the-vite-build-produces). The
headline: the entry chunk is ~111 kB gzipped, the renderer ~54 kB, and the vendor chunk
(fraction.js) is small.

## The benchmark harness

### Generate the stress modules first

```bash
npm run perf:gen
```

This writes `public/modules/perf/*.json`. They are **not** listed in any library manifest, so they
never appear in the Module Bar.

| Module | Shape |
|---|---|
| `chain-1000` | Deep single chain — note *k* depends on *k−1*. Depth 1000 |
| `fan-1000` | Wide fan — every note depends directly on note `[1]`. Depth 1 |
| `lattice-1000` | 10 chains × 100, cross-linked every 10th note |
| `chords-dense` | 200 true-relational 4-note chords (800 notes) |
| `comma-chain-400` | Deep chain of `(81/80)` steps — the ratio product never collapses, so fraction digit count grows linearly with depth. The digit-cost stress |
| `hub-5000` | Drag worst case — one anchor with 4,999 direct dependents (`.t` and `.f`) |
| `voices-5000` / `voices-20000` / `voices-100000` | Render-scaling ladder — 8 voices, dep depth ≤ 200, spread across time and frequency so the viewport cull is exercised |

Frequency ratios in the other shapes cycle through a **product-1 sequence** (3/2, 4/3, 1/2) so
exact fractions stay small at any depth — those shapes isolate dependency-graph and op-count
cost. `comma-chain-400` is the deliberate opposite: fraction.js 5.x is BigInt-backed and exact
at any magnitude (an unbounded product like `(81/80)^400` no longer overflows — it just grows),
and this shape measures what that growth costs per operation.

::: warning The `voices-*` modules are gitignored.
100,000 notes is a 16 MB JSON file, so `public/modules/perf/voices-*.json` is not in the repo. Run
`npm run perf:gen` before any render benchmark, or it will fail to fetch its module.
:::

### Node evaluation benchmark

```bash
npm run perf:bench                       # all five evaluation stress shapes
node scripts/perf/bench-node.mjs chain-1000   # just one
```

This measures **evaluation only** — Node has no renderer. It runs the evaluator.

### In-browser harness: `?perf`

Start the dev server (`npm run dev`, port **3000**) and open
`http://localhost:3000/?perf=1`. That lazily imports `src/dev/perf-harness.js` (a separate 6 kB
chunk that is never downloaded otherwise) and exposes `window.__rmtPerf`, plus
`window.__rmtRenderer` and `window.__rmtWorkspace`.

| Method | Does |
|---|---|
| `loadStress(name)` | Fetches `modules/perf/<name>.json`, makes it the autosave (`replaceSavedModule()`), **reloads the page** |
| `restoreDefault()` | Clears the autosave, reloads → default module |
| `measureEval(n = 10)` | `invalidateAll()` + a full `evaluateModule()` |
| `measureCommit(n = 10, noteId?)` | True end-to-end commit: emits `player:octaveChange` up+down (expression rewrite → dirty marking → evaluate → renderer sync → history snapshot) |
| `measureSync(n = 20, selId?)` | Times `renderer.sync()` in isolation |
| `measureRedraw(n = 30, selId?)` | Times a full forced `_render()` |
| `measureIdleFrame(n = 60)` | Cost of a frame with `needsRedraw = false` |
| `profileFrame(n = 30, selId?)` | Per-pass breakdown — wraps each named pass, reports ms/frame |
| `pickHubNoteId()` | Finds the most-connected note (worst case for the ring pass) |
| `report()` | Runs eval + commit + sync + redraw, prints a `console.table` |

::: danger `loadStress()` replaces your stored composition.
It overwrites the autosave and reloads. If you run it in a session
where you were actually composing, that work is gone unless you call `restoreDefault()`.
:::

### Playwright harnesses

Everything else is run directly with `node`. **There are no npm aliases for these** — do not look
for `npm run perf:render`.

| Script | Purpose |
|---|---|
| `bench-render.mjs` | Per-pass frame profile + **true rAF frame timing** for idle and pan. The ground truth. |
| `bench-drag.mjs` | Drags a hub note, samples **every** frame so hitches show instead of averaging away. `--profile` captures a V8 CPU profile |
| `bench-hover.mjs` | Real mouse movement → end-to-end hover/pick + redraw frame times |
| `bench-pick.mjs` | `pickAt` / `pickStackAt` / `hitTestSubRegion` ms per call |
| `profile-sync.mjs` | V8 CPU profile of `sync()` by function self-time |
| `profile-commit.mjs` | One commit (`measureCommit`) timed, then CPU-profiled: self and total time per function. Reads\|wasm`; reads the module from disk |
| `bench-commit-pairs.mjs` | The commit on two servers (`--before`, `--after`), back to back in alternating pairs |
| `compare-edits.mjs` | The same edits, undos and redos on two servers: autosave, history stacks and instance buffers compared at every step |
| `check-autosave.mjs` | The IndexedDB autosave in the app: the move from `localStorage`, one write per frame of edits, reloads, undo, the fallback without IndexedDB, and a module too large for `localStorage` |
| `who-dirties.mjs` | Traps writes to `needsRedraw` and reports the call sites during ~100 idle frames |
| `converge.mjs` | Proves **one** redraw produces the final image |
| `visual-regress.mjs` | `--capture` / `--compare`: 11 scenes × 3 modules, pixel-diffed |
| `drag-shot.mjs` | Drives real move/resize gestures |

Every bench and shot harness script defaults to `--url http://localhost:3000` — the port `npm run
dev` pins — so `--url` is only needed when driving a non-default server. (The two docs-site
scripts, `check-docs-rendered.mjs` at 4173 and `shot-docs.mjs` at 3005, are the only exceptions.)

```bash
npm run dev                                            # port 3000
npm run perf:gen                                       # once
node scripts/perf/bench-render.mjs --module voices-20000
node scripts/perf/who-dirties.mjs
node scripts/perf/converge.mjs
```

## Rules for changing the renderer

1. **Measure it and pixel-diff it. Never eyeball it.** `visual-regress.mjs --capture` before your
   change, `--compare` after.
2. **Run `converge.mjs`.** It is non-negotiable now that idle frames are gated: a pass that needs a
   *second* frame to reach its final image leaves the user staring at a stale one.
3. **Expect a small non-zero pixel diff.** The GL context is created with `antialias: true` and MSAA
   sample resolution is not bit-deterministic across runs — re-comparing an *unchanged* build still
   flips up to ~7 px of 1,024,000 (max delta ≤ 15). `visual-regress.mjs` therefore defaults
   `--tolerance 300`, far above that noise floor and far below any real regression. **A zero-pixel
   gate would be permanently red.**
4. **Keep it O(visible), not O(module).**

## Deferred and not shipped

| Item | Status |
|---|---|
| **Incremental sync for complex scenes** | Stable body slots and partial GPU uploads ship for ordinary edits. Scenes with rests, envelopes, tails or corruption use the full synchronization path. |
| **Structural undo** | Ordinary expression edits share history pages and restore changed records. Undo across a topology change still uses the full loader. |
| **GPU picking** | **Not shipped.** `picking.js` is a self-described scaffold: no ID pass is ever drawn, `begin()`/`end()` have zero call sites, and `Workspace.pickAt` tries `pickAllAt()` first (which always exists), so the GPU branch is unreachable. All picking is CPU-side. |
| **Measure-triangle outline batching** | Intentionally skipped — bounded by measure count M ≪ N. |
| **Spatial index for picking** | Not warranted by measurement. |

## Limits

A later paired Edge run measured fetch through the animation frame after the first GL draw.
Keeping recency links in the compile cache and using numeric dependency registration keys for
fresh notes reduced load from **2.68 to 2.34 s at 100k**, **6.10 to 5.09 s at 250k**, and
**12.19 to 10.54 s at 500k**. Post-GC JS heap went from 237 to 235, 540 to 536 and 1,064 to
1,056 decimal MB. The compiler still keeps the 4,000 most recently used expressions and
returns independent bytecode copies.

Note ids go up to 16,777,215 (`MAX_NOTE_ID`, `src/binary-note.js`); the loader refuses ids above it,
and references above 65535 compile to `LOAD_REF_WIDE`. The UI's import paths (Load Module, library
upload, Load UI, Copy to Modules) accept up to 500,000 notes, and Load Module files up to 120 MB
(`MAX_MODULE_NOTES`, `MAX_MODULE_BYTES` in `src/limits.js`).

After the preceding memory pass, a loaded note cost about 2.4 KB of JavaScript heap in Edge (the whole app: module, graph,
evaluation records, renderer, undo history) and about 3 KB in Node (the data model alone, without
pointer compression). It was about 6.6 KB and 8.9 KB. Measured on `voices-*` modules after load and
a full GC, per note at 100,000 notes:

| Holder, before | Node | Edge | Now |
|---|---|---|---|
| The fraction pool's high-water mark: 2,097,149 Fractions kept after one pass | 1,976 B | 1,082 B | a few slots ([the fraction pool](/developer/core/binary-evaluator#the-fraction-pool)) |
| Three unset expressions per note, each with its own buffers | 1,848 B | 1,226 B | one shared `EMPTY_EXPRESSION` |
| Compiled expressions at the capacity they were compiled in (64 bytes, 16 ids) | 1,190 B | 825 B | at their size (`clone()`) |
| A `note.variables` Proxy, a `Map` and three wrappers per note, made by the end-time loops | — | 654 B | `hasExpression()`; one shared handler |
| A `Set` per note in each of the graph's nine maps | 861 B | 429 B | `IdSet` ([space](/developer/core/dependency-graph#space)) |

Evaluation got faster with it: a full evaluation of `voices-100000` in Node went from 344 to 221 ms
(p50). What is left, per note in Edge at 20,000 notes: the notes and their expressions about
1,100 B, the graph about 500 B, the renderer about 330 B, the evaluation records about 240 B, and
a whole-module string each for the undo history and the autosave's last write (about 155 B each).

The following table records the earlier memory pass in headless Edge, on `voices-*` modules served as the default module (load: until the module is
drawn; a commit: one octave step through the whole commit, `__rmtPerf.measureCommit()`, p50 once
warm; `sync()` and a redraw: `measureSync()`, `measureRedraw()`, p50; undo: until the restored
module is drawn; the heap before this pass in parentheses):

| Notes | Heap after load | Load | A commit | of it `sync()` | A redraw | Undo |
|---|---|---|---|---|---|---|
| 100,000 | 240 MB | 3.4 s | 83 ms | 65 ms | 14 ms | 2.2 s |
| 250,000 | 559 MB (1,475 MB) | 7.1 s | 203 ms | 179 ms | 35 ms | 6.1 s |
| 500,000 | 1,093 MB | 13.7 s | 535 ms | 453 ms | 71 ms | 13.4 s |
| 1,000,000 | about 2,300 MB, before a GC | about 63 s (208 MB, indented) | — | — | — | — |

So memory is no longer the first limit: a million notes load within a tab's heap (about 4 GB).
Two limits come before it:

- **The autosave.** Chromium refuses an IndexedDB value larger than 133,169,152 bytes (127 MB), and
  the autosave keeps the module as one string. `voices-500000` (79 million characters) is saved and
  read back in 0.65 s; `voices-1000000` (158 million) is refused, and so is the localStorage
  fallback (`QuotaExceededError`), so that session would not survive a reload. A module whose text
  holds any character above U+00FF is stored at two bytes per character, which halves the size it
  can reach.
- **Interaction time.** Work on an ordinary body edit follows the affected notes. A full
  import, a structural undo, complex instance geometry and a view containing every note
  can still scale with the score. A deferred save copies the full string into IndexedDB.

After an octave edit to the 500,000-note fixture, writing and reading back the single
IndexedDB value took 403 ms. Its 78,865,576 characters matched a fresh serialization,
and a page reload restored the edited expression. The name, expressions and other text in an arbitrary module can
change its byte length. The measurements support keeping the 500,000-note and 120 MB caps.

The autosave keeps the whole module in IndexedDB (`src/store/autosave.js`), far past what
localStorage could hold: `voices-100000` (15.5 million characters as JSON) is saved and restored
(`scripts/perf/check-autosave.mjs`). It used to be
`localStorage`, which holds about 5 MB per origin, and from a few tens of thousands of notes every
edit logged `[RMT] Autosave failed (history capture): QuotaExceededError …`.

## History

A Rust/WebAssembly evaluator (the crate `rmt-core`) existed for a time. In Phase D it was ported to
exact parity with the JavaScript evaluator and measured. It evaluated faster (about 1.15 to 2.1x on
small fractions, 5 to 6x on fractions of hundreds of digits; level with JavaScript on a first
evaluation of 300,000 notes), but an edit in the app cost the same on either engine, because
evaluation had become a small part of an edit; the memory that limits module size is in JavaScript
objects either way; and two engines doubled every change to evaluation. It was removed. The last
commit that has it is `a092ad5` in the git history.

## See also

- [WebGL2 renderer](/developer/rendering/webgl2-renderer)
- [Camera controller](/developer/rendering/camera-controller)
- [Picking](/developer/rendering/picking)
- [Theming](/developer/theming) — how `setConfig` / `setThemeColors` feed the same pipeline
- [Contributing setup](/developer/contributing/setup)
