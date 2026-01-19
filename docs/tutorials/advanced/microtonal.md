# Microtonal Composition

Explore music beyond the standard 12-note scale using RMT Compose's powerful ratio and equal temperament systems.

## What is Microtonal Music?

Microtonal music uses intervals smaller than the standard semitone, or uses tuning systems that divide the octave differently than the familiar 12-tone equal temperament (12-TET).

RMT Compose excels at microtonal composition because it works with **exact ratios** rather than fixed pitch values.

## Pure Intervals vs Equal Temperament

### The Problem with 12-TET

Standard 12-TET divides the octave into 12 equal parts. Each semitone is exactly 2^(1/12) = ~1.0595. This creates slight deviations from pure ratios:

| Interval | Pure Ratio | Pure Cents | 12-TET Cents | Difference |
|----------|------------|------------|--------------|------------|
| Major Third | 5/4 | 386.3 | 400 | +13.7 |
| Perfect Fifth | 3/2 | 702.0 | 700 | -2.0 |
| Minor Seventh | 7/4 | 968.8 | 1000 | +31.2 |

### Pure Ratios in RMT Compose

Use exact ratios for pure, beatless intervals:

```javascript
// Pure major third (5:4)
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))

// Pure perfect fifth (3:2)
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Pure harmonic seventh (7:4)
module.baseNote.getVariable('frequency').mul(new Fraction(7, 4))
```

## Alternative Equal Temperaments

### 19-TET

Divides the octave into 19 equal parts. Better approximation of pure thirds than 12-TET.

```javascript
// 19-TET semitone
new Fraction(2).pow(new Fraction(1, 19))

// 19-TET major third (6 steps)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(6, 19)))

// 19-TET perfect fifth (11 steps)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(11, 19)))
```

### 31-TET

Divides the octave into 31 equal parts. Excellent approximation of many pure intervals.

```javascript
// 31-TET semitone
new Fraction(2).pow(new Fraction(1, 31))

// 31-TET major third (10 steps)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(10, 31)))

// 31-TET perfect fifth (18 steps)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(18, 31)))
```

### 24-TET (Quarter Tones)

Divides the octave into 24 equal parts, adding quarter tones between standard semitones.

```javascript
// Quarter tone up from A
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 24)))

// Standard semitone in 24-TET
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(2, 24)))
```

## Bohlen-Pierce Scale

A unique non-octave scale based on the 3:1 ratio (tritave) divided into 13 equal parts.

```javascript
// Bohlen-Pierce step
new Fraction(3).pow(new Fraction(1, 13))

// Example: 5 BP steps above base
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3).pow(new Fraction(5, 13)))
```

### Why Bohlen-Pierce?

- Built around 3:1 instead of 2:1
- Better approximation of odd harmonics (3:1, 5:3, 7:3)
- Completely different sound palette from octave-based scales

## Just Intonation

Pure intervals derived from simple ratios. Build scales using only whole-number ratios.

### 5-Limit Just Intonation

Uses ratios with prime factors 2, 3, and 5 only:

```javascript
// Just major scale
C:  1/1     // Unison
D:  9/8     // Major second
E:  5/4     // Major third
F:  4/3     // Perfect fourth
G:  3/2     // Perfect fifth
A:  5/3     // Major sixth
B:  15/8    // Major seventh
C': 2/1     // Octave
```

```javascript
// E (major third)
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))

// G (perfect fifth)
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// A (major sixth)
module.baseNote.getVariable('frequency').mul(new Fraction(5, 3))
```

### 7-Limit Just Intonation

Adds the seventh harmonic for bluesy intervals:

```javascript
// Harmonic seventh (flat seventh)
module.baseNote.getVariable('frequency').mul(new Fraction(7, 4))

// Septimal minor third
module.baseNote.getVariable('frequency').mul(new Fraction(7, 6))

// Septimal tritone
module.baseNote.getVariable('frequency').mul(new Fraction(7, 5))
```

## Building a Microtonal Composition

### Example: 19-TET Melody

```javascript
// Note 1: Root
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)

// Note 2: 19-TET major second (3 steps)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(3, 19)))
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(1)

// Note 3: 19-TET major third (6 steps)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(6, 19)))
startTime: module.getNoteById(2).getVariable('startTime')
  .add(module.getNoteById(2).getVariable('duration'))
duration: new Fraction(1)

// Note 4: 19-TET perfect fourth (8 steps)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(8, 19)))
startTime: module.getNoteById(3).getVariable('startTime')
  .add(module.getNoteById(3).getVariable('duration'))
duration: new Fraction(1)
```

### Example: Just Intonation Chord

```javascript
// Root
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(2)

// Pure major third
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(5, 4))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// Pure perfect fifth
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(3, 2))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// Harmonic seventh (for a dominant seventh chord)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(7, 4))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')
```

## The ≈ Symbol

When you use irrational values (like 2^(1/12)), RMT Compose displays ≈ before the frequency value:

```
≈ 466.16 Hz
```

This indicates the displayed value is an approximation of an algebraically exact value. The internal computation preserves full precision through the SymbolicPower system.

## Comparing Tuning Systems

### Hear the Difference

Create the same melody in different tunings:

1. **12-TET version**: Use `new Fraction(2).pow(new Fraction(N, 12))`
2. **Just intonation version**: Use pure ratios like `5/4`, `3/2`
3. **19-TET version**: Use `new Fraction(2).pow(new Fraction(N, 19))`

Compare the sound quality, especially on sustained chords.

### Interval Comparison Table

| Interval | Pure | 12-TET | 19-TET | 31-TET |
|----------|------|--------|--------|--------|
| Major 2nd | 9/8 | 2^(2/12) | 2^(3/19) | 2^(5/31) |
| Major 3rd | 5/4 | 2^(4/12) | 2^(6/19) | 2^(10/31) |
| Perfect 4th | 4/3 | 2^(5/12) | 2^(8/19) | 2^(13/31) |
| Perfect 5th | 3/2 | 2^(7/12) | 2^(11/19) | 2^(18/31) |
| Major 6th | 5/3 | 2^(9/12) | 2^(14/19) | 2^(23/31) |

## Tips for Microtonal Composition

### 1. Start with Familiar Structures

Build chords and scales you know, then substitute microtonal intervals.

### 2. Trust Your Ears

Numbers guide you, but the sound is what matters. Experiment!

### 3. Use Pure Intervals for Sustained Sounds

Irrational TET intervals can cause subtle beating on long notes. Pure ratios sound smoother.

### 4. Explore the Module Library

Load pre-built TET scales from the Module Bar to experiment quickly.

### 5. Document Your Discoveries

Save interesting microtonal modules with descriptive names for future use.

## Next Steps

- [SymbolicPower Algebra](/tutorials/advanced/symbolic-power) - Deep dive into irrational number handling
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) - Build sophisticated note relationships
- [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) - Practical experimentation workflow

