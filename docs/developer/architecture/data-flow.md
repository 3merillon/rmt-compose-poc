# From an edit to sound and storage

Consider lengthening startup note 10. Its frequency stays where it was, but note 11 reads the end of 10 for its entrance. A successful edit has to update that timing in the editor, in a subsequent playback, in history, and on the next visit.

1. **Commit the expression.** The duration row in the widget validates the new DSL and checks whether the edited variable would come to depend on itself. A start and a pitch can read different properties of the same note. The model replaces the expression, registers its references and marks affected records dirty.
2. **Evaluate.** `Module.evaluateModule()` delegates to the incremental evaluator. A dirty note can reuse its compiled code when only an input changed. Values are resolved in dependency order for each *(note, property)*. The module retains the evaluated records and a bounded change journal. [Evaluator](/developer/core/binary-evaluator)
3. **Draw.** The player supplies the evaluation cache, selection and scale to the workspace. A compatible edit updates affected instance slots and GPU ranges. A structural edit or incompatible geometry takes the full synchronization path. Panning changes the view basis. [Renderer](/developer/rendering/webgl2-renderer)
4. **Remember.** A checkpoint stores canonical records with shared pages. Undo/redo restores a compatible edit in place or routes the score through the loader. The latest score text goes to IndexedDB after the edit’s display frame. [History](/developer/performance#history)
5. **Play.** Pressing Play prepares the notes from the parked score time. The engine converts the score positions and exact pitches at its output boundary, requests the necessary sample zones, then schedules voices on the Web Audio clock. Seeking parks the playhead. The next Play prepares the new passage. [Streaming](/developer/audio/streaming)

The workspace uses previews during a pointer gesture. The pointer-up commit is the point to compare the score’s expressions, history and saved text. A tempo-slider audition changes the score-to-clock mapping for playback. **Commit tempo** changes the score itself.
