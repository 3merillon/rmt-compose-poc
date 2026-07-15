---
title: Creating Notes
description: Add notes and silences from the note widget, drop a library module onto an existing note, or write notes directly in a module's JSON.
---

# Creating Notes

There are three ways to get notes into a composition: the [note widget](/user-guide/interface/variable-widget), dropping a **library module** onto an existing note, and editing a module's **JSON** by hand. The widget is the one you will use most.

::: tip Everything is in seconds
`startTime` and `duration` evaluate to **seconds**, not beats. To think in beats, use `beat(base)` — one beat at the BaseNote's tempo. The default module's tempo is `100`, so `beat(base)` is `0.6` seconds. Writing `"duration": "1"` gives you a one-second note, not a one-beat note. See [Expressions](/user-guide/notes/expressions#units-seconds-and-the-beat-idiom).
:::

## From the note widget

Click a note, a silence, or the BaseNote. The note widget opens with an **ADD NOTE / SILENCE** section below the property rows, above EVALUATE and DELETE NOTE. (Click a measure bar instead and you get an **Add Measure** section — no note creation.)

![The note widget open on a note, showing the Evaluated and Raw rows for start time, duration and frequency, and the ADD NOTE / SILENCE section below them](/img/note-widget.png)

1. **Choose a kind.** `Note` (selected by default) or `Silence`. Choosing `Silence` hides the Frequency field — a silence is exactly a note with no frequency.
2. **Choose a position.** `At Start` or `At End`, with **`At End` selected by default**. This toggle only appears when you clicked a note or a silence; the BaseNote has no position toggle.
3. **Adjust the pre-filled expressions** if you want to. Each field carries a live **`Evaluated:`** readout that recomputes as you type, so you can see the pitch or time an expression produces before you commit to it. An expression the app cannot parse reads `Invalid`.
4. **Click the create button.** It reads **`Create Note`** when you started from a note or a silence, and **`Create`** when you started from the BaseNote.

The new note is selected immediately and the widget reopens on it, so you can chain another note straight away.

### What the fields are pre-filled with

Starting from **note N**:

| Field | `At End` (default) | `At Start` |
|---|---|---|
| Frequency | `[N].f` | `[N].f` |
| Duration | note N's own duration expression | note N's own duration expression |
| Start Time | `[N].t + [N].d` | `[N].t` |

Duration is copied as an **expression**, not as a reference. If note 3's duration is `beat(base) * (3/2)`, the new note's Duration field is pre-filled with `beat(base) * (3/2)` — the two notes end up the same length but neither depends on the other for it. (When the parent has no compiled duration expression, the field falls back to `[N].d`, which *is* a dependency.)

Frequency is `[N].f` only when note N *has* a frequency. Start from a **silence** and the Frequency field falls back to `base.f`, because there is no `[N].f` to point at.

Starting from the **BaseNote**:

| Field | Value |
|---|---|
| Frequency | `base.f` |
| Duration | `beat(base)` |
| Start Time | `base.t` |

The new note **inherits the parent note's colour**. If the parent has none, it gets a random one.

::: warning A bad expression stops the create
If any field fails to parse, creation aborts and a browser alert tells you which field was rejected. Nothing is added.
:::

## By dropping a module

A library module is dropped **onto an existing note or onto the BaseNote** — never onto empty canvas. The drop target becomes the anchor that the module's expressions are rewritten against, which is what lets the same module land at a different pitch and time every time you use it.

1. Open the **module bar** and find the module you want.
2. Set the drop mode with the ⇤ / ⇥ buttons next to Undo/Redo in the module bar's toolbar: ⇤ for **Start** (the default), ⇥ for **End**. With **End**, the module's start times get the target note's duration added, so the module lands *after* the target instead of on top of it.
3. Drag the module icon onto a note or the BaseNote.

Two targets are refused, each with an error toast:

- **Empty canvas** — `Drop onto a note or the BaseNote circle to import a module.`
- **A silence** — `Cannot drop onto a silence. Drop on a note or the BaseNote instead.`

See [Loading Modules](/user-guide/modules/loading-modules) for the full workflow and [The Module Bar](/user-guide/interface/module-bar) for the library itself.

## From a phrase you already built

Select several notes (shift-drag a marquee, or shift-click to add notes one at a time) and the group widget offers **`Copy to Modules`**. That saves the selection into the library's **Custom** section as a reusable module, keeping the dependency tree inside the selection intact. You can then drop it back onto any note.

This is the fastest way to turn something you improvised into a building block. See [Selection & Group Editing](/user-guide/notes/selection).

## By editing module JSON

Every note property is a string expression. The shipped modules are all written in the DSL:

```json
{
  "notes": [
    {
      "id": 1,
      "frequency": "base.f * (3/2)",
      "startTime": "base.t",
      "duration": "beat(base)",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```

<details>
<summary>Legacy JavaScript syntax</summary>

Older modules use method chains. They still load, and the app converts them to DSL as soon as you display or save an expression.

```json
{
  "notes": [
    {
      "id": 1,
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```
</details>

See [Module Format](/user-guide/modules/module-format) for the full schema.

## Note properties

| Property | Required | What it is |
|---|---|---|
| `id` | Yes | Unique integer. Assigned for you by the widget. |
| `frequency` | For notes | Pitch in Hz. **Omit it to make the note a silence.** |
| `startTime` | Yes | When the note begins, in seconds. |
| `duration` | For notes and silences | How long the note lasts, in seconds. A note with a `startTime` but no `duration` and no `frequency` is a **measure bar**. |
| `color` | No | Any CSS colour. Inherited from the parent when created in the widget. |
| `instrument` | No | Overrides the inherited instrument. Left unset, the note inherits along its frequency reference; see [Editing Notes](/user-guide/notes/editing-notes#instrument). |

The three shapes a note can take are decided purely by which properties exist:

| Has `startTime` | Has `duration` | Has `frequency` | Result |
|---|---|---|---|
| Yes | Yes | Yes | A **note** |
| Yes | Yes | No | A **silence** |
| Yes | No | No | A **measure bar** |

## Building a melody

Each note starts when the previous one ends.

1. Select the BaseNote and click **`Create`**. You get a note at `base.t`, one beat long, at the base frequency.
2. Select that note. Leave the position on **`At End`**.
3. Set the Frequency field — say `base.f * (9/8)` for a whole tone above the base.
4. Click **`Create Note`**.
5. Select the new note and repeat.

Because each note's start time is `[N].t + [N].d`, lengthening any note in the chain pushes everything after it along. That is the whole point.

## Building a chord

All the chord tones share one start time.

1. Create the root note — say note 1.
2. Select note 1 and switch the position to **`At Start`**. The Start Time field becomes `[1].t`.
3. Set the Frequency field to `[1].f * (5/4)` and click **`Create Note`** — that is a just major third above the root.
4. Select note **1** again (not the third you just made), keep `At Start`, and create `[1].f * (3/2)` for the fifth.

All three notes now hang off note 1. Move note 1 and the chord moves with it; re-tune note 1 and the chord transposes as a unit. See [Dependencies](/user-guide/notes/dependencies).

## Note IDs

- IDs are integers assigned in ascending order: 1, 2, 3, …
- **ID 0 is the BaseNote.** In an expression, `[0].f` and `base.f` are the same thing.
- Existing notes are **never renumbered** when you delete something. A reference like `[5].f` keeps pointing at the same note for the life of the module.
- One caveat: adding a measure recomputes the next free ID from the highest ID currently in use. If you delete the highest-numbered note and then add a measure, that ID can be handed out again.

::: warning Don't hand-edit IDs
Duplicate IDs in a JSON file produce undefined behaviour. Let the app assign them.
:::

## Where to go next

- [Editing Notes](/user-guide/notes/editing-notes) — drag, resize, transpose, retune, delete.
- [Expressions](/user-guide/notes/expressions) — what you can write in those Raw fields.
- [Dependencies](/user-guide/notes/dependencies) — what a reference actually costs you, and what it buys.
