# RMT Compose — Roadmap

> **Living document.** AI agents / contributors: read [Context for Fresh Sessions](#context-for-fresh-sessions) first, then find the first unchecked phase and continue. Update checkboxes and "Last touched" as you complete work. Append to the [Changelog](#changelog) — never rewrite history there.

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (reason inline)

## Phase overview

| Phase | Name | Status | Depends on |
|---|---|---|---|
| 0 | Foundations (this doc + perf harness) | `[x]` | — |
| 1 | Performance Core | `[x]`* | 0.2 |
| 2 | Settings Infrastructure | `[x]` | — |
| 3 | Theme System | `[x]` | 2 |
| 4 | Arrow Customization | `[x]` | 2 |
| 5 | Audio Overhaul | `[x]` | 2 (UI parts) |
| 6 | Module Library + Content | `[x]`* | 2 (icon size setting) |
| 7 | License → MIT | `[x]` | 5a (WAV replacement) |
| 8 | Performance Round 2 | `[ ]` | 0.2 |
| 9 | Docs Sweep | `[ ]` | incremental per phase |

Phases 3, 4, 5 can proceed in parallel after Phase 2. Phase 6 is mostly independent (content is data). Phase 7 is blocked **only** by replacing the two unknown-provenance WAVs (Phase 5a).

\* **Phase 1 `[x]`\***: the core evaluator fixes (P2-P5) shipped and hit the performance targets (6-38× faster, verified). P1 (WASM activation) is infrastructure-complete but its *activation* is blocked on a Rust hang (dossier in Phase 1); P6/P7/P8 are deliberately deferred (rationale in Phase 1) and re-homed into Phase 8. So Phase 1's goal is met; the leftovers are tracked, not forgotten.

---

## Context for Fresh Sessions

### What this app is

RMT Compose implements **Relative Music Theory** (https://cybercyril.com): notes are defined by fractional/relational dependencies on other notes — `frequency: "(3/2) * [1].f"` — all resolving to a single base note. One edit retunes/transposes everything downstream. Just-intonation ratios (3/2 fifth, 5/4 major third, 7/4 harmonic seventh) and TET systems (`2^(k/12)`, `3^(k/13)` Bohlen-Pierce) are both expressible. Works on desktop + mobile browsers; deployed on Vercel (app: rmt.world, docs: docs.rmt.world, separate deploys).

### Architecture map

- `src/player.js` (~264KB monolith) — app lifecycle, all eventBus handlers, note move/resize commit, dependency retargeting, octave arrows (`handleOctaveChange` ~line 3533), transport/audio wiring, 3 rAF loops.
- `src/renderer/webgl2/renderer.js` (~484KB, `RendererAdapter`) — instanced WebGL2 note rendering, overlays (arrows/tabs/labels), dependency lines, glyph-atlas text, GPU picking, drag-offset preview. `renderer.setConfig(partial)` exists at ~:280.
- `src/renderer/webgl2/workspace.js` — pointer/gesture handling → eventBus events; `camera-controller.js` — pan/pinch-zoom.
- `src/renderer/webgl2/renderer-config.js` — `defaultRendererConfig` (note.heightWU, borderPxAtZoom1, playhead.color…) + `normalizeRendererConfig`/`deepMerge`.
- `src/module.js` — `Module`: note store, dirty-set incremental evaluation, measure generation, JSON load/save.
- `src/note.js` — `Note` with compiled `BinaryExpression`s; `note.variables` is a Proxy (legacy compat).
- `src/binary-evaluator.js` — JS bytecode stack machine + `IncrementalEvaluator` (Kahn topo-sort) + `FractionPool`.
- `src/dependency-graph.js` — bidirectional dependency indexes + per-property (startTime/frequency/duration) subgraphs.
- `src/expression-compiler.js` (legacy format) and `src/dsl/*` (DSL format) — text → bytecode; `isDSLSyntax()` in `src/dsl/index.js` detects format.
- `src/wasm/*` + `rust/` — `rmt-core` WASM evaluator (evaluates in WASM memory, persistent cache). Vercel uses **committed** artifacts (`vercel.json` skips wasm-pack).
- `src/player/audio-engine.js` — Web Audio engine; `src/instruments/*` — synth + sample instruments.
- `src/menu/menu-bar.js` — module library (categories from `public/modules/<cat>/index.json`).
- `src/modals/index.js` + `src/modals/variable-controls.js` — note-widget editor UI.
- `src/store/history.js` — undo/redo snapshots; `src/store/app-state.js` — module/evaluatedNotes refs.

### Invariants (do not break)

- **Defaults preserve current behavior.** Every new config/setting surface must default to exactly today's visuals/behavior (this is the established `renderer-config.js` philosophy).
- **Two expression formats coexist**: legacy (`.mul()/.div()`, `module.getNoteById(N).getVariable('...')`) and DSL (`[N].t`, `base.f`, `beat(base)`, infix `* / + - ^`). Any code that mutates expressions must handle both (check `isDSLSyntax`).
- **Mobile first-class**: Pointer Events (not mouse/touch splits), 44px touch targets, `@media (hover:none)` fallbacks, no hover-only affordances. Pinch/pan gating in workspace.js + camera-controller.js must not regress.
- **eventBus conventions**: `player:*`, `modals:*`, `workspace:*` exist; new: `settings:changed`, `settings:loaded`, `wasm:ready`.
- **localStorage keys**: `rmt:moduleSnapshot:v1` (module autosave), `ui-state` (library layout), `rmt:atlas` (glyph atlas flag), new: `rmt:settings:v1` — versioned envelopes.
- **Module JSON schema**: `{baseNote:{frequency,startTime,tempo,beatsPerMeasure,...}, notes:[{id,startTime,duration,frequency,color?,instrument?}]}` — DSL string expressions. All imports must pass `validateModuleData` (menu-bar.js).
- New subsystems live in **new directories** (`src/settings/`, `src/theme/`, …); only surgical edits inside the player.js/renderer.js monoliths.

---

## Phase 0 — Foundations   `[x]`   Last touched: 2026-07-10 by Claude

**Goal**: this roadmap + measurement infrastructure before any optimization.

- [x] 0.1a ROADMAP.md at repo root (this file)
- [x] 0.1b README pointer to ROADMAP.md
- [x] 0.2a `scripts/perf/generate-stress-module.mjs` (`npm run perf:gen`) — emits stress modules into `public/modules/perf/` (not listed in library manifests): `chain-1000` (deep chain, product-1 ratio cycle to keep fractions bounded — fraction.js uses doubles, unbounded products overflow), `fan-1000` (all notes off `[1].f`), `lattice-1000` (10 chains × 100, cross-linked every 10th note), `chords-dense` (200 true-relational 4-note chords)
- [x] 0.2b `src/dev/perf-harness.js` — loaded only when `?perf=1` (hook in main.js); `window.__rmtPerf` = `{loadStress, restoreDefault, measureEval, measureCommit, report}`. `measureCommit` times a synchronous `eventBus.emit('player:octaveChange')` = TRUE end-to-end commit (expression rewrite + evaluate + renderer.sync + history). `loadStress` swaps the composition via the `rmt:moduleSnapshot:v1` boot path + reload.
- [x] 0.2c Node micro-bench `scripts/perf/bench-node.mjs` (`npm run perf:bench`) — module.js loads headless in Node; measures the JS evaluator path only
- [x] 0.2d Baselines recorded below

> **Correctness bug found & fixed during 0.2 (2026-07-10)**: `markDirtyOnly()` existed only on `WasmIncrementalEvaluator`, not on the JS `IncrementalEvaluator`; module.js guards those calls with `typeof === 'function'`, so on the JS path (the one that actually runs — see P1) **base-note edits never re-evaluated indirect dependents** (chain note 1000 stayed at its old frequency after a base-frequency change) and batch updates could under-evaluate. Fixed by adding `markDirtyOnly` to `IncrementalEvaluator` (binary-evaluator.js, next to `invalidate`). The pre-fix "base-note edit" timing was a fake 0.16ms because only 1 of 1001 notes was evaluated.

**Baselines** — Node bench (JS evaluator, fast desktop, p50; post-`markDirtyOnly`-fix so numbers are honest). Browser/WASM column to be filled via `?perf=1` when measuring P1:

| Scenario | Metric | Baseline (Node/JS) | After P2-P5 (Node/JS) | Speedup | After P6-P9 |
|---|---|---|---|---|---|
| chain-1000 | full eval (ms) | 19.5 | 3.2 | 6× | — |
| chain-1000 | mid-chain commit (ms) | 17.5 | 0.76 | 23× | — |
| chain-1000 | base-note edit (ms) | 34.5 | 1.17 | 29× | — |
| fan-1000 | full eval (ms) | 18.2 | 2.0 | 9× | — |
| fan-1000 | mid commit / base edit (ms) | 0.06 / 34.5 | 0.01 / 0.92 | — / 37× | — |
| lattice-1000 | full eval / mid commit (ms) | 18.9 / 17.5 | 1.1 / 0.53 | 16× / 33× | — |
| chords-dense (800) | full eval / mid commit / base edit (ms) | 12.5 / 11.4 / 23.5 | 0.66 / 0.36 / 0.62 | 19× / 32× / 38× | — |
| browser | end-to-end commit incl. renderer.sync | — | — | — | — |

Notable: P2 (drop the per-note whole-cache copy) drove the full-eval collapse; P3 (scope corruption flags to the dirty set) + P5 (skip graph re-registration when deps unchanged) killed the base-edit and mid-commit overheads. Everything now sub-2ms at 1000 notes on the JS path alone — the WASM path (P1, blocked) is no longer urgent for these sizes.

**Verification**: `npm run perf:bench` (Node) or `npm run dev` → `http://localhost:3000/?perf=1` → `__rmtPerf.loadStress('chain-1000')` → `__rmtPerf.report()`.

---

## Phase 1 — Performance Core   `[~]`   Last touched: 2026-07-11 by Claude

**Goal**: massive intertwined-dependency modules edit at interactive rates. Fix order matters; keep JS evaluator as fallback throughout.

- [~] **P1 Activate the WASM evaluator** — infrastructure DONE, activation **`[!]` blocked on a Rust-side bug** (see dossier below). What's in place:
  - Hot-swap: `Module._upgradeEvaluators()` (module.js) + `onWasmReady()` (src/wasm/index.js) swap the JS evaluator for the WASM one when async WASM init completes. Verified end-to-end by `scripts/perf/test-wasm-swap.mjs` (Node): swap works, values identical across engines, base-edit propagation works.
  - **Opt-in only**: the swap requires `?evaluator=wasm` (see `isEvaluatorHotSwapEnabled()`, evaluator-adapter.js). `?evaluator=js` forces JS. Default behavior = JS path = exactly pre-existing production behavior.
  - Artifacts: `npm run wasm:sync` copies `rust/pkg` → `src/wasm` (committed copy = what Vercel ships); chained into `wasm:build`. README script name fixed.

  **🔴 WASM PersistentEvaluator hang dossier (for a dedicated Rust debugging session):**
  - **Symptom**: with `?evaluator=wasm`, a full re-eval cycle (`incremental.invalidateAll()` → `evaluateDirty()`) hangs the main thread forever inside the WASM binary. CDP pause shows: `$func198` ← `$persistentevaluator_registerNote` ← wrapper `registerNote` (evaluator-adapter.js:724) ← `evaluateDirty` (:533). Hangs on the FIRST registration (note 0) after invalidateAll.
  - **Repro**: `npm run dev` → `http://localhost:3000/?perf=1&evaluator=wasm` → console: `__rmtPerf.measureEval(1)` → tab freezes (reproduced 3/3 in fresh headless Chromium).
  - **Ruled out**: artifact version (Jan-17 AND Jan-21 binaries both hang); Node runtime (identical sequences pass headlessly incl. exact browser race, default module, double register-invalidate-register cycles); isolated browser context (fresh PersistentEvaluator + same bytecodes incl. the legacy measureLength `[1,0,0,0,60,0,0,0,1,3,3,19,3,4,18]` + evaluate + invalidateAll + re-register: NO hang); serde input shape (plain objects/arrays).
  - **Key facts**: requires full app boot state (~170 notes registered+evaluated + swap warm-up); NON-deterministic (same manual sequence on the app's own evaluator instance passed once, hung other times) — smells like memory/allocator state or a data/hash-order-dependent loop in the Rust `PersistentEvaluator` (rust/src/evaluator.rs; `register_note` itself is trivial HashMap code, so suspect deeper state, serde-wasm-bindgen interplay, or UB). Rust toolchain IS available (cargo 1.87, wasm-pack 0.13.1). Suggested next step: instrument rust/src with a registration-counter/abort-guard build, or bisect rust commits fc2a67e/0eae71f behavior.
  - **Until fixed**: do NOT enable the hot-swap by default. The JS path (with P2-P5 below) is the performance workhorse.
- [x] **P2 Kill O(N²) cache copy**: dropped the per-note `new Map(evalCache)` (binary-evaluator.js `evaluateNote`) — now writes the in-progress result into the shared cache directly (topological order guarantees deps are final first). This was the single biggest win for full evaluation.
- [x] **P3 `_updateCorruptionFlags` scoped to dirty set** (module.js): captures the dirty ids before clear and updates flags only for them, not all notes every evaluate. Also added a reentrancy guard in `evaluateModule()` (bytecode CALL ops re-enter via `getEvaluationCache` — used to re-run the whole dirty set per callback).
- [x] **P4 Cache `Note.variables` Proxy** once per note (`this._variablesProxy` + per-var fn cache, note.js) — the getter allocated a fresh Proxy on every access on hot paths (renderer sync, drag commit, retargeting).
- [x] **P5 Skip dependency re-registration when deps unchanged** (module.js `_registerNoteDependencies`): keyed on `depsRegGeneration:id:depsEpoch` (epoch bumped on every expression mutation in note.js; generation bumped on graph clear/reindex). markNoteDirty re-registered ~15 graph maps for every dependent even on pure value edits; now a no-op when the note's compiled expressions are unchanged.

  **Results (Node/JS, verified `scripts/perf/bench-node.mjs` + correctness suite + live browser octave-edit): 6–38× faster.** chain-1000 full eval 19.5→3.2ms, mid commit 17.5→0.76ms, base edit 34.5→1.17ms; lattice mid commit 17.5→0.53ms; chords-dense base edit 23.5→0.62ms. Browser (`?perf=1`, default 170-note module): boots + renders correctly, octave edit 263→526→263 exact, end-to-end commit p50 0.8ms, rAF 2.6ms. All sub-2ms at 1000 notes on the JS path → WASM (P1) de-prioritized for these sizes.
- [x] **P9 Hygiene (partial)**: LRU-capped the compile cache at 4000 entries (`src/expression-compiler.js`) — drag/resize commits churn out unique fraction strings, so the old unbounded cache leaked memory over long sessions. Move-to-end on hit keeps the stable working set hot; verified cap holds + clones still correct. (Regex hoisting in retarget helpers — deferred, see below.)
- [~] **P6 / P7 / P8 — DEFERRED (with rationale), not needed at current scale.** After P2-P5, evaluation is sub-2ms at 1000 notes and the full browser commit *including* `renderer.sync` is 0.8ms p50 at 170 notes (projects to well under the 16ms frame budget at 1000). These three are now low-upside / non-trivial-risk:
  - **P6 incremental renderer.sync** — the biggest remaining O(N) cost, but it's deep renderer-buffer surgery (bufferSubData bookkeeping, instance-index mapping) with pixel-regression risk. Revisit only if profiling a genuinely huge module (5k+ notes) shows sync dominating a frame. Left as the primary Phase 8 item.
  - **P7 idle rAF gating** — `updatePlayhead`/`updateMeasureBarPositions` reposition DOM elements that must track the camera during pan/zoom, so naive gating causes measure-bar lag; they're cheap DOM transforms, so the battery upside is small. Needs a carefully-wired camera-dirty flag (hook `camera.onChange`) — do it as a focused task, not bundled.
  - **P8 cheap history** — reverse-patch snapshots would cut per-commit serialize cost + 50× retained memory, but undo/redo correctness is delicate. Worth doing, but sequence it deliberately with thorough round-trip tests; the current full-snapshot path is correct and, at these speeds, not a UX bottleneck.

**Acceptance**: ✅ mid-chain commit on lattice-1000 far under 16ms (0.53ms eval; ~sub-5ms projected incl. sync); ✅ zero visual diffs (verified in browser — default module renders identically, octave edit exact); ✅ correctness suite + live octave round-trip pass. WASM-active criterion N/A (P1 blocked; JS path meets targets alone).

**Decisions log**: P1 WASM hot-swap kept opt-in pending the Rust hang fix (2026-07-11). P6/P7/P8 deferred because P2-P5 already cleared the performance acceptance bar on the JS path; documented above so a later session can pick them up with full context (2026-07-11).

---

## Phase 2 — Settings Infrastructure   `[x]`   Last touched: 2026-07-11 by Claude

**Goal**: one persistent, validated, event-driven settings system that Themes / Arrows / Audio / Library all plug into. **DONE & verified in browser.**

- [x] `src/settings/settings-schema.js` — versioned defaults + `validateSettings`/`validateRatio`/`migrate`. Every default reproduces current behavior; reverb/stereo default **off**. Clamps ranges, enforces arrow ratio ∈ [1/16,16] & ≠ 1, derives reciprocal `down` from `up`.
- [x] `src/settings/settings-store.js` — singleton; localStorage `rmt:settings:v1`; `get/set(path,value)/setSection/resetSection/resetAll/subscribe/getAll`; emits `settings:changed {path,value,settings}` + `settings:loaded`; corrupt JSON → defaults. Re-validates the whole tree on every write. Unit-tested 10/10.
- [x] `src/settings/settings-panel.js` — modal from new "Settings…" entry in `#general-widget` (index.html) wired in main.js; tabs **Appearance | Arrows | Audio | Library**; live write-through, per-tab + global reset; Escape/backdrop dismiss. Self-contained CSS using `var(--rmt-*)` with orange fallbacks → auto-themes when Phase 3 lands. Mobile: full-screen sheet < 600px, sticky tabs, 44px targets.
- [x] `src/theme/presets.js` — 4 presets (classic-orange = pixel-exact current colors, + slate-cyan, mono-light, high-contrast). Data only; manager wiring is Phase 3.
- [x] Master volume + default instrument now persist under `audio.*`.

**Verified in browser** (headless Chromium + screenshots): panel opens from menu, all 4 tabs render correctly and match the app aesthetic, Fifth 3/2 chip → `arrows.up={n:3,d:2}` with live 1200.0¢ readout, **persists across reload**, resetAll restores octave, zero console errors. Settings have no visible/audible effect yet — consumers land in Phases 3/4/5/6.

**Decisions log**: reverb/stereo default-off to honor "defaults preserve current behavior" (2026-07-10). Panel CSS uses `--rmt-*` fallbacks now so it needs no rework when theming lands (2026-07-11).

---

## Phase 3 — Theme System   `[x]`   Last touched: 2026-07-12 by Claude

**DONE & verified in browser — full DOM + GL theming with granular per-color control.**
- [x] `src/theme/theme-manager.js` — resolves preset + overrides + geometry; projects to (1) `--rmt-*` CSS vars incl. RGB-component triplets (`--rmt-accent-rgb` etc.) for `rgba()` alpha forms, (2) `renderer.setConfig` for note geometry + playhead, (3) `renderer.setThemeColors` for GL structural colors. Wired in player.js; live via `settings:changed appearance.*`.
- [x] Comprehensive CSS migration to `var(--rmt-*, <fallback>)` — **hex AND rgba** across `public/styles.css`, `menu-bar.js`, `variable-controls.js`, `modals/index.js` (scrollbars, glows, translucent backgrounds, note-widget internals). Top/module-bar backgrounds use `--rmt-bg-rgb` so they harmonize. `:root` literal defaults (CRLF gotcha caught twice — tokens literal, no nested-var artifacts).
- [x] **GL theming** via `renderer.setThemeColors`: base circle + border, **horizontal octave/BaseNote dashed guide lines** (uniform path AND the instanced `_octInstColor` path that actually draws them), note-id glyph+canvas labels, measure-triangle ids, base fraction label. Canvas-textured labels invalidate their cache on color change. Helpers `_accentRgba()/_accentHex()/_noteBorderRgba()`.
- [x] **Note geometry** (height/border/corner) via setConfig + re-sync.
- [x] **Granular per-color control**: Appearance tab has **15 color pickers** (Interface/Workspace/Dependency groups) writing sparse `appearance.overrides`; preset dropdown applies a full set + clears overrides; "Reset colors to theme".
- **Verified**: 4 presets recolor all DOM + themed GL; a custom `#ff00aa` accent + `#101014` bg override applies to DOM and GL simultaneously; reset restores orange; zero console errors; classic-orange pixel-identical to pre-theme.

**Not themed (intentional):** note *body* colors are per-note user data. Legacy unused `playheadProgram` shader keeps baked orange (dead path; real playhead is config-driven). Regular-note border grey left neutral (base-circle border is themed).

**Original plan (for reference):**

**Goal**: one theme JSON → CSS custom properties (`--rmt-*`) for DOM **and** renderer-config partial via existing `renderer.setConfig` for GL.

- [ ] `src/theme/theme-schema.js` — tokens: accent, accentText, bg, surface, surfaceBorder, textPrimary/Secondary, danger, playhead, measureBar, selectionRing, hoverRing, 6 dependency-highlight colors (source/target × normal/drag/resize), noteDefaultSaturation, newNoteColorMode; geometry: noteHeightWU, borderPxAtZoom1, cornerRadius.
- [ ] `src/theme/presets.js` — `classic-orange` (pixel-identical to today; read exact dep-highlight values from renderer.js:2355-2368), `slate-cyan`, `mono-light`, `high-contrast`.
- [ ] `src/theme/theme-manager.js` — `applyTheme(themeId, overrides)`; subscribes to `settings:changed` `appearance.*`.
- [ ] Renderer: extend renderer-config with `colors` section (defaults = current literals); convert hardcoded `#ffa800`/grey/white shader literals → uniforms (renderer.js:1311, 1593, 2159, 2355-2368, 4811-12, 6673, 6907); wire `setConfig` from theme-manager (construction site: workspace.js:100).
- [ ] CSS migration (pixel-neutral recipe): (1) add `:root{--rmt-*}` block with current values; (2) replace literals with `var(--rmt-*)` across `public/styles.css` (68× #ffa800 + others) and menu-bar.js inline styles; (3) only then wire switching.
- [ ] New-note color mode (player.js:2235, note-creation.js:501) + hsla fallback saturation (renderer.js:2733-2736) consult theme.
- [ ] Appearance tab UI: preset dropdown, grouped token pickers, note height (12–40 WU) / border (0–4px) / corner radius sliders; overrides = sparse diff in `appearance.overrides`.

**Verification**: classic-orange screenshot-diff vs pre-phase = identical; live switch during playback with selection; geometry changes at 3 zooms; persist + reset.

---

## Phase 4 — Arrow Customization   `[x]`   Last touched: 2026-07-11 by Claude

**Goal**: arrows apply a user-chosen interval (default octave), toggleable off entirely. **DONE & verified in browser.**

- [x] Mutation: `handleOctaveChange` (player.js) now reads `arrows.up`/`arrows.down` from `settingsStore` (default octave), early-returns if `!arrows.enabled`. All 4 downstream branches (numeric/DSL/.pow/legacy) untouched — already ratio-generic.
- [x] Toggle-off — all three surfaces: `renderer.drawNoteArrows` flag gates (a) the batched background pass, (b) the ▲/▼ glyph draw (with an explicit `else if (isSilence)` so an arrows-off non-silence note draws *neither* arrows nor a silence ring — the subtle bug the plan flagged), and (c) the `octaveUp/octaveDown` hit-test regions (no ghost click zones). DOM widget buttons hidden when disabled + tooltips show the interval ("Transpose up ×3/2"). Wired from player.js on boot + live via `settings:changed`.
- [x] Arrows tab (built in Phase 2): enable toggle, mode radio, n/d steppers with live cents, quick-picks (2/1, 3/2, 4/3, 5/4, 9/8, 81/80), validation in the store.

**Verified in browser** (headless Chromium + screenshots): default octave up doubles 263→526; **Fifth 3/2 up → 263×1.5=394.5 with `(3/2) *` prepended to the DSL expr; reciprocal down restores exactly**; arrows disabled → octaveChange is a no-op AND the ▲/▼ glyphs+backgrounds vanish from every note (notes otherwise render identically — no spurious silence rings); toggle back on restores them; zero console errors.

**Deferred (minor)**: drawing the custom ratio *as a label on the GL arrow itself* (e.g. "3/2" under ▲). The arrows still show ▲/▼ and the active interval is surfaced via the note-widget button tooltips + the Settings panel, so the feature is fully usable; the on-arrow label is a cosmetic enhancement for a later pass (needs extra glyph-run layout in the overlay).

**Decisions log**: gated via a renderer `drawNoteArrows` boolean (not `setConfig`) — simpler, and `setConfig` was still unwired at the time; Phase 3 can fold it into config if desired (2026-07-11).

---

## Phase 5 — Audio Overhaul   `[ ]`

**Goal**: high-quality synthesis, real multisampled instruments (open licenses), room/spatial rendering with settings.

### 5a Sample replacement (unblocks Phase 7)   `[x]`   Last touched: 2026-07-12 by Claude

**DONE & verified in browser.** Both instruments now sourced from **VSCO2 Community Edition (CC0)** — user changed the piano source from Salamander (CC-BY) to VSCO2 upright at build time (2026-07-12) to keep a single uniform CC0 license + avoid a 488 MB tarball download; violin unchanged. This keeps the MIT relicense (Phase 7) trivially clean.

- [x] Sources: **VSCO2 CE "Upright Nr1"** → `piano` (14 zones, roots C/G per octave, `mf` layer); **VSCO2 CE "Solo Violin — Arco Vib"** → `violin` (15 zones, roots G/A/C/E per octave, `f` layer). Both CC0. `public/samples/CREDITS.md`.
- [x] Format: mono AAC `.m4a` ~96 kbps (Safari-safe). `scripts/build-samples.mjs` (`npm run samples:build`, documented, reproducible): resolves exact source files from the VSCO-2-CE GitHub tree, downloads, ffmpeg trims leading silence + caps 3.5 s with a tail fade + downmixes mono + encodes AAC. Total output **1.3 MB**.
- [x] `public/samples/<name>/manifest.json`: `{schema:1, name, displayName, license, gainDb, envelope, zones:[{root, rootHz, lowHz, highHz, url}]}`. Zone frequency spans are geometric-mean boundaries between adjacent roots. **Velocity-ready:** schema reserves an optional `zones[].velLayers[]` (ignored today) so a future note-dynamics feature adds layers without a migration.
- [x] `src/instruments/multisample-instrument.js` (NEW): manifest-only fetch at registration (fixes the old eager WAV fetch); lazy per-zone decode; `prepare(freqs)` preloads exactly the zones upcoming notes hit (wired into `preparePlayback`); nearest-zone selection + small pitch-shift + anti-alias filter; **network-fail → sine oscillator fallback**; same voice/`createOscillator` contract.
- [x] Registered as `piano`/`violin` (unchanged names → saved modules + inheritance keep working). Deleted `public/instruments/samples/*.wav`.

**Verified (headless Chromium, fresh server):** piano+violin register with CC0 license + 14/15 zones; `prepare()` decodes the needed zones; `createOscillator` returns sampled (buffer-backed) voices, not the oscillator fallback, across low/mid/high frequencies; full module plays with `piano` as default (15 active voices); zero console errors.

**Known limitation:** no sample looping yet — a held note longer than its (~3.5 s capped) source plays out then goes silent for the remainder. The manifest reserves a `zones[].loop` field; pre-baked crossfade loops are a later enhancement (matters most for very long sustained violin notes).

### 5b Signal graph + room + synth quality   `[x]`   Last touched: 2026-07-12 by Claude

**DONE & verified in headless Chromium (graph structure + OfflineAudioContext click-scan + play-through).**

- [x] `src/player/audio-graph.js` (NEW): `voice → voiceGain(env) → StereoPanner → instrument bus → {dry, reverbSend → preDelay → Convolver → reverbReturn(wet)} → masterGain → limiter(−6dB/knee6/ratio12) → destination`. Single consumer of `audio.*` settings (subscribes to `settings:changed`); lazy per-instrument buses; limiter reconnect on toggle. `audio-engine.js` now owns an `AudioGraph`; `_scheduleNote` rewritten (voice→gain→panner→bus, stop-past-zero + robust cleanup); `nodes()` keeps back-compat keys (generalVolumeGainNode=masterGain, compressor=limiter).
- [x] `src/player/reverb.js` (NEW): algorithmic IR via OfflineAudioContext (stereo **decorrelated** noise → L/R corr ≈ 0, exp decay `e^(−t·ln1000/decaySec)`, damping = tail lowpass sweep + gentle HP, early reflections in `roomSize·80ms`); DelayNode pre-delay (live, no regen); IR regen debounced 250 ms + token-guarded against stale overwrites.
- [x] Pitch-driven pan `clamp(log2(f/baseF)/3,−1,1) × width`, baseF from evalCache note 0; `panPos` computed in preparePlayback, width/enable applied live at schedule; StereoPanner skip-if-absent.
- [x] Synth quality: shared `applyVoiceEnvelope` (abs attack/release floors 3/15 ms, exponential decay/release, hard-zero-then-stop → click-free — verified maxJump≈0.007 on sine, clean 0 tails); unified `makeVoice` wrapper contract (fixes the old sample-wrapper onended/disconnect leak); ±4¢ 3-osc unison + pitch-tracked lowpass on saw/square; new `fm-epiano` (2-op FM); organ/vibraphone keep periodic waves + new envelope core.
- [x] Audio tab wired & live: master volume (transport slider now initializes from + persists to `audio.masterVolume`), default instrument, reverb params, stereo, limiter. Relabeled: "Wet / dry"→"Reverb amount" (0%=dry…100%=wet), "Stereo"→"Stereo width" / "Spread notes by pitch".
- [x] **Default instrument** actually reaches inheritance: base note (id 0) no longer hardcodes `'sine-wave'` (note.js:30 + module.js) so `findInstrument` resolves it (and everything inheriting) to `_defaultInstrumentName` (default 'sine-wave' → behavior unchanged); `audio.defaultInstrument` drives it via `setDefaultInstrument` (module.js), Node-bench-safe (no settings import in module.js).

**Adversarial review (15-agent workflow) → fixed:** (1) `pauseFade`/`setMasterVolume` `cancelScheduledValues` without a `setValueAtTime(g.value,now)` anchor → click on pause / master-volume change (spec: bare linearRamp interpolates from the stale past event); (2) `pauseFade`'s deferred `stopAll()` was uncancelable → a quick pause→play let the stale timer kill the new playback — now cancel+resolve in `_stopStreaming`.

**Remaining for 5b verification (needs real device):** iPhone Safari / Android Chrome click/dropout check; the offline click-scan + graph asserts are the desktop proxy done so far.

**Verification (5a, pending)**: 169-note canon + piano + reverb on iPhone Safari / Android Chrome / desktop ×3 — no clicks/dropouts; pause fade with natural convolver tail; live param sweeps during playback; legacy saved modules still sound; network-fail mid-load → oscillator fallback.

---

## Phase 6 — Module Library + Content   `[x]`*   Last touched: 2026-07-12 by Claude

**Goal**: organized, searchable, icon-rich library; full interval/chord/progression/melody catalog with TRUE relational dependencies. **6.1–6.5 DONE & verified in browser (`[x]`* = only a real-device iOS/Android touch-drag pass remains, same caveat as Phase 5).** 79 shipped modules, all pass `npm test`.

- [x] **6.1 Manifest v2**: single top-level `public/modules/library.json` = `{version:2, sections:[{id,label,items:[{file,name,ratio?,cents?,family?,tags?}]}]}`. `menu-bar.js` loader branches: v2 object → section-driven build; missing/legacy Array → the old per-category `index.json` path (kept as fallback). ui-state migration (`libraryVersion` marker) rebuilds built-in sections from the manifest while **preserving the user's `custom` section, user-created sections, and rescuing uploads** dragged into built-ins; built-ins now store a re-fetchable `file` (fileless/uploaded modules still embed JSON → small localStorage). Verified: cold-load, pre-v2 migration, reload stability.
- [x] **6.2 SVG icons**: `src/menu/icon-factory.js` — procedural family-hued tiles: stacked fraction + cents for intervals, **name + ratio caption for chords** (so `4:5:6` is captioned under "Major"), TET step `n\d`, name for melodies/progressions/scales. Ink auto-contrasts per hue → legible on all 4 themes (verified light + dark). Size + cents visibility from `library.iconSizePx`/`library.showCents` (static + live via `settingsStore.subscribe`); dnd ghost + placeholders scale to match. Replaces the 42px text square in `createModuleIcon`.
- [x] **6.3 Interval catalog** — generator `scripts/gen-interval-catalog.mjs` (`npm run gen:intervals`) emits **46 single-note modules** (`frequency "(N/D)*base.f"`) with computed cents into the manifest. 3-limit (11), 5-limit (10), 7-limit (10), higher/11–23-limit (9), commas (6). Cents cross-checked by the validator.
- [x] **6.4 TRUE relational chords + progressions** — generator `scripts/gen-chords-progressions.mjs` with a **generation-time self-check** that resolves every note to an exact BigInt ratio-from-base and asserts the intended root motion + that only the first root touches base. **11 chords** (major, minor, dom7=36:45:54:64, harm7=4:5:6:7, min7, maj7, dim, aug, sus4, RMT base-3 3:5:7:9, base-5 5:7:9:11) as root-subtrees; **8 progressions/cadences** (V7-I, ii-V-I, I-IV-V-I, I-vi-IV-V, authentic/plagal/deceptive/half). Verified: octave-shift-first-root doubles every note (all 19), cents structure musically correct, real drop-import onto base AND note re-roots with the root chain intact. dom7 seventh set to 16/9 (canonical 64/45 dominant tritone) per a 3-agent harmony review.
- [x] **6.4b Melodies + scale systems** — generator `scripts/gen-melodies.mjs`: **7 relational public-domain melodies** (Ode to Joy, Twinkle, Frère Jacques, Amazing Grace, Greensleeves, Bach Minuet in G, Scarborough Fair; each note `(scale-degree)*base.f`, timing from `base.t` → transposes/re-roots on drop) verified against the canonical tunes by a 7-agent workflow. Moved TET-12/19/31 + BP-13 + Mixed-Base into a new **Scale Systems** section, added the **Tesla** scale (base-3 odd harmonics over the 9th harmonic, extended to 81 notes = 3^4: odd numbers 9…169 over 9; chained so each step is the next-odd/current-odd — 11/9, 13/11, … 169/167 — tapering toward unison across ~4.23 octaves), dropped the redundant rational `12.json`, unshipped `test`/`test3`, removed the old melodies `V7-I`/`V-I` (now in Progressions/Cadences).
- [x] **6.5 Menu UI + npm test**: collapsible sections (chevron, click/tap, persisted; shrink-only re-fit keeps the pull-tab consistent on desktop + mobile touch), sticky search box (name/ratio/cents/tags/family; reveals matches in collapsed sections). dnd/touch-ghost/`validateModuleData` intact. `npm test` → `scripts/validate-modules.mjs` validates every manifest module (structure + expression syntax + **self-contained** + evaluates finite + interval ratio/cents cross-check). **79/79 modules pass.**
- [x] **6.6 Stale-layout robustness** (bug found in use): a stored v2 ui-state pinned the old built-in module list, so after a content update the library rehydrated deleted file paths → 404s / failed icons, and `libraryVersion===2` blocked re-migration (only incognito showed the new layout). Fixed three ways: (1) manifest fetched `cache:'no-store'` (stale HTTP-cached `library.json` was the incognito-only cause); (2) `reloadModuleIcons` busts the in-memory manifest cache; (3) new `reconcileWithManifest()` heals any stored layout against the current manifest on **every** load — drops removed modules, refreshes kept built-ins' meta, appends new modules/sections — while preserving the user's custom section + uploads. Verified: a stale v2 state (old interval files) heals to the current 46-interval catalog with 0 failed icons / 0 404s, custom + uploads preserved.

**Verification status**: ✅ every shipped module imports onto note AND base (self-contained, validator); ✅ octave-shift a progression's first root → whole progression follows (all 19 chord/prog modules, Node + real browser drop); ✅ search filters by name/ratio/tag; ✅ pre-v2 ui-state migrates AND stale v2 state reconciles to current content (no 404s), reload-stable; ✅ icons render under light + dark themes; ✅ collapsible sections + pull-tab work on desktop and (headless) mobile touch. ⏳ **remaining: a real iPhone Safari / Android Chrome touch-drag pass** (headless Chromium touch verified as the desktop proxy).

---

## Phase 7 — License → MIT   `[x]`   Last touched: 2026-07-12 by Claude

**DONE.** Relicensed the whole project to the **MIT License** (© 2026 Cyril Monkewitz), replacing the previous bespoke personal-use license.

- [x] Audited bundled binaries/fonts: app UI font Roboto Mono (Apache-2.0, loaded from Google Fonts at runtime, not redistributed); sampled instruments VSCO-2 CE (CC0); no other shipped binaries carry obligations.
- [x] MIT text in `LICENSE.md`, `rust/LICENSE.md`, and `public/license.html` (URL kept alive, now renders MIT). License fields set to `MIT` in `package.json`, `package-lock.json`, and `rust/Cargo.toml`. README §License rewritten; `index.html` footer link relabelled "License (MIT)"; docs footer (`docs/.vitepress/config.ts`) + `docs/user-guide/interface/top-bar.md` updated. (`docs/index.md` carries no license wording — the docs-visible string is the VitePress footer.)
- [x] Added `THIRD_PARTY_NOTICES.md`: fraction.js (MIT), VSCO-2 CE samples (CC0, see `public/samples/CREDITS.md`), Roboto Mono (Apache-2.0), plus a docs-build note (VitePress MIT / Inter OFL). Code = MIT; media assets carry their listed licenses. No per-file headers. **Note:** the earlier plan named Salamander (CC-BY) for the piano, but both instruments ended up sourced from VSCO-2 CE (CC0) in Phase 5a, so there is no attribution obligation.
- [x] Repo-wide purge of the previous license's identifier tokens — including this document, which was reworded so the verification grep is genuinely clean.

**Verification**: the old license's identifier tokens no longer appear anywhere in the repo; `npm pkg get license` = `"MIT"`. Confirmed 2026-07-12.

---

## Phase 8 — Performance Round 2   `[ ]`

- [ ] Batch rings/dep-lines/measure-bars into single instanced draws (renderer.js:2313-5478 currently per-instance draw + bufferData).
- [ ] Rollup `manualChunks` to split renderer/player bundles.
- [ ] Re-run harness; update Phase 0 baseline table.

---

## Phase 9 — Docs   `[ ]`

- [ ] New: `docs/developer/performance.md`, `docs/guide/settings.md`, `docs/guide/themes.md`, `docs/developer/theming.md`, `docs/guide/instruments.md` (with sample credits), `docs/guide/library.md` + progression-design explainer (RMT pedagogy).
- [ ] **Rewrite `docs/developer/audio/audio-engine.md`** — currently documents unset compressor params and a nonexistent `dispose()`.
- [ ] Update note-editing guide for custom arrows; `docs/index.md` legacy example → DSL; license wording.
- [ ] Finish `docs/REVIEW-PLAN.md` phases 10–20 for all touched files.
- [ ] README: fix `build:wasm` → `wasm:build`; add ROADMAP pointer; MIT section.

---

## Changelog

- **2026-07-12** — **Phase 6 COMPLETE** (Module Library + Content), verified in browser. **v2 manifest** (`public/modules/library.json`, single top-level `{version:2, sections}`) with a loader that branches to the legacy per-category `index.json` array as a fallback; ui-state migration + a new `reconcileWithManifest()` heal any stored layout against the current manifest (preserving the user's custom section + uploads). **Procedural family-hued SVG icons** (`src/menu/icon-factory.js`, theme-aware, size/cents from `library.*` settings; chords show name + ratio caption). **Content generators** (`scripts/gen-interval-catalog.mjs`, `gen-chords-progressions.mjs`, `gen-melodies.mjs`) emit **79 relational modules**: 46 intervals (3/5/7/higher-limit + commas, computed cents), 11 chords + 8 progressions/cadences as root-subtrees (generation-time self-check asserts root motion + only-first-root-touches-base; dom7→16/9 per a 3-agent harmony review), 7 workflow-verified public-domain melodies, 6 scale systems (TET-12/19/31, Bohlen–Pierce, Tesla 81-note base-3 odd-harmonic chained scale, Mixed-Base). **Collapsible+searchable menu** (chevron collapse persisted, sticky search over name/ratio/cents/tags/family) with the pull-tab + touch-drag preserved. **`npm test`** (`scripts/validate-modules.mjs`) validates every shipped module — structure + expression syntax + self-contained + evaluates-finite + interval ratio/cents — **79/79 pass**. Verified end-to-end: real drop-import onto a note AND the base re-roots the whole subtree with the chord-root chain intact; octave-shifting a progression's first root doubles every note. **Bug fixed in use:** stale stored layout + HTTP-cached manifest stranded users on an old catalog (deleted-file 404s, incognito-only) → no-store manifest fetch + cache reset on Reload Defaults + manifest reconciliation. **Decisions (user-guided):** single top-level manifest; ~6 family-hued sections (Intervals/Chords/Progressions/Melodies/Scale Systems/Custom); chord ratios captioned under the name so `4:5:6` etc. are self-explanatory. Remaining: a real iOS/Android touch pass (headless Chromium touch verified as proxy).
- **2026-07-12** — **Phase 7 COMPLETE** (License → MIT). Relicensed the project to the MIT License (© 2026 Cyril Monkewitz), replacing the previous bespoke personal-use license. Rewrote `LICENSE.md`, `rust/LICENSE.md`, and `public/license.html` (URL kept alive) to MIT text; set the `license` field to `MIT` in `package.json`, `package-lock.json`, and `rust/Cargo.toml`; rewrote README §License; relabelled the `index.html` footer link and the docs footer + top-bar reference. Added `THIRD_PARTY_NOTICES.md` (fraction.js MIT; VSCO-2 CE samples CC0; Roboto Mono Apache-2.0; + a VitePress/Inter docs-build note). Media assets keep their own licenses; app + engine code is MIT. This document's Phase 7 section was reworded so no trace of the old license identifier remains anywhere in the repo (`npm pkg get license` → `MIT`).
- **2026-07-12** — **Phase 5a COMPLETE** (sample replacement → Phase 7 unblocked), verified in browser. Replaced the two unknown-provenance WAVs (both embedded "Downloaded from Samplefocus.com"; violin also "WavePad Trial") with **VSCO2 Community Edition (CC0)** multisamples: `piano` (Upright Nr1, 14 zones) + `violin` (Solo Violin Arco Vib, 15 zones), mono AAC, **1.3 MB** total. New `src/instruments/multisample-instrument.js` (manifest-only fetch at registration, lazy per-zone decode, `prepare(freqs)` zone preload wired into `preparePlayback`, nearest-zone pitch-shift, network-fail oscillator fallback, velocity-ready manifest schema). New reproducible `scripts/build-samples.mjs` (`npm run samples:build`; VSCO-2-CE GitHub tree → download → ffmpeg mono/trim/cap/AAC). Deleted `public/instruments/samples/*.wav`. **Decision (user):** both instruments from VSCO2 CC0 (piano changed from Salamander CC-BY) for a uniform license + no 488 MB build download. Known limitation: no sample looping yet (long held notes cut at the ~3.5 s source cap).
- **2026-07-12** — **Phase 5b COMPLETE** (Audio signal graph + reverb + synth quality), verified in headless Chromium. New `audio-graph.js` (per-instrument buses, reverb send/return, pitch pan, configured −6/6/12 limiter, single `audio.*` settings consumer) + `reverb.js` (algorithmic OfflineAudioContext IR, decorrelated stereo, damping LP sweep, debounced+token-guarded regen). Rewrote `_scheduleNote` (voice→gain→panner→bus, stop-past-zero). Synth overhaul: shared click-free `applyVoiceEnvelope`, `makeVoice` wrapper (fixes sample onended/disconnect leak), saw/square unison+detune+tracked LP, new `fm-epiano`. Wired the whole Audio tab live (master vol persists via transport slider; reverb/stereo/limiter). Default instrument now reaches inheritance (base note id 0 instrument → null → resolves to `audio.defaultInstrument`). **Decisions this pass (user):** reverb **ON** by default (reverses the earlier default-off call), limiter ON, stereo OFF; "Wet/dry" relabeled "Reverb amount". **15-agent adversarial review** caught + fixed: cancelScheduledValues-without-anchor clicks (pauseFade + setMasterVolume) and an uncancelable pause-fade `stopAll` that raced a quick pause→play. Dev-server note: rapid HMR after edits intermittently strands the module-load boot path (getModule() null) — restart the dev server after a batch of edits before browser-verifying.
- **2026-07-12** — Theme fix: Note-border color now applies to ALL notes + silence rings (main note-body border uniform at renderer ~2273 and silence-ring borders were hardcoded #636363 grey; only the base circle was themed). Dead `borderOnlyProgram` left as-is.
- **2026-07-12** — Settings polish: fixed slider-hover jitter — the global `input[type=range]` rules briefly resize the thumb on hover, and the input height tracked the thumb, jittering the row/panel. Pinned the settings slider input to a fixed 20px height and made the thumb size + glow constant across rest/hover/active (scoped, higher-specificity overrides).
- **2026-07-12** — Theme polish: measure-bar vertical lines (dashed `silenceVLineProgram` + solid `solidCssProgram`) now use the themed `measureBar` color (dark in light themes, was invisible white); settings-panel tabs row no longer scrolls (evenly spaced); settings body scrollbar styled like the module-bar scrollbar.
- **2026-07-12** — Phase 3 COMPLETE: full DOM + GL theming + granular per-color control. Added RGB-component tokens for rgba() forms; migrated hex+rgba across all DOM files; `renderer.setThemeColors` themes base circle, horizontal octave/BaseNote dashed lines (incl. the instanced path), note-ids, measure-ids; 15 per-token color pickers in the Appearance tab. Verified: 4 presets + a fully custom accent/bg override apply to DOM and GL simultaneously.
- **2026-07-11** — Phase 3 (partial): theme-manager projects presets → `--rmt-*` CSS vars + renderer geometry/playhead config. Migrated styles.css + menu-bar.js color literals to var() form.
- **2026-07-11** — Phase 4 complete: customizable note arrows. `handleOctaveChange` reads the interval from settings (default octave); a renderer `drawNoteArrows` flag gates glyphs/backgrounds/hit-test and the DOM buttons hide when off. Verified: fifth 3/2 applies ×1.5, reciprocal down restores, toggle-off cleanly removes arrows with no ghost hit zones. On-arrow ratio label deferred (cosmetic).
- **2026-07-11** — Phase 2 complete: settings schema + store (`rmt:settings:v1`, validated, event-driven) + tabbed Settings panel (Appearance/Arrows/Audio/Library) wired into the main menu; theme presets data. Verified in browser (opens, persists, resets, on-brand). Consumers land in Phases 3-6.
- **2026-07-11** — P1: WASM hot-swap infrastructure built (opt-in via `?evaluator=wasm`), `wasm:sync` tooling, swap verified in Node; activation blocked on a non-deterministic hang inside the Rust PersistentEvaluator (full dossier in Phase 1). A transient page-freeze during development came from the swap being briefly enabled by default — reverted to opt-in; default JS path unchanged and verified responsive in headless Chromium.
- **2026-07-10** — Phase 0 complete: perf harness (`npm run perf:gen`, `npm run perf:bench`, browser `?perf=1` → `window.__rmtPerf`), stress modules in `public/modules/perf/`, baselines recorded. **Fixed correctness bug**: JS `IncrementalEvaluator` lacked `markDirtyOnly` → base-note edits left indirect dependents stale on the JS evaluator path (see Phase 0 note).
- **2026-07-10** — Roadmap created from full codebase exploration + approved master plan (Claude session). Decisions: CC-BY+CC0 samples w/ CREDITS; replace unknown-provenance WAVs; arrows = one interval auto-reciprocal + toggle; foundation-first order; reverb/stereo default off.
