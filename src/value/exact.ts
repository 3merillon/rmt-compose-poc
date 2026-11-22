/**
 * Exact values: rational, irrational, approximate.
 *
 * The evaluator computes with three kinds of value (design: design/phase-c-values.md):
 *
 *  - rational      a Fraction (fraction.js, BigInt-backed). The common case and the
 *                  fast path: a rational value is never wrapped.
 *  - irrational    an exact algebraic value, a sum of terms
 *                      Σ c_k × Π b_i ^ e_i      coefficients and exponents rational
 *                  A base is a positive integer or an exact positive sum.
 *                  Like bases merge, integer powers of integer bases move into the
 *                  coefficient, and integer bases are factored (trial division up to
 *                  FACTOR_LIMIT; a cofactor beyond it stays as one opaque base),
 *                  terms with the same radical part add up.
 *  - approximate   a Fraction standing for a measured or rounded number. Anything
 *                  computed from it is approximate, and it never equals an exact value.
 *
 * Closed exactly: + − × of anything exact, ÷ by a single term, a rational power of a
 * single term, and rational powers of sums with certified sign within the size limits.
 * Approximate: an irrational exponent, more than MAX_TERMS terms, the BigInt caps of exact powers,
 * an even root of a negative number.
 *
 * Numbers leave this module only through toNumber() (drawing, sound, MIDI) and
 * shadow() (the nearest double, as a Fraction, for code that still reads Fractions).
 */
import Fraction from 'fraction.js';
import { toNumber as fracToNumber } from '../utils/fraction-num.ts';

/** Rationals are bare fraction.js objects and have no runtime discriminator. */
export type Rational = Fraction & { readonly kind?: undefined };
export type ExactValue = Rational | Irrational | Approx;
type Algebraic = Rational | Irrational;
type MaybeValue = ExactValue | null | undefined;
type RadicalBase = bigint | Irrational;
type Radical = [RadicalBase, Fraction];
interface Term {
  c: Fraction;
  rad: Radical[];
  key: string;
}

export const MAX_TERMS = 64;
export const MAX_INT_POW = 8;
const FACTOR_LIMIT = 65536n;
const MAX_POW_EXPONENT = 65536n;
const MAX_POW_RESULT_BITS = 1048576n;
const MAX_PERIOD_DEPTH = 32;
const MAX_PERIOD_TEXT = 16384;

const ONE = new Fraction(1);
const ZERO = new Fraction(0);

/** Rational coefficient times sorted radical factors. Integer bases have exponents in (0, 1). */
function makeTerm(c: Fraction, rad: Radical[]): Term {
  return { c, rad, key: radKey(rad) };
}
function radKey(rad: Radical[]): string {
  let k = '';
  for (const [b, e] of rad) k += (k ? '*' : '') + baseText(b) + '^' + (e.s * e.n) + '/' + e.d;
  return k;
}

function baseText(b: RadicalBase): string {
  if (typeof b === 'bigint') return String(b);
  let text = sumLabels.get(b);
  if (text === undefined) {
    text = '(' + toText(b) + ')';
    sumLabels.set(b, text);
  }
  return text;
}

const sumLabels = new WeakMap<Irrational, string>();
const periodDepths = new WeakMap<Irrational, number>();

export function radicalText([b, e]: Radical): string {
  return `${baseText(b)}^(${e.s * e.n}/${e.d})`;
}

export class Irrational {
  /** @param {Array} terms canonical terms, at least one with a non-empty radical */
  declare readonly kind: 'irrational';
  declare terms: Term[];
  // Multiplicative form before expanding whole periods. Preserving it lets
  // later steps undo several complete periods without having to factor a sum.
  declare product?: Term;
  constructor(terms: Term[]) {
    this.kind = 'irrational';
    this.terms = terms;
  }
}

export class Approx {
  /** @param {Fraction} frac the best known value */
  declare readonly kind: 'approx';
  declare frac: Fraction;
  constructor(frac: Fraction) {
    this.kind = 'approx';
    this.frac = frac;
  }
}

export const isRational = (v: MaybeValue): v is Rational => v != null && v.kind === undefined;
export const isIrrational = (v: MaybeValue): v is Irrational => v != null && v.kind === 'irrational';
export const isApprox = (v: MaybeValue): v is Approx => v != null && v.kind === 'approx';

/** 'rational' | 'irrational' | 'approximate' */
export function kindOf(v: MaybeValue) {
  if (v == null) return null;
  return v.kind === undefined ? 'rational' : v.kind === 'approx' ? 'approximate' : 'irrational';
}

// ---------------------------------------------------------------------------
// BigInt helpers
// ---------------------------------------------------------------------------

function cappedPow(base: bigint, exp: bigint) {
  if (exp === 0n) return 1n;
  if (exp > MAX_POW_EXPONENT) return null;
  const mag = base < 0n ? -base : base;
  if (mag > 1n && BigInt(mag.toString(2).length) * exp > MAX_POW_RESULT_BITS) return null;
  return base ** exp;
}

/** floor(value ^ (1/n)) for value ≥ 0, n ≥ 1 */
function floorNthRoot(value: bigint, n: bigint) {
  if (value < 2n || n === 1n) return value;
  const bitLen = BigInt(value.toString(2).length);
  if (n >= bitLen) return 1n;
  let lo = 0n;
  let hi = 1n << (bitLen / n + 1n);
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid ** n <= value) lo = mid; else hi = mid - 1n;
  }
  return lo;
}

function exactNthRoot(value: bigint, n: bigint) {
  const r = floorNthRoot(value, n);
  return r ** n === value ? r : null;
}

/** Prime factors of a positive BigInt by trial division up to FACTOR_LIMIT; the rest as one cofactor. */
function factor(n: bigint, into: Map<bigint, bigint>, sign: bigint): void {
  // into: Map<bigint, bigint> base → exponent (times sign)
  const add = (p: bigint, k: bigint) => into.set(p, (into.get(p) || 0n) + sign * k);
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
function normalizeTerm(c: Fraction, factors: Iterable<Radical>): Term | null {
  let num = c.s * c.n, den = c.d;
  const rad: Radical[] = [];
  // Independently evaluated sums from different notes have different object identities.
  const bases = new Map<bigint | string, Radical>();
  for (const [b, e] of factors) {
    const key = typeof b === 'bigint' ? b : baseText(b);
    const previous = bases.get(key);
    bases.set(key, [b, previous ? previous[1].add(e) : e]);
  }
  for (const [b, e] of bases.values()) {
    if (e.n === 0n) continue;
    if (typeof b !== 'bigint') {
      rad.push([b, e]);
      continue;
    }
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
  rad.sort(([a], [b]) => {
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'bigint') return -1;
    if (typeof b === 'bigint') return 1;
    const x = baseText(a), y = baseText(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return makeTerm(new Fraction(num, den), rad);
}

/** Terms → canonical value: a Fraction when no radical is left, else Irrational; null past MAX_TERMS. */
// Combining a singleton can never exceed MAX_TERMS.
function fromTerms(list: [Term]): Algebraic;
function fromTerms(list: Term[]): Algebraic | null;
function fromTerms(list: Term[]): Algebraic | null {
  const byKey = new Map<string, Term>();
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
function makeTermKeyed(c: Fraction, rad: Radical[], key: string): Term { return { c, rad, key }; }

const termsOf = (v: Algebraic): Term[] => (isIrrational(v) ? v.terms : (v.n === 0n ? [] : [makeTerm(v, [])]));

// Factor a rational scale out of a sum. This makes an anchored period (e.g.
// 440 + 440√2) match the same period written as a ratio (1 + √2).
function splitSum(v: Irrational): [Fraction, Irrational] {
  const c = v.terms[0].c.abs();
  return [c, c.equals(1) ? v : new Irrational(v.terms.map(t => makeTermKeyed(t.c.div(c), t.rad, t.key)))];
}

function multiplicands(v: Algebraic, other: Algebraic): Term[] {
  if (isIrrational(v) && v.product) return [v.product];
  if (isIrrational(v) && v.terms.length > 1 && isIrrational(other)) {
    const factors = (other.product ? [other.product] : other.terms).flatMap(t => t.rad).filter(([b]) => typeof b !== 'bigint');
    if (factors.length) {
      const [c, period] = splitSum(v);
      for (const [b] of factors) {
        if (typeof b === 'bigint') continue;
        if (equals(b, period)) return [makeTerm(c, [[b, ONE]])];
        if (b.terms[0].c.s !== period.terms[0].c.s && equals(b, neg(period)))
          return [makeTerm(c.neg(), [[b, ONE]])];
      }
    }
  }
  return termsOf(v);
}

// Return a whole period to the ordinary sum representation on landing. Keep
// reciprocals and large integer powers factored instead of expanding them.
function expandPeriods(t: Term): ExactValue {
  const whole = t.rad.filter(([b, e]) => typeof b !== 'bigint' && e.d === 1n && e.s > 0n && e.n <= BigInt(MAX_INT_POW));
  if (!whole.length) return fromTerms([t]);
  let out: ExactValue = fromTerms([makeTerm(t.c, t.rad.filter(r => !whole.includes(r)))]);
  for (const [base, e] of whole) {
    if (typeof base !== 'bigint') for (let i = 0n; i < e.n; i++) out = multiply(out, base, false);
  }
  if (isIrrational(out) && out.terms.length > 1) out.product = t;
  return out;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The value as a double: the only way a number leaves this module for drawing and sound. */
export function toNumber(v: MaybeValue, fallback = 0): number {
  if (v == null) return fallback;
  if (v.kind === undefined) return fracToNumber(v, fallback);
  if (v.kind === 'approx') return fracToNumber(v.frac, fallback);
  let sum = 0;
  let magnitude = 0;
  for (const t of v.terms) {
    let x = fracToNumber(t.c, 0);
    for (const [b, e] of t.rad) x *= Math.pow(typeof b === 'bigint' ? Number(b) : toNumber(b, NaN), fracToNumber(e));
    sum += x;
    magnitude += Math.abs(x);
  }
  // A compound period can be a very small positive difference. Recover its
  // scale before using it as the base of a floating-point playback value.
  if (Math.abs(sum) < 1e-8 * magnitude) {
    for (const bits of [64n, 192n, 512n]) {
      const bounds = dyadicBounds(v, bits);
      if (!bounds) break;
      const [lo, hi] = bounds;
      const middle = lo + hi;
      if (((hi - lo) << 54n) <= (middle < 0n ? -middle : middle))
        return fracToNumber(new Fraction(middle, 2n << bits), fallback);
    }
  }
  return Number.isFinite(sum) ? sum : fallback;
}

// A double's exact value as a Fraction (m × 2^e), so toNumber(shadow) gives the double back.
// fraction.js's own conversion is a continued fraction good to about 1e-14 only.
const F64 = new DataView(new ArrayBuffer(8));
function exactDouble(x: number): Fraction {
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

function fractionFromDouble(x: number): Fraction {
  if (Number.isFinite(x)) return exactDouble(x);
  if (Number.isNaN(x)) return new Fraction(0);
  return new Fraction(x > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE);
}

/** A Fraction for code that reads Fractions: the value itself, its approximation, or the nearest double. */
export function shadow(v: ExactValue): Rational;
export function shadow<T extends null | undefined>(v: T): T;
export function shadow(v: MaybeValue): Rational | null | undefined;
export function shadow(v: MaybeValue): Rational | null | undefined {
  if (v == null) return v;
  if (v.kind === undefined) return v;
  if (v.kind === 'approx') return v.frac;
  return fractionFromDouble(toNumber(v, NaN));
}

/** An approximate value from a double (the fallback of every operation this module cannot keep exact). */
export function approxFromNumber(x: number) {
  return new Approx(fractionFromDouble(x));
}

type Bounds = [bigint, bigint];

// Outward bounds in units of 2^-bits. In particular cancellation in a sum
// must not turn a negative radicand into a positive one by floating-point rounding.
function dyadicBounds(v: Algebraic, bits: bigint, cache = new Map<Irrational, Bounds | null>()): Bounds | null {
  const unit = 1n << bits;
  let low = 0n, high = 0n;
  for (const t of termsOf(v)) {
    let lo = unit, hi = unit;
    for (const [b, e] of t.rad) {
      let bounds: Bounds | null;
      if (typeof b === 'bigint') bounds = [b * unit, b * unit];
      else {
        if (!cache.has(b)) cache.set(b, dyadicBounds(b, bits, cache));
        bounds = cache.get(b) ?? null;
      }
      if (!bounds || bounds[0] <= 0n) return null;
      // floor(unit * (x / unit)^(p/q)) by raising to q before taking the integer root.
      const shift = bits * (e.d - e.s * e.n);
      if (bits * e.d > MAX_POW_RESULT_BITS || shift > MAX_POW_RESULT_BITS || -shift > MAX_POW_RESULT_BITS) return null;
      const rootAt = (x: bigint) => {
        const power = cappedPow(x, e.n);
        if (power === null) return null;
        let n = e.s > 0n ? power : 1n, d = e.s > 0n ? 1n : power;
        if (shift >= 0n) n <<= shift; else d <<= -shift;
        return floorNthRoot(n / d, e.d);
      };
      const left = rootAt(bounds[0]), right = bounds[0] === bounds[1] ? left : rootAt(bounds[1]);
      if (left === null || right === null) return null;
      const lower = e.s > 0n ? left : right, upper = (e.s > 0n ? right : left) + 1n;
      lo = lo * lower / unit;
      hi = (hi * upper + unit - 1n) / unit;
    }
    const lower = lo * t.c.n / t.c.d, upper = (hi * t.c.n + t.c.d - 1n) / t.c.d;
    low += t.c.s > 0n ? lower : -upper;
    high += t.c.s > 0n ? upper : -lower;
  }
  return [low, high];
}

function sumSign(v: Irrational): -1 | 0 | 1 {
  if (v.terms.every(t => t.c.s > 0n)) return 1;
  if (v.terms.every(t => t.c.s < 0n)) return -1;
  for (const bits of [64n, 192n, 512n]) {
    const bounds = dyadicBounds(v, bits);
    if (bounds && bounds[0] > 0n) return 1;
    if (bounds && bounds[1] < 0n) return -1;
  }
  return 0; // sign unresolved within the arithmetic budget
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function add(a: ExactValue, b: ExactValue): ExactValue {
  if (a.kind === undefined && b.kind === undefined) return a.add(b);
  if (a.kind === 'approx' || b.kind === 'approx') return new Approx(shadow(a).add(shadow(b)));
  return fromTerms([...termsOf(a), ...termsOf(b)]) ?? new Approx(shadow(a).add(shadow(b)));
}

export function neg(a: ExactValue): ExactValue {
  if (a.kind === undefined) return a.neg();
  if (a.kind === 'approx') return new Approx(a.frac.neg());
  return new Irrational(a.terms.map((t) => makeTermKeyed(t.c.neg(), t.rad, t.key)));
}

export function sub(a: ExactValue, b: ExactValue): ExactValue {
  return add(a, neg(b));
}

export function mul(a: ExactValue, b: ExactValue): ExactValue {
  return multiply(a, b, true);
}

function multiply(a: ExactValue, b: ExactValue, collectPeriods: boolean): ExactValue {
  if (a.kind === undefined && b.kind === undefined) return a.mul(b);
  if (a.kind === 'approx' || b.kind === 'approx') return new Approx(shadow(a).mul(shadow(b)));
  const ta = collectPeriods ? multiplicands(a, b) : termsOf(a);
  const tb = collectPeriods ? multiplicands(b, a) : termsOf(b);
  if (ta.length * tb.length > MAX_TERMS * MAX_TERMS) return new Approx(shadow(a).mul(shadow(b)));
  const out = [];
  for (const x of ta) for (const y of tb) {
    const t = normalizeTerm(x.c.mul(y.c), [...x.rad, ...y.rad]);
    if (t === null) return new Approx(shadow(a).mul(shadow(b)));
    if (t.rad.some(([base]) => typeof base !== 'bigint')) {
      const expanded = expandPeriods(t);
      if (ta.length === 1 && tb.length === 1) return expanded;
      if (isApprox(expanded)) return new Approx(shadow(a).mul(shadow(b)));
      out.push(...termsOf(expanded));
    } else out.push(t);
  }
  return fromTerms(out) ?? new Approx(shadow(a).mul(shadow(b)));
}

/** 1 / (single term): coefficient inverted, exponents negated and renormalized. */
function invertTerm(t: Term) {
  const bases: Radical[] = t.rad.map(([b, e]) => [b, e.neg()]);
  return normalizeTerm(ONE.div(t.c), bases);
}

/** a / b; the caller has ruled out b = 0. */
export function div(a: ExactValue, b: ExactValue): ExactValue {
  if (a.kind === undefined && b.kind === undefined) return a.div(b);
  if (a.kind === 'approx' || b.kind === 'approx') return new Approx(shadow(a).div(shadow(b)));
  const tb = termsOf(b);
  if (isIrrational(b) && tb.length > 1) return mul(a, pow(b, ONE.neg()));
  const inv = invertTerm(tb[0]);
  if (inv === null) return new Approx(shadow(a).div(shadow(b)));
  return mul(a, fromTerms([inv]));
}

export function isZero(v: ExactValue): boolean {
  if (v.kind === undefined) return v.n === 0n;
  if (v.kind === 'approx') return v.frac.n === 0n;
  return false; // like terms that cancel are already reduced to rational zero
}

/** A rational number to a rational power: Fraction, Irrational, or Approx. */
function rationalPow(base: Fraction, e: Fraction): ExactValue {
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
  const exps = new Map<bigint, bigint>();
  factor(base.n, exps, 1n);
  factor(base.d, exps, -1n);
  const bases = new Map<bigint, Fraction>();
  for (const [p, m] of exps) if (m !== 0n) bases.set(p, new Fraction(m).mul(e));
  const t = normalizeTerm(new Fraction(sign), bases);
  if (t === null) return approxFromNumber(Math.pow(fracToNumber(base), Number(en) / Number(e.d)));
  return fromTerms([t]);
}

/** a ^ e */
export function pow(a: ExactValue, e: ExactValue): ExactValue {
  if (e.kind === 'irrational' || e.kind === 'approx' || a.kind === 'approx') {
    return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
  }
  if (a.kind === undefined) return rationalPow(a, e);
  const ta = a.product ? [a.product] : a.terms;
  if (ta.length === 1) {
    const t = ta[0];
    const out = rationalPow(t.c, e);
    if (out.kind === 'approx') return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
    const bases: Radical[] = t.rad.map(([b, x]) => [b, x.mul(e)]);
    const r = normalizeTerm(ONE, bases);
    if (r === null) return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
    return mul(out, expandPeriods(r));
  }
  // Expand small whole powers as before. Other real powers retain the sum
  // as their base so that steps can add exponents across note references.
  const en = e.s * e.n;
  if (e.d === 1n && en >= 0n && en <= BigInt(MAX_INT_POW)) {
    let out: ExactValue = ONE;
    for (let i = 0n; i < en; i++) out = mul(out, a);
    return out;
  }
  const sign = sumSign(a);
  if (sign === 0 || (sign < 0 && e.d % 2n === 0n))
    return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
  const positive = sign > 0 ? a : new Irrational(a.terms.map(t => makeTermKeyed(t.c.neg(), t.rad, t.key)));
  const [scale, period] = splitSum(positive);
  let depth = 1;
  for (const t of period.terms) for (const [b] of t.rad) {
    if (typeof b !== 'bigint') depth = Math.max(depth, 1 + (periodDepths.get(b) ?? 0));
  }
  if (depth > MAX_PERIOD_DEPTH || baseText(period).length > MAX_PERIOD_TEXT)
    return approxFromNumber(Math.pow(toNumber(a, NaN), toNumber(e, NaN)));
  periodDepths.set(period, depth);
  const coefficient = rationalPow(scale, e);
  const factor = fromTerms([makeTerm(sign < 0 && e.n % 2n ? ONE.neg() : ONE, [[period, e]])]);
  return mul(coefficient, factor);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Exact equality. An approximate value never equals an exact one. */
export function equals(a: MaybeValue, b: MaybeValue): boolean {
  if (a == null || b == null) return a === b;
  if (a.kind === undefined && b.kind === undefined) return a.equals(b);
  if (a.kind === 'approx' || b.kind === 'approx') {
    return a.kind === 'approx' && b.kind === 'approx' && a.frac.equals(b.frac);
  }
  if (a.kind !== 'irrational' || b.kind !== 'irrational' || a.terms.length !== b.terms.length) return false;
  for (let i = 0; i < a.terms.length; i++) {
    if (a.terms[i].key !== b.terms[i].key || !a.terms[i].c.equals(b.terms[i].c)) return false;
  }
  return true;
}

/** -1, 0, 1. Close exact values are compared by bounding their difference. */
export function compare(a: ExactValue, b: ExactValue): number {
  if (a.kind === undefined && b.kind === undefined) return a.compare(b);
  if (equals(a, b)) return 0;
  const x = toNumber(a, NaN), y = toNumber(b, NaN);
  const scale = Math.max(Math.abs(x), Math.abs(y), 1e-300);
  if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) > 1e-12 * scale) return x < y ? -1 : 1;
  if (a.kind === 'approx' || b.kind === 'approx') {
    const c = shadow(a).compare(shadow(b));
    return c < 0 ? -1 : c > 0 ? 1 : 0;
  }
  const diff = sub(a, b);
  if (isIrrational(diff)) return sumSign(diff);
  if (isRational(diff)) return diff.compare(0);
  return shadow(a).compare(shadow(b));
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const fracText = (f: Fraction) => (f.d === 1n ? `${f.s * f.n}` : `(${f.s * f.n}/${f.d})`);

/** The value in DSL notation: `263 * 2^(7/12)`, `~(26163/100)`. */
export function toText(v: MaybeValue): string {
  if (v == null) return '';
  if (v.kind === undefined) return fracText(v);
  if (v.kind === 'approx') return '~' + fracText(v.frac);
  return v.terms.map((t, i) => {
    const parts = [];
    const c = t.c;
    const neg = c.s < 0n;
    const mag = neg ? c.neg() : c;
    if (!mag.equals(1) || t.rad.length === 0) parts.push(fracText(mag));
    for (const radical of t.rad) parts.push(radicalText(radical));
    const body = parts.join(' * ');
    if (i === 0) return (neg ? '-' : '') + body;
    return (neg ? ' - ' : ' + ') + body;
  }).join('');
}
