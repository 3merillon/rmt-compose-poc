/**
 * The label a note shows on the canvas: its exact relation to the BaseNote's frequency.
 *
 *  - a pure ratio   → its fraction, stacked: { num: '3', den: '2' }
 *  - a tempered note → its power on one line: { num: '2^(7/12)', den: LINE_LABEL },
 *                     '3/2·2^(1/2)' with a coefficient
 *  - approximate     → { approx: true }: the caller draws ≈ and a rounded fraction
 *
 * An exact fraction with more than MAX_DIGITS digits in either part, or a power
 * longer than MAX_LINE characters, does not fit the label: it is drawn rounded,
 * with ≈ ({ approx: true }), so a rounded number never passes as the exact one.
 * The hatching says whether a note is tempered; the label says what it is.
 */
import * as X from '../../value/exact.js';

export const LINE_LABEL = '\u0000line';
const MAX_DIGITS = 4;
const MAX_LINE = 16;
const APPROX = Object.freeze({ approx: true });

const digits = (b) => (b < 0n ? -b : b).toString().length;
const fracText = (f) => (f.d === 1n ? `${f.s * f.n}` : `${f.s * f.n}/${f.d}`);

/**
 * @param {Fraction|Irrational|Approx} value the note's exact frequency
 * @param {Fraction|Irrational|Approx} base the BaseNote's exact frequency
 * @returns {{num: string, den: string}|{approx: true}|null} null when there is no ratio
 */
export function noteLabel(value, base) {
  if (value == null || base == null || X.isZero(base)) return null;
  const r = X.div(value, base);
  if (X.isApprox(r)) return APPROX;
  if (X.isRational(r)) {
    if (digits(r.s * r.n) > MAX_DIGITS || digits(r.d) > MAX_DIGITS) return APPROX;
    return { num: `${r.s * r.n}`, den: `${r.d}` };
  }
  // Irrational: coefficient and powers on one line
  let text;
  if (r.terms.length === 1) {
    const t = r.terms[0];
    const parts = [];
    if (!t.c.equals(1)) parts.push(fracText(t.c));
    for (const [b, e] of t.rad) parts.push(`${b}^(${e.s * e.n}/${e.d})`);
    text = parts.join('·');
  } else {
    text = X.toText(r).replace(/ \* /g, '·');
  }
  if (text.length > MAX_LINE) return APPROX;
  return { num: text, den: LINE_LABEL };
}
