# Operators

Complete reference for arithmetic operations in RMT Compose expressions.

## DSL Operators

The DSL syntax uses familiar mathematical operators:

```
base.f * (3/2) * (5/4) / 2
```

| Operator | Meaning | Example |
|----------|---------|---------|
| `+` | Addition | `base.t + 1` |
| `-` | Subtraction | `[3].t - (1/2)` |
| `*` | Multiplication | `base.f * (3/2)` |
| `/` | Division | `base.d / 2` |
| `^` | Power | `2 ^ (1/12)` |
| `-` (prefix) | Negation | `-base.f` |

## Legacy Method Chaining

The legacy syntax uses method chaining:

```javascript
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3, 2))
  .mul(new Fraction(5, 4))
  .div(new Fraction(2))
```

## Basic Arithmetic

### Addition: `+` / `.add()`

Adds two values:

```
# DSL
1 + 2                    // 3
(1/2) + (1/3)           // 5/6
[5].t + [5].d           // Start when note 5 ends
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.add(b)
new Fraction(1).add(new Fraction(2))  // 3
new Fraction(1, 2).add(new Fraction(1, 3))  // 5/6
module.getNoteById(5).getVariable('startTime').add(module.getNoteById(5).getVariable('duration'))
```
</details>

### Subtraction: `-` / `.sub()`

Subtracts one value from another:

```
# DSL
5 - 2                    // 3
(3/4) - (1/4)           // 1/2
[3].t - (1/2)           // Offset a note 0.5 seconds earlier
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.sub(b)
new Fraction(5).sub(new Fraction(2))  // 3
new Fraction(3, 4).sub(new Fraction(1, 4))  // 1/2
module.getNoteById(3).getVariable('startTime').sub(new Fraction(1, 2))
```
</details>

### Multiplication: `*` / `.mul()`

Multiplies two values:

```
# DSL
3 * 2                    // 6
(3/2) * (5/4)           // 15/8
base.f * (3/2)          // Perfect fifth above BaseNote
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.mul(b)
new Fraction(3).mul(new Fraction(2))  // 6
new Fraction(3, 2).mul(new Fraction(5, 4))  // 15/8
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

### Division: `/` / `.div()`

Divides one value by another:

```
# DSL
6 / 2                    // 3
(3/2) / 3               // 1/2
60 / tempo(base)        // Beat duration from tempo
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.div(b)
new Fraction(6).div(new Fraction(2))  // 3
new Fraction(3, 2).div(new Fraction(3))  // 1/2
new Fraction(60).div(module.findTempo(module.baseNote))
```
</details>

### Negation: `-` (prefix) / `.neg()`

Returns the negative of a value:

```
# DSL
-5                       // -5
-(-3/2)                 // 3/2
-base.f                 // Negated frequency
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.neg()
new Fraction(5).neg()  // -5
new Fraction(-3, 2).neg()  // 3/2
```
</details>

### Power: `^` / `.pow()`

Raises a value to a power:

```
# DSL - Integer powers (exact)
2 ^ 3                    // 8
3 ^ 2                    // 9
2 ^ (-1)                // 1/2

# DSL - Fractional powers (irrational)
2 ^ (1/2)               // √2 ≈ 1.414
2 ^ (1/12)              // 12-TET semitone ≈ 1.0595
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.pow(b)
new Fraction(2).pow(new Fraction(3))   // 8
new Fraction(3).pow(new Fraction(2))   // 9
new Fraction(2).pow(new Fraction(-1))  // 1/2
new Fraction(2).pow(new Fraction(1, 2))   // √2 ≈ 1.414
new Fraction(2).pow(new Fraction(1, 12))  // 12-TET semitone ≈ 1.0595
```
</details>

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

```
# DSL
base.f * 2              // Octave (2:1)
base.f * (3/2)          // Perfect fifth (3:2)
base.f * (4/3)          // Perfect fourth (4:3)
base.f * (5/4)          // Major third (5:4)
base.f * (6/5)          // Minor third (6:5)
```

### Intervals as Division (Downward)

```
# DSL
base.f / 2              // Octave down
base.f / (3/2)          // Fifth down
base.f * (2/3)          // Fifth down (equivalent)
```

### Compound Intervals

```
# DSL
base.f * 2 * (5/4)      // Major tenth (octave + major third)
base.f * (5/2)          // Major tenth (simplified)
base.f * 4              // Two octaves
```

### TET Calculations

```
# DSL - n semitones in 12-TET
base.f * 2 ^ (n/12)

# n steps in 19-TET
base.f * 2 ^ (n/19)

# n steps in Bohlen-Pierce (13 divisions of tritave)
base.f * 3 ^ (n/13)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// n semitones in 12-TET
freq.mul(new Fraction(2).pow(new Fraction(n, 12)))

// n steps in 19-TET
freq.mul(new Fraction(2).pow(new Fraction(n, 19)))

// n steps in Bohlen-Pierce (13 divisions of tritave)
freq.mul(new Fraction(3).pow(new Fraction(n, 13)))
```
</details>

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
