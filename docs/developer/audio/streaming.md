# Streaming Scheduler

The streaming scheduler enables efficient playback of compositions by scheduling notes just-in-time rather than all at once.

## Overview

Traditional approach (problematic):
```javascript
// Creates ALL oscillators upfront - blocks main thread, uses memory
for (note of allNotes) {
  createAndScheduleOscillator(note)
}
```

Streaming approach (used by RMT Compose):
```javascript
// Creates oscillators incrementally - responsive, memory efficient
scheduleLoop() {
  scheduleNotesWithinLookahead()
  if (moreNotesToSchedule) {
    setTimeout(scheduleLoop, INTERVAL)
  }
}
```

## Architecture

```
preparePlayback()
       ↓
  noteDataList (lightweight)
       ↓
    play()
       ↓
  scheduleLoop() ←─────┐
       ↓               │
  schedule notes       │
  within lookahead     │
       ↓               │
  setTimeout ──────────┘
```

## Constants

```javascript
const LOOKAHEAD = 2.0          // Schedule 2 seconds ahead
const SCHEDULE_INTERVAL = 100  // Check every 100ms
const MIN_NOTE_DURATION = 0.01 // Minimum 10ms notes
```

## Scheduler Implementation

### Main Loop

```javascript
class StreamingScheduler {
  constructor(audioEngine) {
    this.audioEngine = audioEngine
    this.pendingNotes = []
    this.nextNoteIndex = 0
    this.isPlaying = false
  }

  start(noteDataList, baseStartTime) {
    this.pendingNotes = noteDataList.sort((a, b) => a.startTime - b.startTime)
    this.nextNoteIndex = 0
    this.baseStartTime = baseStartTime
    this.isPlaying = true
    this.scheduleLoop()
  }

  scheduleLoop() {
    if (!this.isPlaying) return

    const currentTime = this.audioEngine.audioContext.currentTime
    const scheduleUntil = currentTime + LOOKAHEAD

    // Schedule all notes within the lookahead window
    while (this.nextNoteIndex < this.pendingNotes.length) {
      const note = this.pendingNotes[this.nextNoteIndex]
      const absoluteStart = this.baseStartTime + note.startTime

      if (absoluteStart > scheduleUntil) {
        break  // This and future notes are beyond lookahead
      }

      this.audioEngine._scheduleNote(note, this.baseStartTime)
      this.nextNoteIndex++
    }

    // Continue if more notes to schedule
    if (this.nextNoteIndex < this.pendingNotes.length) {
      this.timeoutId = setTimeout(() => this.scheduleLoop(), SCHEDULE_INTERVAL)
    } else {
      this.isPlaying = false
    }
  }

  stop() {
    this.isPlaying = false
    clearTimeout(this.timeoutId)
  }
}
```

### Note Data Structure

Lightweight representation for scheduling:

```javascript
{
  id: 1,              // Note ID
  startTime: 0.5,     // Seconds from composition start
  duration: 0.25,     // Duration in seconds
  frequency: 440,     // Frequency in Hz
  instrument: 'sine'  // Instrument name
}
```

This is much smaller than full Note objects with expressions.

## Timing Precision

### Web Audio Timing

Web Audio API provides sample-accurate timing:

```javascript
// Schedule precisely at audioContext time
oscillator.start(audioContext.currentTime + 0.5)
oscillator.stop(audioContext.currentTime + 0.75)
```

### Lookahead Buffer

The 2-second lookahead ensures:
- Notes are scheduled before they need to play
- JavaScript timing jitter doesn't affect audio timing
- Smooth playback even during garbage collection

### Schedule Interval

100ms interval balances:
- Responsiveness (new notes scheduled quickly)
- CPU usage (not checking too often)
- Lookahead coverage (multiple checks per lookahead window)

## Memory Management

### Oscillator Lifecycle

```javascript
// Oscillator is automatically garbage collected after:
oscillator.onended = () => {
  this.activeOscillators.delete(oscillator)
  // oscillator disconnected and released
}
```

### Pending Notes Array

Notes are removed from consideration as scheduled:
```javascript
this.nextNoteIndex++  // Simply advance index, no splice needed
```

## Playback Control

### Pause

```javascript
pause() {
  this.stop()  // Stop scheduler
  this.audioEngine.pauseFade(0.2)  // Fade out playing notes
}
```

### Resume

```javascript
resume(fromTime) {
  // Find first note after fromTime
  this.nextNoteIndex = this.pendingNotes.findIndex(
    n => n.startTime >= fromTime
  )
  this.baseStartTime = this.audioEngine.audioContext.currentTime - fromTime
  this.isPlaying = true
  this.scheduleLoop()
}
```

### Seek

```javascript
seek(toTime) {
  this.stop()
  this.audioEngine.stopAll()

  // Reset to position
  this.nextNoteIndex = this.pendingNotes.findIndex(
    n => n.startTime >= toTime
  )
  this.baseStartTime = this.audioEngine.audioContext.currentTime - toTime
  this.scheduleLoop()
}
```

## Edge Cases

### Overlapping Notes

Notes that overlap in time are scheduled independently:

```javascript
// Note 1: startTime=0, duration=1
// Note 2: startTime=0.5, duration=1
// Both scheduled, both play with overlap
```

### Very Short Notes

Minimum duration prevents audio glitches:

```javascript
const duration = Math.max(note.duration, MIN_NOTE_DURATION)
```

### Very Long Notes

Long notes are scheduled with the full duration:

```javascript
// Note with 60-second duration
// Scheduled once, plays for full duration
oscillator.start(startTime)
oscillator.stop(startTime + 60)
```

## Performance Metrics

| Scenario | Notes | Memory | CPU |
|----------|-------|--------|-----|
| 100 notes | ~10KB | ~1% | |
| 1000 notes | ~100KB | ~2% | |
| 10000 notes | ~1MB | ~5% | |

Memory scales linearly with note count. CPU usage depends on concurrent playing notes, not total notes.

## Debugging

```javascript
// Enable scheduler logging
scheduler.debug = true

// Logs:
// [Scheduler] Scheduled note 1 at 0.5s
// [Scheduler] Scheduled note 2 at 0.75s
// [Scheduler] Loop iteration, 50 notes remaining
```

## See Also

- [Audio Engine](/developer/audio/audio-engine) - Core audio system
- [Instruments](/developer/audio/instruments) - Sound generation
- [Transport Controls](/user-guide/playback/transport) - User controls
