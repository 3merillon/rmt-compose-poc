# Equal Temperament

**Equal temperament** divides an interval (usually the octave) into equal parts. This contrasts with pure ratios, which use exact fractions from the harmonic series.

## What Is Equal Temperament?

In equal temperament:
- An interval is divided into N equal steps
- Each step has the same frequency ratio
- The ratio is the Nth root of the interval

For 12-TET (standard Western tuning):
- Octave (2:1) divided into 12 equal semitones
- Each semitone = 2^(1/12) ≈ 1.05946

## Why Equal Temperament?

### The Problem with Pure Ratios

Pure ratios sound beautiful, but they have a limitation: the circle of fifths doesn't close.

Starting from C and going up by pure fifths (3/2):
```
C → G → D → A → E → B → F# → C# → G# → D# → A# → E# → B#
```

After 12 fifths: (3/2)^12 = 129.746

After 7 octaves: 2^7 = 128

The difference (the "Pythagorean comma") means you can't return to the same pitch!

### The Equal Temperament Solution

Equal temperament compromises each interval slightly so that:
- 12 semitones exactly equal one octave
- All keys sound equally good (or equally compromised)
- Music can modulate freely between keys

## TET Systems in RMT Compose

RMT Compose supports multiple equal temperament systems:

| System | Steps per Octave | Step Ratio |
|--------|-----------------|------------|
| 12-TET | 12 | 2^(1/12) |
| 19-TET | 19 | 2^(1/19) |
| 31-TET | 31 | 2^(1/31) |
| BP-13 | 13 (per tritave) | 3^(1/13) |

## Expression Syntax

### Basic TET Step

```javascript
// One 12-TET semitone
new Fraction(2).pow(new Fraction(1, 12))

// One 19-TET step
new Fraction(2).pow(new Fraction(1, 19))

// Multiple steps (e.g., 7 semitones = perfect fifth in 12-TET)
new Fraction(2).pow(new Fraction(7, 12))
```

### Applying to a Note

```javascript
// Frequency: 4 semitones above BaseNote (major third in 12-TET)
module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(4, 12))
)
```

### Building a Scale

```javascript
// Each note is one semitone above the previous
note1.frequency = baseNote.frequency
note2.frequency = note1.frequency.mul(new Fraction(2).pow(new Fraction(1, 12)))
note3.frequency = note2.frequency.mul(new Fraction(2).pow(new Fraction(1, 12)))
// ... etc
```

## The ≈ Symbol

Notes with TET frequencies display **≈** before their value:

```
≈ 1.05946...
```

This indicates:
- The value is **irrational** (infinite non-repeating decimals)
- The displayed value is an **approximation**
- Internally, the value is stored as a **SymbolicPower** (exact algebraic form)

## SymbolicPower Algebra

RMT Compose doesn't collapse TET values to floats. Instead, it preserves the algebraic structure:

```javascript
// Two semitones:
2^(1/12) × 2^(1/12) = 2^(2/12) = 2^(1/6)

// Not:
1.05946... × 1.05946... = 1.12246...
```

This means:
- Computations stay exact algebraically
- 12 semitones exactly equals 2 (the octave)
- No floating-point drift

## Comparison: Just vs Equal

| Interval | Just Ratio | Just Decimal | 12-TET | Difference |
|----------|------------|--------------|--------|------------|
| Minor second | 16/15 | 1.0667 | 1.0595 | -0.7% |
| Major second | 9/8 | 1.1250 | 1.1225 | -0.2% |
| Minor third | 6/5 | 1.2000 | 1.1892 | -0.9% |
| Major third | 5/4 | 1.2500 | 1.2599 | +0.8% |
| Perfect fourth | 4/3 | 1.3333 | 1.3348 | +0.1% |
| Tritone | 45/32 | 1.4063 | 1.4142 | +0.6% |
| Perfect fifth | 3/2 | 1.5000 | 1.4983 | -0.1% |
| Minor sixth | 8/5 | 1.6000 | 1.5874 | -0.8% |
| Major sixth | 5/3 | 1.6667 | 1.6818 | +0.9% |
| Minor seventh | 7/4 | 1.7500 | 1.7818 | +1.8% |
| Major seventh | 15/8 | 1.8750 | 1.8877 | +0.7% |

Notice that fifths are very close, but thirds are noticeably different.

## When to Use Equal Temperament

Use TET when:
- You need to modulate between keys
- You want compatibility with standard instruments
- You're exploring microtonal music (19-TET, 31-TET)
- You want predictable, symmetric scales

Use pure ratios when:
- You want maximum consonance
- You're staying in one key
- You're exploring historical tunings
- You want mathematical elegance

## Included TET Modules

RMT Compose includes pre-built modules:

- **[12-TET](./12-tet)** - Standard Western semitones
- **[19-TET](./19-tet)** - Better thirds, more notes
- **[31-TET](./31-tet)** - High-resolution microtonal
- **[Bohlen-Pierce](./bohlen-pierce)** - Tritave-based (3:1)

Find them in the Module Bar under **Melodies**.

## Next Steps

- Learn about [12-TET](./12-tet) in detail
- Explore [19-TET](./19-tet) for improved thirds
- Try [Custom TET](./custom-tet) to create your own systems
