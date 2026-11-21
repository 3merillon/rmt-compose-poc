# RMT Compose 2.0.0 TypeScript port verification

The comparison starts at `03b1d49c541ec296d9341ec64cb532591e8da19a`. After fetching origin, the prepared worktree and `origin/main` both pointed at that commit. The port was developed on `codex/v2-typescript-port` in `C:\GitHub Projects\rmt-compose-typescript-port`. Both packages retain version 2.0.0. Commit `c60377a` records the port comparison before the library revision below.

## Reproduce

Run `npm ci`, `npm run typecheck`, `npm test`, `node scripts/gen-canon-parts.mjs --check`, `npm run build` and `npm run docs:build` at the root. For a standalone documentation install, run `npm ci`, `npm run typecheck` and `npm run build` in `docs/`. The root suite, type check, canon check and production builds were exercised on Node 20.19.0 and 24.22.1. npm was 11.3.0 on the development installation. Windows browser checks used Playwright Chromium 149.0.7827.55, Edge 158.0.4370.33 and Chrome 157.0.8103.79. The workstation had an i7-12700F and an RTX 3080 with ANGLE D3D11.

| Lockfile SHA-256 of Git contents | JavaScript release | Port |
|---|---|---|
| Root | `ebbf7ae2f4ac5a11622fc11683cd25005905cf9570099e3667157dc242726ecf` | `b4313d3770d6632132a279a617e555d95fbabc8a28e99af803698113be044972` |
| Docs | `c8d871634a20ebddb3edc306cb1dfe86cc674c6f2fc056354e05fb7141c4787c` | `d4d411e8c80d51608700c0f81e0b054cccedbb2b0355db0e92b61568cb045419` |

For a two-revision check, install each worktree's dependencies. Start Vite on different loopback ports, with disposable browser contexts. Keep source files stable during a run. Vite's hot updates can create a second module instance when a probe imports an older URL. These commands take the comparison worktree or origins explicitly.

```sh
node scripts/perf/compare-scores.mjs "<release worktree>"
node scripts/perf/check-first-composition.mjs <release-url> <port-url>
node scripts/perf/compare-edits.mjs --before <release-url> --after <port-url> --module defaultModule
node scripts/perf/check-group-copy-pitches.mjs <port-url>
node scripts/perf/shot-docs.mjs --url <port-url> --out "<scratch>/doc-images"
node scripts/perf/check-docs-rendered.mjs <docs-preview-url>
node scripts/check-doc-citations.mjs
```

## Executable inventory and interfaces

Every path from `git ls-tree -r --name-only 03b1d49` ending in `.js` or `.mjs` has a same-directory, same-stem `.ts` implementation. This maps all 156 executables individually. The original application contained 46,370 JavaScript lines and the Node scripts contained 16,516. The audit also covered the two HTML entry points, Vue scripts, executable templates and browser-injected functions.

| Release files | Count | Destination and runtime |
|---|---:|---|
| Top-level `src/` modules | 13 | TypeScript model, evaluator and application entry points |
| `src/dev`, `dsl`, `instruments`, `menu`, `midi`, `migrate` | 1, 10, 4, 3, 1, 2 | Same directories and names with `.ts` |
| `src/modals`, `player`, `renderer/webgl2`, `settings`, `store` | 7, 7, 7, 3, 4 | Same directories and names with `.ts` |
| `src/theme`, `ui`, `utils`, `value` | 2, 1, 14, 1 | Same directories and names with `.ts` |
| `vite.config.js` | 1 | `vite.config.ts` and Vite's production chunk rules |
| `scripts/*.mjs`, `scripts/perf/*.mjs` | 31, 44 | Typed tests, migrations, generators, sample tools, benchmarks and Playwright harnesses |
| Existing VitePress configuration and theme entry, Vue layout and translation component | 4 | Two `.ts` modules and two Vue `lang="ts"` scripts, checked with `vue-tsc` |

The release's 75 Node paths remain callable on the supported Node versions. The 77 checked `.mjs` files, including the two new comparisons, register the pinned erasing loader and load their sibling TypeScript source. Two also forward their original dense-gesture exports. The executable inventory contained zero explicit TypeScript `any` nodes, file suppressions or unchecked application JavaScript. Browser, Node and Vue sources use strict checking. Node's DOM types cover the code Playwright serializes into a page.

The app entry is `/src/main.ts` during development. Browser probes that interact with the store use the app's origin. Raw-source audio comparators intentionally keep their own stable JavaScript URLs. Their route handler compiles the selected worktree's TypeScript or serves the selected Git revision's JavaScript. The PCM meter formerly embedded in a template is a typed AudioWorklet in `scripts/perf/score-meter.ts`. The 44 GLSL sources match the release in content and order. HTML markup, CSS, images, audio, score and deployment JSON, the sitemap source and the Python citation utility retain their native formats. Third-party code remains installed from the lockfiles.

The persisted score, autosave, settings and MIDI formats keep their release interfaces. The new contracts distinguish rational, symbolic and approximate values, optional note fields, model IDs, bytecode, graph edges and typed event payloads. Narrow interop sites include checking parsed input records, associating a listener with its event key, WebGL resources established during setup, the dynamic note-variable proxy, and DOM controls or debug hooks required by a mounted test fixture. Callers that require a missing-value sentinel can still pass a null fallback at the floating-point boundary.

## Musical, editing and playback results

- **Scores.** All 88 tracked scores under `public/modules` and all eight legacy fixtures matched in canonical save text and evaluated records. The comparison includes each variable’s kind and exact text, IDs, note kinds, ordered dependency IDs, per-expression references and corruption/approximation flags. Combined SHA-256 was `5924e0d2a0648786e104f92d1b9b5f9ab8084c60997634bdeaa64fd701e57e2f`. The validator passed all 81 library manifest entries. Model tests cover forward and cyclic references, perfect roots, twelve exact semitones, explicit approximations, rests, measures and reference notes.
- **First composition.** In fresh desktop and touch profiles, editing note 10's duration from `3/20` to `3/5` moved note 11's start from `3/10` to `3/4`. Undo restored `3/10`. Reopening the downloaded JSON restored `3/4`. Both builds produced signal before and after the edit. The four downloads shared SHA-256 `0cacf3158559376467233e7ef831ae67071403fa412d3ecbc61d11e98d35a48b`. Initial and edited history hashes were `638dcc822b766dda61f54e64830c45beb2c2bf58d4f1cfd7042cb27eeb04b20a` and `c0bfb2d5b8ca71c43ac399eb366756b359b29f918e0f747a486861167e4b3c85`.
- **Editing and storage.** Both builds matched at each of 26 checkpoints for the canon and for 5,000 voices, including evaluated data, renderer buffers, autosave and history. All four group-copy regressions passed. The reopened octave was 330/660 Hz and followed its anchor to 350/700 Hz. All six Start/End drop targets passed. Both builds passed 81/81 multiselect, 75/75 settings, 14/14 mobile viewport, 14/14 copy, and 21/21 toolbar checks. Library reorder, collapse and persistence agreed. Across 76 paired UI screenshots, the largest area with a channel-level difference over 8 was 0.08984%. The autosave tests covered migration, fallback, immediate reload, undo and a 100,001-record score with 15.5 million serialized characters. In that run, the baseline/candidate IndexedDB write held the main thread for 15.3/17.1 ms and completed 73/66 ms after the edit.
- **Audio and MIDI.** The live transport, fades, loop/repeat, seek, pause/resume, live tempo, inheritance, pure/tempered and envelope checks passed. Across 88 offline PCM renders, the largest sample difference was approximately `2.4e-7` of full scale. The audio oracle passed 36/36 checks including source-count-aware comparisons. The exported canon MIDI files were byte-identical at 2,940 bytes, SHA-256 `7e9f3e112c6d9b0b471326c8b6aadee181af5c0a30ea2062c272e7e35f8809fc`.
- **Historical playback reproduced.** The original score had 44,371 records and 44,307 sounding notes, 8,163,935 bytes, SHA-256 `17a513ce39ff47dd88cacee554197cf9d51548fb1c0a0d68d8f8a42ea343c409`. At 300 BPM in Chrome 157 at 48 kHz, both recorded 4,577,280 channel samples, all 44,307 starts across 874 matching onset groups, a 100 ms minimum scheduling lead, zero late starts, zero clips and zero unexpected silent windows. Peaks were 0.8411984/0.8410245. One early output-device underrun occurred on each run, 8.7/9.9 ms. The idle control also produced one 9.9 ms underrun. First scheduling took 238.0/190.3 ms.
- **Generators and deployment.** The four score generators produced 95 byte-identical JSON files. The migration and library-rewrite commands also matched on copied fixtures. With the same 29 licensed source WAVs and FFmpeg 6.1.1, all 32 outputs matched after building and after tuning. The tuned outputs also matched the released Git blobs. Production preview served all 138 tracked public files byte for byte and passed all four group-copy regressions. Both versions generated all 23 documentation screenshots. All 96 documentation HTML routes were served and 11 rendered pages passed image/content/console checks on each build. Source citation checks exercised full, short and invalid references.

## Timing, rendering and memory

The 500,000-note history input was 78,865,553 bytes, SHA-256 `6e788b3c147b3d895ae75eeaa240bf69882b04a7c1bfb656b63f8181ddefc8ea`. Twenty undos and twenty redos matched their expected canonical hashes in each worktree. The final autosave had 78,865,596 characters. Clearing old history after forced GC released 2,701,024 bytes on the release and 2,701,096 bytes on the port.

Thirty-nine scenes passed the existing image tolerance at 1,280 × 800. Twenty were identical on the first pair. The largest difference was 30 of 1,024,000 pixels, with a largest channel difference of 15. A release/release control differed by up to 42 pixels with the same largest channel difference. Successive forced redraws changed at most two pixels on either version. The renderer-tail checks matched at 2,501 points and 40 marquee rectangles for each score.

All six short dense-view runs kept every note visible, with zero late starts in the fixed-view, tracking and panning phases. Release frames had p50/p95 of 8.3/8.4 ms in each case. The port matched that at 5K and 20K. At 100K it reported 8.3/8.4 ms fixed and 8.3/8.5 ms while tracking and panning. For the hub drag, release and port p50/p99 were 8.3/10.6 and 8.3/10.3 ms. Both recorded zero frames over 33 ms. At 100K, `pickAt` measured 0.002 ms on both.

Three short 5K render runs reported median per-run sync p50/p95 of 2.4/2.7 ms on the release and 3.6/4.3 ms on the port. A follow-up alternated eight fresh Edge processes, four per version, with 50 warmups and 100 measured syncs per process. Release per-process p50 ranged from 1.4 to 1.5 ms and p95 from 1.7 to 2.5 ms. Port p50 ranged from 1.3 to 1.5 ms and p95 from 1.6 to 1.9 ms. CPU profiles identified the same two dominant functions, `_syncInstances` and `toNumber`. The slower short-run result did not recur after warmup.

The Node evaluator benchmark ran in release/port/port/release order on Node 24.22.1. The table gives the two-run range of p50 values and the two-run range of p95 values, in milliseconds, for full evaluation (24 samples per run). The JSONL evidence also records mid-note edits (60 samples) and base edits (30). The machine was shared during verification, and the first release run had the widest spread.

| Fixture | Release p50 | Port p50 | Release p95 | Port p95 |
|---|---:|---:|---:|---:|
| Chain, 1,000 | 1.52–2.86 | 1.40–1.52 | 3.20–6.47 | 2.94–3.64 |
| Fan, 1,000 | 1.13–2.11 | 1.06–1.23 | 1.83–5.52 | 1.27–3.72 |
| Lattice, 1,000 | 1.21–3.08 | 1.28–2.37 | 1.92–4.11 | 1.79–5.10 |
| Dense chords, 800 | 0.61–0.64 | 0.57–1.03 | 0.84–1.51 | 0.74–1.52 |
| Comma chain, 400 | 88.40–125.97 | 94.73–128.79 | 95.94–177.68 | 103.12–182.00 |

| Visible notes | Serialized fixture bytes | SHA-256 |
|---:|---:|---|
| 5,000 | 476,241 | `ed2e4e520e3093208cd9d3862a5125f2421b8cab89c6dbbf72b0f4774d4787a4` |
| 20,000 | 1,932,617 | `4889b8bc3de47d410f717f6c67456dc14d3977191b77f5cb029d1ac48bedbc4e` |
| 100,000 | 9,762,618 | `ebe5c6ede9b5800beb9b01439bd4eb7ff5ba0ba997696a801136cae47bae55d4` |

## Corrections identified against the release

### Built-in module drops

The eight progressions now use their sounding chord roots for pitch and timing. This removes 21 silent key changes while preserving the 70 sounding tones’ exact pitches, starts, durations and player relationships. The full canon tile omits eight measure markers and keeps all 153 sounding notes with their original library IDs. The startup score still carries the markers. Authored scores, uploads and copied selections retain their written contents.

The library test checks all 81 tiles and their 718 sounding notes. Independent browser drops of **I–IV–V–I** onto a 360 Hz note produced 13 sounding notes and zero reference lines in both Start and End modes. Every pitch, onset and duration matched the recorded values after applying the drop offset, including after reload.

Both engines produced the same saves and exact evaluations on all 96 original inputs and on the nine revised inputs. Edge also restored the nine revised factory tiles from a saved release layout over plain HTTP. A copied tile and a hand-edited tile kept their own score contents across two restores.

The nine revised tiles were rendered against the released JavaScript scores in Edge 158 at 48 kHz stereo. The 45 comparisons covered the written sine, violin and piano, including sped-up violin and piano. Scheduled attacks, slurs, envelopes and releases matched. Across 24,643,200 samples the largest absolute difference was `6.56e-7` of full scale, the same maximum observed when rendering the JavaScript release twice.

### Port corrections

| Reproduction | Corrected behavior | Commit |
|---|---|---|
| Bytecode `DUP` on a symbolic or approximate operand | Duplicates its value kind and contents | `0bd241e` |
| Transport end with symbolic or approximate measure times | Includes the measure in the calculated end | `bdaa230` |
| Repeat transposition by `2^(1/6)` or an explicit approximation | Schedules the evaluated pitch multiplier | `f5f098c` |
| Group ratio exceeding 53 bits | Keeps every integer digit during scaling | `0e11a68` |
| Removing a note with a numeric-string ID | Removes the same ID from graph and evaluation caches | `59baa77` |
| Dragging an anchor in the CPU fallback | Its dependent measure preview follows while the stored start stays fixed | `980d911` |
| Appending or dropping into a valid score containing ID `0xffffff` | Allocates free representable IDs, preserving dropped pitches on reopen | `21d76db` |
| Inherited JavaScript names in DSL field position | Rejects `base.constructor`, `base.toString` and `base.__proto__` during validation | `3f60217` |

The tool corrections cover vibraphone source counting, failing incomplete visual comparisons, identifying the real application entry in capture reports, and measuring inspector shrink at a height that fits the measure controls.

## Mobile search follow-up

The original release and port both clipped the library search hint at 390 px (13/14 touch module-bar checks). The follow-up uses `e.g. 3/2` at widths up to 440 px. In Chromium the hint measures 63 px and has 70 px of text space at 320 px and 140 px at 390 px. All 16 checks pass, including the check that widening the toolbar restores the longer hint and retains the current query.

## Verification environment

Full captures, fixture hashes, phase timings and logs were kept outside release assets in `%TEMP%\rmt-ts-port-evidence-03b1d49`. The generated 5K, 20K and 100K fixture links were removed after the probes. Both production roots were built independently of those files. The tracked files under `public/` and `docs/public/` matched the release at `c60377a`. The subsequent library revision changes nine score files under `public/modules/`. Desktop and touch replay on the Node 20 dev server also reproduced the download and history hashes above.

All task-owned loopback servers were stopped. The recorded port/PID pairs were 49457/14796 (release app), 59549/30620 (port app), 59553/21820 and 50566/28132 (stable probe servers), 51625/32756 (production app preview), 50197/31680 (release docs) and 56322/30048 and 56322/31664 (port docs, restarted after rebuilding the output), and 62340/22872 (Node 20 dev).
