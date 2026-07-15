/**
 * Fraction Adapter
 *
 * Provides a unified interface for fraction arithmetic,
 * using WASM when available and falling back to fraction.js.
 */

import FractionJS from 'fraction.js';
import { getWasm, isWasmAvailable } from './index.js';
import { WASM_CONFIG, shouldUseWasm } from './config.js';

/**
 * Create a Fraction using the appropriate implementation
 * @param {number|string} num - Numerator or string representation
 * @param {number} [den=1] - Denominator
 * @returns {Object} Fraction instance
 */
export function createFraction(num, den = 1) {
  // fraction.js 5.x rejects a string numerator alongside a denominator
  const jsFraction = () =>
    typeof num === 'string' ? new FractionJS(num) : new FractionJS(num, den);

  if (shouldUseWasm('fractions') && isWasmAvailable()) {
    const wasm = getWasm();
    try {
      if (typeof num === 'string') {
        return wasm.Fraction.fromString(num);
      }
      // fromString parses arbitrary-precision 'n/d'; the i32 constructor
      // would reject BigInt and wrap anything >= 2^31
      const n = typeof num === 'bigint' ? num : Math.floor(num);
      const d = typeof den === 'bigint' ? den : Math.floor(den);
      return wasm.Fraction.fromString(`${n}/${d}`);
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM Fraction creation failed, using JS fallback:', e);
        }
        return jsFraction();
      }
      throw e;
    }
  }
  return jsFraction();
}

/**
 * Convert a WASM Fraction to fraction.js format (for compatibility)
 * @param {Object} wasmFraction - WASM Fraction instance
 * @returns {Object} fraction.js compatible object
 */
export function toFractionJS(wasmFraction) {
  if (!wasmFraction) return null;

  // If it's already a fraction.js instance, return as-is
  if (wasmFraction instanceof FractionJS) {
    return wasmFraction;
  }

  // Convert WASM Fraction to fraction.js. numeratorStr()/denominatorStr()
  // are exact at any magnitude (the .n/.d getters saturate at u32::MAX);
  // numeratorStr() is the absolute value, so the sign comes from .s.
  const sign = wasmFraction.s < 0 ? '-' : '';
  if (typeof wasmFraction.numeratorStr === 'function' &&
      typeof wasmFraction.denominatorStr === 'function') {
    return new FractionJS(`${sign}${wasmFraction.numeratorStr()}/${wasmFraction.denominatorStr()}`);
  }
  return new FractionJS(`${sign}${wasmFraction.n}/${wasmFraction.d}`);
}

/**
 * Convert fraction.js to WASM Fraction
 * @param {Object} jsFraction - fraction.js instance
 * @returns {Object} WASM Fraction or original if WASM unavailable
 */
export function fromFractionJS(jsFraction) {
  if (!jsFraction) return null;

  if (shouldUseWasm('fractions') && isWasmAvailable()) {
    const wasm = getWasm();
    // Template interpolation of BigInt fields is exact at any magnitude
    return wasm.Fraction.fromString(`${jsFraction.s * jsFraction.n}/${jsFraction.d}`);
  }

  return jsFraction;
}

/**
 * Check if a value is a Fraction (either WASM or JS)
 * @param {*} value
 * @returns {boolean}
 */
export function isFraction(value) {
  if (!value) return false;

  // Check for fraction.js
  if (value instanceof FractionJS) return true;

  // Check for WASM Fraction or duck-typed fraction (fields are Numbers on
  // the WASM side, BigInt on fraction.js 5.x instances from another realm)
  const isField = (v) => typeof v === 'number' || typeof v === 'bigint';
  if (isField(value.s) &&
      isField(value.n) &&
      isField(value.d) &&
      typeof value.add === 'function') {
    return true;
  }

  return false;
}

/**
 * Perform fraction addition
 * @param {Object} a - First fraction
 * @param {Object} b - Second fraction
 * @returns {Object} Result fraction
 */
export function add(a, b) {
  return a.add(b);
}

/**
 * Perform fraction subtraction
 * @param {Object} a - First fraction
 * @param {Object} b - Second fraction
 * @returns {Object} Result fraction
 */
export function sub(a, b) {
  return a.sub(b);
}

/**
 * Perform fraction multiplication
 * @param {Object} a - First fraction
 * @param {Object} b - Second fraction
 * @returns {Object} Result fraction
 */
export function mul(a, b) {
  return a.mul(b);
}

/**
 * Perform fraction division
 * @param {Object} a - Dividend fraction
 * @param {Object} b - Divisor fraction
 * @returns {Object} Result fraction
 */
export function div(a, b) {
  return a.div(b);
}

/**
 * Negate a fraction
 * @param {Object} frac - Fraction to negate
 * @returns {Object} Negated fraction
 */
export function neg(frac) {
  return frac.neg();
}

/**
 * Convert fraction to float
 * @param {Object} frac - Fraction
 * @returns {number} Float value
 */
export function toFloat(frac) {
  if (typeof frac.toF64 === 'function') {
    return frac.toF64();
  }
  return frac.valueOf();
}

// Export the default Fraction constructor for compatibility
export { FractionJS as Fraction };
