//! Numeric value type supporting rational, irrational, and symbolic numbers
//!
//! Provides a Value enum that can hold:
//! - Rational: exact rational (Fraction)
//! - Irrational: f64 approximation (legacy)
//! - Symbolic: algebraic structure preserving base^exponent form
//!
//! This enables multi-base TET scale support via expressions like 2^(1/12), 3^(1/13)
//! while preserving exact rational arithmetic and symbolic form when possible.

use crate::fraction::Fraction;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::fmt;

// ============================================================================
// SymbolicPower - preserves algebraic structure of power expressions
// ============================================================================

/// A single power term: base^exponent where base is a positive integer
#[derive(Clone, Debug)]
pub struct PowerTerm {
    /// Positive integer base (2, 3, 5, etc.)
    pub base: u32,
    /// Rational exponent
    pub exponent: Fraction,
}

/// Represents an irrational value preserving its algebraic structure:
/// value = coefficient × base₁^exp₁ × base₂^exp₂ × ... × baseₙ^expₙ
///
/// This enables mathematical operations like combining like-base powers:
/// 2^(1/12) × 2^(1/12) = 2^(1/6)
#[derive(Clone, Debug)]
pub struct SymbolicPower {
    /// Rational coefficient
    pub coefficient: Fraction,
    /// Array of power terms (base is positive integer)
    pub powers: Vec<PowerTerm>,
}

impl SymbolicPower {
    /// Create a new SymbolicPower
    pub fn new(coefficient: Fraction, powers: Vec<PowerTerm>) -> Self {
        SymbolicPower { coefficient, powers }
    }

    /// Create from a single base^exponent
    pub fn from_power(base: u32, exponent: Fraction) -> Self {
        SymbolicPower {
            coefficient: Fraction::new(1, 1),
            powers: vec![PowerTerm { base, exponent }],
        }
    }

    /// Create from just a rational coefficient (no power terms)
    pub fn from_rational(frac: Fraction) -> Self {
        SymbolicPower {
            coefficient: frac,
            powers: vec![],
        }
    }

    /// Convert to f64 for audio playback/rendering
    pub fn to_f64(&self) -> f64 {
        let mut result = self.coefficient.to_f64();
        for p in &self.powers {
            result *= (p.base as f64).powf(p.exponent.to_f64());
        }
        result
    }

    /// Check if this is purely rational (no irrational power terms)
    pub fn is_rational(&self) -> bool {
        self.powers.is_empty() || self.powers.iter().all(|p| p.exponent.d() == 1)
    }

    /// If rational, convert to Fraction; otherwise return None
    pub fn to_rational_fraction(&self) -> Option<Fraction> {
        if !self.is_rational() {
            return None;
        }

        let mut result = self.coefficient.clone();
        for p in &self.powers {
            // exp.d() is 1, so this is an integer power
            let int_exp = p.exponent.s() * (p.exponent.n() as i32);
            if int_exp >= 0 {
                let base_pow = (p.base as i64).pow(int_exp as u32);
                result = result.mul(&Fraction::new(base_pow as i32, 1));
            } else {
                let base_pow = (p.base as i64).pow((-int_exp) as u32);
                result = result.div(&Fraction::new(base_pow as i32, 1));
            }
        }
        Some(result)
    }

    /// Normalize: sort powers by base, remove zero exponents
    pub fn normalize(mut self) -> Self {
        // Filter out zero exponents
        self.powers.retain(|p| p.exponent.n() != 0);
        // Sort by base
        self.powers.sort_by_key(|p| p.base);
        self
    }

    /// Multiply two SymbolicPower values
    /// Combines like-base powers: base^a × base^b = base^(a+b)
    pub fn mul(&self, other: &SymbolicPower) -> SymbolicPower {
        let new_coeff = self.coefficient.mul(&other.coefficient);

        // Merge power terms, combining like bases
        let mut power_map: std::collections::HashMap<u32, Fraction> = std::collections::HashMap::new();

        for p in &self.powers {
            power_map.insert(p.base, p.exponent.clone());
        }

        for p in &other.powers {
            if let Some(existing) = power_map.get_mut(&p.base) {
                *existing = existing.add(&p.exponent);
            } else {
                power_map.insert(p.base, p.exponent.clone());
            }
        }

        // Filter out zero exponents
        let new_powers: Vec<PowerTerm> = power_map
            .into_iter()
            .filter(|(_, exp)| exp.n() != 0)
            .map(|(base, exponent)| PowerTerm { base, exponent })
            .collect();

        SymbolicPower::new(new_coeff, new_powers).normalize()
    }

    /// Divide by another SymbolicPower
    /// base^a ÷ base^b = base^(a-b)
    pub fn div(&self, other: &SymbolicPower) -> SymbolicPower {
        let new_coeff = self.coefficient.div(&other.coefficient);

        let mut power_map: std::collections::HashMap<u32, Fraction> = std::collections::HashMap::new();

        for p in &self.powers {
            power_map.insert(p.base, p.exponent.clone());
        }

        for p in &other.powers {
            if let Some(existing) = power_map.get_mut(&p.base) {
                *existing = existing.sub(&p.exponent);
            } else {
                // Subtracting: 1 / base^exp = base^(-exp)
                power_map.insert(p.base, p.exponent.neg());
            }
        }

        let new_powers: Vec<PowerTerm> = power_map
            .into_iter()
            .filter(|(_, exp)| exp.n() != 0)
            .map(|(base, exponent)| PowerTerm { base, exponent })
            .collect();

        SymbolicPower::new(new_coeff, new_powers).normalize()
    }

    /// Raise to a rational power
    /// (coeff × base^exp)^n = coeff^n × base^(exp×n)
    pub fn pow(&self, exponent: &Fraction) -> SymbolicPower {
        // Try to compute coefficient^exp as rational
        let new_coeff = if let Some(result) = try_rational_power(&self.coefficient, exponent) {
            result
        } else {
            Fraction::from_f64(self.coefficient.to_f64().powf(exponent.to_f64()))
        };

        let new_powers: Vec<PowerTerm> = self
            .powers
            .iter()
            .map(|p| PowerTerm {
                base: p.base,
                exponent: p.exponent.mul(exponent),
            })
            .collect();

        SymbolicPower::new(new_coeff, new_powers).normalize()
    }

    /// Multiply by a rational Fraction
    pub fn mul_rational(&self, frac: &Fraction) -> SymbolicPower {
        SymbolicPower::new(
            self.coefficient.mul(frac),
            self.powers.clone(),
        )
    }
}

// ============================================================================
// Value enum - the main numeric type
// ============================================================================

/// Represents either a rational, irrational, or symbolic numeric value
#[derive(Clone)]
pub enum Value {
    /// Exact rational number (no precision loss)
    Rational(Fraction),
    /// Irrational number (f64 approximation) - legacy
    Irrational(f64),
    /// Symbolic power expression (preserves algebraic structure)
    Symbolic(SymbolicPower),
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

    /// Create a symbolic value from a SymbolicPower
    pub fn symbolic(sp: SymbolicPower) -> Value {
        Value::Symbolic(sp)
    }

    /// Create from a Fraction
    pub fn from_fraction(f: Fraction) -> Value {
        Value::Rational(f)
    }

    /// Check if this value is corrupted (irrational or symbolic)
    pub fn is_corrupted(&self) -> bool {
        matches!(self, Value::Irrational(_) | Value::Symbolic(_))
    }

    /// Check if this value is rational (not corrupted)
    pub fn is_rational(&self) -> bool {
        matches!(self, Value::Rational(_))
    }

    /// Check if this value is symbolic
    pub fn is_symbolic(&self) -> bool {
        matches!(self, Value::Symbolic(_))
    }

    /// Convert to SymbolicPower (converts rational/irrational to symbolic form)
    pub fn to_symbolic(&self) -> SymbolicPower {
        match self {
            Value::Symbolic(sp) => sp.clone(),
            Value::Rational(f) => SymbolicPower::from_rational(f.clone()),
            Value::Irrational(v) => SymbolicPower::from_rational(Fraction::from_f64(*v)),
        }
    }

    /// Convert to f64 for audio playback
    pub fn to_f64(&self) -> f64 {
        match self {
            Value::Rational(f) => f.to_f64(),
            Value::Irrational(v) => *v,
            Value::Symbolic(sp) => sp.to_f64(),
        }
    }

    /// Try to get the underlying Fraction (returns None if irrational/symbolic)
    pub fn as_fraction(&self) -> Option<&Fraction> {
        match self {
            Value::Rational(f) => Some(f),
            Value::Irrational(_) => None,
            Value::Symbolic(_) => None,
        }
    }

    /// Convert to Fraction (approximates irrational/symbolic values)
    pub fn to_fraction(&self) -> Fraction {
        match self {
            Value::Rational(f) => f.clone(),
            Value::Irrational(v) => Fraction::from_f64(*v),
            Value::Symbolic(sp) => {
                // If symbolic is actually rational, return exact value
                if let Some(rational) = sp.to_rational_fraction() {
                    rational
                } else {
                    Fraction::from_f64(sp.to_f64())
                }
            }
        }
    }

    /// Add two values
    /// Note: Addition of different symbolic forms falls back to irrational
    pub fn add(&self, other: &Value) -> Value {
        match (self, other) {
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.add(b)),
            // Symbolic addition is complex - fall back to irrational for now
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
    /// Preserves symbolic form when possible
    pub fn mul(&self, other: &Value) -> Value {
        match (self, other) {
            // Both rational: stay rational
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.mul(b)),

            // Any symbolic involved: combine symbolically
            (Value::Symbolic(a), Value::Symbolic(b)) => {
                let result = a.mul(b);
                if result.is_rational() {
                    if let Some(rational) = result.to_rational_fraction() {
                        return Value::Rational(rational);
                    }
                }
                Value::Symbolic(result)
            }
            (Value::Symbolic(sp), Value::Rational(f)) | (Value::Rational(f), Value::Symbolic(sp)) => {
                let result = sp.mul_rational(f);
                if result.is_rational() {
                    if let Some(rational) = result.to_rational_fraction() {
                        return Value::Rational(rational);
                    }
                }
                Value::Symbolic(result)
            }

            // Rational * irrational or irrational * irrational: fall back to f64
            _ => Value::Irrational(self.to_f64() * other.to_f64()),
        }
    }

    /// Divide two values
    /// Preserves symbolic form when possible
    pub fn div(&self, other: &Value) -> Value {
        match (self, other) {
            // Both rational: stay rational
            (Value::Rational(a), Value::Rational(b)) => Value::Rational(a.div(b)),

            // Any symbolic involved: divide symbolically
            (Value::Symbolic(a), Value::Symbolic(b)) => {
                let result = a.div(b);
                if result.is_rational() {
                    if let Some(rational) = result.to_rational_fraction() {
                        return Value::Rational(rational);
                    }
                }
                Value::Symbolic(result)
            }
            (Value::Symbolic(sp), Value::Rational(f)) => {
                let result = sp.mul_rational(&f.inverse());
                if result.is_rational() {
                    if let Some(rational) = result.to_rational_fraction() {
                        return Value::Rational(rational);
                    }
                }
                Value::Symbolic(result)
            }
            (Value::Rational(f), Value::Symbolic(sp)) => {
                let num = SymbolicPower::from_rational(f.clone());
                let result = num.div(sp);
                if result.is_rational() {
                    if let Some(rational) = result.to_rational_fraction() {
                        return Value::Rational(rational);
                    }
                }
                Value::Symbolic(result)
            }

            // Fall back to f64
            _ => {
                let divisor = other.to_f64();
                if divisor == 0.0 {
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
            Value::Symbolic(sp) => Value::Symbolic(sp.mul_rational(&Fraction::new(-1, 1))),
        }
    }

    /// Power operation - the key to TET support
    ///
    /// Returns symbolic result to preserve algebraic structure for positive integer bases:
    /// - 2^(2/1) = 4 (rational)
    /// - 2^(1/12) = symbolic (preserves base and exponent)
    /// - 4^(1/2) = 2 (rational, perfect square root)
    pub fn pow(&self, exponent: &Value) -> Value {
        match (self, exponent) {
            (Value::Rational(base), Value::Rational(exp)) => {
                // Check if result can be rational
                if let Some(result) = try_rational_power(base, exp) {
                    return Value::Rational(result);
                }
                // Irrational result: return symbolic for positive integer bases
                let base_val = base.to_f64();
                if base_val > 0.0 && base_val == base_val.floor() && base_val <= (u32::MAX as f64) {
                    return Value::Symbolic(SymbolicPower::from_power(base_val as u32, exp.clone()));
                }
                // Non-integer or negative base: fall back to irrational
                Value::Irrational(base.to_f64().powf(exp.to_f64()))
            }
            // Symbolic base with rational exponent: raise symbolic to power
            (Value::Symbolic(sp), Value::Rational(exp)) => {
                let result = sp.pow(exp);
                if result.is_rational() {
                    if let Some(rational) = result.to_rational_fraction() {
                        return Value::Rational(rational);
                    }
                }
                Value::Symbolic(result)
            }
            // Fall back to irrational for other cases
            _ => Value::Irrational(self.to_f64().powf(exponent.to_f64())),
        }
    }

    /// Get the absolute value
    pub fn abs(&self) -> Value {
        match self {
            Value::Rational(f) => Value::Rational(f.abs()),
            Value::Irrational(v) => Value::Irrational(v.abs()),
            Value::Symbolic(sp) => {
                // For symbolic, if coefficient is negative, negate it
                if sp.coefficient.s() < 0 {
                    Value::Symbolic(sp.mul_rational(&Fraction::new(-1, 1)))
                } else {
                    Value::Symbolic(sp.clone())
                }
            }
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
            Value::Symbolic(sp) => {
                let one = SymbolicPower::from_rational(Fraction::new(1, 1));
                Value::Symbolic(one.div(sp))
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
            Value::Symbolic(sp) => write!(f, "Symbolic({:?})", sp),
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Rational(frac) => write!(f, "{}", frac),
            Value::Irrational(v) => write!(f, "{:.10}", v),
            Value::Symbolic(sp) => {
                write!(f, "{}", sp.coefficient)?;
                for p in &sp.powers {
                    write!(f, " * {}^({}/{})", p.base, p.exponent.s() * (p.exponent.n() as i32), p.exponent.d())?;
                }
                Ok(())
            }
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

/// Simple fraction for serialization (without BigRational overhead)
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SimpleFraction {
    pub s: i32,
    pub n: u32,
    pub d: u32,
}

impl SimpleFraction {
    pub fn from_fraction(f: &Fraction) -> Self {
        SimpleFraction {
            s: f.s(),
            n: f.n(),
            d: f.d(),
        }
    }

    pub fn to_fraction(&self) -> Fraction {
        Fraction::new(self.s * (self.n as i32), self.d as i32)
    }
}

/// Serializable power term for symbolic values
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PowerTermData {
    pub base: u32,
    pub exp: SimpleFraction,
}

/// Serializable symbolic power data
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SymbolicPowerData {
    pub coefficient: SimpleFraction,
    pub powers: Vec<PowerTermData>,
}

impl SymbolicPowerData {
    pub fn from_symbolic(sp: &SymbolicPower) -> Self {
        SymbolicPowerData {
            coefficient: SimpleFraction::from_fraction(&sp.coefficient),
            powers: sp.powers.iter().map(|p| PowerTermData {
                base: p.base,
                exp: SimpleFraction::from_fraction(&p.exponent),
            }).collect(),
        }
    }

    pub fn to_symbolic(&self) -> SymbolicPower {
        SymbolicPower {
            coefficient: self.coefficient.to_fraction(),
            powers: self.powers.iter().map(|p| PowerTerm {
                base: p.base,
                exponent: p.exp.to_fraction(),
            }).collect(),
        }
    }
}

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
    /// Float value (for irrational/symbolic)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f: Option<f64>,
    /// Is this value corrupted (irrational or symbolic)?
    pub corrupted: bool,
    /// Symbolic power data (if symbolic)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbolic: Option<SymbolicPowerData>,
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
                symbolic: None,
            },
            Value::Irrational(val) => ValueData {
                s: None,
                n: None,
                d: None,
                f: Some(*val),
                corrupted: true,
                symbolic: None,
            },
            Value::Symbolic(sp) => ValueData {
                s: None,
                n: None,
                d: None,
                f: Some(sp.to_f64()),  // Include f64 for immediate use
                corrupted: true,
                symbolic: Some(SymbolicPowerData::from_symbolic(sp)),
            },
        }
    }

    /// Convert to a Value
    pub fn to_value(&self) -> Value {
        // Check for symbolic first
        if let Some(symbolic) = &self.symbolic {
            return Value::Symbolic(symbolic.to_symbolic());
        }
        // Then check for corrupted (legacy irrational)
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
            symbolic: None,
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
            symbolic: None,
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

    // ============================================================================
    // Symbolic power tests
    // ============================================================================

    #[test]
    fn test_symbolic_power_creation() {
        let two = Value::rational(2, 1);
        let twelfth = Value::rational(1, 12);

        // 2^(1/12) should return symbolic, not irrational
        let result = two.pow(&twelfth);
        assert!(result.is_symbolic());
        assert!(result.is_corrupted());

        // Value should be correct
        let expected = 2.0_f64.powf(1.0 / 12.0);
        assert!((result.to_f64() - expected).abs() < 1e-10);
    }

    #[test]
    fn test_symbolic_like_base_multiplication() {
        let two = Value::rational(2, 1);
        let twelfth = Value::rational(1, 12);

        // 2^(1/12) * 2^(1/12) = 2^(1/6)
        let semi = two.pow(&twelfth);
        let result = semi.mul(&semi);

        assert!(result.is_symbolic());

        // Verify the exponent was combined: 1/12 + 1/12 = 1/6
        if let Value::Symbolic(sp) = &result {
            assert_eq!(sp.powers.len(), 1);
            assert_eq!(sp.powers[0].base, 2);
            // exponent should be 1/6
            assert_eq!(sp.powers[0].exponent.n(), 1);
            assert_eq!(sp.powers[0].exponent.d(), 6);
        } else {
            panic!("Expected symbolic result");
        }

        // Value should be 2^(1/6)
        let expected = 2.0_f64.powf(1.0 / 6.0);
        assert!((result.to_f64() - expected).abs() < 1e-10);
    }

    #[test]
    fn test_symbolic_multi_base() {
        let two = Value::rational(2, 1);
        let three = Value::rational(3, 1);
        let twelfth = Value::rational(1, 12);
        let thirteenth = Value::rational(1, 13);

        // 2^(1/12) * 3^(1/13) should produce symbolic with two power terms
        let a = two.pow(&twelfth);
        let b = three.pow(&thirteenth);
        let result = a.mul(&b);

        assert!(result.is_symbolic());

        if let Value::Symbolic(sp) = &result {
            assert_eq!(sp.powers.len(), 2);
            // Powers should be sorted by base
            let bases: Vec<u32> = sp.powers.iter().map(|p| p.base).collect();
            assert!(bases.contains(&2));
            assert!(bases.contains(&3));
        } else {
            panic!("Expected symbolic result");
        }

        // Value should be 2^(1/12) * 3^(1/13)
        let expected = 2.0_f64.powf(1.0 / 12.0) * 3.0_f64.powf(1.0 / 13.0);
        assert!((result.to_f64() - expected).abs() < 1e-10);
    }

    #[test]
    fn test_symbolic_cancellation() {
        let two = Value::rational(2, 1);
        let twelfth = Value::rational(1, 12);
        let neg_twelfth = Value::rational(-1, 12);

        // 2^(1/12) * 2^(-1/12) = 1 (should become rational)
        let a = two.pow(&twelfth);
        let b = two.pow(&neg_twelfth);
        let result = a.mul(&b);

        // Should reduce to rational 1
        assert!(result.is_rational());
        assert!((result.to_f64() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_symbolic_data_roundtrip() {
        let two = Value::rational(2, 1);
        let twelfth = Value::rational(1, 12);

        let symbolic = two.pow(&twelfth);
        let data = ValueData::from_value(&symbolic);

        // Should have symbolic data
        assert!(data.symbolic.is_some());
        assert!(data.corrupted);

        // Roundtrip should preserve symbolic form
        let recovered = data.to_value();
        assert!(recovered.is_symbolic());

        if let (Value::Symbolic(orig), Value::Symbolic(recov)) = (&symbolic, &recovered) {
            assert_eq!(orig.powers.len(), recov.powers.len());
            assert_eq!(orig.powers[0].base, recov.powers[0].base);
            assert!((orig.to_f64() - recov.to_f64()).abs() < 1e-10);
        }
    }

    #[test]
    fn test_symbolic_rational_multiplication() {
        let two = Value::rational(2, 1);
        let twelfth = Value::rational(1, 12);
        let five = Value::rational(5, 1);

        // 5 * 2^(1/12) should give symbolic with coefficient 5
        let symbolic = two.pow(&twelfth);
        let result = five.mul(&symbolic);

        assert!(result.is_symbolic());

        if let Value::Symbolic(sp) = &result {
            assert_eq!(sp.coefficient.to_f64(), 5.0);
            assert_eq!(sp.powers.len(), 1);
            assert_eq!(sp.powers[0].base, 2);
        }

        let expected = 5.0 * 2.0_f64.powf(1.0 / 12.0);
        assert!((result.to_f64() - expected).abs() < 1e-10);
    }
}
