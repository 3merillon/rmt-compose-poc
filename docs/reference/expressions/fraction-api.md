# Fraction API

RMT Compose uses [Fraction.js](https://github.com/rawify/Fraction.js) for arbitrary-precision rational arithmetic. This ensures exact calculations without floating-point rounding errors.

## Creating Fractions

### Integer

```javascript
new Fraction(440)    // 440/1
new Fraction(0)      // 0/1
new Fraction(-5)     // -5/1
```

### Rational

```javascript
new Fraction(3, 2)   // 3/2 (perfect fifth)
new Fraction(5, 4)   // 5/4 (major third)
new Fraction(-1, 4)  // -1/4
```

### Large Numbers

Arbitrary precision is supported:

```javascript
new Fraction(123456789, 987654321)
new Fraction("355", "113")  // Approximation of pi
```

## Arithmetic Methods

### add(other)

Adds two fractions:

```javascript
new Fraction(1, 2).add(new Fraction(1, 3))  // 5/6
new Fraction(440).add(new Fraction(20))      // 460
```

### sub(other)

Subtracts fractions:

```javascript
new Fraction(3, 4).sub(new Fraction(1, 4))  // 2/4 = 1/2
new Fraction(5).sub(new Fraction(2))         // 3
```

### mul(other)

Multiplies fractions:

```javascript
new Fraction(3, 2).mul(new Fraction(5, 4))  // 15/8
new Fraction(440).mul(new Fraction(2))       // 880 (octave)
```

### div(other)

Divides fractions:

```javascript
new Fraction(3, 2).div(new Fraction(2))     // 3/4
new Fraction(60).div(new Fraction(120))     // 1/2 (beat duration)
```

### neg()

Returns the negation:

```javascript
new Fraction(5).neg()      // -5
new Fraction(-3, 2).neg()  // 3/2
```

### pow(exponent)

Raises to a power:

```javascript
new Fraction(2).pow(new Fraction(3))      // 8 (2^3)
new Fraction(2).pow(new Fraction(-1))     // 1/2 (2^-1)
new Fraction(2).pow(new Fraction(1, 12))  // 12-TET semitone (irrational)
```

::: warning Irrational Results
Non-integer exponents produce irrational numbers that cannot be represented as exact fractions. RMT Compose uses [SymbolicPower](/developer/core/symbolic-power) to preserve these algebraically where possible.
:::

### abs()

Returns absolute value:

```javascript
new Fraction(-5, 3).abs()  // 5/3
```

### inverse()

Returns the reciprocal:

```javascript
new Fraction(3, 2).inverse()  // 2/3
new Fraction(4).inverse()     // 1/4
```

### mod(other)

Modulo operation:

```javascript
new Fraction(7).mod(new Fraction(3))  // 1
```

## Comparison Methods

### equals(other)

```javascript
new Fraction(1, 2).equals(new Fraction(2, 4))  // true
new Fraction(3, 2).equals(new Fraction(3, 2))  // true
```

### compare(other)

Returns -1, 0, or 1:

```javascript
new Fraction(1, 2).compare(new Fraction(2, 3))  // -1 (less than)
new Fraction(3, 2).compare(new Fraction(3, 2))  // 0 (equal)
new Fraction(5, 4).compare(new Fraction(1))     // 1 (greater than)
```

## Conversion Methods

### valueOf()

Returns JavaScript number (may lose precision):

```javascript
new Fraction(3, 2).valueOf()  // 1.5
new Fraction(1, 3).valueOf()  // 0.3333333333333333
```

### toString()

Returns string representation:

```javascript
new Fraction(3, 2).toString()  // "3/2"
new Fraction(4).toString()     // "4"
```

### toFraction()

Returns simplified string:

```javascript
new Fraction(6, 4).toFraction()  // "3/2"
```

## Properties

### n (numerator)

```javascript
new Fraction(3, 2).n  // 3
```

### d (denominator)

```javascript
new Fraction(3, 2).d  // 2
```

### s (sign)

```javascript
new Fraction(3, 2).s   // 1
new Fraction(-3, 2).s  // -1
```

## Common Patterns in RMT Compose

### Frequency Ratios

```javascript
// Perfect fifth above base
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Octave above
module.baseNote.getVariable('frequency').mul(new Fraction(2))

// Perfect fourth below
module.baseNote.getVariable('frequency').div(new Fraction(4, 3))
```

### Beat Calculations

```javascript
// Duration of one beat at current tempo
new Fraction(60).div(module.findTempo(module.baseNote))

// Two beats
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Half beat (eighth note)
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```

### Sequential Timing

```javascript
// Start after previous note ends
module.getNoteById(prev).getVariable('startTime')
  .add(module.getNoteById(prev).getVariable('duration'))
```

## See Also

- [Expression Syntax](/reference/expressions/syntax) - Full expression language
- [Operators](/reference/expressions/operators) - Arithmetic operations
- [SymbolicPower](/developer/core/symbolic-power) - Handling irrational numbers
