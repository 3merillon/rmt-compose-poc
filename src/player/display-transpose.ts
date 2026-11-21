/**
 * What a transposed loop pass shows (the owner, 20 November 2026: "during that
 * transposed play the values should be corrected each time"; "show it, don't
 * write it"). While a loop that transposes each repeat plays, every absolute
 * value on screen (the BaseNote's frequency, each note's frequency in the note
 * widget) is the value of the pass being heard: the written value times the
 * pass's factor, exact. Ratios between notes do not change. The module is never
 * touched: Stop (or the end of playback) clears it.
 *
 * Also the module's own repeat: the BaseNote's `repeat`, the RATIO from one
 * repeat to the next, as an expression of the module (`9/8`, `3/2`, `2^(1/6)`,
 * `[24].f / base.f`). It belongs to the module and nothing else (the owner:
 * "shouldn't be imposed on the composer"): saved with it, cleared by Clean Slate,
 * absent from a new composition; Settings → Audio → Loop and the BaseNote's REPEAT
 * row both edit this one value. (A first version read it as the frequency of the
 * next repeat's BaseNote; the owner typed 3/2 and heard it fall: 3/2 Hz against
 * 263 Hz. A ratio is what one writes.)
 */
import Fraction from 'fraction.js';
import * as X from '../value/exact.ts';
import type { ExactValue } from '../value/exact.ts';
import type { Module } from '../module.ts';
import { compiler } from '../expression-compiler.ts';
import { BinaryEvaluator } from '../binary-evaluator.ts';
import { eventBus } from '../utils/event-bus.ts';

let current: { pass: number; factor: ExactValue | null } = { pass: 0, factor: null };

/** The pass being shown and its exact factor (null = as written). */
export function getDisplayTransposition() { return current; }

/** Set the pass on screen; emits `display:transposition` when it changes. */
export function setDisplayTransposition(pass: number, factor: ExactValue | null) {
  const f = factor && !(X.isRational(factor) && factor.n === factor.d && factor.s > 0n) ? factor : null;
  const p = f ? pass : 0;
  if (p === current.pass && ((f == null && current.factor == null) || (f && current.factor && X.equals(f, current.factor)))) return;
  current = { pass: p, factor: f };
  try { eventBus.emit('display:transposition', current); } catch {}
}

export function clearDisplayTransposition() { setDisplayTransposition(0, null); }

/** A written frequency (exact) as the current pass shows it. */
export function shownFrequency<T extends ExactValue | null | undefined>(exact: T): ExactValue | T {
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
export function passTransposition(ratio: ExactValue | null, pass: number, fold: boolean): ExactValue {
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

/** The ratios a repeat may have: between 1/16 and 16, as the ratio editors allow. */
export const REPEAT_MIN = 1 / 16, REPEAT_MAX = 16;

/** Set (or, with null or '', remove) the module's repeat; emits `module:repeatChanged`. */
export function setModuleRepeat(module: Module | null, expr: string | null) {
  if (!module || !module.baseNote) return false;
  const text = expr == null ? '' : String(expr).trim();
  module.baseNote.setVariable('repeat', text || null);
  try { eventBus.emit('module:repeatChanged', { repeat: text || null }); } catch {}
  return true;
}

/** The repeat written as a plain ratio: `n/d` (or none, for 1/1). */
export function repeatExprForRatio(n: number, d: number) {
  return n === d ? null : `${n}/${d}`;
}

/**
 * The module's own repeat ratio: its BaseNote's `repeat` expression evaluated in
 * the module; exact (rational, or irrational for a tempered repeat). null when
 * the module sets none, or when it does not evaluate to a ratio between 1/16 and 16.
 */
export function moduleRepeatRatio(module: Module | null): ExactValue | null {
  const src = module && module.baseNote && module.baseNote.properties && module.baseNote.properties.repeat;
  if (!module || !src || typeof src !== 'string') return null;
  try {
    const binary = compiler.compile(src);
    const cache = module.getEvaluationCache();
    const ev = new BinaryEvaluator(module);
    const r = ev.evaluate(binary, cache);
    const ratio = ev._lastExact || (r && typeof r.n === 'bigint' ? new Fraction(r.s * r.n, r.d) : null);
    if (!ratio) return null;
    const x = X.toNumber(ratio, NaN);
    if (!(x >= REPEAT_MIN && x <= REPEAT_MAX)) {
      console.warn(`[RMT] repeat ${src} is ${x}: a repeat is a ratio between 1/16 and 16 (for example 9/8)`);
      return null;
    }
    return ratio;
  } catch (e) {
    console.warn('[RMT] repeat: could not evaluate', src, e instanceof Error ? e.message : e);
    return null;
  }
}
