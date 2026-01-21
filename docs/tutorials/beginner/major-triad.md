# Create a Major Triad

In this tutorial, you'll build a major chord (triad) using just intonation ratios.

## Objective

Create a three-note major chord where all notes play simultaneously.

## Prerequisites

- Completed [Build a Major Scale](./major-scale) or equivalent experience
- Understanding of ratios for thirds and fifths

## The Major Triad

A major triad consists of:

| Note | Interval | Ratio | Decimal |
|------|----------|-------|---------|
| Root | Unison | 1/1 | 1.000 |
| Third | Major third | 5/4 | 1.250 |
| Fifth | Perfect fifth | 3/2 | 1.500 |

## Step 1: Start Fresh

1. Load the "octave" interval module from the Module Bar
2. Or reset to default and clear existing notes

## Step 2: Create the Root

1. Click the **BaseNote**
2. Click **"Add Note"** > select **"Note"** and **"At Start"** > **"Create Note"**
3. Select the new note
4. Set frequency:

```
base.f
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency')
```
</details>

5. Set duration to a whole note:

```
60 / tempo(base) * 4
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(4))
```
</details>

6. Click **Save**

## Step 3: Create the Third

1. With the root selected, click **"Create Note"** (with **"At Start"** selected)
2. Select the new note
3. Set frequency (major third = 5/4):

```
base.f * (5/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
```
</details>

4. Keep the same duration and start time
5. Click **Save**

## Step 4: Create the Fifth

1. Select the root note again
2. Click **"Create Note"** (with **"At Start"** selected)
3. Select the new note
4. Set frequency (perfect fifth = 3/2):

```
base.f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

5. Click **Save**

## Verification

1. Click **Play**
2. You should hear all three notes at once - a major chord!
3. The chord should sound bright and happy

### Visual Check

In the workspace, all three notes should:
- Start at the same time (aligned vertically)
- Have different vertical positions (different frequencies)
- Be stacked: Root → Third → Fifth (bottom to top)

## Understanding the Sound

The major triad sounds consonant because:
- 5/4 and 3/2 are simple ratios
- They align with the natural harmonic series
- The frequencies have many common overtones

Compare with [12-TET](/user-guide/tuning/12-tet):
- TET major third = 2^(4/12) ≈ 1.26 (slightly sharp)
- Just major third = 5/4 = 1.25 (pure)

## Exercises

### Exercise 1: Minor Triad

Change the third from major (5/4) to minor (6/5):

```
base.f * (6/5)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(6, 5))
```
</details>

The chord now sounds sad/dark!

### Exercise 2: Add the Octave

1. Add a fourth note at the same time
2. Set frequency to 2/1:

```
base.f * 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2))
```
</details>

This creates a fuller sound.

### Exercise 3: Chord Inversion

Create a first inversion (third in the bass):

| Note | Expression |
|------|------------|
| Third (bass) | `baseNote × 5/4` |
| Fifth | `baseNote × 3/2` |
| Root (high) | `baseNote × 2` |

### Exercise 4: Chord Progression

Create a second chord that plays after the first:

1. Create a new root at `startTime = firstChord.startTime + firstChord.duration`
2. Build a chord on that root
3. You now have a two-chord progression!

## Save Your Module

1. **Menu** > **Save Module**
2. Name it `major-triad-just.json`

## Chord Reference

Other common chords in just intonation:

| Chord | Ratios |
|-------|--------|
| Major | 1/1, 5/4, 3/2 |
| Minor | 1/1, 6/5, 3/2 |
| Diminished | 1/1, 6/5, 36/25 |
| Augmented | 1/1, 5/4, 25/16 |
| Major 7th | 1/1, 5/4, 3/2, 15/8 |
| Dominant 7th | 1/1, 5/4, 3/2, 7/4 |
| Minor 7th | 1/1, 6/5, 3/2, 9/5 |

## What You Learned

- Creating simultaneous notes using "Add at Same Time"
- The ratios that make a major chord
- How to verify chord structure visually and aurally
- The difference between major and minor thirds

## Next Steps

- [Add Rhythm](./rhythm) - Create rhythmic patterns
- [Note Dependencies](../intermediate/dependencies) - Link chords together
- Explore the [Chords](/user-guide/modules/loading-modules) category in the Module Bar
