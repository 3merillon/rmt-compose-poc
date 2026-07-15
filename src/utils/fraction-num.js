/**
 * The numeric boundary module for exact rational values.
 *
 * Exact side: BigInt parsing/normalization helpers used by both expression
 * compilers so number literals survive at any magnitude (never routed through
 * parseFloat/Number).
 *
 * Lossy side: toNumber() is THE documented float boundary. Everything that
 * feeds GL geometry, Web Audio params, cents readouts, or tolerance-based
 * gesture checks converts through it — once, late, and overflow-safe.
 */

/** BigInt gcd of absolute values. Returns 1n when both inputs are 0n. */
export function bigGcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1n;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Parse a plain decimal string ('42', '-3', '1.25', huge digit runs) into an
 * exact reduced BigInt fraction. Decimals are exact-as-written: '0.333333'
 * is 333333/1000000, not 1/3. Returns null when the string is not a plain
 * decimal (scientific notation, blanks, garbage).
 *
 * @param {string} str
 * @returns {{num: bigint, den: bigint} | null}
 */
export function decimalStringToBigFraction(str) {
  if (typeof str !== 'string') return null;
  const m = DECIMAL_RE.exec(str.trim());
  if (!m) return null;
  const [, sign, intPart, fracPart = ''] = m;
  let num = BigInt(intPart + fracPart);
  let den = 10n ** BigInt(fracPart.length);
  const g = bigGcd(num, den);
  num /= g;
  den /= g;
  return { num: sign === '-' ? -num : num, den };
}

/** Decimal digit count of a BigInt magnitude (sign ignored). */
export function bigDigits(v) {
  const s = (v < 0n ? -v : v).toString();
  return s.length;
}

// Number.MAX_VALUE has 309 decimal digits; below this both fields convert to
// finite doubles and plain valueOf() division is correctly rounded.
const SAFE_DIGITS = 300;

/**
 * THE lossy Fraction → Number boundary.
 *
 * fraction.js valueOf() computes Number(s*n)/Number(d); when both n and d
 * exceed the double range (~1.8e308) that is Infinity/Infinity = NaN even
 * though the value itself is modest (deep exact chains reach this). This
 * helper strips a common power of ten from oversized components first, so it
 * returns a correctly-signed finite double for every real fraction.
 *
 * Accepts a Fraction, a duck-typed {s,n,d} (Number or BigInt fields), a
 * number, or null/undefined (→ fallback, default 0).
 *
 * @param {object|number|null} frac
 * @param {number} [fallback=0] value when frac is null/undefined/invalid
 * @returns {number} always finite unless the true value overflows a double
 */
export function toNumber(frac, fallback = 0) {
  if (frac == null) return fallback;
  if (typeof frac === 'number') return frac;
  if (typeof frac === 'bigint') return Number(frac);

  const n = frac.n;
  const d = frac.d;
  if (typeof n === 'bigint' && typeof d === 'bigint') {
    const s = frac.s != null && frac.s < 0n ? -1 : 1;
    const nDigits = bigDigits(n);
    const dDigits = bigDigits(d);
    if (nDigits > SAFE_DIGITS || dDigits > SAFE_DIGITS) {
      // Shift both down by a common power of ten so at least one side lands
      // well inside double range; the ratio is preserved to double precision.
      const shift = BigInt(Math.min(nDigits, dDigits) - 15 > 0 ? Math.min(nDigits, dDigits) - 15 : 0);
      const p = 10n ** shift;
      const nv = Number(n / p);
      const dv = Number(d / p);
      if (dv === 0) return s * (nv === 0 ? fallback : Infinity);
      return s * (nv / dv);
    }
    return s * (Number(n) / Number(d));
  }

  // Number-backed Fraction (4.x) or duck-typed value: valueOf is fine.
  if (typeof frac.valueOf === 'function') {
    const v = frac.valueOf();
    return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
  }
  return fallback;
}
