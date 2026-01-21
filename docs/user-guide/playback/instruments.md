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
| `vibraphone` | Complex | Bell-like, percussive decay |

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

Instruments are inherited through the frequency dependency chain:

1. If the note has an explicit instrument set, use that
2. Otherwise, follow the frequency expression to find the parent note
3. Recursively check the parent note's instrument
4. If no instrument is found in the chain, default to `sine-wave`

For example, if Note 2's frequency is `[1].f * (3/2)` and Note 1 has instrument "piano", Note 2 will inherit "piano" since it depends on Note 1's frequency.

### Propagation on Delete

When using **Delete and Keep Dependencies**, the deleted note's instrument is automatically propagated to any dependent notes that don't have their own explicit instrument set.

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

Custom waveform with multiple harmonics (fundamental, 3rd, 4th, 5th, 6th, 8th, 9th) creating a rich, sustained tone.

**Best for:**
- Full, rich chords
- Sustained passages
- Held tones

### Vibraphone

Custom waveform with strong fundamental, 4th partial, and 10th partial, plus a quick attack and long decay envelope.

**Best for:**
- Mallet percussion simulation
- Bell-like tones
- Percussive accents

## Sample Instrument Details

Sample instruments use a single audio sample that is pitch-shifted to play different frequencies.

### Piano

Single sample (A4 = 440Hz) pitch-shifted for all notes.

**Characteristics:**
- Quick attack, natural decay envelope
- Works best near the sample's native pitch
- Higher/lower pitches may sound less realistic due to pitch shifting

### Violin

Single sample (C5 = 523.25Hz) pitch-shifted for all notes.

**Characteristics:**
- Slower attack simulating bow contact
- Special envelope handling for short notes vs sustained notes
- Subtle swell on longer notes (>0.5s)

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
