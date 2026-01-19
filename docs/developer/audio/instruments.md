# Instruments

RMT Compose supports both synthesized and sampled instruments through a unified instrument system.

## Instrument Types

### Synth Instruments

Generate sound using Web Audio oscillators:

- **SineInstrument** - Pure sine wave
- **SquareInstrument** - Square wave
- **SawtoothInstrument** - Sawtooth wave
- **TriangleInstrument** - Triangle wave
- **OrganInstrument** - Organ with harmonics
- **VibraphoneInstrument** - Vibraphone with vibrato

### Sample Instruments

Use pre-recorded audio samples:

- **PianoInstrument** - Piano samples
- **ViolinInstrument** - Violin samples

## Base Classes

### SynthInstrument

```javascript
class SynthInstrument {
  constructor(name, type)
  createOscillator(frequency)
  getEnvelopeSettings()
  applyEnvelope(gainNode, startTime, duration, volume)
}
```

### SampleInstrument

```javascript
class SampleInstrument {
  constructor(name)
  loadSample(url, baseFrequency)
  createSource(frequency)
  getEnvelopeSettings()
}
```

## Creating a Synth Instrument

```javascript
class SineInstrument extends SynthInstrument {
  constructor() {
    super('sine-wave', 'sine')
  }

  getEnvelopeSettings() {
    return {
      attack: 0.01,   // 1% of duration
      decay: 0.1,     // 10% of duration
      sustain: 0.8,   // 80% of peak volume
      release: 0.1    // 10% of duration
    }
  }
}
```

### Oscillator Types

| Type | Description | Harmonics |
|------|-------------|-----------|
| `sine` | Pure tone | Fundamental only |
| `square` | Hollow, clarinet-like | Odd harmonics |
| `sawtooth` | Bright, buzzy | All harmonics |
| `triangle` | Soft, flute-like | Odd harmonics (weak) |

## Creating a Sample Instrument

```javascript
class PianoInstrument extends SampleInstrument {
  constructor() {
    super('piano')
  }

  async load(audioContext) {
    // Load samples for different pitch ranges
    await this.loadSample('/samples/piano-c4.wav', 261.63)
    await this.loadSample('/samples/piano-c5.wav', 523.25)
  }

  getEnvelopeSettings() {
    return {
      attack: 0.005,
      decay: 0.3,
      sustain: 0.5,
      release: 0.2
    }
  }
}
```

### Sample Playback

Samples are pitch-shifted using `playbackRate`:

```javascript
createSource(frequency) {
  const source = audioContext.createBufferSource()
  source.buffer = this.getNearestSample(frequency)

  // Pitch shift to target frequency
  const sampleFreq = this.getSampleFrequency(source.buffer)
  source.playbackRate.value = frequency / sampleFreq

  return source
}
```

## Instrument Manager

Centralized registry for all instruments.

### Registration

```javascript
instrumentManager.register(new SineInstrument())
instrumentManager.register(new PianoInstrument())
```

### Lookup

```javascript
const instrument = instrumentManager.getInstrument('sine-wave')
const osc = instrument.createOscillator(440)
```

### Available Instruments

```javascript
const names = instrumentManager.getAvailableInstruments()
// → ['sine-wave', 'square-wave', 'piano', ...]
```

## ADSR Envelope

All instruments use Attack-Decay-Sustain-Release envelopes:

```
Volume
  │
  │    ╱╲
  │   ╱  ╲_______
  │  ╱          ╲
  │ ╱            ╲
  └─────────────────── Time
    │  │   │    │
    A  D   S    R

A = Attack time (rise to peak)
D = Decay time (fall to sustain level)
S = Sustain level (held volume)
R = Release time (fade to zero)
```

### Envelope Settings

```javascript
{
  attack: 0.01,   // Fraction of note duration
  decay: 0.1,
  sustain: 0.8,   // Fraction of peak volume (0-1)
  release: 0.1
}
```

### Applying Envelope

```javascript
function applyEnvelope(gain, start, duration, volume) {
  const env = this.getEnvelopeSettings()

  const attackTime = start + env.attack * duration
  const decayTime = attackTime + env.decay * duration
  const releaseTime = start + duration - env.release * duration

  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, attackTime)
  gain.gain.linearRampToValueAtTime(volume * env.sustain, decayTime)
  gain.gain.setValueAtTime(volume * env.sustain, releaseTime)
  gain.gain.linearRampToValueAtTime(0, start + duration)
}
```

## Complex Instruments

### Organ (Additive Synthesis)

Combines multiple oscillators for richer sound:

```javascript
class OrganInstrument extends SynthInstrument {
  createOscillator(frequency) {
    const oscillators = [
      { freq: frequency, gain: 1.0 },      // Fundamental
      { freq: frequency * 2, gain: 0.5 },  // 2nd harmonic
      { freq: frequency * 3, gain: 0.3 },  // 3rd harmonic
      { freq: frequency * 4, gain: 0.25 }, // 4th harmonic
    ]

    // Create and mix oscillators
    const merger = audioContext.createGain()
    for (const { freq, gain } of oscillators) {
      const osc = audioContext.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      const g = audioContext.createGain()
      g.gain.value = gain
      osc.connect(g).connect(merger)
    }
    return merger
  }
}
```

### Vibraphone (Vibrato)

Adds frequency modulation:

```javascript
class VibraphoneInstrument extends SynthInstrument {
  createOscillator(frequency) {
    const osc = audioContext.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = frequency

    // Add vibrato (LFO)
    const lfo = audioContext.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 5  // 5 Hz vibrato rate

    const lfoGain = audioContext.createGain()
    lfoGain.gain.value = 3  // 3 Hz vibrato depth

    lfo.connect(lfoGain).connect(osc.frequency)

    return osc
  }
}
```

## Adding Custom Instruments

1. Extend `SynthInstrument` or `SampleInstrument`
2. Implement required methods
3. Register with `instrumentManager`

```javascript
class MyInstrument extends SynthInstrument {
  constructor() {
    super('my-instrument', 'sine')
  }

  getEnvelopeSettings() {
    return { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.15 }
  }
}

instrumentManager.register(new MyInstrument())
```

## See Also

- [Audio Engine](/developer/audio/audio-engine) - Playback system
- [Streaming Scheduler](/developer/audio/streaming) - Note scheduling
- [Instruments (User Guide)](/user-guide/playback/instruments) - Using instruments
