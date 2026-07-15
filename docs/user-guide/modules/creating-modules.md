---
title: Creating Modules
description: Build a module from scratch — set up the BaseNote, add notes and silences, write expressions, and design a dependency tree that behaves when the module is dropped onto a note.
---

# Creating Modules

A module is a small, reusable piece of relational music: a BaseNote plus a handful of notes expressed *against* it. Build one well and you can drop it on any note in any composition and it will re-root itself there.

## Start from an empty workspace

1. Click the **BaseNote** — the circle at the origin — to select it.
2. In the [note widget](/user-guide/interface/variable-widget), find the **DELETE ALL NOTES** section.
3. Click **Clean Slate** and confirm with **Yes, Clean Slate**.

Every note is removed; the BaseNote stays.

::: tip Clean Slate is undoable
The confirmation dialog says so too: Clean Slate is captured in history, and `Ctrl/Cmd + Z` brings your notes back.
:::

## Set up the BaseNote

The BaseNote is the module's reference frame. Everything else will be written relative to it, so set it before you add notes.

With the BaseNote selected, the note widget shows:

| Property | What it is |
|---|---|
| `frequency` | The reference pitch, in Hz. Shipped modules use `263`. |
| `startTime` | The reference time, in seconds. Almost always `0`. |
| `tempo` | Beats per minute. `beat(base)` is derived from this. |
| `beatsPerMeasure` | The numerator of the time signature. |
| `measureLength` | The length of a measure, in seconds. Leave it alone unless you need a measure that is not `beatsPerMeasure` beats long. |
| `color` | The BaseNote's own color. Unlike `instrument`, it is not inherited by anything. |
| `instrument` | Pins the timbre for every note that inherits from the BaseNote. |

::: info Edits take effect on Save, not while you type
Each property has a **Raw:** field. Type a new expression and a **Save** button appears next to it. Nothing changes until you click it.
:::

## Add notes and silences

![The note widget's Add Note / Silence section, with Note/Silence and At Start/At End toggles above a Create Note button](/img/note-widget.png)

There is no double-click-to-create. Notes come from the note widget.

1. Select the note you want to build from (the BaseNote, if the workspace is empty).
2. Scroll to **ADD NOTE / SILENCE**.
3. Choose **Note** or **Silence**.
4. Choose where it goes relative to the selected note:
   - **At End** — the new note starts when the selected one ends. This is the default, and it is how you build a sequence.
   - **At Start** — the new note starts at the same time as the selected one. This is how you build a chord.
5. Click **Create Note**.

When the BaseNote is selected there is no At Start / At End choice — the new note starts at `base.t` — and the button reads **Create**.

The new note is pre-filled with expressions referencing its parent: `[N].f` for frequency and `[N].t + [N].d` for start time, so it is already relational. Edit from there.

A **silence** is a note with a start time and a duration but no frequency. It occupies time and makes no sound.

## Write the expressions

### Frequency

```
base.f                     # same pitch as the BaseNote
base.f * (3/2)             # a perfect fifth above it
base.f * (5/4)             # a just major third
(5/4) * [1].f              # a just major third above note 1
[1].f * 2 ^ (1/12)         # one 12-TET semitone above note 1
[1].f * 3 ^ (1/13)         # one Bohlen-Pierce step above note 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(7, 12)))
```

</details>

### Start time

```
base.t                     # start with the BaseNote
[1].t                      # start with note 1 — this is how you build a chord
[1].t + [1].d              # start when note 1 ends — this is how you build a sequence
[1].t + measure([1])       # one measure after note 1 starts
base.t + beat(base) * (3/2)
```

### Duration

```
beat(base)                 # one beat
beat(base) * 2             # two beats
beat(base) * (3/4)         # a dotted eighth, in beats
beat(base) * (1/4)         # a sixteenth
[1].d                      # the same length as note 1
```

Use `beat(base)`, never `60 / tempo(base)`. `beat(base)` is what the app writes for you when you use the note-length buttons in the duration row.

`60 / tempo(base)` does compile — an expression that *starts with a number* is first handed to the legacy compiler, which cannot read it, but the failure falls through to the DSL parser and lands correctly. Still write `beat(base)`: it is what the app writes for you, and it is the only form the decompiler gives back.

If an expression will not compile at all, it is **rejected with an error** — in the note widget the message appears in red under the Save button; in a hand-written file the property is left unset on load, with a `console.error` naming the expression.

## Colour and instrument

Both live on the note, and both are optional.

- **`color`** — set from the note widget's `color` row. New notes get a random hue.
- **`instrument`** — a note with none set **inherits along its frequency chain**: the app follows whatever note the `frequency` expression references, and asks *that* note. If nothing in the chain pins an instrument, the note falls back to the **Settings → Audio → default instrument** setting (`sine-wave` out of the box). The exact lookup order is in [Instruments](/user-guide/playback/instruments#how-inheritance-works).

That inheritance is why most of the shipped scale-system modules pin `"instrument": "sine-wave"` on their BaseNote: it fixes the module's timbre instead of letting it follow whatever the listener happens to have set.

## Design for the drop

This is the part that separates a module from a snippet.

When you drag a module out of the library and drop it on a note, **its BaseNote is remapped onto your drop target**: every `base.f` becomes `[target].f`, every `base.t` becomes `[target].t`, and its internal `[N]` references are renumbered to fit into your composition. How you wire the module's dependencies decides what it does when that happens.

### Everything references base

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f",           "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "base.f * (5/4)",   "startTime": "base.t", "duration": "beat(base)" },
    { "id": 3, "frequency": "base.f * (3/2)",   "startTime": "base.t", "duration": "beat(base)" }
  ]
}
```

Drop this on note 5 and all three notes hang directly off note 5. Move note 5 and the whole chord follows. Simple, and fine for a triad.

### Root-subtree — what the shipped library does

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f",         "startTime": "base.t", "duration": "beat(base) * 2" },
    { "id": 2, "frequency": "(5/4) * [1].f",  "startTime": "[1].t",  "duration": "beat(base) * 2" },
    { "id": 3, "frequency": "(3/2) * [1].f",  "startTime": "[1].t",  "duration": "beat(base) * 2" }
  ]
}
```

This is `chords/major.json`, shipped. Only **note 1** touches `base`; the third and the fifth hang off note 1. The chord is not three independent pitches — it is a root plus two relationships.

The payoff: transpose the root and the chord moves with it, in tune. Octave-shift the root and the whole chord shifts. The structure is the music.

Progressions take this further — each chord's root is expressed off the *previous* chord's root, so only the very first root ever references `base`. Move it and the entire progression moves.

### Chained scale

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f",              "startTime": "base.t",       "duration": "beat(base) * (3/4)" },
    { "id": 2, "frequency": "[1].f * 2 ^ (1/12)",  "startTime": "[1].t + [1].d", "duration": "beat(base) * (3/4)" },
    { "id": 3, "frequency": "[2].f * 2 ^ (1/12)",  "startTime": "[2].t + [2].d", "duration": "beat(base) * (3/4)" }
  ]
}
```

This is the head of `scale-systems/TET-12.json`. Each step is *the previous note* times a semitone. Lift one note and every later note comes with it.

### The drop rules you must design around

Two of them shape how you write a module:

- **A measure bar has no pitch.** Drop on one and `startTime` anchors to it, but every `frequency` falls back to `base.f`. A module whose pitches are written against `base` still sounds right there; one that assumes a pitched target does not.
- **The BaseNote is not a target to re-root onto.** Drop on it and `base.*` references stay exactly as they are — nothing is remapped.

Silences and empty background are rejected outright. For the full table of what each drop target does, and for the **Start** / **End** drop-mode buttons in the module bar's toolbar, see [Loading Modules](/user-guide/modules/loading-modules#where-you-can-drop).

### Mixing tunings

Nothing stops a module from combining just intonation and equal temperament. Give note 2 a just fifth off the base, and note 3 a 12-TET major third off note 2:

```json
{
  "notes": [
    { "id": 1, "frequency": "base.f",              "startTime": "base.t", "duration": "beat(base)" },
    { "id": 2, "frequency": "(3/2) * [1].f",       "startTime": "[1].t",  "duration": "beat(base)" },
    { "id": 3, "frequency": "[2].f * 2 ^ (4/12)",  "startTime": "[1].t",  "duration": "beat(base)" }
  ]
}
```

Note 3 will render **crosshatched**: `2^(4/12)` is irrational, so its value is only an approximation. That is direct [corruption](/user-guide/notes/dependencies), and it is a feature — the workspace tells you which pitches are exact and which are not. Anything hanging off note 3 picks up a single diagonal hatch instead, marking it as corrupted by inheritance.

::: warning There is no assignment in the expression language
`[2].f = base.f * (3/2)` is not valid syntax. An expression is only ever the right-hand side; the property it belongs to is the JSON key, or the row in the note widget.
:::

## Build with the arrows

The **▲ / ▼** buttons on the frequency row multiply the note's frequency by the **arrow interval**. That interval is no longer locked to an octave: **Settings → Arrows** lets you set any ratio (default `2/1`), either reciprocal (down is the inverse of up) or with up and down set independently.

Set the arrows to `3/2` and you can build a Pythagorean chain by clicking. Set them to `81/80` and you can nudge a note by a syntonic comma. The factor is folded into the expression's coefficient rather than stacked on top, so up-then-down returns you to exactly where you started.

## Test it

**Listen.** Click **Play**. To iterate on a short module, **shift-click Play** (or long-press it) to arm loop playback — the module repeats until you disarm it.

**Look.** Check the dependency lines. Selecting a note draws thick lines to what it depends on and thin lines to what depends on it, coloured by property: orange for frequency, teal for start time, purple for duration. If a note you expected to hang off the root is drawn hanging off the base, your expression references the wrong thing.

**Check the console.** Bad expressions do not raise an error in the UI. If something is at the origin or silent, look there.

## Save it

- **Copy to Modules** — select the notes (shift-drag a marquee, or shift-click notes to toggle them in), then click **Copy to Modules** in the group widget. It lands in the library's **Custom** section, rooted at its earliest note, tree intact, and survives a reload. Note that this path **drops colours and instruments**.
- **Save Module** — the **+** menu writes the whole workspace to `module.json`. Rename it; the filename is always the same.

See [Saving Modules](/user-guide/modules/saving-modules) for both routes and for getting a module into the library permanently.

## Learn from the shipped library

79 modules ship with the app, and they are all worked examples of the patterns above:

- **Intervals** (46) — the minimal module: one note, `(N/D) * base.f`.
- **Chords** (11) — the root-subtree pattern.
- **Progressions** (8) — root chains, where only the first root touches `base`.
- **Melodies** (7) — relational tunes; change the base and the whole thing transposes.
- **Scale Systems** (6) — chained scales, including 12/19/31-TET, Bohlen–Pierce and the 81-note Tesla scale.
- **Custom** (1) — `canon base`, a 74-note composition to take apart.

They live in `public/modules/`. Open one in a text editor, and see the [Module Library](/user-guide/modules/module-library) for what each section holds and why.

## Tips

1. **Use `base.t`, not `0`.** A module pinned to absolute time cannot be dropped anywhere useful.
2. **Use `beat(base)`, not seconds.** Durations that follow the tempo survive a tempo change.
3. **Decide what your root is** and hang everything off it. That single decision is what makes a module transposable.
4. **Start simple.** Get two notes right before you write twelve.
5. **Save versions.** There is no version history in a module file.

## See also

- [Module Format](/user-guide/modules/module-format) — the JSON your work becomes
- [Expressions](/user-guide/notes/expressions) — the expression language in depth
- [Dependencies](/user-guide/notes/dependencies) — dependency lines and corruption
- [Selection](/user-guide/notes/selection) — marquee and group selection
- [Loading Modules](/user-guide/modules/loading-modules) — dropping modules onto notes
- [The Module Library](/user-guide/modules/module-library) — the 79 shipped modules, as worked examples
- [Instruments](/user-guide/playback/instruments) — the nine voices and the inheritance rules
