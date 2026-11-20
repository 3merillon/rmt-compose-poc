---
title: Instruments
description: The voice contract, the shared note-off envelope in seconds, the nine synth instruments, the two multisampled ones, and how to add your own.
---

# Instruments

Eleven instruments ship: **nine synthesized** and **two multisampled**. All of them implement one
small contract, and all of them share one envelope function. Get those two things right and the rest
of this page is detail.

| Name (the exact registered string) | Kind | How it is built |
|---|---|---|
| `sine-wave` | synth | single sine oscillator — the **default** |
| `square-wave` | synth | square, one oscillator, pitch-tracked lowpass at 12× |
| `sawtooth-wave` | synth | sawtooth, one oscillator, pitch-tracked lowpass at 10× |
| `triangle-wave` | synth | single triangle oscillator |
| `organ` | synth | single oscillator with a **10-harmonic `PeriodicWave`** |
| `vibraphone` | synth | three oscillators at the note's frequency, each a `PeriodicWave` of one group of its 16 harmonics, the upper modes decaying faster |
| `fm-epiano` | synth | **2-operator FM** — sine carrier, sine modulator, decaying index |
| `harmonium` | synth | single oscillator, `PeriodicWave` with **every partial 1–16**, full level to the note-off |
| `harmonium-soft` | synth | the same class with a lower knee, a lower level and a slower envelope |
| `piano` | sampled | `MultisampleInstrument`, 14 zones |
| `violin` | sampled | `MultisampleInstrument`, 15 zones |

::: warning Two things the old docs got wrong
`organ` is **not** an oscillator bank with a merger gain, and `vibraphone` has **no LFO and no
vibrato**. Both are a single `OscillatorNode` driven by a custom `PeriodicWave`. The only
frequency-modulated instrument in the app is `fm-epiano`.
:::

## The voice contract

`createOscillator(frequency)` does **not** return an `OscillatorNode`. It returns a *voice*:

```javascript
{
  frequency: { value: 440 },
  start(when),
  stop(when),
  connect(dest),      // returns dest
  disconnect(),
  onended            // settable; forwarded to the underlying source
}
```

That is the whole interface `AudioEngine._scheduleNote` knows about. A voice may wrap several
oscillators (a unison stack, an FM carrier + modulator) plus a filter, and the engine treats them all
identically. A bare `OscillatorNode` also satisfies this shape natively, which is why the
multisample fallback can just return one.

Build one with `makeVoice()` (`instrument-manager.js:202`):

```javascript
export function makeVoice(sources, output, frequency, onStart)
```

| Argument | Meaning |
|---|---|
| `sources` | Nodes to `start()` / `stop()` together. `onended` is forwarded from the **last** one. |
| `output` | The node `connect()` / `disconnect()` act on. |
| `frequency` | Reported back as `voice.frequency.value`. |
| `onStart` | Optional. Extra scheduling at `start(when)` — `fm-epiano` uses it to schedule its modulation index against the note's absolute start time. |

Every call inside `makeVoice` is wrapped in `try {} catch {}`. A voice that fails to start must not
take the pump down with it.

## The envelope core

One function shapes every note, synth and sample alike. A note's end is a **note-off**, not the end of
its sound: the attack and the decay start at the note's start, the sustain (or a natural decay) lasts
until the note's end, and the release starts there and **rings after it**, as when a key is lifted or
a bow leaves the string.

```javascript
applyVoiceEnvelope(gainNode, startTime, duration, peak, env, shape)
```

`instrument-manager.js:63`. `env` comes from the instrument's `getEnvelopeSettings(duration, frequency)`
and is in **seconds**:

```javascript
{ attack, decay, sustain, t60, release }
```

| Key | Meaning |
|---|---|
| `attack` | Linear rise from silence to the peak, from the note's start. Default `0.01`. |
| `decay` | Exponential fall to `sustain`, in seconds. Used only when `sustain < 1`. |
| `sustain` | The level held until the note's end, as a fraction of the peak. Default `1`. |
| `t60` | Instead of `decay` and `sustain`: a natural decay, −60 dB every `t60` seconds, until the note's end. |
| `release` | After the note's end: exponential fall to silence (−80 dB). Default `0.05`. |

Because the times are seconds, a short note keeps the shape of a long one: a 0.1 s piano note is a
0.1 s strike followed by its damper.

`byPitch(freq, [f1, v1], [f2, v2])` (`instrument-manager.js:45`) is the helper for a value that
follows pitch: `v1` at `f1`, `v2` at `f2`, geometric in between, held beyond either end. The
vibraphone's `t60`, the electric piano's `t60` and the piano's release use it.

### The shape

```
gain
  │      ╱‾╲
  │     ╱   ╲___________
  │    ╱                ╲
  │   ╱                  ╲
  └──┴────┴──────────────┴────┴─── time
     A    D          note's end  R  └ hard zero at R end + 4 ms
     └──────── duration ────┘
```

1. `setValueAtTime(EPS, t0)`: start at ~0, not at 0, because exponential ramps cannot touch zero.
2. **Linear** attack to `peak`.
3. Either an **exponential** decay to `sustain` (when `decay` is set and `sustain < 1`), or a natural
   decay with `t60`, or nothing (full level). A note that ends during its decay leaves it there, at
   whatever level it has reached.
4. Hold to the note's end.
5. **Exponential** release to `EPS`, ending `release` seconds **after** the note's end.
6. `linearRampToValueAtTime(0, end + 0.004)`: a hard zero 4 ms later, so the source can be stopped
   cleanly.

### The floors: this is what kills clicks

| Constant | Value | Why |
|---|---|---|
| `ATTACK_FLOOR` | **0.003 s** | An attack shorter than 3 ms is a step, and a step is a click. |
| `RELEASE_FLOOR` | **0.015 s** | Same at the other end. |
| `EPS` | `0.0001` | Exponential ramps cannot reach 0. |
| `ZERO_RAMP` | `0.004 s` | The linear step from `EPS` to 0 after the release. |
| `STOP_MARGIN` | `0.02 s` | The voice is stopped this long after its gain reached 0. |
| duration floor | `0.001 s` | `dur = Math.max(0.001, duration)`. |

The attack must fit **inside the note**: a note shorter than its attack is attacked over its whole
length. Nothing else has to fit. The release is not squeezed into the note, because it comes after it.

### The note's own attack and release

`shape` is `{ attack, release }`, the note's `attack` and `release` variables (its own, else the
BaseNote's), each a **share of the note's own duration** (`1/8` is an eighth of it) or `null`. A given
value replaces the instrument's `attack` or `release` for that note; a `null` leaves the instrument's
time. `noteShape()` (`instrument-manager.js:190`) clamps the attack to 0 to 1 and the release to 0 to
`MAX_RELEASE_SHARE` (4, `instrument-manager.js:26`); a value that is not a finite number is `null`.
`envelopeTimes()` (`instrument-manager.js:105`) turns the shares into seconds:

- The attack is the share times the duration, counted from the note's start.
- The release is the share times the duration, counted **from the note's end**: `release = 1` rings
  for as long again as the note lasted, `4` for four times as long.
- The anti-click floors stay: `ATTACK_FLOOR` 3 ms and `RELEASE_FLOOR` 15 ms still apply to a note's
  own values.
- `envelopeShares()` (`instrument-manager.js:172`) returns the same envelope as fractions of the
  duration. The renderer draws the part inside the note, so what is seen is what is heard. It does not
  yet draw the release, which lies after the note's end.

Every `applyEnvelope()` in the instrument classes takes the `shape` and the sounding `frequency` as its
last arguments and passes them on.

### How long a voice lives

`envelopeLength()` (`instrument-manager.js:160`) is the end of the release plus `ZERO_RAMP` plus
`STOP_MARGIN`. `SynthInstrument.voiceLength()` and `InstrumentManager.voiceLength()` return it, and
`_scheduleNote` stops the source at `start + voiceLength(...)`. Note lengths are unchanged; only the
sound outlasts them. If the envelope cannot be computed the engine falls back to the duration plus
`FALLBACK_TAIL = 0.15 s`.

### Per-instrument settings

All times are in seconds; sustain is a fraction of the peak.

| Instrument | Wave | Unison | Detune | Filter (mul / Q) | Attack | Decay / sustain | Release |
|---|---|---|---|---|---|---|---|
| `sine-wave` | sine | 1 | — | — | 0.015 | none (full level) | 0.1 |
| `square-wave` | square | 1 | — | 12× / 0.7 | 0.008 | 0.25 s to 0.7 | 0.1 |
| `sawtooth-wave` | sawtooth | 1 | — | 10× / 0.7 | 0.008 | 0.25 s to 0.7 | 0.1 |
| `triangle-wave` | triangle | 1 | — | — | 0.015 | none (full level) | 0.12 |
| `organ` | periodic (10 harm.) | 1 | — | — | 0.03 | none (full level) | 0.06 |
| `vibraphone` | periodic (16 harm., in three groups) | 3 (same pitch) | — | — | 0.002 | `t60` from 6 s at 65 Hz to 2 s at 2000 Hz; partial 4 at 3×, partials 10–15 at 6× that rate | 0.4 |
| `fm-epiano` | 2-op FM | — | — | — | 0.002 | `t60` from 5 s at 65 Hz to 1.5 s at 2000 Hz | 0.25 |
| `harmonium` | periodic (16 harm.) | 1 | — | — | 0.03 | none (full level) | 0.08 |
| `harmonium-soft` | periodic (16 harm.) | 1 | — | — | 0.06 | none (full level) | 0.12 |
| `piano` | sampled | — | — | — | 0.002 | none (the recording decays) | from the pitch: 0.30 at C1 to 0.10 at C6, 1.5 above F#6 |
| `violin` | sampled | — | — | — | 0.005 | none (the recording decays) | 0.12 |

The per-note `peak` is `initialVolume` — **0.2** (`player.js:69`, and the `AudioEngine` constructor
default). That is not master volume; master volume lives on the
[audio graph](/developer/audio/audio-graph#master-volume). Three instruments scale it: `piano` by its
manifest's `gainDb`, `harmonium` by a `level` of 0.6 and `harmonium-soft` by 0.42.

## SynthInstrument

`instrument-manager.js:224`. Subclasses set fields; the base class builds the voice.

```javascript
export class SquareInstrument extends SynthInstrument {
  constructor(audioContext) {
    super(audioContext);
    this.name = 'square-wave';
    this.waveType = 'square';
    this.unisonCount = 1;      // one oscillator at exactly the written pitch
    this.detuneCents = 0;      // (a ±4-cent, 3-oscillator unison until 20 November 2026)
    this.filterTrackMul = 12;  // lowpass at 12 × the note frequency
    this.filterQ = 0.7;
  }

  getEnvelopeSettings() {
    return { attack: 0.008, decay: 0.25, sustain: 0.7, release: 0.1 };   // seconds
  }
}
```

| Field | Default | Effect |
|---|---|---|
| `waveType` | `'sine'` | Used when `periodicWave` is unset. |
| `periodicWave` | `null` | Set it and `waveType` is ignored. `organ`, `vibraphone` and the two harmonium voices do this. |
| `unisonCount` | `1` | `n` oscillators summed through a gain of **`1/√n`**, so perceived level stays constant. |
| `detuneCents` | `0` | Spread symmetrically: the **edge** voices land at ±`detuneCents`, the centre at 0. |
| `filterTrackMul` | `0` | `> 0` adds a per-voice biquad lowpass at `clamp(max(200, freq × mul), ≤ 0.95 × Nyquist)`. |
| `filterQ` | `0.7` | Q of that filter. |

`fm-epiano` is the one synth that overrides `createOscillator()` outright
(`synth-instruments.js:201`): a sine carrier, a sine modulator at a 1:1 ratio, and a `modGain` whose
value is `index × modFreq` feeding `carrier.frequency`. The index decays exponentially from **4** to
**0.6** over **0.28 s**, scheduled inside the voice's `start()` so it locks to the note's absolute
start.

### The harmonic voices

`harmonium` and `harmonium-soft` are two three-line subclasses of `HarmonicVoice`
(`synth-instruments.js:276`), a `SynthInstrument` that is deliberately **not** exported in the
`SynthInstruments` map, so it is never registered itself. They exist to make the difference between
a pure and a tempered interval as salient as it can be: two notes a ratio `p/q` apart share a
partial (the `p`-th of the lower is the `q`-th of the upper), which stands still when the interval
is pure and beats when it is not. That beat is the loudest cue to tuning, not the only one — pure
against tempered is audible on a sine too, in the pitches and in the difference tones the ear adds —
and it needs a voice that has the partials and holds them still.

```javascript
export class HarmoniumInstrument extends HarmonicVoice {
  constructor(audioContext) {
    super(audioContext, { name: 'harmonium', knee: 8, attackSec: 0.03, releaseSec: 0.08, level: 0.6 });
  }
}
```

| Option | `harmonium` | `harmonium-soft` | Effect |
|---|---|---|---|
| `knee` | 8 | 3 | The partial above which the roll-off steepens. |
| `attackSec` | 0.03 | 0.06 | Attack, in **seconds**. |
| `releaseSec` | 0.08 | 0.12 | Release, in **seconds**. |
| `level` | 0.6 | 0.42 | Multiplies the per-note peak. |

**The spectrum.** Sixteen partials (`HARMONIC_VOICE_PARTIALS`), none missing:

```javascript
amplitude(n) = 1 / (n * Math.sqrt(1 + (n / knee) ** 2))   // n = 1 … 16
```

A sawtooth's `1/n` with the top rolled off: 6 dB per octave below the knee, 12 dB above it. The
amplitudes are kept on the instance as `partials` (index `n − 1`).

**Sine phase.** `createWave()` writes the amplitudes into the `imag` array of `createPeriodicWave`,
not into `real` as `organ` does. The spectrum is the same either way; the waveform is not. In cosine
phase every partial peaks at the same instant, and the browser normalizes a `PeriodicWave` to a peak
of 1 — so the cosine version has a crest factor of 10.6 dB against 4.5 dB for the sine version, and
needs twice the headroom for the same loudness.

**`level`.** At a peak of 1 this dense wave is louder than the other synths. `0.6` brings one
`harmonium` note to the A-weighted level of one `organ` note at 263 Hz (−27.5 dB against −27.6 dB
re full scale, measured by `scripts/perf/check-purity.mjs`); `0.42` puts `harmonium-soft` about 3 dB
under that.

**The envelope is in seconds.** Like every instrument now, the harmonic voices give their two times
directly, with no decay stage and the full level held to the note's end:

```javascript
{ attack: attackSec, release: releaseSec }
```

`applyEnvelope()` is overridden only to apply `level`. The shared floors hold, the release rings after
the note's end, and a note shorter than `attackSec` is attacked over its whole length. (When these
voices were written the other synths used fractions of the note; since Phase I all of them use
seconds.)

Everything else is inherited: `createOscillator()` is the base class's, with `unisonCount` 1 and no
filter, so the voice is **one oscillator**. There is no detune and no vibrato to add.

::: tip Measure it
`node scripts/perf/check-purity.mjs` renders these voices through the real `AudioEngine` on an
`OfflineAudioContext` and checks the claims above: all sixteen partials present at the declared
levels and none beyond, each partial steady through a held note, the same attack and release at
three note lengths, nothing folded back at a high pitch — and that a pure major third stands still
in the band of its shared partial while its tempered twin beats. `--compare <git-ref>` adds a
before/after render of every other instrument. It also prints, without judging, what the same switch
does to a triad of sines: there is no shared partial for that measure to read, which is a limit of
the measure and not of what can be heard.
:::

## MultisampleInstrument

`src/instruments/multisample-instrument.js`. `piano` and `violin` are three-line subclasses of it
(`sample-instruments.js`), differing only in name and manifest URL.

A manifest describes several **zones** — one short mono sample each, with a root pitch and a
frequency span — so a played note pitch-shifts by at most a few semitones instead of being stretched
across the whole keyboard from one recording.

### Loading

| Stage | When |
|---|---|
| `manifest.json` fetch | at **construction** (app boot). ~2 KB. |
| Zone audio decode | **lazily** — `prepare(freqs)`, called from `AudioEngine.preparePlayback`, decodes exactly the zones the upcoming notes will hit. |

`waitForLoad()` resolves when the **manifest** is parsed — not the audio. Do not use it to wait for
buffers; use `prepare()`.

If a zone is not decoded when a voice is created, `createOscillator()` kicks off a decode for next
time and returns `_fallbackOscillator(frequency)` — a plain sine `OscillatorNode`. The note still
sounds, just not sampled. A manifest fetch failure does the same thing for every note, and logs
`[multisample] <name>: manifest load failed … — oscillator fallback`.

### Zone selection

`_zoneFor(freq)`: the first zone whose `[lowHz, highHz]` contains `freq`; otherwise the zone with the
smallest `|log2(freq / rootHz)|`. Both shipped manifests span `lowHz: 0` → `highHz: 20000`, so the
nearest-root path is effectively unreachable below 20 kHz.

### Playback

```javascript
source.playbackRate.value = frequency / (zone.playedHz || zone.rootHz);
```

`zone.playedHz` is `rootHz · 2^(tuneCents / 1200)`: the pitch the recording actually has. `tuneCents` is
measured once per zone by `scripts/tune-samples.mjs` (partials 1–12 of the held tone fitted to a stiff string's
series f_n = n·f0·√(1 + B·n²), the first partial f0·√(1 + B); for the violin, whose bowed partials are exactly
harmonic, B = 0) and written into the manifest. Without it a zone was played against its nominal root, and the
recordings' own offsets (the piano's stretch tuning, −29 cents at C1 to +12 at C7; the violin's −12 to +19) were
carried into every ratio between two zones. `node scripts/tune-samples.mjs --check` measures what the corrected
instrument plays: every piano and violin zone within 3 cents (the measure's own resolution on a low string). The
violin's recordings carry vibrato, so their measured pitch is a mean, uncertain by several cents. Within one zone
nothing changes: two notes of the same recording were always in the exact ratio of their playback rates.

into a biquad — **lowpass** at `min(0.48 × sampleRate, 16000 / √ratio)` when shifting up, **highpass**
at `max(20, 60 × √ratio)` when shifting down, `Q = 0.5` either way.

`applyEnvelope()` multiplies the peak by `this.gain` (from the manifest's `gainDb`) and then calls the
shared `applyVoiceEnvelope` with `getEnvelopeSettings(duration, frequency)` and the note's `shape`.
`voiceLength()` is the shared `envelopeLength()` of the same envelope.

### The manifest (schema 1)

```json
{
  "schema": 1,
  "name": "piano",
  "displayName": "Upright Piano",
  "license": { "id": "CC0-1.0", "source": "VSCO-2 Community Edition", "author": "…", "url": "…" },
  "gainDb": 2,
  "envelope": { "attack": 0.002, "release": 0.1 },
  "zones": [
    { "root": "C1", "rootHz": 32.703, "lowHz": 0, "highHz": 40.03, "url": "C1.m4a" }
  ]
}
```

Two of those fields reach the sound: `gainDb`, applied as `peak × 10^(gainDb/20)`, and `envelope`.

**How `envelope` is honored.** `_loadManifest()` merges `m.envelope` over the defaults
(`{ attack: 0.005, release: 0.12 }`), and `getEnvelopeSettings(duration, frequency)` returns
`{ attack, release }` from it, both in **seconds**:

- The attack runs from the note's start; the recording carries its own onset, so it is short (piano
  0.002, violin 0.005).
- There is no decay stage: the voice holds full gain until the note's end, because the recording
  carries its own decay.
- The release runs **after** the note's end (piano 0.1, violin 0.12 in the manifests).
- The ratio keys of the old format (`attackTimeRatio` and the like) are not read anywhere.
- The result passes through the shared floors, 3 ms for the attack and 15 ms for the release.

`PianoInstrument` overrides `getEnvelopeSettings()` (`sample-instruments.js:29`): its release is a
damper that follows pitch, `byPitch(f, [32.703 Hz, 0.30 s], [1046.5 Hz, 0.10 s])`, and above 1480 Hz
(F#6, where a piano has no dampers) it is 1.5 s. The `release` in the piano's manifest is
therefore never used; its `attack` is.

`displayName` and `license` are parsed and never rendered anywhere in the app. `zones[].tuneCents` is the
recording's measured pitch against `rootHz` (above). `zones[].loop` is a loop in the recording (below).
`zones[].velLayers[]` is reserved and not even parsed.

### The shipped samples

| | `piano` | `violin` |
|---|---|---|
| Source | VSCO-2 CE, "Upright Nr1" | VSCO-2 CE, "Solo Violin — Arco Vib" |
| Zones | **14** (C1 … G7, 32.703 – 3135.963 Hz) | **15** (G3 … C7, 195.998 – 2093.005 Hz) |
| `gainDb` | `2` | `0` |
| Format | mono AAC `.m4a`, ~96 kbps | same |

Both sets are **CC0 1.0** from [VSCO-2 Community Edition](https://github.com/sgossner/VSCO-2-CE)
(Versilian Studios). CC0 imposes no attribution requirement; `public/samples/CREDITS.md` credits them
anyway. The CC0 sourcing is what keeps the project's MIT relicense clean — do not swap in a sample set
without checking this.

Rebuild them with **`npm run samples:build`** (`scripts/build-samples.mjs`). It needs **ffmpeg on
PATH** and network access, lists the VSCO-2 GitHub tree, picks one file per root note, and transcodes:

```
# violin (tail: { maxSeconds: 3.5 })
ffmpeg -ac 1 -t 3.5 \
  -af silenceremove=start_periods=1:start_threshold=-45dB,afade=t=out:st=3.40:d=0.1 \
  -c:a aac -b:a 96k -movflags +faststart
# piano (tail: { maxSeconds: 20, endThresholdDb: -66 }): the whole decay
ffmpeg -ac 1 -t 20 \
  -af silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse,afade=t=out:st=19.90:d=0.1 \
  -c:a aac -b:a 96k -movflags +faststart
```

`--only piano` (or `--only violin`) rebuilds one instrument. Then run `node scripts/tune-samples.mjs`, which
writes each zone's `tuneCents` and, for the piano, `decayT60`: the recording's average fall over its first 3 s,
as seconds per 60 dB (8 s in the bass to 3 s at the top). The audio does not use `decayT60` (the recording decays
by itself); `getEnvelopeSettings()` hands it to the drawing as `drawT60`, so a long piano note is drawn dying
away as it sounds. For the violin it writes each zone's `loop` (below).

Zone boundaries are the **geometric mean** of adjacent roots. The output is committed; the sources
are not.

### Loops: the violin holds its notes

The piano's recordings run until they have decayed (19 s at C1 down to 2 s at G7), so a piano note
sounds for as long as it is held, and its zones have no loop. The violin's recordings are cut at
**3.5 s** (with a 0.1 s fade from 3.4 s), so each violin zone carries a loop,
`"loop": { "start": 1.13398, "end": 2.735 }` (seconds into the recording), and a violin note
held past the loop's end repeats it for as long as it is held.

- **Where the loop is.** `scripts/tune-samples.mjs` searches the held part of each recording: the
  start between 0.8 and 1.6 s (after the bow's attack), the end between 2.6 and 3.25 s (before the
  fade). It picks the pair whose preceding 30 ms match best, by waveform correlation less a cost for
  any level difference. The loops are 1.1 to 2.1 s long, correlations 0.78 (E6) to 0.98 (C4),
  level steps under 0.25 dB.
- **The seam.** `_decodeZone()` passes each decoded buffer to `bakeLoopCrossfade()`. It blends the
  `LOOP_XFADE` (0.12 s) before the loop's end into the same length before its start, so at the jump
  back the sound continues from where it would have been. The gains keep the level:
  a² + b² + 2abc = 1, with c the correlation of the two stretches. That is equal power when they are
  unrelated and equal gain when they are alike. Nothing is re-encoded.
- **Playback.** `createOscillator()` sets `source.loop`, `loopStart` and `loopEnd` on the voice's
  `AudioBufferSourceNode`; the engine stops the voice after its release, as for every instrument.
- **The vibrato** is the recording's own, and it repeats with the loop (the owner's decision:
  keep it).
- **Checked by** `scripts/test-loops.mjs` (in `npm test`: the bake, the level, the manifests) and
  `scripts/perf/check-violin-loops.mjs`. The second renders a 10 s note on every zone at rate 1 and
  9/8 and checks three things: the note lasts (no 20 ms frame more than 12 dB under its median); the
  seams are level (no step larger than 99% of the recording's own frame-to-frame flicker); and the
  seams make no click.

## Registration

```javascript
// src/main.js, at module load
audioEngine.registerInstruments(SynthInstruments, SampleInstruments);
```

which calls `instrumentManager.registerBuiltInInstruments(SynthInstruments, SampleInstruments)`
(`instrument-manager.js:304`). It instantiates every class value in both maps, passing the
`AudioContext` to the constructor.

The single-instrument entry point is **`registerInstrument(instrument)`** — not `register()` — and it
keys the registry on `instrument.name.toLowerCase()`.

```javascript
instrumentManager.registerInstrument(new MyInstrument(audioContext));
instrumentManager.getAvailableInstruments();  // registered keys, in registration order
```

::: warning Two different defaults, both spelled `sine-wave`
`InstrumentManager.defaultInstrument` (`instrument-manager.js:301`) is a **hardcoded** unknown-name fallback. It never
follows the settings system. `module.js`'s `_defaultInstrumentName` is the **inheritance** fallback,
and it *does* follow `audio.defaultInstrument`.

Consequence: a module saved with `"instrument": "cello"` always plays as `sine-wave` (with a
`console.warn`), even if the user set the default instrument to `piano`. Instrument names are not
validated on module import.
:::

The Settings → Audio dropdown is a **hardcoded list** in `settings-panel.js:103`. It currently matches
the registry exactly, but a newly registered instrument will not appear there automatically.

## Articulation: how a line is played

Each instrument has an `articulation` (`'sustained'` by default on `SynthInstrument` and `MultisampleInstrument`):
`'struck'` for `piano`, `vibraphone` and `fm-epiano`, `'bowed'` for `violin`. The AudioEngine reads it in
`_scheduleNote()`:

- **bowed**: `preparePlayback()` marks a note `slur` when its line predecessor (`Module.findPlayer`, src/players.js) is
  a sounding note ending exactly (an exact `Fraction` comparison) where it starts. Such a note, unless it repeats the
  predecessor's pitch, gets an attack of `SLUR_XFADE = 0.04 s` and starts its recording at `voice.bowOffset` (0.15 s
  in, past the bow's onset); the predecessor's voice is faded over the same 40 ms with a quarter-cosine curve
  (`_fadeVoice(…, true)`, `audio-engine.js:895`). A repeated pitch fades the predecessor in `REBOW_FADE = 0.03 s` and is bowed
  normally. A rest or a silence between them leaves `slur` false.
- **struck**: every voice of the same instrument still sounding on exactly the same frequency is faded in
  `DAMP_FADE = 0.02 s` from the new note's start.

A fade starts from the gain the voice's envelope has at that instant, `envelopeGainAt(T, peak, t)`
(`instrument-manager.js:133`), which rebuilds the scheduled curve exactly (the envelope test checks it at every
instrument, length and pitch), so there is no step. A voice that faded another and is then cancelled before it
sounds (a live tempo change, a loop switched off) restores the release of the voice it faded (`_restoreFaded`).

## Instrument inheritance

A note usually carries no instrument of its own. `Module.findInstrument(note, memo)` (`module.js:820`)
calls `instrumentOf()` in `src/players.js`, which resolves one in this order. A **player** is a line of
notes, each starting where the previous one ends.

1. The note has its own `instrument` property → **use it**. It starts a new player.
2. Its start is written from the end of a note or a silence *p* (`[p].t + [p].d`, optionally plus a
   rest such as `base.d * (1/2)`) → *p*'s instrument: the same player. A silence carries the line.
3. It is a copy of a note *k* of a line (start `[k].t + X`, frequency `r * [k].f`) and the copy of *k*'s
   predecessor exists (written from it with the same `X`) → that copy's instrument. A copy of a line
   is a line: a canon voice.
4. Otherwise it starts a line: the instrument of the note its **start time** is written from
   (`[k].t …`; a measure bar does not count), else the BaseNote's, else the global default,
   `audio.defaultInstrument`.

Consequences worth stating plainly:

- **The frequency does not decide the instrument.** A bass note tuned from the melody is still the
  bass.
- `findInstrument()` takes an optional `Map` memo; a caller resolving many notes in one pass shares
  one, so each line is walked once. `module.findPlayer(note, memo)` returns `{head, prev}`.
- A module file without `"instrumentRule": "start-time"` is migrated on load
  (`migrateInstrumentRule()`): every sounding note whose instrument the rule would change gets its old
  instrument written onto it. `createModuleJSON()` writes the key, so a saved module is not migrated
  again. `scripts/test-players.mjs` checks the rule, the shipped canon (three players) and that no
  shipped library module changes instrument.
- The BaseNote normally pins nothing, so a line that starts from it resolves to
  `audio.defaultInstrument`. That is what makes the setting reach ordinary compositions. A BaseNote
  that *does* pin an instrument in its JSON overrides the setting for everything below it.

`audio.defaultInstrument` is read at boot and re-applied on `settings:changed` (`player.js:1053-1068`)
via `setDefaultInstrument()`. It is resolved once per note when playback is prepared, so a change
takes effect on the **next** playback, not mid-playback.

## Adding an instrument

Extend `SynthInstrument`, set the knobs, register it.

```javascript
import { SynthInstrument } from './instrument-manager.js';

export class MyInstrument extends SynthInstrument {
  constructor(audioContext) {          // the AudioContext, not a name
    super(audioContext);
    this.name = 'my-instrument';       // registry key, lowercased
    this.waveType = 'sawtooth';
    // unisonCount / detuneCents exist, but no built-in voice uses them: a detuned
    // unison makes a single note beat and hides whether a chord is pure
    this.filterTrackMul = 8;
  }

  // Seconds. `frequency` is the pitch that sounds, for envelopes that follow it.
  getEnvelopeSettings(duration, frequency) {
    return {
      attack: 0.01,    // from the note's start
      decay: 0.2,      // then a fall to `sustain`
      sustain: 0.6,    // fraction of the peak, held to the note's end
      release: 0.15    // rings after the note's end
    };
  }
}
```

Then register it in **two** places, and list it in a third:

1. the `SynthInstruments` object in `src/main.js` — this is the one the app passes to
   `audioEngine.registerInstruments()`, and it names each class explicitly, so a class missing from
   it is never registered;
2. the `SynthInstruments` map exported from `src/instruments/synth-instruments.js`, which the app
   itself does not read but `scripts/perf/check-purity.mjs` does;
3. `INSTRUMENTS` in `src/settings/settings-panel.js:103`, so it appears in the Settings dropdown.

If you need a voice the base class cannot build, override `createOscillator(frequency)` and return
`makeVoice(sources, output, frequency, onStart)`. Do not return raw nodes unless a bare
`OscillatorNode` is genuinely what you want — it happens to satisfy the contract, but nothing else
does.

## Not implemented

- **No velocity or dynamics.** Every note plays at the same peak (0.2). `zones[].velLayers[]` is
  reserved and unread.
- **No custom sample loading**, no user-supplied instruments, no per-instrument volume or mix UI.
- **No note audition.** Instruments are only heard through transport playback. Clicking or dragging a
  note is silent.

## See also

- [Audio Engine](/developer/audio/audio-engine) — how a voice is scheduled and torn down
- [Audio Graph](/developer/audio/audio-graph) — the per-instrument buses a voice connects into
- [Instruments (User Guide)](/user-guide/playback/instruments) — picking one, from the user's side
