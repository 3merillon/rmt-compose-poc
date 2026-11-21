# Read a module file

A module JSON holds the musical relationships you can reopen and edit. **+ → Save Module** downloads the current score. To see the format in a small example, open the shipped **Intervals → 3/2** file in a text editor. It contains a BaseNote and one sounding note. [Complete example and field reference](/reference/module-schema#a-real-module-file)

The BaseNote in that file sets its frequency to 263 Hz, its start to zero and its duration to one second. The sounding note begins at `base.t`, lasts `base.d` and takes its frequency from `(3/2) * base.f`. Played on its own, that is 394.5 Hz for one second. Drop the tile onto another note and it makes a fifth above that target in the receiving score’s time unit. [Dropping modules](/user-guide/interface/module-bar)

## Read a larger score

Each row in `notes` carries an ID. A different note can name that ID in an expression such as `[83].f`. Follow each property separately. One note can take its pitch from a note that sounds later and its timing from an earlier one. Find the later note’s ID in its widget, then use that ID in the earlier note’s **Frequency → Raw** field and press **Save**. The [bar-five example](/tutorials/workflows/canon-and-cadences#follow-the-exception-in-bar-5) lets you hear this exact edit.

Start, duration and frequency together describe a sounding note. A rest has a start and duration. A bar adds the measure flag. Pitch references and timed key changes have a frequency and leave duration open. Use [note kinds](/reference/module-schema#note-kinds) for the complete rules. Keep IDs unique and use the IDs in the file you are reading. Export can renumber the score while preserving its links. [Saving modules](/user-guide/modules/saving-modules)

## Instruments

A note can name an instrument or inherit one along its rhythmic line. When a file predates that rule, the loader pins an instrument where needed to preserve its earlier sound. The next save includes `"instrumentRule": "start-time"`. [Instrument assignment](/reference/module-schema#instruments)

## Modules from earlier versions

Earlier versions stored a tempo and a number of beats per measure on the BaseNote, wrote durations with `beat(base)`, and wrote measure bars as notes with only a start time. On load, the app translates supported timing relationships into exact durations and marks the old measure rows as bars.

| Old | New |
|---|---|
| `beat(base)` or a beat on a note inheriting the BaseNote tempo | `base.d` |
| `beat([N])` on a note with its own constant tempo | `base.d` scaled by the old base tempo divided by the note’s tempo. At base tempo 100 and note tempo 150, the beat becomes `(2/3) * base.d`. |
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

It runs the app’s timing and expression-syntax converters. It preserves line endings, leaves compact files compact, and writes multiline files with two-space indentation. Already-converted files are left alone. The library in `public/modules/` is already converted.

::: warning Keeping an older-format copy
The conversion goes one way. A module saved from this version carries `duration` on the BaseNote and `"measure": true` on its bars, and earlier editors using the tempo/meter format cannot read those fields. Keep a copy of any file you still need there.
:::

If a saved session cannot be loaded at startup, the app keeps it beside the autosave (IndexedDB `rmt-compose`, store `autosave`, key `unloadable`) and opens the default module.

[Field names and import limits](/reference/module-schema) · [Expression syntax](/reference/expressions/syntax) · [Creating modules](/user-guide/modules/creating-modules)
