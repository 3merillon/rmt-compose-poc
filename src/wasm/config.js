/**
 * WASM Feature Configuration
 *
 * Controls which components use Rust/WASM vs JavaScript implementations.
 * Set individual flags to false to use JS fallback for that component.
 */

export const WASM_CONFIG = {
  // Feature flags - toggle individual WASM components
  // Set all to false to test JavaScript fallback path
  useFractions: true,      // Use WASM Fraction arithmetic
  useEvaluator: true,      // Use WASM evaluator (requires usePersistentCache for performance)
  useGraph: true,          // Use WASM dependency graph
  useCompiler: true,       // Use WASM expression compiler
  usePersistentCache: true, // Use WASM-persistent evaluation cache (O(N) vs O(N²) serialization)

  // Fallback behavior
  fallbackOnError: true,   // Fall back to JS if WASM fails
  logPerformance: false,   // Log performance comparisons

  // Debug options
  debug: false,            // Enable debug logging
};

/**
 * Check if WASM should be used for a specific component
 * @param {string} component - Component name ('fractions', 'evaluator', 'graph', 'compiler')
 * @returns {boolean}
 */
export function shouldUseWasm(component) {
  switch (component) {
    case 'fractions': return WASM_CONFIG.useFractions;
    case 'evaluator': return WASM_CONFIG.useEvaluator;
    case 'graph': return WASM_CONFIG.useGraph;
    case 'compiler': return WASM_CONFIG.useCompiler;
    case 'persistentCache': return WASM_CONFIG.usePersistentCache;
    default: return false;
  }
}

/**
 * Disable all WASM features (use JS fallback)
 */
export function disableWasm() {
  WASM_CONFIG.useFractions = false;
  WASM_CONFIG.useEvaluator = false;
  WASM_CONFIG.useGraph = false;
  WASM_CONFIG.useCompiler = false;
  WASM_CONFIG.usePersistentCache = false;
}

/**
 * Enable all WASM features
 */
export function enableWasm() {
  WASM_CONFIG.useFractions = true;
  WASM_CONFIG.useEvaluator = true;
  WASM_CONFIG.useGraph = true;
  WASM_CONFIG.useCompiler = true;
  WASM_CONFIG.usePersistentCache = true;
}
