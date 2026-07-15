---
title: Note Widget
description: The floating panel that opens when you click a note, silence, measure or the BaseNote — read and edit expressions, add notes, transpose, evaluate, delete.
---

# Note Widget

Click one thing in the workspace — a note, a silence, a measure bar's triangle, or the BaseNote circle — and the note widget opens on it. It is the only place in the app where you read and edit a note's **expressions**, and it is where you create new notes, transpose, change instruments, and delete.

The widget fits itself to what you clicked. A measure shows two rows; the BaseNote shows five and a different delete button. Nothing is greyed out — sections that don't apply are simply not there.

![The note widget open on a note, showing the evaluated and raw value of each variable](/img/note-widget.png)

## Opening and closing

| Action | Result |
|---|---|
| Click a note | Opens, titled `Note [N] Variables` |
| Click a silence | Opens, titled `Silence [N] Variables` |
| Click a measure triangle | Opens, titled `Measure [N] Variables` |
| Click the BaseNote circle | Opens, titled `BaseNote Variables` |
| Click the same spot again where notes overlap | Cycles to the next note in the stack under the cursor and re-opens on it |
| Click empty background | Clears the selection, hides the widget, moves the playhead |
| Click the `×` in the header | Same as clicking the background: closes the widget and clears the selection |

Two things suppress it:

- **The lock.** With the padlock (bottom-right of the screen) engaged, clicking a note does nothing at all, so the widget cannot be opened. The lock is off when the app starts.
- **A multi-selection.** Select two or more notes and the note widget is dismissed in favour of the group widget. Drop back to one note and the note widget returns.

There is no keyboard shortcut that opens or closes it.

## The card

The widget is 300 px wide, anchored at the bottom-left, and grows upward. It is not resizable — the height is computed for you.

- **Before you drag it**, it stays a compact card capped at 300 px tall. The variable list is usually longer than that, so the body scrolls.
- **Once you drag it** by the header, it fits its content instead, using whatever room exists below where you parked it — and shrinks again when you click something with fewer rows.
- Dragging works with mouse and touch. The header is always kept on screen.
- The widget, the group widget, the settings panel and the `+` menu are peers: opening or clicking one raises it above the others rather than closing them.
- Its position is not remembered across a reload.

::: tip Your scroll position survives an edit
Almost every action rebuilds the widget's body. When the note being redrawn is the one already on screen — you pressed a transpose arrow, saved an expression, added a note — you are put back where you were scrolled to. Clicking a *different* note gives you a fresh card, scrolled to the top.
:::

## What each kind shows

Rows appear in the order listed.

| Section | BaseNote | Note | Silence | Measure |
|---|---|---|---|---|
| `STARTTIME` | yes | yes | yes | yes |
| `DURATION` (+ note-length icons) | — | yes | yes | — |
| `FREQUENCY` (+ ▲/▼ arrows) | yes | yes | — | — |
| `TEMPO` | yes | — | — | — |
| `BEATSPERMEASURE` | yes | — | — | — |
| `COLOR` | only if set | yes | yes | — |
| `INSTRUMENT` | yes | yes | yes | — |
| `MEASURE DURATION` | — | — | — | yes |
| Add measure | `ADD NEW MEASURE CHAIN` | — | — | `ADD MEASURE`, last in chain only |
| `ADD NOTE / SILENCE` | yes | yes | yes | — |
| `EVALUATE` | `Evaluate Module` | `Liberate Dependencies`, `Evaluate to BaseNote` | same as note | `Evaluate to BaseNote` |
| Delete | `DELETE ALL NOTES` → `Clean Slate` | `DELETE NOTE` → `Keep Dependencies`, `Delete Dependencies` | same as note | same as note |

The rules behind the table:

- A **silence** is a note with a startTime and a duration but **no frequency**. That is the whole definition — it is why a silence has no `FREQUENCY` row and no transpose arrows.
- A **measure** has a startTime and neither duration nor frequency.
- The BaseNote's `measureLength` is deliberately hidden, and the BaseNote carries no duration expression, so it has no `DURATION` row.
- `Liberate Dependencies` is never offered on a measure bar or on the BaseNote.

## Variable rows

Every row is the variable name over two lines:

- **`Evaluated:`** — what the expression currently works out to.
- **`Raw:`** — a text field holding the expression itself, plus a **`Save`** button.

```
base.f * (3/2)          # frequency: a perfect fifth above the BaseNote
[5].t + [5].d           # startTime: start when note 5 ends
beat(base)              # duration: one beat
```

The full grammar is in [Expressions](/user-guide/notes/expressions) and [Syntax reference](/reference/expressions/syntax).

### Edits apply on save

Typing in a `Raw:` field changes nothing. The `Save` button is **hidden until you type** — it appears on your first keystroke — and only pressing it commits the edit. Saving pauses playback, validates the expression, simplifies it, rewrites the note and everything downstream of it, redraws, and pushes an undo entry.

Validation rejects an empty expression, an expression that references its own note, and an expression that would create a circular dependency.

When a save is rejected, the reason appears **inline**: the validator's message shows in red under the `Save` button and the `Raw:` field gets a red border. Both clear on your next keystroke or your next save attempt. (`COLOR` is the odd one out: an unparseable colour raises a browser alert telling you the accepted formats — hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`, or a named colour.)

### The `Raw:` field always shows DSL

Even for a note stored in the old method-chain format, the widget decompiles the compiled expression and shows you DSL. A consequence worth knowing: **saving a legacy note's row converts that expression to DSL.**

<details>
<summary>Legacy JavaScript syntax</summary>

A note authored as

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```

is displayed in the widget as `base.f * (3/2)`. Press Save and it is stored that way too.
</details>

### The `≈` symbol

Fractions are exact; powers usually are not. `base.f * 2^(7/12)` — a 12-TET fifth — has an irrational result the evaluator can only approximate. When that happens the **`Evaluated:`** readout is prefixed with **`≈`** and the value prints as a decimal to 8 significant figures, in italic brown.

Any row whose **own expression** is irrational carries the `≈` — a startTime or duration built on a power shows it just like a frequency does. The *transitive* case — a note that merely inherits an irrational frequency from a note further up its chain — is tracked for **frequency only**, so the whole of a TET scale built on `[1].f * 2^(1/12)` reads `≈` on its `FREQUENCY` rows.

A value can also earn an `≈` with nothing irrational in sight. Exact fractions can grow enormous in deep chains, and once one passes 24 digits (numerator and denominator together) the readout collapses to an eight-figure approximation — hover the `Evaluated:` line and the tooltip shows the exact, elided `n/d` form. The value underneath is still exact; only the readout is compressed, and it is not shown in brown.

On the canvas the same notes are hatched, and the hatching tells you *which* kind you are looking at:

| Hatching | Meaning |
|---|---|
| **Crosshatch** (both diagonals) | Directly corrupted — this note's own expression is irrational |
| **Single diagonal hatch** | Transitively corrupted — it depends on a corrupted note |
| None | Exact |

Nothing is lost: the note plays at the approximated value and the expression you wrote is preserved verbatim.

## Transpose arrows (▲ / ▼)

At the right end of the `FREQUENCY` row's evaluated line are two buttons, **▲** above and **▼** below. They multiply the note's frequency expression by an interval.

**The interval is yours to choose.** It defaults to the octave (▲ ×2, ▼ ×1/2), but you set it in **Settings → Arrows** (the gear in the top bar), where quick-pick chips offer the octave, fifth, fourth, major third, whole tone and syntonic comma. Hover an arrow and its tooltip tells you the interval currently bound to it: `Transpose up ×2`, or `Transpose up ×3/2` if you picked the fifth.

- The BaseNote gets the arrows too. Silences and measures do not — they have no frequency.
- Turn **Settings → Arrows → Show note arrows** off and the buttons are not rendered at all (and the ▲/▼ hit regions disappear from the notes in the workspace).
- Change an arrow setting while the widget is open and it rebuilds immediately, so the buttons and tooltips can never go stale.
- Each press captures its own undo entry. Clicking an arrow does not change the selection.

The multiplier is **folded into the expression's coefficient**, not stacked in front of it:

| Before | Press | After |
|---|---|---|
| `base.f` | ▲ (octave) | `2 * base.f` |
| `2 * base.f` | ▲ | `4 * base.f` |
| `2 * base.f` | ▼ | `base.f` |
| `base.f` | ▲ (fifth 3/2) | `(3/2) * base.f` |
| `base.f * 2^(7/12)` | ▲ (octave) | `2 * base.f * 2^(7/12)` — the power is untouched |

Up then down returns you to exactly the expression you started with. A TET note stays a TET note.

## Duration presets

The `DURATION` row carries a strip of icon buttons: whole, half, quarter, eighth, sixteenth, followed by two dot buttons.

| Button | Tooltip | Length |
|---|---|---|
| Whole-note icon | `Whole note` | 4 beats |
| Half-note icon | `Half note` | 2 beats |
| Quarter-note icon | `Quarter note` | 1 beat |
| Eighth-note icon | `Eighth note` | 1/2 beat |
| Sixteenth-note icon | `Sixteenth note` | 1/4 beat |
| `.` | `. dotted` | ×3/2 on the selected length |
| `..` | `.. dotted` | ×7/4 on the selected length |

Clicking a button **writes the expression into the `Raw:` field and reveals `Save` — it does not commit.** You still press Save. A quarter note writes `beat(base)`; an eighth writes `beat(base) * (1/2)`; a whole writes `beat(base) * 4`.

The dots toggle: click the selected dot again to remove it.

The widget pre-selects the button matching the note's current duration. If the duration isn't one an icon can express — a triplet, say — **no button is highlighted**. That is correct, not a fault.

## Measure Duration

A measure gets a **`MEASURE DURATION`** row under its `STARTTIME`. It edits the measure's `beatsPerMeasure` — how long that measure is — with a `Raw:` field and a `Save` button laid out beneath it. Save writes the value onto that measure only; other measures keep inheriting from the BaseNote.

```
4               # four beats — the default
(7/2)           # three and a half beats: seven eighth-notes
```

The value is counted in beats, so `(7/2)` — not `(7/8)` — is what a 7/8 bar comes to when the beat is a quarter note.

Unlike `DURATION`, this row has no note-length icon buttons: type the value, press `Save`.

Measures are what a `measure([N])` reference in a startTime expression resolves against — see [Expressions](/user-guide/notes/expressions) — and the triangles along the bottom of the [workspace](/user-guide/interface/workspace#measures) are the same objects you are editing here.

## Instrument

The `INSTRUMENT` row shows one line of status and a dropdown.

- **`Current: <name>`** — this note pins its own instrument.
- **`Inherited: <name>`** (in grey) — it has none of its own and is inheriting.

Notes inherit an instrument by following their **frequency** chain upward to the first ancestor that pins one; if nobody does, they fall back to **Settings → Audio → Default instrument** (`sine-wave` out of the box). Inheritance follows frequency only — a note whose *startTime* depends on note 5 inherits nothing from note 5.

The dropdown lists all nine instruments, alphabetically:

`fm-epiano`, `organ`, `piano`, `sawtooth-wave`, `sine-wave`, `square-wave`, `triangle-wave`, `vibraphone`, `violin`

Change it and a `Save` button appears; Save pins that instrument on the note. Once a note has its own instrument, a grey **`Use Inherited`** button appears above the dropdown — press it to drop the pin and go back to inheriting.

Measures have no instrument row. See [Instruments](/user-guide/playback/instruments) for what each one sounds like.

The BaseNote's row follows the same rules: with nothing pinned it reads **`Inherited: <name>`**, where the name is whatever **Settings → Audio → Default instrument** is set to — the same instrument playback uses.

## Add Note / Silence

This is how notes are created. There is no double-click-to-create in the workspace.

The **`ADD NOTE / SILENCE`** section is at the bottom of the widget for the BaseNote, any note and any silence. It creates a new note *relative to the one you have open*.

| Control | Options | Default |
|---|---|---|
| Kind | `Note` / `Silence` | `Note` |
| Position (not shown on the BaseNote) | `At Start` / `At End` | `At End` |
| `Frequency` (hidden when `Silence` is chosen) | an expression | `[N].f` — the open note's frequency |
| `Duration` | an expression | the open note's own duration expression |
| `Start Time` | an expression | `At End` → `[N].t + [N].d`; `At Start` → `[N].t` |
| Create | — | `Create Note` (or `Create` from the BaseNote) |

- **`At End`** builds a sequence: the new note starts when the open one ends.
- **`At Start`** builds a chord: the new note starts with the open one.

Flipping between `At Start` and `At End` rewrites the Start Time field for you. From the BaseNote there is no position choice — the new note starts at `base.t`, with `base.f` and `beat(base)`.

Each of the three fields carries a **live `Evaluated:` preview** that updates as you type, printing `Invalid` for an expression it cannot parse. This is the only live evaluation anywhere in the widget; every other field waits for `Save`.

Choosing **`Silence`** hides the Frequency field. A silence *is* a note with no frequency — that is all "silence" means here.

The new note inherits the open note's colour (or gets a random one if there isn't one), is selected immediately, and the widget re-opens on it so you can keep chaining.

## Add Measure

- On the **BaseNote** the row reads **`ADD NEW MEASURE CHAIN`**. Its `Add` button starts a fresh chain anchored at `base.t`.
- On a **measure that nothing else chains off** — the last one in its chain — the row reads **`ADD MEASURE`**, and `Add` appends one more measure to that chain.

Any other measure gets no Add row: you extend a chain from its end.

The new measure is selected and the widget re-opens on it.

## Evaluate

The **`EVALUATE`** section rewrites expressions to remove dependencies. Every button goes through a Yes / Cancel confirmation, and a toast confirms the result.

| Button | Shown on | What it does |
|---|---|---|
| `Liberate Dependencies` | notes, silences | Replaces every reference *to this note* with this note's own raw expressions. The dependents stop depending on it; the note itself survives. |
| `Evaluate to BaseNote` | everything except the BaseNote (measures included) | Rewrites this note's startTime, duration and frequency so they reference only the BaseNote. All its other dependencies are lost. |
| `Evaluate Module` | the BaseNote only | Does the same to every note in the module at once. |

While the widget is open, the notes this one **depends on** and the notes that **depend on it** are highlighted in the workspace — so you can see the blast radius before you confirm. See [Dependencies](/user-guide/notes/dependencies).

**Liberate is not a flatten.** If note 2's startTime is `[1].t + [1].d`, and note 1's expressions are `base.t` and `beat(base)`, liberating note 1 leaves note 2 with `base.t + beat(base)`. Note 2 has not moved; it just no longer references note 1. That is the safe way to lift a note out of the middle of a chain before deleting it.

**Evaluate to BaseNote is algebraic, not numeric.** It traces the frequency chain symbolically, so a TET power survives: `base.f * 2^(7/12)` stays a power rather than collapsing into an ugly decimal fraction.

```
# Note 3 is  base.f * (3/2)
# Note 7 is  [3].f * (5/4)

# Evaluate note 7 to BaseNote:
base.f * (15/8)
```

## Delete

For a note, a silence or a measure, the **`DELETE NOTE`** section offers two buttons.

| Button | What it does |
|---|---|
| `Keep Dependencies` | Liberates the dependents first — they take on this note's raw values, so they stay exactly where they are — then removes the note. |
| `Delete Dependencies` | Deletes this note **and every note that depends on it**. |

::: danger
`Delete Dependencies` can take out a large part of the composition in one click. The confirmation dialog points you at the **dependency lines in the workspace** — the notes linked to this one by those lines are what will go. Look at them before you confirm.
:::

### Clean Slate

On the **BaseNote** the section becomes **`DELETE ALL NOTES`** with a single button: **`Clean Slate`**. It deletes every note in the module except the BaseNote. The confirmation button reads `Yes, Clean Slate`.

::: tip
Clean Slate is undoable, and the confirmation dialog says so — it captures an undo snapshot like everything else, so `Ctrl/Cmd + Z` brings your notes back.
:::

## Undo

Every commit in this widget — saving an expression, pressing a transpose arrow, changing an instrument, adding a note, evaluating, deleting — captures its own undo snapshot. `Ctrl/Cmd + Z` and `Ctrl/Cmd + Y` step through them; see [Keyboard shortcuts](/user-guide/interface/keyboard-shortcuts).

## Next

- [Expressions](/user-guide/notes/expressions) — the language you type into the `Raw:` fields
- [Creating Notes](/user-guide/notes/creating-notes) — the Add Note / Silence workflow in full
- [Dependencies](/user-guide/notes/dependencies) — what Liberate and Evaluate actually rewrite
