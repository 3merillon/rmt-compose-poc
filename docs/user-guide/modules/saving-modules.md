# Save, undo and reopen a composition

## Save the composition

Choose **+ → Save Module**. Rename the downloaded `module.json` so you can find this version again. To reopen it, choose **+ → Load Module ▾ → Load Module from file…**. The file holds the BaseNote, note expressions, bar markers and score interpretation, including written instruments. You can reopen the relationships and keep editing.

Export renumbers the bars first and then the remaining entries by start time. It updates the references in the file. A note you remember by number in the live workspace may have a different number after reopening the download. **Reorder Module** makes this change in the live score. [File format](/reference/module-schema)

## Undo and redo

Use **Undo** and **Redo** in the module bar or the **+** menu. On a keyboard use **Ctrl/Cmd+Z** to undo and **Ctrl/Cmd+Shift+Z** or **Ctrl/Cmd+Y** to redo. Click out of a text field first. One group move or one group **Apply** is one edit. Making a new edit after Undo starts a new history from that point.

The app keeps undo history in memory for this session, up to 50 states subject to a memory budget. Download a file for a version you want to keep after a reload. Browser preferences such as the theme have their own reset controls. [History implementation and measurements](/developer/performance#history)

## Autosave

The app writes the current score to IndexedDB after an undoable edit and attempts a write when the page is hidden or left. On the next visit to the same browser profile and origin, the saved session opens. Undoing an edit also updates that saved session. If browser storage is unavailable or full, the download is your recoverable copy.

To return to the shipped score, use [Reset Default Module](/user-guide/modules/loading-modules#reset-default-module). To keep several pieces or move between the Wi-Fi app and the hosted app, use named file copies.

## Save a library or a performance

| Choose | What you keep | How you use it |
|---|---|---|
| **Copy to Modules** in a group widget | A reusable phrase under **Custom** | [Drop the tile back into the score](/user-guide/notes/selection) |
| **Save UI** in the library footer | `ui-state.json` with the sections, tile positions, drop mode and embedded uploaded/copied modules | **Load UI** restores the library layout |
| **Export MIDI** in the **+** menu | `module.mid` with timed notes, velocities and pitch bends | [Play the performance in a DAW](/user-guide/modules/exporting-midi) |

The browser remembers library changes separately from the score. **Reload Defaults** rebuilds the library and removes custom tiles. Use **Save UI** before resetting a layout you want to keep.
