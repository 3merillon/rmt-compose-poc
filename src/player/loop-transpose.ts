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
 *
 * The factors themselves are exact: passTransposition() in display-transpose.js,
 * shared by the audio and the display. A module may set its own repeat (the
 * BaseNote's `repeat`), which wins over this setting.
 */

const gcd = (a: number, b: number) => { while (b) [a, b] = [b, a % b]; return a; };

/**
 * A loop ratio from settings: positive whole numbers n and d (at most 10^6),
 * n/d between 1/16 and 16, reduced. 1/1 (no transposition) is allowed.
 * @returns {{n:number, d:number}}
 */
export function validateLoopRatio(raw: unknown, fallback = { n: 1, d: 1 }) {
  const ok = (v: number) => Number.isInteger(v) && v >= 1 && v <= 1e6;
  const n = Number(raw && typeof raw === 'object' && 'n' in raw ? raw.n : undefined);
  const d = Number(raw && typeof raw === 'object' && 'd' in raw ? raw.d : undefined);
  if (!ok(n) || !ok(d)) return { ...fallback };
  const r = n / d;
  if (!(r >= 1 / 16 && r <= 16)) return { ...fallback };
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
