---
title: Glossary
description: Definitions of every term RMT Compose uses — expressions, dependencies, corruption, themes, settings, the module library, and the audio graph.
---

# Glossary

Terms used across the app and these docs. Where a term names something you can click, the page that covers it is linked.

## A

### Approximation (≈)
The prefix shown in the [note widget](/user-guide/interface/variable-widget) before a value the app cannot represent exactly — an irrational one. Both directly and transitively [corrupted](#corruption) values display with `≈`. A **directly** corrupted value is shown as a decimal, to 8 significant figures (`≈1.0594631`); a **transitively** corrupted one is shown as a fraction. Either way the text is rendered in a warm amber, in italics.

### Arrow interval
The ratio the ▲ / ▼ [note arrows](#note-arrows) apply. Configurable in **Settings → Arrows**; the default is `2/1`, the octave. The numerator and denominator must be positive integers, the ratio must lie in `[1/16, 16]`, and it may not equal 1. See [Transposing with Arrows](/user-guide/notes/transposing).

### Arrow mode
`Reciprocal` (the default) derives the down interval as the reciprocal of the up interval — up `3/2`, down `2/3`. `Independent` lets the two differ.

::: warning
`Independent` mode ships with no editor for the down interval. Selecting it freezes the down ratio at whatever it last held. See [Settings Reference](/reference/settings-reference).
:::

## B

### BaseNote
The reference note of every module, id **0**. It supplies frequency, start time, tempo, beats per measure and measure length, and it is where the octave guide lines are anchored. Notes reference it as `base.f`, `base.t`, `beat(base)`, and so on. `[0].f` means exactly the same thing as `base.f`.

The BaseNote has **no duration**.

### Beat
`beat(x)` — one beat of note *x*'s tempo, in seconds. It compiles to `60 / tempo(x)`. It is the idiom the app itself writes for every note-length button.

### Beats per measure
The number of beats in one measure — the numerator of the time signature. Inherited from the BaseNote unless a note overrides it.

### Binary bytecode
The compiled form of an expression: a short sequence of opcodes (`LOAD_CONST`, `LOAD_REF`, `MUL`, `POW`, …) run on a stack VM with exact rational arithmetic. Expressions are never `eval`'d.

### Bohlen-Pierce (BP)
A tuning system that divides the [tritave](#tritave) (3:1) into 13 equal steps instead of dividing the octave. One step is `3^(1/13)`.

## C

### Corruption
The app's internal name for "this value is irrational". A property is flagged corrupted when a `^` produced an irrational result — `2^(1/12)` corrupts, `4^(1/2)` (which is exactly 2) does not. Corruption is tracked per property, per note, and it propagates: a note whose frequency depends on a corrupted note is *transitively* corrupted.

On the canvas, corruption shows as hatching:

| Hatching | Meaning |
|---|---|
| **Crosshatch** (two diagonals) | Directly corrupted — this note's own expression contains an irrational power |
| **Single diagonal hatch** | Transitively corrupted — it inherits an irrational value from a note it depends on |

Both kinds display their value with an `≈` prefix in the note widget.

### Copy to Modules
The [group widget](#group-widget) action that turns the current multi-selection into a new, self-contained module in the library's **Custom** section, named `Selection (N notes)`. The copy is **rooted at the selection's earliest note** — that note starts exactly on the new module's BaseNote (`base.t`), and the rest keep their relative times as `base.t + beat(base) * k`. References that point *inside* the selection are kept and renumbered, so the dependency tree survives; references that point outside it are frozen to the value they had. Colors and per-note instruments come across unchanged.

### Custom (library section)
The module-library section that [Copy to Modules](#copy-to-modules) writes into. It is not where uploads land: an uploaded module joins whichever section's **+** placeholder you clicked.

## D

### Dependency
A relationship created by one note's expression naming another. If note 5's frequency is `[3].f * (3/2)`, note 5 **depends on** note 3, and note 3 has note 5 as a **dependent**. Dependencies are property-level: the app knows that note 5's *frequency* depends on note 3's *frequency*.

### Dependency graph
The index of every dependency, forward and inverse, split by property. It is what makes "what depends on this note?" an O(1) question, what orders evaluation, and what draws the colored [dependency lines](#dependency-line).

### Dependency line
The colored line drawn between a selected note and the notes it is related to. The color names the **property**:

| Color | Property |
|---|---|
| Orange | frequency |
| Teal | startTime |
| Purple | duration |

A **thick** line points at something the selected note depends on. A **thin** line points at something that depends on the selected note.

### Drop mode
**Start** (the default) or **End**, set by the two drop-mode buttons in the [module bar](#module-bar)'s toolbar — ⇤ for **Start**, ⇥ for **End**, just left of **Undo**/**Redo**; exactly one is lit at a time. It decides whether a module you drag onto a note anchors its imported start times to that note's **start** or to its **end**.

### DSL
The expression language: `base.f * (3/2)`, `[1].t + [1].d`, `beat(base)`, `2^(7/12)`. Infix operators, note references in square brackets, three helper functions. It is the primary format — every shipped module uses it, and the note widget always *displays* it (a legacy expression is decompiled into DSL for the input box). Edits the app performs for you — a drag, a resize, an arrow press — rewrite an expression in whatever format it already uses; pressing **Save** in the note widget is what converts a legacy expression to DSL. See the [syntax reference](/reference/expressions/syntax).

## E

### Equal temperament (ET / TET)
A tuning that divides an interval into *n* equal steps. `n`-TET usually means *n* equal divisions of the **octave**: one step of 12-TET is `2^(1/12)`. Steps of an equal temperament are irrational, so they [corrupt](#corruption).

### Evaluated value
The number an expression computes to, shown on the `Evaluated:` line of the note widget. Contrast the **raw expression**, the text you typed.

### Expression
The text stored for a note property. Six properties are expressions: `startTime`, `duration`, `frequency`, `tempo`, `beatsPerMeasure`, `measureLength`. Nothing is stored as a number.

## F

### Fraction
An exact rational value (numerator / denominator). All arithmetic in RMT Compose is rational, which is what keeps `(3/2)` a true perfect fifth rather than 1.5 with rounding error.

## G

### Group widget
The floating panel that appears when several notes are selected. It carries two actions: **Copy to Modules** (save the selection into the library's Custom section) and **Delete all**. It is white, not orange, to match the white multi-selection highlight on the canvas. See [Selection & Group Editing](/user-guide/notes/selection).

## I

### Interval
The ratio between two frequencies. `2/1` octave, `3/2` fifth, `4/3` fourth, `5/4` major third, `81/80` syntonic comma.

### Inverted index
The half of the [dependency graph](#dependency-graph) that answers "what depends on X?" in constant time, as opposed to "what does X depend on?". It is what lets a drag update every follower without scanning the module.

## J

### Just intonation
Tuning by exact whole-number ratios drawn from the harmonic series: `3/2`, `5/4`, `7/4`. Ratios are rational, so they never corrupt.

## L

### Legacy syntax
The original method-chain expression format: `module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))`. It still loads and still saves back verbatim, and it compiles to exactly the same bytecode as the DSL. You will only meet it in old files and on the BaseNote's default `measureLength`.

### Liberation (Liberate Dependencies)
The **Liberate Dependencies** button in the note widget. It cuts every note that *depends on* the selected note free from it, by substituting the selected note's own expressions in place of the references to it. The dependents keep their current positions and pitches — they simply stop following the note. Undoable. Not available on measure bars.

Group **Delete all** liberates the dependents of the deleted notes rather than deleting them too.

### Library manifest
`public/modules/library.json` — the single v2 manifest that describes the module library: `{ "version": 2, "sections": [ { id, label, items: [...] } ] }`. See the [module schema](/reference/module-schema#the-library-manifest).

### Loop playback
Hidden transport mode: **shift-click** the Play button, or **long-press** it, to arm looping. It is never persisted — it is gone on reload.

## M

### Marquee
The rectangle you rubber-band across the workspace to select several notes at once: **shift-drag** on empty background with a mouse, **long-press then drag** on touch. Long-pressing a note on touch toggles it in or out of the selection.

### Measure bar
A note that has a `startTime` and **nothing else** — no duration, no frequency. It is drawn as a vertical dashed line across the workspace and carries the meter (`beatsPerMeasure`) for the bar it opens.

### Measure chain
A run of [measure bars](#measure-bar) where each one starts one measure after the previous: `[1].t + measure([1])`, `[2].t + measure([2])`, and so on. Change the tempo or the meter anywhere in the chain and every bar after it moves. This is how a composition gets its grid.

### Module
One composition: a `baseNote` plus a flat array of notes, saved as `module.json`. See the [module schema](/reference/module-schema).

### Module bar
The horizontal library strip under the top bar. It holds the categorized module icons you drag onto the workspace, a collapsible magnifier **search** field (`Search name, ratio, tag…`), and a footer with **Save UI**, **Load UI**, **Add Category** and **Reload Defaults**. **Undo** and **Redo** sit at the right end of its toolbar row — the same history as `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y` and the top bar's **+** menu — with the [drop-mode](#drop-mode) buttons (⇤ / ⇥) just to their left. See [Module Bar](/user-guide/interface/module-bar).

### Multisample
An instrument built from recorded audio rather than an oscillator. `piano` and `violin` are multisampled: the player picks the recorded **zone** nearest the target pitch and shifts its playback rate to land on the exact frequency. Both are CC0, from VSCO2 Community Edition.

## N

### Note arrows
The ▲ / ▼ pair drawn in a narrow column on the left inner edge of every sounding note (silences and measure bars have none). Clicking one multiplies that note's frequency expression by the [arrow interval](#arrow-interval) — the octave by default, any ratio you configure in **Settings → Arrows**, where they can also be switched off entirely. The same two buttons appear on the frequency row of the note widget, with a tooltip naming the live interval (`Transpose up ×3/2`).

The multiplier is **folded into the expression's existing coefficient**, not stacked in front of it, so up-then-down returns the expression to exactly what it was.

### Note widget
The floating panel for the selected note: an `Evaluated:` line and a `Raw:` expression input per property, a `Save` button that appears once you type, note-length buttons on the duration row, the ▲/▼ arrows on the frequency row, and an **ADD NOTE / SILENCE** section at the bottom (choose **Note** or **Silence**, **At Start** or **At End**, then **Create Note**).

Edits take effect **on save**, not while you type.

## O

### Octave
The interval `2/1`. Also the default [arrow interval](#arrow-interval).

### Opcode
One instruction of the [bytecode](#binary-bytecode): `LOAD_CONST`, `LOAD_REF`, `LOAD_BASE`, `ADD`, `SUB`, `MUL`, `DIV`, `NEG`, `POW`.

### Override (color override)
A single [theme token](#theme-token) you have changed by hand, stored as a sparse diff on top of the active **theme preset**. You only override what you touch.

::: warning
Choosing a theme preset **discards every color override**, without a confirmation.
:::

## P

### Playhead
The vertical line showing the current playback position.

### Playhead tracking
The top-bar toggle that makes the camera follow the playhead during playback instead of leaving the view where you put it.

### Pool (fraction pool)
A block of pre-allocated fraction objects the evaluator reuses instead of allocating fresh ones on every evaluation. It is why re-evaluating a large module does not produce a garbage-collection stall.

### Preset (theme preset)
One of the four named color sets in **Settings → Appearance**: **Classic Orange** (the default), **Slate Cyan**, **Mono Light** (the only light theme), **High Contrast**. Picking one applies its whole color set at once. See [Themes & Appearance](/user-guide/interface/themes).

## R

### Ratio
A fraction naming a frequency relationship. `3/2` means "1.5 × the reference frequency".

### Raw expression
The text of an expression, before compilation. It is what the `Raw:` field of the note widget shows and what a module file stores.

## S

### Scale controls
The two workspace-density factors — horizontal (time) and vertical (pitch). They are driven from two places that stay in lockstep: the small accent dot at the bottom-left of the screen, and **Settings → Scale**. They persist across reloads.

### Scale Systems
The module-library section holding the whole-scale modules (the TET systems and friends) — six of them.

### Semitone
One step of 12-TET: `2^(1/12)` ≈ 1.0595. Irrational, so it [corrupts](#corruption).

### Settings panel
The floating, draggable, non-modal panel opened from the **gear in the top bar**. Five tabs: **Appearance**, **Arrows**, **Audio**, **Library**, **Scale**. Every change applies immediately — there is no OK/Apply, and no undo (module Undo/Redo does not cover settings). Settings persist under the `rmt:settings:v1` key. See the [Settings Reference](/reference/settings-reference).

There is **no** "Settings…" entry in the **+** menu. The gear is the only opener.

### Signal graph
The audio path every note travels: voice gain → an optional stereo panner → the instrument's bus → a dry path plus a reverb send → the master gain → an optional limiter → the output.

### Silence
A note with a `startTime` and a `duration` but **no frequency**. It occupies time and makes no sound. It is drawn with a dashed outline and the word "silence", it has no arrows, and it cannot be a drop target for a library module.

### Stack VM
The virtual machine that runs the bytecode, pushing and popping exact fractions.

### SymbolicPower
The algebraic form `coefficient × Π baseᵢ^expᵢ` used when the simplifier reshapes an expression — it is what lets `2^(1/12) * 2^(1/12)` merge into `2^(1/6)` while refusing to let a coefficient migrate into a power term. That refusal is what keeps a TET note's crosshatch from silently disappearing.

## T

### Tempo
Speed in beats per minute. Inherited from the BaseNote; any note may override it, and the override applies to everything that inherits from it.

### TET
*n*-tone equal temperament — **not** "tone equal temperament". See **Equal temperament** above.

### Theme token
One named color in a theme preset. Fifteen of them have a picker in **Settings → Appearance**, in three groups: **Interface** (Accent, Background, Panel surface, Panel border, Text, Muted text, Active / delete), **Workspace** (Note border, Playhead, Measure bars, Selection ring, Hover ring) and **Dependency highlights** (Frequency, Start time, Duration). Each token is also published as a CSS custom property, `--rmt-accent` and friends.

::: warning
Several pickers currently have no visible effect — see [Themes & Appearance](/user-guide/interface/themes) for which.
:::

### Topological sort
The ordering that guarantees a note is evaluated after everything it depends on.

### Tritave
The interval `3/1`, the repeating interval of the Bohlen-Pierce scale.

## U

### UI state
The module **library layout** — sections, icon order, collapse state, drop mode, and the data of any uploaded module. Saved by **Save UI** to `ui-state.json`, and autosaved to `localStorage` under `ui-state`. It is not a composition; do not confuse it with a module file.

## V

### Variable
Any of the six expression properties of a note: `startTime`, `duration`, `frequency`, `tempo`, `beatsPerMeasure`, `measureLength`.

## W

### WASM (WebAssembly)
An alternative Rust evaluator that ships in the bundle but does **not** run. Every evaluation the app performs goes through the JavaScript evaluator. The WASM path has never been verified in a browser, so it is not a supported feature and is not something you can turn on.

### WebGL2
The graphics API the workspace is rendered with. Required — there is no 2D fallback.

### World unit (wu)
The internal coordinate unit of the workspace, before zoom. One second of time is 200 world units across; one octave is 100 world units tall. **Note height** is set in world units (default 22 wu), which is why notes keep their proportion to the octave grid as you zoom.

### Workspace
The main canvas: notes, silences, measure bars, octave guide lines, the BaseNote circle, and the playhead. Pan, zoom, select, drag, resize.

## See also

- [Expression Syntax](/reference/expressions/syntax)
- [Module JSON Schema](/reference/module-schema)
- [Settings Reference](/reference/settings-reference)
