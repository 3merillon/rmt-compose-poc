# Development Setup

This guide covers setting up a development environment for RMT Compose.

## Prerequisites

### Required

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** 9+ (included with Node.js)
- **Git** ([download](https://git-scm.com/))

### Optional (for WASM development)

- **Rust** 1.70+ ([install](https://rustup.rs/))
- **wasm-pack** ([install](https://rustwasm.github.io/wasm-pack/installer/))

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

## Project Structure

```
rmt-compose-poc/
├── src/                    # JavaScript source
│   ├── index.js            # Entry point
│   ├── module.js           # Module class
│   ├── note.js             # Note class
│   ├── expression-compiler.js  # Expression compiler
│   ├── binary-evaluator.js # Bytecode evaluator
│   ├── dependency-graph.js # Dependency tracking
│   ├── renderer/           # WebGL2 rendering
│   ├── player/             # Audio playback
│   ├── modals/             # UI components
│   ├── menu/               # Menu system
│   ├── instruments/        # Sound generation
│   ├── wasm/               # WASM adapters
│   └── utils/              # Utilities
├── rust/                   # Rust/WASM source
│   ├── Cargo.toml
│   └── src/
├── public/                 # Static assets
│   └── modules/            # Example modules
├── docs/                   # Documentation (VitePress)
├── index.html              # HTML entry point
├── vite.config.js          # Vite configuration
└── package.json
```

## Available Scripts

### Development

```bash
npm run dev          # Start dev server with hot reload
npm run preview      # Preview production build locally
```

### Building

```bash
npm run build        # Build for production (includes WASM)
npm run wasm:build   # Build only WASM module
```

### Documentation

```bash
npm run docs:dev     # Start docs dev server
npm run docs:build   # Build docs for production
npm run docs:preview # Preview docs build
```

## WASM Development

### Building WASM

```bash
cd rust
wasm-pack build --target web --dev   # Development build
wasm-pack build --target web         # Production build
```

Or via npm:
```bash
npm run wasm:build
```

### WASM Output

Build output goes to `rust/pkg/`:
- `rmt_core_bg.wasm` - WebAssembly binary
- `rmt_core.js` - JavaScript bindings
- `rmt_core.d.ts` - TypeScript definitions

## IDE Setup

### VS Code

Recommended extensions:
- **ESLint** - JavaScript linting
- **rust-analyzer** - Rust language support
- **Volar** - Vue support (for docs)

### Settings

`.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  }
}
```

## Environment Variables

Create `.env.local` for local overrides:

```bash
VITE_DEBUG=true           # Enable debug mode
VITE_DISABLE_WASM=true    # Force JavaScript fallback
```

## Testing Locally

### Manual Testing

1. Start dev server: `npm run dev`
2. Open browser console for errors
3. Test note creation, editing, playback
4. Test module save/load

### Browser Requirements

- **WebGL2** support required
- **Web Audio API** required
- Modern browser (Chrome 80+, Firefox 75+, Safari 14+)

## Debugging

### JavaScript

```javascript
// Enable debug logging
localStorage.setItem('debug', 'true')
```

### WASM

```rust
use web_sys::console;
console::log_1(&"Debug message".into());
```

### WebGL

```javascript
// Check WebGL errors
const error = gl.getError()
if (error !== gl.NO_ERROR) {
  console.error('WebGL error:', error)
}
```

## Common Issues

### "WebGL2 not supported"

- Update your browser
- Enable hardware acceleration
- Check GPU drivers

### "WASM failed to load"

- Run `npm run wasm:build`
- Check browser console for errors
- Try with `VITE_DISABLE_WASM=true`

### "Hot reload not working"

- Check Vite terminal output
- Try clearing browser cache
- Restart dev server

## Next Steps

- Read [Code Style](/developer/contributing/code-style) guidelines
- Check [Pull Requests](/developer/contributing/pull-requests) process
- Explore [Architecture](/developer/architecture/overview) documentation

## See Also

- [System Architecture](/developer/architecture/overview) - How it works
- [Building WASM](/developer/wasm/building) - WASM compilation
