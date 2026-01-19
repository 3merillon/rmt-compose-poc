# Expressions

**Expressions** are the mathematical formulas that define note properties. Understanding expressions is key to mastering RMT Compose.

## What Are Expressions?

Every note property (frequency, startTime, duration) is computed from an expression. Expressions can be:

- **Constants**: Fixed values like `new Fraction(440)`
- **References**: Values from other notes like `module.getNoteById(1).getVariable('frequency')`
- **Computations**: Arithmetic on values like `.mul(new Fraction(3, 2))`

## Basic Syntax

### Creating Fractions

Fractions represent exact rational numbers:

```javascript
// Integer (440/1)
new Fraction(440)

// Fraction (3/2)
new Fraction(3, 2)

// Negative
new Fraction(-1, 4)
```

### Referencing Notes

Access other notes' properties:

```javascript
// BaseNote's frequency
module.baseNote.getVariable('frequency')

// Note 5's start time
module.getNoteById(5).getVariable('startTime')

// Note 3's duration
module.getNoteById(3).getVariable('duration')
```

### Arithmetic Operations

Perform math on values:

```javascript
// Addition
a.add(b)

// Subtraction
a.sub(b)

// Multiplication
a.mul(b)

// Division
a.div(b)

// Negation
a.neg()

// Power (for TET systems)
a.pow(b)
```

## Common Patterns

### Frequency Expressions

```javascript
// Exact frequency in Hz
new Fraction(440)

// Relative to BaseNote (perfect fifth)
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Relative to another note (major third above)
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// 12-TET semitone (irrational)
module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(1, 12))
)
```

### Start Time Expressions

```javascript
// At the beginning
new Fraction(0)

// Same time as BaseNote
module.baseNote.getVariable('startTime')

// After Note 3 ends
module.getNoteById(3).getVariable('startTime')
  .add(module.getNoteById(3).getVariable('duration'))

// 2 beats after BaseNote
module.baseNote.getVariable('startTime').add(new Fraction(2))
```

### Duration Expressions

```javascript
// Fixed: 1 beat
new Fraction(1)

// Tempo-relative: Quarter note
new Fraction(60).div(module.findTempo(module.baseNote))

// Tempo-relative: Half note
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))

// Same as another note
module.getNoteById(1).getVariable('duration')
```

## Module Lookup Functions

Special functions for finding inherited values:

```javascript
// Find tempo (walks up dependency chain to BaseNote)
module.findTempo(module.baseNote)

// Find measure length
module.findMeasureLength(module.baseNote)
```

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

```javascript
// Missing parenthesis - ERROR
new Fraction(3, 2.mul(new Fraction(5, 4))

// Correct
new Fraction(3, 2).mul(new Fraction(5, 4))
```

### Circular Dependencies

Notes cannot depend on each other in a cycle:

```javascript
// Note A depends on Note B
noteA.frequency = module.getNoteById(B).getVariable('frequency').mul(...)

// Note B depends on Note A - ERROR!
noteB.frequency = module.getNoteById(A).getVariable('frequency').mul(...)
```

### Invalid References

Referencing a non-existent note causes an error:

```javascript
// Note 999 doesn't exist - ERROR
module.getNoteById(999).getVariable('frequency')
```

## Irrational Values (TET)

Power expressions can produce irrational results:

```javascript
// 2^(1/12) is irrational
new Fraction(2).pow(new Fraction(1, 12))
```

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
