//! Numeric value type supporting both rational and irrational numbers
//!
//! Provides a Value enum that can hold either an exact rational (Fraction)
//! or an irrational approximation (f64). This enables TET scale support
//! via expressions like 2^(1/12) while preserving exact rational arithmetic
//! when possible.

use crate::fraction::Fraction;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Represents either a rational or irrational numeric value
#[derive(Clone)]
pub enum Value {
    /// Exact rational number (no precision loss)
    Rational(Fraction),
    /// Irrational number (f64 approximation)
    Irrational(f64),
}

impl Value {
    /// Create a rational value from numerator and denominator
    pub fn rational(num: i32, den: i32) -> Value {
        Value::Rational(Fraction::new(num, den))
    }

    /// Create an irrational value from f64
    pub fn irrational(v: f64) -> Value {
        Value::Irrational(v)
    }

    /// Create from a Fraction
    pub fn from_fraction(f: Fraction) -> Value {
        Value::Rational(f)
    }

    /// Check if this value is corrupted (irrational)
    pub fn is_corrupted(&self) -> bool {
        matches!(self, Value::Irrational(_))
    }

    /// Check if this value is rational (not corrupted)
    pub fn is_rational(&self) -> bool {
        matches!(self, Value::Rational(_))
    }

    /// Convert to f64 for audio playback
    pub fn to_f64(&self) -> f64 {
        match self {
            Value::Rational(f) => f.to_f64(),
            Value::Irrational(v) => *v,
        }
    }

    /// Try to get the underlying Fraction (returns None if irrational)
    pub fn as_fraction(&self) -> Option<&Fraction> {
        match self {
            Value::Rational(f) => Some(f),
            Value::Irrational(_) => None,
        }
    }

    /// Add two values
    pub fn add(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.add(b)),
            // Any irrational operand corrupts the result
            _ => Value::Irrational(self.to_f64() + other.to_f64()),
        }
    }

    /// Subtract two values
    pub fn sub(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.sub(b)),
            _ => Value::Irrational(self.to_f64() - other.to_f64()),
        }
    }

    /// Multiply two values
    pub fn mul(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.mul(b)),
            _ => Value::Irrational(self.to_f64() * other.to_f64()),
        }
    }

    /// Divide two values
    pub fn div(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.div(b)),
            _ => {
                let divisor = other.to_f64();
                if divisor == 0.0 {
                    // Match Fraction behavior: return 1 for division by zero
                    Value::Rational(Fraction::new(1, 1))
                } else {
                    Value::Irrational(self.to_f64() / divisor)
                }
            }
        }
    }

    /// Negate the value
    pub fn neg(&self) -> Value {
        match self {
            Value::Rational(f) => Value::Rational(f.neg()),
            Value::Irrational(v) => Value::Irrational(-v),
        }
    }

    /// Power operation - the key to TET support
    ///
    /// Attempts to preserve rationality when possible:
    /// - 2^(2/1) = 4 (rational)
    /// - 2^(1/12) = irrational (corrupted)
    /// - 4^(1/2) = 2 (rational, perfect square root)
    pub fn pow(&self, exponent: &Value) -> Value {
        match (self, exponent) {
            (Value::Rational(base), Value::Rational(exp)) => {
                // Check if result can be rational
                if let Some(result) = try_rational_power(base, exp) {
                    Value::Rational(result)
                } else {
                    // Irrational result (e.g., 2^(1/12))
                    Value::Irrational(base.to_f64().powf(exp.to_f64()))
                }
            }
            // Any irrational input -> irrational output
            _ => Value::Irrational(self.to_f64().powf(exponent.to_f64())),
        }
    }

    /// Get the absolute value
    pub fn abs(&self) -> Value {
        match self {
            Value::Rational(f) => Value::Rational(f.abs()),
            Value::Irrational(v) => Value::Irrational(v.abs()),
        }
    }

    /// Get the reciprocal (1/x)
    pub fn inverse(&self) -> Value {
        match self {
            Value::Rational(f) => Value::Rational(f.inverse()),
            Value::Irrational(v) => {
                if *v == 0.0 {
                    Value::Rational(Fraction::new(1, 1))
                } else {
                    Value::Irrational(1.0 / v)
                }
            }
        }
    }
}

/// Try to compute base^(num/den) as a rational if possible
fn try_rational_power(base: &Fraction, exp: &Fraction) -> Option<Fraction> {
    let exp_num = exp.as_big_rational().numer().to_i64()?;
    let exp_den = exp.as_big_rational().denom().to_i64()?;

    // Zero exponent: always 1
    if exp_num == 0 {
        return Some(Fraction::new(1, 1));
    }

    // Integer exponent: always rational
    if exp_den == 1 {
        return Some(rational_int_power(base, exp_num));
    }

    // Fractional exponent: check for perfect n-th root
    // base^(p/q) = (base^p)^(1/q)
    let base_powered = rational_int_power(base, exp_num);
    try_perfect_nth_root(&base_powered, exp_den as u64)
}

/// Compute base^n for integer n (negative n gives reciprocal)
fn rational_int_power(base: &Fraction, n: i64) -> Fraction {
    if n == 0 {
        return Fraction::new(1, 1);
    }

    let abs_n = n.unsigned_abs();
    let mut result = Fraction::new(1, 1);

    // Use repeated squaring for efficiency
    let mut current = base.clone();
    let mut remaining = abs_n;

    while remaining > 0 {
        if remaining & 1 == 1 {
            result = result.mul(&current);
        }
        current = current.mul(&current);
        remaining >>= 1;
    }

    if n < 0 {
        result.inverse()
    } else {
        result
    }
}

/// Check if `value` has a perfect n-th root that is rational
fn try_perfect_nth_root(value: &Fraction, n: u64) -> Option<Fraction> {
    if n == 0 {
        return None;
    }
    if n == 1 {
        return Some(value.clone());
    }

    let num = value.as_big_rational().numer().to_i64()?;
    let den = value.as_big_rational().denom().to_i64()?;

    let num_abs = num.unsigned_abs();
    let den_abs = den.unsigned_abs();

    let num_root = integer_nth_root(num_abs, n)?;
    let den_root = integer_nth_root(den_abs, n)?;

    // Verify it's exact
    if num_root.pow(n as u32) == num_abs && den_root.pow(n as u32) == den_abs {
        // Handle sign: odd roots preserve sign, even roots of negatives are not real
        let sign = if num < 0 {
            if n % 2 == 1 {
                -1i64
            } else {
                return None; // Even root of negative is not real
            }
        } else {
            1i64
        };
        Some(Fraction::new_raw(sign * num_root as i64, den_root as i64))
    } else {
        None
    }
}

/// Integer n-th root if exact, None otherwise
fn integer_nth_root(value: u64, n: u64) -> Option<u64> {
    if value == 0 {
        return Some(0);
    }
    if value == 1 || n == 1 {
        return Some(value);
    }

    // Use floating point approximation, then verify
    let root = (value as f64).powf(1.0 / n as f64).round() as u64;

    // Check root and neighbors (floating point might be slightly off)
    for candidate in root.saturating_sub(1)..=root.saturating_add(1) {
        if candidate.checked_pow(n as u32) == Some(value) {
            return Some(candidate);
        }
    }

    None
}

impl Default for Value {
    fn default() -> Self {
        Value::Rational(Fraction::new(0, 1))
    }
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Rational(frac) => write!(f, "Rational({})", frac),
            Value::Irrational(v) => write!(f, "Irrational({})", v),
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Rational(frac) => write!(f, "{}", frac),
            Value::Irrational(v) => write!(f, "{:.10}", v),
        }
    }
}

impl From<Fraction> for Value {
    fn from(f: Fraction) -> Self {
        Value::Rational(f)
    }
}

impl From<f64> for Value {
    fn from(v: f64) -> Self {
        Value::Irrational(v)
    }
}

impl From<i32> for Value {
    fn from(n: i32) -> Self {
        Value::Rational(Fraction::new(n, 1))
    }
}

// ============================================================================
// Serialization support for WASM interop
// ============================================================================

/// Serializable value data for JS interop
#[derive(Clone, Serialize, Deserialize)]
pub struct ValueData {
    /// Sign: -1, 0, or 1 (for rational)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub s: Option<i32>,
    /// Absolute numerator (for rational)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
    /// Denominator (for rational)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub d: Option<u32>,
    /// Float value (for irrational)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f: Option<f64>,
    /// Is this value corrupted (irrational)?
    pub corrupted: bool,
}

impl ValueData {
    /// Create from a Value
    pub fn from_value(v: &Value) -> Self {
        match v {
            Value::Rational(frac) => ValueData {
                s: Some(frac.s()),
                n: Some(frac.n()),
                d: Some(frac.d()),
                f: None,
                corrupted: false,
            },
            Value::Irrational(val) => ValueData {
                s: None,
                n: None,
                d: None,
                f: Some(*val),
                corrupted: true,
            },
        }
    }

    /// Convert to a Value
    pub fn to_value(&self) -> Value {
        if self.corrupted {
            Value::Irrational(self.f.unwrap_or(0.0))
        } else if let (Some(s), Some(n), Some(d)) = (self.s, self.n, self.d) {
            let num = s * (n as i32);
            Value::Rational(Fraction::new(num, d as i32))
        } else {
            Value::default()
        }
    }

    /// Convert to f64
    pub fn to_f64(&self) -> f64 {
        if let Some(f) = self.f {
            f
        } else if let (Some(s), Some(n), Some(d)) = (self.s, self.n, self.d) {
            (s as f64) * (n as f64) / (d as f64)
        } else {
            0.0
        }
    }

    /// Create from a Fraction (for backward compatibility)
    pub fn from_fraction(f: &Fraction) -> Self {
        ValueData {
            s: Some(f.s()),
            n: Some(f.n()),
            d: Some(f.d()),
            f: None,
            corrupted: false,
        }
    }

    /// Convert to Fraction (returns default if corrupted)
    pub fn to_fraction(&self) -> Fraction {
        if let (Some(s), Some(n), Some(d)) = (self.s, self.n, self.d) {
            let num = s * (n as i32);
            Fraction::new(num, d as i32)
        } else {
            // For irrational values, approximate as fraction
            Fraction::from_f64(self.f.unwrap_or(0.0))
        }
    }
}

impl Default for ValueData {
    fn default() -> Self {
        ValueData {
            s: Some(0),
            n: Some(0),
            d: Some(1),
            f: None,
            corrupted: false,
        }
    }
}

// ============================================================================
// Corruption flag constants
// ============================================================================

/// Corruption flag for startTime property
pub const CORRUPT_START_TIME: u8 = 0x01;
/// Corruption flag for duration property
pub const CORRUPT_DURATION: u8 = 0x02;
/// Corruption flag for frequency property
pub const CORRUPT_FREQUENCY: u8 = 0x04;
/// Corruption flag for tempo property
pub const CORRUPT_TEMPO: u8 = 0x08;
/// Corruption flag for beatsPerMeasure property
pub const CORRUPT_BEATS_PER_MEASURE: u8 = 0x10;
/// Corruption flag for measureLength property
pub const CORRUPT_MEASURE_LENGTH: u8 = 0x20;

/// Get corruption flag for a variable index
pub fn corruption_flag_for_var(var_index: u8) -> u8 {
    match var_index {
        0 => CORRUPT_START_TIME,
        1 => CORRUPT_DURATION,
        2 => CORRUPT_FREQUENCY,
        3 => CORRUPT_TEMPO,
        4 => CORRUPT_BEATS_PER_MEASURE,
        5 => CORRUPT_MEASURE_LENGTH,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rational_operations() {
        let a = Value::rational(1, 2);
        let b = Value::rational(1, 4);

        // Add
        let sum = a.add(&b);
        assert!(sum.is_rational());
        assert!((sum.to_f64() - 0.75).abs() < 1e-10);

        // Multiply
        let prod = a.mul(&b);
        assert!(prod.is_rational());
        assert!((prod.to_f64() - 0.125).abs() < 1e-10);
    }

    #[test]
    fn test_irrational_contamination() {
        let rational = Value::rational(2, 1);
        let irrational = Value::irrational(std::f64::consts::PI);

        // Rational + irrational = irrational
        let result = rational.add(&irrational);
        assert!(result.is_corrupted());
    }

    #[test]
    fn test_integer_power() {
        let two = Value::rational(2, 1);
        let exp = Value::rational(3, 1);

        // 2^3 = 8 (rational)
        let result = two.pow(&exp);
        assert!(result.is_rational());
        assert!((result.to_f64() - 8.0).abs() < 1e-10);
    }

    #[test]
    fn test_perfect_square_root() {
        let four = Value::rational(4, 1);
        let half = Value::rational(1, 2);

        // 4^(1/2) = 2 (rational, perfect square root)
        let result = four.pow(&half);
        assert!(result.is_rational());
        assert!((result.to_f64() - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_imperfect_square_root() {
        let two = Value::rational(2, 1);
        let half = Value::rational(1, 2);

        // 2^(1/2) = sqrt(2) (irrational)
        let result = two.pow(&half);
        assert!(result.is_corrupted());
        assert!((result.to_f64() - std::f64::consts::SQRT_2).abs() < 1e-10);
    }

    #[test]
    fn test_tet_semitone() {
        let two = Value::rational(2, 1);
        let twelfth = Value::rational(1, 12);

        // 2^(1/12) for 12-TET semitone (irrational)
        let result = two.pow(&twelfth);
        assert!(result.is_corrupted());

        // Should be approximately 1.059463...
        let expected = 2.0_f64.powf(1.0 / 12.0);
        assert!((result.to_f64() - expected).abs() < 1e-10);
    }

    #[test]
    fn test_perfect_cube_root() {
        let eight = Value::rational(8, 1);
        let third = Value::rational(1, 3);

        // 8^(1/3) = 2 (rational, perfect cube root)
        let result = eight.pow(&third);
        assert!(result.is_rational());
        assert!((result.to_f64() - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_negative_exponent() {
        let two = Value::rational(2, 1);
        let neg_two = Value::rational(-2, 1);

        // 2^(-2) = 1/4 (rational)
        let result = two.pow(&neg_two);
        assert!(result.is_rational());
        assert!((result.to_f64() - 0.25).abs() < 1e-10);
    }

    #[test]
    fn test_zero_exponent() {
        let any = Value::rational(123, 456);
        let zero = Value::rational(0, 1);

        // x^0 = 1 (rational)
        let result = any.pow(&zero);
        assert!(result.is_rational());
        assert!((result.to_f64() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_value_data_roundtrip() {
        let rational = Value::rational(3, 4);
        let data = ValueData::from_value(&rational);
        let recovered = data.to_value();
        assert!(recovered.is_rational());
        assert!((recovered.to_f64() - 0.75).abs() < 1e-10);

        let irrational = Value::irrational(std::f64::consts::E);
        let data = ValueData::from_value(&irrational);
        let recovered = data.to_value();
        assert!(recovered.is_corrupted());
        assert!((recovered.to_f64() - std::f64::consts::E).abs() < 1e-10);
    }

    #[test]
    fn test_integer_nth_root() {
        assert_eq!(integer_nth_root(8, 3), Some(2)); // cube root of 8
        assert_eq!(integer_nth_root(16, 4), Some(2)); // 4th root of 16
        assert_eq!(integer_nth_root(27, 3), Some(3)); // cube root of 27
        assert_eq!(integer_nth_root(10, 2), None); // sqrt(10) is not integer
    }
}
