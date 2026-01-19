# frequency

The `frequency` property defines the pitch of a note in Hertz (Hz).

## Default Value

```javascript
new Fraction(440)  // A4 (concert pitch)
```

## Expression Examples

### Fixed Frequency

```javascript
new Fraction(440)   // A4
new Fraction(261)   // ~C4
new Fraction(880)   // A5
```

### Relative to BaseNote

```javascript
// Same as BaseNote
module.baseNote.getVariable('frequency')

// Perfect fifth above (3:2 ratio)
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))

// Octave above (2:1 ratio)
module.baseNote.getVariable('frequency').mul(new Fraction(2))

// Perfect fourth below
module.baseNote.getVariable('frequency').div(new Fraction(4, 3))
```

### Relative to Another Note

```javascript
// Major third above Note 1
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))

// Octave below Note 3
module.getNoteById(3).getVariable('frequency').div(new Fraction(2))
```

### TET (Equal Temperament)

```javascript
// 12-TET semitone
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 12)))

// 12-TET major third (4 semitones)
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(4, 12)))

// 19-TET step
module.baseNote.getVariable('frequency')
  .mul(new Fraction(2).pow(new Fraction(1, 19)))
```

::: info Irrational Frequencies
TET frequencies are irrational and display with the **≈** prefix. RMT Compose preserves their algebraic form using SymbolicPower.
:::

## Common Just Intonation Ratios

| Interval | Ratio | Expression |
|----------|-------|------------|
| Unison | 1/1 | `new Fraction(1)` |
| Minor second | 16/15 | `new Fraction(16, 15)` |
| Major second | 9/8 | `new Fraction(9, 8)` |
| Minor third | 6/5 | `new Fraction(6, 5)` |
| Major third | 5/4 | `new Fraction(5, 4)` |
| Perfect fourth | 4/3 | `new Fraction(4, 3)` |
| Tritone | 45/32 | `new Fraction(45, 32)` |
| Perfect fifth | 3/2 | `new Fraction(3, 2)` |
| Minor sixth | 8/5 | `new Fraction(8, 5)` |
| Major sixth | 5/3 | `new Fraction(5, 3)` |
| Minor seventh | 9/5 | `new Fraction(9, 5)` |
| Major seventh | 15/8 | `new Fraction(15, 8)` |
| Octave | 2/1 | `new Fraction(2)` |

## Visualization

- **Vertical position** on the workspace represents frequency
- Higher frequencies appear higher on screen
- The Y-axis uses logarithmic scaling: `log2(baseFreq / freq) * 100`
- **Dashed lines** indicate octave boundaries

## Audio Playback

During playback, the frequency value (converted to a JavaScript number) is used to set the oscillator frequency. For irrational frequencies (TET), the floating-point approximation is used.

## Dependencies

When a note's frequency references another note, a dependency is created:

```javascript
// Note 2 depends on Note 1's frequency
module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
```

Changing Note 1's frequency will automatically update Note 2.

## See Also

- [Pure Ratios](/user-guide/tuning/ratios) - Just intonation theory
- [Equal Temperament](/user-guide/tuning/equal-temperament) - TET systems
- [Expression Syntax](/reference/expressions/syntax) - Full syntax reference
