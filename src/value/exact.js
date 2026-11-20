/**
 * Exact values: rational, irrational, approximate.
 *
 * The evaluator computes with three kinds of value (design: design/phase-c-values.md):
 *
 *  - rational      a Fraction (fraction.js, BigInt-backed). The common case and the
 *                  fast path: a rational value is never wrapped.
 *  - irrational    an exact algebraic value, a sum of terms
 *                      Σ c_k × Π b_i ^ e_i      c_k rational, b_i integers > 1, 0 < e_i < 1
 *                  kept canonical, so equal values are equal structurally:
 *                  like bases merge, the integer part of an exponent moves into the
 *                  coefficient, bases are factored into primes (trial division up to
 *                  FACTOR_LIMIT; a cofactor beyond it stays as one opaque base),
 *                  terms with the same radical part add up.
 *  - approximate   a Fraction standing for a measured or rounded number. Anything
 *                  computed from it is approximate, and it never equals an exact value.
 *
 * Closed exactly: + − × of anything exact, ÷ by a single term, a rational power of a
 * single term, an integer power (|n| ≤ MAX_INT_POW) of a sum. Not closed, and then
 * approximate: ÷ by a sum of several terms, a non-integer power of a sum, an
 * irrational exponent, more than MAX_TERMS terms, the BigInt caps of exact powers,
 * an even root of a negative number.
 *
 * Numbers leave this module only through toNumber() (drawing, sound, MIDI) and
 * shadow() (the nearest double, as a Fraction, for code that still reads Fractions).
 */
import Fraction from 'fraction.js';
import { toNumber as fracToNumber } from '../utils/fraction-num.js';

export const MAX_TERMS = 64;
export const MAX_INT_POW = 8;
const FACTOR_LIMIT = 65536n;
const MAX_POW_EXPONENT = 65536n;
const MAX_POW_RESULT_BITS = 1048576n;

const ONE = new Fraction(1);
const ZERO = new Fraction(0);

/** A term: coefficient c (Fraction, ≠ 0) × Π rad[i][0] ^ rad[i][1]; rad sorted by base, exps in (0, 1). */
function makeTerm(c, rad) {
  return { c, rad, key: radKey(rad) };
}
function radKey(rad) {
  let k = '';
  for (const [b, e] of rad) k += (k ? '*' : '') + b + '^' + (e.s * e.n) + '/' + e.d;
  return k;
}

export class Irrational {
  /** @param {Array} terms canonical terms, at least one with a non-empty radical */
  constructor(terms) {
    this.kind = 'irrational';
    this.terms = terms;
  }
}

/**
 * An irrational value from terms that are canonical already, in canonical
 * order: what the Rust core computed (rust/src/exact.rs, the twin of this
 * module). Nothing is checked or reordered; each term gets its key.
 * @param {Array<[Fraction, Array<[bigint, Fraction]>]>} list coefficient, radical part
 * @returns {Irrational}
 */
export function irrationalFromCanonicalTerms(list) {
  return new Irrational(list.map(([c, rad]) => makeTerm(c, rad)));
}

export class Approx {
  /** @param {Fraction} frac the best known value */
  constructor(frac) {
    this.kind = 'approx';
    this.frac = frac;
  }
}

export const isRational = (v) => v != null && v.kind === undefined;
export const isIrrational = (v) => v != null && v.kind === 'irrational';
export const isApprox = (v) => v != null && v.kind === 'approx';

/** 'rational' | 'irrational' | 'approximate' */
export function kindOf(v) {
  if (v == null) return null;
  return v.kind === undefined ? 'rational' : v.kind === 'approx' ? 'approximate' : 'irrational';
}

// ---------------------------------------------------------------------------
// BigInt helpers
// ---------------------------------------------------------------------------

function cappedPow(base, exp) {
  if (exp === 0n) return 1n;
  if (exp > MAX_POW_EXPONENT) return null;
  const mag = base < 0n ? -base : base;
  if (mag > 1n && BigInt(mag.toString(2).length) * exp > MAX_POW_RESULT_BITS) return null;
  return base ** exp;
}

/** floor(value ^ (1/n)) for value ≥ 0, n ≥ 1 */
function floorNthRoot(value, n) {
  if (value < 2n || n === 1n) return value;
  const bitLen = BigInt(value.toString(2).length);
  let lo = 0n;
  let hi = 1n << (bitLen / n + 1n);
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid ** n <= value) lo = mid; else hi = mid - 1n;
  }
  return lo;
}

function exactNthRoot(value, n) {
  const r = floorNthRoot(value, n);
  return r ** n === value ? r : null;
}

/** Prime factors of a positive BigInt by trial division up to FACTOR_LIMIT; the rest as one cofactor. */
function factor(n, into, sign) {
  // into: Map<bigint, bigint> base → exponent (times sign)
  const add = (p, k) => into.set(p, (into.get(p) || 0n) + sign * k);
  if (n <= 1n) return;
  let k = 0n;
  while ((n & 1n) === 0n) { n >>= 1n; k++; }
  if (k) add(2n, k);
  for (let p = 3n; p <= FACTOR_LIMIT && p * p <= n; p += 2n) {
    if (n % p !== 0n) continue;
    k = 0n;
    while (n % p === 0n) { n /= p; k++; }
    add(p, k);
  }
  if (n > 1n) add(n, 1n);
}

// ---------------------------------------------------------------------------
// Canonical construction
// ---------------------------------------------------------------------------

/**
 * Normalize a coefficient times a map of base → rational exponent into a term:
 * integer parts of exponents move into the coefficient. Returns null when a
 * capped power would be exceeded.
 */
function normalizeTerm(c, bases) {
  let num = c.s * c.n, den = c.d;
  const rad = [];
  for (const [b, e] of bases) {
    if (e.n === 0n) continue;
    // e = q + r, 0 ≤ r < 1
    const en = e.s * e.n;
    let q = en / e.d;
    if (en < 0n && q * e.d !== en) q -= 1n; // floor
    const r = e.sub(new Fraction(q));
    if (q !== 0n) {
      const p = cappedPow(b, q < 0n ? -q : q);
      if (p === null) return null;
      if (q > 0n) num *= p; else den *= p;
    }
    if (r.n !== 0n) rad.push([b, r]);
  }
  rad.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return makeTerm(new Fraction(num, den), rad);
}

/** Terms → canonical value: a Fraction when no radical is left, else Irrational; null past MAX_TERMS. */
function fromTerms(list) {
  const byKey = new Map();
  for (const t of list) {
    const prev = byKey.get(t.key);
    if (prev) byKey.set(t.key, makeTermKeyed(prev.c.add(t.c), prev.rad, t.key));
    else byKey.set(t.key, t);
  }
  const terms = [...byKey.values()].filter((t) => t.c.n !== 0n);
  if (terms.length === 0) return ZERO;
  if (terms.length === 1 && terms[0].key === '') return terms[0].c;
  if (terms.length > MAX_TERMS) return null;
  terms.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return new Irrational(terms);
}
function makeTermKeyed(c, rad, key) { return { c, rad, key }; }

const termsOf = (v) => (isIrrational(v) ? v.terms : (v.n === 0n ? [] : [makeTerm(v, [])]));

function mulTerms(a, b) {
  const bases = new Map();
  for (const [base, e] of a.rad) bases.set(base, e);
  for (const [base, e] of b.rad) bases.set(base, bases.has(base) ? bases.get(base).add(e) : e);
  return normalizeTerm(a.c.mul(b.c), bases);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The value as a double: the only way a number leaves this module for drawing and sound. */
export function toNumber(v, fallback = 0) {
  if (v == null) return fallback;
  if (v.kind === undefined) return fracToNumber(v, fallback);
  if (v.kind === 'approx') return fracToNumber(v.frac, fallback);
  let sum = 0;
  for (const t of v.terms) {
    let x = fracToNumber(t.c, 0);
    for (const [b, e] of t.rad) x *= Math.pow(Number(b), Number(e.s * e.n) / Number(e.d));
    sum += x;
  }
  return Number.isFinite(sum) ? sum : fallback;
}

// A double's exact value as a Fraction (m × 2^e), so toNumber(shadow) gives the double back.
// fraction.js's own conversion is a continued fraction good to about 1e-14 only.
const F64 = new DataView(new ArrayBuffer(8));
function exactDouble(x) {
  if (x === 0) return new Fraction(0);
  F64.setFloat64(0, x);
  const hi = F64.getUint32(0), lo = F64.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (expBits === 0) e = -1074; else { mant |= 1n << 52n; e = expBits - 1075; }
  return e >= 0 ? new Fraction(sign * (mant << BigInt(e))) : new Fraction(sign * mant, 1n << BigInt(-e));
}

function fractionFromDouble(x) {
  if (Number.isFinite(x)) return exactDouble(x);
  if (Number.isNaN(x)) return new Fraction(0);
  return new Fraction(x > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE);
}

/** A Fraction for code that reads Fractions: the value itself, its approximation, or the nearest double. */
export function shadow(v) {
  if (v == null) return v;
  if (v.kind === undefined) return v;
  if (v.kind === 'approx') return v.frac;
  return fractionFromDouble(toNumber(v, NaN));
}

/** An approximate value from a double (the fallback of every operation this module cannot keep exact). */
export function approxFromNumber(x) {
  return new Approx(fractionFromDouble(x));
}
const approxOf = (v) => (v.kind === 'approx' ? v : new Approx(shadow(v)));

/** value × 2^scale as a BigInt, floor, error a few units (for ordering only). */
function fixedPoint(v, scale) {
  let sum = 0n;
  const S = BigInt(scale);
  for (const t of termsOf(v)) {
    let acc = 1n << S;
    for (const [b, e] of t.rad) {
      const p = e.s * e.n, q = e.d; // 0 < p/q < 1
      const root = floorNthRoot((b ** p) << (S * q), q); // floor(b^(p/q) × 2^S)
      acc = (acc * root) >> S;
    }
    sum += (t.c.s * t.c.n * acc) / t.c.d;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function add(a, b) {
  if (a.kind === undefined && b.kind === undefined) return a.add(b);
  if (a.kind === 'approx' || b.kind === 'approx') return new Approx(shadow(a).add(shadow(b)));
  return fromTerms([...termsOf(a), ...termsOf(b)]) ?? new Approx(shadow(a).add(shadow(b)));
}

export function neg(a) {
  if (a.kind === undefined) return a.neg();
  if (a.kind === 'approx') return new Approx(a.frac.neg());
  return new Irrational(a.terms.map((t) => makeTermKeyed(t.c.neg(), t.rad, t.key)));
}

export function sub(a, b) {
  return add(a, neg(b));
}

export function mul(a, b) {
  if (a.kind === undefined && b.kind === undefined) return a.mul(b);
  if (a.kind === 'approx' || b.kind === 'approx') return new Approx(shadow(a).mul(shadow(b)));
  const ta = termsOf(a), tb = termsOf(b);
  if (ta.length * tb.length > MAX_TERMS * MAX_TERMS) return new Approx(shadow(a).mul(shadow(b)));
  const out = [];
  for (const x of ta) for (const y of tb) {
    const t = mulTerms(x, y);
    if (t === null) return new Approx(shadow(a).mul(shadow(b)));
    out.push(t);
  }
  return fromTerms(out) ?? new Approx(shadow(a).mul(shadow(b)));
}

/** 1 / (single term): coefficient inverted, exponents negated and renormalized. */
function invertTerm(t) {
  const bases = new Map();
  for (const [b, e] of t.rad) bases.set(b, e.neg());
  return normalizeTerm(ONE.div(t.c), bases);
}

/** a / b; the caller has ruled out b = 0. */
export function div(a, b) {
  if (a.kind === undefined && b.kind === undefined) return a.div(b);
  if (a.kind === 'approx' || b.kind === 'approx') return new Approx(shadow(a).div(shadow(b)));
  const tb = termsOf(b);
  if (tb.length !== 1) return new Approx(shadow(a).div(shadow(b))); // ÷ by a sum: not closed
  const inv = invertTerm(tb[0]);
  if (inv === null) return new Approx(shadow(a).div(shadow(b)));
  return mul(a, fromTerms([inv]));
}

export function isZero(v) {
  if (v.kind === undefined) return v.n === 0n;
  if (v.kind === 'approx') return v.frac.n === 0n;
  return false; // a canonical irrational value is never zero
}

/** A rational number to a rational power: Fraction, Irrational, or Approx. */
function rationalPow(base, e) {
  const en = e.s * e.n;
  if (en === 0n) return ONE;
  if (base.n === 0n) {
    if (en > 0n) return ZERO;
    return approxFromNumber(Math.pow(0, Number(en) / Number(e.d))); // 0^negative: no value
  }
  // Integer exponent: rational
  if (e.d === 1n) {
    const k = en < 0n ? -en : en;
    const n = cappedPow(base.s * base.n, k), d = cappedPow(base.d, k);
    if (n === null || d === null) return approxFromNumber(Math.pow(fracToNumber(base), Number(en)));
    return en > 0n ? new Fraction(n, d) : new Fraction(d, n);
  }
  // Sign: an odd root keeps it, an even root of a negative is not real
  let sign = 1n;
  if (base.s < 0n) {
    if ((e.d & 1n) === 0n) return approxFromNumber(NaN);
    if ((en & 1n) !== 0n) sign = -1n;
  }
  // Perfect root first (keeps the result rational without factoring)
  const k = en < 0n ? -en : en;
  const pn = cappedPow(base.n, k), pd = cappedPow(base.d, k);
  if (pn !== null && pd !== null) {
    const rn = exactNthRoot(pn, e.d), rd = exactNthRoot(pd, e.d);
    if (rn !== null && rd !== null) return en > 0n ? new Fraction(sign * rn, rd) : new Fraction(sign * rd, rn);
  }
  // Factor |base| and raise each prime
  const exps = new Map();
  factor(base.n, exps, 1n);
  factor(base.d, exps, -1n);
  const bases = new Map();
  for (const [p, m] of exps) if (m !== 0n) bases.set(p, new Fraction(m).mul(e));
  const t = normalizeTerm(new Fraction(sign), bases);
  if (t === null) return approxFromNumber(Math.pow(fracToNumber(base), Number(en) / Number(e.d)));
  return fromTerms([t]);
}

/** a ^ e */
export function pow(a, e) {
  if (e.kind === 'irrational' || e.kind === 'approx' || a.kind === 'approx') {
    return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
  }
  if (a.kind === undefined) return rationalPow(a, e);
  const ta = a.terms;
  if (ta.length === 1) {
    const t = ta[0];
    let out = rationalPow(t.c, e);
    if (out.kind === 'approx') return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
    const bases = new Map();
    for (const [b, x] of t.rad) bases.set(b, x.mul(e));
    const r = normalizeTerm(ONE, bases);
    if (r === null) return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
    return mul(out, fromTerms([r]));
  }
  // A sum: only small non-negative integer powers stay exact
  const en = e.s * e.n;
  if (e.d === 1n && en >= 0n && en <= BigInt(MAX_INT_POW)) {
    let out = ONE;
    for (let i = 0n; i < en; i++) out = mul(out, a);
    return out;
  }
  return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Exact equality. An approximate value never equals an exact one. */
export function equals(a, b) {
  if (a == null || b == null) return a === b;
  if (a.kind === undefined && b.kind === undefined) return a.equals(b);
  if (a.kind === 'approx' || b.kind === 'approx') {
    return a.kind === 'approx' && b.kind === 'approx' && a.frac.equals(b.frac);
  }
  if (a.kind !== b.kind || a.terms.length !== b.terms.length) return false;
  for (let i = 0; i < a.terms.length; i++) {
    if (a.terms[i].key !== b.terms[i].key || !a.terms[i].c.equals(b.terms[i].c)) return false;
  }
  return true;
}

/** -1, 0, 1. Exact for rational and irrational values (refined at 192 bits when doubles are too close). */
export function compare(a, b) {
  if (a.kind === undefined && b.kind === undefined) return a.compare(b);
  if (equals(a, b)) return 0;
  const x = toNumber(a, NaN), y = toNumber(b, NaN);
  const scale = Math.max(Math.abs(x), Math.abs(y), 1e-300);
  if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) > 1e-12 * scale) return x < y ? -1 : 1;
  if (a.kind === 'approx' || b.kind === 'approx') {
    const c = shadow(a).compare(shadow(b));
    return c < 0 ? -1 : c > 0 ? 1 : 0;
  }
  const d = fixedPoint(a, 192) - fixedPoint(b, 192);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const fracText = (f) => (f.d === 1n ? `${f.s * f.n}` : `(${f.s * f.n}/${f.d})`);

/** The value in DSL notation: `263 * 2^(7/12)`, `~(26163/100)`. */
export function toText(v) {
  if (v == null) return '';
  if (v.kind === undefined) return fracText(v);
  if (v.kind === 'approx') return '~' + fracText(v.frac);
  return v.terms.map((t, i) => {
    const parts = [];
    const c = t.c;
    const neg = c.s < 0n;
    const mag = neg ? c.neg() : c;
    if (!mag.equals(1) || t.rad.length === 0) parts.push(fracText(mag));
    for (const [b, e] of t.rad) parts.push(`${b}^(${e.s * e.n}/${e.d})`);
    const body = parts.join(' * ');
    if (i === 0) return (neg ? '-' : '') + body;
    return (neg ? ' - ' : ' + ') + body;
  }).join('');
}
