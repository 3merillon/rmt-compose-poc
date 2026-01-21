# Bohlen-Pierce Scale

The **Bohlen-Pierce (BP)** scale is a unique tuning system that uses the **tritave** (3:1) instead of the octave (2:1) as its primary interval. It creates an otherworldly, distinctive sound unlike traditional Western music.

## Overview

| Property | Value |
|----------|-------|
| Interval of equivalence | Tritave (3:1) |
| Steps per tritave | 13 |
| Step ratio | 3^(1/13) ≈ 1.08818 |

## What Makes BP Different?

### The Tritave

Traditional music treats the octave (2:1) as the interval of "equivalence" - notes an octave apart are considered the "same" note.

Bohlen-Pierce uses the **tritave** (3:1) instead:
- Notes a tritave apart are considered equivalent
- The 3:1 ratio comes from the third harmonic
- This creates a fundamentally different harmonic experience

### No Octaves!

BP explicitly avoids the 2:1 ratio:
- There are no octave equivalents
- The sense of "returning home" at the octave is absent
- This creates an alien, floating quality

## Expression Syntax

### Single BP Step

```
// One BP step
3^(1/13)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(3).pow(new Fraction(1, 13))
```
</details>

### Multiple Steps

```
// BP "fifth" (6 steps)
3^(6/13)

// Full tritave (13 steps)
3^(13/13)  // = 3
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// BP "fifth" (6 steps)
new Fraction(3).pow(new Fraction(6, 13))

// Full tritave (13 steps)
new Fraction(3).pow(new Fraction(13, 13))  // = 3
```
</details>

### Applying to BaseNote

```
// Note at 3 steps above BaseNote
base.f * 3^(3/13)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(
  new Fraction(3).pow(new Fraction(3, 13))
)
```
</details>

## The BP-13 Scale

| Step | Approximate Ratio | Cents |
|------|------------------|-------|
| 0 | 1/1 | 0 |
| 1 | 27/25 | 146 |
| 2 | 25/21 | 293 |
| 3 | 9/7 | 435 |
| 4 | 7/5 | 583 |
| 5 | 75/49 | 731 |
| 6 | 5/3 | 884 |
| 7 | 9/5 | 1018 |
| 8 | 49/25 | 1165 |
| 9 | 15/7 | 1319 |
| 10 | 7/3 | 1467 |
| 11 | 63/25 | 1600 |
| 12 | 25/9 | 1755 |
| 13 | 3/1 | 1902 |

## Using the BP-13 Module

1. Open the **Module Bar**
2. Find **Melodies** category
3. Drag **BP-13** onto the workspace

Listen carefully - you'll hear the tritave "closure" at step 13, not an octave!

## BP Intervals

The BP scale has its own interval vocabulary:

| BP Interval | Steps | Ratio Approximation |
|-------------|-------|---------------------|
| BP minor second | 1 | 27/25 |
| BP major second | 2 | 25/21 |
| BP minor third | 3 | 9/7 |
| BP major third | 4 | 7/5 |
| BP fourth | 5 | 75/49 |
| BP fifth | 6 | 5/3 |
| BP sixth | 7 | 9/5 |
| BP seventh | 8 | 49/25 |
| BP eighth | 9 | 15/7 |
| BP ninth | 10 | 7/3 |
| BP tenth | 11 | 63/25 |
| BP eleventh | 12 | 25/9 |
| Tritave | 13 | 3/1 |

## BP Triads

Traditional triads don't work in BP (they use 2:1 relationships). Instead:

### BP Major Triad

Steps: 0, 4, 9 (ratios approximately 1:7/5:15/7)

```
root.frequency = base.f
third.frequency = base.f * 3^(4/13)
fifth.frequency = base.f * 3^(9/13)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
root.frequency = baseNote.frequency
third.frequency = baseNote.frequency.mul(new Fraction(3).pow(new Fraction(4, 13)))
fifth.frequency = baseNote.frequency.mul(new Fraction(3).pow(new Fraction(9, 13)))
```
</details>

### BP Minor Triad

Steps: 0, 3, 9 (ratios approximately 1:9/7:15/7)

```
root.frequency = base.f
third.frequency = base.f * 3^(3/13)
fifth.frequency = base.f * 3^(9/13)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
root.frequency = baseNote.frequency
third.frequency = baseNote.frequency.mul(new Fraction(3).pow(new Fraction(3, 13)))
fifth.frequency = baseNote.frequency.mul(new Fraction(3).pow(new Fraction(9, 13)))
```
</details>

## Why Use Bohlen-Pierce?

### Unique Sound

BP creates sounds impossible in traditional music:
- No sense of octave return
- Different consonance/dissonance relationships
- Alien, otherworldly quality

### Odd Harmonics

BP emphasizes odd-numbered harmonics (3, 5, 7, 9...):
- Clarinet-like timbres (which naturally emphasize odd harmonics) work well
- Square waves sound particularly at home

### Theoretical Interest

BP explores what music could sound like in an alternate universe with different acoustical foundations.

## Challenges

### Unfamiliar

Everything you know about Western harmony doesn't apply directly.

### Emotional Ambiguity

Without familiar major/minor distinctions, emotional content is less predictable.

### Limited Repertoire

Very little music exists in BP. You're exploring new territory!

## Instruments for BP

- **Clarinets**: Natural affinity for odd harmonics
- **Synthesizers**: RMT Compose is perfect for BP exploration
- **Custom-built instruments**: Some instruments have been built specifically for BP

## Tips

1. **Listen without expectations** - Don't look for octaves or traditional intervals
2. **Start with the BP-13 module** - Hear the complete scale first
3. **Try BP triads** - They're consonant in their own way
4. **Use odd-harmonic timbres** - Square waves, clarinets
5. **Embrace the strangeness** - That's the point!

## Example: BP Scale

```
// Build a 13-note BP scale
note1.frequency = base.f
note2.frequency = [1].f * 3^(1/13)
note3.frequency = [2].f * 3^(1/13)
// ... continue for all 13 notes
note14.frequency = [13].f * 3^(1/13)
// note14 = 3 × baseNote (tritave)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Build a 13-note BP scale
note1.frequency = baseNote.frequency
note2.frequency = note1.frequency.mul(new Fraction(3).pow(new Fraction(1, 13)))
note3.frequency = note2.frequency.mul(new Fraction(3).pow(new Fraction(1, 13)))
// ... continue for all 13 notes
note14.frequency = note13.frequency.mul(new Fraction(3).pow(new Fraction(1, 13)))
// note14 = 3 × baseNote (tritave)
```
</details>

## Next Steps

- Create your own system with [Custom TET](./custom-tet)
- Return to [Pure Ratios](./ratios) for comparison
- Explore [12-TET](./12-tet) to appreciate what's different
