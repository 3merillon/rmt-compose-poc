# Code conventions

The repository uses ES modules. Keep imports explicit, match the indentation of the surrounding code and use descriptive names for musical quantities. A time measured from the start of the score and an absolute Web Audio clock time can both be seconds, but converting one as though it were the other shifts entrances.

## Expressions and rewrites

Use the DSL for new expressions. Put compatibility transforms for old files in `src/migrate/`. When rewriting or simplifying, preserve the evaluated value, its exact or approximate status, and the dependencies the edit is meant to keep. Check both the score on screen and the file after a save/load round trip. [Expression compiler](/developer/core/expression-compiler) · [Exact values](/developer/core/symbolic-power)

## Editing and playback

Route an undoable edit through the existing history path. Supply the edited IDs when the scope is known so evaluation, rendering and history can reuse their unchanged records. Respect the existing full-load paths for structural changes. Follow the current note’s player when resolving an inherited instrument. [Data flow](/developer/architecture/data-flow) · [Audio engine](/developer/audio/audio-engine)

## Settings and documentation

Define setting defaults and validation together in `src/settings/settings-schema.js`. Consider an existing browser with a partial settings object and a fresh browser at factory defaults. Name the corresponding panel control and its effect in the [settings reference](/reference/settings-reference).

For measured claims, keep the benchmark and conditions together on the [performance page](/developer/performance). Composer pages should describe an action and what the reader can see or hear. Link to the implementation for readers who need the underlying mechanism.
