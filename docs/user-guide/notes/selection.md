---
title: Selection & Group Editing
description: Select several notes with a marquee, a shift-click or by their relations, change amplitude, attack, release, pitch, length, instrument or colour on all of them at once, drag them as one, delete them safely, and save a selection to the module library.
---

# Selection & Group Editing

Most of the time you work on one note: you click it, it gets a selection ring, and the
[note widget](/user-guide/interface/variable-widget) opens on it.

Select notes, silences and measure triangles together to move them in time, change their durations, copy them to the module library or delete them. The floating **group widget** counts notes and measures separately. Selected notes have a heavy outline, and selected measure triangles are highlighted.

On desktop, a single remaining item opens its own widget. On touch, the first long-press opens a one-item group so you can add or remove further items with a tap.

![A selection rectangle crosses the early canon notes, with intersected notes outlined](/img/multi-select-marquee.png)

*While the pointer is down, the rectangle previews the selection. Release it to open the group widget.*

## Before you start: unlock the notes

Multi-select does nothing while the workspace is locked. The padlock (**Lock Notes**) — the small
button pinned to the **bottom-right corner of the window** — kills all picking, hovering, dragging
and selection.

The lock is **off by default**, so on a fresh page you can select straight away. If nothing you
click responds, check the padlock first.

## Gestures

| | Desktop (mouse or pen) | Touch |
|---|---|---|
| **Draw a marquee** | Hold **Shift** and drag anywhere, including from a note or measure triangle | Hold still for about half a second, then drag. Holding an item toggles it before the drag begins. |
| **Toggle a note or measure** | **Shift + click** the note body or triangle | Long-press to begin a group, then tap items to add or remove them |
| **Move the group** | Drag a selected note body or measure triangle | Drag a selected note body or measure triangle |
| **Open a single item** | Plain click the item | Tap empty space to leave group mode, then tap the item |
| **Clear the selection** | Click empty background or **Clear selection** | Tap empty background or **Clear selection** |

Moving more than about 8 px before the long-press fires starts the usual pan or drag. Lifting early gives a tap.

::: tip
Adding a second finger cancels the selection box so you can pinch to zoom. An item already toggled by a completed long-press keeps its selection.
:::

### Adding to a selection

- Shift-click a note or measure triangle to toggle it. An item you selected with an ordinary click joins the group when you Shift-click a second item.
- On touch, tapping the last selected item removes it and ends group mode. Tapping empty background also clears the group.
- A marquee adds to an active group. Clear the selection first to draw a fresh rectangle.
- Shift-clicking empty background preserves the current selection.

### What can be selected

The marquee picks up any note body or measure triangle it touches, even partly. To add a bar, cross the triangle at the bottom of the workspace. Crossing just its dashed line leaves the bar out. The BaseNote stays outside group selections.

### Selecting by relation

The note widget's **SELECT** section selects a note together with the notes related to it, as a
group (see [Note Widget → Select](/user-guide/interface/variable-widget#select)):

- **Dependents** — the notes that read this one, then the notes that read those, and so on.
- **Dependencies** — the notes this one reads, back to the BaseNote (which is never selected).

The letter says which variable of the *reading* note is followed: **t** its start, **f** its
frequency, **d** its duration, **all** any variable. A melody whose notes each begin where the one
before ends (`[p].t + [p].d`) is, from its first note, exactly its **Dependents t**. In the canon
that opens the app, **Dependents t** from the first bass note selects both basses, because the
second is written from the first, and **Dependents f** from a bass note selects the note that
answers it a fifth higher.

## The group widget

The widget opens at the bottom right. Drag its header to move it. You can keep composing, playing and panning while it is open.

With only measures selected, **Change** offers **duration**. With a mixed selection, duration applies to notes and measures, and the other variables, instrument and colour apply to notes. **Copy to Modules** and **Delete all** include every selected item.

| Part | What it does |
|---|---|
| Header | The live count, for example *“3 notes and 2 measures selected”* |
| **×** | Clears the selection (same as **Clear selection**) |
| **Change** | One variable (amplitude, attack, release, frequency, duration), one expression, and **Set**, **×** or **Inherit** — see [Changing a group](#changing-a-group) |
| **Instrument** | The list of instruments and two buttons: **Each note its own player** sets the instrument on every selected note; **One player** sets it only on the notes that start the selection's lines and lets the others inherit it. Choosing *inherited* makes every selected note inherit again — see [Instruments](/user-guide/playback/instruments#several-notes-at-once) |
| **Colour** | Gives every selected note a colour (`#ff8800`, `rgba(0,0,255,0.5)`, a colour name) |
| **Copy to Modules** | Saves the selection to the library's Custom section. Non-destructive. |
| **Delete all** | Deletes all selected notes and measures after confirmation |
| **Clear selection** | Deselects everything |

Pressing **Escape** clears the selection, but only while focus is already inside the widget (for
example, right after you tab into it). There is no global Escape-to-deselect and no Delete-key
shortcut — see [Keyboard Shortcuts](/user-guide/interface/keyboard-shortcuts).

## Changing a group

Pick a variable in **Change**, type an expression or a ratio, and choose how it applies:

| Button | What it does |
|---|---|
| **Set** | Writes the expression to every selected note, replacing what each had, relations included. `3/4` as amplitude makes every note 3/4; `[9].a` makes every note read note 9's (note 9 itself is skipped: it would read itself). |
| **×** | Multiplies each note's own value by the ratio, keeping its relations: `3/4`, `0.75`, `2`, or a tempered factor such as `2^(1/12)`, which stays exact. **Enter** in the field does the same. |
| **Inherit** | Removes the notes' own amplitude, attack or release, so each inherits again (the BaseNote's, else 1 for amplitude, else the instrument's envelope). |

**× changes each note once.** A selected note whose value is read, through the same variable, from
another selected note follows that note: it is not multiplied itself, or it would change twice.
Transpose a chord whose third and fifth hang off its root by `3/2` and only the root is
multiplied; the third and the fifth follow it, and the chord keeps its intervals. In the canon, 57 green answering notes take their pitches a fifth above blue notes. The green A in bar 5 instead reads the following red E. Scaling a mixed selection follows the written pitch links in each case. [Trace the bar-five exception](/tutorials/workflows/canon-and-cadences#follow-the-exception-in-bar-5).

The same holds for notes outside the selection: whatever reads a changed note follows it,
as it does for any edit.

**× on duration** changes every length by the ratio, and a note that begins where another ends
(`[p].t + [p].d`) moves with it, so a chained melody spreads out or closes up by itself. A note
whose start is written from the BaseNote keeps its start.

A note **×** cannot change is skipped and counted in the message that follows: an attack or
release multiplied where nothing sets one (the instrument's envelope has no value to multiply),
or a Set that would make a note read itself. Each change is one undo step, and undo keeps the
group selected, so you can try another value straight away.

## Moving a group

Drag a selected note body or a triangle in a group of two or more items. Every selected timed item shifts by the same amount. The preview stops when the earliest item reaches the BaseNote. Playback pauses for the move, and Undo restores the whole group in one step.

When a measure is in the group, the move keeps the length of the preceding bar. An item linked to the end of another selected item follows it. For example, `[1].t + [1].d` keeps that expression when item 1 moves with it. If a start expression follows by a different amount, the editor adds the offset needed to keep the selection together. Items outside the selection continue to follow their expressions.

For a group of ordinary notes, the editor moves the roots of their start-time chains. It applies the same timing and pitch re-anchoring rules as an ordinary note drag.

The right-hand resize tab and [▲/▼ arrows](/user-guide/notes/transposing) still edit one note. Use **Change → duration** to resize the group or **Change → frequency** to transpose its notes.

### Try a mixed group in the opening canon

Shift-click the first two blue bass notes and the first measure triangle. On touch, hold the first blue note, lift and tap the other two items. Check for **2 notes and 1 measure**. Under **Change**, choose **duration**, enter `2` and press **×**. The bar grows from 2.4 to 4.8 seconds and the two short bass notes from 0.15 to 0.30 seconds. Their following notes still read the ends of their predecessors. Undo to compare.

![The group widget shows two notes and one measure, with duration selected and 2 entered](/img/mixed-group-duration.png)

*Press × to double each selected length.*

To reuse the group, press **Copy to Modules** and find **Selection (2 notes and 1 measure)** in **Custom**. Drag the tile onto the orange BaseNote. The workspace gains two notes and a measure. Undo removes that import while leaving the tile available.

## Deleting a group

Click **Delete all**. A confirmation appears, then:

- Every selected note and measure is removed.
- **Notes outside the group that depended on them are liberated, not deleted.** The deleted notes'
  expressions are inlined into whatever still referenced them, so those notes keep their exact
  positions, lengths and pitches. A direct dependent with no instrument of its own has the
  instrument it was playing written onto it, and so starts a player of its own.
- The whole delete is **one undo entry**, and the selection is cleared.

If you want the opposite behaviour — delete a note *and* everything that depends on it — select
that note on its own and use **Delete Dependencies** in the note widget. See
[Editing Notes](/user-guide/notes/editing-notes) and
[Dependencies](/user-guide/notes/dependencies).

## Copy to Modules

**Copy to Modules** saves the current selection as a module in the
module library's **Custom** section.

- The new icon includes the counts, for example **Selection (2 notes and 1 measure)**. Duplicate names get a numeric suffix.
- A green toast confirms it: *Copied to Custom modules as "…"*.
- If the Custom section is collapsed, it expands so you can see the copy land.
- The copy is saved in your browser's local storage, so it **survives a reload**. It behaves
  exactly like a `.json` module you uploaded: drop it onto a sounding note, measure triangle or the BaseNote to import it. (A drop on empty background is refused — the import needs a target to hang off.)
- The action is **non-destructive** — your selection stays live and your composition is untouched.
- It is **not** an undo step. It changes the library, not the module. To get rid of a copy, remove
  its icon from the library.

### What the exported module contains

The copy is **rooted at its earliest selected timed item**, which starts at the new module’s time origin. Other timed items retain their offsets from that start. Pitches keep their ratios to the source BaseNote.

Measures keep their bar handles, lengths, offsets and links inside the selection. A mixed phrase dropped on a measure takes its timing from that bar and its pitch from the BaseNote. **At End** places the phrase after the target bar or note.

The copy preserves the following relationships:

- An expression is copied **as written** when every note it names travels with it. `[1].t + [1].d`
  stays `[1].t + [1].d`, with the ids renumbered `1..N` in time order.
- An expression that reaches **outside** the selection would dangle, so it is rebuilt against the
  new base from the note's current value: `base.t + base.d * 4`, `base.d * (1/2)`,
  `(3/2) * base.f`.
- A note whose start-time chain leaves the selection is always re-anchored to the new base, even if
  its expression names no note at all. Otherwise it would stay pinned to its original absolute time
  instead of following the module to wherever you drop it.
- The new module's BaseNote is a **copy of the current one** — same frequency, duration (the time
  unit) and interpretation, with its start time set to 0 — so `base.f` and `base.d` keep meaning
  what they meant. Pitches survive as **ratios** and rhythms as multiples of the time unit, not
  frozen numbers, which is what lets the copy transpose correctly when you drop it
  on a different note.
- Per-note colour and instrument come along when they are set.

A five-note phrase chained end to end comes out with these start times (the exported file also
carries a `baseNote` and each note's `duration` and `frequency`):

```json
{
  "notes": [
    { "id": 1, "startTime": "base.t" },
    { "id": 2, "startTime": "[1].t + [1].d" },
    { "id": 3, "startTime": "[2].t + [2].d" },
    { "id": 4, "startTime": "[3].t + [3].d" },
    { "id": 5, "startTime": "[4].t + [4].d" }
  ]
}
```

Choose **Start** and drop this example on its original root to align their starts. See
[The Module Library](/user-guide/modules/module-library) for what you can do with it afterwards.

### When a copy will be opened on its own

For a portable copy, use compact IDs such as `[21].f` in expressions between the selected notes. The copy renumbers this spelling. Spaces inside the brackets, as in `[ 21 ].f`, can leave the old ID in the tile.

Also check the BaseNote if its frequency or duration reads another note. The copy carries the BaseNote’s raw expression with the original ID. For example, a BaseNote reading `[20].f` at 330 Hz can reopen at 440 Hz when note 20 is absent. Give that BaseNote property its evaluated value before copying, then undo the edit in the source score. Ordinary library drops take their anchor from the destination.

## What clears a selection

**Clears it:** a plain click or tap on empty background (which also moves the playhead), a plain
mouse click on an item, the widget's **×** or **Clear selection**, locking the workspace, and loading
a module. Undo and redo keep a group: the same notes are selected again in the restored module
(a single note's selection is dropped, as before).

**Does not clear it:** clicking inside the group widget, the note widget, the
[Settings panel](/user-guide/interface/settings), the gear button, or the library toolbar — and any
shift-click.

## Where to go next

- [Editing Notes](/user-guide/notes/editing-notes) — everything you can do to the single note a plain click selects.
- [Dependencies](/user-guide/notes/dependencies) — why deleting a group liberates its dependents instead of taking them along.
- [The Module Library](/user-guide/modules/module-library) — where a **Copy to Modules** selection ends up, and how to manage it.
