---
title: Note Dependencies
description: Chain notes together with expressions that reference other notes, read the coloured dependency lines, and break a chain cleanly when you need to.
---

# Note Dependencies

A dependency is what happens when one note's expression names another note. This tutorial builds a chain, shows you how to read it on screen, and shows you how to get out of it.

**Prerequisites:** the [beginner tutorials](/tutorials/).

## What a dependency is

Write this in Note 2's frequency field:

```
[1].f
```

Note 2 now **depends on** Note 1's frequency. Change Note 1 and Note 2 follows, without you touching it. `[1]` means "note with id 1"; `.f` means frequency. The other shortnames are `.t` (startTime) and `.d` (duration).

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.getNoteById(1).getVariable('frequency')
```
</details>

## Why bother

Suppose you want three notes: a root, a fifth above it, and an octave above it.

**Written as numbers** — at the default base of 263 Hz, that is 263, 394.5, 526. Now transpose the passage. You edit three notes, and you do arithmetic to do it.

**Written as relationships:**

| Note | Frequency |
|---|---|
| 1 | `base.f` |
| 2 | `[1].f * (3/2)` |
| 3 | `[1].f * 2` |

Change Note 1 once and the other two move with it, exactly in tune, forever. That is the whole idea.

## Build a chain

### Step 1: the root

1. Click the **BaseNote**, **Clean Slate** the workspace, then click the BaseNote again.
2. In **ADD NOTE / SILENCE**, accept the defaults (`base.f`, `beat(base)`, `base.t`) and click **Create**.

Note 1 inherits the BaseNote's pitch — **263 Hz** by default.

### Step 2: a note that depends on it

1. With Note 1 selected, keep the position on **At End**.
2. Set **Frequency** to `[1].f * (3/2)` — a perfect fifth above Note 1.
3. **Start Time** is already `[1].t + [1].d`. That is a *second* dependency: Note 2's timing follows Note 1's too.
4. Click **Create Note**.

### Step 3: extend it

Select Note 2 and create Note 3 from it, **At End**:

| Field | Expression |
|---|---|
| Frequency | `[2].f * (4/3)` |
| Start Time | `[2].t + [2].d` (already filled in) |

You now have a chain: BaseNote → Note 1 → Note 2 → Note 3. Change the BaseNote's frequency and all three move.

## Reading the lines

Select a note. Coloured lines appear between it and the notes it is related to. **They only show while a note is selected** — click empty background and they vanish.

| Colour | Property |
|---|---|
| Orange | frequency |
| Teal | startTime |
| Purple | duration |

| Thickness | Meaning |
|---|---|
| Thick | what the selected note **depends on** |
| Thin | what **depends on** the selected note |

So selecting Note 2 in the chain above gives you thick orange and thick teal lines back to Note 1, and thin orange and thin teal lines forward to Note 3.

::: tip
Start dragging a note and the lines that do not matter for that gesture fade almost to nothing. Move a note and the teal (startTime) lines stay bright while orange and purple dim; resize it and the purple (duration) lines stay bright instead. The app is showing you what your gesture will actually disturb.
:::

## Dependencies you will actually use

### Sequential timing

```
[1].t + [1].d
```

Start when Note 1 ends. The **At End** radio writes this.

### Simultaneous timing

```
[1].t
```

Start when Note 1 starts. The **At Start** radio writes this. This is how chords are built.

### An offset

```
[1].t + beat(base) * (1/2)
```

Half a beat after Note 1 starts. Write the offset in beats, not seconds — `[1].t + (1/2)` would mean half a *second*, which will not survive a tempo change.

### Shared duration

Give several notes the same length by pointing them all at one:

| Note | Duration | Role |
|---|---|---|
| 1 | `beat(base) * 2` | the master |
| 2, 3, 4 | `[1].d` | followers |

Resize Note 1 and they all resize. Purple lines will show you the group.

### Multi-property

A note can take different properties from different notes:

| Property | Expression |
|---|---|
| frequency | `[1].f * (5/4)` |
| startTime | `[3].t` |
| duration | `[3].d` |

Its pitch belongs to Note 1's harmonic structure; its timing belongs to Note 3's rhythm.

## Circular dependencies are rejected

If A depends on B and you try to make B depend on A, the app refuses the edit. It also refuses an expression that references its own note.

The rejection tells you why: the validator's message appears in red under the Save button — a cycle, a self-reference or a typo each get their own wording — and the old expression stays until you fix it.

## Getting out of a chain

Sometimes a note needs to stop following its parent — but stay exactly where it is. Two buttons in the widget's **EVALUATE** section do that.

### Liberate Dependencies

Select a note, click **Liberate Dependencies**, confirm.

Every note that referenced *this* note has the reference replaced by this note's own raw expressions. The dependents keep their pitches, positions and lengths — they just no longer point here. The note itself survives, unchanged.

Use it when you want to delete or radically change a note without dragging its children along.

::: info
**Liberate Dependencies** is not offered on measure bars, and is refused if something tries to call it on one.
:::

### Evaluate to BaseNote

Select a note, click **Evaluate to BaseNote**, confirm.

This rewrites the selected note's own startTime, duration and frequency so they reference nothing but the BaseNote. The note stops depending on anything else, and it does not move.

It is smarter than freezing numbers: it traces the frequency chain algebraically, so a TET note written `base.f * 2^(7/12)` stays a power expression rather than collapsing into an ugly approximate fraction.

From the **BaseNote**, the same section offers **Evaluate Module**, which does this to every note at once. It flattens the entire dependency graph onto the BaseNote — useful before exporting, destructive to the structure you built.

## Deleting a note in a chain

Selecting a note gives you two delete buttons, and they do very different things:

| Button | Effect |
|---|---|
| **Keep Dependencies** | The dependents are liberated first, then the note is removed. They keep their positions. |
| **Delete Dependencies** | The note **and every note that depends on it** are removed. The doomed notes are highlighted in red before you confirm. |

Deleting a multi-note selection with the group widget's **Delete all** behaves like *Keep Dependencies*: notes outside the selection that depended on a deleted note are liberated, not cascaded, so they hold their positions.

## Verifying your chain

1. Select the root and change its frequency.
2. Every dependent should move, in tune.
3. Select each note and read the `Evaluated:` line against the `Raw:` expression.

If a note is not updating, check the note id in the expression: `[7].f` when you meant `[1].f` is the most common mistake, and it fails quietly because note 7 may well exist.

## Next

- [Octave Manipulation](/tutorials/intermediate/octaves) — moving a note, and everything under it, by an interval
- [Working with Measures](/tutorials/intermediate/measures) — dependency chains made of measure bars
- [Complex Dependencies](/tutorials/advanced/complex-dependencies) — branching and diamond structures
- [Expression Syntax](/reference/expressions/syntax) — the full grammar
