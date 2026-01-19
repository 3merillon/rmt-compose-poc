# Pure Ratios (Just Intonation)

**Pure ratios** are the foundation of RMT Compose. They represent musical intervals as exact fractions derived from the natural harmonic series.

## What Are Pure Ratios?

When a string vibrates, it produces a fundamental frequency plus **overtones** at integer multiples:

| Harmonic | Multiple | Note (if fundamental = C) |
|----------|----------|---------------------------|
| 1st | 1× | C |
| 2nd | 2× | C (octave) |
| 3rd | 3× | G |
| 4th | 4× | C (two octaves) |
| 5th | 5× | E |
| 6th | 6× | G |
| 7th | 7× | B♭ (slightly flat) |
| 8th | 8× | C (three octaves) |

Pure ratios capture these natural relationships.

## Common Intervals

### Perfect Consonances

| Interval | Ratio | Decimal | Sound |
|----------|-------|---------|-------|
| Unison | 1/1 | 1.000 | Same pitch |
| Octave | 2/1 | 2.000 | Same note, higher |
| Perfect fifth | 3/2 | 1.500 | Very stable |
| Perfect fourth | 4/3 | 1.333 | Stable |

### Imperfect Consonances

| Interval | Ratio | Decimal | Sound |
|----------|-------|---------|-------|
| Major third | 5/4 | 1.250 | Bright, happy |
| Minor third | 6/5 | 1.200 | Dark, sad |
| Major sixth | 5/3 | 1.667 | Warm |
| Minor sixth | 8/5 | 1.600 | Melancholic |

### Seconds and Sevenths

| Interval | Ratio | Decimal | Sound |
|----------|-------|---------|-------|
| Major second | 9/8 | 1.125 | Whole step |
| Minor second | 16/15 | 1.067 | Half step |
| Major seventh | 15/8 | 1.875 | Tension |
| Minor seventh | 7/4 | 1.750 | Bluesy |

## Using Ratios in RMT Compose

### Expression Syntax

```javascript
// Perfect fifth above BaseNote
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Major third below (divide instead of multiply)
module.baseNote.getVariable('frequency').div(new Fraction(5, 4))

// Chain intervals: fifth + third = major seventh
module.baseNote.getVariable('frequency')
  .mul(new Fraction(3, 2))
  .mul(new Fraction(5, 4))
// = 3/2 × 5/4 = 15/8
```

### Building Scales

#### Major Scale (Just Intonation)

| Degree | Ratio | Interval from root |
|--------|-------|-------------------|
| 1 (Do) | 1/1 | Unison |
| 2 (Re) | 9/8 | Major second |
| 3 (Mi) | 5/4 | Major third |
| 4 (Fa) | 4/3 | Perfect fourth |
| 5 (Sol) | 3/2 | Perfect fifth |
| 6 (La) | 5/3 | Major sixth |
| 7 (Ti) | 15/8 | Major seventh |
| 8 (Do) | 2/1 | Octave |

#### Minor Scale (Just Intonation)

| Degree | Ratio | Interval from root |
|--------|-------|-------------------|
| 1 | 1/1 | Unison |
| 2 | 9/8 | Major second |
| 3 | 6/5 | Minor third |
| 4 | 4/3 | Perfect fourth |
| 5 | 3/2 | Perfect fifth |
| 6 | 8/5 | Minor sixth |
| 7 | 9/5 | Minor seventh |
| 8 | 2/1 | Octave |

### Building Chords

#### Major Triad

| Note | Ratio | Interval |
|------|-------|----------|
| Root | 1/1 | - |
| Third | 5/4 | Major third |
| Fifth | 3/2 | Perfect fifth |

```javascript
root.frequency = module.baseNote.getVariable('frequency')
third.frequency = module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
fifth.frequency = module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```

#### Minor Triad

| Note | Ratio | Interval |
|------|-------|----------|
| Root | 1/1 | - |
| Third | 6/5 | Minor third |
| Fifth | 3/2 | Perfect fifth |

## Why Pure Ratios?

### Advantages

1. **Resonance**: Pure intervals align with the overtone series, creating clear, ringing sounds
2. **Exactness**: No rounding or approximation - `3/2` is exactly `3/2`
3. **Mathematical elegance**: Operations stay exact (`3/2 × 5/4 = 15/8`)
4. **Flexibility**: Any ratio can be expressed

### Limitations

1. **Wolf intervals**: Some keys sound worse than others
2. **Modulation**: Changing keys can sound jarring
3. **Instrument compatibility**: Standard instruments are tuned to 12-TET

## Comparison with Equal Temperament

| Interval | Just Ratio | Just Decimal | 12-TET Decimal | Difference |
|----------|------------|--------------|----------------|------------|
| Perfect fifth | 3/2 | 1.5000 | 1.4983 | -0.11% |
| Major third | 5/4 | 1.2500 | 1.2599 | +0.79% |
| Minor third | 6/5 | 1.2000 | 1.1892 | -0.90% |

The differences are audible! Pure thirds sound "sweeter" than 12-TET thirds.

## Tips for Using Pure Ratios

1. **Start with fifths and thirds** - They're the most consonant
2. **Listen carefully** - Pure intervals have a distinct quality
3. **Combine thoughtfully** - Not all ratios combine well
4. **Use octave transposition** - Multiply/divide by 2 to shift octaves
5. **Experiment freely** - RMT makes it easy to try unusual ratios

## Extended Just Intonation

Beyond the basic intervals, you can explore:

| Ratio | Approximate Interval |
|-------|---------------------|
| 7/6 | Septimal minor third |
| 7/5 | Tritone (septimal) |
| 11/8 | Undecimal fourth |
| 13/8 | Tridecimal sixth |

These intervals from the 7th, 11th, and 13th harmonics create unique, "otherworldly" sounds not found in Western music.

## Next Steps

- Learn about [Equal Temperament](./equal-temperament) for an alternative approach
- Try the [Build a Major Scale](/tutorials/beginner/major-scale) tutorial
- Explore the [Expression Syntax Reference](/reference/expressions/syntax)
