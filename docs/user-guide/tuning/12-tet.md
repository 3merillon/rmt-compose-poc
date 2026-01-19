# 12-TET (Standard Western Tuning)

**12-TET** (12-Tone Equal Temperament) is the standard tuning system used in Western music. It divides the octave into 12 equal semitones.

## Overview

| Property | Value |
|----------|-------|
| Steps per octave | 12 |
| Step ratio | 2^(1/12) ≈ 1.05946 |
| Octave ratio | 2:1 (exact) |

## The 12-TET Scale

| Step | Note | Semitones | Expression |
|------|------|-----------|------------|
| 0 | C | 0 | `new Fraction(1)` |
| 1 | C#/Db | 1 | `2^(1/12)` |
| 2 | D | 2 | `2^(2/12)` |
| 3 | D#/Eb | 3 | `2^(3/12)` |
| 4 | E | 4 | `2^(4/12)` |
| 5 | F | 5 | `2^(5/12)` |
| 6 | F#/Gb | 6 | `2^(6/12)` |
| 7 | G | 7 | `2^(7/12)` |
| 8 | G#/Ab | 8 | `2^(8/12)` |
| 9 | A | 9 | `2^(9/12)` |
| 10 | A#/Bb | 10 | `2^(10/12)` |
| 11 | B | 11 | `2^(11/12)` |
| 12 | C | 12 | `2^(12/12) = 2` |

## Expression Syntax

### Single Semitone

```javascript
// One semitone up
new Fraction(2).pow(new Fraction(1, 12))
```

### Multiple Semitones

```javascript
// Perfect fifth (7 semitones)
new Fraction(2).pow(new Fraction(7, 12))

// Major third (4 semitones)
new Fraction(2).pow(new Fraction(4, 12))

// Simplified: 4/12 = 1/3
new Fraction(2).pow(new Fraction(1, 3))
```

### Applying to BaseNote

```javascript
// Note at 4 semitones above BaseNote
module.baseNote.getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(4, 12))
)
```

### Building a Chromatic Scale

Each note references the previous:

```javascript
// Note 1: Root
note1.frequency = module.baseNote.getVariable('frequency')

// Note 2: One semitone up
note2.frequency = module.getNoteById(1).getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(1, 12))
)

// Note 3: One more semitone
note3.frequency = module.getNoteById(2).getVariable('frequency').mul(
  new Fraction(2).pow(new Fraction(1, 12))
)

// ... continue for all 12 notes
```

## Intervals in 12-TET

| Interval | Semitones | Expression |
|----------|-----------|------------|
| Minor second | 1 | `2^(1/12)` |
| Major second | 2 | `2^(2/12)` or `2^(1/6)` |
| Minor third | 3 | `2^(3/12)` or `2^(1/4)` |
| Major third | 4 | `2^(4/12)` or `2^(1/3)` |
| Perfect fourth | 5 | `2^(5/12)` |
| Tritone | 6 | `2^(6/12)` or `2^(1/2)` = √2 |
| Perfect fifth | 7 | `2^(7/12)` |
| Minor sixth | 8 | `2^(8/12)` or `2^(2/3)` |
| Major sixth | 9 | `2^(9/12)` or `2^(3/4)` |
| Minor seventh | 10 | `2^(10/12)` or `2^(5/6)` |
| Major seventh | 11 | `2^(11/12)` |
| Octave | 12 | `2^(12/12)` = 2 |

## Using the TET-12 Module

1. Open the **Module Bar**
2. Find **Melodies** category
3. Drag **TET-12** onto the workspace

The module shows a chromatic scale with each note one semitone apart.

## Comparison with Just Intonation

| Interval | Just | 12-TET | Cents off |
|----------|------|--------|-----------|
| Perfect fifth | 3/2 | 2^(7/12) | -2 |
| Major third | 5/4 | 2^(4/12) | +14 |
| Minor third | 6/5 | 2^(3/12) | -16 |
| Major sixth | 5/3 | 2^(9/12) | +16 |

The fifth is almost perfect, but thirds are noticeably different.

## Why 12-TET?

### Advantages

1. **Key equality**: All keys sound the same
2. **Modulation**: Smooth transitions between keys
3. **Instrument design**: Standard keyboard layout
4. **Music notation**: Standard 12-note system

### Disadvantages

1. **Impure thirds**: Major and minor thirds are "off"
2. **Compromise**: No interval is perfectly pure (except octaves)
3. **Uniformity**: Every key sounds identical (no character)

## Practical Applications

### Piano and Guitar

Standard piano and guitar use 12-TET. If you want your RMT compositions to match these instruments, use 12-TET.

### Transposition

In 12-TET, transposing is simple multiplication:

```javascript
// Transpose up 5 semitones (perfect fourth)
originalFreq.mul(new Fraction(2).pow(new Fraction(5, 12)))
```

### MIDI Compatibility

12-TET maps directly to MIDI note numbers:
- Each semitone = 1 MIDI note
- A4 (440 Hz) = MIDI note 69

## Tips

1. **Use for compatibility** when matching other instruments
2. **Simplify fractions** when possible (4/12 = 1/3)
3. **Remember the ≈** symbol indicates TET (irrational) values
4. **Mix with just intonation** for hybrid approaches

## Next Steps

- Explore [19-TET](./19-tet) for better thirds
- Try [31-TET](./31-tet) for high-resolution microtonal
- Learn about [Custom TET](./custom-tet) systems
