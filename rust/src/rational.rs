//! Exact rational numbers with a fast path.
//!
//! A value whose reduced numerator and denominator fit in an `i64` is two
//! machine words (`Q::S`) and its arithmetic allocates nothing; any other value
//! is a `BigRational` (`Q::B`). The form is canonical: a value that fits `S` is
//! always `S`, so equal values are equal structurally, as fraction.js values
//! are equal by their fields.
//!
//! `to_f64` is the twin of `toNumber()` in src/utils/fraction-num.js: the same
//! double for every value, including the ones beyond the double range.

use num_bigint::{BigInt, BigUint, Sign};
use num_integer::Integer;
use num_rational::BigRational;
use num_traits::{One, Signed, ToPrimitive, Zero};
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Q {
    /// numerator, denominator: d > 0, gcd(|n|, d) = 1, n > i64::MIN
    S(i64, i64),
    /// A value that does not fit `S` (never one that does)
    B(Rc<BigRational>),
}

#[inline]
fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    if a == 0 {
        return b;
    }
    if b == 0 {
        return a;
    }
    let shift = (a | b).trailing_zeros();
    a >>= a.trailing_zeros();
    loop {
        b >>= b.trailing_zeros();
        if a > b {
            std::mem::swap(&mut a, &mut b);
        }
        b -= a;
        if b == 0 {
            return a << shift;
        }
    }
}

fn gcd_u128(mut a: u128, mut b: u128) -> u128 {
    if a <= u64::MAX as u128 && b <= u64::MAX as u128 {
        return gcd_u64(a as u64, b as u64) as u128;
    }
    if a == 0 {
        return b;
    }
    if b == 0 {
        return a;
    }
    let shift = (a | b).trailing_zeros();
    a >>= a.trailing_zeros();
    loop {
        b >>= b.trailing_zeros();
        if a > b {
            std::mem::swap(&mut a, &mut b);
        }
        b -= a;
        if b == 0 {
            return a << shift;
        }
    }
}

#[inline]
fn rem_u128_by_u64(x: u128, m: u64) -> u64 {
    if x <= u64::MAX as u128 {
        (x as u64) % m
    } else {
        (x % m as u128) as u64
    }
}

const I64_MIN: i128 = i64::MIN as i128;
const I64_MAX: i128 = i64::MAX as i128;

/// The correctly rounded double of an unsigned big integer (ties to even), as
/// JavaScript's `Number(bigint)` gives it; infinite past the double range.
pub fn big_uint_to_f64(x: &BigUint) -> f64 {
    let bits = x.bits();
    if bits <= 64 {
        return x.to_u64().unwrap_or(0) as f64;
    }
    // The top 64 bits, the lowest of them made sticky when anything below is
    // set: the u64 -> f64 conversion then rounds exactly as the whole would.
    let shift = bits - 64;
    let mut top = (x >> shift).to_u64().unwrap_or(u64::MAX);
    if x.trailing_zeros().unwrap_or(0) < shift {
        top |= 1;
    }
    let mantissa = top as f64; // in [2^63, 2^64]
    let exponent = shift as i64;
    if exponent + 64 > 1025 {
        return f64::INFINITY;
    }
    // mantissa * 2^exponent, exactly (exponent <= 961 here)
    mantissa * f64::from_bits(((exponent + 1023) as u64) << 52)
}

pub fn big_int_to_f64(x: &BigInt) -> f64 {
    let magnitude = big_uint_to_f64(x.magnitude());
    if x.sign() == Sign::Minus {
        -magnitude
    } else {
        magnitude
    }
}

fn decimal_digits(x: &BigUint) -> u64 {
    if x.is_zero() {
        return 1;
    }
    x.to_str_radix(10).len() as u64
}

// fraction-num.js: below this many decimal digits both fields convert to
// finite doubles and their division is correctly rounded
const SAFE_DIGITS: u64 = 300;

impl Q {
    #[inline]
    pub fn zero() -> Q {
        Q::S(0, 1)
    }

    #[inline]
    pub fn one() -> Q {
        Q::S(1, 1)
    }

    #[inline]
    pub fn int(n: i64) -> Q {
        if n == i64::MIN {
            Q::from_big_ints(BigInt::from(n), BigInt::one())
        } else {
            Q::S(n, 1)
        }
    }

    /// From an already reduced pair, d > 0
    #[inline]
    fn from_reduced_i128(n: i128, d: i128) -> Q {
        if n > I64_MIN && n <= I64_MAX && d <= I64_MAX {
            Q::S(n as i64, d as i64)
        } else {
            Q::B(Rc::new(BigRational::new_raw(BigInt::from(n), BigInt::from(d))))
        }
    }

    /// From any pair with d != 0; reduces it
    pub fn from_i128(n: i128, d: i128) -> Q {
        let (n, d) = if d < 0 { (-n, -d) } else { (n, d) };
        if n == 0 {
            return Q::zero();
        }
        let g = gcd_u128(n.unsigned_abs(), d as u128) as i128;
        Q::from_reduced_i128(n / g, d / g)
    }

    /// From a reduced BigRational (positive denominator)
    pub fn from_big(r: BigRational) -> Q {
        if let (Some(n), Some(d)) = (r.numer().to_i64(), r.denom().to_i64()) {
            if n != i64::MIN {
                return Q::S(n, d);
            }
        }
        Q::B(Rc::new(r))
    }

    /// From any pair, d != 0 (BigRational::new reduces and fixes the sign)
    pub fn from_big_ints(n: BigInt, d: BigInt) -> Q {
        Q::from_big(BigRational::new(n, d))
    }

    pub fn to_big(&self) -> BigRational {
        match self {
            Q::S(n, d) => BigRational::new_raw(BigInt::from(*n), BigInt::from(*d)),
            Q::B(r) => (**r).clone(),
        }
    }

    /// The signed numerator
    pub fn numer(&self) -> BigInt {
        match self {
            Q::S(n, _) => BigInt::from(*n),
            Q::B(r) => r.numer().clone(),
        }
    }

    /// The (positive) denominator
    pub fn denom(&self) -> BigInt {
        match self {
            Q::S(_, d) => BigInt::from(*d),
            Q::B(r) => r.denom().clone(),
        }
    }

    #[inline]
    pub fn is_zero(&self) -> bool {
        matches!(self, Q::S(0, _))
    }

    #[inline]
    pub fn is_one(&self) -> bool {
        matches!(self, Q::S(1, 1))
    }

    #[inline]
    pub fn is_integer(&self) -> bool {
        match self {
            Q::S(_, d) => *d == 1,
            Q::B(r) => r.denom().is_one(),
        }
    }

    /// -1, 0 or 1
    #[inline]
    pub fn signum(&self) -> i32 {
        match self {
            Q::S(n, _) => n.signum() as i32,
            Q::B(r) => {
                if r.numer().is_negative() {
                    -1
                } else {
                    1
                }
            }
        }
    }

    #[inline]
    pub fn is_negative(&self) -> bool {
        self.signum() < 0
    }

    #[inline]
    pub fn is_positive(&self) -> bool {
        self.signum() > 0
    }

    pub fn add(&self, other: &Q) -> Q {
        if let (Q::S(an, ad), Q::S(bn, bd)) = (self, other) {
            let (an, ad, bn, bd) = (*an, *ad, *bn, *bd);
            if ad == 1 && bd == 1 {
                return Q::from_reduced_i128(an as i128 + bn as i128, 1);
            }
            // Knuth, TAOCP 4.5.1: the result comes out reduced
            let g1 = gcd_u64(ad as u64, bd as u64) as i64;
            if g1 == 1 {
                let n = an as i128 * bd as i128 + bn as i128 * ad as i128;
                if n == 0 {
                    return Q::zero();
                }
                return Q::from_reduced_i128(n, ad as i128 * bd as i128);
            }
            let t = an as i128 * (bd / g1) as i128 + bn as i128 * (ad / g1) as i128;
            if t == 0 {
                return Q::zero();
            }
            let g2 = gcd_u64(rem_u128_by_u64(t.unsigned_abs(), g1 as u64), g1 as u64) as i128;
            return Q::from_reduced_i128(t / g2, (ad / g1) as i128 * (bd as i128 / g2));
        }
        Q::from_big(self.to_big() + other.to_big())
    }

    pub fn neg(&self) -> Q {
        match self {
            Q::S(n, d) => Q::S(-n, *d),
            Q::B(r) => Q::from_big(-(**r).clone()),
        }
    }

    pub fn sub(&self, other: &Q) -> Q {
        self.add(&other.neg())
    }

    pub fn mul(&self, other: &Q) -> Q {
        if let (Q::S(an, ad), Q::S(bn, bd)) = (self, other) {
            let (an, ad, bn, bd) = (*an, *ad, *bn, *bd);
            if an == 0 || bn == 0 {
                return Q::zero();
            }
            let g1 = gcd_u64(an.unsigned_abs(), bd as u64) as i64;
            let g2 = gcd_u64(bn.unsigned_abs(), ad as u64) as i64;
            let n = (an / g1) as i128 * (bn / g2) as i128;
            let d = (ad / g2) as i128 * (bd / g1) as i128;
            return Q::from_reduced_i128(n, d);
        }
        Q::from_big(self.to_big() * other.to_big())
    }

    /// 1 / self; None for zero
    pub fn inverse(&self) -> Option<Q> {
        match self {
            Q::S(0, _) => None,
            Q::S(n, d) => Some(if *n < 0 { Q::S(-d, -n) } else { Q::S(*d, *n) }),
            Q::B(r) => Some(Q::from_big(r.recip())),
        }
    }

    /// self / other; None when other is zero
    pub fn div(&self, other: &Q) -> Option<Q> {
        Some(self.mul(&other.inverse()?))
    }

    /// floor(self) as a BigInt
    pub fn floor_int(&self) -> BigInt {
        match self {
            Q::S(n, d) => BigInt::from(n.div_euclid(*d)),
            Q::B(r) => r.numer().div_floor(r.denom()),
        }
    }

    /// The numerator as a double, as JavaScript's Number() converts a BigInt
    pub fn numer_f64(&self) -> f64 {
        match self {
            Q::S(n, _) => *n as f64,
            Q::B(r) => big_int_to_f64(r.numer()),
        }
    }

    pub fn denom_f64(&self) -> f64 {
        match self {
            Q::S(_, d) => *d as f64,
            Q::B(r) => big_int_to_f64(r.denom()),
        }
    }

    /// toNumber() of src/utils/fraction-num.js
    pub fn to_f64(&self, fallback: f64) -> f64 {
        match self {
            Q::S(n, d) => (*n as f64) / (*d as f64),
            Q::B(r) => {
                let sign = if r.numer().is_negative() { -1.0 } else { 1.0 };
                let n = r.numer().magnitude();
                let d = r.denom().magnitude();
                // 300 decimal digits need more than 996 bits
                if n.bits() > 996 || d.bits() > 996 {
                    let n_digits = decimal_digits(n);
                    let d_digits = decimal_digits(d);
                    if n_digits > SAFE_DIGITS || d_digits > SAFE_DIGITS {
                        let smaller = n_digits.min(d_digits);
                        let shift = if smaller > 15 { smaller - 15 } else { 0 };
                        let p = num_traits::pow(BigUint::from(10u32), shift as usize);
                        let nv = big_uint_to_f64(&(n / &p));
                        let dv = big_uint_to_f64(&(d / &p));
                        if dv == 0.0 {
                            return sign * if nv == 0.0 { fallback } else { f64::INFINITY };
                        }
                        return sign * (nv / dv);
                    }
                }
                sign * (big_uint_to_f64(n) / big_uint_to_f64(d))
            }
        }
    }

    /// The decimal text of the numerator and of the denominator
    pub fn parts_text(&self) -> (String, String) {
        match self {
            Q::S(n, d) => (n.to_string(), d.to_string()),
            Q::B(r) => (r.numer().to_string(), r.denom().to_string()),
        }
    }

    /// `n/d` in hexadecimal, the sign on the numerator
    pub fn hex_text(&self) -> String {
        match self {
            Q::S(n, d) => {
                if *n < 0 {
                    format!("-{:x}/{:x}", n.unsigned_abs(), d)
                } else {
                    format!("{:x}/{:x}", n, d)
                }
            }
            Q::B(r) => format!("{:x}/{:x}", r.numer(), r.denom()),
        }
    }

    /// Numerator and denominator as doubles when a double holds each exactly
    pub fn small_parts(&self) -> Option<(f64, f64)> {
        const LIMIT: u64 = 1 << 53;
        match self {
            Q::S(n, d) if n.unsigned_abs() <= LIMIT && (*d as u64) <= LIMIT => Some((*n as f64, *d as f64)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(n: i64, d: i64) -> Q {
        Q::from_i128(n as i128, d as i128)
    }

    fn big(text: &str) -> Q {
        let (n, d) = text.split_once('/').unwrap_or((text, "1"));
        Q::from_big_ints(n.parse().unwrap(), d.parse().unwrap())
    }

    #[test]
    fn reduces_and_keeps_the_sign_on_the_numerator() {
        assert_eq!(q(6, -4), Q::S(-3, 2));
        assert_eq!(q(0, -5), Q::S(0, 1));
        assert_eq!(q(-7, 7), Q::S(-1, 1));
    }

    #[test]
    fn small_arithmetic() {
        assert_eq!(q(1, 2).add(&q(1, 3)), q(5, 6));
        assert_eq!(q(1, 6).add(&q(1, 3)), q(1, 2));
        assert_eq!(q(1, 4).add(&q(3, 4)), Q::one());
        assert_eq!(q(1, 4).sub(&q(1, 4)), Q::zero());
        assert_eq!(q(2, 3).mul(&q(9, 4)), q(3, 2));
        assert_eq!(q(2, 3).div(&q(-4, 9)), Some(q(-3, 2)));
        assert_eq!(q(2, 3).div(&Q::zero()), None);
        assert_eq!(q(3, 4).inverse(), Some(q(4, 3)));
        assert_eq!(q(-3, 4).inverse(), Some(q(-4, 3)));
    }

    #[test]
    fn overflow_moves_to_big_and_back() {
        let max = Q::int(i64::MAX);
        let sum = max.add(&Q::one());
        assert!(matches!(sum, Q::B(_)));
        assert_eq!(sum, big("9223372036854775808"));
        // back down when it fits again
        assert_eq!(sum.sub(&Q::one()), Q::S(i64::MAX, 1));
        // i64::MIN is never small, so negation is always safe
        assert!(matches!(Q::int(i64::MIN), Q::B(_)));
        assert_eq!(Q::int(i64::MIN).neg(), big("9223372036854775808"));
        let product = q(1 << 40, 3).mul(&q(1 << 40, 5));
        assert_eq!(product, big("1208925819614629174706176/15"));
        assert_eq!(product.mul(&q(15, 1 << 40)), Q::S(1 << 40, 1));
    }

    #[test]
    fn big_and_small_mix() {
        let comma = q(81, 80);
        let mut x = Q::one();
        for _ in 0..40 {
            x = x.mul(&comma);
        }
        assert!(matches!(x, Q::B(_)));
        for _ in 0..40 {
            x = x.div(&comma).unwrap();
        }
        assert_eq!(x, Q::one());
    }

    #[test]
    fn floor() {
        assert_eq!(q(7, 2).floor_int(), BigInt::from(3));
        assert_eq!(q(-7, 2).floor_int(), BigInt::from(-4));
        assert_eq!(q(-4, 2).floor_int(), BigInt::from(-2));
    }

    #[test]
    fn to_f64_rounds_like_javascript() {
        assert_eq!(q(1, 3).to_f64(0.0), 1.0 / 3.0);
        assert_eq!(q(-1, 3).to_f64(0.0), -1.0 / 3.0);
        // 2^64 + 2^11 + 1: above the halfway point, rounds up
        let x: BigUint = (BigUint::one() << 64u32) + BigUint::from(2049u32);
        assert_eq!(big_uint_to_f64(&x), 18446744073709555712.0);
        // 2^64 + 2^11 exactly halfway: ties to even (down)
        let y: BigUint = (BigUint::one() << 64u32) + BigUint::from(2048u32);
        assert_eq!(big_uint_to_f64(&y), 18446744073709551616.0);
        assert_eq!(big_uint_to_f64(&(BigUint::one() << 1024u32)), f64::INFINITY);
        assert_eq!(big_uint_to_f64(&(BigUint::one() << 1023u32)), 2f64.powi(1023));
        // Beyond 300 digits on both sides: the ratio survives
        let n = num_traits::pow(BigInt::from(10), 400) * BigInt::from(3);
        let d = num_traits::pow(BigInt::from(10), 400);
        assert_eq!(Q::from_big_ints(n, d.clone() * BigInt::from(7)).to_f64(0.0), 3.0 / 7.0);
    }

    #[test]
    fn hex_text() {
        assert_eq!(q(-31, 160).hex_text(), "-1f/a0");
        assert_eq!(big("-18446744073709551616/3").hex_text(), "-10000000000000000/3");
    }
}
