---
title: Module JSON Schema
description: The complete JSON format of a saved RMT Compose module — every baseNote and note field, defaults, note kinds, validation limits, and the library manifest.
---

# Module JSON Schema

A **module** is a composition saved as JSON. It has exactly two top-level keys: a `baseNote` object and a `notes` array. Every musical value is stored as an **expression string**, never as a computed number.

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

There is **no** `version`, `name`, `author`, `tempo map`, `measures[]`, or `parentId` field. A module has no metadata at all: the library takes a module's display name from the [library manifest](#the-library-manifest) or from the uploaded file's name, never from the file's contents. Parentage is reconstructed from the expressions themselves.

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

One note, a perfect fifth above the BaseNote, one beat long, starting where the BaseNote starts.

## The `baseNote` object

Every field is optional. An omitted field falls back to the **class default** below — *not* to the values in the default module you see when you open the app (263 Hz / 100 BPM).

| Field | Type | Default if omitted | Notes |
|---|---|---|---|
| `frequency` | expression string | `440` Hz | Shipped modules use `263`. |
| `startTime` | expression string | `0` s | Shipped modules use `0`. |
| `tempo` | expression string | `60` BPM | In beats per minute. |
| `beatsPerMeasure` | expression string | `4` | The numerator of the time signature. |
| `measureLength` | expression string | `60 / tempo × beatsPerMeasure` | Five of the six scale-system modules are the only shipped modules that set it explicitly, as `beat(base) * base.bpm`. |
| `color` | CSS color string | none | Accepted by the loader and the exporter. No shipped module uses it. |
| `instrument` | instrument name | none → the `audio.defaultInstrument` setting | See [Instruments](#instruments). |

::: warning The BaseNote has no duration
`duration` is not among the BaseNote's defaults, and none of the 79 shipped modules sets `baseNote.duration`. `base.d` compiles, but it reads an empty expression. Do not write one, and do not depend on it.
:::

## The `notes` array

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | integer | **yes** | `0 ≤ id ≤ 65535`. `0` is reserved for the BaseNote. Duplicates are rejected by the library validator. |
| `startTime` | expression string | in practice, yes | Seconds from time zero. |
| `duration` | expression string | no | Seconds. Absent = a measure bar. |
| `frequency` | expression string | no | Hz. Absent (with a `duration` present) = a silence. |
| `tempo` | expression string | no | Per-note override. |
| `beatsPerMeasure` | expression string | no | Per-note override — this is how measure bars carry a meter change. |
| `measureLength` | expression string | no | Per-note override. |
| `color` | CSS color string | no | e.g. `"rgba(242,167,27,0.7)"`. |
| `instrument` | instrument name | no | Inherited along the frequency chain when absent. |

The six **expression keys** are exactly `startTime`, `duration`, `frequency`, `tempo`, `beatsPerMeasure`, `measureLength`. The three **non-expression keys** are `id`, `color`, `instrument`. Anything else in a note object is ignored.

### Note kinds are inferred, not declared

There is no `type` field. What a note *is* follows from which expressions it has:

| Kind | Rule | Drawn as |
|---|---|---|
| **Note** | `startTime` + `duration` + `frequency` | A filled bar at its pitch |
| **Silence** | `startTime` + `duration`, **no** `frequency` | A dashed outline, no sound |
| **Measure bar** | `startTime`, **no** `duration`, **no** `frequency` | A vertical dashed line across the workspace |

A chain of measure bars, each starting one measure after the last, is a [measure chain](/reference/glossary#measure-chain):

```json
{ "id": 1, "startTime": "base.t" },
{ "id": 2, "startTime": "[1].t + measure([1])" },
{ "id": 3, "startTime": "[2].t + measure([2])" }
```

## Expression strings

Expressions are text. They are **compiled to bytecode**, never `eval`'d — nothing in the load path uses `eval()` or `new Function()`.

Two formats compile to the same bytecode and may be mixed freely in one file. The format is detected per expression string.

**DSL** — the primary format. Every shipped module uses it for its notes:

```
base.f * (3/2)          # a fifth above the base
[1].t + [1].d           # start when note 1 ends
[1].t + measure([1])    # one measure after note 1 starts
beat(base) * (3/4)      # a dotted eighth
2^(1/12)                # one 12-TET semitone
```

See the [expression syntax reference](/reference/expressions/syntax) for the full grammar.

<details>
<summary>Legacy JavaScript syntax</summary>

Method-chain expressions still load, and still round-trip verbatim:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.getNoteById(1).getVariable('startTime')
new Fraction(60).div(module.findTempo(module.baseNote))
```

</details>

### Format detection

A string is compiled as **DSL** when it contains `[N].` or `base.` anywhere, or **starts with** a fraction literal like `(3/2)` or a call to `tempo(`, `measure(`, `beat(`. It is compiled as **legacy** when it contains `new Fraction(`, `module.`, `.getVariable(`, or a `.mul(`/`.div(`/`.add(`/`.sub(`/`.pow(` chain.

Position matters for the helper calls only in the *first* routing pass: `beat(base) * 2` is sniffed as DSL directly, while `2 * beat(base)` has no leading marker and is routed to the legacy parser first. That is no longer fatal — when the legacy parser fails, the compiler retries the string as DSL, so `2 * beat(base)` still compiles. See [the beat unit](/reference/properties/tempo#the-beat-unit).

A string that is **pure arithmetic with no references** — `440`, `263`, `2 * 263`, `(1/2) * 263` — is routed to the **DSL** compiler directly.

::: warning An unparseable expression is rejected with an error
If neither compiler can read a string, `compile()` logs a `console.error` naming the expression and **throws** — there is no silent constant-0 fallback. In the note widget the message appears under the Save button; the syntax validators return `valid: false`; `npm test` rejects a shipped module containing one. On a file load the affected property is left **unset** rather than zeroed, so the note falls back to its defaults.
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

`instrument` is a plain name string. The nine built-ins:

| Name | Kind |
|---|---|
| `sine-wave` | Synth |
| `square-wave` | Synth |
| `sawtooth-wave` | Synth |
| `triangle-wave` | Synth |
| `organ` | Synth — additive harmonics |
| `vibraphone` | Synth |
| `fm-epiano` | Synth — FM electric piano (carrier + modulator) |
| `piano` | Multisampled (VSCO2 Community Edition, CC0) |
| `violin` | Multisampled (VSCO2 Community Edition, CC0) |

**Instrument inheritance follows the frequency chain.** When a note has no `instrument` of its own, the app reads its `frequency` expression, finds the note it references (`[N].f`, or `base.f`), and asks *that* note for its instrument — recursively. If nothing along the chain pins an instrument, the note falls back to the global **`audio.defaultInstrument`** setting (default `sine-wave`).

This is why most scale-system modules pin `"instrument": "sine-wave"` on their BaseNote: it fixes the timbre for the whole module instead of letting it follow the listener's default.

## What `Save Module` actually writes

**Save Module** (in the top-bar **+** menu) downloads a file named `module.json`, pretty-printed with 2-space indentation. Three things about that file surprise people:

1. **It is reindexed.** Measure bars are renumbered first (sorted by evaluated `startTime`), then the remaining notes (also by `startTime`), starting at id 1. Every `[N]` reference is rewritten to match. Ids in the saved file will generally differ from the ids you saw on screen. There is no byte-stable round trip.
2. **Expression source text is preserved verbatim.** Saving does **not** convert legacy expressions to DSL, and it does not convert DSL to legacy.
3. **The BaseNote gains a `measureLength`,** even if your source file omitted it. It is emitted in DSL form — the class default. Round-tripping the file above produces:

```json
"measureLength": "beat(base) * base.bpm"
```

A pure-DSL source file therefore round-trips as pure DSL.

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

The id ceiling exists because a reference is encoded as a 16-bit integer in the evaluator's bytecode. The loader rejects (and skips) any note whose id is above 65 535, so an id can never wrap to a different note.

Expression strings are additionally screened for dangerous-looking patterns (`eval(`, `Function(`, `fetch(`, `document.`, `window.`, `__proto__`, `<script`, `javascript:`, …) at the library-upload and Load-UI entry points. Malformed expressions of either syntax — DSL or a broken legacy method chain — are caught by the compiler itself, which throws instead of guessing (see above).

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

**79 modules in total.** `npm test` validates every one of them: structure, expression syntax, self-containment (every `[N]` reference resolves inside the same file), finite evaluation, and — for single-note interval modules — that the evaluated frequency really is `ratio × base` and that `cents` really is `1200·log2(ratio)`.

Self-containment is what makes a library module droppable: on import, its note id 0 is remapped onto the note you dropped it on, and its internal ids are renumbered above the current maximum.

A per-category `index.json` loader still exists as a fallback for the pre-v2 layout. The v2 manifest is authoritative.

## The other saved JSON: `ui-state.json`

**Save UI** (in the module bar's footer) downloads a different file — `ui-state.json`. It is the **library layout**, not a composition: sections and their labels, which icons sit where, which are collapsed, the `Drop at:` mode, and the full JSON of any module you *uploaded* (uploads have no re-fetchable path, so their data is embedded; built-ins are stored by file path).

Do not confuse the two. A `ui-state.json` will not load as a module, and a `module.json` will not load as a UI state.

## Where the app keeps things between sessions

| `localStorage` key | Contents |
|---|---|
| `rmt:moduleSnapshot:v1` | The current composition, in module-JSON shape. Written on every undoable edit, on tab-hide, and on unload. Loaded on boot instead of the default module. |
| `ui-state` | The library layout (the `Save UI` payload). |
| `rmt:settings:v1` | The [settings tree](/reference/settings-reference). |

There is no "unsaved changes" prompt and no named-project concept: the app always resumes the last state.

## See also

- [Expression Syntax](/reference/expressions/syntax) — the full grammar
- [Settings Reference](/reference/settings-reference) — every setting, including `audio.defaultInstrument`
- [Saving Modules](/user-guide/modules/saving-modules) · [Loading Modules](/user-guide/modules/loading-modules)
- [The Module Library](/user-guide/modules/module-library)
- [Glossary](/reference/glossary)
