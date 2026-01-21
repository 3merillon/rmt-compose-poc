# frequency

The `frequency` property defines the pitch of a note in Hertz (Hz).

## Default Value

```
440  // A4 (concert pitch)
```

## Expression Examples

### Fixed Frequency

```
440     // A4
261     // ~C4
880     // A5
```

### Relative to BaseNote

```
// Same as BaseNote
base.f

// Perfect fifth above (3:2 ratio)
base.f * (3/2)

// Octave above (2:1 ratio)
base.f * 2

// Perfect fourth below
base.f / (4/3)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.baseNote.getVariable('frequency').mul(new Fraction(2))
module.baseNote.getVariable('frequency').div(new Fraction(4, 3))
```
</details>

### Relative to Another Note

```
// Major third above Note 1
[1].f * (5/4)

// Octave below Note 3
[3].f / 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
module.getNoteById(3).getVariable('frequency').div(new Fraction(2))
```
</details>

### TET (Equal Temperament)

```
// 12-TET semitone
base.f * 2 ^ (1/12)

// 12-TET major third (4 semitones)
base.f * 2 ^ (4/12)

// 19-TET step
base.f * 2 ^ (1/19)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 12)))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(4, 12)))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 19)))
```
</details>

::: info Irrational Frequencies
TET frequencies are irrational and display with the **≈** prefix. RMT Compose preserves their algebraic form using SymbolicPower.
:::

## Common Just Intonation Ratios

| Interval | Ratio | DSL Expression |
|----------|-------|----------------|
| Unison | 1/1 | `base.f` |
| Minor second | 16/15 | `base.f * (16/15)` |
| Major second | 9/8 | `base.f * (9/8)` |
| Minor third | 6/5 | `base.f * (6/5)` |
| Major third | 5/4 | `base.f * (5/4)` |
| Perfect fourth | 4/3 | `base.f * (4/3)` |
| Tritone | 45/32 | `base.f * (45/32)` |
| Perfect fifth | 3/2 | `base.f * (3/2)` |
| Minor sixth | 8/5 | `base.f * (8/5)` |
| Major sixth | 5/3 | `base.f * (5/3)` |
| Minor seventh | 9/5 | `base.f * (9/5)` |
| Major seventh | 15/8 | `base.f * (15/8)` |
| Octave | 2/1 | `base.f * 2` |

## Visualization

- **Vertical position** on the workspace represents frequency
- Higher frequencies appear higher on screen
- The Y-axis uses logarithmic scaling: `log2(baseFreq / freq) * 100`
- **Dashed lines** indicate octave boundaries

## Audio Playback

During playback, the frequency value (converted to a JavaScript number) is used to set the oscillator frequency. For irrational frequencies (TET), the floating-point approximation is used.

## Dependencies

When a note's frequency references another note, a dependency is created:

```
// Note 2 depends on Note 1's frequency
[1].f * (3/2)
```

Changing Note 1's frequency will automatically update Note 2.

## See Also

- [Pure Ratios](/user-guide/tuning/ratios) - Just intonation theory
- [Equal Temperament](/user-guide/tuning/equal-temperament) - TET systems
- [Expression Syntax](/reference/expressions/syntax) - Full syntax reference
