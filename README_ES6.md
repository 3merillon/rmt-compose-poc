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
  - `src/note.js` - Note class
  - `src/module.js` - Module class with dependency management
  - `src/instruments/` - Instrument system (synth & samples)
  - `src/stack-click.js` - Stack click functionality
  - `src/main.js` - Application entry point

### Legacy Compatibility
- Player remains legacy in `src/player.js` and relies on window globals provided via the compat facade.
- Modals are fully ES modules under `src/modals/` and initialized from `src/main.js`.
- Menu bar has moved to `src/menu/` and is initialized via ES module import; the legacy `window.menuBar` is preserved for compatibility.
- A lightweight `eventBus` and `compat` shim remain temporarily to bridge the legacy player with new modules.

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
│   ├── main.js                 # ES6 entry point
│   ├── note.js                 # Note class (ES6)
│   ├── module.js               # Module class (ES6)
│   ├── stack-click.js          # Stack click (ES6)
│   ├── player.js               # Player logic (legacy)
│   ├── menu/                   # Menu (ES module)
│   │   ├── menu-bar.js         # Menu implementation (module-initialized)
│   │   └── index.js            # Menu public API
│   ├── instruments/
│   │   ├── instrument-manager.js  # ES6
│   │   ├── synth-instruments.js   # ES6
│   │   └── sample-instruments.js  # ES6
│   ├── modals/
│   │   ├── index.js            # Modals ES6 wrapper
│   │   └── validation.js       # Validation utilities
│   └── utils/
│       └── compat.js           # Compatibility helpers
├── public/
│   ├── images/                 # Note duration images
│   ├── instruments/samples/    # Audio samples
│   ├── modules/                # JSON module definitions
│   ├── styles.css              # Styles
│   └── moduleSetup.json        # Initial module setup
├── index.html                  # Main HTML (updated for ES6)
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

- **Fraction.js** is now imported as an npm package instead of a CDN script
- **Tapspace** is imported as an npm package
- Core classes are exposed to `window` for backward compatibility
- All file paths updated to work with Vite's dev server
- No behavioral changes - everything works exactly as before

## Migration Benefits

1. **Modern Development**: Hot module replacement, fast builds
2. **Dependency Management**: npm instead of manual script tags
3. **Better Organization**: Modular code structure
4. **Type Safety Ready**: Easy to add TypeScript later
5. **Optimized Builds**: Vite handles bundling and optimization
6. **No Breaking Changes**: 100% functionality preserved

## Original Files

Original files are preserved in the root directory for reference.