# Installation

RMT Compose can be used in two ways: via the **live demo** or **locally** for development.

## Live Demo (Recommended for Users)

The easiest way to use RMT Compose is the hosted version:

**[https://rmt.world](https://rmt.world)**

No installation required. Works in any modern browser with WebGL2 support.

## Local Installation (For Development)

### Prerequisites

- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
- **Git** - For cloning the repository
- **Modern browser** - Chrome, Firefox, Edge, or Safari with WebGL2

### Steps

1. **Clone the repository**

```bash
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
```

2. **Install dependencies**

```bash
npm install
```

3. **Start the development server**

```bash
npm run dev
```

4. **Open in browser**

Navigate to the URL shown by Vite (typically `http://localhost:3000`).

## Production Build

To create a production build:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## WASM Build (Optional)

For enhanced performance, you can build the Rust/WASM core:

### Prerequisites

- **Rust toolchain** - Install from [rustup.rs](https://rustup.rs/)
- **wasm-pack** - Install with `cargo install wasm-pack`

### Build WASM

```bash
npm run wasm:build
```

This compiles the Rust code to WebAssembly and places it in the `rust/pkg` directory.

::: info WASM is Optional
The app works perfectly without WASM. The JavaScript implementation provides identical functionality - WASM just offers better performance for complex modules with many notes.
:::

## Browser Support

RMT Compose requires **WebGL2**, which is supported by:

| Browser | Minimum Version |
|---------|----------------|
| Chrome | 56+ |
| Firefox | 51+ |
| Safari | 15+ |
| Edge | 79+ |

::: warning WebGL2 Required
If WebGL2 is not available, the workspace will not initialize. Most modern browsers support WebGL2 by default.
:::

## Troubleshooting

### "WebGL2 not available" error

- Ensure your browser is up to date
- Check if hardware acceleration is enabled in browser settings
- Try a different browser
- Update your graphics drivers

### Module loading fails

- Clear browser cache and reload
- Check browser console for errors
- Ensure you're using a supported browser

### Development server won't start

- Ensure Node.js 18+ is installed: `node --version`
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check if port 3000 is already in use

## Next Steps

Now that you have RMT Compose running, continue to [Your First Composition](./first-composition) to create your first piece.
