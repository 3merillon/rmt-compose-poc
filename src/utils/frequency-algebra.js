/**
 * The algebraic form of a frequency expression, for the editor's rewrites
 * (Evaluate to BaseNote, re-anchoring a dragged note) that must keep powers
 * such as 2^(7/12) symbolic instead of flattening them to a rational.
 *
 *   frequency = coeff * ref.f * base1^(e1) * base2^(e2) * ...
 *
 * `coeff` is an exact Fraction; `powers` holds { base, expNum, expDen } with
 * small integers (TET steps); `noteRef` is the note whose frequency the
 * expression scales, or null for the BaseNote.
 */
import Fraction from 'fraction.js';

const gcdLocal = (a, b) => (b === 0 ? Math.abs(a) : gcdLocal(b, a % b));

/**
 * Parse a DSL frequency expression that is a product of one frequency
 * reference (`base.f` or `[N].f`), constants (`3`, `(3/2)`) and integer
 * powers (`2^(7/12)`, `3^2`).
 *
 * @param {string} expr
 * @returns {{ algebra: { coeff: Fraction, powers: Array<{base:number, expNum:number, expDen:number}> }, noteRef: number|null } | null}
 *   null when the expression has another shape (a sum, a division, two references, no reference)
 */
export function parseFrequencyAlgebra(expr) {
  if (!expr) return null;
  expr = String(expr).trim();
  // Split by top-level * that aren't inside parens
  const tokens = [];
  let depth = 0, start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
    else if (depth === 0 && expr[i] === '*') {
      if (expr[i + 1] !== '*' && (i === 0 || expr[i - 1] !== '*')) {
        tokens.push(expr.substring(start, i).trim());
        start = i + 1;
      }
    }
  }
  tokens.push(expr.substring(start).trim());

  let noteRef; // undefined = not found yet, null = base
  let coeff = new Fraction(1);
  const powers = [];

  for (const tok of tokens) {
    // Frequency reference: base.f or [N].f
    if (/^base\.f$/.test(tok)) {
      if (noteRef !== undefined) return null;
      noteRef = null;
      continue;
    }
    const nRef = tok.match(/^\[(\d+)\]\.f$/);
    if (nRef) {
      if (noteRef !== undefined) return null;
      noteRef = parseInt(nRef[1], 10);
      continue;
    }

    // Power: N ^ (a/b) or N ^ a or N ^ (-a/b)
    const powMatch = tok.match(/^(\d+)\s*\^\s*\(?\s*(-?\d+)\s*(?:\/\s*(\d+))?\s*\)?$/);
    if (powMatch) {
      const base = parseInt(powMatch[1], 10);
      const expNum = parseInt(powMatch[2], 10);
      const expDen = powMatch[3] ? parseInt(powMatch[3], 10) : 1;
      const existing = powers.find(p => p.base === base);
      if (existing) {
        const newNum = existing.expNum * expDen + expNum * existing.expDen;
        const newDen = existing.expDen * expDen;
        const g = gcdLocal(Math.abs(newNum), newDen);
        existing.expNum = newNum / g;
        existing.expDen = newDen / g;
        if (existing.expNum === 0) powers.splice(powers.indexOf(existing), 1);
      } else if (expNum !== 0) {
        powers.push({ base, expNum, expDen });
      }
      continue;
    }

    // Coefficient: (a/b) or a number, BigInt-exact (parseInt silently
    // truncates digit runs past 2^53, e.g. after ~53 octave-arrow presses)
    const fracMatch = tok.match(/^\(?\s*(-?\d+)\s*\/\s*(\d+)\s*\)?$/);
    if (fracMatch) {
      coeff = coeff.mul(new Fraction(BigInt(fracMatch[1]), BigInt(fracMatch[2])));
      continue;
    }
    const numMatch = tok.match(/^(-?\d+)$/);
    if (numMatch) {
      coeff = coeff.mul(new Fraction(BigInt(numMatch[1]), 1n));
      continue;
    }

    return null;
  }

  if (noteRef === undefined) return null;
  return { algebra: { coeff, powers }, noteRef };
}
