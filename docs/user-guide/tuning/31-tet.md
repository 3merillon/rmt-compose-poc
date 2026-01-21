# 31-TET

**31-TET** (31-Tone Equal Temperament) divides the octave into 31 equal steps. It provides excellent approximations to just intonation intervals and is considered one of the best meantone temperaments.

## Overview

| Property | Value |
|----------|-------|
| Steps per octave | 31 |
| Step ratio | 2^(1/31) ≈ 1.02263 |
| Octave ratio | 2:1 (exact) |

## Why 31-TET?

31-TET was studied by Christiaan Huygens in the 17th century. It offers:

1. **Excellent thirds**: Nearly pure major and minor thirds
2. **Good fifths**: Close to just intonation
3. **Septimal intervals**: Good approximation of 7-limit ratios
4. **High resolution**: Fine pitch control for microtonal music

## Expression Syntax

### Single Step

```
// One 31-TET step
2^(1/31)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(2).pow(new Fraction(1, 31))
```
</details>

### Multiple Steps

```
// Major third (10 steps in 31-TET)
2^(10/31)

// Perfect fifth (18 steps in 31-TET)
2^(18/31)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Major third (10 steps in 31-TET)
new Fraction(2).pow(new Fraction(10, 31))

// Perfect fifth (18 steps in 31-TET)
new Fraction(2).pow(new Fraction(18, 31))
```
</details>

### Applying to BaseNote

```
// Note at 10 steps above BaseNote (major third)
base.f * 2^(10/31)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(10, 31))
)
```
</details>

## Intervals in 31-TET

| Interval | 31-TET Steps | Just Ratio | Quality |
|----------|-------------|------------|---------|
| Minor second | 3 | 16/15 | Excellent |
| Major second | 5 | 9/8 | Good |
| Minor third | 8 | 6/5 | Excellent |
| Major third | 10 | 5/4 | Excellent |
| Perfect fourth | 13 | 4/3 | Good |
| Tritone | 15-16 | 7/5 or 10/7 | Two options |
| Perfect fifth | 18 | 3/2 | Very good |
| Minor sixth | 21 | 8/5 | Excellent |
| Major sixth | 23 | 5/3 | Excellent |
| Septimal seventh | 25 | 7/4 | Very good |
| Minor seventh | 26 | 9/5 | Good |
| Major seventh | 28 | 15/8 | Good |
| Octave | 31 | 2/1 | Perfect |

## Comparison with Just Intonation

| Interval | Just | 31-TET | Cents off |
|----------|------|--------|-----------|
| Perfect fifth | 3/2 | 2^(18/31) | -5.2 |
| Major third | 5/4 | 2^(10/31) | +0.8 |
| Minor third | 6/5 | 2^(8/31) | -5.9 |
| Septimal seventh | 7/4 | 2^(25/31) | +1.1 |

The thirds are remarkably close to pure!

## Using the TET-31 Module

1. Open the **Module Bar**
2. Find **Melodies** category
3. Drag **TET-31** onto the workspace

## 7-Limit Harmony

31-TET approximates 7-limit just intonation well:

| Interval | Ratio | 31-TET Steps |
|----------|-------|-------------|
| Septimal minor third | 7/6 | 7 |
| Septimal tritone | 7/5 | 15 |
| Septimal minor seventh | 7/4 | 25 |

This enables "blue notes" and jazz-like harmony with mathematical precision.

## Notation Systems

31-TET has several notation approaches:

### Ups and Downs

Uses arrows to modify standard pitches:
- C, C^, C#, Cv, C##... (^ = up, v = down)

### Half-Sharp/Half-Flat

Uses additional accidentals:
- C, C half-sharp, C#, C three-quarter-sharp...

### Color Names

Based on just intonation approximations:
- "red" notes (5-limit: 5/4, 5/3)
- "blue" notes (7-limit: 7/4, 7/6)

## Musical Applications

### Meantone Repertoire

Historical music written for meantone temperament sounds excellent in 31-TET.

### Extended Harmony

Jazz and contemporary music can use septimal intervals for:
- More consonant dominant sevenths
- "Natural" blue notes
- Extended chord voicings

### Microtonal Composition

31 notes per octave enable:
- Subtle pitch variations
- Glissando-like melodic lines
- New harmonic possibilities

## Challenges

### Complexity

31 pitches per octave require careful organization.

### Learning Curve

Musicians need significant retraining.

### Instruments

Very few physical instruments support 31-TET. RMT Compose is an excellent tool for exploration.

## Tips

1. **Focus on triads first** - Appreciate the pure thirds
2. **Try septimal intervals** - 7/4 and 7/6 have unique colors
3. **Compare with 12-TET** - The difference in thirds is dramatic
4. **Use as a reference** - Even if you don't compose in 31-TET, hearing pure intervals trains your ear

## Example: Major Triad in 31-TET

```
// Root
root.frequency = base.f

// Major third (10 steps)
third.frequency = base.f * 2^(10/31)

// Perfect fifth (18 steps)
fifth.frequency = base.f * 2^(18/31)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Root
root.frequency = module.baseNote.getVariable('frequency')

// Major third (10 steps)
third.frequency = module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(10, 31))
)

// Perfect fifth (18 steps)
fifth.frequency = module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(18, 31))
)
```
</details>

This triad sounds remarkably pure compared to 12-TET!

## Next Steps

- Explore [Bohlen-Pierce](./bohlen-pierce) for a non-octave system
- Create your own system with [Custom TET](./custom-tet)
- Return to [Pure Ratios](./ratios) to compare with just intonation
