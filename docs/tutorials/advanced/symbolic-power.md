# SymbolicPower Algebra

Understanding how RMT Compose handles irrational numbers like 2^(1/12) with full algebraic precision.

## The Problem with Irrational Numbers

Equal temperament tuning produces irrational numbers. For example:

```
12-TET semitone = 2^(1/12) = 1.0594630943592953...
```

This number cannot be exactly represented as a fraction or floating-point number. If we just used floats:

```javascript
// Float multiplication loses precision
const semitone = Math.pow(2, 1/12)  // 1.0594630943592953
const octave = semitone ** 12       // 1.9999999999999998 (not exactly 2!)
```

## SymbolicPower: Algebraic Precision

RMT Compose uses `SymbolicPower` to preserve the algebraic structure of expressions.

### How It Works

Instead of computing `2^(1/12)` as a float, SymbolicPower stores:
- **Base**: 2
- **Exponent**: 1/12

This representation is exact and allows perfect algebraic simplification.

### Automatic Simplification

```javascript
// 2^(1/12) × 2^(1/12) = 2^(2/12) = 2^(1/6)
// Exponents add: 1/12 + 1/12 = 2/12 = 1/6

// Full octave: (2^(1/12))^12 = 2^1 = 2 (exactly!)
```

RMT Compose handles this automatically when you chain TET operations.

## Creating SymbolicPower Values

### Basic Syntax

```
// 2 to the power of 1/12
2^(1/12)

// 3 to the power of 1/13 (Bohlen-Pierce)
3^(1/13)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// 2 to the power of 1/12
new Fraction(2).pow(new Fraction(1, 12))

// 3 to the power of 1/13 (Bohlen-Pierce)
new Fraction(3).pow(new Fraction(1, 13))
```

</details>

### Chained Operations

```
// Major third in 12-TET (4 semitones)
base.f * 2^(4/12)

// Same result, built step by step
base.f * 2^(1/12) * 2^(1/12) * 2^(1/12) * 2^(1/12)
```

Both produce exactly `2^(4/12) = 2^(1/3)`.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Major third in 12-TET (4 semitones)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(4, 12)))

// Same result, built step by step
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 12)))
  .mul(new Fraction(2).pow(new Fraction(1, 12)))
  .mul(new Fraction(2).pow(new Fraction(1, 12)))
  .mul(new Fraction(2).pow(new Fraction(1, 12)))
```

</details>

## Algebraic Rules Applied

### Multiplication

When multiplying SymbolicPower values with the same base:

```
a^m × a^n = a^(m+n)

// Example: 2^(1/12) × 2^(3/12) = 2^(4/12)
2^(1/12) * 2^(3/12)
```

### Division

```
a^m ÷ a^n = a^(m-n)

// Going down a semitone
frequency / 2^(1/12)
// = frequency × 2^(-1/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency.div(new Fraction(2).pow(new Fraction(1, 12)))
```

</details>

### Power of Power

```
(a^m)^n = a^(m×n)
```

```javascript
// Octave check: (2^(1/12))^12 = 2^1 = 2
```

### Mixed Operations with Fractions

SymbolicPower values can multiply with regular fractions:

```
// 440 × 2^(7/12) = 659.25... Hz (perfect fifth in 12-TET)
440 * 2^(7/12)
```

The system tracks both components:
- Rational part: 440
- Irrational part: 2^(7/12)

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(440).mul(new Fraction(2).pow(new Fraction(7, 12)))
```

</details>

## The ≈ Display

When a value contains SymbolicPower components, the Variable Widget shows:

```
≈ 659.26 Hz
```

The ≈ indicates:
1. The displayed number is an approximation
2. The actual stored value is algebraically exact
3. Further calculations use the exact symbolic form

## Why This Matters

### Scenario: Building a Full Chromatic Scale

Without SymbolicPower:
```javascript
// Float accumulation error
let freq = 440
for (let i = 0; i < 12; i++) {
  freq *= 1.0594630943592953
}
// freq = 879.9999999999999 (not exactly 880!)
```

With SymbolicPower:
```javascript
// Algebraic precision
// 440 × (2^(1/12))^12 = 440 × 2 = 880 exactly
```

### Scenario: Transposition

When transposing a melody:
```
// Transpose up a major third (4 semitones)
originalFreq * 2^(4/12)
```

The system preserves relationships:
```
If note1 = 440 × 2^(3/12)
And note2 = note1 × 2^(4/12)
Then note2 = 440 × 2^(7/12)  // Exact!
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
originalFreq.mul(new Fraction(2).pow(new Fraction(4, 12)))
```

</details>

## Advanced: Different Bases

### Bohlen-Pierce (Base 3)

```
// Tritave (3:1) divided into 13 parts
3^(1/13)
```

SymbolicPower handles any integer base:
- Base 2: Standard octave-based temperaments
- Base 3: Tritave-based scales like Bohlen-Pierce
- Other bases: Experimental tuning systems

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(3).pow(new Fraction(1, 13))
```

</details>

### Combining Different Bases

When multiplying different bases, the system tracks them separately:

```javascript
// 2^(1/12) × 3^(1/13) - tracked as compound symbolic value
```

## Internal Representation

For developers, here's how SymbolicPower works internally:

### Structure

```javascript
{
  type: 'symbolic_power',
  base: Fraction(2),      // The base number
  exponent: Fraction(1, 12),  // The exponent
  coefficient: Fraction(440)  // Optional rational multiplier
}
```

### Evaluation Pipeline

1. **Parse**: Expression text → AST
2. **Compile**: AST → Bytecode (SymbolicPower opcodes)
3. **Evaluate**: Stack VM evaluates, preserving symbolic structure
4. **Display**: Evaluate to float only for final display

### Bytecode Operations

The binary evaluator has specific opcodes for symbolic operations:
- `POW`: Creates SymbolicPower from base and exponent
- `MUL_SYM`: Multiplies preserving symbolic structure
- `DIV_SYM`: Divides preserving symbolic structure

## Practical Examples

### 12-TET Scale with Perfect Octave

```
// Root
frequency: base.f

// Each subsequent note adds one semitone
// Note N: frequency × 2^(N/12)

// After 12 notes, we get:
frequency: base.f * 2^(12/12)
// = baseFreq × 2 (exactly one octave, no drift!)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Root
frequency: module.baseNote.getVariable('frequency')

// Each subsequent note adds one semitone
// Note N: frequency × 2^(N/12)

// After 12 notes, we get:
frequency: module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(12, 12)))
// = baseFreq × 2 (exactly one octave, no drift!)
```

</details>

### Stacking Fifths

```javascript
// Perfect fifth in 12-TET = 7 semitones
// Stack 12 fifths: (2^(7/12))^12 = 2^7 = 128 (7 octaves exactly)

// But musically, 12 pure fifths = (3/2)^12 = 129.746...
// The Pythagorean comma! 12-TET eliminates this by distributing the error.
```

### Verification

Test that 12 semitones = 1 octave:

```
// Build note 12 semitones up
base.f * 2^(12/12)

// This simplifies to:
// baseFreq × 2^1 = baseFreq × 2

// The evaluated value will be exactly 2× the base frequency
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
const twelveUp = module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(12, 12)))
```

</details>

## Limitations

### What SymbolicPower Handles

- Powers of integers: `2^(1/12)`, `3^(1/13)`
- Products of symbolic powers
- Mixed rational and irrational values

### What Requires Approximation

- Addition of irrational values: `2^(1/12) + 2^(1/19)` (no closed form)
- Transcendental operations on symbolic values
- Nested irrational exponents

For these cases, the system falls back to high-precision float approximation.

## Debugging Tips

### Check Symbolic Preservation

1. Create a note with TET expression
2. Look for ≈ in the display
3. Chain 12 semitones and verify exact octave

### Verify Algebraic Simplification

```
// This should display exactly 2× the base frequency
frequency: base.f * 2^(1/12) * 2^(1/12) * ... // (repeat 12 times)
// Or simply:
frequency: base.f * 2^(12/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
frequency: module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 12)))
  .mul(new Fraction(2).pow(new Fraction(1, 12)))
  // ... (repeat 12 times)
```

</details>

## Next Steps

- [Complex Dependencies](/tutorials/advanced/complex-dependencies) - Build sophisticated note relationships
- [Microtonal Composition](/tutorials/advanced/microtonal) - Apply symbolic algebra to microtonal music
- [Expression Compiler](/developer/core/expression-compiler) - Technical deep dive

