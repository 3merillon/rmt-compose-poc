---
title: Keyboard Shortcuts
description: Every key and modifier RMT Compose responds to — two global shortcuts, four scoped Escapes, and the Shift and long-press gestures.
---

# Keyboard Shortcuts

RMT Compose is pointer-first. There are exactly **two global keyboard shortcuts**. Everything else on this page is either scoped to one panel, or is a modifier that changes what a click does.

## Global shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Z` / `Cmd + Z` | Undo |
| `Ctrl + Y` / `Cmd + Y` | Redo |

Both are ignored while the focus is in a text field, a textarea, or any editable element — so typing an expression into the note widget never triggers them.

::: warning
Redo is `Ctrl/Cmd + Y` only. **`Ctrl/Cmd + Shift + Z` is not redo** — the handler ignores Shift, so it undoes again. If you have the reflex from other apps, it will walk you backwards, not forwards.
:::

The module bar's toolbar carries the same pair as buttons (`Undo (Ctrl+Z)` / `Redo (Ctrl+Y)`), as does the "+" menu. All of them drive one shared history.

## Escape

`Escape` is not global. It does something only when the thing it closes is in front of you:

| Where | What Escape does |
|---|---|
| Focus inside the **Settings panel** | Closes the panel. But if the focus is in a text, number or select field, it **blurs the field** instead — press it twice to close the panel from there. |
| Focus inside the **group widget** | Clears the multi-note selection. The same as its **×** (*Clear selection*). |
| A **confirmation dialog** is open | Cancels it. (The Cancel button also holds focus when the dialog opens, so `Enter` cancels too.) |
| Focus in the **module-bar search field** | Closes the search field. |

There is no global "Escape to deselect". To clear a selection, click empty canvas or use the group widget's **×**.

## Modifiers and gestures

Shift is load-bearing in three places. On touch, a **long-press — 500 ms with the finger held still, within about 8 px** — is the stand-in for Shift.

| Mouse / trackpad | Touch | Result |
|---|---|---|
| **Shift + drag** on empty canvas | **Long-press** empty canvas, then drag | Marquee-select notes |
| **Shift + click** a note | **Long-press** a note | Toggle it in or out of the multi-selection |
| **Shift + click** the Play button | **Long-press** the Play button | Toggle [loop playback](/user-guide/interface/top-bar#loop-playback) |
| `Ctrl`/`Cmd` **+ wheel** over the canvas | Two-finger pinch | Zoom the camera. The browser's page-zoom is suppressed app-wide, so `Ctrl` + wheel never resizes the page. Over the top bar or a panel it does nothing at all. |

The long-press is non-committal on purpose: moving more than about 8 px, putting a second finger down, or lifting early all cancel it, so panning, pinch-zoom and ordinary note drags are untouched.

See [Multi-Note Selection](/user-guide/notes/selection) for what you can do with a group once you have one.

## Native browser behaviour

These are not app shortcuts, but they are real and worth knowing:

- `Space` or `Enter` on a **focused button** clicks it, as on any web page. If the Play button happens to have focus, `Space` plays or pauses. There is no global `Space` binding — click elsewhere and it stops working.
- `Shift + Space` on a focused Play button does **not** toggle loop mode. The app deliberately rejects that one.

## Shortcuts that do not exist

Do not go looking for these — none of them are implemented:

`Space` (play/pause), `Escape` (global deselect), `Delete` / `Backspace` (delete a note), `Ctrl + S` (save), `Ctrl + O` (open), arrow keys, copy/paste, zoom shortcuts.

There is also **no double-click gesture** anywhere in the app, and **no right-click context menu**. Repeated single clicks on the same spot do [stack cycling](/user-guide/interface/workspace#overlapping-notes-click-again), which is a different thing.

## History

| | |
|---|---|
| **Depth** | Up to 50 states — fewer for a very large module, because retained snapshots are also capped at 12 MB in total. |
| **Tracked** | Note creation, deletion, moves, resizes, transposes, expression edits, group moves and deletes, module loads, Reset Default Module. |
| **Not tracked** | Camera (pan/zoom), playback position, the lock, playhead tracking, loop mode, and the **module library**. |

The redo stack is cleared as soon as you make a new change after undoing.

::: warning
The undo/redo buttons in the module bar's toolbar drive the **note** history, not the library's. They will not restore a category you deleted from the library, or undo a module you dragged into it.
:::

History lives in memory. It is gone when you close the tab — the module itself is restored from browser storage, but its history is not.

## Next

- [Multi-Note Selection](/user-guide/notes/selection) — what the Shift gestures are for
- [Mobile](/user-guide/interface/mobile) — the long-press gesture set in context
- [Top Bar](/user-guide/interface/top-bar) — the buttons behind Undo, Redo and loop playback
