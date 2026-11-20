/**
 * WASM Feature Configuration
 *
 * Controls which components use Rust/WASM vs JavaScript implementations.
 * Set individual flags to false to use JS fallback for that component.
 */

export const WASM_CONFIG = {
  // Feature flags - toggle individual WASM components
  // Set to false to test the JavaScript fallback path
  useEvaluator: true,      // Use the WASM evaluator (the Rust PersistentEvaluator)

  // Fallback behavior
  fallbackOnError: true,   // Fall back to JS if WASM fails
  logPerformance: false,   // Log performance comparisons

  // Debug options
  debug: false,            // Enable debug logging
};

/**
 * Check if WASM should be used for a specific component
 * @param {string} component - Component name ('evaluator')
 * @returns {boolean}
 */
export function shouldUseWasm(component) {
  switch (component) {
    case 'evaluator': return WASM_CONFIG.useEvaluator;
    default: return false;
  }
}

/**
 * Disable all WASM features (use JS fallback)
 */
export function disableWasm() {
  WASM_CONFIG.useEvaluator = false;
}

/**
 * Enable all WASM features
 */
export function enableWasm() {
  WASM_CONFIG.useEvaluator = true;
}
