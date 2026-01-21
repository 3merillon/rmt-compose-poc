# Core Concepts

Understanding these fundamental concepts will help you get the most out of RMT Compose.

## Relative Music Theory

**Relative Music Theory (RMT)** is the idea that musical relationships can be expressed as mathematical ratios rather than fixed frequencies.

### Traditional Approach
In traditional music notation:
- A4 = 440 Hz
- E5 = 659.25 Hz
- The relationship between them is implicit

### RMT Approach
In relative music theory:
- BaseNote frequency = any value (e.g., 440 Hz)
- E5 = `base.f * (3/2)` (a perfect fifth)
- The relationship is explicit and exact

This means:
- **Change the BaseNote**, and all notes shift proportionally
- **Intervals are pure** - they match the natural harmonic series
- **Transposition is trivial** - just change one number

## The BaseNote

Every module has a special note called the **BaseNote** (displayed as an orange circle at time=0).

The BaseNote provides default values for:

| Property | Description |
|----------|-------------|
| `frequency` | Reference frequency (e.g., 440 Hz for A4) |
| `startTime` | Reference start time (usually 0) |
| `tempo` | Beats per minute |
| `beatsPerMeasure` | Time signature numerator |

All other notes can reference BaseNote properties:

```
// Frequency relative to BaseNote (perfect fifth)
base.f * (3/2)

// Start time relative to BaseNote + 1
base.t + 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Frequency relative to BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Start time relative to BaseNote
module.baseNote.getVariable('startTime').add(new Fraction(1))
```
</details>

::: tip Think of it like a guitar capo
The BaseNote is like placing a capo on a guitar. It sets the foundation, and all other notes are defined relative to it.
:::

## Ratios and Fractions

Musical intervals are expressed as **exact fractions**:

| Interval | Ratio | Decimal | Sound |
|----------|-------|---------|-------|
| Unison | 1/1 | 1.000 | Same pitch |
| Octave | 2/1 | 2.000 | Same note, higher |
| Perfect fifth | 3/2 | 1.500 | Very consonant |
| Perfect fourth | 4/3 | 1.333 | Consonant |
| Major third | 5/4 | 1.250 | Bright, major feel |
| Minor third | 6/5 | 1.200 | Dark, minor feel |
| Major second | 9/8 | 1.125 | Whole step |

### Why Exact Fractions?

Compare a perfect fifth in different systems:

| System | Ratio | Decimal |
|--------|-------|---------|
| Just intonation | 3/2 | 1.500000 |
| 12-TET | 2^(7/12) | 1.498307 |

The difference is small but audible - just intonation sounds "purer" and more resonant.

RMT Compose uses the **Fraction.js** library for arbitrary-precision arithmetic, so ratios like `3/2` are stored exactly, not as floating-point approximations.

## Expressions

Every note property is defined by an **expression** - a mathematical formula that computes a value.

### Simple Expressions

Constants are written as numbers or fractions:

```
// The number 3/4
3/4

// The number 440
440
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// The number 3/4
new Fraction(3, 4)

// The number 440
new Fraction(440)
```
</details>

### Reference Expressions

Notes can reference other notes:

```
// BaseNote's frequency
base.f

// Note 5's start time
[5].t
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// BaseNote's frequency
module.baseNote.getVariable('frequency')

// Note 5's start time
module.getNoteById(5).getVariable('startTime')
```
</details>

### Arithmetic Expressions

Combine values with operations:

```
// BaseNote frequency times 3/2 (perfect fifth)
base.f * (3/2)

// Note 3's end time (start + duration)
[3].t + [3].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// BaseNote frequency times 3/2 (perfect fifth)
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Note 3's end time (start + duration)
module.getNoteById(3).getVariable('startTime')
  .add(module.getNoteById(3).getVariable('duration'))
```
</details>

### Available Operations

| Operation | DSL Syntax | Example |
|-----------|------------|---------|
| Add | `+` | `base.f + 100` |
| Subtract | `-` | `[3].t - (1/4)` |
| Multiply | `*` | `base.f * (3/2)` |
| Divide | `/` | `base.d / 2` |
| Power | `^` | `2 ^ (1/12)` |
| Negate | `-` (prefix) | `-base.f` |

<details>
<summary>Legacy JavaScript syntax</summary>

| Operation | Syntax | Example |
|-----------|--------|---------|
| Add | `.add(x)` | `a.add(new Fraction(1))` |
| Subtract | `.sub(x)` | `a.sub(new Fraction(1, 4))` |
| Multiply | `.mul(x)` | `a.mul(new Fraction(3, 2))` |
| Divide | `.div(x)` | `a.div(new Fraction(2))` |
| Power | `.pow(x)` | `a.pow(new Fraction(1, 12))` |
| Negate | `.neg()` | `a.neg()` |
</details>

## Dependencies

When a note's expression references another note, it creates a **dependency**.

### Example

```
// Note 2 depends on Note 1's frequency (major third above)
[1].f * (5/4)

// Note 3 depends on Note 2's end time (starts when Note 2 ends)
[2].t + [2].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 2 depends on Note 1's frequency
note2.frequency = module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Note 3 depends on Note 2's duration
note3.startTime = module.getNoteById(2).getVariable('startTime')
                   .add(module.getNoteById(2).getVariable('duration'))
```
</details>

### Dependency Visualization

When you select a note in the workspace:

- **Blue/cyan lines** point to notes this note **depends on**
- **Red/orange lines** point to notes that **depend on** this note

### Smart Updates

When you change a note:
- All notes that depend on it automatically update
- The dependency graph uses an inverted index for O(1) lookup
- Drag previews only move notes whose position actually depends on the dragged note

::: warning Circular Dependencies
You cannot create circular dependencies (Note A depends on Note B, which depends on Note A). The app will show an error if you try.
:::

## Modules

A **module** is a collection of notes that form a composition or reusable pattern.

### Module Structure

```json
{
  "baseNote": {
    "frequency": "440",
    "startTime": "0",
    "tempo": "120",
    "beatsPerMeasure": "4"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f * (5/4)",
      "startTime": "base.t",
      "duration": "1",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```

<details>
<summary>Legacy JavaScript syntax (also supported)</summary>

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "tempo": "new Fraction(120)",
    "beatsPerMeasure": "new Fraction(4)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(1)",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```
</details>

### Built-in Categories

The Module Bar organizes modules by category:

| Category | Contents |
|----------|----------|
| Intervals | Single intervals (octave, fifth, third, etc.) |
| Chords | Common chord voicings |
| Melodies | Example melodies including TET scales |
| Custom | Your own saved modules |

### Creating Modules

1. Build your composition in the workspace
2. Save via **Menu > Save Module**
3. The JSON file can be shared or added to your module library

## The ≈ Symbol (Approximation)

Some notes display an **≈** symbol before their frequency. This indicates an **irrational number** that cannot be expressed as an exact fraction.

### When Does This Happen?

Equal temperament systems use irrational ratios:

```
// 12-TET semitone = 2^(1/12) ≈ 1.05946...
2 ^ (1/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(2).pow(new Fraction(1, 12))
```
</details>

This value is irrational - it has infinite non-repeating decimals.

### SymbolicPower

RMT Compose preserves the **algebraic structure** of these expressions:

```
// Two semitones up: 2^(1/12) × 2^(1/12) = 2^(1/6)
// Not collapsed to a float, but kept as a symbolic power
2 ^ (1/12) * 2 ^ (1/12)  // = 2 ^ (1/6)
```

The ≈ symbol reminds you that the displayed value is an approximation of this symbolic representation.

### Just Intonation vs Equal Temperament

| Aspect | Just Intonation | Equal Temperament |
|--------|-----------------|-------------------|
| Ratios | Exact fractions (3/2) | Irrational powers (2^(7/12)) |
| Sound | Pure, resonant | Compromise across all keys |
| Display | No ≈ symbol | Shows ≈ symbol |

## Summary

| Concept | Description |
|---------|-------------|
| **BaseNote** | Reference point for all ratios |
| **Ratio** | Exact fraction representing an interval (3/2 = fifth) |
| **Expression** | Mathematical formula computing a property |
| **Dependency** | One note referencing another |
| **Module** | Collection of notes forming a composition |
| **≈ Symbol** | Indicates an irrational (TET) value |

## Next Steps

Now that you understand the core concepts:

- Explore the [User Guide](/user-guide/) for detailed feature documentation
- Try the [Tutorials](/tutorials/) for hands-on learning
- Read the [Expression Syntax Reference](/reference/expressions/syntax) for the complete language
