/**
 * Write an exact value as an expression relative to another note.
 *
 * Evaluate to BaseNote and re-anchoring a moved note rewrite an expression from
 * its evaluated value. They read the exact value (src/value/exact.js), so a
 * tempered pitch is written as the power it is (`base.f * 2^(7/12)`), never as a
 * float-derived fraction. An approximate value is written with `~` (`~(26163/100)`),
 * so it never passes as exact.
 */
import Fraction from 'fraction.js';
import * as X from '../value/exact.ts';
import type { ExactValue } from '../value/exact.ts';

const ZERO = new Fraction(0);
const ONE = new Fraction(1);

const literal = (f: Fraction) => {
  const n = f.s * f.n;
  return f.d === 1n ? `${n}` : `(${n}/${f.d})`;
};

/** A value as a factor in a product: `3`, `(3/2)`, `2^(7/12)`, `(1 + 2^(1/2))`, `~(26163/100)`; null for no value. */
export function valueFactor(v: ExactValue | null | undefined) {
  if (v == null) return null;
  if (X.isApprox(v)) return '~' + literal(v.frac);
  if (X.isRational(v)) {
    const t = literal(v);
    return t.startsWith('-') ? `(${t})` : t;
  }
  const t = X.toText(v);
  return (v.terms.length > 1 || t.startsWith('-')) ? `(${t})` : t;
}

/** `ref * k` (or `ref` when k is 1). */
function scaled(ref: string, k: ExactValue) {
  if (X.isRational(k) && k.equals(1)) return ref;
  const f = valueFactor(k);
  return f === null ? null : `${ref} * ${f}`;
}

/**
 * A span of time in time units: `base.d * k`. With no usable time unit (base.d
 * not positive) the span is written as a constant, so the value never changes.
 */
export function timeUnitsExpr(span: ExactValue, unit: ExactValue | null | undefined) {
  if (unit == null || X.compare(unit, ZERO) <= 0) return valueFactor(span);
  return scaled('base.d', X.div(span, unit));
}

/** A start relative to the BaseNote's: `base.t`, `base.t + base.d * k`, `base.t - base.d * k`. */
export function startTimeExpr(t: ExactValue, baseT: ExactValue, unit: ExactValue | null | undefined) {
  const offset = X.sub(t, baseT);
  const c = X.compare(offset, ZERO);
  if (c === 0) return 'base.t';
  const span = timeUnitsExpr(c > 0 ? offset : X.neg(offset), unit);
  if (span === null) return null;
  return c > 0 ? `base.t + ${span}` : `base.t - ${span}`;
}

/** A frequency relative to the BaseNote's: `base.f * 2^(7/12)`; null when the BaseNote's is 0. */
export function frequencyExpr(f: ExactValue, baseF: ExactValue) {
  if (X.isZero(baseF)) return null;
  return scaled('base.f', X.div(f, baseF));
}

/** An amplitude relative to the BaseNote's; a constant when the BaseNote's is 0. */
export function amplitudeExpr(a: ExactValue, baseA: ExactValue) {
  if (X.isZero(baseA)) return valueFactor(a);
  return scaled('base.a', X.div(a, baseA));
}

/** `k * ref` for re-anchoring a frequency on another note (`ref` alone when k is 1); null when the anchor's is 0. */
export function ratioToAnchorExpr(value: ExactValue, anchorValue: ExactValue, ref: string) {
  if (X.isZero(anchorValue)) return null;
  const k = X.div(value, anchorValue);
  if (X.isRational(k) && k.equals(ONE)) return ref;
  const f = valueFactor(k);
  return f === null ? null : `${f} * ${ref}`;
}
