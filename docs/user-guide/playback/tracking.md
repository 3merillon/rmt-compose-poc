---
title: Playhead Tracking
description: Keep the playhead centred while a module plays, and understand what tracking does to panning, zooming and Reset View.
---

# Playhead Tracking

**Playhead tracking** pins the playhead to the horizontal centre of the workspace. Instead of the playhead travelling across a fixed view, the view travels under a fixed playhead.

## Turning it on

The toggle is in the **right-hand group of the top bar**, between **Reset View** and the settings gear — not next to the transport, which is on the left.

![The top bar: transport on the left; Reset View, the playhead-tracking toggle and the settings gear on the right](/img/top-bar.png)

Click it and the workspace **immediately** recentres on the playhead, whether or not anything is playing. It is not a playback-only mode.

It starts **off** every session. Tracking is never saved — a reload comes back with it off, even though your scale, theme and volume are restored.

## What changes while tracking is on

| | Tracking off | Tracking on |
|---|---|---|
| Horizontal pan | Free | **Locked** — at all times, playing or not |
| Vertical pan | Free | Free |
| Zoom | Anchored under the pointer / pinch centre | Anchored to the **horizontal centre of the view** |
| Reset View | Works | Disabled (dimmed, tooltip `Reset disabled while tracking`) |
| Changing the horizontal scale | Keeps the time under the screen centre fixed | Keeps the **playhead** centred |

Two of these surprise people:

**Horizontal panning is locked the whole time**, not only during playback. With tracking on and the transport stopped, dragging sideways does nothing. Vertical dragging still works, so you can still move through the frequency axis.

**Zoom stops following your cursor.** With the horizontal axis locked, zooming is anchored to the middle of the viewport instead of the point under the pointer, so the view cannot drift sideways out from under the playhead. On touch, pinch-zoom re-centres the same way and one-finger panning becomes vertical-only.

## Turning it off

Unchecking the toggle releases the lock and hands the view back to you. **Your previous view is not restored** — the workspace stays exactly where tracking left it. If you want to get back to the BaseNote, use Reset View, which becomes available again.

## Using it

Turn tracking on to listen through a piece that is wider than the screen, and off to stay parked on one section while you work. You can toggle it mid-playback, as often as you like, without stopping the audio.

Because the playhead is always centred, the right half of the screen is the near future: you see notes approach before you hear them.

See [Transport Controls](/user-guide/playback/transport) for playback itself, including how to move the playhead by clicking the workspace background.
