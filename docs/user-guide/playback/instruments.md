# Instruments

RMT Compose includes several built-in instruments for playback.

## Available Instruments

### Synth Instruments

Generated in real-time using oscillators:

| Instrument | Waveform | Character |
|------------|----------|-----------|
| `sine-wave` | Sine | Pure, smooth, mellow |
| `square-wave` | Square | Hollow, clarinet-like |
| `sawtooth-wave` | Sawtooth | Bright, buzzy, string-like |
| `triangle-wave` | Triangle | Soft, flute-like |
| `organ` | Complex | Multi-harmonic organ |
| `vibraphone` | Complex | Bell-like with vibrato |

### Sample Instruments

Using pre-recorded samples:

| Instrument | Source | Character |
|------------|--------|-----------|
| `piano` | Sampled | Acoustic piano |
| `violin` | Sampled | Bowed string |

## Setting Instrument per Note

### Using the Variable Widget

1. Select a note
2. Find the **instrument** dropdown
3. Select from the list

### Using Expressions

In module JSON:

```json
{
  "id": 1,
  "frequency": "...",
  "instrument": "sawtooth-wave"
}
```

## Default Instrument

If no instrument is specified:
1. The note inherits from its dependencies
2. If no inheritance, defaults to `sine-wave`

## Instrument Inheritance

Instruments can be inherited through the dependency chain:

```javascript
// Note 1 has instrument "piano"
note1.instrument = "piano"

// Note 2 doesn't specify instrument
// If note2 depends on note1, it may inherit "piano"
note2.instrument = undefined  // Uses inheritance
```

## Synth Instrument Details

### Sine Wave

The simplest waveform - a pure tone with no harmonics.

**Best for:**
- Pure, clear tones
- Bass frequencies
- Testing pitch relationships

### Square Wave

Odd harmonics only (1, 3, 5, 7...).

**Best for:**
- Clarinet-like tones
- Retro/chiptune sounds
- Bohlen-Pierce scale (odd harmonics)

### Sawtooth Wave

All harmonics present (1, 2, 3, 4...).

**Best for:**
- Bright, rich sounds
- String-like tones
- Lead sounds

### Triangle Wave

Odd harmonics, but softer than square.

**Best for:**
- Soft, mellow tones
- Flute-like sounds
- Gentle melodies

### Organ

Multiple simultaneous oscillators simulating organ drawbars.

**Best for:**
- Full, rich chords
- Sustained passages
- Classical organ music

### Vibraphone

Bell-like tone with periodic amplitude modulation.

**Best for:**
- Mallet percussion simulation
- Jazz voicings
- Ethereal sounds

## Sample Instrument Details

### Piano

Multi-sampled acoustic piano.

**Characteristics:**
- Velocity-sensitive dynamics
- Natural decay
- Realistic timbre

### Violin

Sampled bowed strings.

**Characteristics:**
- Sustained tone
- String resonance
- Expressive capability

## Mixing Instruments

Different notes can use different instruments:

```json
{
  "notes": [
    { "id": 1, "instrument": "piano", ... },
    { "id": 2, "instrument": "violin", ... },
    { "id": 3, "instrument": "sine-wave", ... }
  ]
}
```

This enables:
- Ensemble arrangements
- Contrasting timbres
- Highlighting specific voices

## Tips

1. **Start with sine** - It's the clearest for hearing pitch relationships
2. **Use square for BP** - Odd harmonics match Bohlen-Pierce well
3. **Mix for interest** - Combine different instruments in a composition
4. **Match character** - Choose instruments that fit your musical intent
5. **Test with playback** - Hear how different instruments sound in context

## Future Instruments

Planned additions:
- More sample instruments
- Custom sample loading
- FM synthesis
- Audio effects (reverb, delay)

Check the [changelog](/about/changelog) for updates on new instruments.
