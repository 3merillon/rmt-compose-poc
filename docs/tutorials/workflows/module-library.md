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

```
// Example: Major Triad module

// Root
frequency: base.f
startTime: 0
duration: 1

// Major Third
frequency: [1].f * (5/4)
startTime: [1].t
duration: [1].d

// Perfect Fifth
frequency: [1].f * (3/2)
startTime: [1].t
duration: [1].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

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

</details>

### Step 2: Save the Module

1. Click the **Menu** button (plus/minus icon) in the top bar
2. Click **Save Module**
3. A JSON file downloads to your computer (e.g., `module.json`)
4. Rename the downloaded file descriptively: `major-triad-just.json`

### Step 3: Add to Module Bar

1. In the Module Bar, find the category where you want the module (e.g., **Chords**)
2. Click the **+** placeholder icon in that category
3. Select your saved JSON file
4. The module appears in the category

### Step 4: Test the Module

1. Drag the module from the Module Bar onto a note in the workspace
2. Verify all notes and dependencies load correctly
3. Play to confirm the sound is correct

## Organizing Categories

### Default Categories

The Module Bar comes with four built-in categories:

| Category | Description |
|----------|-------------|
| **Intervals** | Single intervals (octave, fifth, third, etc.) |
| **Chords** | Common chord voicings (major, minor, etc.) |
| **Melodies** | Example sequences including TET scales |
| **Custom** | Your personal module library |

### Suggested Organization

Since categories are currently flat (no nested subcategories), use naming conventions to organize:

```
Scales (category)
├── Major Scale C.json
├── Major Scale D.json
├── Minor Scale A.json
├── Pentatonic C.json
└── 19-TET Scale.json

Chords (category)
├── Major Triad.json
├── Minor Triad.json
├── Major 7th.json
├── Dominant 7th.json
└── Diminished.json
```

**Tip**: Use descriptive filenames since module names in the Module Bar are derived from filenames.

### Creating a New Category

1. Click the **Add Category** button in the Module Bar
2. Enter a name for the category (e.g., "My Progressions")
3. The new category appears in the Module Bar
4. Drag existing modules into it, or click **+** to upload new ones

## Building Useful Templates

### Scale Template

Create a reusable scale that can be transposed:

```
// All notes depend on BaseNote.frequency
// Transposing is as simple as changing BaseNote

// Note 1: Root (unison)
frequency: base.f

// Note 2: Second
frequency: base.f * (9/8)

// Note 3: Third
frequency: base.f * (5/4)

// ... continue for full scale
```

**Why this works**: Changing BaseNote's frequency transposes the entire scale.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Note 1: Root (unison)
frequency: module.baseNote.getVariable('frequency')

// Note 2: Second
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(9, 8))

// Note 3: Third
frequency: module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
```

</details>

### Chord Progression Template

```
// Chord 1: I (root position)
// Notes 1-3: Triad based on BaseNote

// Chord 2: IV (subdominant)
// Notes 4-6: Triad based on base.f * (4/3)

// Chord 3: V (dominant)
// Notes 7-9: Triad based on base.f * (3/2)

// Chord 4: I (return to tonic)
// Notes 10-12: Copy of Chord 1 structure
```

### Rhythm Template

```
// Create beat references that other notes can follow

// Beat 1 marker
startTime: 0
duration: beat(base)

// Beat 2 marker
startTime: [1].t + [1].d
duration: beat(base)

// ... continue for full measure
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Beat 1 marker
startTime: new Fraction(0)
duration: new Fraction(60).div(module.findTempo(module.baseNote))

// Beat 2 marker
startTime: module.getNoteById(1).getVariable('startTime')
  .add(module.getNoteById(1).getVariable('duration'))
duration: new Fraction(60).div(module.findTempo(module.baseNote))
```

</details>

## Best Practices for Module Design

### 1. Use BaseNote as the Root

Always reference BaseNote for primary values:

```
// Good: Inherits from BaseNote (easy to customize)
frequency: base.f * (...)

// Less flexible: Hard-coded value
frequency: 440 * (...)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Good: Inherits from BaseNote (easy to customize)
frequency: module.baseNote.getVariable('frequency').mul(...)

// Less flexible: Hard-coded value
frequency: new Fraction(440).mul(...)
```

</details>

### 2. Create Self-Contained Dependencies

Modules should work independently:

```
// Good: Note 2 depends on Note 1 within the same module
frequency: [1].f * (...)

// Problematic: Depends on external note ID that may not exist
frequency: [50].f * (...)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Good: Note 2 depends on Note 1 within the same module
frequency: module.getNoteById(1).getVariable('frequency').mul(...)

// Problematic: Depends on external note ID that may not exist
frequency: module.getNoteById(50).getVariable('frequency').mul(...)
```

</details>

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

### Module Bar Drop Mode

The Module Bar has a **"Drop at:"** toggle that controls how modules integrate:

- **Start mode**: Module notes are placed at the beginning of the target note (references `base.t` become `[target].t`). Ideal for **building chords** - stack modules at the same start time.
- **End mode**: Module notes are placed at the end of the target note (references `base.t` become `[target].t + [target].d`). Ideal for **building scales** - chain modules sequentially.

### Drag and Drop

You can load multiple modules into one workspace:

1. Drag Module A onto workspace
2. Drag Module B onto workspace
3. Both coexist (note IDs are reassigned to avoid conflicts)

### Connecting Modules

After loading multiple modules, create dependencies between them:

```
// Module A's note
frequency: base.f  // ID assigned: 1

// Module B's note (wants to follow Module A)
// After B loads, find its new ID (e.g., 5)
// Edit to reference Module A's note:
frequency: [1].f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Module A's note
frequency: module.baseNote.getVariable('frequency')  // ID assigned: 1

// Module B's note (wants to follow Module A)
// After B loads, find its new ID (e.g., 5)
// Edit to reference Module A's note:
frequency: module.getNoteById(1).getVariable('frequency').mul(new Fraction(3, 2))
```

</details>

## Saving and Loading

### Save Your Current Workspace as a Module

1. Click **Menu** (plus/minus icon) in the top bar
2. Click **Save Module**
3. A JSON file downloads to your computer
4. Rename it descriptively (e.g., `major-triad-just.json`)

### Add a Module to the Module Bar

1. Find the category where you want the module
2. Click the **+** placeholder icon
3. Select your JSON file
4. The module appears and can be dragged onto the workspace

### Save Your Module Bar Layout

To preserve your category organization and uploaded modules:

1. Click **Save UI** in the Module Bar
2. A `ui-state.json` file downloads
3. This saves category order, module positions, and uploaded module data

### Restore Your Module Bar Layout

1. Click **Load UI** in the Module Bar
2. Select a previously saved `ui-state.json` file
3. Your categories and modules are restored

### Module File Format

Modules are saved as JSON with DSL expressions:

```json
{
  "baseNote": {
    "frequency": "440",
    "startTime": "0",
    "tempo": "120",
    "beatsPerMeasure": "4"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f",
      "startTime": "base.t",
      "duration": "beat(base)"
    },
    {
      "id": 2,
      "frequency": "base.f * (5/4)",
      "startTime": "[1].t",
      "duration": "[1].d"
    }
  ]
}
```

## Module Maintenance

### Updating a Module

1. Drag the module onto the workspace
2. Make your changes
3. Click **Menu** > **Save Module**
4. Delete the old version from Module Bar (click the red **×** on the module icon)
5. Upload the new JSON file to the same category

### Versioning

For significant changes, save with version numbers in the filename:
- `major-scale-v1.json`
- `major-scale-v2-with-rhythm.json`

### Cleaning Up

- Click the red **×** on any module icon to remove it
- Use **Reload Defaults** to reset to factory modules (warning: removes custom uploads)
- Use **Save UI** before cleaning to back up your organization

### Persistence

The Module Bar auto-saves to browser localStorage:
- Every 30 seconds
- When the page closes
- After any change (add, remove, reorder)

**Note**: Clearing browser data will lose your Module Bar customizations. Use **Save UI** to create a backup file.

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

## Adding Modules Permanently (Local Development)

To add modules that persist across all users (in the source code):

1. Create your module JSON file
2. Place it in the appropriate category folder:
   ```
   public/modules/custom/my-module.json
   ```
3. Edit that category's `index.json` to list your file:
   ```json
   [
     "existing-module.json",
     "my-module.json"
   ]
   ```
4. Rebuild or refresh the app

## Tips for Library Growth

### 1. Save Early, Save Often

Don't wait until something is perfect. Save works-in-progress.

### 2. Name Files Descriptively

Since module names come from filenames:
- ✓ `major-seventh-chord.json`
- ✓ `19-TET-scale.json`
- ✗ `test.json`
- ✗ `untitled.json`

### 3. Back Up Regularly

Use **Save UI** to export your Module Bar configuration before clearing browser data.

### 4. Experiment

Your library should grow from exploration. Save interesting accidents!

## Next Steps

- [Interval Exploration](/tutorials/workflows/intervals) - Systematically study intervals
- [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) - Build a microtonal collection
- [Module Bar Reference](/user-guide/interface/module-bar) - Full Module Bar documentation

