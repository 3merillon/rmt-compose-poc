# Add Rhythm

In this tutorial, you'll learn to work with timing and duration to create rhythmic patterns.

## Objective

Create a simple rhythmic melody using different note lengths.

## Prerequisites

- Completed [Build a Major Scale](./major-scale)
- Understanding of beat-based timing

## Understanding Time in RMT

Time in RMT Compose is based on:

| Property | Description | Unit |
|----------|-------------|------|
| **tempo** | Beats per minute | BPM |
| **startTime** | When a note begins | Seconds |
| **duration** | How long a note plays | Seconds |

### Beat Duration Formula

```javascript
// Duration of one beat in seconds
beatDuration = 60 / tempo

// In RMT expression:
new Fraction(60).div(module.findTempo(module.baseNote))
```

At 120 BPM: 60/120 = 0.5 seconds per beat

## Note Duration Reference

| Note | Beats | Expression |
|------|-------|------------|
| Whole | 4 | `beatDuration.mul(new Fraction(4))` |
| Half | 2 | `beatDuration.mul(new Fraction(2))` |
| Quarter | 1 | `beatDuration` |
| Eighth | 0.5 | `beatDuration.mul(new Fraction(1, 2))` |
| Sixteenth | 0.25 | `beatDuration.mul(new Fraction(1, 4))` |
| Dotted quarter | 1.5 | `beatDuration.mul(new Fraction(3, 2))` |
| Triplet | 1/3 | `beatDuration.mul(new Fraction(1, 3))` |

## Step 1: Set Up

1. Reset to a fresh workspace
2. Set BaseNote tempo to 120 BPM:

```javascript
new Fraction(120)
```

## Step 2: Create the Beat Duration Helper

First, understand the beat duration expression:

```javascript
// This expression equals one beat duration
new Fraction(60).div(module.findTempo(module.baseNote))
```

We'll use this as the base for all durations.

## Step 3: Create a Rhythmic Pattern

Let's create: Quarter - Eighth - Eighth - Half

### Note 1: Quarter Note

1. Add a note
2. Frequency: `module.baseNote.getVariable('frequency')` (root)
3. StartTime: `new Fraction(0)`
4. Duration (1 beat):

```javascript
new Fraction(60).div(module.findTempo(module.baseNote))
```

### Note 2: First Eighth Note

1. Add note after Note 1
2. Frequency: `baseNote × 9/8` (Re)
3. StartTime: `note1.startTime + note1.duration`
4. Duration (0.5 beats):

```javascript
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```

### Note 3: Second Eighth Note

1. Add note after Note 2
2. Frequency: `baseNote × 5/4` (Mi)
3. StartTime: `note2.startTime + note2.duration`
4. Duration (0.5 beats):

```javascript
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 2))
```

### Note 4: Half Note

1. Add note after Note 3
2. Frequency: `baseNote × 3/2` (Sol)
3. StartTime: `note3.startTime + note3.duration`
4. Duration (2 beats):

```javascript
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))
```

## Verification

1. Click **Play**
2. You should hear: short - quick quick - looong
3. Total duration: 1 + 0.5 + 0.5 + 2 = 4 beats (one measure at 4/4)

### Visual Check

In the workspace:
- Note 1 is medium width
- Notes 2 and 3 are half as wide
- Note 4 is twice as wide as Note 1

## Using Duration Quick Controls

Instead of typing expressions, use the Variable Widget shortcuts:

1. Select a note
2. Find the **duration** row
3. Click the note-length icons:
   - 𝅝 = Whole note
   - 𝅗𝅥 = Half note
   - ♩ = Quarter note
   - ♪ = Eighth note
   - 𝅘𝅥𝅯 = Sixteenth note

4. Add dots for dotted notes (1.5× or 1.75× duration)

## Exercises

### Exercise 1: Different Tempo

1. Change BaseNote tempo to `new Fraction(60)` (60 BPM)
2. Play - the rhythm is the same but slower!
3. The relationships are preserved

### Exercise 2: Syncopation

Create an off-beat accent:

1. Make Note 2 start half a beat late
2. Make Note 1 duration 1.5 beats
3. Overlap creates syncopation

### Exercise 3: Triplets

Create triplet rhythm (3 notes in the space of 2):

```javascript
// Triplet duration (1/3 of a beat)
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1, 3))
```

### Exercise 4: Rest Simulation

Create the effect of a rest:

1. Make a note's duration shorter than the gap before the next note
2. Or: create a silent note (set a very low frequency that won't be heard)

## Chaining Rhythms

For complex rhythms, use note references:

```javascript
// Note 5 starts when Note 4 ends
module.getNoteById(4).getVariable('startTime')
  .add(module.getNoteById(4).getVariable('duration'))
```

This creates a chain where timing flows automatically.

## Save Your Module

1. **Menu** > **Save Module**
2. Name it `rhythmic-pattern.json`

## What You Learned

- How tempo, startTime, and duration relate
- Creating different note lengths
- Chaining notes for sequential rhythm
- Using quick controls for duration

## Next Steps

- [Note Dependencies](../intermediate/dependencies) - Create smarter timing chains
- [Working with Measures](../intermediate/measures) - Add measure structure
- Combine rhythm with [chords](./major-triad) for fuller arrangements
