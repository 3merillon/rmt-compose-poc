# Microtonal Experiments

A practical workflow for exploring microtonal tuning systems, discovering new sounds, and building your microtonal vocabulary.

## Setting Up Your Microtonal Lab

### The Basic Experiment Setup

Create a workspace for quick interval comparison:

```
// Reference note (Note 1)
frequency: base.f
startTime: 0
duration: 3

// Experiment note (Note 2) - change this ratio to explore
frequency: [1].f * 2^(1/19)  // 19-TET semitone
startTime: [1].t
duration: [1].d
```

Both notes play together, making interval quality immediately audible.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Reference note (Note 1)
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(3)

// Experiment note (Note 2) - change this ratio to explore
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 19)))  // 19-TET semitone
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')
```

</details>

## Experiment 1: TET Comparison

### Goal

Hear the difference between equal temperament systems on the same interval.

### Setup

Create four notes, all playing simultaneously:

```
// Note 1: Reference (440 Hz)
frequency: base.f

// Note 2: Pure major third (5/4)
frequency: [1].f * (5/4)

// Note 3: 12-TET major third (4 semitones)
frequency: [1].f * 2^(4/12)

// Note 4: 19-TET major third (6 steps)
frequency: [1].f * 2^(6/19)

// Note 5: 31-TET major third (10 steps)
frequency: [1].f * 2^(10/31)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: Reference (440 Hz)
frequency: module.baseNote.getVariable('frequency')

// Note 2: Pure major third (5/4)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(5, 4))

// Note 3: 12-TET major third (4 semitones)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(4, 12)))

// Note 4: 19-TET major third (6 steps)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(6, 19)))

// Note 5: 31-TET major third (10 steps)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(10, 31)))
```

</details>

### What to Listen For

- **Pure 5/4**: Completely smooth, no beating
- **12-TET**: Subtle but audible beating (~14 cents sharp)
- **19-TET**: Different character, closer to pure
- **31-TET**: Very close to pure, almost beatless

### Record Your Observations

Note which approximation you prefer for different contexts.

## Experiment 2: Neutral Intervals

### Goal

Explore intervals that fall between major and minor.

### Background

The "neutral third" lies between major (5/4 ≈ 386 cents) and minor (6/5 ≈ 316 cents), around 350 cents.

### Setup

```
// Reference
frequency: base.f

// Minor third (6/5)
frequency: [1].f * (6/5)

// Neutral third (11/9 ≈ 347 cents)
frequency: [1].f * (11/9)

// Major third (5/4)
frequency: [1].f * (5/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Reference
frequency: module.baseNote.getVariable('frequency')

// Minor third (6/5)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(6, 5))

// Neutral third (11/9 ≈ 347 cents)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(11, 9))

// Major third (5/4)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(5, 4))
```

</details>

### Try These Neutral Intervals

| Interval | Ratio | Cents | Character |
|----------|-------|-------|-----------|
| Neutral 2nd | 12/11 | 151 | Between major/minor 2nd |
| Neutral 3rd | 11/9 | 347 | Neither major nor minor |
| Neutral 6th | 18/11 | 853 | Between major/minor 6th |
| Neutral 7th | 11/6 | 1049 | Between major/minor 7th |

## Experiment 3: Septimal Intervals

### Goal

Explore intervals based on the 7th harmonic.

### Background

The 7th harmonic creates "bluesy" or "barbershop" quality intervals not found in standard Western music.

### Setup

```
// Reference
frequency: base.f

// Septimal minor third (7/6 ≈ 267 cents)
frequency: [1].f * (7/6)

// Septimal tritone (7/5 ≈ 583 cents)
frequency: [1].f * (7/5)

// Harmonic seventh (7/4 ≈ 969 cents)
frequency: [1].f * (7/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Reference
frequency: module.baseNote.getVariable('frequency')

// Septimal minor third (7/6 ≈ 267 cents)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(7, 6))

// Septimal tritone (7/5 ≈ 583 cents)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(7, 5))

// Harmonic seventh (7/4 ≈ 969 cents)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(7, 4))
```

</details>

### The Barbershop Seventh

The 7/4 "harmonic seventh" is distinctly different from the 12-TET minor seventh:

```javascript
// Compare:
// 7/4 = 969 cents (pure, locked)
// 12-TET m7 = 1000 cents (31 cents sharper)
```

## Experiment 4: Bohlen-Pierce Scale

### Goal

Experience a completely non-octave-based tuning system.

### Background

Bohlen-Pierce divides the tritave (3:1) into 13 equal parts, creating entirely new interval relationships.

### Setup: BP Scale

```
// Note 1: Root
frequency: base.f
startTime: 0
duration: 1

// Each subsequent note: one BP step higher
// BP step = 3^(1/13)

// Note 2: 1 BP step
frequency: [1].f * 3^(1/13)

// Note 3: 2 BP steps
frequency: [1].f * 3^(2/13)

// Continue through 13 steps to reach the tritave (3/1)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: Root
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)

// Each subsequent note: one BP step higher
// BP step = 3^(1/13)

// Note 2: 1 BP step
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(3).pow(new Fraction(1, 13)))

// Note 3: 2 BP steps
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(3).pow(new Fraction(2, 13)))

// Continue through 13 steps to reach the tritave (3/1)
```

</details>

### BP Consonances

BP emphasizes odd harmonics (3, 5, 7, 9...) instead of even ones:

```
// BP "major third" approximation (4 steps ≈ 435 cents)
* 3^(4/13)

// BP "tritave fifth" (6 steps)
* 3^(6/13)

// BP "major sixth" approximation (9 steps)
* 3^(9/13)
```

## Experiment 5: Commas and Microtones

### Goal

Hear the tiny intervals that differentiate tuning systems.

### The Syntonic Comma

The difference between a Pythagorean major third (81/64) and a pure major third (5/4):

```
// Syntonic comma = 81/80 ≈ 22 cents

// Reference
frequency: base.f

// Pythagorean major third
frequency: [1].f * (81/64)

// Pure major third
frequency: [1].f * (5/4)

// Play both together to hear the comma
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Reference
frequency: module.baseNote.getVariable('frequency')

// Pythagorean major third
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(81, 64))

// Pure major third
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(5, 4))
```

</details>

### Other Famous Commas

```javascript
// Pythagorean comma (531441/524288 ≈ 23 cents)
// The gap after 12 pure fifths

// Diesis (128/125 ≈ 41 cents)
// Three pure major thirds vs one octave

// Septimal comma (64/63 ≈ 27 cents)
// Difference between 7/4 and 16/9
```

## Experiment 6: Quarter Tones

### Goal

Systematically explore 24-TET (quarter-tone) music.

### Setup

```
// 24-TET divides the octave into 24 equal parts
// Each step = 2^(1/24) = 50 cents

// Reference
frequency: base.f

// Quarter tone above (1 step)
frequency: [1].f * 2^(1/24)

// Semitone (2 steps, same as 12-TET)
frequency: [1].f * 2^(2/24)

// Three-quarter tone (3 steps)
frequency: [1].f * 2^(3/24)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// 24-TET divides the octave into 24 equal parts
// Each step = 2^(1/24) = 50 cents

// Reference
frequency: module.baseNote.getVariable('frequency')

// Quarter tone above (1 step)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 24)))

// Semitone (2 steps, same as 12-TET)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(2, 24)))

// Three-quarter tone (3 steps)
frequency: module.getNoteById(1).getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(3, 24)))
```

</details>

### Quarter-Tone Melody

Create a melody using steps unavailable in 12-TET:

```javascript
// Sequence: 0, 1, 3, 5, 7, 8, 10, 12 (in 24-TET steps)
// Creates a scale with quarter-tone inflections
```

## Experiment 7: Custom Scales

### Goal

Design your own microtonal scale.

### Method 1: Just Intonation Scale

Pick ratios based on harmonic relationships:

```
// Custom 7-note scale using 7-limit intervals

// 1 (root): 1/1
// 2 (neutral 2nd): 12/11
// 3 (septimal minor 3rd): 7/6
// 4 (perfect 4th): 4/3
// 5 (septimal tritone): 7/5
// 6 (minor 6th): 8/5
// 7 (harmonic 7th): 7/4
// 8 (octave): 2/1
```

### Method 2: Non-Standard TET

Try unusual divisions:

```
// 17-TET: Creates interesting interval approximations
// 22-TET: Good approximation of Indian shruti
// 41-TET: Excellent approximation of many just intervals

// 17-TET fifth (10 steps)
* 2^(10/17)
```

## Recording Your Experiments

### Save Successful Discoveries

When you find an interesting sound:

1. Save the module with a descriptive name
2. Note the ratios or TET steps used
3. Describe the sound quality

### Build a Microtonal Catalog

Organize discoveries by:

```
Microtonal Library
├── TET Systems
│   ├── 17-TET Experiments
│   ├── 19-TET Experiments
│   ├── 22-TET Experiments
│   └── 31-TET Experiments
├── Just Intonation
│   ├── 5-Limit
│   ├── 7-Limit
│   └── 11-Limit
├── Non-Octave
│   ├── Bohlen-Pierce
│   └── Custom Tritave Scales
└── Favorites
    ├── Best Chords
    └── Best Melodies
```

## Tips for Productive Experimentation

### 1. Use Long Durations

Short notes mask tuning differences. Use durations of 2+ seconds.

### 2. Try Different Timbres

Some instruments reveal beating better than others. Experiment with:
- Sine wave (pure, shows beating clearly)
- Organ (rich harmonics, emphasizes roughness)

### 3. Compare A/B

Always have a reference for comparison:
- Pure interval vs tempered
- One TET vs another
- Your custom scale vs familiar scale

### 4. Trust Your Ears

Theory guides you, but sound quality is subjective. Some "dissonant" intervals work beautifully in context.

### 5. Take Breaks

Ear fatigue affects perception. Rest between intense listening sessions.

## Next Steps

After your experiments:

- [Save as Modules](/tutorials/workflows/module-library) - Build your library
- [Build Compositions](/tutorials/advanced/microtonal) - Apply discoveries musically
- [Study the Theory](/user-guide/tuning/ratios) - Understand why intervals work

