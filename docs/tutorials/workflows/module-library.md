# Creating a Module Library

Learn how to build, organize, and maintain a personal library of reusable modules.

## Why Build a Module Library?

A well-organized module library lets you:
- **Reuse patterns**: Save common chord progressions, scales, or rhythms
- **Experiment faster**: Start from templates instead of scratch
- **Share work**: Export modules for others to use
- **Learn**: Study interesting modules you create or collect

## Module Library Structure

Modules are organized in the Module Bar by category:

```
Module Bar
├── Category 1
│   ├── Module A
│   ├── Module B
│   └── Module C
├── Category 2
│   └── Module D
└── Category 3
    ├── Module E
    └── Module F
```

## Creating Your First Module

### Step 1: Build the Composition

Create notes with the patterns you want to save:

```javascript
// Example: Major Triad module

// Root
frequency: module.baseNote.getVariable('frequency')
startTime: new Fraction(0)
duration: new Fraction(1)

// Major Third
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')

// Perfect Fifth
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
startTime: module.getNoteById(1).getVariable('startTime')
duration: module.getNoteById(1).getVariable('duration')
```

### Step 2: Save the Module

1. Click **File** in the top bar
2. Select **Save Module**
3. Enter a descriptive name: "Major Triad (Just)"
4. Choose or create a category
5. Click **Save**

### Step 3: Test the Module

1. Clear the workspace
2. Open the Module Bar
3. Find your saved module
4. Drag it onto the workspace
5. Verify all notes and dependencies load correctly

## Organizing Categories

### Suggested Category Structure

```
Scales
├── Major Scales
├── Minor Scales
├── Modes
├── Pentatonic
└── Microtonal

Chords
├── Triads
├── Seventh Chords
├── Extended
└── Clusters

Progressions
├── Jazz
├── Classical
├── Pop
└── Custom

Rhythms
├── Basic
├── Syncopated
└── Polyrhythmic

TET Systems
├── 12-TET
├── 19-TET
├── 31-TET
└── Bohlen-Pierce

Templates
├── Song Structures
├── Accompaniment
└── Solo Frameworks
```

### Creating a New Category

1. Open Module Bar settings
2. Click **Add Category**
3. Enter category name
4. Drag modules into the new category

## Building Useful Templates

### Scale Template

Create a reusable scale that can be transposed:

```javascript
// All notes depend on BaseNote.frequency
// Transposing is as simple as changing BaseNote

// Note 1: Root (unison)
frequency: module.baseNote.getVariable('frequency')

// Note 2: Second
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(9, 8))

// Note 3: Third
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))

// ... continue for full scale
```

**Why this works**: Changing BaseNote's frequency transposes the entire scale.

### Chord Progression Template

```javascript
// Chord 1: I (root position)
// Notes 1-3: Triad based on BaseNote

// Chord 2: IV (subdominant)
// Notes 4-6: Triad based on 4/3 × BaseNote.frequency

// Chord 3: V (dominant)
// Notes 7-9: Triad based on 3/2 × BaseNote.frequency

// Chord 4: I (return to tonic)
// Notes 10-12: Copy of Chord 1 structure
```

### Rhythm Template

```javascript
// Create beat references that other notes can follow

// Beat 1 marker
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Beat 2 marker
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// ... continue for full measure
```

## Best Practices for Module Design

### 1. Use BaseNote as the Root

Always reference BaseNote for primary values:

```javascript
// Good: Inherits from BaseNote (easy to customize)
frequency: module.baseNote.getVariable('frequency').mul(...)

// Less flexible: Hard-coded value
frequency: new Fraction(440).mul(...)
```

### 2. Create Self-Contained Dependencies

Modules should work independently:

```javascript
// Good: Note 2 depends on Note 1 within the same module
frequency: module.getNoteById(1).getVariable('frequency').mul(...)

// Problematic: Depends on external note ID that may not exist
frequency: module.getNoteById(50).getVariable('frequency').mul(...)
```

### 3. Document Complex Modules

Add a description when saving:
- What the module does
- How to customize it
- Any special notes

### 4. Test Before Saving

1. Play through the module
2. Try changing BaseNote values
3. Verify all dependencies update correctly

## Combining Modules

### Drag and Drop

You can load multiple modules into one workspace:

1. Drag Module A onto workspace
2. Drag Module B onto workspace
3. Both coexist (note IDs are reassigned to avoid conflicts)

### Connecting Modules

After loading multiple modules, create dependencies between them:

```javascript
// Module A's note
frequency: module.baseNote.getVariable('frequency')  // ID assigned: 1

// Module B's note (wants to follow Module A)
// After B loads, find its new ID (e.g., 5)
// Edit to reference Module A's note:
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
```

## Exporting and Sharing

### Export a Module

1. Right-click the module in the Module Bar
2. Select **Export**
3. Save the `.json` file

### Import a Module

1. Click **File** → **Import Module**
2. Select the `.json` file
3. Choose a category
4. The module appears in your library

### Module File Format

Modules are saved as JSON:

```json
{
  "name": "Major Triad (Just)",
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "duration": "new Fraction(1)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency')",
      "startTime": "new Fraction(0)",
      "duration": "new Fraction(1)"
    }
  ]
}
```

## Module Maintenance

### Updating a Module

1. Load the module
2. Make changes
3. Save with the same name (overwrites)

### Versioning

For significant changes, consider saving as a new module:
- "Major Scale v1"
- "Major Scale v2 (with rhythm)"

### Cleaning Up

Periodically review your library:
- Remove duplicates
- Consolidate similar modules
- Update outdated patterns

## Example: Building a Complete Library

### Day 1: Basic Intervals

Create modules for each pure interval:
- Unison (1/1)
- Minor Second (16/15)
- Major Second (9/8)
- Minor Third (6/5)
- Major Third (5/4)
- Perfect Fourth (4/3)
- Tritone (45/32)
- Perfect Fifth (3/2)
- Minor Sixth (8/5)
- Major Sixth (5/3)
- Minor Seventh (9/5)
- Major Seventh (15/8)
- Octave (2/1)

### Day 2: Triads

- Major Triad (1, 5/4, 3/2)
- Minor Triad (1, 6/5, 3/2)
- Diminished Triad (1, 6/5, 64/45)
- Augmented Triad (1, 5/4, 25/16)

### Day 3: Seventh Chords

- Major 7th
- Dominant 7th
- Minor 7th
- Half-Diminished 7th
- Fully Diminished 7th

### Day 4: Scales

- Major Scale (all modes)
- Natural Minor Scale
- Harmonic Minor Scale
- Pentatonic Scales

### Day 5: TET Systems

- 12-TET Chromatic Scale
- 19-TET Scale
- 31-TET Scale
- Bohlen-Pierce Scale

## Tips for Library Growth

### 1. Save Early, Save Often

Don't wait until something is perfect. Save works-in-progress.

### 2. Name Descriptively

"Chord 1" → "Major 7th (Root Position, Just)"

### 3. Group Related Modules

Keep inversions together, related progressions together, etc.

### 4. Experiment

Your library should grow from exploration. Save interesting accidents!

## Next Steps

- [Interval Exploration](/tutorials/workflows/intervals) - Systematically study intervals
- [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) - Build a microtonal collection
- [Module Format Reference](/reference/properties/module-schema) - Technical module details

