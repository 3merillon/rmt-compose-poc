# Building WASM

This guide covers building the Rust WASM module for RMT Compose.

## Prerequisites

### Rust Toolchain

Install Rust via rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### wasm-pack

Install wasm-pack for building and packaging:

```bash
cargo install wasm-pack
```

### Verify Installation

```bash
rustc --version    # rustc 1.70.0 or later
wasm-pack --version  # 0.12.0 or later
```

## Project Structure

```
rust/
├── Cargo.toml         # Rust package manifest
├── Cargo.lock         # Locked dependencies
├── src/
│   ├── lib.rs         # Main entry point
│   ├── fraction.rs    # Fraction arithmetic
│   ├── evaluator.rs   # Binary evaluator
│   ├── compiler.rs    # Expression compiler
│   ├── bytecode.rs    # Bytecode definitions
│   └── graph.rs       # Dependency graph
└── pkg/               # Build output (generated)
    ├── rmt_core.js
    ├── rmt_core_bg.wasm
    └── rmt_core.d.ts
```

## Building

### Development Build

```bash
cd rust
wasm-pack build --target web --dev
```

- Includes debug symbols
- No optimizations
- Faster compilation

### Production Build

```bash
cd rust
wasm-pack build --target web --release
```

- Optimized for size and speed
- No debug symbols
- Slower compilation

### Via npm

```bash
npm run wasm:build
```

This runs the production build as part of the main build process.

## Build Targets

| Target | Output | Use Case |
|--------|--------|----------|
| `web` | ES modules | Browser with bundler |
| `bundler` | CommonJS | Webpack/Rollup |
| `nodejs` | CommonJS | Node.js |
| `no-modules` | Global | Browser without modules |

RMT Compose uses `web` for native ES module support.

## Cargo.toml Configuration

```toml
[package]
name = "rmt_core"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["console"] }
num-bigint = "0.4"
num-traits = "0.2"

[profile.release]
opt-level = "z"      # Optimize for size
lto = true           # Link-time optimization
codegen-units = 1    # Better optimization
```

## wasm-bindgen Attributes

### Exposing Functions

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn compile(source: &str) -> Result<JsValue, JsError> {
    // ...
}
```

### Exposing Structs

```rust
#[wasm_bindgen]
pub struct Evaluator {
    // Private fields
    #[wasm_bindgen(skip)]
    cache: HashMap<u32, Value>,
}

#[wasm_bindgen]
impl Evaluator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Evaluator {
        Evaluator { cache: HashMap::new() }
    }

    pub fn evaluate(&mut self, bytecode: &[u8]) -> JsValue {
        // ...
    }
}
```

### Console Logging (Debug)

```rust
use web_sys::console;

console::log_1(&"Debug message".into());
```

## Optimization

### Size Optimization

Add to Cargo.toml:

```toml
[profile.release]
opt-level = "z"
lto = true
```

### Speed Optimization

```toml
[profile.release]
opt-level = 3
lto = true
```

### wasm-opt

Further optimize with wasm-opt (included in wasm-pack):

```bash
wasm-opt -O3 -o optimized.wasm input.wasm
```

## Output Files

After building:

| File | Size | Purpose |
|------|------|---------|
| `rmt_core_bg.wasm` | ~150KB | WebAssembly binary |
| `rmt_core.js` | ~10KB | JS bindings |
| `rmt_core.d.ts` | ~5KB | TypeScript definitions |

## Using the Build

### In JavaScript

```javascript
import init, { Evaluator, Compiler } from './pkg/rmt_core.js'

async function setup() {
  await init()  // Load WASM

  const compiler = new Compiler()
  const evaluator = new Evaluator()
}
```

### With Vite

Vite handles WASM automatically:

```javascript
// vite.config.js
export default {
  // WASM support built-in
}
```

## Troubleshooting

### "wasm-pack not found"

```bash
cargo install wasm-pack
```

### "target wasm32-unknown-unknown not found"

```bash
rustup target add wasm32-unknown-unknown
```

### Build fails with memory error

Increase Node memory:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run wasm:build
```

### WASM module too large

Enable size optimization:

```toml
[profile.release]
opt-level = "z"
```

## Continuous Integration

Example GitHub Actions workflow:

```yaml
- name: Install Rust
  uses: actions-rs/toolchain@v1
  with:
    toolchain: stable
    target: wasm32-unknown-unknown

- name: Install wasm-pack
  run: cargo install wasm-pack

- name: Build WASM
  run: npm run wasm:build
```

## See Also

- [WASM Overview](/developer/wasm/overview) - Architecture
- [JS/WASM Adapters](/developer/wasm/adapters) - Integration
- [wasm-pack documentation](https://rustwasm.github.io/wasm-pack/)
