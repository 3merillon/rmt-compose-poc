//! Exact values: rational, irrational, approximate.
//!
//! The twin of src/value/exact.js, operation by operation, so that both
//! engines compute the same value, in the same canonical form, for every
//! expression (design: design/phase-c-values.md):
//!
//!  - rational      a `Q`, the common case and the fast path
//!  - irrational    an exact algebraic value, a sum of terms
//!                      Σ c_k × Π b_i ^ e_i      c_k rational, b_i integers > 1, 0 < e_i < 1
//!                  kept canonical: like bases merge, the integer part of an
//!                  exponent moves into the coefficient, bases are factored
//!                  into primes (trial division up to FACTOR_LIMIT; a cofactor
//!                  beyond it stays one opaque base), terms with the same
//!                  radical part add up, terms are sorted by the text of their
//!                  radical part as exact.js sorts its keys
//!  - approximate   a `Q` standing for a measured or rounded number
//!
//! Doubles enter only where exact.js uses them: `to_number` (the shadow of an
//! irrational, the operands of a fallback), and `Math.pow`, which is
//! JavaScript's own in WebAssembly so the doubles are the same to the last bit.

use crate::rational::{big_uint_to_f64, Q};
use num_bigint::{BigInt, BigUint, Sign};
use num_integer::Integer;
use num_traits::{One, Signed, ToPrimitive, Zero};
use std::collections::HashMap;
use std::rc::Rc;

pub const MAX_TERMS: usize = 64;
pub const MAX_INT_POW: i64 = 8;
const FACTOR_LIMIT: u32 = 65536;
const MAX_POW_EXPONENT: u64 = 65536;
const MAX_POW_RESULT_BITS: u64 = 1048576;

/// Math.pow: JavaScript's in WebAssembly, so the doubles match exact.js
#[cfg(target_arch = "wasm32")]
#[inline]
pub fn js_pow(x: f64, y: f64) -> f64 {
    js_sys::Math::pow(x, y)
}

#[cfg(not(target_arch = "wasm32"))]
#[inline]
pub fn js_pow(x: f64, y: f64) -> f64 {
    x.powf(y)
}

/// A term: coefficient c (≠ 0) × Π rad[i].0 ^ rad[i].1; rad sorted by base, exponents in (0, 1)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Term {
    pub c: Q,
    pub rad: Vec<(BigUint, Q)>,
    pub key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Rat(Q),
    /// Canonical terms, at least one with a radical part
    Irr(Rc<Vec<Term>>),
    Approx(Q),
}

/// What an exact operation could not do: the operation threw in exact.js
/// (fraction.js divides by zero in an approximate fallback)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail(pub &'static str);

pub type Res = Result<Value, Fail>;

const DIVISION_BY_ZERO: Fail = Fail("Division by Zero");

fn rad_key(rad: &[(BigUint, Q)]) -> String {
    let mut key = String::new();
    for (base, e) in rad {
        if !key.is_empty() {
            key.push('*');
        }
        let (n, d) = e.parts_text();
        key.push_str(&base.to_string());
        key.push('^');
        key.push_str(&n);
        key.push('/');
        key.push_str(&d);
    }
    key
}

fn make_term(c: Q, rad: Vec<(BigUint, Q)>) -> Term {
    let key = rad_key(&rad);
    Term { c, rad, key }
}

impl Value {
    #[inline]
    pub fn is_rational(&self) -> bool {
        matches!(self, Value::Rat(_))
    }

    #[inline]
    pub fn is_approx(&self) -> bool {
        matches!(self, Value::Approx(_))
    }

    #[inline]
    pub fn is_irrational(&self) -> bool {
        matches!(self, Value::Irr(_))
    }
}

// ---------------------------------------------------------------------------
// BigInt helpers
// ---------------------------------------------------------------------------

/// base ^ exp, None past the caps of exact.js
fn capped_pow(base: &BigInt, exp: &BigInt) -> Option<BigInt> {
    if exp.is_zero() {
        return Some(BigInt::one());
    }
    let exp = exp.to_u64().filter(|&e| e <= MAX_POW_EXPONENT)?;
    let magnitude = base.magnitude();
    if magnitude > &BigUint::one() && magnitude.bits().saturating_mul(exp) > MAX_POW_RESULT_BITS {
        return None;
    }
    Some(num_traits::pow(base.clone(), exp as usize))
}

/// The exact n-th root of value ≥ 0, if it has one
fn exact_nth_root(value: &BigInt, n: &BigInt) -> Option<BigInt> {
    let magnitude = value.magnitude();
    // floor(value ^ (1/n)): 1 whenever 2^n > value ≥ 2
    let root: BigUint = if magnitude < &BigUint::from(2u32) || n.is_one() {
        magnitude.clone()
    } else {
        match n.to_u32() {
            Some(n) if (n as u64) < magnitude.bits() => magnitude.nth_root(n),
            _ => BigUint::one(),
        }
    };
    let root = BigInt::from_biguint(Sign::Plus, root);
    // root ^ n == value. A root of 0 or 1 is its own power; a larger one came
    // from nth_root (n < bits, so n fits) or is the value itself (n = 1).
    let matches = if root <= BigInt::one() {
        root == *value
    } else {
        let n = n.to_u32()?;
        num_traits::pow(root.clone(), n as usize) == *value
    };
    if matches {
        Some(root)
    } else {
        None
    }
}

/// Prime factors of n > 0 by trial division up to FACTOR_LIMIT; the rest as one
/// cofactor. `into` keeps the order of first appearance, like a Map.
fn factor(n: &BigInt, into: &mut Vec<(BigUint, BigInt)>, sign: i32) {
    let mut add = |p: BigUint, k: u64| {
        let k = BigInt::from(k) * sign;
        if let Some(entry) = into.iter_mut().find(|(base, _)| *base == p) {
            entry.1 += k;
        } else {
            into.push((p, k));
        }
    };
    let mut n = n.magnitude().clone();
    if n <= BigUint::one() {
        return;
    }
    let twos = n.trailing_zeros().unwrap_or(0);
    if twos > 0 {
        n >>= twos;
        add(BigUint::from(2u32), twos);
    }
    if let Some(mut small) = n.to_u64() {
        let mut p: u64 = 3;
        while p <= FACTOR_LIMIT as u64 && p * p <= small {
            if small % p == 0 {
                let mut k = 0;
                while small % p == 0 {
                    small /= p;
                    k += 1;
                }
                add(BigUint::from(p), k);
            }
            p += 2;
        }
        if small > 1 {
            add(BigUint::from(small), 1);
        }
        return;
    }
    let mut p: u32 = 3;
    while p <= FACTOR_LIMIT && BigUint::from(p as u64 * p as u64) <= n {
        if (&n % p).is_zero() {
            let mut k = 0;
            while (&n % p).is_zero() {
                n /= p;
                k += 1;
            }
            add(BigUint::from(p), k);
        }
        p += 2;
    }
    if n > BigUint::one() {
        add(n, 1);
    }
}

// ---------------------------------------------------------------------------
// Canonical construction
// ---------------------------------------------------------------------------

/// A coefficient times bases with rational exponents, as a term: integer
/// parts of exponents move into the coefficient. None when a capped power
/// would be exceeded.
fn normalize_term(c: &Q, bases: &[(BigUint, Q)]) -> Option<Term> {
    let mut coefficient = c.clone();
    let mut rad: Vec<(BigUint, Q)> = Vec::with_capacity(bases.len());
    for (base, e) in bases {
        if e.is_zero() {
            continue;
        }
        // e = q + r, 0 ≤ r < 1
        let q = e.floor_int();
        let r = e.sub(&Q::from_big_ints(q.clone(), BigInt::one()));
        if !q.is_zero() {
            let p = capped_pow(&BigInt::from_biguint(Sign::Plus, base.clone()), &q.abs())?;
            let p = Q::from_big_ints(p, BigInt::one());
            coefficient = if q.is_positive() { coefficient.mul(&p) } else { coefficient.div(&p)? };
        }
        if !r.is_zero() {
            rad.push((base.clone(), r));
        }
    }
    rad.sort_by(|x, y| x.0.cmp(&y.0));
    Some(make_term(coefficient, rad))
}

/// Terms → canonical value: rational when no radical is left; None past MAX_TERMS
fn from_terms(list: Vec<Term>) -> Option<Value> {
    let mut terms: Vec<Term> = Vec::with_capacity(list.len());
    if list.len() <= 16 {
        for t in list {
            if let Some(prev) = terms.iter_mut().find(|p| p.key == t.key) {
                prev.c = prev.c.add(&t.c);
            } else {
                terms.push(t);
            }
        }
    } else {
        let mut index: HashMap<String, usize> = HashMap::with_capacity(list.len());
        for t in list {
            match index.get(&t.key) {
                Some(&at) => terms[at].c = terms[at].c.add(&t.c),
                None => {
                    index.insert(t.key.clone(), terms.len());
                    terms.push(t);
                }
            }
        }
    }
    terms.retain(|t| !t.c.is_zero());
    if terms.is_empty() {
        return Some(Value::Rat(Q::zero()));
    }
    if terms.len() == 1 && terms[0].key.is_empty() {
        return Some(Value::Rat(terms.pop().map(|t| t.c).unwrap_or_else(Q::zero)));
    }
    if terms.len() > MAX_TERMS {
        return None;
    }
    terms.sort_by(|x, y| x.key.cmp(&y.key));
    Some(Value::Irr(Rc::new(terms)))
}

fn terms_of(v: &Value) -> Vec<Term> {
    match v {
        Value::Irr(terms) => (**terms).clone(),
        Value::Rat(q) | Value::Approx(q) => {
            if q.is_zero() {
                Vec::new()
            } else {
                vec![make_term(q.clone(), Vec::new())]
            }
        }
    }
}

fn term_count(v: &Value) -> usize {
    match v {
        Value::Irr(terms) => terms.len(),
        Value::Rat(q) | Value::Approx(q) => usize::from(!q.is_zero()),
    }
}

fn mul_terms(a: &Term, b: &Term) -> Option<Term> {
    let mut bases: Vec<(BigUint, Q)> = a.rad.clone();
    for (base, e) in &b.rad {
        if let Some(entry) = bases.iter_mut().find(|(x, _)| x == base) {
            entry.1 = entry.1.add(e);
        } else {
            bases.push((base.clone(), e.clone()));
        }
    }
    normalize_term(&a.c.mul(&b.c), &bases)
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/// The value as a double (toNumber of exact.js)
pub fn to_number(v: &Value, fallback: f64) -> f64 {
    match v {
        Value::Rat(q) | Value::Approx(q) => q.to_f64(fallback),
        Value::Irr(terms) => {
            let mut sum = 0.0;
            for t in terms.iter() {
                let mut x = t.c.to_f64(0.0);
                for (base, e) in &t.rad {
                    x *= js_pow(big_uint_to_f64(base), e.numer_f64() / e.denom_f64());
                }
                sum += x;
            }
            if sum.is_finite() {
                sum
            } else {
                fallback
            }
        }
    }
}

/// A double's exact value (m × 2^e)
pub fn exact_double(x: f64) -> Q {
    if x == 0.0 {
        return Q::zero();
    }
    let bits = x.to_bits();
    let negative = bits >> 63 == 1;
    let exp_bits = ((bits >> 52) & 0x7ff) as i64;
    let mut mantissa = bits & 0x000f_ffff_ffff_ffff;
    let e = if exp_bits == 0 {
        -1074
    } else {
        mantissa |= 1 << 52;
        exp_bits - 1075
    };
    let m = BigInt::from(mantissa) * if negative { -1 } else { 1 };
    if e >= 0 {
        Q::from_big_ints(m << (e as usize), BigInt::one())
    } else {
        Q::from_big_ints(m, BigInt::one() << ((-e) as usize))
    }
}

fn fraction_from_double(x: f64) -> Q {
    if x.is_finite() {
        exact_double(x)
    } else if x.is_nan() {
        Q::zero()
    } else {
        exact_double(if x > 0.0 { f64::MAX } else { -f64::MAX })
    }
}

/// The value as a rational: itself, its approximation, or the nearest double
pub fn shadow(v: &Value) -> Q {
    match v {
        Value::Rat(q) | Value::Approx(q) => q.clone(),
        Value::Irr(_) => fraction_from_double(to_number(v, f64::NAN)),
    }
}

/// An approximate value from a double
pub fn approx_from_number(x: f64) -> Value {
    Value::Approx(fraction_from_double(x))
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

pub fn add(a: &Value, b: &Value) -> Value {
    if let (Value::Rat(x), Value::Rat(y)) = (a, b) {
        return Value::Rat(x.add(y));
    }
    let approx = || Value::Approx(shadow(a).add(&shadow(b)));
    if a.is_approx() || b.is_approx() {
        return approx();
    }
    let mut list = terms_of(a);
    list.extend(terms_of(b));
    from_terms(list).unwrap_or_else(approx)
}

pub fn neg(a: &Value) -> Value {
    match a {
        Value::Rat(q) => Value::Rat(q.neg()),
        Value::Approx(q) => Value::Approx(q.neg()),
        Value::Irr(terms) => Value::Irr(Rc::new(
            terms.iter().map(|t| Term { c: t.c.neg(), rad: t.rad.clone(), key: t.key.clone() }).collect(),
        )),
    }
}

pub fn sub(a: &Value, b: &Value) -> Value {
    add(a, &neg(b))
}

pub fn mul(a: &Value, b: &Value) -> Value {
    if let (Value::Rat(x), Value::Rat(y)) = (a, b) {
        return Value::Rat(x.mul(y));
    }
    let approx = || Value::Approx(shadow(a).mul(&shadow(b)));
    if a.is_approx() || b.is_approx() {
        return approx();
    }
    if term_count(a) * term_count(b) > MAX_TERMS * MAX_TERMS {
        return approx();
    }
    let (ta, tb) = (terms_of(a), terms_of(b));
    let mut out = Vec::with_capacity(ta.len() * tb.len());
    for x in &ta {
        for y in &tb {
            match mul_terms(x, y) {
                Some(t) => out.push(t),
                None => return approx(),
            }
        }
    }
    from_terms(out).unwrap_or_else(approx)
}

/// 1 / (single term): coefficient inverted, exponents negated and renormalized
fn invert_term(t: &Term) -> Option<Term> {
    let bases: Vec<(BigUint, Q)> = t.rad.iter().map(|(b, e)| (b.clone(), e.neg())).collect();
    normalize_term(&t.c.inverse()?, &bases)
}

/// a / b; the caller has ruled out b = 0
pub fn div(a: &Value, b: &Value) -> Res {
    if let (Value::Rat(x), Value::Rat(y)) = (a, b) {
        return x.div(y).map(Value::Rat).ok_or(DIVISION_BY_ZERO);
    }
    let approx = || shadow(a).div(&shadow(b)).map(Value::Approx).ok_or(DIVISION_BY_ZERO);
    if a.is_approx() || b.is_approx() {
        return approx();
    }
    let tb = terms_of(b);
    if tb.len() != 1 {
        return approx(); // ÷ by a sum: not closed
    }
    let Some(inverse) = invert_term(&tb[0]) else { return approx() };
    match from_terms(vec![inverse]) {
        Some(inverse) => Ok(mul(a, &inverse)),
        None => approx(),
    }
}

pub fn is_zero(v: &Value) -> bool {
    match v {
        Value::Rat(q) | Value::Approx(q) => q.is_zero(),
        Value::Irr(_) => false, // a canonical irrational value is never zero
    }
}

/// A rational number to a rational power
fn rational_pow(base: &Q, e: &Q) -> Value {
    if e.is_zero() {
        return Value::Rat(Q::one());
    }
    let en = e.numer();
    let ed = e.denom();
    let exponent_f64 = || e.numer_f64() / e.denom_f64();
    if base.is_zero() {
        if en.is_positive() {
            return Value::Rat(Q::zero());
        }
        return approx_from_number(js_pow(0.0, exponent_f64())); // 0^negative: no value
    }
    let k = en.abs();
    // Integer exponent: rational
    if ed.is_one() {
        let n = capped_pow(&base.numer(), &k);
        let d = capped_pow(&base.denom(), &k);
        return match (n, d) {
            (Some(n), Some(d)) => Value::Rat(if en.is_positive() { Q::from_big_ints(n, d) } else { Q::from_big_ints(d, n) }),
            _ => approx_from_number(js_pow(base.to_f64(0.0), e.numer_f64())),
        };
    }
    // Sign: an odd root keeps it, an even root of a negative is not real
    let mut sign = 1;
    if base.is_negative() {
        if ed.is_even() {
            return approx_from_number(f64::NAN);
        }
        if en.is_odd() {
            sign = -1;
        }
    }
    let base_n = base.numer().abs();
    let base_d = base.denom();
    // Perfect root first (keeps the result rational without factoring)
    if let (Some(pn), Some(pd)) = (capped_pow(&base_n, &k), capped_pow(&base_d, &k)) {
        if let (Some(rn), Some(rd)) = (exact_nth_root(&pn, &ed), exact_nth_root(&pd, &ed)) {
            let rn = rn * sign;
            return Value::Rat(if en.is_positive() {
                Q::from_big_ints(rn, rd)
            } else {
                Q::from_big_ints(rd * sign, rn * sign)
            });
        }
    }
    // Factor |base| and raise each prime
    let mut exps: Vec<(BigUint, BigInt)> = Vec::new();
    factor(&base_n, &mut exps, 1);
    factor(&base_d, &mut exps, -1);
    let bases: Vec<(BigUint, Q)> = exps
        .into_iter()
        .filter(|(_, m)| !m.is_zero())
        .map(|(p, m)| (p, Q::from_big_ints(m, BigInt::one()).mul(e)))
        .collect();
    match normalize_term(&Q::int(sign), &bases) {
        Some(t) => from_terms(vec![t]).unwrap_or_else(|| approx_from_number(f64::NAN)),
        None => approx_from_number(js_pow(base.to_f64(0.0), exponent_f64())),
    }
}

/// a ^ e
pub fn pow(a: &Value, e: &Value) -> Value {
    let fallback = || approx_from_number(js_pow(to_number(a, f64::NAN), to_number(e, f64::NAN)));
    let exponent = match e {
        Value::Rat(q) => q,
        _ => return fallback(),
    };
    match a {
        Value::Approx(_) => fallback(),
        Value::Rat(q) => rational_pow(q, exponent),
        Value::Irr(terms) if terms.len() == 1 => {
            let t = &terms[0];
            let out = rational_pow(&t.c, exponent);
            if out.is_approx() {
                return fallback();
            }
            let bases: Vec<(BigUint, Q)> = t.rad.iter().map(|(b, x)| (b.clone(), x.mul(exponent))).collect();
            match normalize_term(&Q::one(), &bases).and_then(|r| from_terms(vec![r])) {
                Some(r) => mul(&out, &r),
                None => fallback(),
            }
        }
        Value::Irr(_) => {
            // A sum: only small non-negative integer powers stay exact
            if let Q::S(n, 1) = exponent {
                if (0..=MAX_INT_POW).contains(n) {
                    let mut out = Value::Rat(Q::one());
                    for _ in 0..*n {
                        out = mul(&out, a);
                    }
                    return out;
                }
            }
            fallback()
        }
    }
}

// ---------------------------------------------------------------------------
// Text, for the JavaScript side
// ---------------------------------------------------------------------------

/// The terms of an irrational value as text, hexadecimal throughout:
/// `c*b^p/q*b^p/q;c*b^p/q`, each coefficient `n/d` with its sign on n
pub fn irrational_text(terms: &[Term]) -> String {
    let mut out = String::new();
    for (i, t) in terms.iter().enumerate() {
        if i > 0 {
            out.push(';');
        }
        out.push_str(&t.c.hex_text());
        for (base, e) in &t.rad {
            out.push('*');
            out.push_str(&format!("{:x}", base));
            out.push('^');
            out.push_str(&e.hex_text());
        }
    }
    out
}

/// The DSL text of exact.js (toText), for the tests
pub fn to_text(v: &Value) -> String {
    fn frac_text(q: &Q) -> String {
        let (n, d) = q.parts_text();
        if d == "1" {
            n
        } else {
            format!("({}/{})", n, d)
        }
    }
    match v {
        Value::Rat(q) => frac_text(q),
        Value::Approx(q) => format!("~{}", frac_text(q)),
        Value::Irr(terms) => {
            let mut out = String::new();
            for (i, t) in terms.iter().enumerate() {
                let negative = t.c.is_negative();
                let magnitude = if negative { t.c.neg() } else { t.c.clone() };
                let mut parts: Vec<String> = Vec::new();
                if !magnitude.is_one() || t.rad.is_empty() {
                    parts.push(frac_text(&magnitude));
                }
                for (base, e) in &t.rad {
                    let (n, d) = e.parts_text();
                    parts.push(format!("{}^({}/{})", base, n, d));
                }
                let body = parts.join(" * ");
                if i == 0 {
                    out.push_str(if negative { "-" } else { "" });
                } else {
                    out.push_str(if negative { " - " } else { " + " });
                }
                out.push_str(&body);
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(n: i64, d: i64) -> Value {
        Value::Rat(Q::from_i128(n as i128, d as i128))
    }

    fn text(v: &Value) -> String {
        to_text(v)
    }

    #[test]
    fn tempered_semitone_stays_symbolic() {
        let s = pow(&r(2, 1), &r(1, 12));
        assert_eq!(text(&s), "2^(1/12)");
        // twelve of them make an octave, exactly
        let mut octave = r(1, 1);
        for _ in 0..12 {
            octave = mul(&octave, &s);
        }
        assert_eq!(octave, r(2, 1));
        assert_eq!(text(&mul(&r(263, 1), &pow(&r(2, 1), &r(7, 12)))), "263 * 2^(7/12)");
    }

    #[test]
    fn perfect_roots_are_rational() {
        assert_eq!(pow(&r(9, 4), &r(1, 2)), r(3, 2));
        assert_eq!(pow(&r(-8, 27), &r(1, 3)), r(-2, 3));
        assert_eq!(pow(&r(-8, 27), &r(-2, 3)), r(9, 4));
        assert_eq!(pow(&r(4, 1), &r(-1, 2)), r(1, 2));
        assert_eq!(pow(&r(2, 1), &r(-3, 1)), r(1, 8));
    }

    #[test]
    fn factoring_and_merging() {
        // 12^(1/2) = 2 * 3^(1/2)
        assert_eq!(text(&pow(&r(12, 1), &r(1, 2))), "2 * 3^(1/2)");
        // (2/3)^(1/2) = 2^(1/2) * 3^(-1/2) = (1/3) * 2^(1/2) * 3^(1/2)
        assert_eq!(text(&pow(&r(2, 3), &r(1, 2))), "(1/3) * 2^(1/2) * 3^(1/2)");
        // sums
        let s2 = pow(&r(2, 1), &r(1, 2));
        let s3 = pow(&r(3, 1), &r(1, 2));
        let sum = add(&add(&s2, &s3), &r(1, 1));
        assert_eq!(text(&sum), "1 + 2^(1/2) + 3^(1/2)");
        assert_eq!(sub(&sum, &s3), add(&s2, &r(1, 1)));
        assert_eq!(text(&mul(&sum, &sum)), "6 + 2 * 2^(1/2) + 2 * 2^(1/2) * 3^(1/2) + 2 * 3^(1/2)");
    }

    #[test]
    fn division_by_a_single_term_is_exact_by_a_sum_approximate() {
        let s2 = pow(&r(2, 1), &r(1, 2));
        assert_eq!(text(&div(&r(1, 1), &s2).unwrap()), "(1/2) * 2^(1/2)");
        let sum = add(&s2, &r(1, 1));
        let q = div(&r(1, 1), &sum).unwrap();
        assert!(q.is_approx());
        assert_eq!(shadow(&q), exact_double(1.0).div(&exact_double(1.0 + js_pow(2.0, 0.5))).unwrap());
    }

    #[test]
    fn not_real_and_zero_powers() {
        assert_eq!(pow(&r(-2, 1), &r(1, 2)), Value::Approx(Q::zero()));
        assert_eq!(pow(&r(0, 1), &r(2, 1)), r(0, 1));
        assert!(pow(&r(0, 1), &r(-1, 1)).is_approx());
        assert_eq!(pow(&r(5, 1), &r(0, 1)), r(1, 1));
    }

    #[test]
    fn approximations_spread() {
        let a = Value::Approx(Q::from_i128(26163, 100));
        let b = mul(&a, &r(2, 1));
        assert_eq!(b, Value::Approx(Q::from_i128(26163, 50)));
        assert!(add(&b, &pow(&r(2, 1), &r(1, 12))).is_approx());
    }

    #[test]
    fn capped_powers_fall_back() {
        assert!(pow(&r(2, 1), &r(70000, 1)).is_approx());
        assert_eq!(capped_pow(&BigInt::from(1), &BigInt::from(1_000_000u64)), None);
        assert_eq!(capped_pow(&BigInt::from(1), &BigInt::from(65536u64)), Some(BigInt::one()));
    }

    #[test]
    fn exact_double_is_exact() {
        assert_eq!(exact_double(0.5), Q::S(1, 2));
        assert_eq!(exact_double(-3.0), Q::S(-3, 1));
        assert_eq!(exact_double(0.1).to_f64(0.0), 0.1);
        assert_eq!(fraction_from_double(f64::NAN), Q::zero());
        assert_eq!(fraction_from_double(f64::INFINITY).to_f64(0.0), f64::MAX);
    }

    #[test]
    fn text_for_javascript() {
        let v = mul(&r(-3, 2), &pow(&r(2, 1), &r(1, 12)));
        match v {
            Value::Irr(terms) => assert_eq!(irrational_text(&terms), "-3/2*2^1/c"),
            _ => panic!("not irrational"),
        }
    }
}
