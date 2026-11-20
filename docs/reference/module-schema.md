---
title: Module JSON Schema
description: The complete JSON format of a saved RMT Compose module — every baseNote and note field, defaults, note kinds, validation limits, and the library manifest.
---

# Module JSON Schema

A **module** is a composition saved as JSON. It has two top-level keys, a `baseNote` object and a `notes` array, and a saved file carries a third, `instrumentRule`. Every musical value is stored as an **expression string**, never as a computed number.

```json
{
  "baseNote": { "...": "expressions" },
  "notes": [ { "id": 1, "...": "expressions" } ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `baseNote` | object | yes | The root reference note. It is note id **0**. |
| `notes` | array | yes | Flat array of note objects. Order does not matter; the app sorts by `id` on export. |
| `instrumentRule` | string | no | `"start-time"`, written by every save (`Module.createModuleJSON`). A file without it is older than the rule that instruments follow the start time and is [migrated on load](#instruments). |

There is **no** `version`, `name`, `author`, `tempo`, `measures[]`, or `parentId` field. A module has no metadata at all: the library takes a module's display name from the [library manifest](#the-library-manifest) or from the uploaded file's name, never from the file's contents. Parentage is reconstructed from the expressions themselves.

::: warning `notes` is mandatory in practice
The structure check on **Load Module** tolerates a file with no `notes` key, but the loader then throws and you get a red `Error loading module: …` banner. Always include `notes`, even if empty.
:::

## A real module file

This is `public/modules/intervals/3-2.json`, shipped with the app in full:

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

One note, a perfect fifth above the BaseNote, one time unit long, starting where the BaseNote starts. The BaseNote holds the only absolute values: a frequency in Hz, and a start and a duration in seconds.

## The `baseNote` object

Every field is optional. An omitted field falls back to the **class default** below — *not* to the values in the default module you see when you open the app (263 Hz, a duration of 3/5 s).

| Field | Type | Default if omitted | Notes |
|---|---|---|---|
| `frequency` | expression string | `440` Hz | Shipped modules use `263` or `440`. |
| `startTime` | expression string | `0` s | Shipped modules use `0`. |
| `duration` | expression string | `1` s | The **time unit**, `base.d`: one beat if you count in beats. `60 / duration` is the tempo in BPM, shown by the note widget and stored nowhere. See [the time unit](/reference/properties/duration#the-time-unit). |
| `amplitude` | expression string | `1` | A relative gain. Every note without its own inherits it, so it scales the whole piece. Written to the file only when set. See [amplitude](/reference/properties/amplitude). |
| `attack` | expression string | none | A share of each note's duration, `0`–`1`, from the note's start. Every note without its own inherits it. With none set, the instrument's own envelope applies. See [attack and release](/reference/properties/attack-release). |
| `release` | expression string | none | The same, for the fall after the end of a note: a share of the duration counted from the note's end, `0`–`4`. |
| `color` | CSS color string | none | Accepted by the loader and the exporter. No shipped module uses it. |
| `instrument` | instrument name | none → the `audio.defaultInstrument` setting | See [Instruments](#instruments). |

The first three rows are the **language**: the BaseNote's frequency, start and duration are the only absolute values in a module, and every other note relates to them. `amplitude`, `attack` and `release` are **interpretation variables**: how the notes sound, not what they relate to.

::: warning There is no tempo, beatsPerMeasure or measureLength
These three keys were removed. A module that still has them is converted exactly when it loads, see [Modules from earlier versions](/user-guide/modules/module-format#modules-from-earlier-versions). Typing `tempo`, `bpm` or `ml` in an expression is refused with a message naming the replacement.
:::

## The `notes` array

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | integer | **yes** | `0 ≤ id ≤ 65535`. `0` is reserved for the BaseNote. Duplicates are rejected by the library validator. |
| `startTime` | expression string | in practice, yes | Seconds from time zero. |
| `duration` | expression string | no | Seconds. Absent = a plain marker with no length. |
| `frequency` | expression string | no | Hz. Absent (with a `duration` present) = a silence, or a measure bar. |
| `amplitude` | expression string | no | Relative gain, e.g. `"(121/100) * [3].a"`. Absent = the BaseNote's. |
| `attack` | expression string | no | A share of the note's duration, from its start, e.g. `"(1/8)"`, `0`–`1`. Absent = the BaseNote's, else the instrument's. |
| `release` | expression string | no | The same, for the release after the note's end, `0`–`4`. |
| `color` | CSS color string | no | e.g. `"rgba(242,167,27,0.7)"`. |
| `instrument` | instrument name | no | When absent, the note takes the instrument of its player (see [Instruments](#instruments)). |
| `measure` | `true` | no | Marks a silent note as a [measure bar](#measure-bars). Any other value is read as absent. Written only when `true`. |

The six **expression keys** are exactly `startTime`, `duration`, `frequency`, `amplitude`, `attack`, `release`. The first three are the language; the last three are interpretation. The **non-expression keys** are `id`, `color`, `instrument` and `measure`. Anything else in a note object is ignored.

### Note kinds

What a note *is* follows from which keys it has (`noteKind()` in `src/note.js`). The one flag, `measure`, separates a measure bar from a silence. Only a **note** sounds; the others are structure other notes relate to.

| Kind | Rule | Drawn as |
|---|---|---|
| **Note** | `startTime` + `duration` + `frequency` | A filled bar at its pitch |
| **Silence** (rest) | `startTime` + `duration`, **no** `frequency`, no `measure` flag | A dashed outline, no sound |
| **Measure bar** | `startTime` + `duration`, **no** `frequency`, `"measure": true` | A vertical dashed line with a triangle |
| **Reference** | `frequency` only | A dashed line across the whole workspace at its pitch, labelled `[id]`: a tonic, a key, a chord root. Never sounds |
| **Key change** | `frequency` + `startTime`, **no** `duration` | The same line from its start on, labelled `[id]` just before the start: from here, this is the reference. Never sounds |
| **Marker** | `startTime` only | A point to anchor other notes to; not a bar, and not scheduled |

A reference or a key change is related to like any note: `(5/4) * [1].f` is a major third over the
tonic in note 1, and `[4].t` starts a note where the key change in note 4 begins. It has no length, so
nothing should read its `d` (a reference also has no `t`): such a read falls back to the documented
default and is reported in the console. A reference is selected by clicking its line, which opens its
widget; it cannot be dragged, grouped or dropped onto, and MIDI export counts it without writing it
(`report.notes.references`).

## Measure bars

A **measure bar** is a silent note with a start and a duration, no frequency, and the flag `"measure": true`. The duration is the length of the bar. The flag decides how the editor draws and treats the note; evaluation reads a bar like any other note (`isMeasureNote()` in `src/note.js`).

### The chain form

**Add Measure** (`Module.generateMeasures`, `src/module.js`) writes the first bar from the BaseNote, and each next bar from the one before it:

```json
{ "id": 1, "startTime": "base.t", "duration": "base.d * 4", "measure": true },
{ "id": 2, "startTime": "[1].t + [1].d", "duration": "[1].d", "measure": true },
{ "id": 3, "startTime": "[2].t + [2].d", "duration": "[2].d", "measure": true }
```

The first bar is four time units long. Each next bar starts where the previous one ends and is as long as it. A chain like this is a [measure chain](/reference/glossary#measure-chain). The row that adds a bar is labelled **Add New Measure Chain** on the BaseNote and **Add Measure** on the last bar of a chain, and appears nowhere else.

### A meter change

A different bar length is a different meter. Give one bar its own duration, and the bars after it follow, because each reads the one before:

```json
{ "id": 1, "startTime": "base.t", "duration": "base.d * 4", "measure": true },
{ "id": 2, "startTime": "[1].t + [1].d", "duration": "base.d * 3", "measure": true },
{ "id": 3, "startTime": "[2].t + [2].d", "duration": "[2].d", "measure": true }
```

Bar 1 is four time units, bars 2 and 3 are three. There is no time-signature object: a meter is a bar length. In the bar's widget the duration row reads **duration (bar length)** and shows the length in time units, for example `= 3 time units`.

### Bar, silence or marker

| | Has | Sounds | Drawn as |
|---|---|---|---|
| **Measure bar** | start, duration, `measure: true` | no | dashed line with a triangle, never as a rest |
| **Silence** | start, duration, no frequency | no | a rest: a dashed outline the length of the note |
| **Marker** | start only | no | not drawn as a bar |

### Editing a bar

- Dragging a bar's triangle changes the **previous** bar's length; the dragged bar keeps its own.
- The module ends at the larger of the last bar's start plus its duration, and the last note's end.
- Dropping a library module on a bar maps `t` and `d` to the bar, and leaves frequency, amplitude, attack and release with the BaseNote.
- MIDI export writes the first bar's length in time units as the time signature (4 as 4/4, 7/2 as 7/8), and none when there is no bar or the length cannot be a signature. See [Exporting MIDI](/user-guide/modules/exporting-midi).

## Expression strings

Expressions are text. They are **compiled to bytecode**, never `eval`'d — nothing in the load path uses `eval()` or `new Function()`.

Expressions are written in the DSL. Every shipped module uses it for its notes:

```
base.f * (3/2)          # a fifth above the base
[1].t + [1].d           # start when note 1 ends
base.d * (3/4)          # a dotted eighth
[1].d                   # as long as note 1
2^(1/12)                # one 12-TET semitone
```

See the [expression syntax reference](/reference/expressions/syntax) for the full grammar. The language has no functions.

::: warning An unparseable expression is rejected with an error
If the compiler cannot read a string, `compile()` logs a `console.error` naming the expression and **throws** — there is no silent constant-0 fallback. In the note widget the message appears under the Save button; the syntax validators return `valid: false`; `npm test` rejects a shipped module containing one. On a file load the affected property is left **unset** rather than zeroed, so the note falls back to its defaults.
:::

## Colors

Both `#rrggbb` hex and `rgba()` are accepted, but every shipped module uses `rgba()` with alpha, because alpha is visible:

```json
"color": "rgba(242,167,27,0.7)"
"color": "hsla(258, 70%, 60%, 0.7)"
```

New notes created in the app get a random `hsla(<random hue>, 70%, 60%, 0.7)`.

The library validator whitelists `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()` and the ~140 named CSS colors. Anything else is rejected.

## Instruments

`instrument` is a plain name string. The eleven built-ins:

| Name | Kind |
|---|---|
| `sine-wave` | Synth |
| `square-wave` | Synth |
| `sawtooth-wave` | Synth |
| `triangle-wave` | Synth |
| `organ` | Synth — additive harmonics |
| `vibraphone` | Synth |
| `fm-epiano` | Synth — FM electric piano (carrier + modulator) |
| `harmonium` | Synth — every harmonic from the 1st to the 16th, steady |
| `harmonium-soft` | Synth — the same, darker and quieter |
| `piano` | Multisampled (VSCO2 Community Edition, CC0) |
| `violin` | Multisampled (VSCO2 Community Edition, CC0) |

**A note without an `instrument` takes the instrument of its player.** A player is a line of notes, each starting where the previous one ends. A note's instrument is its own, if it sets one (it then starts a new player); else the instrument of the note or silence its start is written from the end of (`[p].t + [p].d`, optionally plus a rest); else that of its counterpart in a line it copies (start `[k].t + X`, frequency `r * [k].f`); else, as the first note of a line, that of the note its start time is written from, else the BaseNote's, else the global **`audio.defaultInstrument`** setting (default `sine-wave`). The frequency does not decide the instrument. The rule is in [Instruments](/user-guide/playback/instruments#players); the code is `src/players.js`.

**Modules saved before this rule.** A file without `"instrumentRule": "start-time"` is migrated on load: every sounding note whose instrument the rule would change gets its old instrument written onto it, so the module keeps its sound. A save writes `"instrumentRule": "start-time"` at the top level, so the file is not migrated again. No note of any shipped library module changes instrument.

This is why most scale-system modules pin `"instrument": "sine-wave"` on their BaseNote: it fixes the timbre for the whole module instead of letting it follow the listener's default.

## What `Save Module` actually writes

**Save Module** (in the top-bar **+** menu) downloads a file named `module.json`, pretty-printed with 2-space indentation. Three things about that file surprise people:

1. **It is reindexed.** Measure bars are renumbered first (sorted by evaluated `startTime`), then the remaining notes (also by `startTime`), starting at id 1. Every `[N]` reference is rewritten to match. Ids in the saved file will generally differ from the ids you saw on screen. There is no byte-stable round trip.
2. **Expression source text is preserved verbatim.** A module that was loaded from the retired method-chain syntax has already been converted to DSL on load, so it is saved in the DSL (see [The retired method-chain syntax](/reference/expressions/syntax#the-retired-method-chain-syntax)).
3. **Nothing is added.** `amplitude`, `attack` and `release` are written only for the notes (and the BaseNote) that define one, and `measure` only on a bar, so a file that never used them is saved without them. A pure-DSL source file round-trips as pure DSL.

Files saved by this version do not load in the published editor.

## Limits and validation

Different entry points apply different checks. This is the exhaustive picture.

| Entry point | Size cap | Structure | Expressions | Colors |
|---|---|---|---|---|
| **Load Module** (file → workspace) | 3 MB | depth ≤ 20, ≤ 10 000 notes | — | — |
| **Library upload** (the `+` placeholder in the module bar) | — | full | checked | checked |
| **Load UI** import | — | full, per embedded module | checked | checked |
| **Copy to Modules** (group selection → library) | — | full | checked | checked |
| **Drag-drop of a library icon onto a note** | — | sniff only | — | — |

Hard limits, wherever a module is read:

| Limit | Value |
|---|---|
| Max file size (Load Module) | **3 MB** |
| Max notes | **10 000** |
| Max JSON nesting depth (Load Module) | **20** |
| Valid note id | integer, **0 – 65 535** (ids are encoded as u16 in the evaluator's bytecode) |
| Max expression length | **10 000 characters** |
| Note ids blocked outright | `__proto__`, `constructor`, `prototype` |

Toasts you can hit on load: `Module file too large (max 3MB)`, `Invalid module file structure`, `Module loaded successfully`.

The id ceiling exists because a reference is encoded as a 16-bit integer in the evaluator's bytecode. The loader rejects (and skips) any note whose id is above 65 535, and both expression parsers enforce the same range at compile time — `[70000].f` is a parse error (`Note IDs must be integers between 0 and 65535`), not a silently truncated reference to a different note.

Expression strings are additionally screened for dangerous-looking patterns (`eval(`, `Function(`, `fetch(`, `document.`, `window.`, `__proto__`, `<script`, `javascript:`, …) at the library-upload and Load-UI entry points. Malformed expressions are caught by the compiler itself, which throws instead of guessing (see above).

## The library manifest

The module library is described by one top-level file, **`public/modules/library.json`**, a v2 manifest:

```json
{
  "version": 2,
  "sections": [
    {
      "id": "intervals",
      "label": "Intervals",
      "items": [
        {
          "file": "intervals/1-1.json",
          "name": "Unison",
          "ratio": "1/1",
          "cents": 0,
          "family": "3-limit",
          "tags": ["P1", "unison", "prime"]
        }
      ]
    }
  ]
}
```

| Item field | Type | Required | Used for |
|---|---|---|---|
| `file` | path relative to `public/modules/` | yes | Fetching the module |
| `name` | string | yes | The icon's label and the search index |
| `ratio` | string `"n/d"` | no | The fraction shown on the icon; checked by `npm test` |
| `cents` | number | no | Shown when **Show cents** is on; checked by `npm test` |
| `family` | string | no | e.g. `3-limit`, `5-limit` |
| `tags` | string[] | no | Matched by the module bar's search field |

Shipped sections and counts:

| Section id | Label | Modules |
|---|---|---|
| `intervals` | Intervals | 46 |
| `chords` | Chords | 11 |
| `progressions` | Progressions | 8 |
| `melodies` | Melodies | 7 |
| `scale-systems` | Scale Systems | 6 |
| `custom` | Custom | 1 |

**81 modules in total.** `npm test` validates every one of them: structure, expression syntax, self-containment (every `[N]` reference resolves inside the same file), finite evaluation, and — for single-note interval modules — that the evaluated frequency really is `ratio × base` and that `cents` really is `1200·log2(ratio)`.

Self-containment is what makes a library module droppable: on import, its note id 0 is remapped onto the note you dropped it on, and its internal ids are renumbered above the current maximum.

A per-category `index.json` loader still exists as a fallback for the pre-v2 layout. The v2 manifest is authoritative.

## The other saved JSON: `ui-state.json`

**Save UI** (in the module bar's footer) downloads a different file — `ui-state.json`. It is the **library layout**, not a composition: sections and their labels, which icons sit where, which are collapsed, the drop mode (**Start** or **End**, stored under the `dropMode` key), and the full JSON of any module you *uploaded* (uploads have no re-fetchable path, so their data is embedded; built-ins are stored by file path).

Do not confuse the two. A `ui-state.json` will not load as a module, and a `module.json` will not load as a UI state.

## Where the app keeps things between sessions

| `localStorage` key | Contents |
|---|---|
| `rmt:moduleSnapshot:v1` | The current composition, in module-JSON shape. Written on every undoable edit, on tab-hide, and on unload. Loaded on boot instead of the default module. |
| `rmt:moduleSnapshot:v1:unloadable` | A saved session that could not be loaded is kept here, and the default module opens. |
| `ui-state` | The library layout (the `Save UI` payload). |
| `rmt:settings:v1` | The [settings tree](/reference/settings-reference). |

There is no "unsaved changes" prompt and no named-project concept: the app always resumes the last state.

## See also

- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Settings Reference](/reference/settings-reference) — every setting, including `audio.defaultInstrument`
- [Saving Modules](/user-guide/modules/saving-modules) · [Loading Modules](/user-guide/modules/loading-modules)
- [The Module Library](/user-guide/modules/module-library)
- [Glossary](/reference/glossary)
