# Interval Exploration

A systematic workflow for understanding and experimenting with musical intervals using RMT Compose.

## What Are Intervals?

An interval is the distance between two pitches. In RMT Compose, intervals are expressed as frequency ratios:

| Interval | Ratio | Cents | Description |
|----------|-------|-------|-------------|
| Unison | 1/1 | 0 | Same pitch |
| Minor Second | 16/15 | 112 | Half step |
| Major Second | 9/8 | 204 | Whole step |
| Minor Third | 6/5 | 316 | Sad quality |
| Major Third | 5/4 | 386 | Happy quality |
| Perfect Fourth | 4/3 | 498 | Open sound |
| Tritone | 45/32 | 590 | Tense, unstable |
| Perfect Fifth | 3/2 | 702 | Strong consonance |
| Minor Sixth | 8/5 | 814 | Somewhat dark |
| Major Sixth | 5/3 | 884 | Bright |
| Minor Seventh | 9/5 | 1018 | Jazzy tension |
| Major Seventh | 15/8 | 1088 | Leading tone |
| Octave | 2/1 | 1200 | Same note, higher |

## Setting Up an Interval Lab

### Step 1: Create the Reference Note

```
// Note 1: Reference pitch
frequency: base.f
startTime: 0
duration: 2
```

### Step 2: Create the Interval Note

```
// Note 2: Interval above reference
frequency: [1].f * (3/2)  // Perfect fifth
startTime: [1].t
duration: [1].d
```

### Step 3: Experiment

Change the ratio in Note 2 to hear different intervals. Both notes play simultaneously for direct comparison.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: Reference pitch
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(2)

// Note 2: Interval above reference
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))  // Perfect fifth
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')
```

</details>

## Workflow: Systematic Interval Study

### Phase 1: Perfect Consonances

Start with the most stable intervals:

```
// Unison
* (1/1)

// Octave
* 2

// Perfect Fifth
* (3/2)

// Perfect Fourth
* (4/3)
```

**Listen for**: Clarity, lack of beating, stability

### Phase 2: Imperfect Consonances

Move to pleasing but less stable intervals:

```
// Major Third
* (5/4)

// Minor Third
* (6/5)

// Major Sixth
* (5/3)

// Minor Sixth
* (8/5)
```

**Listen for**: Warmth, color, character differences

### Phase 3: Dissonances

Explore tension-creating intervals:

```
// Major Second
* (9/8)

// Minor Second
* (16/15)

// Major Seventh
* (15/8)

// Minor Seventh
* (9/5)

// Tritone
* (45/32)
```

**Listen for**: Tension, desire to resolve, roughness

## Comparing Pure vs Tempered

### Setup

Create two interval notes:

```
// Note 2: Pure major third (5/4)
frequency: [1].f * (5/4)

// Note 3: 12-TET major third (4 semitones)
frequency: [1].f * 2^(4/12)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 2: Pure major third (5/4)
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Note 3: 12-TET major third (4 semitones)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(4, 12)))
```

</details>

### Listen Carefully

1. Play Note 1 + Note 2 (pure third) - smooth, beatless
2. Play Note 1 + Note 3 (tempered third) - subtle beating

The difference is ~14 cents, audible on sustained tones.

## Interval Inversion

Every interval has an inversion that completes the octave:

| Interval | Ratio | Inversion | Ratio |
|----------|-------|-----------|-------|
| Minor 2nd | 16/15 | Major 7th | 15/8 |
| Major 2nd | 9/8 | Minor 7th | 16/9 |
| Minor 3rd | 6/5 | Major 6th | 5/3 |
| Major 3rd | 5/4 | Minor 6th | 8/5 |
| Perfect 4th | 4/3 | Perfect 5th | 3/2 |
| Tritone | 45/32 | Tritone | 64/45 |

### Exploring Inversions

```
// Original: Major third above
frequency: [1].f * (5/4)

// Inversion: Minor sixth below (same pitch class, lower octave)
frequency: [1].f / (8/5)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Original: Major third above
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Inversion: Minor sixth below (same pitch class, lower octave)
frequency: module.getNoteById(1).getVariable('frequency').div(new Fraction(8, 5))
```

</details>

## Compound Intervals

Intervals larger than an octave:

```
// Minor 9th (octave + minor 2nd)
* (32/15)

// Major 9th (octave + major 2nd)
* (9/4)

// Minor 10th (octave + minor 3rd)
* (12/5)

// Major 10th (octave + major 3rd)
* (5/2)

// Perfect 11th (octave + perfect 4th)
* (8/3)

// Perfect 12th (octave + perfect 5th)
* 3
```

## Interval Chains

Build scales by stacking intervals:

### Pythagorean Tuning (Stacking Fifths)

```
// Stack perfect fifths, reduce to one octave

// C (root)
* (1/1)

// G (fifth)
* (3/2)

// D (brought down an octave: 3/2 × 3/2 ÷ 2 = 9/8)
* (9/8)

// A (9/8 × 3/2 = 27/16)
* (27/16)

// E (27/16 × 3/2 ÷ 2 = 81/64)
* (81/64)
```

### Third-Based Tuning (5-Limit)

Use ratios with factors of 2, 3, and 5:

```
// Major scale using just thirds

// C (root)
* (1/1)

// D (major second: 9/8)
* (9/8)

// E (major third: 5/4)
* (5/4)

// F (perfect fourth: 4/3)
* (4/3)

// G (perfect fifth: 3/2)
* (3/2)

// A (major sixth: 5/3)
* (5/3)

// B (major seventh: 15/8)
* (15/8)
```

## Hearing the Harmonic Series

The harmonic series contains all pure intervals:

```
// Fundamental
* 1   // 440 Hz

// 2nd harmonic (octave)
* 2   // 880 Hz

// 3rd harmonic (octave + fifth)
* 3   // 1320 Hz

// 4th harmonic (two octaves)
* 4   // 1760 Hz

// 5th harmonic (two octaves + major third)
* 5   // 2200 Hz

// 6th harmonic (two octaves + fifth)
* 6   // 2640 Hz

// 7th harmonic (two octaves + minor seventh - slightly flat)
* 7   // 3080 Hz
```

### Reducing to One Octave

Bring harmonics into the same octave:

```
// 3rd harmonic → fifth: 3/2
* (3/2)

// 5th harmonic → major third: 5/4
* (5/4)

// 7th harmonic → harmonic seventh: 7/4
* (7/4)
```

## Interval Quality Exploration

### Consonance vs Dissonance

Create a progression from most consonant to most dissonant:

```
// Most consonant
* 1        // Unison
* 2        // Octave
* (3/2)    // Fifth
* (4/3)    // Fourth
* (5/4)    // Major third
* (6/5)    // Minor third

// More dissonant
* (9/8)    // Major second
* (16/15)  // Minor second
* (45/32)  // Tritone
```

### Character Comparison

Compare intervals with similar sizes but different qualities:

```
// Major vs Minor Third
* (5/4)    // Major: bright
* (6/5)    // Minor: dark

// Major vs Minor Second
* (9/8)    // Major: open
* (16/15)  // Minor: tight

// Major vs Minor Seventh
* (15/8)   // Major: leading
* (9/5)    // Minor: bluesy
```

## Saving Your Discoveries

### Create an Interval Module Library

Save each interval as a module:

1. Build the two-note interval
2. Save as "Interval - [Name] ([Ratio])"
3. Organize in an "Intervals" category

### Example Naming

- "Interval - Perfect Fifth (3/2)"
- "Interval - Major Third (5/4)"
- "Interval - Harmonic Seventh (7/4)"

## Exercises

### Exercise 1: Identify by Sound

1. Create all 12 intervals in separate modules
2. Close your eyes, load a random one
3. Try to identify the interval

### Exercise 2: Build a Chord

1. Choose a root note
2. Add intervals to build: Major, Minor, Diminished, Augmented triads
3. Listen to how interval combinations create chord quality

### Exercise 3: Compare TET Systems

1. Build the same interval in pure, 12-TET, 19-TET, and 31-TET
2. Play each version
3. Note which TET best approximates the pure interval

## Next Steps

- [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) - Apply intervals to microtonal music
- [Chaining Notes](/tutorials/intermediate/dependencies) - Build complex interval relationships
- [Tuning Systems](/user-guide/tuning/ratios) - Deeper tuning theory

