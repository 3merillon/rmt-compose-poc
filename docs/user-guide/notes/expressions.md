# Expressions

**Expressions** are the mathematical formulas that define note properties. Understanding expressions is key to mastering RMT Compose.

## What Are Expressions?

Every note property (frequency, startTime, duration) is computed from an expression. Expressions can be:

- **Constants**: Fixed values like `440` or `3/4`
- **References**: Values from other notes like `[1].f` or `base.f`
- **Computations**: Arithmetic on values like `* (3/2)`

## Basic Syntax

### Creating Fractions

Fractions represent exact rational numbers:

```
// Integer (440/1)
440

// Fraction (3/2)
3/2

// Negative
-1/4
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(440)
new Fraction(3, 2)
new Fraction(-1, 4)
```
</details>

### Referencing Notes

Access other notes' properties:

```
// BaseNote's frequency
base.f

// Note 5's start time
[5].t

// Note 3's duration
[3].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')
module.getNoteById(5).getVariable('startTime')
module.getNoteById(3).getVariable('duration')
```
</details>

### Arithmetic Operations

Perform math on values:

```
// Addition
a + b

// Subtraction
a - b

// Multiplication
a * b

// Division
a / b

// Negation
-a

// Power (for TET systems)
a ^ b
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
a.add(b)
a.sub(b)
a.mul(b)
a.div(b)
a.neg()
a.pow(b)
```
</details>

## Common Patterns

### Frequency Expressions

```
// Exact frequency in Hz
440

// Relative to BaseNote (perfect fifth)
base.f * (3/2)

// Relative to another note (major third above)
[1].f * (5/4)

// 12-TET semitone (irrational)
base.f * 2 ^ (1/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(440)
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 12)))
```
</details>

### Start Time Expressions

```
// At the beginning
0

// Same time as BaseNote
base.t

// After Note 3 ends
[3].t + [3].d

// 2 beats after BaseNote
base.t + 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(0)
module.baseNote.getVariable('startTime')
module.getNoteById(3).getVariable('startTime').add(module.getNoteById(3).getVariable('duration'))
module.baseNote.getVariable('startTime').add(new Fraction(2))
```
</details>

### Duration Expressions

```
// Fixed: 1 beat
1

// Tempo-relative: Quarter note
60 / tempo(base)

// Tempo-relative: Half note
60 / tempo(base) * 2

// Same as another note
[1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(1)
new Fraction(60).div(module.findTempo(module.baseNote))
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))
module.getNoteById(1).getVariable('duration')
```
</details>

## Module Lookup Functions

Special functions for finding inherited values:

```
// Find tempo (walks up dependency chain to BaseNote)
tempo(base)

// Find measure length
measure(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findTempo(module.baseNote)
module.findMeasureLength(module.baseNote)
```
</details>

## Expression Evaluation

Expressions are:

1. **Compiled** to binary bytecode at load time
2. **Evaluated** by a stack-based virtual machine
3. **Cached** for performance
4. **Re-evaluated** when dependencies change

### Evaluation Order

The dependency graph determines evaluation order:

1. BaseNote is evaluated first
2. Notes are evaluated in topological order (dependencies before dependents)
3. If Note B depends on Note A, Note A is always evaluated first

## Error Handling

### Syntax Errors

Invalid expressions prevent saving:

```
// Missing parenthesis - ERROR
(3/2 * (5/4)

// Correct
(3/2) * (5/4)
```

### Circular Dependencies

Notes cannot depend on each other in a cycle:

```
// Note A depends on Note B
[B].f * (3/2)

// Note B depends on Note A - ERROR!
[A].f * (5/4)
```

### Invalid References

Referencing a non-existent note causes an error:

```
// Note 999 doesn't exist - ERROR
[999].f
```

## Irrational Values (TET)

Power expressions can produce irrational results:

```
// 2^(1/12) is irrational
2 ^ (1/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(2).pow(new Fraction(1, 12))
```
</details>

These are stored as **SymbolicPower** objects, not floats:

- Preserves algebraic structure
- Combines like bases: `2^(1/12) × 2^(1/12) = 2^(1/6)`
- Displayed with **≈** prefix

## Expression vs. Value

| Concept | Description |
|---------|-------------|
| **Expression** | The formula (e.g., `baseNote.frequency × 3/2`) |
| **Value** | The computed result (e.g., `660 Hz`) |
| **Raw** | The expression text in the Variable Widget |
| **Evaluated** | The value shown in the Variable Widget |

Changing the BaseNote frequency updates all evaluated values, but expressions stay the same.

## Tips

1. **Start simple**: Use constants first, add references as needed
2. **Test incrementally**: Check the evaluated value after each change
3. **Copy working expressions**: Use existing expressions as templates
4. **Mind the parentheses**: Every `.` and `()` must be correct
5. **Use Ctrl+Z**: Undo if an expression breaks something
