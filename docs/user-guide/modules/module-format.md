---
title: Module Format
description: How a module JSON file is put together — the baseNote, the notes array, the three note kinds, expression strings, colours, instruments, ids, and the load-time limits.
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

That is the whole structure. There is **no** `measures` array, no `version`, no `name`, no `author`, no `parentId`. A module carries no metadata at all — the library gets a module's display name from the [library manifest](#shipping-a-module-in-the-repo) or from the uploaded file's name, never from inside the file.

Every musical value is an **expression string**, never a number. That is the point of the format: relationships survive, so changing the BaseNote moves everything that depends on it.

Here is a complete shipped module, `public/modules/intervals/3-2.json`:

```json
{
  "baseNote": {
    "frequency": "263",
    "startTime": "0",
    "tempo": "60",
    "beatsPerMeasure": "4"
  },
  "notes": [
    {
      "id": 1,
      "startTime": "base.t",
      "duration": "beat(base)",
      "frequency": "(3/2) * base.f",
      "color": "rgba(242,167,27,0.7)"
    }
  ]
}
```

One note: a perfect fifth above the base, one beat long, starting where the base starts.

## The `baseNote` object

Every field is optional. An omitted field falls back to the **class default** below — not to the values of the default module you see when you open the app (263 Hz, 100 BPM).

| Field | Default if you omit it | Notes |
|---|---|---|
| `frequency` | `440` Hz | Shipped modules use `263`. |
| `startTime` | `0` s | |
| `tempo` | `60` BPM | |
| `beatsPerMeasure` | `4` | The numerator of the time signature. |
| `measureLength` | `60 / tempo × beatsPerMeasure` | Only five shipped modules set it explicitly — 12/19/31-TET, Bohlen–Pierce and Mixed-Base — as `beat(base) * base.bpm`. |
| `color` | none | Accepted, but no shipped module uses it. |
| `instrument` | none → the `audio.defaultInstrument` setting | Pins the timbre for everything that inherits from the base. |

::: warning The BaseNote has no duration
`duration` is not one of the BaseNote's defaults, and no shipped module sets `baseNote.duration`. Do not write one, and do not write expressions that read `base.d`.
:::

## The `notes` array

| Field | Required | Notes |
|---|---|---|
| `id` | **yes** | Integer, `0 ≤ id ≤ 100000`. `0` is reserved for the BaseNote. |
| `startTime` | in practice, yes | Seconds. |
| `duration` | no | Seconds. Its absence is meaningful — see below. |
| `frequency` | no | Hz. Its absence is meaningful — see below. |
| `tempo` | no | Per-note override. |
| `beatsPerMeasure` | no | Per-note override. This is how a measure bar carries a meter change. |
| `measureLength` | no | Per-note override. |
| `color` | no | e.g. `"rgba(242,167,27,0.7)"`. |
| `instrument` | no | Inherited along the frequency chain when absent. |

The six **expression keys** are exactly `startTime`, `duration`, `frequency`, `tempo`, `beatsPerMeasure`, `measureLength`. The three **non-expression keys** are `id`, `color`, `instrument`. Any other key in a note object is ignored — including the `_description` field that older versions of this page suggested. Nothing reads it, and it is dropped the first time you re-save.

`tempo`, `beatsPerMeasure` and `measureLength` **fall back to the BaseNote** when a referenced note does not define them. `startTime`, `duration` and `frequency` do not fall back.

### Note kinds are inferred, not declared

There is no `type` field. What a note *is* follows from which expressions it has:

| Kind | Rule |
|---|---|
| **Note** | `startTime` + `duration` + `frequency` |
| **Silence** | `startTime` + `duration`, **no** `frequency` |
| **Measure bar** | `startTime`, **no** `duration`, **no** `frequency` |

All three live in the same `notes` array and share one id space.

A measure bar is therefore a note you left two properties off. This is the measure chain from the default module — each bar starts one measure after the previous one:

```json
{ "id": 1, "startTime": "base.t" },
{ "id": 2, "startTime": "[1].t + measure([1])" },
{ "id": 3, "startTime": "[2].t + measure([2])" }
```

And this is a silence from `custom/canon base.json` — a quarter-beat of nothing:

```json
{ "id": 1, "startTime": "base.t", "duration": "beat(base) * (1/4)",
  "color": "hsla(258, 70%, 60%, 0.7)" }
```

## Expression strings

Expressions are text. They are compiled to **bytecode** and run on a stack machine — nothing in the load path uses `eval()` or `new Function()`.

The **DSL** is the primary format. Every shipped module uses it.

```
base.f * (3/2)          # a fifth above the BaseNote
(5/4) * [1].f           # a major third above note 1
[1].t + [1].d           # start when note 1 ends
[1].t + measure([1])    # one measure after note 1 starts
beat(base)              # one beat long
beat(base) * (3/4)      # a dotted eighth
[1].f * 2 ^ (1/12)      # one 12-TET semitone above note 1
```

`#` starts a comment that runs to the end of the line. Comments **are** saved: the app writes an expression back as the source text you wrote, so a comment survives the round trip.

### Property names

| Property | Write it as |
|---|---|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |
| tempo | `tempo` |
| beatsPerMeasure | `bpm`, `beatsPerMeasure` |
| measureLength | `ml`, `measureLength` |

`base.f` and `[0].f` mean the same thing: the BaseNote is note 0.

### Helper functions

There are exactly three, and each takes a **bare note reference** — `base` or `[N]`, never an expression.

| Call | Meaning |
|---|---|
| `beat(x)` | One beat of x's tempo, in seconds (`60 / tempo`) |
| `tempo(x)` | x's tempo, in BPM |
| `measure(x)` | x's measure length, in seconds |

Use `beat(base)` for durations. It is what every shipped module and every expression the app writes for you uses.

::: info Your expressions round-trip as written
Saving writes back the **source text** of each expression, not a regeneration of it. `measure([1])` stays `measure([1])`, `tempo(base)` stays `tempo(base)`, spacing is preserved, and only the `[N]` references are renumbered by the reindex. An expression is rewritten in the app's own style only when the *app* generates a new one for you — a drag, a resize, an arrow click, a note-length button.
:::

<details>
<summary>Legacy JavaScript syntax</summary>

Method-chain expressions still load, and round-trip verbatim — saving does not convert them.

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.getNoteById(1).getVariable('startTime')
new Fraction(60).div(module.findTempo(module.baseNote))
```

The two formats can be mixed in one file. The format is detected per expression string.

</details>

::: warning An expression neither compiler can read is rejected
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

`instrument` is a plain name string. The nine built-ins:

| Name | Kind |
|---|---|
| `sine-wave` | Synth |
| `square-wave` | Synth |
| `sawtooth-wave` | Synth |
| `triangle-wave` | Synth |
| `organ` | Synth |
| `vibraphone` | Synth |
| `fm-epiano` | Synth — FM electric piano |
| `piano` | Multisampled (VSCO2 Community Edition, CC0) |
| `violin` | Multisampled (VSCO2 Community Edition, CC0) |

A note with no `instrument` inherits one **along its frequency chain**: the app follows the note the `frequency` expression references, then that note's reference, and so on. If nothing in the chain pins an instrument, the note falls back to the `audio.defaultInstrument` setting (default `sine-wave`). The full lookup order, and its edge cases, are in [Instruments](/user-guide/playback/instruments#how-inheritance-works).

That is why most of the scale-system modules put `"instrument": "sine-wave"` on their BaseNote — it fixes the timbre for the whole module instead of letting it follow whatever the listener set. (`scale-systems/tesla.json` is the exception: it pins nothing, so it plays with whatever default is set.)

## Ids and reindexing

Ids are yours to choose while you hand-write a file, but they will not survive:

**Save Module always reindexes.** Measure bars are renumbered first (sorted by evaluated `startTime`), then the remaining notes (also by `startTime`), starting at id 1. Every `[N]` reference is rewritten to match. Notes are then written out sorted by id.

So the ids in the file you download will generally differ from the ids you saw on screen, and from the ids you originally wrote. There is no byte-stable round trip. **Reorder Module** (in the **+** menu, behind a confirmation) applies the same renumbering to the live workspace.

One more thing changes on the way out: the BaseNote gains a `measureLength` even if your file omitted it, written in DSL form because that is the class default.

```json
"measureLength": "beat(base) * base.bpm"
```

It is harmless — and because it is DSL, a pure-DSL file stays "pure DSL" when saved.

## Limits

| Limit | Value |
|---|---|
| Max file size (**Load Module**) | 3 MB |
| Max notes | 10 000 |
| Max JSON nesting depth (**Load Module**) | 20 |
| Valid note id | integer, 0 – 65 535 |
| Max expression length | 10 000 characters |
| Note ids blocked outright | `__proto__`, `constructor`, `prototype` |

The id ceiling matches the bytecode: a reference is encoded as a 16-bit integer, and the loader rejects (skips, with a console warning) any id above 65 535 — so an id can never wrap to a different note.

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

- **Dangling references.** `[99].f` when there is no note 99 loads fine and evaluates to a fallback (440 Hz for frequency, 0 s for start time, 1 s for duration).
- **Circular dependencies.** `[1].f = [2].f` and `[2].f = [1].f` load. The evaluator logs `Dependency cycle detected!` to the console and leaves the affected notes unevaluated.

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

**Writing a `measures` array.** There is no such key. A measure bar is a note with a `startTime` and nothing else. See [note kinds](#note-kinds-are-inferred-not-declared).

**Writing `60 / tempo(base)` for a duration.** It works — an expression that starts with a number is routed to the legacy compiler first, which cannot read it, but the failure falls through to the DSL parser — yet write `beat(base)` anyway: it is what the app itself writes, it skips the wasted parse, and it is the form the decompiler gives back.

**Using `//` for comments inside an expression.** The DSL comment character is `#`. `//` lexes as two division operators and fails to parse — the expression is rejected with a compile error and the property is left unset on load.

**Assuming `[2].f = base.f * (3/2)` is valid.** The DSL has no assignment operator. An expression is only ever the right-hand side; the property it belongs to is the JSON key.

**Using absolute numbers for pitch and time.** `"frequency": "394.5"` works, but the note is then frozen — it will not follow the BaseNote, and the module will not adapt when dropped onto another note. Write `(3/2) * base.f`.

## See also

- [Module JSON Schema](/reference/module-schema) — the exhaustive reference
- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Creating Modules](/user-guide/modules/creating-modules) — building one in the app
- [Saving Modules](/user-guide/modules/saving-modules) · [Loading Modules](/user-guide/modules/loading-modules)
