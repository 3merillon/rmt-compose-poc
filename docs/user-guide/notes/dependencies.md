# Dependencies

**Dependencies** are the relationships between notes created when one note's expression references another. Understanding dependencies is crucial for building dynamic, flexible compositions.

## What Are Dependencies?

When a note's expression references another note, it creates a dependency:

```javascript
// Note 2's frequency depends on Note 1's frequency
note2.frequency = module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
```

In this example:
- Note 2 **depends on** Note 1
- Note 1 **has a dependent**: Note 2

## Visualizing Dependencies

When you select a note, dependency lines appear:

| Line Color | Meaning |
|------------|---------|
| **Blue/Cyan** | Notes this note **depends on** |
| **Red/Orange** | Notes that **depend on** this note |

### Example

If you select Note 3:
- **Blue lines** point to Notes 1 and 2 (Note 3 references them)
- **Red lines** point to Notes 4 and 5 (they reference Note 3)

## Property-Specific Dependencies

Dependencies are tracked per-property:

| Dependency Type | Description |
|-----------------|-------------|
| **Frequency dependency** | One note's frequency references another's |
| **Start time dependency** | One note's timing references another's |
| **Duration dependency** | One note's length references another's |

This enables smart behavior:
- **Drag preview**: Only notes whose *start time* depends on the dragged note move
- **Cascade updates**: Changing frequency only re-evaluates frequency-dependent notes

## Dependency Graph

RMT Compose maintains an **inverted index** for O(1) dependency lookup:

### Forward Dependencies

"What does this note depend on?"

```
Note 5 → depends on → {Note 1, Note 2}
Note 3 → depends on → {Note 1}
```

### Inverse Dependencies (Dependents)

"What depends on this note?"

```
Note 1 → depended on by → {Note 3, Note 5}
Note 2 → depended on by → {Note 5}
```

## Smart Drag Previews

When you drag a note:

1. The system queries: "Which notes' *start time* depends on this note?"
2. Only those notes show a preview of their new positions
3. Notes with unrelated dependencies don't move

This makes complex compositions feel responsive and predictable.

## Cascade Updates

When you change a note:

1. All notes that depend on it are marked "dirty"
2. Notes are re-evaluated in topological order (dependencies first)
3. The update cascades through the entire dependency chain

### Example Cascade

```
BaseNote (frequency: 440)
    ↓
Note 1 (frequency: BaseNote × 3/2 = 660)
    ↓
Note 2 (frequency: Note 1 × 5/4 = 825)
    ↓
Note 3 (frequency: Note 2 × 6/5 = 990)
```

If you change BaseNote's frequency to 220:
- Note 1 updates to 330
- Note 2 updates to 412.5
- Note 3 updates to 495

All from one change!

## Managing Dependencies

### Evaluate to BaseNote

Simplifies a note's expression to reference only BaseNote:

**Before:**
```javascript
module.getNoteById(3).getVariable('frequency').mul(new Fraction(5, 4))
// Note 3 frequency is: Note 2 × 3/2
// Note 2 frequency is: Note 1 × 5/4
// Note 1 frequency is: BaseNote × 3/2
```

**After:**
```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(45, 16))
// Direct computation: 3/2 × 5/4 × 3/2 × 5/4 = 45/16
```

Use this to "freeze" a note's value or simplify complex chains.

### Liberate Dependencies

Converts other notes' references to *this* note into raw values:

**Before:**
```javascript
// Note 3 references Note 2
note3.frequency = module.getNoteById(2).getVariable('frequency').mul(...)
```

**After:**
```javascript
// Note 3 has the computed value directly
note3.frequency = new Fraction(825)
```

Use this before deleting a note that others depend on.

## Circular Dependencies

**Circular dependencies are not allowed.**

```javascript
// Note A depends on Note B
noteA.freq = module.getNoteById(B).getVariable('frequency').mul(...)

// Note B depends on Note A - ERROR!
noteB.freq = module.getNoteById(A).getVariable('frequency').mul(...)
```

The app prevents you from creating circular references.

## BaseNote Dependencies

The **BaseNote** is special:
- It has no dependencies (it's the root)
- Almost all notes ultimately depend on it
- Changing BaseNote affects the entire composition

```
BaseNote (root)
    ├── Note 1
    │   ├── Note 3
    │   └── Note 4
    └── Note 2
        └── Note 5
```

## Tips

1. **Check dependency lines** before making changes - see what will be affected
2. **Use BaseNote references** for notes that should transpose together
3. **Use note-to-note references** for relative relationships (intervals, timing chains)
4. **Liberate before deleting** to preserve dependent notes
5. **Evaluate to BaseNote** to simplify complex chains
6. **Avoid deep chains** - they're harder to understand and debug

## Common Patterns

### Sequential Melody

Each note starts when the previous ends:

```javascript
note2.startTime = note1.startTime + note1.duration
note3.startTime = note2.startTime + note2.duration
note4.startTime = note3.startTime + note3.duration
```

### Chord Stack

All notes share the same start time:

```javascript
note2.startTime = note1.startTime
note3.startTime = note1.startTime
note4.startTime = note1.startTime
```

### Parallel Motion

Notes maintain the same interval:

```javascript
note2.frequency = note1.frequency × 5/4  // Third above
note3.frequency = note1.frequency × 3/2  // Fifth above
// Moving note1 moves all three in parallel
```

### Relative Transposition

One note is the reference, others follow:

```javascript
rootNote.frequency = baseNote × someInterval
third.frequency = rootNote × 5/4
fifth.frequency = rootNote × 3/2
// Changing rootNote's interval changes the whole chord
```
