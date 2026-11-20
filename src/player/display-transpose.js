/**
 * What a transposed loop pass shows (the owner, 20 November 2026: "during that
 * transposed play the values should be corrected each time"; "show it, don't
 * write it"). While a loop that transposes each repeat plays, every absolute
 * value on screen (the BaseNote's frequency, each note's frequency in the note
 * widget) is the value of the pass being heard: the written value times the
 * pass's factor, exact. Ratios between notes do not change. The module is never
 * touched: Stop (or the end of playback) clears it.
 *
 * Also the module's own repeat: the BaseNote's `repeat`, an expression giving the
 * frequency the BaseNote takes on the next repeat (`(9/8) * base.f`, `[24].f`,
 * `2^(1/6) * base.f`). Its ratio to base.f is the transposition from one pass to
 * the next. It belongs to the module and nothing else (the owner: "shouldn't be
 * imposed on the composer"): saved with it, cleared by Clean Slate, absent from a
 * new composition; Settings → Audio → Loop and the BaseNote's REPEAT row both edit
 * this one value.
 */
import Fraction from 'fraction.js';
import * as X from '../value/exact.js';
import { compiler } from '../expression-compiler.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { eventBus } from '../utils/event-bus.js';

let current = { pass: 0, factor: null };

/** The pass being shown and its exact factor (null = as written). */
export function getDisplayTransposition() { return current; }

/** Set the pass on screen; emits `display:transposition` when it changes. */
export function setDisplayTransposition(pass, factor) {
  const f = factor && !(X.isRational(factor) && factor.n === factor.d && factor.s > 0n) ? factor : null;
  const p = f ? pass : 0;
  if (p === current.pass && ((f == null && current.factor == null) || (f && current.factor && X.equals(f, current.factor)))) return;
  current = { pass: p, factor: f };
  try { eventBus.emit('display:transposition', current); } catch {}
}

export function clearDisplayTransposition() { setDisplayTransposition(0, null); }

/** A written frequency (exact) as the current pass shows it. */
export function shownFrequency(exact) {
  if (!current.factor || exact == null) return exact;
  try { return X.mul(exact, current.factor); } catch { return exact; }
}

const ONE = new Fraction(1);
const TWO = new Fraction(2);
const HALF = new Fraction(1, 2);

/**
 * The exact factor of pass `pass` for a pass-to-pass ratio: ratio^pass, kept
 * within one octave when `fold` ([1, 2) rising, (1/2, 1] falling), by exact
 * comparison with powers of two.
 */
export function passTransposition(ratio, pass, fold) {
  if (!ratio || !(pass > 0)) return ONE;
  let v = X.pow(ratio, new Fraction(pass));
  if (!fold) return v;
  const rising = X.compare(ratio, ONE) > 0;
  const guess = Math.floor(Math.log2(X.toNumber(v, 1)));
  if (Number.isFinite(guess) && guess !== 0) v = X.div(v, X.pow(TWO, new Fraction(guess)));
  for (let i = 0; i < 4; i++) {
    if (rising) {
      if (X.compare(v, ONE) < 0) v = X.mul(v, TWO);
      else if (X.compare(v, TWO) >= 0) v = X.div(v, TWO);
      else break;
    } else {
      if (X.compare(v, ONE) > 0) v = X.div(v, TWO);
      else if (X.compare(v, HALF) <= 0) v = X.mul(v, TWO);
      else break;
    }
  }
  return v;
}

/**
 * The module's own repeat ratio: its BaseNote's `repeat` expression evaluated in
 * the module, divided by base.f; exact (rational, or irrational for a tempered
 * repeat). null when the module sets none or it does not evaluate.
 */
export function setModuleRepeat(module, expr) {
  if (!module || !module.baseNote) return false;
  const text = expr == null ? '' : String(expr).trim();
  module.baseNote.setVariable('repeat', text || null);
  try { eventBus.emit('module:repeatChanged', { repeat: text || null }); } catch {}
  return true;
}

/** The repeat written as a plain ratio of base.f: `(n/d) * base.f` (or none, for 1/1). */
export function repeatExprForRatio(n, d) {
  return n === d ? null : `(${n}/${d}) * base.f`;
}

export function moduleRepeatRatio(module) {
  const src = module && module.baseNote && module.baseNote.properties && module.baseNote.properties.repeat;
  if (!src || typeof src !== 'string') return null;
  try {
    const binary = compiler.compile(src);
    const cache = module.getEvaluationCache();
    const ev = new BinaryEvaluator(module);
    const r = ev.evaluate(binary, cache);
    const value = ev._lastExact || (r && typeof r.n === 'bigint' ? new Fraction(r.s * r.n, r.d) : null);
    const base = module.baseNote.getExactVariable ? module.baseNote.getExactVariable('frequency') : module.baseNote.getVariable('frequency');
    if (!value || !base || X.isZero(base)) return null;
    const ratio = X.div(value, base);
    return X.toNumber(ratio, NaN) > 0 ? ratio : null;
  } catch (e) {
    console.warn('[RMT] repeat: could not evaluate', src, e && e.message);
    return null;
  }
}
