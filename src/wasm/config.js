/**
 * WASM Feature Configuration
 *
 * Controls which components use Rust/WASM vs JavaScript implementations.
 * Set individual flags to false to use JS fallback for that component.
 */

export const WASM_CONFIG = {
  // Feature flags - toggle individual WASM components
  // Set all to false to test JavaScript fallback path
  useEvaluator: true,      // Use WASM evaluator (requires usePersistentCache for performance)
  usePersistentCache: true, // Use WASM-persistent evaluation cache (O(N) vs O(N²) serialization)

  // Fallback behavior
  fallbackOnError: true,   // Fall back to JS if WASM fails
  logPerformance: false,   // Log performance comparisons

  // Debug options
  debug: false,            // Enable debug logging
};

/**
 * Check if WASM should be used for a specific component
 * @param {string} component - Component name ('evaluator', 'persistentCache')
 * @returns {boolean}
 */
export function shouldUseWasm(component) {
  switch (component) {
    case 'evaluator': return WASM_CONFIG.useEvaluator;
    case 'persistentCache': return WASM_CONFIG.usePersistentCache;
    default: return false;
  }
}

/**
 * Disable all WASM features (use JS fallback)
 */
export function disableWasm() {
  WASM_CONFIG.useEvaluator = false;
  WASM_CONFIG.usePersistentCache = false;
}

/**
 * Enable all WASM features
 */
export function enableWasm() {
  WASM_CONFIG.useEvaluator = true;
  WASM_CONFIG.usePersistentCache = true;
}
