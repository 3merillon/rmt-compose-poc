# Relative Music Theory (RMT) App

A production-ready, GL‑only composition tool built around rational number relationships (ratios) instead of fixed 12‑TET steps.

## Live Demo

- Try it in your browser: https://www.rmt.world/
- Screenshot:

![RMT Compose screenshot](public/screenshot.png)

## Overview

The app represents and manipulates musical structures as exact ratios and durations. A WebGL2 interactive Workspace handles all rendering and interactions with a high‑performance instanced pipeline. The legacy DOM rendering layer has been removed; the Workspace and its camera are the sole sources of truth for visualization and picking.

## Features

- Ratio‑first music model
  - Notes express frequency, duration, and start time as exact expressions (compiled to functions backed by Fraction.js)
  - Dependency‑aware evaluation and caching

- Interactive WebGL2 Workspace
  - Pan/zoom camera with affine world↔screen basis
  - Selection, move, resize
  - Measure editing (drag triangles), dashed/solid measure bars
  - Snapping to sixteenth notes
  - Dependency‑aware previews during drag/resize
  - Crisp fraction labels and instanced rounded rectangles
  - Octave guides and BaseNote indicator
  - GPU/CPU picking for notes, measures, and BaseNote

- Playback and audio
  - Web Audio–based engine, with shared nodes and graceful pause/stop
  - Playhead tracking (optional), pixel‑snapped playhead line
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

## Controls and Workflow

- Transport
  - Play/Pause button at the top‑left
  - Stop button next to Play/Pause
  - Volume slider
- View and tracking
  - Reset View button centers the Workspace on BaseNote (disabled when tracking is on)
  - Tracking toggle keeps the playhead centered during playback
  - Scale controls (bottom‑left dot): adjust horizontal (time) and vertical (frequency) density
- Editing
  - Click to select a note or measure
  - Drag note body to move; drag the right tab to resize
  - Click +/− octave regions to transpose by octaves
  - Drag measure triangles at the bottom to adjust measure positions; dependent notes preview live
- Import/Export
  - Load Module from file via the main menu; Save Module to export the current module; Reset to the default module from the same menu
  - Drag a module from the Module Bar onto the workspace to load it
- Keyboard
  - Undo: Ctrl/Cmd+Z
  - Redo: Ctrl/Cmd+Y

## Module Bar

- Browse example modules by category (Intervals, Chords, Melodies, Custom)
- Load a module by dragging it from the Module Bar onto the workspace
- Load a module from file via the main menu (Main menu > Load Module)

### Create your own Module Bar items

1) Add your module JSON to a category folder, for example: [public/modules/custom](public/modules/custom)
2) Update that category’s index to reference your file and label:
   - Edit [public/modules/custom/index.json](public/modules/custom/index.json)
   - Add an entry for your file (e.g., "my module.json") with the display label you want
3) Save and refresh the app (or restart the dev server). Your module will appear under the Custom category

Notes:
- The default module lives at [public/modules/defaultModule.json](public/modules/defaultModule.json)
- Other built-in categories follow the same pattern with their own index.json files

## File Structure

- src/main.js — ES module entry point
- src/player.js — Orchestrates Workspace, audio, history, UI wiring
- src/renderer/webgl2/workspace.js — Interactive Workspace (camera, picking, interactions) using the WebGL2 renderer
- src/renderer/webgl2/renderer.js — WebGL2 programs, instancing, text, overlays, picking
- src/renderer/webgl2/camera-controller.js — Camera and world↔screen basis publication
- src/player/audio-engine.js — Audio graph and playback controls
- public/modules — Bundled example modules and presets

## Browser Support and Fallbacks

- WebGL2 is required. If WebGL2 cannot be created, the Workspace will not initialize.


## Learn More

- Article and theory background: https://cybercyril.com

## License

Relative Music Theory Personal Non‑Commercial License (RMT‑PNC) v1.0

- Personal, non‑commercial use only
- Private modifications allowed (no distribution or hosting)
- No redistribution of the app or its assets
- Outputs (music, audio, video, MIDI, scores) may be shared non‑commercially only
- Public sharing requires attribution: “Made with Relative Music Theory (RMT) – https://cybercyril.com/”

See full terms in LICENSE.md. For commercial licensing, email cyril.monkewitz@gmail.com
