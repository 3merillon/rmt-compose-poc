# Working with Octaves

Learn techniques for octave manipulation using frequency ratios and the power operation.

## The Octave Ratio

An octave is the simplest frequency ratio: **2:1**

When you double a frequency, you go up one octave:
- 440 Hz × 2 = 880 Hz (one octave up)
- 440 Hz × 4 = 1760 Hz (two octaves up)
- 440 Hz ÷ 2 = 220 Hz (one octave down)

## Basic Octave Operations

### One Octave Up

```
[1].f * 2
```

### One Octave Down

```
[1].f / 2
```

### Multiple Octaves

```
// Two octaves up (multiply by 4)
[1].f * 4

// Three octaves down (divide by 8)
[1].f / 8
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// One octave up
module.getNoteById(1).getVariable('frequency').mul(new Fraction(2))

// One octave down
module.getNoteById(1).getVariable('frequency').div(new Fraction(2))

// Two octaves up (multiply by 4)
module.getNoteById(1).getVariable('frequency').mul(new Fraction(4))

// Three octaves down (divide by 8)
module.getNoteById(1).getVariable('frequency').div(new Fraction(8))
```

</details>

## Using the Power Operation

For variable octave shifts, use `^`:

```
// n octaves up: frequency × 2^n
[1].f * 2^n

// n octaves down: frequency × 2^(-n)
[1].f * 2^(-n)
```

### Examples

```
// 2 octaves up using pow
frequency * 2^2  // × 4

// 1 octave down using pow
frequency * 2^(-1) // × 0.5
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// n octaves up: frequency × 2^n
module.getNoteById(1).getVariable('frequency').mul(new Fraction(2).pow(new Fraction(n)))

// n octaves down: frequency × 2^(-n)
module.getNoteById(1).getVariable('frequency').mul(new Fraction(2).pow(new Fraction(-n)))

// 2 octaves up using pow
frequency.mul(new Fraction(2).pow(new Fraction(2)))  // × 4

// 1 octave down using pow
frequency.mul(new Fraction(2).pow(new Fraction(-1))) // × 0.5
```

</details>

## Octave Equivalence

Notes separated by octaves are considered "equivalent" in music. A perfect fifth above A4 (440 Hz) is E5 (660 Hz). You can also play:
- E4 (330 Hz) - one octave below
- E6 (1320 Hz) - one octave above

### Bringing Notes into Range

If a note is too high or low, shift it by octaves:

```
// Original: way too high
[1].f * (3/2)

// Bring down an octave
[1].f * (3/2) / 2

// Same as:
[1].f * (3/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Original: way too high
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))

// Bring down an octave
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2)).div(new Fraction(2))

// Same as:
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 4))
```

</details>

## Building Octave Patterns

### Octave Doubling (Parallel Octaves)

Create a bass note that always plays an octave below the melody:

```
// Melody note
frequency: base.f * (3/2)

// Bass note (same timing, one octave down)
frequency: [MELODY_ID].f / 2
startTime: [MELODY_ID].t
duration: [MELODY_ID].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Melody note
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Bass note (same timing, one octave down)
frequency: module.getNoteById(MELODY_ID).getVariable('frequency').div(new Fraction(2))
startTime: module.getNoteById(MELODY_ID).getVariable('startTime')
duration: module.getNoteById(MELODY_ID).getVariable('duration')
```

</details>

### Arpeggiated Octaves

Play the same note across multiple octaves in sequence:

```
// Note 1: Root
frequency: base.f
startTime: 0
duration: 1/4

// Note 2: One octave up
frequency: [1].f * 2
startTime: [1].t + [1].d
duration: 1/4

// Note 3: Two octaves up
frequency: [2].f * 2
startTime: [2].t + [2].d
duration: 1/4

// Note 4: Back to root
frequency: [1].f
startTime: [3].t + [3].d
duration: 1/4
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: Root
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1, 4)

// Note 2: One octave up
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(2))
startTime: module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(1, 4)

// Note 3: Two octaves up
frequency: module.getNoteById(2).getVariable('frequency').mul(new Fraction(2))
startTime: module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))
duration: new Fraction(1, 4)

// Note 4: Back to root
frequency: module.getNoteById(1).getVariable('frequency')
startTime: module.getNoteById(3).getVariable('startTime').add(module.getNoteById(3).getVariable('duration'))
duration: new Fraction(1, 4)
```

</details>

## Octaves with Intervals

### Compound Intervals

A compound interval spans more than an octave. For example, a "9th" is an octave plus a second:

```
// Major 9th = octave (2/1) × major 2nd (9/8) = 9/4
[1].f * (9/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency').mul(new Fraction(9, 4))
```

</details>

### Reducing to Simple Intervals

Any interval can be reduced to within one octave:

| Compound Interval | Ratio | Simple Equivalent |
|-------------------|-------|-------------------|
| Major 9th | 9/4 | Major 2nd (9/8) |
| Minor 10th | 12/5 | Minor 3rd (6/5) |
| Perfect 11th | 8/3 | Perfect 4th (4/3) |
| Perfect 12th | 3/1 | Perfect 5th (3/2) |

```
// Major 9th (compound)
frequency * (9/4)

// Reduced to Major 2nd (same pitch class, lower octave)
frequency * (9/8)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Major 9th (compound)
frequency.mul(new Fraction(9, 4))

// Reduced to Major 2nd (same pitch class, lower octave)
frequency.mul(new Fraction(9, 8))
```

</details>

## Practical Example: Octave-Spanning Chord

Build a wide voicing of a C major chord:

```
// C3 (root, low)
frequency: base.f / 2  // 220 Hz
startTime: 0
duration: 2

// G3 (fifth, mid-low)
frequency: [1].f * (3/2)  // 330 Hz
startTime: [1].t
duration: [1].d

// E4 (third, mid)
frequency: [1].f * (5/2)  // 550 Hz
startTime: [1].t
duration: [1].d

// C5 (octave, high)
frequency: [1].f * 4  // 880 Hz
startTime: [1].t
duration: [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// C3 (root, low)
frequency: module.baseNote.getVariable('frequency').div(new Fraction(2))  // 220 Hz
startTime: new Fraction(0)
duration: new Fraction(2)

// G3 (fifth, mid-low)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))  // 330 Hz
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// E4 (third, mid)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 2))  // 550 Hz
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// C5 (octave, high)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(4))  // 880 Hz
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')
```

</details>

## Tips for Working with Octaves

### 1. Keep Reference Notes in a Comfortable Range

Start with frequencies in the middle range (200-800 Hz) and adjust from there.

### 2. Use Consistent Octave References

When multiple notes need to be in the same octave, reference a common note:

```
// All notes in this phrase reference the same octave anchor (Note 1)

// Note A: Major third above anchor
frequency: [1].f * (5/4)

// Note B: Perfect fifth above anchor
frequency: [1].f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// All notes in this phrase reference the same octave anchor
const anchorFreq = module.getNoteById(1).getVariable('frequency')

// Note A: Major third above anchor
frequency: anchorFreq.mul(new Fraction(5, 4))

// Note B: Perfect fifth above anchor
frequency: anchorFreq.mul(new Fraction(3, 2))
```

</details>

### 3. Hear the Full Range

Test your composition with notes spanning multiple octaves to ensure balance.

## Common Octave Ratios Quick Reference

| Operation | Ratio | Expression |
|-----------|-------|------------|
| 1 octave up | 2/1 | `* 2` |
| 1 octave down | 1/2 | `/ 2` |
| 2 octaves up | 4/1 | `* 4` |
| 2 octaves down | 1/4 | `/ 4` |
| 3 octaves up | 8/1 | `* 8` |
| 3 octaves down | 1/8 | `/ 8` |

## Next Steps

- [Measure-Based Timing](./measures) - Tempo and beat dependencies
- [Microtonal Composition](/tutorials/advanced/microtonal) - Beyond standard tuning
- [Tuning Systems](/user-guide/tuning/ratios) - Understanding pure ratios

