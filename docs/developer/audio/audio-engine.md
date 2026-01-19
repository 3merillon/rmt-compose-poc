# Audio Engine

The AudioEngine manages Web Audio API playback with a streaming scheduler for efficient note playback.

## Class: AudioEngine

### Constructor

```javascript
const engine = new AudioEngine({
  initialVolume: 0.2,
  rampTime: 0.2
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialVolume` | number | 0.2 | Initial volume (0-1) |
| `rampTime` | number | 0.2 | Volume ramp time in seconds |

### Audio Graph

```
Oscillators → Individual Gains → Master Gain → Compressor → Destination
```

## Core Methods

### preparePlayback()

```javascript
const noteDataList = await engine.preparePlayback(module, fromTime)
```

Prepares notes for playback without starting audio.

| Parameter | Type | Description |
|-----------|------|-------------|
| `module` | Module | Module to play |
| `fromTime` | number | Start time offset in seconds |

Returns: Array of note data objects:
```javascript
[{
  id: number,
  startTime: number,
  duration: number,
  frequency: number,
  instrument: string
}, ...]
```

### play()

```javascript
const baseStartTime = engine.play(noteDataList, { initialVolume })
```

Starts streaming playback.

| Parameter | Type | Description |
|-----------|------|-------------|
| `noteDataList` | Array | From preparePlayback() |
| `options.initialVolume` | number | Starting volume |

Returns: The AudioContext time when playback started.

### pauseFade()

```javascript
await engine.pauseFade(rampTime)
```

Fades out all playing notes over the specified duration.

### stopAll()

```javascript
engine.stopAll()
```

Immediately stops all notes without fade.

### setVolume()

```javascript
engine.setVolume(0.5)
```

Sets the master volume with smooth ramping.

## Streaming Scheduler

The engine uses a streaming model to avoid blocking the main thread:

```javascript
const LOOKAHEAD = 2.0      // Schedule 2 seconds ahead
const SCHEDULE_INTERVAL = 100  // Check every 100ms

function scheduleLoop() {
  const currentTime = audioContext.currentTime
  const scheduleUntil = currentTime + LOOKAHEAD

  for (const note of pendingNotes) {
    if (note.startTime < scheduleUntil) {
      scheduleNote(note)
      pendingNotes.delete(note)
    }
  }

  if (pendingNotes.size > 0) {
    setTimeout(scheduleLoop, SCHEDULE_INTERVAL)
  }
}
```

### Benefits

- Notes scheduled just-in-time
- Main thread stays responsive
- Handles compositions of any length
- Memory efficient (doesn't pre-create all oscillators)

## Note Scheduling

### _scheduleNote()

```javascript
engine._scheduleNote(noteData, baseStartTime, initialVolume)
```

Creates and schedules a single oscillator:

```javascript
function _scheduleNote(noteData, baseStartTime, volume) {
  // 1. Get instrument
  const instrument = instrumentManager.getInstrument(noteData.instrument)

  // 2. Create oscillator
  const osc = instrument.createOscillator(noteData.frequency)
  osc.connect(this.masterGain)

  // 3. Create gain for envelope
  const gain = audioContext.createGain()
  osc.connect(gain)
  gain.connect(this.masterGain)

  // 4. Apply envelope
  const startTime = baseStartTime + noteData.startTime
  instrument.applyEnvelope(gain, startTime, noteData.duration, volume)

  // 5. Schedule start/stop
  osc.start(startTime)
  osc.stop(startTime + noteData.duration)

  // 6. Track for cleanup
  this.activeOscillators.add(osc)
  osc.onended = () => this.activeOscillators.delete(osc)
}
```

## Envelope System

### applyEnvelope()

```javascript
instrument.applyEnvelope(gainNode, startTime, duration, initialVolume)
```

Applies ADSR envelope to a gain node:

```javascript
function applyEnvelope(gain, start, duration, volume) {
  const { attack, decay, sustain, release } = this.getEnvelopeSettings()

  const attackEnd = start + attack * duration
  const decayEnd = attackEnd + decay * duration
  const releaseStart = start + duration - release * duration

  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, attackEnd)
  gain.gain.linearRampToValueAtTime(volume * sustain, decayEnd)
  gain.gain.setValueAtTime(volume * sustain, releaseStart)
  gain.gain.linearRampToValueAtTime(0, start + duration)
}
```

## AudioContext Management

### ensureResumed()

```javascript
await engine.ensureResumed()
```

Handles browser autoplay policy. AudioContext may be suspended until user interaction.

```javascript
async ensureResumed() {
  if (this.audioContext.state === 'suspended') {
    await this.audioContext.resume()
  }
}
```

### Context Creation

```javascript
const AudioContextClass = window.AudioContext || window.webkitAudioContext
this.audioContext = new AudioContextClass()
```

## Master Audio Chain

```javascript
// Create nodes
this.masterGain = audioContext.createGain()
this.compressor = audioContext.createDynamicsCompressor()

// Configure compressor
this.compressor.threshold.value = -24
this.compressor.knee.value = 30
this.compressor.ratio.value = 12
this.compressor.attack.value = 0.003
this.compressor.release.value = 0.25

// Connect chain
this.masterGain.connect(this.compressor)
this.compressor.connect(audioContext.destination)
```

## Cleanup

```javascript
engine.dispose()
```

Releases all audio resources:
- Stops all oscillators
- Disconnects nodes
- Closes AudioContext

## Error Handling

```javascript
try {
  await engine.preparePlayback(module, 0)
} catch (e) {
  if (e.name === 'NotAllowedError') {
    // User hasn't interacted yet
    showPlayButton()
  }
}
```

## Performance Considerations

| Metric | Value |
|--------|-------|
| Max concurrent oscillators | ~100 (browser dependent) |
| Lookahead window | 2 seconds |
| Schedule interval | 100ms |
| Minimum note duration | 10ms |

## See Also

- [Instruments](/developer/audio/instruments) - Instrument system
- [Streaming Scheduler](/developer/audio/streaming) - Detailed scheduler docs
- [Transport Controls](/user-guide/playback/transport) - User guide
