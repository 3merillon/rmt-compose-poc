---
title: Transport Controls
description: Play, pause, stop, seek and loop a module in RMT Compose, including the hidden loop-playback gesture on the Play button.
---

# Transport Controls

The transport sits at the left of the top bar: **Play/Pause**, **Stop**, and a **volume slider**, all icon-only. This page covers those three, plus the two controls you cannot see — seeking by clicking the workspace background, and the loop gesture hidden on the Play button.

![The RMT Compose top bar: Play, Stop and the volume slider on the left; Reset View, the playhead-tracking toggle, the settings gear and the main menu on the right](/img/top-bar.png)

| Control | What it does |
|---|---|
| Play / Pause | Starts playback from the playhead, or pauses it |
| Stop | Silences everything and sends the playhead back to 0 |
| Volume | Master output level, 0–100% |

The controls on the right of the bar — Reset View, the [playhead-tracking toggle](/user-guide/playback/tracking), the settings gear — are covered elsewhere.

## Play and pause

Click **Play**. Playback starts from wherever the playhead is, about 100 ms after the click. If the playhead is parked at the end of the module, Play starts over from 0.

Click again to **pause**. Sounding notes fade out over 200 ms and the playhead freezes. Click Play once more to resume from that position.

When the playhead reaches the end of the module, playback stops on its own. The playhead is left at the end, not rewound — so the next Play starts the module over from the beginning.

The play icon has three states:

| Icon | Meaning |
|---|---|
| Triangle in the accent colour (orange in the default theme) | Stopped or paused |
| Red pause bars | Playing |
| Red dashes orbiting a figure-8 | Loop mode armed — while playing *or* while parked after a seek (see below) |

## Stop

**Stop** silences every voice, resets the playhead to 0, and leaves loop mode. Notes cut mid-sustain are faded out over 20 ms, so stopping never clicks.

Reverb tails are not cut short by Stop — the reverb ring-out is what you hear decaying afterwards.

## Move the playhead

**Click an empty part of the workspace background.** The playhead jumps to that point in time, clamped to the module. This is the only way to start from the middle of a piece: seek, then press Play.

Seeking while the module is playing **stops playback**. It does not continue from the new position — you have to press Play again.

## Loop playback

RMT Compose can play a module end to end, forever, with no gap at the seam. It is not on a button of its own — it is a gesture on the Play button.

| Gesture | Works on |
|---|---|
| **Shift + click** Play | Mouse and trackpad |
| **Press and hold** Play for half a second, without moving more than a few pixels | Mouse, trackpad, and touch — the only way in on a phone or tablet |

The same gesture again turns it off.

When you arm it:

- The three bars of the play icon shrink into dashes and start orbiting a figure-8.
- The button's tooltip becomes `Loop playback — shift-click or long-press to exit`.
- If the transport was stopped or paused, **playback also starts**, from the playhead.
- If it was already playing, the loop is armed **without restarting the audio** — the pass in flight no longer stops at the end.

There is no gap and no re-trigger at the wrap: nothing is torn down and rebuilt when the module repeats. A note's release tail and its reverb tail ring on across the boundary exactly as they would in the middle of the piece.

When you disarm it with the same gesture, the icon changes back immediately, but the audio **finishes the pass it is playing** and stops at the end of the module. It does not cut out mid-pass.

### Getting out of loop mode

| Action | Effect |
|---|---|
| The gesture again (shift-click / long-press) | Current pass plays out, then stops |
| **Stop** | Immediate. Audio cut, playhead to 0, mode off |
| **Pause** | **Leaves the mode.** Pressing Play afterwards resumes ordinary one-pass playback |
| Any edit that pauses playback (note edits, undo, arrows, delete) | Same as Pause — the mode is dropped |
| Reloading the page | Gone. Loop mode is never saved |

Engaging an endless loop is always deliberate: you re-arm it with the gesture, every time.

::: warning Seeking while looping keeps the mode armed
If you click the background to seek while a loop is running, playback stops — but the mode stays **armed**, and the icon says so: the dashes keep orbiting while the transport is parked. The next Play loops again, from the new position. Press Stop if you want a clean exit.
:::

### When loop refuses

Loop does not engage — the transport plays the module once and stops — if the module is empty, contains only measure bars (nothing with a frequency), or is shorter than 50 ms. The mode disarms with it: the icon drops back to the plain play triangle instead of orbiting over playback that will not actually loop.

::: tip
In a browser without CSS motion-path support, loop playback still runs, but the icon looks the same as normal playback. If you have "reduce motion" turned on in your OS, the three dashes sit parked around the figure-8 instead of orbiting.
:::

## Volume

The slider is the **master output level**, from 0 to 100%. It defaults to **100%**, and the value you leave it at is remembered across reloads.

- Moving it applies the change live, whether or not anything is playing (a 50 ms ramp, so there is no zipper noise).
- It is the same value as **Settings → Audio → Master volume**. Drag either one and the other follows. See [Audio & Reverb](/user-guide/playback/audio).

If a module is too loud, this is the knob. The limiter downstream catches peaks, but it is not a volume control.

## Editing pauses playback for you

You do not have to stop before editing. Creating a note, editing a variable, deleting notes, transposing with the arrows, and undo/redo all pause playback automatically.

Note that a pause **drops loop mode** — so an edit made mid-loop ends the loop.

## Keyboard

There are **no keyboard shortcuts for the transport**. `Space` does not play, `Escape` does not stop. The only global shortcuts in the app are `Ctrl/Cmd + Z` (undo) and `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` (redo) — see [Keyboard Shortcuts](/user-guide/interface/keyboard-shortcuts).

The one keyboard-ish transport interaction is **Shift**+click on Play, which arms loop playback.

## How playback is scheduled

Notes are not all created when you press Play. A scheduler builds Web Audio voices about **2 seconds ahead** of the playhead, in batches every **100 ms**, and keeps doing so until the module ends (or forever, when looping). Large modules therefore start immediately rather than freezing the tab while everything is built.

The lookahead is why turning **stereo width** on *during* playback reaches your ears with a short delay rather than instantly: notes already scheduled keep the placement they were built with, and only the next batch picks the change up.

**Default instrument** is different: it is resolved once per note when playback is *prepared*, so changing it mid-playback has no effect at all on the pass in flight. Press Stop, then Play. See [Instruments](/user-guide/playback/instruments).

## Troubleshooting

### No sound

1. Check the volume slider is not at zero, and check your system volume.
2. On iOS and Android, audio unlocks when you first press Play. If you got there some other way and heard nothing, press Play once.
3. Make sure your notes have frequencies. A module of nothing but measure bars is silent by design.
4. Open Settings → Audio and confirm Master volume is above 0.

### Choppy playback

Close other tabs and check CPU load. Very dense modules with many simultaneous notes are the usual cause.

### Latency

Web Audio has inherent output latency, and RMT Compose adds ~100 ms of head-room before the first note. It is not built for live performance timing.

## See also

- [Playhead Tracking](/user-guide/playback/tracking) — keep the playhead centred while you listen
- [Audio & Reverb](/user-guide/playback/audio) — the reverb, stereo width and limiter behind the volume slider
- [Instruments](/user-guide/playback/instruments) — what each note actually plays through
