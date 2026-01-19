# SymbolicPower

**SymbolicPower** represents irrational numbers (like 2^(1/12)) algebraically, preserving their mathematical structure through arithmetic operations.

## The Problem

Equal temperament systems require irrational frequencies:

```javascript
// 12-TET semitone = 2^(1/12)
Math.pow(2, 1/12) = 1.0594630943592953
```

If we store this as a float:
- Precision lost after many operations
- 12 semitones ≠ exactly 2 (drift)
- Cannot distinguish 2^(1/12) from 2^(2/24)

If we try Fraction approximation:
- 2^(1/12) ≈ 196/185 (terrible approximation)
- Gets worse with multiplication

## The Solution

Store the **algebraic form**, not the numeric value:

```javascript
// Instead of: 1.0594630943592953
// Store: { coefficient: 1, powers: [{base: 2, exp: 1/12}] }

class SymbolicPower {
  coefficient: Fraction;  // Rational multiplier
  powers: Power[];        // Array of {base, exponent} pairs
}
```

## Class Structure

```javascript
class SymbolicPower {
  constructor(coefficient, powers) {
    this.coefficient = coefficient;  // Fraction
    this.powers = powers;            // [{base: number, exponent: Fraction}]
  }

  // Factory for power expressions
  static fromPower(base, exponent) {
    return new SymbolicPower(
      new Fraction(1),
      [{ base, exponent }]
    );
  }

  // Factory for rational values
  static fromFraction(fraction) {
    return new SymbolicPower(fraction, []);
  }
}
```

## Arithmetic Operations

### Multiplication

When multiplying, combine like bases:

```javascript
// 2^(1/12) × 2^(1/12)
//   = 2^(1/12 + 1/12)
//   = 2^(2/12)
//   = 2^(1/6)

mul(other) {
  // Multiply coefficients
  const newCoeff = this.coefficient.mul(other.coefficient);

  // Combine powers
  const newPowers = new Map();

  for (const p of this.powers) {
    const existing = newPowers.get(p.base) || new Fraction(0);
    newPowers.set(p.base, existing.add(p.exponent));
  }

  for (const p of other.powers) {
    const existing = newPowers.get(p.base) || new Fraction(0);
    newPowers.set(p.base, existing.add(p.exponent));
  }

  // Convert back to array, removing zero exponents
  const powers = [];
  for (const [base, exp] of newPowers) {
    if (!exp.equals(0)) {
      powers.push({ base, exponent: exp });
    }
  }

  return new SymbolicPower(newCoeff, powers);
}
```

### Division

Subtract exponents:

```javascript
// 2^(5/12) ÷ 2^(3/12) = 2^(2/12) = 2^(1/6)

div(other) {
  // Equivalent to multiply by inverse
  const inverseCoeff = new Fraction(1).div(other.coefficient);
  const inversePowers = other.powers.map(p => ({
    base: p.base,
    exponent: p.exponent.neg()
  }));
  const inverse = new SymbolicPower(inverseCoeff, inversePowers);
  return this.mul(inverse);
}
```

### Resolving to Rational

If all exponents sum to integers, the result is rational:

```javascript
// 2^(1/12) × 2^(11/12) = 2^(12/12) = 2^1 = 2

simplify() {
  let coeff = this.coefficient;
  const remainingPowers = [];

  for (const p of this.powers) {
    if (p.exponent.d === 1) {
      // Integer exponent: can compute exactly
      coeff = coeff.mul(new Fraction(Math.pow(p.base, p.exponent.n)));
    } else {
      remainingPowers.push(p);
    }
  }

  return new SymbolicPower(coeff, remainingPowers);
}
```

## Example: 12-TET Octave

```javascript
// Start with one semitone
const semitone = SymbolicPower.fromPower(2, new Fraction(1, 12));
// { coefficient: 1, powers: [{base: 2, exponent: 1/12}] }

// Multiply 12 times
let octave = semitone;
for (let i = 1; i < 12; i++) {
  octave = octave.mul(semitone);
}

// Result:
// { coefficient: 1, powers: [{base: 2, exponent: 12/12}] }

// Simplify:
octave = octave.simplify();
// { coefficient: 2, powers: [] }

// It's exactly 2! No floating-point drift.
```

## Multi-Base Support

Different TET systems can coexist:

```javascript
// 12-TET third: 2^(4/12)
const tetThird = SymbolicPower.fromPower(2, new Fraction(4, 12));

// Bohlen-Pierce: 3^(1/13)
const bpStep = SymbolicPower.fromPower(3, new Fraction(1, 13));

// Combine them
const combined = tetThird.mul(bpStep);
// { coefficient: 1, powers: [
//     {base: 2, exponent: 1/3},
//     {base: 3, exponent: 1/13}
// ]}
```

Bases are kept separate because they can't be combined algebraically.

## Numeric Approximation

For display and audio, convert to decimal:

```javascript
valueOf() {
  let value = this.coefficient.valueOf();
  for (const p of this.powers) {
    value *= Math.pow(p.base, p.exponent.valueOf());
  }
  return value;
}

// 2^(1/12).valueOf() ≈ 1.0594630943592953
```

## Corruption Tracking

When a SymbolicPower has non-empty `powers`, it's "corrupted" (irrational):

```javascript
isCorrupted() {
  return this.powers.length > 0;
}
```

The evaluator sets corruption flags:

```javascript
const CORRUPT = {
  START_TIME:       0x01,
  DURATION:         0x02,
  FREQUENCY:        0x04,
  TEMPO:            0x08,
  BEATS_PER_MEASURE: 0x10,
  MEASURE_LENGTH:   0x20,
};
```

Notes with corrupted frequency display the **≈** prefix.

## Rust Implementation

The WASM version mirrors this in Rust:

```rust
// rust/src/value.rs

pub struct SymbolicPower {
    pub coefficient: Fraction,
    pub powers: Vec<Power>,
}

pub struct Power {
    pub base: i64,
    pub exponent: Fraction,
}

impl SymbolicPower {
    pub fn mul(&self, other: &SymbolicPower) -> SymbolicPower {
        // Same algorithm as JavaScript
    }
}
```

## Performance

SymbolicPower operations are more expensive than Fraction:

| Operation | Fraction | SymbolicPower |
|-----------|----------|---------------|
| Multiply | ~100ns | ~500ns |
| Memory | 24 bytes | ~80 bytes |

But the algebraic preservation is worth it for:
- Exact TET arithmetic
- No accumulating drift
- Proper 12-note octave closure

## Use Cases

### TET Scales

```javascript
// Create 12-TET chromatic scale
const step = SymbolicPower.fromPower(2, new Fraction(1, 12));
let freq = SymbolicPower.fromFraction(new Fraction(440));

for (let i = 0; i < 12; i++) {
  notes.push(freq);
  freq = freq.mul(step);
}
// notes[12] = 880 exactly
```

### Bohlen-Pierce

```javascript
// 13 equal divisions of tritave (3:1)
const bpStep = SymbolicPower.fromPower(3, new Fraction(1, 13));
```

### Custom Systems

```javascript
// 31-TET for better thirds
const step31 = SymbolicPower.fromPower(2, new Fraction(1, 31));

// 53-TET for near-perfect fifths
const step53 = SymbolicPower.fromPower(2, new Fraction(1, 53));
```

## See Also

- [Equal Temperament](/user-guide/tuning/equal-temperament) - User documentation
- [Binary Evaluator](./binary-evaluator) - How SymbolicPower is created
- [Custom TET](/user-guide/tuning/custom-tet) - Creating custom systems
