# Open a score or add a phrase

## Reset Default Module

To hear the eight-bar canon from a saved session, choose **+ → Save Module** if you want a file copy of your work. Then open **+ → Load Module ▾ → Reset Default Module** and confirm **Yes, Reset**. Press **Play**. Undo brings back the previous score during this session. **Reload Defaults** in the library footer affects the library layout.

The startup score opens at 263 Hz and 100 BPM. Its note numbers match the [first composition tutorial](/getting-started/first-composition). A full canon and two individual parts also appear under **Custom**. Library files have their own note numbers. [Read the canon and its cadences](/tutorials/workflows/canon-and-cadences)

## Load a module from a file

Choose **+ → Load Module ▾ → Load Module from file…** and select your score JSON. This replaces the workspace and creates an undo step. The loader converts supported older expressions and the older tempo and measure representation. Keep the original if you also work in an older editor. [Module format and compatibility](/user-guide/modules/module-format#modules-from-earlier-versions)

## Drop a library module onto a note

Pull down the module bar, find a tile by name and drag it onto the score. This adds a copy and gives its notes new IDs. Internal references point to the new notes. To play an isolated example, start with a clean score and drop the tile on the BaseNote circle. To play a phrase in a new key, drop it onto a pitched note.

### Where you can drop

| Target | Pitch and placement |
|---|---|
| Pitched note | `base.f` follows the target pitch. An entrance at `base.t` follows the target’s end in **End** mode or its onset in **Start** mode. Explicit `base.a`, `base.attack` and `base.release` references follow the target too. |
| Measure | `base.t` in an entrance follows the bar’s end or start. Pitch and interpretation references to the BaseNote stay with the workspace BaseNote. |
| BaseNote circle | Both modes preserve the module’s `base.*` references to the workspace BaseNote. |
| Rest or empty background | The app rejects the drop. Choose a note, a measure or the BaseNote. |

**Time unit.** `base.d` stays the workspace time unit for every target. A phrase written in eight eighth notes keeps that rhythm when dropped on a short note or a long bar. Expressions explicitly reading another imported note’s `.d` still follow that note.

**Mode.** The two arrow-and-bar buttons beside Undo set **Drop modules at note end** (⇥) or **Drop modules at note start** (⇤). The filled button shows the active choice. New layouts start at **End**. Saved layouts restore their choice. Select **Start** to layer a harmony under an existing entrance.

## Add a module to the library

Press the dashed **+** tile at the end of a library section and pick a module JSON. The file becomes a tile in that section. You can also [copy a selection](/user-guide/notes/selection) from the workspace. **Save UI** exports a layout containing your custom modules. [Saving modules](/user-guide/modules/saving-modules)

## Import limits

A module may contain up to 500,000 entries in its `notes` array. **Load Module from file…** also checks the file size (120 MiB). Keep `baseNote` as an object and `notes` as an array. Library uploads validate expressions and report invalid data. Browser storage and device capacity affect how large a score can be saved and played. [Supported limits and measurements](/developer/performance#limits)
