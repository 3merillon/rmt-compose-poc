# Dependencies

**Dependencies** are the relationships between notes created when one note's expression references another. Understanding dependencies is crucial for building dynamic, flexible compositions.

## What Are Dependencies?

When a note's expression references another note, it creates a dependency:

```
// Note 2's frequency depends on Note 1's frequency
[1].f * (5/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
```
</details>

In this example:
- Note 2 **depends on** Note 1
- Note 1 **has a dependent**: Note 2

## Visualizing Dependencies

When you select a note, dependency lines appear, color-coded by which property is affected:

| Line Color | Property Affected |
|------------|-------------------|
| **Orange** | Frequency dependencies |
| **Teal/Cyan** | Start time dependencies |
| **Purple** | Duration dependencies |

### Line Thickness

- **Thick lines** → Connect to **parent** notes (notes the selected note depends on)
- **Thin lines** → Connect to **child** notes (notes that depend on the selected note)

### Example

If you select Note 3:
- **Thick orange line** to Note 1 means Note 3's frequency depends on Note 1
- **Thin teal lines** to Notes 4 and 5 mean their start times depend on Note 3

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
```
[3].f * (5/4)
// Note 3 frequency is: Note 2 × 3/2
// Note 2 frequency is: Note 1 × 5/4
// Note 1 frequency is: BaseNote × 3/2
```

**After:**
```
base.f * (45/16)
// Direct computation: 3/2 × 5/4 × 3/2 × 5/4 = 45/16
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Before
module.getNoteById(3).getVariable('frequency').mul(new Fraction(5, 4))

// After
module.baseNote.getVariable('frequency').mul(new Fraction(45, 16))
```
</details>

Use this to "freeze" a note's value or simplify complex chains.

### Liberate Dependencies

Rewrites other notes' references to bypass *this* note, substituting the liberated note's expressions directly:

**Before:** Note 3 references Note 2, and Note 2's frequency is `base.f * (3/2)`
```
// Note 3's frequency
[2].f * (5/4)
```

**After:** Note 3 now references what Note 2 referenced (bypassing Note 2)
```
// Note 3's frequency - Note 2's expression substituted in
base.f * (3/2) * (5/4)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
// Before
module.getNoteById(2).getVariable('frequency').mul(new Fraction(5, 4))

// After - Note 2's expression substituted
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2)).mul(new Fraction(5, 4))
```
</details>

Use this to move/edit a note without affecting its dependents, or before deleting a note.

## Circular Dependencies

**Circular dependencies are not allowed.**

```
// Note A depends on Note B
[B].f * (3/2)

// Note B depends on Note A - ERROR!
[A].f * (5/4)
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

```
// Note 2 starts when Note 1 ends
[1].t + [1].d

// Note 3 starts when Note 2 ends
[2].t + [2].d

// Note 4 starts when Note 3 ends
[3].t + [3].d
```

### Chord Stack

All notes share the same start time:

```
// Notes 2, 3, 4 all start at the same time as Note 1
[1].t
```

### Parallel Motion

Notes maintain the same interval:

```
// Note 2: Third above Note 1
[1].f * (5/4)

// Note 3: Fifth above Note 1
[1].f * (3/2)

// Moving Note 1 moves all three in parallel
```

### Relative Transposition

One note is the reference, others follow:

```
// Root note: some interval above BaseNote
base.f * (9/8)

// Third: major third above root (Note 1)
[1].f * (5/4)

// Fifth: perfect fifth above root (Note 1)
[1].f * (3/2)

// Changing the root's interval changes the whole chord
```
