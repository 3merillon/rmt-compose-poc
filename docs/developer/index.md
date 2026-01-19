# Developer Documentation

Welcome to the RMT Compose developer documentation. This section covers the internal architecture, APIs, and contribution guidelines.

## Overview

RMT Compose is built with:

| Technology | Purpose |
|------------|---------|
| **ES Modules** | Native JavaScript modules |
| **Vite** | Build tool and dev server |
| **WebGL2** | Hardware-accelerated rendering |
| **Web Audio API** | Audio synthesis and playback |
| **Fraction.js** | Arbitrary-precision rational arithmetic |
| **Rust/WASM** | Optional high-performance evaluation |

## Architecture

The system consists of several key layers:

```
┌─────────────────────────────────────────────────┐
│                    UI Layer                      │
│  (player.js, menu-bar.js, variable-controls.js) │
├─────────────────────────────────────────────────┤
│                  Core Engine                     │
│  ┌───────────┐ ┌────────────┐ ┌──────────────┐ │
│  │  Module   │ │ Expression │ │  Dependency  │ │
│  │ + Notes   │ │  Compiler  │ │    Graph     │ │
│  └───────────┘ └────────────┘ └──────────────┘ │
│  ┌───────────────────────────────────────────┐ │
│  │         Binary Evaluator (Stack VM)       │ │
│  └───────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│               Output Layers                      │
│  ┌───────────────────┐ ┌─────────────────────┐ │
│  │  WebGL2 Renderer  │ │    Audio Engine     │ │
│  └───────────────────┘ └─────────────────────┘ │
├─────────────────────────────────────────────────┤
│            Optional WASM Acceleration            │
│  (evaluator, compiler, fractions, graphs)       │
└─────────────────────────────────────────────────┘
```

## Documentation Sections

### Architecture

- **[System Architecture](./architecture/overview)** - High-level system design
- **[Data Flow](./architecture/data-flow)** - How data moves through the system
- **[Module System](./architecture/module-system)** - Module, Note, and BaseNote
- **[Rendering Pipeline](./architecture/rendering)** - WebGL2 rendering architecture

### Core Systems

- **[Expression Compiler](./core/expression-compiler)** - Text to bytecode compilation
- **[Binary Evaluator](./core/binary-evaluator)** - Stack-based VM evaluation
- **[Dependency Graph](./core/dependency-graph)** - O(1) dependency tracking
- **[SymbolicPower](./core/symbolic-power)** - Irrational number algebra

### Rendering

- **[WebGL2 Renderer](./rendering/webgl2-renderer)** - Instanced rendering pipeline
- **[Camera Controller](./rendering/camera-controller)** - Pan/zoom and coordinates
- **[GPU Picking](./rendering/picking)** - Hit detection

### Audio

- **[Audio Engine](./audio/audio-engine)** - Web Audio playback
- **[Instruments](./audio/instruments)** - Synth and sample instruments
- **[Streaming Scheduler](./audio/streaming)** - JIT note scheduling

### WASM

- **[WASM Overview](./wasm/overview)** - Optional acceleration
- **[Building WASM](./wasm/building)** - Rust/wasm-pack build process
- **[JS/WASM Adapters](./wasm/adapters)** - Bridge pattern

### API Reference

- **[Module Class](./api/module)** - Module API
- **[Note Class](./api/note)** - Note API
- **[BinaryExpression](./api/binary-expression)** - Expression API
- **[EventBus](./api/event-bus)** - Event system

### Contributing

- **[Development Setup](./contributing/setup)** - Get started developing
- **[Code Style](./contributing/code-style)** - Coding conventions
- **[Pull Requests](./contributing/pull-requests)** - Contribution workflow

## Key Files

| File | Purpose |
|------|---------|
| `src/main.js` | Entry point |
| `src/player.js` | Main orchestrator |
| `src/module.js` | Module data model |
| `src/note.js` | Note data model |
| `src/expression-compiler.js` | Text → bytecode |
| `src/binary-evaluator.js` | Bytecode interpreter |
| `src/dependency-graph.js` | Dependency tracking |
| `src/renderer/webgl2/` | Rendering layer |
| `src/player/audio-engine.js` | Audio playback |

## Getting Started

1. [Set up your development environment](./contributing/setup)
2. Read the [System Architecture](./architecture/overview)
3. Explore the [Expression Compiler](./core/expression-compiler) to understand the core
4. Check the [API Reference](./api/module) for implementation details
