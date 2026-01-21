# Expression Syntax

Complete reference for the RMT Compose expression language.

## Overview

Expressions are formulas that define note properties. RMT Compose supports two syntax styles:

1. **DSL Syntax** (Recommended) - Concise, mathematical notation
2. **Legacy Syntax** - JavaScript-like method chaining

Both compile to the same binary bytecode for efficient evaluation. The DSL syntax is recommended for new compositions.

---

## DSL Syntax (Recommended)

### Constants

```
440           # Integer (440/1)
(3/2)         # Fraction (3 divided by 2)
(1/12)        # Fraction for TET intervals
(-5/4)        # Negative fraction
```

### Note References

```
[1].f         # Frequency of note 1
[1].t         # Start time of note 1
[1].d         # Duration of note 1
[1].tempo     # Tempo of note 1
[1].bpm       # Beats per measure of note 1
[1].ml        # Measure length of note 1

base.f        # BaseNote frequency (same as [0].f)
base.t        # BaseNote start time
base.d        # BaseNote duration
```

**Property shortcuts:**
| Short | Full | Meaning |
|-------|------|---------|
| `f` | `frequency` | Pitch in Hz |
| `t`, `s` | `startTime` | When note begins |
| `d` | `duration` | How long note plays |
| `tempo` | `tempo` | Beats per minute |
| `bpm` | `beatsPerMeasure` | Time signature numerator |
| `ml` | `measureLength` | Length of measure in seconds |

### Operators

```
a + b         # Addition
a - b         # Subtraction
a * b         # Multiplication
a / b         # Division
a ^ b         # Power (e.g., 2^(1/12))
-a            # Negation
```

**Precedence (highest to lowest):**
1. Parentheses `()`
2. Power `^` (right-associative)
3. Multiply/Divide `*`, `/`
4. Add/Subtract `+`, `-`
5. Negation `-`

### Helper Functions

```
tempo([1])    # Get tempo for note 1
tempo(base)   # Get tempo for baseNote
measure([1])  # Get measure length for note 1
beat([1])     # Get beat duration (60 / tempo)
beat(base)    # Beat duration from baseNote tempo
```

### Examples

```
# Perfect fifth (just intonation)
base.f * (3/2)

# 12-TET perfect fifth (7 semitones)
base.f * 2^(7/12)

# Start when note 1 ends
[1].t + [1].d

# Two measures after note 5
[5].t + measure([5]) * 2

# Quarter note duration
beat(base) * (1/4)

# Octave below note 3
[3].f / 2
```

---

## Legacy Syntax

The legacy JavaScript-like syntax is still fully supported for backwards compatibility.

### Constants

```javascript
new Fraction(440)       // 440/1
new Fraction(3, 2)      // 3/2
new Fraction(-1, 4)     // -1/4
```

### References

```javascript
module.baseNote.getVariable('frequency')
module.getNoteById(1).getVariable('startTime')
module.getNoteById(5).getVariable('duration')
```

### Operations

```javascript
a.add(b)     // Addition
a.sub(b)     // Subtraction
a.mul(b)     // Multiplication
a.div(b)     // Division
a.pow(b)     // Power
a.neg()      // Negation
```

### Lookup Functions

```javascript
module.findTempo(module.baseNote)
module.findTempo(module.getNoteById(1))
module.findMeasureLength(module.baseNote)
```

### Chaining

```javascript
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3, 2))
  .mul(new Fraction(5, 4))
```

---

## Syntax Comparison

| Task | DSL Syntax | Legacy Syntax |
|------|------------|---------------|
| Perfect fifth | `base.f * (3/2)` | `module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))` |
| Note end time | `[1].t + [1].d` | `module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))` |
| Beat duration | `beat(base)` | `new Fraction(60).div(module.findTempo(module.baseNote))` |
| 12-TET semitone | `2^(1/12)` | `new Fraction(2).pow(new Fraction(1, 12))` |
| Measure length | `measure([1])` | `module.findMeasureLength(module.getNoteById(1))` |

---

## Common Patterns

### Frequency Expressions

```
# Just intonation intervals
base.f * (3/2)        # Perfect fifth
base.f * (5/4)        # Major third
base.f * (4/3)        # Perfect fourth

# 12-TET intervals
base.f * 2^(1/12)     # Semitone
base.f * 2^(7/12)     # Perfect fifth
base.f * 2^(4/12)     # Major third

# Relative to another note
[5].f * (3/2)         # Fifth above note 5
[3].f / 2             # Octave below note 3
```

### Timing Expressions

```
# Sequential notes
[1].t + [1].d         # Start when note 1 ends
[3].t + [3].d + (1/4) # Quarter second after note 3 ends

# Measure-relative
base.t + measure(base)     # One measure after start
[5].t + measure([5]) * 2   # Two measures after note 5
```

### Duration Expressions

```
# Beat-relative durations
beat(base)            # One beat
beat(base) * 2        # Two beats (half note)
beat(base) * (1/2)    # Half beat (eighth note)
beat(base) * (1/4)    # Quarter beat (sixteenth note)

# Fixed durations
(1/2)                 # Half second
1                     # One second
```

---

## Error Conditions

### Self-Reference

Expressions cannot reference the note being edited:

```
# On note 5 - ERROR!
[5].f * 2             # Cannot reference self
```

### Circular Dependencies

```
# Note 1 references Note 2
[2].f

# Note 2 references Note 1 - ERROR!
[1].f
```

### Invalid Property

```
[1].x                 # Error: unknown property 'x'
[1].pitch             # Error: use 'f' or 'frequency'
```

### Division by Zero

```
(5/0)                 # Error: division by zero
```

---

## Best Practices

1. **Use DSL syntax** for new compositions - it's more readable
2. **Use meaningful note IDs** - consider which notes reference each other
3. **Keep expressions simple** - break complex calculations into multiple notes
4. **Test incrementally** - verify each expression before building on it
5. **Use BaseNote for transposition** - reference `base.f` for root-relative notes

---

## See Also

- [Fraction API](./fraction-api) - Fraction.js reference
- [Module API](./module-api) - Module methods
- [Operators](./operators) - Arithmetic details
