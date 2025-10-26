// Compatibility layer for gradual ES6 migration
// This ensures window references work during transition

export function exposeToWindow(name, value) {
    if (typeof window !== 'undefined') {
        window[name] = value;
    }
}

export function getFromWindow(name) {
    if (typeof window !== 'undefined') {
        return window[name];
    }
    return undefined;
}

// Helper to make Fraction available globally
export function setupGlobalFraction(Fraction) {
    if (typeof window !== 'undefined') {
        window.Fraction = Fraction;
    }
}

// Helper to make tapspace available
export function getTapspace() {
    if (typeof window !== 'undefined' && window.tapspace) {
        return window.tapspace;
    }
    throw new Error('Tapspace library not loaded');
}
// ---------------------------------------------
// Compat facade additions for safe, incremental migration
// Centralize all window.* exposures and deprecation messaging
// ---------------------------------------------

// Track which deprecation messages have been shown to avoid noise
const __compatWarned = new Set();

/**
 * warnDeprecated(name, alternative)
 * Emits a one-time console warning that a global is deprecated.
 * @param {string} name - The global name being accessed.
 * @param {string} [alternative] - Optional suggestion for replacement.
 */
export function warnDeprecated(name, alternative) {
  if (typeof window === 'undefined') return;
  try {
    if (!__compatWarned.has(name)) {
      const suggestion = alternative ? ` Use ${alternative} instead.` : '';
      // Keep console output minimal and recognizable
      console.warn(`[compat] Global "${name}" is deprecated.${suggestion}`);
      __compatWarned.add(name);
    }
  } catch {
    // no-op
  }
}

/**
 * registerGlobals(map, options)
 * Assign a set of keys to window for legacy code compatibility.
 * Intended as a temporary shim while migrating away from globals.
 *
 * Example:
 *   registerGlobals({
 *     Fraction,
 *     tapspace,
 *     Module,
 *     Note,
 *     InstrumentManager,
 *     SynthInstrument,
 *     SampleInstrument,
 *     SynthInstruments,
 *     SampleInstruments,
 *     invalidateModuleEndTimeCache
 *   })
 *
 * @param {Record<string, any>} map - Key/value pairs to expose on window
 * @param {Object} [options]
 * @param {boolean} [options.freeze=false] - If true, Object.freeze() objects (best-effort)
 */
export function registerGlobals(map, { freeze = false } = {}) {
  if (typeof window === 'undefined' || !map || typeof map !== 'object') return;
  Object.keys(map).forEach((key) => {
    window[key] = map[key];
    if (freeze && map[key] && typeof map[key] === 'object') {
      try { Object.freeze(map[key]); } catch { /* ignore */ }
    }
  });
}