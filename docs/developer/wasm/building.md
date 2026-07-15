---
title: Building WASM
description: Rebuild the rmt-core Rust crate, sync the artifacts into src/wasm, and commit them — because Vercel never runs wasm-pack.
---

# Building WASM

You only need this page if you change something under `rust/`. The app builds and deploys without a
Rust toolchain, because the compiled artifacts are **committed**.

::: danger Commit the synced artifacts or your change does not ship
`npm run wasm:build` writes `rust/pkg/` (gitignored) and then copies two files into `src/wasm/`
(committed). Vercel runs plain `vite build` — it never runs `wasm-pack`. **The committed
`src/wasm/rmt_core.js` and `src/wasm/rmt_core_bg.wasm` are what ships.** If you rebuild the crate and
forget to commit them, the deploy silently keeps serving the old binary and nothing tells you.
:::

## Prerequisites

```bash
# Rust, via rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# wasm-pack
cargo install wasm-pack

# the WASM target (wasm-pack will add it for you, but this is the manual form)
rustup target add wasm32-unknown-unknown
```

The repo pins no toolchain: there is no `rust-toolchain.toml` and no `rust-version` in
`Cargo.toml`, so there is no declared MSRV. The last combination recorded as working (during the
July 2026 WASM investigation) is **cargo 1.87 / wasm-pack 0.13.1**.

## Build

```bash
npm run wasm:build
```

which is exactly:

```bash
cd rust && wasm-pack build --target web --out-dir pkg && cd .. && node scripts/sync-wasm.mjs
```

Two things happen, and the second one is the one people forget:

1. `wasm-pack build --target web` compiles the crate into `rust/pkg/`. wasm-pack defaults to a
   **release** build — there is no `--release` flag in the script and you do not need one.
2. `scripts/sync-wasm.mjs` copies `rmt_core.js` and `rmt_core_bg.wasm` from `rust/pkg/` into
   `src/wasm/`, printing one line per file:

   ```
   synced rmt_core.js (42725 bytes) -> src/wasm/
   synced rmt_core_bg.wasm (384008 bytes) -> src/wasm/
   ```

Then:

```bash
git add src/wasm/rmt_core.js src/wasm/rmt_core_bg.wasm
```

If you built the crate by hand (`cd rust && wasm-pack build --target web --out-dir pkg`), run the
copy step on its own:

```bash
npm run wasm:sync
```

It exits 1 with `No build found in <pkgDir> — run \`npm run wasm:build\` first.` if `rust/pkg/` is
empty.

::: warning `npm run build` requires Rust
The root `build` script is `npm run wasm:build && vite build`, so it fails at step one on a machine
without Rust and wasm-pack. To bundle the app without touching the crate, run `npx vite build` —
that is precisely what Vercel does. See [Build & Deploy](/developer/contributing/build-and-deploy).
:::

## What gets copied, and what does not

`scripts/sync-wasm.mjs` copies exactly two files:

| File | Size | Copied to `src/wasm/`? |
|---|---|---|
| `rmt_core_bg.wasm` | 384,008 bytes | Yes — this is the binary the app loads |
| `rmt_core.js` | 42,725 bytes | Yes — the wasm-bindgen glue the app imports |
| `rmt_core.d.ts` | ~15 KB | **No** — `src/` is plain JS; the typings stay in `rust/pkg/` |
| `rmt_core_bg.wasm.d.ts`, `package.json`, `LICENSE.md` | — | **No** |

`rust/pkg/` and `rust/target/` are both gitignored (`.gitignore:24-26`).

::: info Ignore `rust/pkg/package.json`
wasm-pack regenerates it, and it still carries a pre-relicense `"license"` string. It is never
published and never shipped. The authoritative licence is `license = "MIT"` in `rust/Cargo.toml`.
:::

## Crate layout

```
rust/
├── Cargo.toml
├── Cargo.lock
├── LICENSE.md
├── src/
│   ├── lib.rs        # re-exports, #[wasm_bindgen(start)] init(), version()
│   ├── fraction.rs   # Fraction (num-rational BigRational)
│   ├── value.rs      # Value, SymbolicPower, PowerTerm, corruption flags
│   ├── bytecode.rs   # opcodes
│   ├── evaluator.rs  # Evaluator, PersistentEvaluator, EvaluatedNote
│   ├── graph.rs      # DependencyGraph
│   └── compiler.rs   # ExpressionCompiler (legacy method-chain grammar only)
└── pkg/              # wasm-pack output — GITIGNORED
```

## Cargo.toml

This is the real one. Note `opt-level = 3`:

```toml
[package]
name = "rmt-core"
version = "0.1.0"
edition = "2021"
description = "Rust/WASM core for RMT Compose - high-performance expression evaluation"
license = "MIT"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
num-rational = "0.4"
num-bigint = "0.4"
num-traits = "0.2"
num-integer = "0.1"
serde = { version = "1.0", features = ["derive"] }
serde-wasm-bindgen = "0.6"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["console"] }
console_error_panic_hook = "0.1"

[dev-dependencies]
wasm-bindgen-test = "0.3"

[profile.release]
opt-level = 3
lto = true

[profile.dev]
opt-level = 1
```

::: warning Do not "optimize for size"
The project deliberately builds for **speed** (`opt-level = 3`), not size (`opt-level = "z"`). The
crate exists to make evaluation fast; a smaller, slower binary defeats its only purpose. If you need
to shrink the payload, the honest lever is to stop shipping the binary on the default path at all —
today it is fetched on every load and, with the evaluator
[blocked](/developer/wasm/overview#status-the-evaluator-hot-swap-is-blocked), never used.
:::

## Debug builds

```bash
cd rust
wasm-pack build --target web --out-dir pkg --dev   # debug symbols, [profile.dev] (opt-level 1)
npm run wasm:sync                                   # then sync, from the repo root
```

`lib.rs` calls `console_error_panic_hook::set_once()` from its `#[wasm_bindgen(start)]` function, so
a Rust panic arrives in the browser console with a symbolicated stack. To print from Rust:

```rust
use web_sys::console;
console::log_1(&"registering note".into());
```

Remember to re-sync and (if you want it in the browser) commit — the dev server loads
`src/wasm/rmt_core.js`, not `rust/pkg/`.

## Verifying a build

There is no unit-test runner in this repo (`npm test` validates the module library, not Rust). The
WASM checks are these two Node scripts:

```bash
# hot-swap end to end: build a Module before WASM init finishes,
# then verify the upgrade and identical evaluation results
node scripts/perf/test-wasm-swap.mjs

# run the WASM evaluator against a stress module
npm run perf:gen                                     # generate the stress modules first
node scripts/perf/bench-node.mjs chain-1000 --wasm
```

Both shim `fetch` for `file://` `.wasm` URLs, because Node's `fetch` cannot load the URL that
wasm-bindgen's init produces.

Both pass. The browser is where it breaks — see
[the hang dossier](/developer/wasm/overview#status-the-evaluator-hot-swap-is-blocked) before you
spend time chasing it.

## There is no WASM CI

The repo has no `.github/` directory and no CI pipeline of any kind, and Vercel does not build the
crate. Nothing regenerates `src/wasm/` for you. The committed artifacts are only as fresh as the
last person who ran `npm run wasm:build` and committed the result.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `wasm-pack: command not found` | `cargo install wasm-pack` |
| `target wasm32-unknown-unknown not found` | `rustup target add wasm32-unknown-unknown` |
| `No build found in …/rust/pkg` from `wasm:sync` | Run `npm run wasm:build` — you have no wasm-pack output to copy |
| `npm run build` fails immediately on a fresh clone | You have no Rust toolchain. Use `npx vite build` |
| Your Rust change has no effect in the browser | You did not run the sync step, or you did not restart the dev server. Check the mtime of `src/wasm/rmt_core_bg.wasm` |
| Your Rust change has no effect **in production** | You did not commit `src/wasm/` |

## See also

- [WASM Overview](/developer/wasm/overview) — what the crate contains and why the evaluator is off
- [JS/WASM Adapters](/developer/wasm/adapters) — the JS layer that loads and wraps it
- [Build & Deploy](/developer/contributing/build-and-deploy) — the full script inventory and the two Vercel projects
- [wasm-pack documentation](https://rustwasm.github.io/wasm-pack/)
