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

::: warning The 100k headline is about rendering, not editing.
A 100,000-note module **pans and idles at 60 fps**. It does not *edit* at 60 fps: `sync()` — the
CPU rebuild that runs after every commit — costs **63 ms p50** at that size. Incremental `sync()`
(stable slots + `bufferSubData`) is the real remaining bottleneck and is still deferred. See
[Deferred](#deferred-and-not-shipped).
:::

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

### Evaluation — `npm run perf:bench` (Node, JS `BinaryEvaluator`)

| Module | Full eval (p50) | Mid-module commit (p50) | BaseNote edit (p50) |
|---|---|---|---|
| `chain-1000` (1000 notes, depth 1000) | 3.13 ms | 0.81 ms | 1.30 ms |
| `fan-1000` (1000, depth 1) | 1.47 ms | 0.01 ms | 0.92 ms |
| `lattice-1000` (1000, depth ~100) | 1.10 ms | 0.53 ms | 1.03 ms |
| `chords-dense` (800, depth ~4) | 0.67 ms | 0.35 ms | 0.65 ms |

## Idle is genuinely idle

With nothing happening, the renderer issues **zero draw calls**. Verified two ways: `who-dirties.mjs`
traps every write to `needsRedraw` over ~100 idle frames and reports *"(never — the canvas is
properly idle)"*, and `bench-render.mjs` reports **0/100 idle frames redrawn** at 5k, 20k and 100k
notes.

This does **not** mean rAF is descheduled. Both loops still tick every frame — the renderer's
(`renderer.js:501-505`) and the player's (`player.js:2112-2133`, which updates the DOM playhead and
measure-bar transforms). What is gated is the *body* of `_render()`:

```javascript
// renderer.js:2663
if (!this.needsRedraw) return;
this.needsRedraw = false;
```

That inner gate existed before, and did nothing, for two reasons. First, the passes layered on top of
`_render()` by the prototype wrappers ran unconditionally, so an idle frame still paid for all of
them — an outer gate now wraps the whole chain (`renderer.js:10725`; see
[the redraw gate](/developer/rendering/webgl2-renderer#the-frame-loop-and-the-redraw-gate)). Second,
two callers dirtied the scene on every frame. Both now short-circuit:

- **`setPlayhead()`** (`renderer.js:1262`) — `if (t === this.playheadTimeSec) return;`. `player.js`
  calls this every frame whether or not audio is playing; dirtying unconditionally kept
  `needsRedraw` permanently true.
- **`updateViewportBasis()`** (`renderer.js:551-555`) — an unchanged-basis early return. The
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
// renderer.js:589
sync({ evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId = null, tempOverrides = null })
```

`sync()` rebuilds the instance arrays (positions/sizes, colours, flags, fraction label strings),
rebuilds `_noteIdToIndex`, computes corruption flags, and uploads to the GPU. It runs on every
**commit** — and on a module load, an import, or a selection change. A **drag does not call it**:
moving notes are offset on the GPU through `setDragOffsetPreview()`, and `sync()` runs once, on the
drop. That is why the hub-drag trace above shows exactly one frame over 33 ms.

### The headline fix: O(N²) → O(N+E) corruption scan

`renderer.js:823-898`. The old code asked, for every note, *"does anything in my dependency closure
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
`renderer.js:871` for graph objects that lack `getCorruptedNotes` / `getDependents`.

Corruption is encoded in `_corruptionType` (a `Float32Array`, vertex attribute 7), which the note
shader turns into hatching:

| Value | Meaning | Visual |
|---|---|---|
| `0.0` | clean | none |
| `1.0` | transitive — depends on something corrupt | single 45° diagonal hatch |
| `2.0` | direct — corrupt, with no corrupt dependency | crosshatch |

See [Dependencies](/user-guide/notes/dependencies) for what corruption means musically.

### Cached zero-buffer

`renderer.js:1157-1161`. The per-sync region-buffer resets reuse a cached `_zeros4Cache`
`Float32Array` instead of allocating a fresh one each sync. It is only ever read, so it stays
all-zeros. Same GPU behaviour, no GC churn during a drag.

## The instanced pipeline

Everything that scales with note count N is a **single** `gl.drawArraysInstanced` call. There is no
DOM per note and no draw call per note.

| Pass | Where |
|---|---|
| Note bodies (`N = instanceCount`) | `renderer.js:2751` |
| Silence dashed rings, fraction dividers, pull-tab and arrow backgrounds | `renderer.js:6516`, `:6529`, `:7421`, `:7478`, `:7553` |
| Octave guides | `renderer.js:5153` |
| Measure bars and measure triangles | `renderer.js:5856`, `:5878` |
| Dependency link-lines | instanced, per-property buckets |
| All overlay text | glyph atlas run, `renderer.js:8746` |

The shared rect VAO (`renderer.js:2412-2501`) binds one per-vertex attribute — the unit quad
`a_unit` (location 0, divisor 0) — plus **six per-instance** attributes: `a_posSize` (1), `a_color`
(2), `a_tabRegion` (4), `a_flags` silence mask (5), `a_dragFlag` (6) and `a_corruptionType` (7).
Location 3 (`a_noteSize`) is still declared in the note-body shader but is no longer bound — note
CSS size is derived in-shader from `u_scale`.

This is why Phase 8 got reframed: the renderer was *already* batched, so the per-commit hotspot was
never draw-call count. The governing rule is **keep it O(visible), not O(module)**.

### The batched dependency-highlight ring pass

`_drawRingIdxList()` — `renderer.js:2548`. This is the one remaining per-instance loop that could
approach O(N): it fires when a highly-connected note is selected (a hub with ~1000 dependents) and
the scene keeps redrawing for other reasons (hover, playhead).

- **No drag active** (`renderer.js:2588`): `u_dragOffset` is `(0,0)` for every ring, so the whole
  bucket shares identical uniforms. The indices are gathered into one reused `_depRingBatch` buffer
  and drawn in **one** instanced call — 999 draws and 999 `bufferData` uploads collapse to 6 and 6
  per selection. It is pixel-identical: the ring shader reads only `a_posSize` per instance, and
  WebGL rasterises instances in order, so same-colour overlap blends the same.
- **Drag active** (`renderer.js:2622`): per-instance drag offsets differ (moving vs anchor vs
  static), so the exact per-instance loop is kept for correctness.

Three callers share it: the dependents rings, the full parent-chain rings, and the multi-selection
ring.

Ring colours (`renderer.js:2774-2792`) are property-specific — orange = frequency, teal = startTime,
purple = duration — and dim the properties a drag is *not* changing. Parent-chain rings are drawn at
`ringThicknessPxAtZoom1 × 1.5` (3 px), dependents at `× 1.0` (2 px), in the order startTime →
frequency → duration so overlapping dependencies all stay visible.

### Viewport culling

`renderer.js:6847-6878`. The per-note overlay loop — pull tab, interval arrows, fraction divider,
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

**This cull is what makes 100k notes tractable.** Without it, overlay cost scaled with the size of
the module; with it, it scales with what is actually on screen. (Note bodies need no cull — they are
one instanced draw regardless.)

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
- `renderer.setDragOffsetPreview` (`renderer.js:3624`) re-derived `_dragMovingIds` plus an index
  array it then **sorted** — every move. Now short-circuits on an identity check against the
  caller's `Set`.
- `renderer.setDragOverlay` (`renderer.js:9642`) rebuilt a `Set` via `movingIds.map(Number)` every
  move. Now identity-checked, with an allocation-free exact content comparison as the fallback.
  Deliberately *not* a size-only test — that would be unsound.

Per-frame allocations removed from the drag render path:

- **Dependency-line endpoints** were accumulated into boxed JS arrays and copied into fresh
  `Float32Array`s every frame (~20,000 elements *per property* at 5,000 dependents). They now go
  into pooled, growable `Float32Array`s that hand out `subarray` views (`_linkWriter`,
  `renderer.js:9473-9507`). A steady-state drag now allocates **nothing**.
- The "legacy combined" deps/rdeps arrays were built with `push(...spread)`, converted, uploaded
  every frame — **and never drawn from**. Removed.
- `getChildrenTreeByAllProperties()` re-ran a full BFS every pointermove, allocating an edge object
  per dependent per property. It is a pure function of the anchor plus module structure, neither of
  which a drag changes, so it is now cached on `anchorId|_posEpoch|_sceneEpoch`
  (`renderer.js:10129-10136`) — any real edit still invalidates it.
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

- `Workspace.pickAt(clientX, clientY, expandCssPx = 2)` (`workspace.js:2111`) tries
  `renderer.pickAllAt()` first, which always exists.
- `RendererAdapter.pickAllAt` (`renderer.js:9109`) resolves measure triangles (top) → base circle →
  note stack.
- `RendererAdapter.pickAt` (`renderer.js:3363`) is a **reverse linear scan** over `_instanceNoteIds`
  (last-drawn is top-most), with a fast world-space AABB reject followed by a precise rounded-rect
  test so corners do not select.
- `hitTestSubRegion` (`renderer.js:3426`) resolves *which* sub-region of a note was hit (pull tab,
  arrow column), and only runs once a body hit is confirmed.

There is **no spatial index**, and measurement says none is warranted: 0.31 ms per call at 100,000
notes. See [Picking](/developer/rendering/picking).

## Cheap history

`src/store/history.js`.

- Snapshots are stored as **minified JSON strings**, not parsed object graphs (~3–5× less retained
  heap). Each restore `JSON.parse`s fresh, giving the same isolation the old deep-clone did.
- The old 2–3× per-action serialize was deduped: `captureSnapshot` serializes **once** and shares one
  `snapshotStr` between the history capture and the localStorage autosave (`player.js:6515-6516`).
- Two caps, both in `_enforceCaps()` (`history.js:30-38`): a count cap of **50** entries and a byte
  cap of **12 MB**. The byte cap drops oldest but always keeps **≥ 2** entries, so undo survives even
  one enormous snapshot.
- `canUndo()` is `_undo.length > 1` — the bottom entry is the "Initial" seed. Any new capture clears
  the redo stack.
- Restore goes through the proven `loadFromJSON` path. Events: `history:capture`,
  `history:seedIfEmpty`, `history:undo`, `history:redo`, `history:requestRestore`,
  `history:stackChanged`.

Full reverse-patch undo was considered and **declined**: it does not reduce the dominant per-undo
cost (recompile + re-evaluate) and it would add the most delicate correctness surface in the app.

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
headline: the entry chunk is ~111 kB gzipped, the renderer ~54 kB, and the (unused-by-default)
WASM binary 147 kB.

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
| `hub-5000` | Drag worst case — one anchor with 4,999 direct dependents (`.t` and `.f`) |
| `voices-5000` / `voices-20000` / `voices-100000` | Render-scaling ladder — 8 voices, dep depth ≤ 200, spread across time and frequency so the viewport cull is exercised |

Frequency ratios cycle through a **product-1 sequence** (3/2, 4/3, 1/2) so exact fractions stay
bounded at any depth — fraction.js uses doubles, and an unbounded product like `(81/80)^1000` would
overflow.

::: warning The `voices-*` modules are gitignored.
100,000 notes is a 16 MB JSON file, so `public/modules/perf/voices-*.json` is not in the repo. Run
`npm run perf:gen` before any render benchmark, or it will fail to fetch its module.
:::

### Node evaluation benchmark

```bash
npm run perf:bench                       # default module
node scripts/perf/bench-node.mjs chain-1000
```

This measures **evaluation only** — Node has no renderer. It runs the JS evaluator.

### In-browser harness: `?perf`

Start the dev server (`npm run dev`, port **3000**) and open
`http://localhost:3000/?perf=1`. That lazily imports `src/dev/perf-harness.js` (a separate 6 kB
chunk that is never downloaded otherwise) and exposes `window.__rmtPerf`, plus
`window.__rmtRenderer` and `window.__rmtWorkspace`.

| Method | Does |
|---|---|
| `loadStress(name)` | Fetches `modules/perf/<name>.json`, writes it to the `rmt:moduleSnapshot:v1` boot key, **reloads the page** |
| `restoreDefault()` | Clears that key, reloads → default module |
| `measureEval(n = 10)` | `invalidateAll()` + a full `evaluateModule()` |
| `measureCommit(n = 10, noteId?)` | True end-to-end commit: emits `player:octaveChange` up+down (expression rewrite → dirty marking → evaluate → renderer sync → history snapshot) |
| `measureSync(n = 20, selId?)` | Times `renderer.sync()` in isolation |
| `measureRedraw(n = 30, selId?)` | Times a full forced `_render()` |
| `measureIdleFrame(n = 60)` | Cost of a frame with `needsRedraw = false` |
| `profileFrame(n = 30, selId?)` | Per-pass breakdown — wraps each named pass, reports ms/frame |
| `pickHubNoteId()` | Finds the most-connected note (worst case for the ring pass) |
| `report()` | Runs eval + commit + sync + redraw, prints a `console.table` |

::: danger `loadStress()` replaces your stored composition.
It overwrites the `rmt:moduleSnapshot:v1` localStorage key and reloads. If you run it in a session
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
| **Incremental `sync()`** (stable slots / `bufferSubData` bookkeeping) | **Deferred.** This is the real remaining bottleneck — `sync()` is 63 ms p50 at 100k notes, so editing a module that size is not interactive. |
| **Reverse-patch undo history** | **Declined.** Poor risk/reward; it does not reduce the dominant per-undo recompile+eval cost. Undo restores via a full `loadFromJSON`. |
| **GPU picking** | **Not shipped.** `picking.js` is a self-described scaffold: no ID pass is ever drawn, `begin()`/`end()` have zero call sites, and `Workspace.pickAt` tries `pickAllAt()` first (which always exists), so the GPU branch is unreachable. All picking is CPU-side. |
| **Measure-triangle outline batching** | Intentionally skipped — bounded by measure count M ≪ N. |
| **Spatial index for picking** | Not warranted by measurement. |
| **WASM evaluator** | **Opt-in only and currently unusable.** `?evaluator=wasm` hangs the main thread inside the WASM binary on a full re-evaluation. Every number on this page is the JS evaluator. See [WASM overview](/developer/wasm/overview). |

## See also

- [WebGL2 renderer](/developer/rendering/webgl2-renderer)
- [Camera controller](/developer/rendering/camera-controller)
- [Picking](/developer/rendering/picking)
- [Theming](/developer/theming) — how `setConfig` / `setThemeColors` feed the same pipeline
- [Contributing setup](/developer/contributing/setup)
