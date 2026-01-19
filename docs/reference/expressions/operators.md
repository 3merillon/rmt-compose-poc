# Operators

Complete reference for arithmetic operations in RMT Compose expressions.

## Method Chaining

All operations are called as methods and can be chained:

```javascript
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3, 2))
  .mul(new Fraction(5, 4))
  .div(new Fraction(2))
```

## Basic Arithmetic

### Addition: `.add()`

Adds two values:

```javascript
a.add(b)

// Examples
new Fraction(1).add(new Fraction(2))  // 3
new Fraction(1, 2).add(new Fraction(1, 3))  // 5/6

// Timing: start 1 second after another note ends
module.getNoteById(5).getVariable('startTime')
  .add(module.getNoteById(5).getVariable('duration'))
```

### Subtraction: `.sub()`

Subtracts one value from another:

```javascript
a.sub(b)

// Examples
new Fraction(5).sub(new Fraction(2))  // 3
new Fraction(3, 4).sub(new Fraction(1, 4))  // 1/2

// Offset a note 0.5 seconds earlier
module.getNoteById(3).getVariable('startTime')
  .sub(new Fraction(1, 2))
```

### Multiplication: `.mul()`

Multiplies two values:

```javascript
a.mul(b)

// Examples
new Fraction(3).mul(new Fraction(2))  // 6
new Fraction(3, 2).mul(new Fraction(5, 4))  // 15/8

// Perfect fifth above BaseNote
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3, 2))
```

### Division: `.div()`

Divides one value by another:

```javascript
a.div(b)

// Examples
new Fraction(6).div(new Fraction(2))  // 3
new Fraction(3, 2).div(new Fraction(3))  // 1/2

// Beat duration from tempo
new Fraction(60).div(module.findTempo(module.baseNote))
```

### Negation: `.neg()`

Returns the negative of a value:

```javascript
a.neg()

// Examples
new Fraction(5).neg()  // -5
new Fraction(-3, 2).neg()  // 3/2
```

### Power: `.pow()`

Raises a value to a power:

```javascript
a.pow(b)

// Integer powers (exact)
new Fraction(2).pow(new Fraction(3))   // 8
new Fraction(3).pow(new Fraction(2))   // 9
new Fraction(2).pow(new Fraction(-1))  // 1/2

// Fractional powers (irrational)
new Fraction(2).pow(new Fraction(1, 2))   // √2 ≈ 1.414
new Fraction(2).pow(new Fraction(1, 12))  // 12-TET semitone ≈ 1.0595
```

::: warning Irrational Results
Fractional exponents produce irrational numbers. These are displayed with the **≈** prefix and handled using [SymbolicPower](/developer/core/symbolic-power).
:::

## Operator Precedence

Operations are evaluated left-to-right through method chaining. Use parentheses to control order:

```javascript
// Evaluated as: ((a × b) + c)
a.mul(b).add(c)

// Evaluated as: (a × (b + c))
a.mul(b.add(c))
```

Standard mathematical precedence:

1. Parentheses (grouping via nested expressions)
2. Power (`.pow()`)
3. Negation (`.neg()`)
4. Multiplication/Division (`.mul()`, `.div()`)
5. Addition/Subtraction (`.add()`, `.sub()`)

## Bytecode Opcodes

Internally, operators compile to stack-based bytecode:

| Operation | Opcode | Hex |
|-----------|--------|-----|
| Addition | ADD | 0x10 |
| Subtraction | SUB | 0x11 |
| Multiplication | MUL | 0x12 |
| Division | DIV | 0x13 |
| Negation | NEG | 0x14 |
| Power | POW | 0x15 |

## Common Musical Patterns

### Intervals as Multiplication

```javascript
// Octave (2:1)
freq.mul(new Fraction(2))

// Perfect fifth (3:2)
freq.mul(new Fraction(3, 2))

// Perfect fourth (4:3)
freq.mul(new Fraction(4, 3))

// Major third (5:4)
freq.mul(new Fraction(5, 4))

// Minor third (6:5)
freq.mul(new Fraction(6, 5))
```

### Intervals as Division (Downward)

```javascript
// Octave down
freq.div(new Fraction(2))

// Fifth down
freq.div(new Fraction(3, 2))
// Or equivalently:
freq.mul(new Fraction(2, 3))
```

### Compound Intervals

```javascript
// Major tenth (octave + major third)
freq.mul(new Fraction(2)).mul(new Fraction(5, 4))
// Simplified: 5/2
freq.mul(new Fraction(5, 2))

// Two octaves
freq.mul(new Fraction(4))
// Or:
freq.mul(new Fraction(2)).mul(new Fraction(2))
```

### TET Calculations

```javascript
// n semitones in 12-TET
freq.mul(new Fraction(2).pow(new Fraction(n, 12)))

// n steps in 19-TET
freq.mul(new Fraction(2).pow(new Fraction(n, 19)))

// n steps in Bohlen-Pierce (13 divisions of tritave)
freq.mul(new Fraction(3).pow(new Fraction(n, 13)))
```

## Error Conditions

### Division by Zero

```javascript
new Fraction(5).div(new Fraction(0))  // Error
```

### Invalid Operands

```javascript
// These will fail:
new Fraction(3).mul("2")      // String not allowed
new Fraction(3).add(undefined) // Undefined not allowed
```

## See Also

- [Expression Syntax](/reference/expressions/syntax) - Full syntax reference
- [Fraction API](/reference/expressions/fraction-api) - Fraction methods
- [Binary Evaluator](/developer/core/binary-evaluator) - Bytecode execution
