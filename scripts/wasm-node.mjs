/**
 * Run a Node script on the WASM evaluator.
 *
 *   node --import ./scripts/wasm-node.mjs scripts/test-variable-deps.mjs
 *
 * Sets RMT_EVALUATOR=wasm (src/wasm/evaluator-adapter.js reads it when it is
 * first imported, so this has to come first) and initializes the WASM module
 * before the script runs, so every Module the script creates evaluates on the
 * Rust core from the start. Node's fetch cannot load the file:// URL
 * wasm-bindgen's init uses, so .wasm file URLs are read from disk.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.RMT_EVALUATOR = 'wasm';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const u = String(url);
  if (u.startsWith('file://') && u.endsWith('.wasm')) {
    return new Response(readFileSync(fileURLToPath(u)), { headers: { 'content-type': 'application/wasm' } });
  }
  return realFetch(url, ...rest);
};

const { initWasm } = await import('../src/wasm/index.js');
if (!(await initWasm())) {
  console.error('wasm-node: the WASM module did not initialize');
  process.exit(1);
}
