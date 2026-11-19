---
title: Note Widget
description: The floating panel that opens when you click a note, silence, measure or the BaseNote — read and edit expressions, add notes, transpose, evaluate, delete.
---

# Note Widget

Click one thing in the workspace — a note, a silence, a measure bar's triangle, or the BaseNote circle — and the note widget opens on it. It is the only place in the app where you read and edit a note's **expressions**, and it is where you create new notes, transpose, change instruments, and delete.

The widget fits itself to what you clicked. A measure bar shows two rows; the BaseNote shows its own set and a different delete button. Nothing is greyed out — sections that don't apply are simply not there.

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
| `DURATION` (+ note-length icons) | yes, the time unit, with a BPM view and no icons | yes | yes | `duration (bar length)`, no icons |
| `FREQUENCY` (+ ▲/▼ arrows) | yes | yes | — | — |
| `AMPLITUDE` | yes | yes | only if set | — |
| `ATTACK` | yes | yes | only if set | — |
| `RELEASE` | yes | yes | only if set | — |
| `COLOR` | only if set | yes | yes | — |
| `INSTRUMENT` | yes | yes | yes | — |
| Add measure | `ADD NEW MEASURE CHAIN` | — | — | `ADD MEASURE`, last in chain only |
| `ADD NOTE / SILENCE` | yes | yes | yes | — |
| `EVALUATE` | `Evaluate Module` | `Liberate Dependencies`, `Evaluate to BaseNote` | same as note | `Evaluate to BaseNote` |
| Delete | `DELETE ALL NOTES` → `Clean Slate` | `DELETE NOTE` → `Keep Dependencies`, `Delete Dependencies` | same as note | same as note |

The rules behind the table:

- A **silence** is a note with a startTime and a duration but **no frequency**. That is the whole definition — it is why a silence has no `FREQUENCY` row and no transpose arrows.
- A **measure bar** is a silent note with a startTime and a duration, no frequency, and the `measure` flag. Its duration row is labelled `duration (bar length)`.
- The BaseNote has a `DURATION` row. Its value is the **time unit**, `base.d`; see [The BaseNote's duration](#the-basenotes-duration). There are no tempo or beats-per-measure rows, because neither is stored.
- `Liberate Dependencies` is never offered on a measure bar or on the BaseNote.

## Variable rows

Every row is the variable name over two lines:

- **`Evaluated:`** — what the expression currently works out to.
- **`Raw:`** — a text field holding the expression itself, plus a **`Save`** button.

```
base.f * (3/2)          # frequency: a perfect fifth above the BaseNote
[5].t + [5].d           # startTime: start when note 5 ends
base.d                  # duration: one time unit
```

The full grammar is in [Expressions](/user-guide/notes/expressions) and [Syntax reference](/reference/expressions/syntax).

### Edits apply on save

Typing in a `Raw:` field changes nothing. The `Save` button is **hidden until you type** — it appears on your first keystroke — and only pressing it commits the edit. Saving pauses playback, validates the expression, simplifies it, rewrites the note and everything downstream of it, redraws, and pushes an undo entry.

Validation rejects an empty expression, an expression that references its own note, and an expression that would create a circular dependency. The one exception to the first rule is the `AMPLITUDE` row, where saving an empty field is how you remove the value — see [Amplitude](#amplitude).

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

The `DURATION` row of a note or silence carries a strip of icon buttons: whole, half, quarter, eighth, sixteenth, followed by two dot buttons. The BaseNote's row and a bar's row have none: the BaseNote's duration *is* the time unit, so `base.d * k` would read itself, and a bar's length is a measure, not a note value.

| Button | Tooltip | Length |
|---|---|---|
| Whole-note icon | `Whole note` | 4 time units |
| Half-note icon | `Half note` | 2 time units |
| Quarter-note icon | `Quarter note` | 1 time unit |
| Eighth-note icon | `Eighth note` | 1/2 time unit |
| Sixteenth-note icon | `Sixteenth note` | 1/4 time unit |
| `.` | `. dotted` | ×3/2 on the selected length |
| `..` | `.. dotted` | ×7/4 on the selected length |

Clicking a button **writes the expression into the `Raw:` field and reveals `Save` — it does not commit.** You still press Save. A quarter note writes `base.d`; an eighth writes `base.d * (1/2)`; a whole writes `base.d * 4`.

The dots toggle: click the selected dot again to remove it.

The widget pre-selects the button matching the note's current duration. If the duration isn't one an icon can express — a triplet, say — **no button is highlighted**. That is correct, not a fault.

## The BaseNote's duration {#the-basenotes-duration}

The BaseNote's `DURATION` row holds the **time unit** (`base.d`), in seconds. Next to the evaluated value the widget shows the same number as a tempo, read only:

```
Evaluated: 3/5   = 100 BPM
```

The hint is `60 / base.d`. Nothing stores it, and you cannot type into it. To change the pace, edit the duration: `1` reads "= 60 BPM", `1/2` reads "= 120 BPM". Every duration written in `base.d` follows. See [the time unit](/reference/properties/duration#the-time-unit).

A value that is not a whole number of beats per minute shows as "≈" with up to three decimals.

## Bar length

A measure bar gets a **`duration (bar length)`** row under its `STARTTIME`. It is the bar's own duration, an ordinary expression with a `Raw:` field and a `Save` button, and next to the value the widget shows the length in time units:

```
Evaluated: 12/5   = 4 time units
```

The next bar in the chain starts at `[p].t + [p].d` and lasts `[p].d`, so changing one bar's length is a meter change and the bars after it follow.

```
base.d * 4        # four time units: 4/4 when the unit is a quarter note
base.d * (7/2)    # three and a half units: seven eighth-notes
[2].d             # as long as bar 2
```

Unlike a note's `DURATION`, this row has no note-length icon buttons: type the value, press `Save`.

Bars are what a `[N].t` or `[N].d` reference resolves against in another note's expression (see [Expressions](/user-guide/notes/expressions)), and the triangles along the bottom of the [workspace](/user-guide/interface/workspace#measures) are the same objects you are editing here. Dragging a triangle changes the length of the previous bar; the dragged bar keeps its own.

## Amplitude

The `AMPLITUDE` row is a note's loudness, as a relative gain: `1` is the default level, `2` twice the amplitude, `(1/2)` half. It is an ordinary variable row — `Evaluated:` over `Raw:` — and takes any expression:

```
base.a * (3/2)          # an accent against the piece's level
(121/100) * [5].a       # a touch louder than note 5
```

Unlike the other expression rows it is there even when the note has no amplitude of its own, because that is how you give it one:

- **`Inherited: <value>`** (in grey), with an empty `Raw:` field — the note defines none and sounds at the BaseNote's amplitude, or at `1` if the BaseNote defines none either.
- **`Evaluated: <value>`** — the note has its own expression.

Type an expression and press `Save` to set it. Clear the field and press `Save` to remove it again; the note goes back to inheriting. On the BaseNote the row sets the level of every note that does not define its own — with nothing set it reads `Evaluated: 1`.

Playback clamps the value to 0–4. Silences only show the row if they already carry an amplitude; measure bars never do. The full rules are in the [amplitude reference](/reference/properties/amplitude).

## Attack and Release

The `ATTACK` and `RELEASE` rows work like `AMPLITUDE`, and they are interpretation variables too: they say how a note is played, not where it sits. Each is a **share of the note's own duration**, for example `1/8`, clamped to 0–1. Under the value the widget prints the hint "A share of the note's duration, e.g. 1/8".

The row reads one of three ways:

- **`Default: instrument envelope`** — neither the note nor the BaseNote sets it, so the instrument's own envelope ratio applies.
- **`Inherited: <value>`** (in grey), with an empty `Raw:` field — the BaseNote sets one and the note does not.
- **`Evaluated: <value>`** — the note has its own expression.

Type an expression and press `Save` to set it. Clear the field and press `Save` to remove it again. On the BaseNote the rows set the shape of every note that does not define its own. Silences show them only if they already carry one; bars never do. The full rules, including how a note's own attack and release are scaled down when they exceed its duration, are in [attack and release](/reference/properties/attack-release).

## Instrument

The `INSTRUMENT` row shows one line of status and a dropdown.

- **`Current: <name>`** — this note pins its own instrument.
- **`Inherited: <name>`** (in grey) — it has none of its own and is inheriting.

Notes inherit an instrument by following their **frequency** chain upward to the first ancestor that pins one; if nobody does, they fall back to **Settings → Audio → Default instrument** (`sine-wave` out of the box). Inheritance follows frequency only — a note whose *startTime* depends on note 5 inherits nothing from note 5.

The dropdown lists all eleven instruments, alphabetically:

`fm-epiano`, `harmonium`, `harmonium-soft`, `organ`, `piano`, `sawtooth-wave`, `sine-wave`, `square-wave`, `triangle-wave`, `vibraphone`, `violin`

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

Flipping between `At Start` and `At End` rewrites the Start Time field for you. From the BaseNote there is no position choice — the new note starts at `base.t`, with `base.f` and `base.d`.

Each of the three fields carries a **live `Evaluated:` preview** that updates as you type, printing `Invalid` for an expression it cannot parse. This is the only live evaluation anywhere in the widget; every other field waits for `Save`.

Choosing **`Silence`** hides the Frequency field. A silence *is* a note with no frequency — that is all "silence" means here.

The new note inherits the open note's colour (or gets a random one if there isn't one), is selected immediately, and the widget re-opens on it so you can keep chaining.

## Add Measure

- On the **BaseNote** the row reads **`ADD NEW MEASURE CHAIN`**. Its `Add` button starts a fresh chain anchored at `base.t`, whose first bar lasts `base.d * 4`.
- On a **bar that nothing else chains off** — the last one in its chain — the row reads **`ADD MEASURE`**, and `Add` appends one more bar to that chain: it starts at `[p].t + [p].d` and lasts `[p].d`.

Any other bar gets no Add row: you extend a chain from its end.

The new bar is selected and the widget re-opens on it.

## Evaluate

The **`EVALUATE`** section rewrites expressions to remove dependencies. Every button goes through a Yes / Cancel confirmation, and a toast confirms the result.

| Button | Shown on | What it does |
|---|---|---|
| `Liberate Dependencies` | notes, silences | Replaces every reference *to this note* with this note's own raw expressions. The dependents stop depending on it; the note itself survives. |
| `Evaluate to BaseNote` | everything except the BaseNote (bars included) | Rewrites this note's startTime, duration, frequency and amplitude so they reference only the BaseNote (a bar: startTime and duration). All its other dependencies are lost. |
| `Evaluate Module` | the BaseNote only | Does the same to every note in the module at once. |

While the widget is open, the notes this one **depends on** and the notes that **depend on it** are highlighted in the workspace — so you can see the blast radius before you confirm. See [Dependencies](/user-guide/notes/dependencies).

**Liberate is not a flatten.** If note 2's startTime is `[1].t + [1].d`, and note 1's expressions are `base.t` and `base.d`, liberating note 1 leaves note 2 with `base.t + base.d`. Note 2 has not moved; it just no longer references note 1. That is the safe way to lift a note out of the middle of a chain before deleting it.

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
