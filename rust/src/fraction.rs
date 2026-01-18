//! Arbitrary-precision rational number arithmetic
//!
//! Provides a Fraction type that mirrors the fraction.js API for
//! seamless interoperability with the JavaScript implementation.

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Signed, ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{Add, Div, Mul, Neg, Sub};
use wasm_bindgen::prelude::*;

/// Arbitrary-precision rational number
///
/// Wraps num-rational's BigRational to provide a JavaScript-compatible API.
#[wasm_bindgen]
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Fraction {
    inner: BigRational,
}

/// Internal representation for serialization
#[derive(Serialize, Deserialize)]
struct FractionRepr {
    n: String, // numerator as string (for big integers)
    d: String, // denominator as string
    s: i8,     // sign: 1 or -1
}

impl Fraction {
    /// Create a new Fraction from numerator and denominator
    pub fn new_raw(num: i64, den: i64) -> Self {
        let rational = BigRational::new(BigInt::from(num), BigInt::from(den));
        Fraction { inner: rational }
    }

    /// Create from BigRational directly
    pub fn from_big_rational(r: BigRational) -> Self {
        Fraction { inner: r }
    }

    /// Create from BigInt numerator and denominator
    pub fn from_big_ints(num: BigInt, den: BigInt) -> Self {
        if den.is_zero() {
            return Fraction {
                inner: BigRational::new(BigInt::from(0), BigInt::from(1)),
            };
        }
        Fraction {
            inner: BigRational::new(num, den),
        }
    }

    /// Get the underlying BigRational
    pub fn as_big_rational(&self) -> &BigRational {
        &self.inner
    }

    /// Check if denominator is zero
    pub fn is_nan(&self) -> bool {
        self.inner.denom().is_zero()
    }
}

#[wasm_bindgen]
impl Fraction {
    /// Create a new Fraction from numerator and denominator
    #[wasm_bindgen(constructor)]
    pub fn new(num: i32, den: i32) -> Fraction {
        if den == 0 {
            // Return NaN representation (0/0 is treated as invalid)
            return Fraction {
                inner: BigRational::new(BigInt::from(0), BigInt::from(1)),
            };
        }
        Fraction::new_raw(num as i64, den as i64)
    }

    /// Create a Fraction from a single integer
    #[wasm_bindgen(js_name = fromInt)]
    pub fn from_int(n: i32) -> Fraction {
        Fraction::new_raw(n as i64, 1)
    }

    /// Create a Fraction from a string like "3/4" or "1.5"
    #[wasm_bindgen(js_name = fromString)]
    pub fn from_string(s: &str) -> Result<Fraction, JsValue> {
        let s = s.trim();

        // Try parsing as a fraction "n/d"
        if let Some(pos) = s.find('/') {
            let num_str = s[..pos].trim();
            let den_str = s[pos + 1..].trim();

            let num: BigInt = num_str
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Invalid numerator: {}", e)))?;
            let den: BigInt = den_str
                .parse()
                .map_err(|e| JsValue::from_str(&format!("Invalid denominator: {}", e)))?;

            if den.is_zero() {
                return Err(JsValue::from_str("Division by zero"));
            }

            return Ok(Fraction {
                inner: BigRational::new(num, den),
            });
        }

        // Try parsing as a decimal
        if let Ok(f) = s.parse::<f64>() {
            return Ok(Fraction::from_f64(f));
        }

        // Try parsing as an integer
        if let Ok(n) = s.parse::<i64>() {
            return Ok(Fraction::new_raw(n, 1));
        }

        Err(JsValue::from_str(&format!(
            "Cannot parse '{}' as a fraction",
            s
        )))
    }

    /// Create a Fraction from a floating-point number
    #[wasm_bindgen(js_name = fromF64)]
    pub fn from_f64(value: f64) -> Fraction {
        if !value.is_finite() {
            return Fraction::new_raw(0, 1);
        }

        // Convert decimal to fraction using continued fractions approximation
        let tolerance = 1e-10;
        let max_iterations = 100;

        let sign = if value < 0.0 { -1i64 } else { 1i64 };
        let abs_value = value.abs();

        if abs_value == 0.0 {
            return Fraction::new_raw(0, 1);
        }

        // Handle integers
        if (abs_value - abs_value.round()).abs() < tolerance {
            return Fraction::new_raw(sign * abs_value.round() as i64, 1);
        }

        // Continued fraction approximation
        let mut best_num = abs_value.round() as i64;
        let mut best_den = 1i64;
        let mut best_error = (abs_value - best_num as f64).abs();

        for den in 1..=max_iterations {
            let num = (abs_value * den as f64).round() as i64;
            let error = (abs_value - (num as f64 / den as f64)).abs();

            if error < best_error {
                best_num = num;
                best_den = den;
                best_error = error;

                if error < tolerance {
                    break;
                }
            }
        }

        Fraction::new_raw(sign * best_num, best_den)
    }

    /// Add two fractions
    pub fn add(&self, other: &Fraction) -> Fraction {
        Fraction {
            inner: &self.inner + &other.inner,
        }
    }

    /// Subtract two fractions
    pub fn sub(&self, other: &Fraction) -> Fraction {
        Fraction {
            inner: &self.inner - &other.inner,
        }
    }

    /// Multiply two fractions
    pub fn mul(&self, other: &Fraction) -> Fraction {
        Fraction {
            inner: &self.inner * &other.inner,
        }
    }

    /// Divide two fractions
    pub fn div(&self, other: &Fraction) -> Fraction {
        if other.inner.is_zero() {
            // Return 1 for division by zero (matches JS behavior)
            return Fraction::new_raw(1, 1);
        }
        Fraction {
            inner: &self.inner / &other.inner,
        }
    }

    /// Negate the fraction
    pub fn neg(&self) -> Fraction {
        Fraction {
            inner: -&self.inner,
        }
    }

    /// Get the absolute value
    pub fn abs(&self) -> Fraction {
        Fraction {
            inner: self.inner.abs(),
        }
    }

    /// Get the reciprocal (1/x)
    pub fn inverse(&self) -> Fraction {
        if self.inner.is_zero() {
            return Fraction::new_raw(1, 1);
        }
        Fraction {
            inner: self.inner.recip(),
        }
    }

    /// Check if this fraction equals another
    pub fn equals(&self, other: &Fraction) -> bool {
        self.inner == other.inner
    }

    /// Compare this fraction to another
    /// Returns -1 if self < other, 0 if equal, 1 if self > other
    pub fn compare(&self, other: &Fraction) -> i32 {
        match self.inner.cmp(&other.inner) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }

    /// Convert to f64
    #[wasm_bindgen(js_name = toF64)]
    pub fn to_f64(&self) -> f64 {
        self.inner.to_f64().unwrap_or(0.0)
    }

    /// Get the sign (-1, 0, or 1)
    #[wasm_bindgen(getter)]
    pub fn s(&self) -> i32 {
        if self.inner.is_zero() {
            0
        } else if self.inner.is_positive() {
            1
        } else {
            -1
        }
    }

    /// Get the absolute numerator
    #[wasm_bindgen(getter)]
    pub fn n(&self) -> u32 {
        self.inner
            .numer()
            .abs()
            .to_u32()
            .unwrap_or(u32::MAX)
    }

    /// Get the denominator
    #[wasm_bindgen(getter)]
    pub fn d(&self) -> u32 {
        self.inner.denom().to_u32().unwrap_or(u32::MAX)
    }

    /// Get the numerator as a string (for large values)
    #[wasm_bindgen(js_name = numeratorStr)]
    pub fn numerator_str(&self) -> String {
        (self.inner.numer() * self.inner.signum().numer()).to_string()
    }

    /// Get the denominator as a string (for large values)
    #[wasm_bindgen(js_name = denominatorStr)]
    pub fn denominator_str(&self) -> String {
        self.inner.denom().to_string()
    }

    /// Convert to string representation "n/d" or "n" if d=1
    #[wasm_bindgen(js_name = toString)]
    pub fn to_string_repr(&self) -> String {
        let numer = self.inner.numer();
        let denom = self.inner.denom();

        if denom.is_one() {
            numer.to_string()
        } else {
            format!("{}/{}", numer, denom)
        }
    }

    /// Clone this fraction
    #[wasm_bindgen(js_name = clone)]
    pub fn clone_fraction(&self) -> Fraction {
        self.clone()
    }

    /// Check if this is zero
    #[wasm_bindgen(js_name = isZero)]
    pub fn is_zero(&self) -> bool {
        self.inner.is_zero()
    }

    /// Check if this is one
    #[wasm_bindgen(js_name = isOne)]
    pub fn is_one(&self) -> bool {
        self.inner.is_one()
    }

    /// Check if this is negative
    #[wasm_bindgen(js_name = isNegative)]
    pub fn is_negative(&self) -> bool {
        self.inner.is_negative()
    }

    /// Check if this is positive
    #[wasm_bindgen(js_name = isPositive)]
    pub fn is_positive(&self) -> bool {
        self.inner.is_positive()
    }
}

// Implement standard traits

impl Default for Fraction {
    fn default() -> Self {
        Fraction::new_raw(0, 1)
    }
}

impl fmt::Debug for Fraction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Fraction({})", self.to_string_repr())
    }
}

impl fmt::Display for Fraction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_string_repr())
    }
}

impl Add for Fraction {
    type Output = Fraction;

    fn add(self, rhs: Fraction) -> Fraction {
        Fraction {
            inner: self.inner + rhs.inner,
        }
    }
}

impl Sub for Fraction {
    type Output = Fraction;

    fn sub(self, rhs: Fraction) -> Fraction {
        Fraction {
            inner: self.inner - rhs.inner,
        }
    }
}

impl Mul for Fraction {
    type Output = Fraction;

    fn mul(self, rhs: Fraction) -> Fraction {
        Fraction {
            inner: self.inner * rhs.inner,
        }
    }
}

impl Div for Fraction {
    type Output = Fraction;

    fn div(self, rhs: Fraction) -> Fraction {
        Fraction {
            inner: self.inner / rhs.inner,
        }
    }
}

impl Neg for Fraction {
    type Output = Fraction;

    fn neg(self) -> Fraction {
        Fraction { inner: -self.inner }
    }
}

impl From<i32> for Fraction {
    fn from(n: i32) -> Self {
        Fraction::new_raw(n as i64, 1)
    }
}

impl From<i64> for Fraction {
    fn from(n: i64) -> Self {
        Fraction::new_raw(n, 1)
    }
}

impl From<(i32, i32)> for Fraction {
    fn from((n, d): (i32, i32)) -> Self {
        Fraction::new(n, d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_arithmetic() {
        let a = Fraction::new(1, 2);
        let b = Fraction::new(1, 4);

        let sum = (&a).add(&b);
        assert_eq!(sum.to_string_repr(), "3/4");

        let diff = (&a).sub(&b);
        assert_eq!(diff.to_string_repr(), "1/4");

        let prod = (&a).mul(&b);
        assert_eq!(prod.to_string_repr(), "1/8");

        let quot = (&a).div(&b);
        assert_eq!(quot.to_string_repr(), "2");
    }

    #[test]
    fn test_negation() {
        let a = Fraction::new(3, 4);
        let neg_a = a.neg();
        assert_eq!(neg_a.to_string_repr(), "-3/4");
    }

    #[test]
    fn test_from_string() {
        let a = Fraction::from_string("3/4").unwrap();
        assert_eq!(a.to_f64(), 0.75);

        let b = Fraction::from_string("5").unwrap();
        assert_eq!(b.to_f64(), 5.0);
    }

    #[test]
    fn test_from_f64() {
        let a = Fraction::from_f64(0.5);
        assert_eq!(a.to_string_repr(), "1/2");

        let b = Fraction::from_f64(0.25);
        assert_eq!(b.to_string_repr(), "1/4");

        let c = Fraction::from_f64(-1.5);
        assert_eq!(c.to_f64(), -1.5);
    }

    #[test]
    fn test_sign_components() {
        let pos = Fraction::new(3, 4);
        assert_eq!(pos.s(), 1);
        assert_eq!(pos.n(), 3);
        assert_eq!(pos.d(), 4);

        let neg = Fraction::new(-3, 4);
        assert_eq!(neg.s(), -1);
        assert_eq!(neg.n(), 3);
        assert_eq!(neg.d(), 4);

        let zero = Fraction::new(0, 1);
        assert_eq!(zero.s(), 0);
    }

    #[test]
    fn test_auto_reduction() {
        let a = Fraction::new(2, 4);
        assert_eq!(a.to_string_repr(), "1/2");

        let b = Fraction::new(6, 9);
        assert_eq!(b.to_string_repr(), "2/3");
    }

    #[test]
    fn test_division_by_zero() {
        let a = Fraction::new(1, 1);
        let zero = Fraction::new(0, 1);
        let result = (&a).div(&zero);
        // Should return 1 (matching JS behavior)
        assert_eq!(result.to_f64(), 1.0);
    }
}
