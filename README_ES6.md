# RMT Compose - ES6 Modernized Version

This is the modernized ES6 version of the RMT Compose Proof of Concept application.

## What Changed

### Modern Build System
- **Vite** for fast development and optimized builds
- **ES6 Modules** instead of global window references
- **npm** for dependency management
- Modern project structure with `src/` and `public/` directories

### Modular Architecture
- Core modules converted to ES6:
  - [src/note.js](src/note.js) - Note class
  - [src/module.js](src/module.js) - Module class with dependency management
  - [src/instruments/](src/instruments/instrument-manager.js) - Instrument system (synth & samples)
  - [src/stack-click.js](src/stack-click.js) - Stack click functionality
  - [src/player/audio-engine.js](src/player/audio-engine.js) - Central audio engine (WebAudio graph, scheduling, transport)
  - [src/utils/event-bus.js](src/utils/event-bus.js) - Lightweight pub/sub for cross-module messages
  - [src/utils/compat.js](src/utils/compat.js) - Transitional facade for minimal globals
  - [src/menu/menu-bar.js](src/menu/menu-bar.js) - Menu (drag/drop, actions)
  - [src/modals/index.js](src/modals/index.js) - Modals (note variables widget)
  - [src/main.js](src/main.js) - Application entry point

### Legacy Compatibility
- Player is an ES module in [src/player.js](src/player.js); audio is delegated to [AudioEngine](src/player/audio-engine.js) and cross-module communication uses [eventBus](src/utils/event-bus.js). Transitional globals are isolated behind [compat](src/utils/compat.js) only where necessary.
- Modals are fully ES modules under [src/modals/](src/modals/index.js) and initialized from [src/main.js](src/main.js).
- Menu bar is an ES module under [src/menu/](src/menu/menu-bar.js) and communicates via [eventBus](src/utils/event-bus.js); no `window.menuBar` is exposed.
- A lightweight event bus and compat facade remain temporarily to bridge remaining seams; current intentional globals: audioEngine instance and a module graph accessor (window.myModule).

## Getting Started

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```
This will start the Vite dev server at `http://localhost:3000`

### Build for Production
```bash
npm run build
```
Output will be in the `dist/` directory

### Preview Production Build
```bash
npm run preview
```

## Project Structure

```
rmt-compose-poc/
├── src/
│   ├── main.js                 # ES module entry point
│   ├── note.js                 # Note class
│   ├── module.js               # Module class with dependencies
│   ├── stack-click.js          # Stack click helpers
│   ├── player.js               # Player UI/state (ES module; delegates to audio engine)
│   ├── player/
│   │   └── audio-engine.js     # WebAudio engine: routing, scheduling, transport
│   ├── menu/
│   │   ├── menu-bar.js         # Menu implementation
│   │   └── index.js            # Menu public API
│   ├── modals/
│   │   ├── index.js            # Modals (note variables widget)
│   │   └── validation.js       # Validation utilities
│   ├── instruments/
│   │   ├── instrument-manager.js
│   │   ├── synth-instruments.js
│   │   └── sample-instruments.js
│   └── utils/
│       ├── event-bus.js        # Lightweight pub/sub
│       └── compat.js           # Transitional globals facade
├── public/
│   ├── images/                 # Note duration images
│   ├── instruments/samples/    # Audio samples
│   ├── modules/                # JSON module definitions
│   ├── styles.css              # Styles (linked as /styles.css)
│   └── moduleSetup.json        # Initial module setup
├── index.html                  # Single module script; loads src/main.js
├── package.json                # Dependencies
├── vite.config.js              # Vite configuration
└── .gitignore                  # Git ignore rules
```

## Key Features Preserved

✅ All note creation and editing functionality
✅ Drag and drop for notes and modules
✅ Measure bar system
✅ Dependency tracking and visualization
✅ Audio playback with multiple instruments
✅ Module import/export
✅ UI state persistence
✅ All keyboard shortcuts and controls

## Technical Notes

- **Fraction.js** is imported from npm
- **Tapspace** is imported from npm
- Most APIs are imported as ES modules; only minimal transitional globals are exposed via the compat facade (e.g., audioEngine instance, module graph accessor) while migration completes
- All file paths are Vite-friendly and resolve from public/ at dev and build time
- No behavioral changes; migration preserved existing UX

## Migration Benefits

1. **Modern Development**: Hot module replacement, fast builds
2. **Dependency Management**: npm instead of manual script tags
3. **Better Organization**: Modular code structure
4. **Type Safety Ready**: Easy to add TypeScript later
5. **Optimized Builds**: Vite handles bundling and optimization
6. **No Breaking Changes**: 100% functionality preserved

## Legacy Root Cleanup

Legacy duplicates at the repository root were removed after migration (menu-bar.js, modals.js, player.js, module.js, note.js, instruments/, modules/, images/, fraction.min.js, moduleSetup.json, styles.css). The sources of truth are under [src/](src/main.js) and [public/](public/styles.css).