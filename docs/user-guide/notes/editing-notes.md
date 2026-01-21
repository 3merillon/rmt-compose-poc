# Editing Notes

Learn how to modify existing notes in your composition.

## Selecting Notes

Before editing, select a note:

1. **Click** on a note rectangle in the workspace
2. The note is highlighted
3. The **Variable Widget** appears with editable properties

## Visual Editing (Workspace)

### Moving Notes

1. Select a note by clicking on it
2. **Drag the center** of the note rectangle
3. The note moves in time (horizontal) and frequency (vertical)
4. Release to place at the new position

**Grid snapping**: Notes snap to sixteenth-note intervals in time.

**Dependency preview**: Notes that depend on this one show their projected new positions.

### Resizing Notes (Duration)

1. Select a note
2. **Drag the right edge** (resize handle)
3. The duration changes
4. Dependent notes (those starting after this one ends) update their positions

### Octave Transposition

1. Select a note
2. Look for the **+** and **-** octave regions above and below the note
3. Click **+** to transpose up one octave (multiply frequency by 2)
4. Click **-** to transpose down one octave (divide frequency by 2)

## Property Editing (Variable Widget)

### Editing Frequency

**Quick method**: Use octave +/- buttons

**Expression method**:
1. Find the **frequency** row
2. Click on the **Raw** field
3. Enter a new expression:

```
// Major third above BaseNote
base.f * (5/4)

// Perfect fifth above Note 3
[3].f * (3/2)

// Exact frequency in Hz
440
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))
module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))
new Fraction(440)
```
</details>

4. Click **Save**

### Editing Start Time

1. Find the **startTime** row
2. Click on the **Raw** field
3. Enter a new expression:

```
// Start at time 0
0

// Start when Note 2 ends
[2].t + [2].d

// Start 2 beats after BaseNote
base.t + 2
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(0)
module.getNoteById(2).getVariable('startTime').add(module.getNoteById(2).getVariable('duration'))
module.baseNote.getVariable('startTime').add(new Fraction(2))
```
</details>

4. Click **Save**

### Editing Duration

**Quick method**: Use the note-length icons (whole, half, quarter, eighth, sixteenth)

**Dot modifiers**: Add 50% or 75% to the duration

**Expression method**:
1. Find the **duration** row
2. Click on the **Raw** field
3. Enter a new expression:

```
// 1 beat
1

// Half note (2 beats) at current tempo
60 / tempo(base) * 2

// Same duration as Note 3
[3].d
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
new Fraction(1)
new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(2))
module.getNoteById(3).getVariable('duration')
```
</details>

4. Click **Save**

### Changing Instrument

1. Find the **instrument** dropdown
2. Select from available instruments:
   - **Sine wave** (default)
   - **Square wave**
   - **Sawtooth wave**
   - **Triangle wave**
   - **Organ**
   - **Vibraphone**
   - **Piano** (sample)
   - **Violin** (sample)

**Instrument Inheritance:**

Instruments propagate through **frequency dependencies**. If a note doesn't have its own instrument set, it inherits from the note its frequency depends on:

- **BaseNote** → Sets the default instrument for all notes that depend on it
- **Note with own instrument** → Overrides inheritance; its dependents inherit from it
- **Note without own instrument** → Inherits from its frequency parent

Example: If BaseNote uses "Piano" and Note 1's frequency is `base.f * (3/2)`, Note 1 inherits "Piano". If you set Note 1 to "Violin", any notes whose frequency depends on Note 1 will inherit "Violin".

To reset a note to use inherited instrument, click **"Use Inherited"** in the instrument section.

### Changing Color

1. Find the **color** field
2. Enter a CSS color value:

```
rgba(255, 100, 100, 0.7)  // Red, 70% opacity
rgba(100, 200, 100, 0.7)  // Green
#ff6600                    // Orange (hex)
```

## Batch Operations

### Evaluate to BaseNote

Converts all references to direct BaseNote-relative expressions:

1. Select a note
2. Click **"Evaluate to BaseNote"** in the Variable Widget

This simplifies complex dependency chains.

### Evaluate Module

Evaluates all notes in the module at once:

1. Open the Variable Widget on any note
2. Click **"Evaluate Module"**

Useful for "flattening" a module before sharing.

## Deleting Notes

### Safe Delete

1. Select the note
2. Click **"Delete and Keep Dependencies"**
3. The note is removed
4. Dependent notes update their references

### Cascade Delete

1. Select the note
2. Click **"Delete and Remove Dependencies"**
3. The note AND all notes that depend on it are removed

::: danger Check Dependencies First
Look at the dependency lines before deleting. Cascade delete can remove many notes.
:::

### Liberate Dependencies

**"Liberate Dependencies"** rewrites all notes that depend on the selected note to bypass it, substituting the selected note's expressions directly into the dependent notes. This is useful for:

- **Moving a note independently**: After liberating, you can move or edit the note without affecting notes that previously depended on it
- **Breaking dependency chains**: Remove a note from the middle of a chain while preserving the chain's behavior
- **Pre-delete preparation**: Liberate first, then delete safely

**How it works:**

If Note 2's startTime is `[1].t + [1].d` (depends on Note 1), and Note 1's expressions are:
- startTime: `base.t`
- duration: `beat(base)`

After liberating Note 1, Note 2's startTime becomes `base.t + beat(base)` - the references to Note 1 are replaced with Note 1's actual expressions, bypassing Note 1 in the dependency chain.

::: info Edge Case
If the liberated note has a raw value (no expression) for a property, that raw value will be substituted directly. For example, if Note 1's duration is just `1` (a constant), dependents will get `1` substituted in.
:::

1. Select the note
2. Click **"Liberate Dependencies"**
3. Dependent notes now reference whatever the liberated note referenced (bypassing it in the dependency chain)

::: tip
"Delete and Keep Dependencies" performs the same operation automatically during deletion. Use "Liberate Dependencies" when you want to keep the note but break its dependent relationships.
:::

## Undo/Redo

All edits can be undone:

- **Undo**: `Ctrl/Cmd + Z`
- **Redo**: `Ctrl/Cmd + Y`

History is maintained for up to 50 changes.

## Tips

1. **Edit expressions carefully** - Syntax errors prevent saving
2. **Watch the evaluated value** - Verify your expression produces the expected result
3. **Use dependencies wisely** - They enable powerful cascading changes
4. **Liberate before deleting** - Preserve dependent notes when removing their source
5. **Test with playback** - Hear your changes to verify they sound correct
