---
title: Module Format
description: How a module JSON file is put together — the baseNote, the notes array, the note kinds, measure bars, expression strings, colours, instruments, ids, and the load-time limits.
---

# Module Format

A module is a composition stored as JSON. This page explains the format from an author's point of view: what you write, what the app writes back, and what it refuses.

For the exhaustive field-by-field reference, see [Module JSON Schema](/reference/module-schema).

## Two keys, and only two

A module file has exactly two top-level keys.

```json
{
  "baseNote": { },
  "notes": [ ]
}
```

| Key | Type | What it is |
|---|---|---|
| `baseNote` | object | The root reference note. It is note id **0**. |
| `notes` | array | A flat array of note objects. |

That is the whole structure. There is **no** `measures` array (bars are ordinary notes flagged `"measure": true`), no `version`, no `name`, no `author`, no `parentId`. A module carries no metadata at all — the library gets a module's display name from the [library manifest](#shipping-a-module-in-the-repo) or from the uploaded file's name, never from inside the file.

Every musical value is an **expression string**, never a number. That is the point of the format: relationships survive, so changing the BaseNote moves everything that depends on it.

Here is a complete shipped module, `public/modules/intervals/3-2.json`:

```json
{
  "baseNote": {
    "frequency": "263",
    "startTime": "0",
    "duration": "1"
  },
  "notes": [
    {
      "id": 1,
      "startTime": "base.t",
      "duration": "base.d",
      "frequency": "(3/2) * base.f",
      "color": "rgba(242,167,27,0.7)"
    }
  ]
}
```

One note: a perfect fifth above the base, one time unit long, starting where the base starts. The BaseNote's `duration` is the **time unit** (`base.d`): the one absolute length in the module, in seconds.

## The `baseNote` object

Every field is optional. An omitted field falls back to the **class default** below — not to the values of the default module you see when you open the app (263 Hz, duration 3/5 s, which the note widget shows as 100 BPM).

| Field | Default if you omit it | Notes |
|---|---|---|
| `frequency` | `440` Hz | Shipped modules use `263`. |
| `startTime` | `0` s | |
| `duration` | `1` s | The time unit. The default module uses `3/5`. |
| `amplitude` | `1` | A relative gain. Every note without its own inherits it. Saved only when set; no shipped module uses it. |
| `attack`, `release` | none → the instrument's own envelope | Shares of a note's duration. Every note without its own inherits them. See [attack and release](/reference/properties/attack-release). |
| `color` | none | Accepted, but no shipped module uses it. |
| `instrument` | none → the `audio.defaultInstrument` setting | Pins the timbre for everything that inherits from the base. |

::: info The BaseNote's duration is a length, not a tempo
No tempo is stored anywhere. The note widget shows `60 / base.d` beside the BaseNote's duration, for example "= 100 BPM", as a read-only view. Older files that carry `tempo`, `beatsPerMeasure` or `measureLength` are converted when they load; see [Modules from earlier versions](#modules-from-earlier-versions).
:::

## The `notes` array

| Field | Required | Notes |
|---|---|---|
| `id` | **yes** | Integer, `0 ≤ id ≤ 65535` (note ids are 16-bit in the bytecode). `0` is reserved for the BaseNote. |
| `startTime` | in practice, yes | Seconds. |
| `duration` | no | Seconds, written in time units: `base.d * 2`. Its absence is meaningful — see below. |
| `frequency` | no | Hz. Its absence is meaningful — see below. |
| `amplitude` | no | Relative gain, e.g. `"(121/100) * [3].a"`. Absent = the BaseNote's. |
| `attack`, `release` | no | A share of the note's own duration, e.g. `"1/8"`. The attack counts from the note's start, clamped to 0–1; the release from its end, clamped to 0–4. Absent = the BaseNote's, then the instrument's. |
| `measure` | no | `true` on a measure bar. Saved only when true. |
| `color` | no | e.g. `"rgba(242,167,27,0.7)"`. |
| `instrument` | no | Inherited along the frequency chain when absent. |

The six **expression keys** are exactly `startTime`, `duration`, `frequency`, `amplitude`, `attack`, `release`. The first three are the notation: each relates the note to other notes. The last three are **interpretation variables**, kept apart from it. The **non-expression keys** are `id`, `color`, `instrument` and `measure`. Any other key in a note object is ignored — including the `_description` field that older versions of this page suggested. Nothing reads it, and it is dropped the first time you re-save.

`amplitude`, `attack` and `release` **fall back to the BaseNote** when a note does not define them. `startTime`, `duration` and `frequency` never fall back.

### Note kinds are inferred, not declared

There is no `type` field. What a note *is* follows from which expressions it has, plus one flag:

| Kind | Rule |
|---|---|
| **Note** | `startTime` + `duration` + `frequency` |
| **Silence** | `startTime` + `duration`, **no** `frequency`, no `measure` flag |
| **Measure bar** | `startTime` + `duration`, **no** `frequency`, `"measure": true` |

All of them live in the same `notes` array and share one id space. A silent note without the flag is a rest; with the flag it is drawn as a bar line with a triangle. A note with only a start time is a plain marker, not a bar.

A measure bar is a silent note with its length written as an expression. This is the measure chain from the default module: the first bar is four time units, and each bar starts where the previous one ends and lasts as long.

```json
{ "id": 1, "startTime": "base.t", "duration": "base.d * 4", "measure": true },
{ "id": 2, "startTime": "[1].t + [1].d", "duration": "[1].d", "measure": true },
{ "id": 3, "startTime": "[2].t + [2].d", "duration": "[2].d", "measure": true }
```

A meter change is one bar's `duration`; the bars after it follow. See [Measure bars](/reference/module-schema#measure-bars).

And this is a silence — a quarter time unit of nothing:

```json
{ "id": 1, "startTime": "base.t", "duration": "base.d * (1/4)",
  "color": "hsla(258, 70%, 60%, 0.7)" }
```

## Expression strings

Expressions are text. They are compiled to **bytecode** and run on a stack machine — nothing in the load path uses `eval()` or `new Function()`.

Expressions are written in the **DSL**. Every shipped module uses it.

```
base.f * (3/2)          # a fifth above the BaseNote
(5/4) * [1].f           # a major third above note 1
[1].t + [1].d           # start when note 1 ends
[1].t + [1].d * (1/4)   # a quarter of note 1's length after it starts
base.d                  # one time unit long
base.d * (3/4)          # a dotted eighth
[1].f * 2 ^ (1/12)      # one 12-TET semitone above note 1
```

`#` starts a comment that runs to the end of the line. Comments **are** saved: the app writes an expression back as the source text you wrote, so a comment survives the round trip.

### Property names

| Property | Write it as |
|---|---|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |
| amplitude | `a`, `amp`, `amplitude` |
| attack | `atk`, `attack` |
| release | `rel`, `release` |

`base.f` and `[0].f` mean the same thing: the BaseNote is note 0.

### No functions

The language has no functions. `beat()`, `tempo()` and `measure()` were removed, along with the `tempo`, `beatsPerMeasure` and `measureLength` variables. Typing one is refused with a message naming the replacement, for example: "'beat()' was removed: the reference note's duration is the time unit, so write base.d for beat(base), or [N].d to relate to note N".

Use `base.d` for durations. It is what every shipped module and every expression the app writes for you uses.

::: info Your expressions round-trip as written
Saving writes back the **source text** of each expression, not a regeneration of it. Spacing and comments are preserved, and only the `[N]` references are renumbered by the reindex. An expression is rewritten in the app's own style only when the *app* generates a new one for you — a drag, a resize, an arrow click, a note-length button.
:::

::: warning An expression the compiler cannot read is rejected
The compiler logs a `console.error` and refuses the expression — it never silently compiles to `0`. On the **Load Module** file path the module still loads, but the affected property is left unset (the note falls back to its defaults); the library-upload and Load-UI validators reject the file outright with the reason. If a load "succeeded" but a note looks wrong, check the browser console.
:::

## Colours

Colours are checked against a whitelist, not parsed as general CSS. Accepted forms:

| Form | Example |
|---|---|
| Hex | `#f2a71b`, `#fff`, `#f2a71bcc` |
| RGB / RGBA | `rgba(242,167,27,0.7)` |
| HSL / HSLA | `hsla(258, 70%, 60%, 0.7)` |
| Named | `red`, `steelblue` — about 140 CSS names |

Anything else is rejected with `invalid color value` when the module goes through the library validator. Shipped modules use `rgba()` with alpha, because the alpha channel is visible in the workspace.

## Instruments

`instrument` is a plain name string. The eleven built-ins:

| Name | Kind |
|---|---|
| `sine-wave` | Synth |
| `square-wave` | Synth |
| `sawtooth-wave` | Synth |
| `triangle-wave` | Synth |
| `organ` | Synth |
| `vibraphone` | Synth |
| `fm-epiano` | Synth — FM electric piano |
| `harmonium` | Synth — steady, every harmonic to the 16th |
| `harmonium-soft` | Synth — the same, darker and quieter |
| `piano` | Multisampled (VSCO2 Community Edition, CC0) |
| `violin` | Multisampled (VSCO2 Community Edition, CC0) |

A note with no `instrument` inherits one **along its frequency chain**: the app follows the note the `frequency` expression references, then that note's reference, and so on. If nothing in the chain pins an instrument, the note falls back to the `audio.defaultInstrument` setting (default `sine-wave`). The full lookup order, and its edge cases, are in [Instruments](/user-guide/playback/instruments#how-inheritance-works).

That is why most of the scale-system modules put `"instrument": "sine-wave"` on their BaseNote — it fixes the timbre for the whole module instead of letting it follow whatever the listener set. (`scale-systems/tesla.json` is the exception: it pins nothing, so it plays with whatever default is set.)

## Ids and reindexing

Ids are yours to choose while you hand-write a file, but they will not survive:

**Save Module always reindexes.** Measure bars (the notes flagged `measure`) are renumbered first (sorted by evaluated `startTime`), then the remaining notes (also by `startTime`), starting at id 1. Every `[N]` reference is rewritten to match. Notes are then written out sorted by id.

So the ids in the file you download will generally differ from the ids you saw on screen, and from the ids you originally wrote. There is no byte-stable round trip. **Reorder Module** (in the **+** menu, behind a confirmation) applies the same renumbering to the live workspace.

Nothing is added to the BaseNote on the way out: the file holds the expressions you set, and no `tempo`, `beatsPerMeasure` or `measureLength`.

## Limits

| Limit | Value |
|---|---|
| Max file size (**Load Module**) | 3 MB |
| Max notes | 10 000 |
| Max JSON nesting depth (**Load Module**) | 20 |
| Valid note id | integer, 0 – 65 535 |
| Max expression length | 10 000 characters |
| Note ids blocked outright | `__proto__`, `constructor`, `prototype` |

The id ceiling matches the bytecode: a reference is encoded as a 16-bit integer, the loader rejects (skips, with a console warning) any id above 65 535, and an expression like `[70000].f` is rejected when it compiles — so an id can never wrap to a different note.

## What is checked, and where

Different entry points run different checks. This trips people up, so it is worth stating plainly.

| Entry point | Size | Structure | Expressions | Colors |
|---|---|---|---|---|
| **Load Module** (file → workspace) | 3 MB | depth ≤ 20, ≤ 10 000 notes | not checked | not checked |
| **Library upload** (the `+` tile in the module bar) | — | full | checked | checked |
| **Load UI** import | — | full, per embedded module | checked | checked |
| **Copy to Modules** | — | full | checked | checked |
| Dragging a library icon onto a note | — | sniff only | not checked | not checked |

Two things that are **not** checked anywhere at load time:

- **Dangling references.** `[99].f` when there is no note 99 loads fine and evaluates to a fallback (440 Hz for frequency, 0 s for start time, 1 s for duration). The evaluator logs `Unresolved reference!` to the console, naming the note and property on both ends.
- **Circular dependencies.** `[1].f = [2].f` and `[2].f = [1].f` load. The evaluator logs `Dependency cycle detected!` to the console with the loop spelled out, and evaluates those properties against the fallbacks. Only a property that depends on *itself* is a cycle: `[1].f = [2].f` together with `[2].t = [1].t + [1].d` is two notes reading each other, and evaluates normally.

Neither produces an error message on screen. If a note is missing or in the wrong place after a load, open the browser console.

## Shipping a module in the repo

Adding a module to the library that ships with the app takes two steps.

1. Put the file under `public/modules/<section>/`, e.g. `public/modules/custom/my-module.json`.
2. Add an item to that section's `items` array in **`public/modules/library.json`** — the single v2 manifest that describes the whole library.

```json
{
  "file": "custom/my-module.json",
  "name": "My Module",
  "ratio": "3/2",
  "cents": 701.955,
  "family": "3-limit",
  "tags": ["custom", "fifth"]
}
```

| Item field | Required | Used for |
|---|---|---|
| `file` | yes | Fetching the module; path is relative to `public/modules/` |
| `name` | yes | The icon's label and the search index |
| `ratio` | no | The fraction drawn on the icon |
| `cents` | no | The caption under the fraction, when **Show cents** is on |
| `family` | no | The icon's color, e.g. `3-limit`, `chord`, `melody`, `scale` |
| `tags` | no | Matched by the module bar's search field |

Then run `npm test`. It validates every module in the manifest: structure, expression syntax, self-containment (every `[N]` reference resolves inside the same file), finite evaluation — and, for a single-note interval module with a `ratio`, that the evaluated frequency really is `ratio × base` and that `cents` really is `1200·log2(ratio)`.

Self-containment is what makes a module droppable. On import, its note 0 is remapped onto the note you dropped it on; a reference that pointed outside the file would have nothing to bind to.

::: info The per-section `index.json` files are a fallback, not the way in
`public/modules/<section>/index.json` is a bare array of filenames, read only when `library.json` is missing or not version 2. It knows about four sections and nothing else. Editing it will not add your module to the shipped library.
:::

## Common mistakes

**Writing a `measures` array.** There is no such key. A measure bar is a silent note flagged `"measure": true`. See [note kinds](#note-kinds-are-inferred-not-declared).

**Writing a bar without the flag.** A silent note with a start and a duration but no `"measure": true` is a rest, and the editor draws it as one.

**Writing `beat(base)`, `tempo` or `measure()`.** They were removed. In a file they are converted on load (see below); typed into the app they are refused with the replacement named. Write `base.d`.

**Using `//` for comments inside an expression.** The DSL comment character is `#`. `//` lexes as two division operators and fails to parse — the expression is rejected with a compile error and the property is left unset on load.

**Assuming `[2].f = base.f * (3/2)` is valid.** The DSL has no assignment operator. An expression is only ever the right-hand side; the property it belongs to is the JSON key.

**Using absolute numbers for pitch and time.** `"frequency": "394.5"` works, but the note is then frozen — it will not follow the BaseNote, and the module will not adapt when dropped onto another note. Write `(3/2) * base.f`.

## Modules from earlier versions

Earlier versions stored a tempo and a number of beats per measure on the BaseNote, wrote durations with `beat(base)`, and wrote measure bars as notes with only a start time. Those files still load. The app converts them when it loads them (`Module.loadFromJSON` calls `src/migrate/relational-time.js`), and the conversion is exact: every start, duration, frequency and amplitude keeps the same fraction it had.

| Old | New |
|---|---|
| `beat(base)`, `beat([N])` | `base.d` |
| `measure([N])` on a bar | `[N].d` |
| a tempo T | `base.d = 60/T` |
| beats per measure B | a measure bar of `base.d * B` |

Files written in the old method-chain syntax (`module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))`) are converted to the DSL in the same load, right after; see [The retired method-chain syntax](/reference/expressions/syntax#the-retired-method-chain-syntax).

A BaseNote tempo written as a relation stays one: `tempo: base.f * (15/64)` becomes `duration: 60 / (base.f * (15/64))`. What the converter cannot express exactly, such as a note's own tempo next to a BaseNote tempo that is not a constant, is refused with an error rather than loaded wrongly.

To convert files on disk, run the script from the repository root:

```bash
node scripts/migrate-modules.mjs <file-or-folder>
node scripts/migrate-modules.mjs <file-or-folder> --dry-run   # list what would change
```

It uses the same conversion as the app, keeps line endings and indentation, and leaves files already in the new form untouched. The library in `public/modules/` is already converted.

::: warning Files saved by this version do not open in the published editor
The conversion goes one way. A module saved from this version carries `duration` on the BaseNote and `"measure": true` on its bars, and the published editor on `main` does not read them. Keep a copy of any file you still need there.
:::

If a saved session cannot be loaded at startup, the app keeps it in `localStorage` under `rmt:moduleSnapshot:v1:unloadable` and opens the default module.

## See also

- [Module JSON Schema](/reference/module-schema) — the exhaustive reference
- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Creating Modules](/user-guide/modules/creating-modules) — building one in the app
- [Saving Modules](/user-guide/modules/saving-modules) · [Loading Modules](/user-guide/modules/loading-modules)
- [The time unit](/reference/properties/duration#the-time-unit)
