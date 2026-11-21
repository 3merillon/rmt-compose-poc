# Performance and supported limits

A note count alone says little about playback or editing. A long score with one changing voice, a sustained chord, and a short loop shown fully zoomed out exercise different parts of the app. The import limits below are enforced. The measurements describe specific fixtures and machines.

## Limits

| Boundary | What v2 accepts |
|---|---|
| Score import | Up to 500,000 entries in the `notes` array on the UI import paths. A measure or reference occupies an entry too. |
| Load Module file | Up to 120 MiB (125,829,120 bytes), checked before parsing |
| Individual note ID | Up to 16,777,215. IDs above 65,535 use a wide reference instruction. |
| Score history | Up to 50 states, with a 12 MiB budget for additional retained history. The latest checkpoint and its immediate predecessor can outlive the budget. |
| Audio voices | **Most voices at once** offers 128 through 4,096, default 256. The engine prefers fading release tails. A larger chord can keep its sustained notes. |
| Visible detail | Default 1,536 visible notes, adjustable in Appearance. This affects labels and controls while composing. |

See `src/limits.ts`, `src/binary-note.ts` and `src/store/history.ts` for the enforced boundaries. Browser storage also has quotas. Autosave writes one score string, whose byte length depends on its text. A score within the loading limits can still encounter memory or storage pressure. [Saving a score](/user-guide/modules/saving-modules)

## The measured picture

A paired edit/render benchmark used local Vite servers and headless Microsoft Edge on Windows, 1,600 × 900, with a fresh browser context per size. It compared the starting revision `c14d112` with the subsequent editing pass. Below are the resulting times for the `voices-*` fixtures. The warm edit times end when the handler returns, before the deferred IndexedDB write. Restore times include two animation callbacks after restoration.

| Operation | 100,000 notes | 250,000 notes | 500,000 notes |
|---|---:|---:|---:|
| Fetch through the frame after the first instanced draw | 2.69 s | 5.52 s | 12.18 s |
| Retained JavaScript heap after autosave and GC | 211 MB | 477 MB | 938 MB |
| Warm single octave edit | 2.0 ms | 2.9 ms | 3.6 ms |
| Undo through the restored frame | 31 ms | 64 ms | 122 ms |
| Redo through the restored frame | 40 ms | 84 ms | 138 ms |

The same series measured 311 ms to drop a dragged chain note and 508 ms to drop a hub with 4,999 direct dependents at 500,000 entries. A structural undo can require reloading the whole score. The cost of either action differs from a warm edit to one expression.

A separate dense-view test fitted 500,000 short notes into 1,280 × 800 in Edge on an RTX 3080. Tracking and panning had an 8.4 ms 95th-percentile frame interval with zero late scheduled starts in that fixture. Scheduling lead and graphics frame times describe different things from audio device underruns. For the 44,307-note Chrome test at 300 BPM, including the captured output and the device’s startup underrun, see [Streaming scheduler measurements](/developer/audio/streaming#verifying-a-change).

## History

Checkpoints share 128-ID pages of canonical note text. A scoped ordinary edit serializes changed rows. A compatible restore can replace changed records and invalidate their dependents. A topology change, incompatible reference changes or noncanonical order can take the full-load path. The budget counts shared pages once. Undo and redo move existing checkpoints between stacks. A new edit clears the redo branch.

**500,000-note undo/redo check.** For this release, Node 24.22.1 ran `scripts/perf/bench-history.mjs` on the generated `voices-500000.json` fixture with `--expose-gc --max-old-space-size=8192`. It made 20 duration-expression edits spread across the IDs, undid all 20, then redid all 20. Each restored live score and snapshot matched the expected SHA-256 of the canonical score text. The final autosave string was 78,865,596 characters. Clearing the older history after forced GC released 2,701,096 bytes of V8 heap (2.58 MiB) with the live score and latest checkpoint retained. This checks in-place history and serialization in Node. The browser restore-to-frame measurements appear separately above.

## The benchmark harness

```sh
npm run perf:gen
npm run perf:bench
node --expose-gc --max-old-space-size=8192 scripts/perf/bench-history.mjs
```

`perf:gen` creates the large files under `public/modules/perf/` in the checkout. Keep them out of release builds. To generate into a separate scratch directory, pass its path to `node scripts/perf/generate-stress-module.mjs` and pass the resulting `voices-500000.json` path to the history runner.

For browser experiments, run a dev server in a disposable profile or origin. `?perf=1` exposes `window.__rmtPerf`. `loadStress(name)` replaces the saved composition and reloads. `restoreDefault()` returns to the shipped score. Export any composition you want to keep first.

| Question | Harness |
|---|---|
| Was the same edit applied? | `compare-edits.mjs` compares exact values, checkpoints, autosave and renderer buffers between servers. |
| How long did the view or gesture take? | `bench-render.mjs`, `bench-drag.mjs`, `bench-pick.mjs` and `bench-dense-playback.mjs` exercise different fixtures. |
| Does rendering converge? | `converge.mjs` and `visual-regress.mjs` check equivalent scenes, including glyph reuse and active previews. |
| Does the score survive a reload? | `check-autosave.mjs` exercises the browser store and its fallback. |
| What reached audio output? | `check-file-audio.mjs` compares scheduled entries, post-master audio windows and device statistics. |

These scripts live under `scripts/perf/`. Check each script’s usage line for its URL, browser and fixture arguments. [Development setup](/developer/contributing/setup)
