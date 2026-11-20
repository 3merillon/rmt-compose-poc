/**
 * Loop transposition: each repeat of a loop (long-press Play) a ratio higher
 * than the one before, so Bach's Canon per tonos — which rises a whole tone each
 * time round — plays as it is written: set 9/8 and let it loop. The owner's
 * request, 20 November 2026: "a setting to be able to choose an interval on
 * repeat ... as it repeats it does the neverending Canon proper."
 *
 * Pass 0 is the module as written; pass k sounds at ratio^k. Pure ratios never
 * close: six pure whole tones are an octave and a Pythagorean comma, so an
 * endless rise would leave hearing (at 9/8, about 37 passes from 263 Hz). With
 * `fold`, the transposition is kept within one octave: a rising ratio in [1, 2),
 * a falling one in (1/2, 1]. Every note of a pass is scaled by the same factor,
 * so the ratios inside a pass stay exactly as written.
 */

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/**
 * A loop ratio from settings: positive whole numbers n and d (at most 10^6),
 * n/d between 1/16 and 16, reduced. 1/1 (no transposition) is allowed.
 * @returns {{n:number, d:number}}
 */
export function validateLoopRatio(raw, fallback = { n: 1, d: 1 }) {
  const ok = (v) => Number.isInteger(v) && v >= 1 && v <= 1e6;
  const n = Number(raw && raw.n), d = Number(raw && raw.d);
  if (!ok(n) || !ok(d)) return { ...fallback };
  const r = n / d;
  if (!(r >= 1 / 16 && r <= 16)) return { ...fallback };
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

/**
 * The factor every frequency of loop pass `pass` is multiplied by.
 * @param {{n:number, d:number}} ratio
 * @param {number} pass 0 = the first pass (as written)
 * @param {boolean} fold keep it within one octave
 */
export function passFactor(ratio, pass, fold) {
  if (!ratio || !(pass > 0) || ratio.n === ratio.d) return 1;
  let e = pass * Math.log2(ratio.n / ratio.d);
  if (fold) e = ratio.n > ratio.d ? e - Math.floor(e) : e - Math.ceil(e);
  return Math.pow(2, e);
}
