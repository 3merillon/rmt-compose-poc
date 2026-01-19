# Expression Syntax

Complete reference for the RMT Compose expression language.

## Overview

Expressions are JavaScript-like formulas that define note properties. They compile to binary bytecode for efficient evaluation.

## Constants

### Integer

```javascript
new Fraction(440)    // 440/1
new Fraction(0)      // 0/1
new Fraction(-5)     // -5/1
```

### Fraction

```javascript
new Fraction(3, 2)   // 3/2
new Fraction(5, 4)   // 5/4
new Fraction(-1, 4)  // -1/4
```

### Large Numbers

For very large or precise values:

```javascript
new Fraction(123456789, 987654321)
```

Arbitrary precision is supported via BigInt internally.

## References

### BaseNote Reference

```javascript
module.baseNote.getVariable('frequency')
module.baseNote.getVariable('startTime')
module.baseNote.getVariable('duration')
module.baseNote.getVariable('tempo')
module.baseNote.getVariable('beatsPerMeasure')
```

### Note Reference

```javascript
module.getNoteById(1).getVariable('frequency')
module.getNoteById(5).getVariable('startTime')
module.getNoteById(10).getVariable('duration')
```

The note ID must be a positive integer matching an existing note.

## Arithmetic Operations

### Addition

```javascript
a.add(b)

// Examples
new Fraction(1).add(new Fraction(2))  // 3
module.baseNote.getVariable('startTime').add(new Fraction(1))
```

### Subtraction

```javascript
a.sub(b)

// Examples
new Fraction(5).sub(new Fraction(2))  // 3
module.getNoteById(3).getVariable('startTime').sub(new Fraction(0.5))
```

### Multiplication

```javascript
a.mul(b)

// Examples
new Fraction(3).mul(new Fraction(2))  // 6
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))  // Fifth
```

### Division

```javascript
a.div(b)

// Examples
new Fraction(6).div(new Fraction(2))  // 3
new Fraction(60).div(module.findTempo(module.baseNote))  // Beat duration
```

### Negation

```javascript
a.neg()

// Examples
new Fraction(5).neg()  // -5
```

### Power

```javascript
a.pow(b)

// Examples
new Fraction(2).pow(new Fraction(3))     // 8 (2³)
new Fraction(2).pow(new Fraction(1, 2))  // √2 ≈ 1.414
new Fraction(2).pow(new Fraction(1, 12)) // 12-TET semitone
```

::: warning
Non-integer exponents produce irrational results (SymbolicPower). These display with the **≈** prefix.
:::

## Lookup Functions

### Find Tempo

```javascript
module.findTempo(module.baseNote)
```

Walks the inheritance chain to find the tempo value. Usually returns BaseNote's tempo.

### Find Measure Length

```javascript
module.findMeasureLength(module.baseNote)
```

Computes measure duration based on tempo and beatsPerMeasure.

## Chaining Operations

Operations can be chained:

```javascript
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3, 2))
  .mul(new Fraction(5, 4))

// Equivalent to: baseFreq × 3/2 × 5/4 = baseFreq × 15/8
```

## Precedence

Standard mathematical precedence applies:

1. Parentheses (implicit in method chaining)
2. Power (`.pow()`)
3. Negation (`.neg()`)
4. Multiplication/Division (`.mul()`, `.div()`)
5. Addition/Subtraction (`.add()`, `.sub()`)

## Common Patterns

### Relative Frequency

```javascript
// Perfect fifth above BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Major third above another note
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Octave below
module.baseNote.getVariable('frequency').div(new Fraction(2))
```

### Sequential Timing

```javascript
// Start when previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```

### Beat-Relative Duration

```javascript
// One beat
new Fraction(60).div(module.findTempo(module.baseNote))

// Two beats
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Half beat
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```

### TET Intervals

```javascript
// 12-TET semitone
new Fraction(2).pow(new Fraction(1, 12))

// 12-TET major third (4 semitones)
new Fraction(2).pow(new Fraction(4, 12))

// Simplified: 4/12 = 1/3
new Fraction(2).pow(new Fraction(1, 3))
```

## Error Conditions

### Syntax Errors

```javascript
// Missing parenthesis
new Fraction(3, 2.mul()  // Error

// Unknown method
new Fraction(3).multiply(2)  // Error (should be .mul())

// Invalid fraction
new Fraction(3.5, 2)  // Error (must be integers)
```

### Reference Errors

```javascript
// Non-existent note
module.getNoteById(999).getVariable('frequency')  // Error

// Invalid variable name
module.baseNote.getVariable('pitch')  // Error (should be 'frequency')
```

### Circular Dependencies

```javascript
// Note 1 references Note 2
note1.frequency = module.getNoteById(2).getVariable('frequency')

// Note 2 references Note 1 - Error!
note2.frequency = module.getNoteById(1).getVariable('frequency')
```

## Best Practices

1. **Use meaningful references**: Reference notes by their role, not arbitrary IDs
2. **Keep expressions readable**: Break complex expressions into multiple notes
3. **Simplify fractions**: Use `new Fraction(1, 2)` not `new Fraction(2, 4)`
4. **Test incrementally**: Verify each expression before building on it
5. **Use BaseNote for transposition**: Reference BaseNote for root-relative notes

## See Also

- [Fraction API](./fraction-api) - Complete Fraction.js reference
- [Module API](./module-api) - Module methods
- [Operators](./operators) - Arithmetic details
