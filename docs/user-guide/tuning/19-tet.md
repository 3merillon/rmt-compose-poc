# 19-TET

**19-TET** (19-Tone Equal Temperament) divides the octave into 19 equal steps. It offers better approximations of pure thirds than 12-TET while remaining relatively accessible.

## Overview

| Property | Value |
|----------|-------|
| Steps per octave | 19 |
| Step ratio | 2^(1/19) ≈ 1.03716 |
| Octave ratio | 2:1 (exact) |

## Why 19-TET?

19-TET was explored by Renaissance theorists and has these advantages:

1. **Better major thirds**: 6 steps = 2^(6/19) ≈ 1.2447 (vs just 5/4 = 1.25)
2. **Better minor thirds**: 5 steps = 2^(5/19) ≈ 1.2002 (vs just 6/5 = 1.20)
3. **Good fifths**: 11 steps = 2^(11/19) ≈ 1.4946 (vs just 3/2 = 1.50)
4. **More notes**: Microtonal possibilities

## Expression Syntax

### Single Step

```
// One 19-TET step
2^(1/19)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(2).pow(new Fraction(1, 19))
```
</details>

### Multiple Steps

```
// Major third (6 steps in 19-TET)
2^(6/19)

// Perfect fifth (11 steps in 19-TET)
2^(11/19)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Major third (6 steps in 19-TET)
new Fraction(2).pow(new Fraction(6, 19))

// Perfect fifth (11 steps in 19-TET)
new Fraction(2).pow(new Fraction(11, 19))
```
</details>

### Applying to BaseNote

```
// Note at 6 steps above BaseNote (major third)
base.f * 2^(6/19)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(6, 19))
)
```
</details>

## Intervals in 19-TET

| Interval | 19-TET Steps | 12-TET equivalent | Quality |
|----------|-------------|-------------------|---------|
| Minor second | 2 | ~1 | Smaller |
| Major second | 3 | ~2 | Similar |
| Minor third | 5 | ~3 | Very good |
| Major third | 6 | ~4 | Very good |
| Perfect fourth | 8 | ~5 | Good |
| Tritone | 9-10 | ~6 | Two options |
| Perfect fifth | 11 | ~7 | Good |
| Minor sixth | 13 | ~8 | Very good |
| Major sixth | 14 | ~9 | Very good |
| Minor seventh | 16 | ~10 | Good |
| Major seventh | 17 | ~11 | Good |
| Octave | 19 | 12 | Perfect |

## Comparison with Just Intonation

| Interval | Just | 19-TET | Cents off |
|----------|------|--------|-----------|
| Perfect fifth | 3/2 | 2^(11/19) | -7.2 |
| Major third | 5/4 | 2^(6/19) | -7.4 |
| Minor third | 6/5 | 2^(5/19) | +0.1 |
| Major sixth | 5/3 | 2^(14/19) | +7.3 |

The thirds are significantly better than 12-TET!

## Using the TET-19 Module

1. Open the **Module Bar**
2. Find **Melodies** category
3. Drag **TET-19** onto the workspace

## Building a 19-TET Scale

```
// Each note references the previous
note2.frequency = [1].f * 2^(1/19)
note3.frequency = [2].f * 2^(1/19)
// ... continue for all 19 notes
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Each note references the previous
note2.frequency = note1.frequency.mul(
  new Fraction(2).pow(new Fraction(1, 19))
)
note3.frequency = note2.frequency.mul(
  new Fraction(2).pow(new Fraction(1, 19))
)
// ... continue for all 19 notes
```
</details>

## Musical Applications

### Better Harmony

19-TET's thirds sound closer to pure intervals:
- Major triads have a warmer, more consonant sound
- Minor triads are closer to the natural minor third

### Microtonal Exploration

The extra 7 notes per octave enable:
- Finer pitch distinctions
- New melodic possibilities
- Unique scales not available in 12-TET

### Split Accidentals

In 19-TET, sharps and flats are distinct:
- C# ≠ Db (they're different pitches!)
- This enables enharmonic distinctions

## Challenges

### Different Intervals

Musicians familiar with 12-TET need to relearn interval fingerings.

### Limited Instruments

Few acoustic instruments are built for 19-TET. RMT Compose is ideal for exploring it.

### Notation

Standard notation doesn't represent 19 pitches well. New notation systems exist but aren't standardized.

## Tips

1. **Start with triads** - Hear how much better the thirds sound
2. **Use the module** - Load TET-19 to hear the scale
3. **Compare with 12-TET** - Play the same melody in both systems
4. **Explore new scales** - 19-TET enables scales impossible in 12-TET

## Next Steps

- Try [31-TET](./31-tet) for even higher resolution
- Explore [Bohlen-Pierce](./bohlen-pierce) for a completely different approach
- Create your own system with [Custom TET](./custom-tet)
