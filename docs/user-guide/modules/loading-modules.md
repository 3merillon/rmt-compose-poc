---
title: Loading Modules
description: Load a module file into the workspace, drop a library module onto a note, or upload one into the module library — and what the app rejects on the way in.
---

# Loading Modules

There are three different ways a module gets into RMT Compose, and they do three different things.

| What you do | What happens |
|---|---|
| **+ menu → Load Module from file…** | The **entire workspace is replaced** by the file. |
| **Drag a library icon onto a note** | The module is **grafted into** your composition, re-anchored to that note. |
| **Module bar → the `+` tile** | The file is **added to the library** as an icon. The workspace is untouched. |

## Load a module from a file

This replaces everything.

1. Open the **+** menu (the plus/minus button at the right of the top bar).
2. Click **Load Module ▾**.
3. Click **Load Module from file…** and pick a `.json`.
4. The workspace is replaced. A toast confirms: `Module loaded successfully`.

::: tip Loading is undoable
The load is pushed onto the history stack as **Load Module**. `Ctrl/Cmd + Z` brings your previous composition back — from the keyboard, from **Undo** in the **+** menu, or from the **Undo** button in the module bar's toolbar.
:::

### Reset Default Module

The other entry in that dropdown restores the composition the app ships with.

1. **+ menu → Load Module ▾ → Reset Default Module**.
2. Confirm: *"This will reset the workspace to the default module. This action can be undone/redone via History. Proceed?"* → **Yes, Reset**.
3. Toast: `Default module reset`. Undoable, like any other load.

The default module is `public/modules/defaultModule.json`: 169 entries at 263 Hz and 100 BPM, including a chain of measure bars and a handful of silences. It is not part of the module library and does not appear in the module bar.

## Drop a library module onto a note

![The module bar, showing sections of procedurally drawn module tiles that can be dragged into the workspace](/img/module-library-icons.png)

Open the module bar (drag the pull tab hanging below it), then drag a tile out of the bar and drop it **on a note**. The module's notes are added to your composition with their internal relationships intact, re-anchored to whatever you dropped them on — every `base.f` in the module becomes `[target].f`, every `base.t` becomes `[target].t`, and its internal ids are renumbered so they do not collide with yours.

That is the whole idea: drop the **Perfect 5th** interval on note 7 and you get a fifth above note 7, not a fifth above A440.

### Where you can drop

| Target | Result |
|---|---|
| **A note** | Imported. Start time, duration and frequency all re-anchor to that note. |
| **The BaseNote** | Imported. Expressions keep their `base.*` anchors. |
| **A measure bar** | Imported. `startTime` anchors to the measure bar, but `frequency` stays anchored to `base.f` — a measure bar has no pitch to inherit. |
| **A silence** | **Rejected.** `Cannot drop onto a silence. Drop on a note or the BaseNote instead.` |
| **Empty background** | **Rejected.** `Drop onto a note or the BaseNote circle to import a module.` |

There is no fallback: dropping on empty space does not import the module at the BaseNote or at your selection. It does nothing but show the error.

### Drop at: Start / End

At the bottom of the module bar, above the action buttons, is a **`Drop at:`** toggle with two options, **Start** and **End**. The default is **Start**, and the choice is remembered across sessions.

| Mode | Where the module lands |
|---|---|
| **Start** | Aligned with the target note's **start**. |
| **End** | Aligned with the target note's **end** — the target's duration is added to the imported start times. |

::: warning End mode is ignored on the BaseNote
The End adjustment only applies when the target is a real note. Drop a module on the BaseNote and it lands at the BaseNote's start time regardless of the toggle.
:::

### Other things a drop does

- If playback is running, importing **pauses it** first.
- The import is captured in history as **Import Module at &lt;id&gt;**, so `Ctrl/Cmd + Z` undoes it.

See [Module Bar](/user-guide/interface/module-bar) for dragging, reordering and organizing the library itself.

## Find a module in the library

The library ships 79 modules across six sections — Intervals (46), Chords (11), Progressions (8), Melodies (7), Scale Systems (6) and Custom (1). Scrolling for one is slow.

Click the **magnifier** at the left of the module bar's toolbar. A search field unfolds; type into it and the library filters live. A module matches if your text appears in its **name**, **ratio**, **family**, **cents**, **tags**, or its file path — so `3-limit`, `701`, `fifth` and `3/2` all find the Perfect 5th.

The match is a plain substring test against those fields as they are written in the manifest, so it is literal: the Perfect 5th's cents are `701.955`, and searching `702` finds nothing.

Matches are revealed even inside collapsed sections. Closing the field (click the magnifier again, or press **Escape**) clears the query.

## Add a module to the library

Uploading a file puts an icon in the module bar without touching your composition.

1. Open the module bar.
2. Click the dashed **`+`** tile at the end of the section you want it in.
3. Pick a `.json`.
4. Toast: `Module "<name>" uploaded successfully`. The icon takes the file's name.

Uploads are stored **inside the library layout in your browser** (the `ui-state` localStorage entry, which carries the full module JSON for anything with no file path on disk). They survive a reload, and they come back with **Load UI** if you exported the layout. They are not written to the repo.

An upload is validated before it is accepted — see below. On failure you get `Invalid module: <errors>` or `Invalid JSON file: <message>`, and no icon appears.

## What the app rejects

::: info Expressions are not executed as code
Expression strings are compiled to **bytecode** and run on a stack machine. Nothing in the load path uses `eval()` or `new Function()`, so a module file cannot run JavaScript in your browser. Load modules from sources you trust anyway — a module can still be musically hostile, and nothing stops it from being 10 000 notes of noise.
:::

Loading a module from a **file** enforces:

| Condition | Toast |
|---|---|
| File larger than **3 MB** | `Module file too large (max 3MB)` |
| Not an object, or no `baseNote` object, or `notes` is not an array, or more than **10 000** notes, or JSON nested deeper than **20** levels | `Invalid module file structure` |
| The module passes those checks but fails to build (for example, it has no `notes` key at all) | A red banner: `Error loading module: <message>` |
| **The file is not valid JSON** | A red toast: `Error loading module: <message>` |

**Library uploads**, **Load UI** imports and **Copy to Modules** run a *different*, stricter check — not an additional one. It does not enforce the 3 MB cap or the nesting limit, but it does what the file path never does: every expression string is screened for dangerous-looking patterns and must compile, note ids must be unique and within `0 … 65535`, and every `color` must be on the colour whitelist. For an entry-point-by-entry-point table of who checks what, see [Module Format](/user-guide/modules/module-format#what-is-checked-and-where).

::: warning Loading a file does not check its expressions
The **Load Module from file…** path checks size and shape only. A malformed expression does not stop the load: the compiler refuses it with a `console.error` and the affected property is left **unset**, so the note falls back to its defaults rather than loading at a silent zero. Likewise, a reference to a note that does not exist (`[99].f`) and a dependency cycle both load without an error message. If a load "succeeded" but the result looks wrong, open the browser console.
:::

## Troubleshooting

### The module would not load

- **`Module file too large (max 3MB)`** — the hard cap. Split the module.
- **`Invalid module file structure`** — most often a missing `baseNote` object or a `notes` key that is not an array. Note that a file with *no* `notes` key passes this check and then fails in the loader with a red `Error loading module: data.notes is not iterable` banner. Always include `notes`.
- **`Invalid module: …`** on an upload — the expression or color validator rejected something. The toast names the first three problems; the full list is in the browser console.

### `Error loading module: …` in red

The file could not be read or parsed — a trailing comma, a smart quote, a truncated download. The toast carries the parser's message; validate the file in an editor.

### Notes are missing or in the wrong place

Open the browser console. The failures that do not surface in the UI all log there:

- `Failed to compile expression: …` — the expression was refused; the property was left unset and the note fell back to its default.
- `Dependency cycle detected! Some notes could not be evaluated.` — an A→B→A reference chain.
- `[RMT Security] Invalid note ID: … (must be 0-65535), skipping` — an id outside `0 … 65535`, or not an integer.

A reference to a note that does not exist does not warn at all; it silently resolves to a default (440 Hz, 0 s, 1 s).

### No sound when playing

- Browsers will not start audio without a user gesture. If nothing plays on the very first click, click **Play** again.
- Check the notes actually have a `frequency`. A note with `startTime` and `duration` but no `frequency` is a **silence**, by design.
- A note with no `duration` and no `frequency` is a **measure bar**, not a note.

## See also

- [Saving Modules](/user-guide/modules/saving-modules) — export, Save UI, and getting your work into the library
- [Module Format](/user-guide/modules/module-format) — what is actually in the file
- [Module Bar](/user-guide/interface/module-bar) — organizing the library
- [The Module Library](/user-guide/modules/module-library) — what the 79 shipped modules are and how they are built
- [Creating Modules](/user-guide/modules/creating-modules) — designing a module that drops well
