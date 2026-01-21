# beatsPerMeasure

The `beatsPerMeasure` property defines the number of beats in one measure, equivalent to the numerator of a time signature.

## Default Value

```
4  // 4 beats per measure (4/4 time)
```

## Expression Examples

### Common Time Signatures

```
4   // 4/4 (common time)
3   // 3/4 (waltz time)
2   // 2/4 (march time)
6   // 6/8 (compound duple)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(4)  // 4/4 (common time)
new Fraction(3)  // 3/4 (waltz time)
new Fraction(2)  // 2/4 (march time)
new Fraction(6)  // 6/8 (compound duple)
```
</details>

### Reference BaseNote

```
base.bpm
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('beatsPerMeasure')
```
</details>

## How It Affects Measure Length

The measure length (in seconds) is calculated as:

```
measureLength = beatsPerMeasure / tempo * 60

// At 120 BPM with 4 beats per measure:
// 4 / 120 * 60 = 2 seconds
```

Access via:

```
measure(base)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.findMeasureLength(module.baseNote)
```
</details>

## Common Time Signatures

| Time Signature | beatsPerMeasure | Description |
|----------------|-----------------|-------------|
| 4/4 | 4 | Common time, most popular |
| 3/4 | 3 | Waltz, minuet |
| 2/4 | 2 | March, polka |
| 6/8 | 6 | Compound duple (two groups of 3) |
| 5/4 | 5 | Irregular meter |
| 7/8 | 7 | Irregular meter |

## Measure-Relative Timing

Use `beatsPerMeasure` for measure-aligned timing:

```
// Start at measure 2
measure(base) * 2

// Duration of half a measure
measure(base) * (1/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Start at measure 2
module.findMeasureLength(module.baseNote).mul(new Fraction(2))

// Duration of half a measure
module.findMeasureLength(module.baseNote).mul(new Fraction(1, 2))
```
</details>

## Visualization

- **Vertical dashed lines** on the workspace indicate measure boundaries
- Measure lines are spaced according to the calculated measure length
- The spacing changes if tempo or beatsPerMeasure changes

## Changing Time Signature

To change the time signature for the composition:

1. Click the **BaseNote** (orange circle)
2. Find **beatsPerMeasure** in the Variable Widget
3. Set the new value (e.g., `3` for 3/4 time)

All measure-relative expressions will automatically update.

## Mixed Meters

While most compositions use a single time signature, you can create meter changes by having certain notes define their own `beatsPerMeasure`. Notes referencing these will use the new meter.

## See Also

- [tempo](/reference/properties/tempo) - Speed in BPM
- [duration](/reference/properties/duration) - Note length
- [Working with Measures](/tutorials/intermediate/measures) - Measure tutorial
