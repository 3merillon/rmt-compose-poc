# Relative Music Theory (RMT) App

A production-ready, GL-only composition tool built around rational number relationships (ratios) instead of fixed 12-TET steps.

## Live Demo

- Try it in your browser: https://www.rmt.world/
- **New to RMT?** Check out the [Documentation](https://docs.rmt.world/) for guides and tutorials
- Screenshot:

![RMT Compose screenshot](public/screenshot.png)

## Overview

The app represents and manipulates musical structures as exact ratios and durations, with support for equal temperament systems (12-TET, 19-TET, 31-TET, Bohlen-Pierce). A WebGL2 interactive Workspace handles all rendering and interactions with a high-performance instanced pipeline.

### Expression DSL

Note properties (frequency, duration, startTime, tempo) are defined using a concise **Domain-Specific Language (DSL)** that compiles to binary bytecode:

```
base.f * (3/2)           # Perfect fifth above base note
[1].t + [1].d            # End time of note 1
beat(base) * 2           # Two beats duration
2^(7/12)                 # 12-TET perfect fifth interval
```

The DSL replaces verbose legacy JavaScript syntax with intuitive mathematical expressions. See the [DSL Syntax](#dsl-expression-syntax) section below for details.

## Architecture

The app uses a **binary bytecode compilation system** for expression evaluation:

- **DSL Compiler**: Expressions written in DSL syntax (e.g., `base.f * (3/2)`) are parsed, validated, and compiled to compact binary bytecode at load time. Legacy JavaScript syntax is auto-detected and supported for backwards compatibility.
- **Evaluation**: A stack-based VM evaluates bytecode with Fraction pooling to minimize garbage collection during interactive operations
- **Dependency Tracking**: An inverted index provides O(1) lookup for forward and inverse dependencies, enabling smart drag previews (only notes whose position actually depends on the dragged note are moved)
- **WASM Optimization**: Optional Rust/WASM core for computationally intensive evaluation operations

## Features

- Ratio-first music model
  - Notes express frequency, duration, and start time using the DSL (e.g., `base.f * (3/2)`)
  - Expressions compile to binary bytecode backed by Fraction.js for exact arithmetic
  - Dependency-aware evaluation with O(1) lookup and caching
  - Property-specific dependency visualization (Orange=frequency, Teal=startTime, Purple=duration)

- Multi-TET system support
  - Built-in support for 12-TET, 19-TET, 31-TET, and Bohlen-Pierce (13-BP) tuning systems
  - Notes using TET frequencies display **≈** prefix to indicate irrational/approximated values
  - Create custom TET modules using power expressions

- Interactive WebGL2 Workspace
  - Pan/zoom camera with affine world-screen basis
  - Selection, move, resize
  - Measure editing (drag triangles), dashed/solid measure bars
  - Snapping to sixteenth notes
  - Dependency-aware previews during drag/resize
  - Crisp fraction labels and instanced rounded rectangles
  - Octave guides and BaseNote indicator
  - GPU/CPU picking for notes, measures, and BaseNote

- Playback and audio
  - Web Audio-based engine, with shared nodes and graceful pause/stop
  - Playhead tracking (optional), pixel-snapped playhead line
  - Volume control

- Productivity
  - Undo/Redo history
  - Load module from file (Main menu > Load Module)
  - Drag a module from the Module Bar onto the workspace
  - Export current module to file
  - Scale controls (X/Y) for time/frequency density; camera tracking integration

## Requirements

- Node.js 18+
- A modern browser with WebGL2 enabled
- (Optional) Rust toolchain for WASM builds

## Quick Start

Install and run the dev server:

```bash
npm ci
npm run dev
```

Open the URL printed by Vite (typically http://localhost:3000).

Build and preview a production bundle:

```bash
npm run build
npm run preview
```

### WASM Build (Optional)

To build the Rust/WASM core for enhanced performance:

```bash
npm run build:wasm
```

## Controls and Workflow

- Transport
  - Play/Pause button at the top-left
  - Stop button next to Play/Pause
  - Volume slider
- View and tracking
  - Reset View button centers the Workspace on BaseNote (disabled when tracking is on)
  - Tracking toggle keeps the playhead centered during playback
  - Scale controls (bottom-left dot): adjust horizontal (time) and vertical (frequency) density
- Editing
  - Click to select a note or measure
  - Drag note body to move; drag the right tab to resize
  - Click +/- octave regions to transpose by octaves
  - Drag measure triangles at the bottom to adjust measure positions; dependent notes preview live
- Import/Export
  - Load Module from file via the main menu; Save Module to export the current module; Reset to the default module from the same menu
  - Drag a module from the Module Bar onto the workspace to load it
- Keyboard
  - Undo: Ctrl/Cmd+Z
  - Redo: Ctrl/Cmd+Y

## Module Bar

- Browse example modules by category (Intervals, Chords, Melodies, Custom)
- Load a module by dragging it from the Module Bar onto a note or measure in the workspace
- Use the **Drop Mode Toggle** to control how modules integrate:
  - **Start**: Module notes start at the target note's start time (ideal for building chords)
  - **End**: Module notes start at the target note's end time (ideal for building sequences/scales)
- Load a module from file via the main menu (Main menu > Load Module)

### Create your own Module Bar items

1) Add your module JSON to a category folder, for example: [public/modules/custom](public/modules/custom)
2) Update that category's index to reference your file and label:
   - Edit [public/modules/custom/index.json](public/modules/custom/index.json)
   - Add an entry for your file (e.g., "my module.json") with the display label you want
3) Save and refresh the app (or restart the dev server). Your module will appear under the Custom category

Notes:
- The default module lives at [public/modules/defaultModule.json](public/modules/defaultModule.json)
- Other built-in categories follow the same pattern with their own index.json files

## DSL Expression Syntax

The DSL provides a concise, mathematical notation for defining note relationships. It auto-detects and supports both DSL and legacy JavaScript syntax.

### Note References

| Syntax | Description |
|--------|-------------|
| `base.f` | BaseNote frequency |
| `base.t` | BaseNote start time |
| `[1].f` | Note 1 frequency |
| `[5].d` | Note 5 duration |

### Property Shortcuts

| Short | Full Name |
|-------|-----------|
| `f` | frequency |
| `t` | startTime |
| `d` | duration |
| `tempo` | tempo |
| `bpm` | beatsPerMeasure |
| `ml` | measureLength |

### Operators and Literals

```
(3/2)                    # Fraction literal
base.f * (3/2)           # Multiplication (perfect fifth)
[1].t + [1].d            # Addition (end time)
2^(1/12)                 # Power (12-TET semitone)
-[1].f                   # Negation
```

### Built-in Functions

| Function | Description | Example |
|----------|-------------|---------|
| `beat(note)` | Duration of one beat (60/tempo) | `beat(base)` |
| `tempo(note)` | Get tempo value | `tempo([1])` |
| `measure(note)` | Get measure length | `measure(base)` |

### Common Patterns

```
# Intervals (frequency relationships)
base.f * (3/2)           # Perfect fifth (just intonation)
base.f * (5/4)           # Major third (just intonation)
base.f * 2^(7/12)        # Perfect fifth (12-TET)

# Timing (sequential notes)
[1].t + [1].d            # Start after note 1 ends
base.t                   # Start at same time as base

# Duration
beat(base)               # One beat
beat(base) * 2           # Two beats
beat([1]) * (1/2)        # Half beat relative to note 1
```

<details>
<summary>Legacy JavaScript syntax (deprecated)</summary>

The legacy syntax uses method chaining on Fraction objects:

```javascript
// Perfect fifth
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Note 1 frequency
module.getNoteById(1).getVariable('frequency')

// One beat duration
new Fraction(60).div(module.findTempo(module.baseNote))
```

Legacy syntax is auto-detected and still supported for backwards compatibility.
</details>

## Equal Temperament Systems

While RMT is built around exact ratios, it also supports equal temperament tuning systems for exploring microtonal and alternative scales.

### Included TET Modules
Load these from the Module Bar under Melodies:
- **TET-12** - Standard 12-tone equal temperament (semitones)
- **TET-19** - 19 equal divisions of the octave
- **TET-31** - 31 equal divisions of the octave (high-resolution)
- **BP-13** - Bohlen-Pierce scale (13 equal divisions of 3:1 instead of 2:1)

### Understanding the ≈ Symbol
Notes with equal temperament frequencies display an **≈** prefix before their frequency fraction. This indicates that the displayed value is an approximation of an irrational number (like 2^(1/12)).

### Creating Custom TET Modules
To create notes in a TET system, use power expressions for frequency:

| System | DSL Expression |
|--------|----------------|
| 12-TET | `[prev].f * 2^(1/12)` |
| 19-TET | `[prev].f * 2^(1/19)` |
| 31-TET | `[prev].f * 2^(1/31)` |
| BP-13  | `[prev].f * 3^(1/13)` |

Example: Chain notes up the 12-TET scale:
```
[1].f * 2^(1/12)         # Note 2: one semitone above note 1
[2].f * 2^(1/12)         # Note 3: one semitone above note 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```json
"frequency": "module.getNoteById(1).getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 12)))"
```
</details>

## File Structure

### Core Expression System
- src/dsl/ - DSL lexer, parser, compiler, and decompiler
- src/binary-note.js - Binary expression format and bytecode classes
- src/binary-evaluator.js - Stack-based bytecode interpreter with Fraction pooling
- src/dependency-graph.js - O(1) dependency tracking with inverted index
- src/expression-compiler.js - Expression compiler with DSL/legacy auto-detection
- src/module-serializer.js - JSON import/export for binary modules

### Application
- src/main.js - ES module entry point
- src/player.js - Orchestrates Workspace, audio, history, UI wiring
- src/module.js - Module data model with binary evaluation
- src/note.js - Note model with binary expressions

### Rendering & Audio
- src/renderer/webgl2/workspace.js - Interactive Workspace (camera, picking, interactions)
- src/renderer/webgl2/renderer.js - WebGL2 programs, instancing, text, overlays, picking
- src/renderer/webgl2/camera-controller.js - Camera and world-screen basis publication
- src/player/audio-engine.js - Audio graph and playback controls

### WASM Core (Optional)
- rust/ - Rust implementation for high-performance evaluation
- src/wasm/ - JavaScript adapters for WASM integration

### Assets
- public/modules - Bundled example modules and presets
  - melodies/ - Includes TET examples (TET-12, TET-19, TET-31, BP-13)

## Browser Support and Fallbacks

- WebGL2 is required. If WebGL2 cannot be created, the Workspace will not initialize.

## Learn More

- **Documentation**: https://docs.rmt.world/
- Original article: https://cybercyril.com

## License

Relative Music Theory Personal Non-Commercial License (RMT-PNC) v1.0

- Personal, non-commercial use only
- Private modifications allowed (no distribution or hosting)
- No redistribution of the app or its assets
- Outputs (music, audio, video, MIDI, scores) may be shared non-commercially only
- Public sharing requires attribution: "Made with Relative Music Theory (RMT) - https://cybercyril.com/"

See full terms in LICENSE.md. For commercial licensing, email cyril.monkewitz@gmail.com
