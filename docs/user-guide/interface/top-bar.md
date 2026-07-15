---
title: Top Bar
description: The RMT Compose top bar — play, stop, volume, reset view, playhead tracking, the settings gear, and the "+" main menu.
---

# Top Bar

The top bar is where you start and stop playback, control the camera, and reach the Settings panel and the main menu. Transport controls sit on the left, view and menu controls on the right.

![The RMT Compose top bar: play, stop and a volume slider on the left; reset-view, the playhead-tracking toggle, a settings gear and a "+" menu button on the right](/img/top-bar.png)

## Layout

Left to right:

| Control | What it does |
|---|---|
| **Play / Pause** | Start or pause playback. Shift-click or long-press for loop playback. |
| **Stop** | Stop playback, return the playhead to the start, and disarm loop mode. |
| **Volume** | Master volume, silent to full. |
| **Reset View** | Recentre the camera on the BaseNote, keeping the zoom. |
| **Playhead Tracking** | Toggle. Locks the camera's horizontal axis and keeps the playhead centred. |
| **Settings** (gear) | Open or close the Settings panel. |
| **"+"** | Open or close the main menu. |

::: info Two controls that are not up here
The **lock** is a floating padlock at the **bottom-right** of the viewport — see [Locking](/user-guide/interface/workspace#locking). The **scale controls** are the small dot at the **bottom-left** — see [Scale controls](/user-guide/interface/workspace#scale-controls-density).
:::

## Transport

### Play / Pause

One button, four states:

| Icon | State |
|---|---|
| Play triangle | Stopped or paused. |
| Red pause bars | Playing. |
| Red dashes orbiting a figure-8 | Playing on a **loop**. |
| Red dashes orbiting while stopped | Loop is **armed** for the next play — this is what a seek during a loop leaves behind. |

Playback starts from wherever the playhead is. Click empty canvas to move the playhead first.

#### Loop playback

**Shift-click** the Play button, or **long-press** it (hold for 500 ms without moving), to toggle loop playback. The button's tooltip changes to `Loop playback — shift-click or long-press to exit` while it is armed.

- Arming loop from a stopped or paused transport also **starts playback** — the gesture means "play this on a loop".
- Disarming flips the icon back straight away, but the audio **plays the current pass out to its end** and stops there rather than cutting off.
- Pausing a loop **disarms it** — that is why the button shows the ordinary play triangle. The next play is a single pass; re-arm with the gesture if you want the loop back.
- **Stop** disarms the loop outright too — it is the escape hatch out of the mode.
- Loop mode is not saved. It is gone on reload.

### Stop

Halts playback, resets the playhead to the beginning, and disarms loop mode.

### Volume

A slider from silent to full. It applies while you drag and is **saved** when you release.

It is the same number as **Settings → Audio → Master volume**, which shows it as a percentage — silence is 0%, full is 100%. Move either one and the other follows.

The signal runs through a real audio graph with a **limiter enabled by default**, and **reverb enabled by default**. See [Audio and Effects](/user-guide/playback/audio).

## View controls

### Reset View

Recentres the camera on the BaseNote. Zoom is untouched — this is a pan, not a zoom reset. Use it when panning has left you looking at empty space.

While **Playhead Tracking** is on, this button is greyed out and its tooltip reads `Reset disabled while tracking`.

### Playhead Tracking

Off by default, and never saved — it is off again after a reload.

When on, the camera locks its horizontal axis: the playhead stays pinned to the centre of the viewport and the music scrolls past it. You cannot pan sideways while tracking is on, and zooming re-centres on the middle of the viewport instead of the pointer. Vertical panning still works.

See [Playhead Tracking](/user-guide/playback/tracking).

## Settings

The **gear** opens the Settings panel. It is the only way in — there is no "Settings…" entry in the menu.

The gear rotates on hover and turns red while the panel is open. The panel is **floating, draggable by its header, and not modal**: leave it open and keep composing. It has five tabs — **Appearance, Arrows, Audio, Library, Scale** — and every change takes effect immediately; there is no OK or Apply button.

Press `Escape` with focus inside the panel to close it. See [Settings](/user-guide/interface/settings).

## The "+" menu

The **"+"** button opens the main menu. Its two bars rotate together into a single red **minus** while the menu is open. (There is no hamburger icon anywhere in the app.)

| Entry | What it does |
|---|---|
| **Undo** | Undo the last change. Disabled when there is nothing to undo. |
| **Redo** | Redo the last undone change. |
| **Reorder Module** | Reindex the notes by start time. Asks for confirmation first: *"Reorder the current module? This will reindex notes. Proceed?"* |
| **Save Module** | Download the current module as `module.json`. |
| **Load Module ▾** | Open a submenu. |
| ↳ **Load Module from file…** | Pick a `.json` module from disk. |
| ↳ **Reset Default Module** | Load the built-in default module. Asks for confirmation; the reset can be undone from history. |

::: warning
Loading a module **replaces** the workspace. Save first if you want to keep what you have.
:::

Undo and redo are also on `Ctrl/Cmd + Z` and `Ctrl/Cmd + Y`, and there is a second pair of undo/redo buttons in the [module bar](/user-guide/interface/module-bar) toolbar. All of them drive the same history.

### Footer

At the bottom of the menu:

| Link | Goes to |
|---|---|
| **Documentation** | `docs.rmt.world` |
| **Donate** | Stripe |
| **License (MIT)** | The licence page, which also lists third-party notices |

Plus the copyright line, `© 2026 Cyril Monkewitz`.

## Panels stack, they do not fight

The "+" menu, the [note widget](/user-guide/interface/variable-widget), the group widget and the Settings panel are peers in one z-order stack, and **whichever one you last opened or touched comes to the front**. Clicking one of them never closes another, and never clears your note selection.

The note widget and the group widget are the one exception: they are two presentations of the same selection, so growing it to two or more notes swaps the note widget for the group widget, and shrinking it back to one swaps them the other way.

Clicking anywhere else — the canvas, the bars — closes the "+" menu.

## Tips

1. `Ctrl/Cmd + Z` is faster than opening the menu.
2. The current module is kept in browser storage and comes back when you reload — but a file saved with **Save Module** is the only copy that survives clearing your browser data.
3. Turn tracking on before playing a long piece.
4. Lock the canvas before you demo — the padlock is at the bottom-right, not up here. See [Locking](/user-guide/interface/workspace#locking).

## Next

- [Settings](/user-guide/interface/settings) — the five tabs behind the gear
- [Transport Controls](/user-guide/playback/transport) — playback in full
- [Workspace](/user-guide/interface/workspace) — the canvas everything else acts on
