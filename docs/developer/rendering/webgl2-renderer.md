# WebGL2 renderer

`RendererAdapter` in `src/renderer/webgl2/renderer.js` turns the module’s evaluation cache into draw data. Its instance arrays contain geometry, colours and display flags. It also maintains a note-ID-to-slot index. An array slot belongs to the current scene and can change after a structural edit.

## Full and incremental synchronization

A full `sync` rebuilds the CPU instance data, indexes and GPU buffers. For simple bodies a compatible incremental request calls `evaluationChangesSince`, updates stable slots and uploads contiguous changed ranges with `bufferSubData`. Selection changes can add the old and new selected slots. Both routes use the same evaluated score.

A full synchronization is needed when the model or scale changes, the journal cannot cover the edit, a BaseNote or structural change invalidates the slots, or a scene requires complex geometry. Rests, drawn envelopes, release tails, previews and flagged values can take this path. A timing or pitch edit can also have many dependents. Use a fixture with the geometry and dependencies you intend to measure.

## Visible detail and picking

`InstanceRanges` indexes blocks of note instances for larger scenes. The renderer culls them against the view before drawing ordered runs. Its detail pass counts notes intersecting the viewport. At the default 1,536 they can still show their normal detail where it fits. Above that count, it draws detail for the hovered or individually selected note. Panning into a sparse part of the same score brings labels back. `Never` disables the count cutoff and can increase redraw time.

Bodies, rings, dependency lines, measure markers, tabs, arrows, envelopes and glyphs have distinct passes. Visible runs and batched highlights may require multiple instanced draws. The live marquee is a rendering operation. The final group and point hits use [CPU picking](/developer/rendering/picking).

## The frame loop and the redraw gate

The animation loop can tick without issuing draws. `needsRedraw` gates the work for an unchanged frame. Playhead updates and camera changes request redraws when their values change. During playback the renderer can reuse visible glyph instances across playhead frames. Moving a note, changing a label, scrolling or zooming invalidates the applicable cache.

### Epochs

Scene, position, camera, colour and drag epochs distinguish changes to score geometry, text and screen coordinates. A cache of positioned glyphs depends on both label content and the view. A drag preview must also move a relationship line’s endpoint and preserve the depth order of overlapping highlights.

## Runtime configuration

The theme manager sends note geometry, envelope and tail display options, detail cutoff and playhead colour to `setConfig`. It sends structural colours to `setThemeColors`. See [Theming](/developer/theming) for invalidation and [Settings reference](/reference/settings-reference) for user-facing defaults.

## Verifying a change

Run the visual-regression scenes against comparable baseline and candidate servers. Check both an unchanged frame and a frame that must refresh its cached glyphs. `converge.mjs` exercises convergence after changes. `bench-dense-playback.mjs` can drive real tracking, pan, pointer and marquee input with the whole fixture visible. Include browser, GPU, scale, fixture and timing boundary in a comparison. [Performance and harnesses](/developer/performance)
