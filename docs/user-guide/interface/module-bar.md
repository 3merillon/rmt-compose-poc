# Module bar

Pull the small tab below the top bar downward to see the library. Each coloured tile is a module. Click a section label to collapse or expand it. Use the magnifier to search by name, ratio, cents, family or tag. On narrow screens the hint shows an example query, `e.g. 3/2`. Clear the search to bring the other tiles back into view.

![The open library with its toolbar and sections of module tiles](/img/module-bar.png)

## Live tempo

The slider next to the magnifier shows the tempo in BPM. A fresh canon starts at 100. Press Play and move the slider to hear the same pitches at a different pace. Double-click the slider or the number to return to the written tempo. To keep a change, click the check mark **Commit tempo**. Committing 120 BPM writes `1/2` second into the BaseNote’s duration. The change is undoable and goes into the editable score and its MIDI export.

A live audition is temporary. Loading a score restores its written tempo. **Settings → Audio → Tempo range** sets the slider’s preferred span (default 20–300 BPM), within the playback-rate limits and including the written tempo.

## Place a phrase

The two buttons beside **Undo** and **Redo** show the drop position. **End** (⇥) adds an answer after the target, **Start** (⇤) layers the phrase at its onset. Fresh layouts use **End**. The filled button shows your saved choice. Dropping on the BaseNote circle uses the workspace origin in either mode. [Drop targets, timing and pitch](/user-guide/modules/loading-modules#where-you-can-drop)

Try the eight tiles under **Progressions** or open **Custom** for the complete canon, its leading bass and its theme. [Library catalogue](/user-guide/modules/module-library)

## Organise the library

| To… | Use… |
|---|---|
| Swap two tiles | Drag one onto the other |
| Move a tile into a section | Drag it onto the section’s dashed **+** |
| Add your own file | Click the dashed **+** and choose a module JSON |
| Keep a selected phrase | **Copy to Modules** in the [group widget](/user-guide/notes/selection) |
| Remove a tile | Its **×** and the confirmation |
| Change tile size or cents display | **Settings → Library** |

The footer has **Save UI**, **Load UI**, **Add Category** and **Reload Defaults**. Built-in tiles refer to library files. Uploaded and copied modules are embedded in the saved layout. [Save a library layout](/user-guide/modules/saving-modules)

## Adding a module to the shipped catalog

Contributors add a score file and a manifest entry in `public/modules/library.json`. Run `npm test` to check the complete library, then reopen the library in a fresh session and test the tile. [Module format](/user-guide/modules/module-format)
