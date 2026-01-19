# tempo

The `tempo` property defines the speed of the composition in beats per minute (BPM).

## Default Value

```javascript
new Fraction(60)  // 60 BPM (one beat per second)
```

## Expression Examples

### Fixed Tempo

```javascript
new Fraction(60)   // 60 BPM (slow)
new Fraction(120)  // 120 BPM (moderate)
new Fraction(180)  // 180 BPM (fast)
```

### Reference BaseNote Tempo

```javascript
module.baseNote.getVariable('tempo')
```

Most notes inherit tempo from the BaseNote rather than defining their own.

## How Tempo Affects Duration

The tempo is used to calculate beat-relative durations:

```javascript
// Duration of one beat in seconds
// At 60 BPM: 60/60 = 1 second
// At 120 BPM: 60/120 = 0.5 seconds
new Fraction(60).div(module.findTempo(module.baseNote))
```

### Duration Examples at Different Tempos

| Note | At 60 BPM | At 120 BPM | At 90 BPM |
|------|-----------|------------|-----------|
| Whole (4 beats) | 4s | 2s | 2.67s |
| Half (2 beats) | 2s | 1s | 1.33s |
| Quarter (1 beat) | 1s | 0.5s | 0.67s |
| Eighth (0.5 beats) | 0.5s | 0.25s | 0.33s |

## module.findTempo()

The `findTempo` function walks up the inheritance chain to find the effective tempo:

```javascript
module.findTempo(module.baseNote)  // Returns tempo as Fraction
```

This allows individual notes to override tempo for tempo changes mid-composition.

## Measure Length Calculation

Tempo affects measure length:

```javascript
// measureLength = beatsPerMeasure / tempo * 60
// At 120 BPM with 4/4 time: 4 / 120 * 60 = 2 seconds
module.findMeasureLength(module.baseNote)
```

## Changing Global Tempo

To change the tempo for the entire composition:

1. Click the **BaseNote** (orange circle)
2. Find the **tempo** property in the Variable Widget
3. Change the value (e.g., `new Fraction(120)`)
4. All tempo-relative durations automatically update

## Tempo Changes Within a Composition

While most compositions use a single tempo, you can create tempo changes by having notes define their own tempo property. Notes that reference these will use the new tempo.

## Visualization

Tempo affects the visual spacing of beat-relative notes:
- At slower tempos, beat-relative notes appear wider (longer duration in seconds)
- At faster tempos, beat-relative notes appear narrower

## Common Tempo Values

| Description | BPM | Expression |
|-------------|-----|------------|
| Largo | 40-60 | `new Fraction(50)` |
| Adagio | 66-76 | `new Fraction(70)` |
| Andante | 76-108 | `new Fraction(90)` |
| Moderato | 108-120 | `new Fraction(112)` |
| Allegro | 120-156 | `new Fraction(140)` |
| Presto | 168-200 | `new Fraction(180)` |

## See Also

- [duration](/reference/properties/duration) - Note length
- [beatsPerMeasure](/reference/properties/beats-per-measure) - Time signature
- [Transport Controls](/user-guide/playback/transport) - Playback
