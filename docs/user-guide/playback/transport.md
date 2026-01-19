# Transport Controls

Learn how to control playback in RMT Compose.

## Overview

The transport controls are located in the **top bar** on the left side:

| Control | Icon | Function |
|---------|------|----------|
| Play/Pause | ▶ / ⏸ | Start or pause playback |
| Stop | ■ | Stop and reset to beginning |
| Volume | Slider | Adjust playback volume |

## Play/Pause

### Starting Playback

Click the **Play** button (▶) to start playback:
- Notes play in order by start time
- The playhead moves across the workspace
- Audio outputs through your speakers/headphones

### Pausing

Click the **Pause** button (⏸) while playing:
- Playback pauses at the current position
- The playhead stops moving
- Audio fades out gracefully

### Resuming

Click **Play** again after pausing:
- Playback continues from the paused position
- Audio fades back in

## Stop

Click the **Stop** button (■):
- Playback stops immediately
- The playhead resets to the beginning (time = 0)
- All playing notes are silenced

## Volume Control

The volume slider adjusts the output level:

| Position | Level |
|----------|-------|
| Left | 0% (muted) |
| Middle | 50% |
| Right | 100% (full) |

**Default**: 20% (0.2)

::: tip
Start with a lower volume when exploring unfamiliar modules - some can be surprisingly loud!
:::

### Real-Time Adjustment

Volume changes take effect immediately:
- Adjust during playback to find the right level
- No need to stop and restart

## Playhead

The **playhead** is a vertical line showing the current playback position:

- Moves left-to-right during playback
- Shows which notes are currently playing
- Resets to the beginning when you click Stop

### Playhead Tracking

Enable **tracking mode** to keep the playhead centered:
- The workspace scrolls automatically
- Useful for long compositions
- See [Playhead Tracking](./tracking) for details

## Audio Processing

RMT Compose uses the Web Audio API for playback:

### Audio Graph

```
Oscillators → Note Gains → Master Gain → Compressor → Output
```

- **Oscillators**: Generate the sound for each note
- **Note Gains**: Individual note volume (for envelopes)
- **Master Gain**: Overall volume control
- **Compressor**: Prevents clipping on loud passages

### Streaming Scheduler

Notes are scheduled in batches:
- **Lookahead**: 2 seconds ahead
- **Batch interval**: 100ms
- This prevents audio glitches on large compositions

## Keyboard Shortcuts

Currently, there are no keyboard shortcuts for transport controls.

Planned for future versions:
- `Space`: Play/Pause
- `Escape`: Stop

## Troubleshooting

### No Sound

1. Check browser audio permissions
2. Verify volume slider is not at minimum
3. Check system volume
4. Ensure notes have valid frequency expressions
5. Try a different browser

### Choppy Playback

1. Close other browser tabs
2. Check CPU usage
3. Reduce the number of simultaneous notes
4. Try a different browser

### Audio Delayed

1. Web Audio has inherent latency (~20-100ms)
2. This is normal for browser-based audio
3. Not suitable for real-time performance

## Tips

1. **Use the volume slider** - Find a comfortable level before exploring
2. **Watch the playhead** - See which notes are playing
3. **Enable tracking** - For compositions longer than one screen
4. **Stop before editing** - Avoid confusion during playback
