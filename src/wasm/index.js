/**
 * WASM Module Loader
 *
 * Handles loading and initialization of the Rust/WASM module.
 * Provides graceful fallback if WASM is unavailable.
 */

import { WASM_CONFIG } from './config.js';
import { isEvaluatorHotSwapEnabled } from './evaluator-adapter.js';

// WASM module reference
let wasmModule = null;
let wasmInitialized = false;
let wasmError = null;
let readyCallbacks = [];

function flushReadyCallbacks() {
  const cbs = readyCallbacks;
  readyCallbacks = [];
  for (const cb of cbs) {
    try { cb(); } catch (e) { console.warn('onWasmReady callback failed:', e); }
  }
}

/**
 * Register a callback to run once WASM is successfully initialized.
 * If WASM is already available, the callback runs on a microtask.
 * If WASM init already failed, the callback is never called.
 */
export function onWasmReady(cb) {
  if (wasmModule !== null) {
    Promise.resolve().then(() => {
      try { cb(); } catch (e) { console.warn('onWasmReady callback failed:', e); }
    });
    return;
  }
  if (wasmInitialized) return; // initialized with failure — WASM will never arrive
  readyCallbacks.push(cb);
}

// The one initialization in flight or done. Three callers start it at boot
// (main.js, store/app-state.js and the auto-init below), in the same tick.
// Each used to run its own: wasm-bindgen's init checks for an instance only
// before its first await, so all three fetched and instantiated the module,
// and the last to finish replaced the instance under objects made on an
// earlier one ("recursive use of an object", or a hang).
let initPromise = null;

/**
 * Initialize the WASM module. Every call shares one initialization.
 * @returns {Promise<boolean>} True if WASM loaded successfully
 */
export function initWasm() {
  if (initPromise === null) {
    // The WASM evaluator is opt-in (?evaluator=wasm — see evaluator-adapter.js).
    // Without the opt-in nothing consumes the module, so skip the 384 KB
    // fetch+instantiate entirely. Headless Node (benches/tests) has no window
    // and passes the gate.
    if (!isEvaluatorHotSwapEnabled()) {
      return Promise.resolve(false);
    }
    initPromise = loadWasm();
  }
  return initPromise;
}

async function loadWasm() {
  try {
    // Dynamic import of the WASM module
    // This path will be resolved by Vite
    const wasm = await import('./rmt_core.js');

    // Initialize the WASM module (calls the start function)
    await wasm.default();

    wasmModule = wasm;
    wasmInitialized = true;

    if (WASM_CONFIG.debug) {
      console.log(`WASM initialized: rmt-core v${wasm.version()}`);
    }

    flushReadyCallbacks();

    return true;
  } catch (e) {
    wasmError = e;
    wasmInitialized = true; // Mark as initialized (with failure)
    readyCallbacks = []; // pending ready callbacks will never fire

    if (WASM_CONFIG.debug || !WASM_CONFIG.fallbackOnError) {
      console.warn('WASM initialization failed:', e);
    }

    if (!WASM_CONFIG.fallbackOnError) {
      throw e;
    }

    return false;
  }
}

/**
 * Get the WASM module (or null if not loaded)
 * @returns {Object|null}
 */
export function getWasm() {
  return wasmModule;
}

/**
 * Check if WASM is available
 * @returns {boolean}
 */
export function isWasmAvailable() {
  return wasmModule !== null;
}

/**
 * Check if WASM has been initialized (regardless of success)
 * @returns {boolean}
 */
export function isWasmInitialized() {
  return wasmInitialized;
}

/**
 * Get the WASM initialization error (if any)
 * @returns {Error|null}
 */
export function getWasmError() {
  return wasmError;
}

/**
 * Get WASM module version
 * @returns {string|null}
 */
export function getWasmVersion() {
  return wasmModule?.version?.() ?? null;
}

// Auto-initialize if not in a test environment. No-op unless the
// ?evaluator=wasm opt-in is present — initWasm() gates the fetch.
if (typeof window !== 'undefined') {
  // Defer initialization to avoid blocking
  setTimeout(() => {
    initWasm().catch(e => {
      if (WASM_CONFIG.debug) {
        console.warn('WASM auto-initialization failed:', e);
      }
    });
  }, 0);
}
