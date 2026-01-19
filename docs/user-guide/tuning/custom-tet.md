# Custom TET Systems

RMT Compose allows you to create **custom equal temperament systems** beyond the built-in 12-TET, 19-TET, 31-TET, and Bohlen-Pierce.

## The Basic Formula

Any TET system follows this pattern:

```javascript
// N-TET: Divide interval I into N equal steps
// Step ratio = I^(1/N)

// For octave-based TET:
new Fraction(2).pow(new Fraction(1, N))

// For tritave-based (like BP):
new Fraction(3).pow(new Fraction(1, N))

// For any interval:
new Fraction(I).pow(new Fraction(1, N))
```

## Creating a Custom TET

### Step 1: Choose Your Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| **Interval** | The repeating interval | 2 (octave), 3 (tritave) |
| **Divisions** | How many steps | 17, 22, 24, 53... |

### Step 2: Write the Step Expression

```javascript
// Example: 17-TET (17 equal divisions of the octave)
new Fraction(2).pow(new Fraction(1, 17))

// Example: 53-TET (very close to just intonation)
new Fraction(2).pow(new Fraction(1, 53))

// Example: 5-TET (pentatonic equal temperament)
new Fraction(2).pow(new Fraction(1, 5))
```

### Step 3: Build the Scale

Each note references the previous:

```javascript
// 17-TET scale
note1.frequency = baseNote.frequency
note2.frequency = note1.frequency.mul(new Fraction(2).pow(new Fraction(1, 17)))
note3.frequency = note2.frequency.mul(new Fraction(2).pow(new Fraction(1, 17)))
// ... continue for all 17 notes
```

## Interesting TET Systems

### 5-TET (Pentatonic ET)

| Property | Value |
|----------|-------|
| Steps | 5 |
| Step size | 240 cents |
| Character | Indonesian slendro-like |

```javascript
new Fraction(2).pow(new Fraction(1, 5))
```

### 7-TET (Thai-like)

| Property | Value |
|----------|-------|
| Steps | 7 |
| Step size | 171.4 cents |
| Character | Similar to Thai classical music |

```javascript
new Fraction(2).pow(new Fraction(1, 7))
```

### 22-TET (Shruti Scale)

| Property | Value |
|----------|-------|
| Steps | 22 |
| Step size | 54.5 cents |
| Character | Close to Indian classical shrutis |

```javascript
new Fraction(2).pow(new Fraction(1, 22))
```

### 24-TET (Quarter Tones)

| Property | Value |
|----------|-------|
| Steps | 24 |
| Step size | 50 cents (quarter tone) |
| Character | Arabic maqam approximations |

```javascript
new Fraction(2).pow(new Fraction(1, 24))
```

### 53-TET (Mercator's)

| Property | Value |
|----------|-------|
| Steps | 53 |
| Step size | 22.6 cents |
| Character | Extremely close to just intonation |

```javascript
new Fraction(2).pow(new Fraction(1, 53))
```

53-TET is famous for nearly perfect fifths and thirds!

### 72-TET (Twelfth Tones)

| Property | Value |
|----------|-------|
| Steps | 72 |
| Step size | 16.7 cents |
| Character | Includes 12-TET as subset, very fine control |

```javascript
new Fraction(2).pow(new Fraction(1, 72))
```

## Non-Octave Systems

You can create TET systems based on any interval:

### 8-EDTri (8 Equal Divisions of the Tritave)

```javascript
// 8 divisions of the 3:1 tritave
new Fraction(3).pow(new Fraction(1, 8))
```

### 5-ED5 (5 Equal Divisions of the Pentave)

```javascript
// 5 divisions of the 5:1 "pentave"
new Fraction(5).pow(new Fraction(1, 5))
```

### Golden Ratio TET

```javascript
// Using phi (≈1.618) as the interval
// Note: This requires a decimal approximation
new Fraction(1618, 1000).pow(new Fraction(1, 7))
```

## Saving Custom TET Modules

1. Create your scale using the expressions above
2. Test with playback
3. **Menu > Save Module**
4. Add to your Module Bar (see [Module Bar](../interface/module-bar))

### Example Module JSON

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "tempo": "new Fraction(60)",
    "beatsPerMeasure": "new Fraction(4)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency')",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(1)",
      "instrument": "sine-wave"
    },
    {
      "id": 2,
      "frequency": "module.getNoteById(1).getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 17)))",
      "startTime": "module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))",
      "duration": "new Fraction(1)",
      "instrument": "sine-wave"
    }
  ]
}
```

## Comparing TET Systems

### How Many Steps Equal Common Intervals?

| Interval | Just | 12-TET | 19-TET | 31-TET | 53-TET |
|----------|------|--------|--------|--------|--------|
| Perfect fifth | 3/2 | 7 | 11 | 18 | 31 |
| Major third | 5/4 | 4 | 6 | 10 | 17 |
| Minor third | 6/5 | 3 | 5 | 8 | 14 |

Higher divisions generally mean closer approximations to just intervals.

## Tips

1. **Start with existing TET** - Modify 12-TET, 19-TET, etc.
2. **Use small divisions first** - 5-TET and 7-TET are easier to grasp
3. **Listen, don't calculate** - Let your ears guide you
4. **Document your system** - Note which intervals you're targeting
5. **Share your discoveries** - Custom TET modules can be valuable to others

## Mathematical Background

### Why These Numbers?

Certain divisions of the octave approximate just intervals well:

- **12**: Good fifths, passable thirds
- **19**: Better thirds, slightly worse fifths
- **31**: Excellent thirds, good fifths
- **53**: Nearly perfect fifths AND thirds

The mathematical reason involves continued fractions of log₂(3/2) and log₂(5/4).

### The Comma Problem

No equal temperament perfectly matches all just intervals. The difference is called a "comma":

| Comma | Size | Description |
|-------|------|-------------|
| Pythagorean | 23.5 cents | 12 fifths vs 7 octaves |
| Syntonic | 21.5 cents | 4 fifths vs major third + 2 octaves |

Different TET systems distribute these commas differently.

## Next Steps

- Review [Equal Temperament](./equal-temperament) theory
- Compare with [Pure Ratios](./ratios)
- Try the [Microtonal Composition](/tutorials/advanced/microtonal) tutorial
