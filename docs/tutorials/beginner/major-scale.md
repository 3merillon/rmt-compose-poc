# Build a Major Scale

In this tutorial, you'll build a major scale using just intonation ratios - the exact fractions from the natural harmonic series.

## Objective

Create an 8-note major scale (Do-Re-Mi-Fa-Sol-La-Ti-Do) using pure ratios.

## Prerequisites

- RMT Compose running
- Familiarity with the [Variable Widget](/user-guide/interface/variable-widget)
- Understanding of [Core Concepts](/getting-started/concepts)

## The Major Scale Ratios

| Degree | Name | Ratio | Decimal |
|--------|------|-------|---------|
| 1 | Do | 1/1 | 1.000 |
| 2 | Re | 9/8 | 1.125 |
| 3 | Mi | 5/4 | 1.250 |
| 4 | Fa | 4/3 | 1.333 |
| 5 | Sol | 3/2 | 1.500 |
| 6 | La | 5/3 | 1.667 |
| 7 | Ti | 15/8 | 1.875 |
| 8 | Do | 2/1 | 2.000 |

## Step 1: Start Fresh

1. Open RMT Compose
2. Click **Menu** (☰) > **Load Module** > **Reset to Default Module**
3. Or load the "octave" interval module as a starting point

## Step 2: Set Up the BaseNote

1. Click the **BaseNote** (orange circle)
2. In the Variable Widget, verify:
   - **frequency**: `new Fraction(440)` (A4, but any frequency works)
   - **tempo**: `new Fraction(120)` (120 BPM)

## Step 3: Create the Root (Do)

1. Click the BaseNote
2. Click **"Add Note"** > **"Add at Start+Duration"**
3. Select the new note
4. Set its frequency:

```javascript
module.baseNote.getVariable('frequency')
```

5. Set its duration to a quarter note:

```javascript
new Fraction(60).div(module.findTempo(module.baseNote))
```

6. Click **Save**

## Step 4: Create Re (9/8)

1. Select the Do note you just created (Note 1)
2. Click **"Add Note"** > **"Add at Start+Duration"**
3. Select the new note (Note 2)
4. Set its frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(9, 8))
```

5. Click **Save**

## Step 5: Create Mi (5/4)

1. Select Note 2
2. Click **"Add Note"** > **"Add at Start+Duration"**
3. Select Note 3
4. Set its frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
```

5. Click **Save**

## Step 6: Create Fa (4/3)

1. Select Note 3
2. Add a new note
3. Set frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(4, 3))
```

## Step 7: Create Sol (3/2)

1. Add note after Fa
2. Set frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```

## Step 8: Create La (5/3)

1. Add note after Sol
2. Set frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(5, 3))
```

## Step 9: Create Ti (15/8)

1. Add note after La
2. Set frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(15, 8))
```

## Step 10: Create High Do (2/1)

1. Add note after Ti
2. Set frequency:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2, 1))
```

Or simply:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2))
```

## Verification

1. Click **Play** to hear your scale
2. You should hear 8 notes ascending
3. The last note (high Do) should sound like the first note, but higher

### Check Your Work

Select each note and verify the frequency ratio in the Variable Widget:

| Note ID | Expected Ratio |
|---------|----------------|
| 1 | 1/1 |
| 2 | 9/8 |
| 3 | 5/4 |
| 4 | 4/3 |
| 5 | 3/2 |
| 6 | 5/3 |
| 7 | 15/8 |
| 8 | 2/1 |

## Save Your Module

1. Click **Menu** > **Save Module**
2. Rename to `major-scale-just.json`

## Exercises

### Exercise 1: Descending Scale

Modify your scale to descend from high Do to low Do.

**Hint**: Change the order of start times, or create new notes in reverse order.

### Exercise 2: Change the Root

1. Click the BaseNote
2. Change frequency to `new Fraction(330)` (E4)
3. Play - the scale is now in E major!

### Exercise 3: Longer Notes

Change all durations to half notes:

```javascript
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))
```

## What You Learned

- Major scale intervals as pure ratios
- Creating sequential notes using "Add at Start+Duration"
- How changing BaseNote transposes the entire scale
- The relationship between tempo and duration

## Next Steps

- [Create a Major Triad](./major-triad) - Build a chord
- [Add Rhythm](./rhythm) - Create varied rhythms
- Compare with [12-TET](/user-guide/tuning/12-tet) to hear the difference
