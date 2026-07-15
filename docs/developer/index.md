---
title: Developer Documentation
description: Architecture, core systems, rendering, audio and build docs for RMT Compose — how the app compiles, evaluates and draws a composition.
---

# Developer Documentation

RMT Compose is a plain ES-module web app. No framework, no TypeScript in `src/`, one runtime
dependency. Every musical value in a composition is a **text expression** that is compiled to
bytecode and run on a stack VM with exact rational arithmetic; the results are drawn in a single
WebGL2 canvas and scheduled through the Web Audio API.

The project is licensed **MIT** (`LICENSE.md`). Contributions are welcome.

## Tech stack

| Technology | Role |
|---|---|
| **ES Modules** | The whole of `src/`. No framework. |
| **Vite 7** | Dev server (port **3000**) and production bundler. |
| **WebGL2** | The workspace. A hard requirement — `player.js` probes for a context and, without one, never constructs the `Workspace`. There is no DOM fallback renderer. |
| **Web Audio API** | Synthesis, sample playback, the reverb/limiter signal graph. |
| **fraction.js 5.3.4** | Exact rational arithmetic. BigInt-backed — arbitrary precision, at any magnitude and depth. |
| **Rust → WASM** | An alternative evaluator core that ships in the bundle but is **off by default**. |
| **VitePress** | This documentation site (`docs/`, deployed separately). |

::: warning The WASM evaluator is not the default path
The `rmt-core` WASM binary is **not even fetched** on a normal page load — `initWasm()` returns
early without the URL flag `?evaluator=wasm` (`src/wasm/evaluator-adapter.js:36-40`), and that
flag currently hangs the tab on a full re-evaluation. Everything you experience in the app runs
on the **JavaScript** evaluator. See [WASM Overview](/developer/wasm/overview).
:::

## The layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ UI                                                                   │
│  player.js (orchestrator) · modals/ (note + group widgets)           │
│  menu/ (module library) · settings/ (panel + store) · theme/          │
├──────────────────────────────────────────────────────────────────────┤
│ Expression front ends                                                │
│  dsl/          lexer → parser → compiler → decompiler   (primary)    │
│  expression-compiler.js   legacy method-chain parser + routing + LRU  │
├──────────────────────────────────────────────────────────────────────┤
│ Core                                                                 │
│  module.js  ·  note.js                                               │
│  binary-note.js      bytecode format (OP / VAR / CORRUPT)            │
│  binary-evaluator.js stack VM + IncrementalEvaluator (Kahn topo-sort)│
│  dependency-graph.js forward + inverse indexes, corruption flags     │
├──────────────────────────────────────────────────────────────────────┤
│ Output                                                               │
│  renderer/webgl2/   renderer · workspace · camera · config           │
│  player/            audio-engine → audio-graph → reverb              │
│  instruments/       synths + multisampled piano/violin               │
├──────────────────────────────────────────────────────────────────────┤
│ State                                                                │
│  store/app-state.js · store/history.js · utils/event-bus.js          │
├──────────────────────────────────────────────────────────────────────┤
│ wasm/  (alternative evaluator core — opt-in, currently blocked)      │
└──────────────────────────────────────────────────────────────────────┘
```

## Documentation sections

### Architecture

- **[System Architecture](/developer/architecture/overview)** — design principles, the real file tree, extension points
- **[Data Flow](/developer/architecture/data-flow)** — an edit's full journey to pixels and sound
- **[Module System](/developer/architecture/module-system)** — the `Module` API, note by note
- **[Rendering Pipeline](/developer/architecture/rendering)** — coordinates, instanced passes, camera

### Core systems

- **[Expression Compiler](/developer/core/expression-compiler)** — text → bytecode, DSL and legacy
- **[Binary Evaluator](/developer/core/binary-evaluator)** — the stack VM and incremental evaluation
- **[Dependency Graph](/developer/core/dependency-graph)** — property-specific forward and inverse indexes
- **[SymbolicPower](/developer/core/symbolic-power)** — irrational algebra and what actually survives evaluation

### Rendering

- **[WebGL2 Renderer](/developer/rendering/webgl2-renderer)** — `RendererAdapter` in detail
- **[Camera Controller](/developer/rendering/camera-controller)** — pan, zoom, pinch
- **[Picking](/developer/rendering/picking)** — CPU hit testing (the GPU path is a scaffold)

### Audio

- **[Audio Engine](/developer/audio/audio-engine)** — voices and the streaming scheduler
- **[Audio Graph](/developer/audio/audio-graph)** — buses, sends, stereo pan, limiter
- **[Reverb](/developer/audio/reverb)** — the algorithmic impulse response
- **[Instruments](/developer/audio/instruments)** — synths and multisamples
- **[Streaming Scheduler](/developer/audio/streaming)** — just-in-time note scheduling

### Deep dives

- **[Performance](/developer/performance)** — the benchmark harness and the measured numbers
- **[Theming](/developer/theming)** — presets, tokens, and how they reach the GL canvas

### WASM

- **[WASM Overview](/developer/wasm/overview)** — what ships, what runs, what is blocked
- **[Building WASM](/developer/wasm/building)** — `wasm-pack`, `sync-wasm.mjs`, committed artifacts
- **[JS/WASM Adapters](/developer/wasm/adapters)** — the evaluator bridge

### API reference

- **[Module Class](/developer/api/module)**
- **[Note Class](/developer/api/note)**
- **[BinaryExpression](/developer/api/binary-expression)**
- **[EventBus](/developer/api/event-bus)**

### Contributing

- **[Development Setup](/developer/contributing/setup)**
- **[Build and Deploy](/developer/contributing/build-and-deploy)**
- **[Code Style](/developer/contributing/code-style)**
- **[Pull Requests](/developer/contributing/pull-requests)**

## Key files

| File | Purpose |
|---|---|
| `src/main.js` | Entry point (`index.html` loads this). Registers instruments, boots WASM, modals, menu, settings. |
| `src/player.js` | The orchestrator: transport, selection, drag/resize commits, undo wiring, scale controls. ~6.6k lines. |
| `src/module.js` | `Module` — notes, dependency registration, evaluation, JSON load/save, reindexing. |
| `src/note.js` | `Note` — six `BinaryExpression`s plus `color` / `instrument`. |
| `src/dsl/` | The primary expression language: `lexer` → `parser` → `compiler` → `decompiler`, plus `simplify`. |
| `src/expression-compiler.js` | The **legacy** method-chain parser, the format router (`isDSLSyntax`), and the 4000-entry LRU compile cache. |
| `src/binary-note.js` | `OP`, `VAR`, `CORRUPT`, `BinaryExpression`. |
| `src/binary-evaluator.js` | `BinaryEvaluator` (stack VM), `IncrementalEvaluator`, `FractionPool`, `SymbolicPower`. |
| `src/dependency-graph.js` | Forward and inverse dependency indexes, per-property indexes, corruption flags. |
| `src/renderer/webgl2/renderer.js` | `RendererAdapter` — 22 shader programs, all instance buffers, `sync()`, CPU picking. |
| `src/renderer/webgl2/workspace.js` | `Workspace` — pointer interaction, drag/marquee/multi-select arbitration. |
| `src/renderer/webgl2/renderer-config.js` | `defaultRendererConfig` — every geometry and text constant. |
| `src/player/audio-engine.js` | Voice construction and the lookahead scheduler. |
| `src/player/audio-graph.js` | Instrument buses, reverb send/return, pitch pan, master limiter. |
| `src/player/reverb.js` | Algorithmic impulse-response generator. |
| `src/settings/settings-store.js` | The `settingsStore` singleton (`rmt:settings:v1`). |
| `src/theme/theme-manager.js` | `appearance.*` → CSS custom properties + `renderer.setConfig` / `setThemeColors`. |
| `src/store/history.js` | Undo/redo. String snapshots, 50 entries, 12 MB cap. |
| `src/utils/event-bus.js` | The pub/sub bus every subsystem talks over. |
| `src/utils/simplify.js` | Expression simplification and the arrow-interval coefficient fold. |

The save/load path is `Module.loadFromJSON()` and `Module.createModuleJSON()` in `src/module.js`.
(The dead `src/module-serializer.js` that used to sit beside it has been deleted.)

## Getting started

1. [Set up your environment](/developer/contributing/setup) — `npm ci`, then `npm run dev` on **port 3000**.
2. Read [System Architecture](/developer/architecture/overview).
3. Follow one edit end to end in [Data Flow](/developer/architecture/data-flow).
4. Then go deep wherever you are working: [Expression Compiler](/developer/core/expression-compiler),
   [Rendering](/developer/architecture/rendering), or [Audio Graph](/developer/audio/audio-graph).
