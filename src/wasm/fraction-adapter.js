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
  if (shouldUseWasm('fractions') && isWasmAvailable()) {
    const wasm = getWasm();
    try {
      if (typeof num === 'string') {
        return wasm.Fraction.fromString(num);
      }
      return new wasm.Fraction(Math.floor(num), Math.floor(den));
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM Fraction creation failed, using JS fallback:', e);
        }
        return new FractionJS(num, den);
      }
      throw e;
    }
  }
  return new FractionJS(num, den);
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

  // Convert WASM Fraction to fraction.js
  const s = wasmFraction.s;
  const n = wasmFraction.n;
  const d = wasmFraction.d;

  const frac = new FractionJS(0);
  frac.s = s;
  frac.n = n;
  frac.d = d;
  return frac;
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
    const num = jsFraction.s * jsFraction.n;
    return new wasm.Fraction(num, jsFraction.d);
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

  // Check for WASM Fraction (duck typing)
  if (typeof value.s === 'number' &&
      typeof value.n === 'number' &&
      typeof value.d === 'number' &&
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
