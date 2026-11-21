# RMT Compose v2 release review

The documented source is `c21f71efc9c591a68e9bb431b8f8c54174ca3aa2` from `origin/v2`. The published-main comparison is `730364962280abb1881c37c5c14ff91a704f4b86`. The review branch is `codex/v2-docs-release`. It includes the End default for module drops (`07a325c`) and the group-copy fixes through `41ac83d`. The initial documentation review was recorded at `17fa2ff`. The regression results below cover the updated branch. The package version is still 1.0.0.

- [Ranked changes since main](../docs/release-notes.md)
- [Prompt for the subsequent TypeScript port](typescript-port-brief.md)
- [Composer walkthrough](../docs/getting-started/first-composition.md)
- [Benchmark conditions and enforced limits](../docs/developer/performance.md)

## Coverage

The inventory came from the Markdown files on disk and was checked against the built routes and sitemap. It includes the README, home, section indexes and tutorial landing pages. The 94 existing site pages were reviewed. The canon-and-cadences tutorial and the ranked release notes bring the site to 96. The independent browser crawl followed links from rendered pages, including the navigation.

| Section | Pages reviewed |
|---|---|
| Repository | [README](../README.md) |
| developer/api | [binary-expression](../docs/developer/api/binary-expression.md), [event-bus](../docs/developer/api/event-bus.md), [midi-export](../docs/developer/api/midi-export.md), [module](../docs/developer/api/module.md), [note](../docs/developer/api/note.md) |
| developer/architecture | [data-flow](../docs/developer/architecture/data-flow.md), [module-system](../docs/developer/architecture/module-system.md), [overview](../docs/developer/architecture/overview.md), [rendering](../docs/developer/architecture/rendering.md) |
| developer/audio | [audio-engine](../docs/developer/audio/audio-engine.md), [audio-graph](../docs/developer/audio/audio-graph.md), [instruments](../docs/developer/audio/instruments.md), [reverb](../docs/developer/audio/reverb.md), [streaming](../docs/developer/audio/streaming.md) |
| developer/contributing | [build-and-deploy](../docs/developer/contributing/build-and-deploy.md), [code-style](../docs/developer/contributing/code-style.md), [pull-requests](../docs/developer/contributing/pull-requests.md), [setup](../docs/developer/contributing/setup.md) |
| developer/core | [binary-evaluator](../docs/developer/core/binary-evaluator.md), [dependency-graph](../docs/developer/core/dependency-graph.md), [expression-compiler](../docs/developer/core/expression-compiler.md), [symbolic-power](../docs/developer/core/symbolic-power.md) |
| developer | [index](../docs/developer/index.md), [performance](../docs/developer/performance.md), [theming](../docs/developer/theming.md) |
| developer/rendering | [camera-controller](../docs/developer/rendering/camera-controller.md), [picking](../docs/developer/rendering/picking.md), [webgl2-renderer](../docs/developer/rendering/webgl2-renderer.md) |
| getting-started | [concepts](../docs/getting-started/concepts.md), [first-composition](../docs/getting-started/first-composition.md), [index](../docs/getting-started/index.md), [installation](../docs/getting-started/installation.md) |
| Site root | [index](../docs/index.md), [release-notes](../docs/release-notes.md) |
| reference/expressions | [fraction-api](../docs/reference/expressions/fraction-api.md), [module-api](../docs/reference/expressions/module-api.md), [operators](../docs/reference/expressions/operators.md), [syntax](../docs/reference/expressions/syntax.md) |
| reference | [glossary](../docs/reference/glossary.md), [index](../docs/reference/index.md), [module-schema](../docs/reference/module-schema.md), [settings-reference](../docs/reference/settings-reference.md) |
| reference/properties | [amplitude](../docs/reference/properties/amplitude.md), [attack-release](../docs/reference/properties/attack-release.md), [duration](../docs/reference/properties/duration.md), [frequency](../docs/reference/properties/frequency.md), [start-time](../docs/reference/properties/start-time.md) |
| tutorials/advanced | [complex-dependencies](../docs/tutorials/advanced/complex-dependencies.md), [index](../docs/tutorials/advanced/index.md), [microtonal](../docs/tutorials/advanced/microtonal.md), [symbolic-power](../docs/tutorials/advanced/symbolic-power.md) |
| tutorials/beginner | [major-scale](../docs/tutorials/beginner/major-scale.md), [major-triad](../docs/tutorials/beginner/major-triad.md), [rhythm](../docs/tutorials/beginner/rhythm.md) |
| tutorials | [index](../docs/tutorials/index.md) |
| tutorials/intermediate | [dependencies](../docs/tutorials/intermediate/dependencies.md), [index](../docs/tutorials/intermediate/index.md), [measures](../docs/tutorials/intermediate/measures.md), [octaves](../docs/tutorials/intermediate/octaves.md) |
| tutorials/workflows | [canon-and-cadences](../docs/tutorials/workflows/canon-and-cadences.md), [index](../docs/tutorials/workflows/index.md), [intervals](../docs/tutorials/workflows/intervals.md), [microtonal-experiments](../docs/tutorials/workflows/microtonal-experiments.md), [module-library](../docs/tutorials/workflows/module-library.md) |
| user-guide | [index](../docs/user-guide/index.md) |
| user-guide/interface | [keyboard-shortcuts](../docs/user-guide/interface/keyboard-shortcuts.md), [mobile](../docs/user-guide/interface/mobile.md), [module-bar](../docs/user-guide/interface/module-bar.md), [settings](../docs/user-guide/interface/settings.md), [themes](../docs/user-guide/interface/themes.md), [top-bar](../docs/user-guide/interface/top-bar.md), [variable-widget](../docs/user-guide/interface/variable-widget.md), [workspace](../docs/user-guide/interface/workspace.md) |
| user-guide/modules | [creating-modules](../docs/user-guide/modules/creating-modules.md), [exporting-midi](../docs/user-guide/modules/exporting-midi.md), [loading-modules](../docs/user-guide/modules/loading-modules.md), [module-format](../docs/user-guide/modules/module-format.md), [module-library](../docs/user-guide/modules/module-library.md), [saving-modules](../docs/user-guide/modules/saving-modules.md) |
| user-guide/notes | [creating-notes](../docs/user-guide/notes/creating-notes.md), [dependencies](../docs/user-guide/notes/dependencies.md), [editing-notes](../docs/user-guide/notes/editing-notes.md), [expressions](../docs/user-guide/notes/expressions.md), [selection](../docs/user-guide/notes/selection.md), [transposing](../docs/user-guide/notes/transposing.md) |
| user-guide/playback | [audio](../docs/user-guide/playback/audio.md), [instruments](../docs/user-guide/playback/instruments.md), [tracking](../docs/user-guide/playback/tracking.md), [transport](../docs/user-guide/playback/transport.md) |
| user-guide/tuning | [12-tet](../docs/user-guide/tuning/12-tet.md), [19-tet](../docs/user-guide/tuning/19-tet.md), [31-tet](../docs/user-guide/tuning/31-tet.md), [bohlen-pierce](../docs/user-guide/tuning/bohlen-pierce.md), [custom-tet](../docs/user-guide/tuning/custom-tet.md), [equal-temperament](../docs/user-guide/tuning/equal-temperament.md), [ratios](../docs/user-guide/tuning/ratios.md) |

## Build and browser results

| Check | Result |
|---|---|
| Root clean install, `npm test` and `npm run build` | Passed on Windows with Node 24.22.1. All 22 test scripts completed, including 13 group-copy regressions and validation of the 81-module library. |
| `node scripts/gen-canon-parts.mjs --check` | Passed. The two shipped canon parts agree with the generator. |
| `npm run docs:build` at the root and independent `npm ci` / `npm run build` inside `docs/` | Both VitePress builds passed. VitePress emitted its bundle-size advisory for a chunk over 500 kB. |
| `node scripts/perf/check-docs-rendered.mjs` with the built site on localhost:4173 | All 11 sampled routes passed with zero reported console or network errors. |
| Full built site | 96/96 routes, 1,240 heading instances, 5,598 internal link instances (3,443 in navigation), 1,956 fragment references, 45 rendered image references and the social image. Zero failures or orphaned routes. Desktop navigation and search, phone menus, canonical and social URL changes on client navigation, and the app’s Docs link passed. |
| Published examples | Across the README and 96 pages, 1,733 concrete DSL occurrences (481 distinct) compiled and evaluated with seeded references. All 37 intentionally invalid or retired occurrences were rejected. Schematic identifiers and prose examples were classified separately. Four complete score examples and six contextual score excerpts loaded and evaluated, with 68 finite fields. |
| Library | Verified all 81 catalog names, 46 interval ratios and cents, 11 chord pitch sets, the pitches and durations of all eight progressions, seven melodies, six scale systems, and the three canon modules. Checked startup and library IDs independently. |
| Screenshots | `scripts/perf/shot-docs.mjs` captured 23 images from the running app. Checked them in the published layout at 1366 × 900 and 390 × 844. The note-widget image rendered at 300 px wide at both sizes. The article, hero, mobile and settings images fit their columns. The two older screenshot URLs show the updated workspace. |

The full site checker and detailed example records were run from temporary review tools. The eleven-page sample and the capture tools are part of the repository. Dependency auditing at review time reported 10 findings in the root development dependency tree (2 moderate, 8 high) and 9 in the separate docs development tree (2 moderate, 7 high). Both `npm audit --omit=dev` runs reported zero. The lockfiles are unchanged from the documented source.

## Composer checks

- **First composition.** Opened the startup canon in a fresh browser and played it. Changed note 10’s written duration, saved, and saw note 11’s onset move from 0.30 to 0.75 s. Undo restored 0.30 s. Both playbacks produced audio. Downloaded the edited JSON.
- **Pitch and voicing.** In bar 5, changing note 81 from `(2/3) * [83].f` to `(3/4) * [83].f` raised the green A and the red F by `9/8` and left the following E stationary. The corresponding library IDs are 127, 23 and 24. The four sounding voices of V7–I were checked against the evaluated file. The prepared Wi-Fi development listening room served both canon clips and all eight progression comparisons.
- **Desktop and touch editing.** Exercised Shift-click toggles, Shift-drag beginning over a note, tap and drag after a touch hold, and selection of a measure triangle. Moved a linked mixed group by 0.45 s, changed its duration, copied it to Custom, dragged the tile back into the score, deleted and undid. Checked note-only fields against a mixed selection. Confirmed drops on a note, on a measure and on BaseNote with both placement choices. Fresh and older mode-less layouts chose End, and saved Start and End both restored.
- **Preferences and transport.** Changed the visible detail cutoff above and below the current view count. Verified the 1,536 default, the Never warning and disabled number field, both X/Y sliders and their persisted numeric values, the default instrument and the live tempo commit. Start/pause/resume, click-to-seek, looping, repeat transposition, stop, output limiting and click-free fades were exercised in the transport harnesses. The fade check used two seeks in a 64-voice chord.
- **Persistence and export.** Downloaded module JSON and MIDI, opened the saved score, restored the default canon and used Undo/Redo to cross that reset. The IndexedDB harness verified legacy migration, reload immediately after an edit, saving an undo, retaining an unloadable session and localStorage fallback. A generated 100,000-note fixture produced an approximately 15.5-million-character saved score that also survived a reload.

## What the performance figures measure

The **500,000-entry history check** was rerun in Node 24.22.1 with forced GC and an 8 GiB heap limit. Twenty duration edits were undone and redone. Every score and snapshot hash matched. The final autosave text had 78,865,596 characters. Clearing older checkpoints released 2,701,096 bytes (2.58 MiB) with the score and latest checkpoint retained. This is a history and serialization measurement. [History implementation and separate browser frame timings](../docs/developer/performance.md#history)

The **44,307-note playback result** comes from the earlier Chrome comparison recorded at `da23273`. Its archived before/after reports identify the same score by SHA-256 `17a513ce39ff47dd88cacee554197cf9d51548fb1c0a0d68d8f8a42ea343c409`. There were 44,307 sounding entries in 44,371 records, written at 100 BPM, played at 300 BPM through the end. Chrome 157.0.8103.79 reported 48 kHz output on Windows with an RTX 3080. The 47.7 s capture included the tail. Both builds submitted every onset on time. The earlier run accumulated 27.27 s of device underruns. The revised build had at least 90 ms of scheduling lead, zero clipped samples, zero unexpected silent 20 ms windows and one 8.6 ms startup underrun, also observed in the idle control. The release audit checked these original reports. A fresh **shipped-canon** run in the same Chrome version at 300 BPM delivered all 153 sounding entries, at least 100 ms lead, zero clipped samples or unexpected gaps and one 8.7 ms device underrun. [Audio measurement method](../docs/developer/audio/streaming.md)

## Standalone group-copy regressions

The earlier build reproduced both pitch changes through the file loader. A pair at 330/660 Hz reopened at 440/880 Hz when the BaseNote’s pitch source was omitted, and at 330/880 Hz when the second note used a spaced internal reference. On the corrected production build, Playwright selected both notes with Shift-click, clicked **Copy to Modules**, reloaded the browser, downloaded **Save UI**, and opened the embedded Custom module through the file input. Both scores reopened at **330/660 Hz**. Changing the relevant anchor in the widget to 350 Hz moved the pair to **350/700 Hz**. Recreate an affected older tile from the source score. [Composer instructions](../docs/user-guide/notes/selection.md#when-a-copy-will-be-opened-on-its-own)

All four production browser cases passed. The third dropped a copied reference containing a DSL comment into a score with a colliding ID. The child followed the imported note, and the host note stayed at 110 Hz. The fourth dropped a phrase onto a note ending at 10 seconds. Its two notes began at 10 and 13 seconds, lasted 1 and 3 seconds, and both evaluated to 330 Hz, including the pitch calculated from the first note’s start. [Browser regression script](../scripts/perf/check-group-copy-pitches.mjs)

The model tests cover exact and approximate anchors, expressions that read start times, live internal links, a BaseNote whose inputs are copied and ordered file export. Across 116 full and partial selections drawn from all 81 shipped library modules, all 2,936 defined per-note properties matched their source values after accounting for the new time origin. The existing five-note copy/drop round trip passed all 14 checks, and mixed note/measure drops passed all six Start/End and target combinations. [Model regressions](../scripts/test-group-copy.mjs)

The published-main and v2 tips were fetched again at handoff. The proposed major release version is **2.0.0**. The version bump, merge and publication await the maintainer’s approval.
