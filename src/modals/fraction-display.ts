// Display policy for exact values in the note widget and add-note preview:
// values whose numerator + denominator stay within 24 digits keep their
// existing exact rendering; larger ones collapse to an 8-significant-digit
// approximation, with an elided exact n/d form surfaced via the element's
// title attribute so the exact value stays reachable.
import { bigDigits, toNumber } from '../utils/fraction-num.ts';

const EXACT_DIGIT_LIMIT = 24;
const EDGE_DIGITS = 12;

function elideDigits(v: bigint) {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString();
  const body = s.length <= EXACT_DIGIT_LIMIT
    ? s
    : `${s.slice(0, EDGE_DIGITS)}…${s.slice(-EDGE_DIGITS)}`;
  return (neg ? '-' : '') + body;
}

/**
 * Decide how to display an exact fraction that may be huge.
 * Returns null when the value is small enough to keep the caller's exact
 * rendering, otherwise { text, title } with the '≈' approximation and the
 * elided exact 'n/d' form.
 *
 * @param {object} frac - Fraction (BigInt-backed) or duck-typed {s,n,d}
 * @returns {{text: string, title: string} | null}
 */
export function hugeFractionDisplay(frac: unknown) {
  if (!frac || typeof frac !== 'object' || !('n' in frac) || !('d' in frac)) return null;
  const { n, d } = frac;
  if (typeof n !== 'bigint' || typeof d !== 'bigint') return null;
  if (bigDigits(n) + bigDigits(d) <= EXACT_DIGIT_LIMIT) return null;
  const s = 's' in frac && (typeof frac.s === 'bigint' || typeof frac.s === 'number') ? frac.s : 1n;
  const signed = s < 0n ? -n : n;
  return {
    text: `≈${toNumber({s, n, d}).toPrecision(8)}`,
    title: `${elideDigits(signed)}/${elideDigits(d)}`
  };
}
