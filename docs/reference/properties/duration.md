# duration

The `duration` property defines how long a note plays, measured in seconds.

## Default Value

```
1  // 1 second
```

## Expression Examples

### Fixed Duration

```
1       // 1 second
2       // 2 seconds
(1/2)   // 0.5 seconds
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(1)     // 1 second
new Fraction(2)     // 2 seconds
new Fraction(1, 2)  // 0.5 seconds
```
</details>

### Beat-Relative Duration

```
// One beat (tempo-aware)
60 / tempo(base)

// Two beats
60 / tempo(base) * 2

// Half beat (eighth note)
60 / tempo(base) * (1/2)

// Quarter beat (sixteenth note)
60 / tempo(base) * (1/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// One beat (tempo-aware)
new Fraction(60).div(module.findTempo(module.baseNote))

// Two beats
new Fraction(60).div(module.findTempo(module.baseNote))
  .mul(new Fraction(2))

// Half beat (eighth note)
new Fraction(60).div(module.findTempo(module.baseNote))
  .mul(new Fraction(1, 2))

// Quarter beat (sixteenth note)
new Fraction(60).div(module.findTempo(module.baseNote))
  .mul(new Fraction(1, 4))
```
</details>

### Measure-Relative Duration

```
// One full measure
measure(base)

// Half a measure
measure(base) * (1/2)

// Two measures
measure(base) * 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// One full measure
module.findMeasureLength(module.baseNote)

// Half a measure
module.findMeasureLength(module.baseNote).mul(new Fraction(1, 2))

// Two measures
module.findMeasureLength(module.baseNote).mul(new Fraction(2))
```
</details>

### Same as Another Note

```
// Same duration as Note 1
[1].d

// Twice as long as Note 1
[1].d * 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Same duration as Note 1
module.getNoteById(1).getVariable('duration')

// Twice as long as Note 1
module.getNoteById(1).getVariable('duration').mul(new Fraction(2))
```
</details>

## Standard Note Values

At a given tempo, common note durations:

| Note | Beats | DSL Expression |
|------|-------|----------------|
| Whole | 4 | `beat(base) * 4` |
| Half | 2 | `beat(base) * 2` |
| Quarter | 1 | `beat(base)` |
| Eighth | 0.5 | `beat(base) * (1/2)` |
| Sixteenth | 0.25 | `beat(base) * (1/4)` |
| Dotted half | 3 | `beat(base) * 3` |
| Dotted quarter | 1.5 | `beat(base) * (3/2)` |

Where `beat(base) = 60 / tempo(base)`

<details>
<summary>Legacy JavaScript syntax</summary>

| Note | Beats | Legacy Expression |
|------|-------|-------------------|
| Whole | 4 | `beat.mul(new Fraction(4))` |
| Half | 2 | `beat.mul(new Fraction(2))` |
| Quarter | 1 | `beat` |
| Eighth | 0.5 | `beat.mul(new Fraction(1, 2))` |
| Sixteenth | 0.25 | `beat.mul(new Fraction(1, 4))` |
| Dotted half | 3 | `beat.mul(new Fraction(3))` |
| Dotted quarter | 1.5 | `beat.mul(new Fraction(3, 2))` |

Where `beat = new Fraction(60).div(module.findTempo(module.baseNote))`
</details>

## Variable Widget Shortcuts

The Variable Widget provides duration icons for quick selection:

- **𝅝** Whole note (4 beats)
- **𝅗𝅥** Half note (2 beats)
- **♩** Quarter note (1 beat)
- **♪** Eighth note (1/2 beat)
- **𝅘𝅥𝅯** Sixteenth note (1/4 beat)

These icons set tempo-relative durations automatically.

## Visualization

- **Note width** on the workspace represents duration
- Longer notes appear wider
- Width scales with the X-axis zoom level

## Audio Behavior

During playback:
1. Oscillator starts at `startTime`
2. Envelope (ADSR) is applied based on instrument settings
3. Oscillator stops at `startTime + duration`

The actual audible duration may be slightly different due to envelope release time.

## Dependencies

Duration affects sequential note chains:

```
// Note 2 starts when Note 1 ends
// Depends on Note 1's duration
[1].t + [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 2 starts when Note 1 ends
// Depends on Note 1's duration
module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
```
</details>

Changing Note 1's duration shifts when Note 2 starts.

## See Also

- [startTime](/reference/properties/start-time) - When notes play
- [tempo](/reference/properties/tempo) - Speed in BPM
- [Add Rhythm](/tutorials/beginner/rhythm) - Duration tutorial
