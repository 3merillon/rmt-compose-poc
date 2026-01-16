/**
 * WASM Module Loader
 *
 * Handles loading and initialization of the Rust/WASM module.
 * Provides graceful fallback if WASM is unavailable.
 */

import { WASM_CONFIG } from './config.js';

// WASM module reference
let wasmModule = null;
let wasmInitialized = false;
let wasmError = null;

/**
 * Initialize the WASM module
 * @returns {Promise<boolean>} True if WASM loaded successfully
 */
export async function initWasm() {
  if (wasmInitialized) {
    return wasmModule !== null;
  }

  try {
    // Dynamic import of the WASM module
    // This path will be resolved by Vite
    const wasm = await import('../../rust/pkg/rmt_core.js');

    // Initialize the WASM module (calls the start function)
    await wasm.default();

    wasmModule = wasm;
    wasmInitialized = true;

    if (WASM_CONFIG.debug) {
      console.log(`WASM initialized: rmt-core v${wasm.version()}`);
    }

    return true;
  } catch (e) {
    wasmError = e;
    wasmInitialized = true; // Mark as initialized (with failure)

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

// Auto-initialize if not in a test environment
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
