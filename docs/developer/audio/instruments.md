---
title: Instruments
description: The voice contract, the shared click-free envelope, the seven synth instruments, the two multisampled ones, and how to add your own.
---

# Instruments

Nine instruments ship: **seven synthesized** and **two multisampled**. All of them implement one
small contract, and all of them share one envelope function. Get those two things right and the rest
of this page is detail.

| Name (the exact registered string) | Kind | How it is built |
|---|---|---|
| `sine-wave` | synth | single sine oscillator — the **default** |
| `square-wave` | synth | square, 3-osc unison at ±4 ¢, pitch-tracked lowpass at 12× |
| `sawtooth-wave` | synth | sawtooth, 3-osc unison at ±4 ¢, pitch-tracked lowpass at 10× |
| `triangle-wave` | synth | single triangle oscillator |
| `organ` | synth | single oscillator with a **10-harmonic `PeriodicWave`** |
| `vibraphone` | synth | single oscillator with a **16-harmonic `PeriodicWave`** |
| `fm-epiano` | synth | **2-operator FM** — sine carrier, sine modulator, decaying index |
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

Build one with `makeVoice()` (`instrument-manager.js:73`):

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

One function shapes every note, synth and sample alike:

```javascript
applyVoiceEnvelope(gainNode, startTime, duration, peak, env)
```

`instrument-manager.js:28`. `env` comes from the instrument's `getEnvelopeSettings()`, and the keys
are:

```javascript
{ attackTimeRatio, decayTimeRatio, sustainLevel, releaseTimeRatio }
```

::: danger Not `{ attack, decay, sustain, release }`
Every old example on this page used the short names. They do not exist. Attack, decay and release
are **ratios of the note's duration**; sustain is a **fraction of peak**. Defaults if an instrument
omits them: `0.01 / 0.05 / 0.7 / 0.05`.
:::

### The shape

```
gain
  │      ╱‾╲
  │     ╱   ╲___________
  │    ╱                ╲
  │   ╱                  ╲
  └──┴────┴──────────────┴─┴──── time
     A    D              R  └ hard zero at end + 4 ms
     └──────── duration ────┘
```

1. `setValueAtTime(EPS, t0)` — start at ~0, not at 0, because exponential ramps cannot touch zero.
2. **Linear** attack to `peak`.
3. **Exponential** decay to `sustain` (skipped if `decay` is negligible or `sustain >= peak`).
4. Hold sustain.
5. **Exponential** release to `EPS` at the note end.
6. `linearRampToValueAtTime(0, end + 0.004)` — a hard zero 4 ms past the end, so the source can be
   stopped cleanly.

### The floors — this is what kills clicks

| Constant | Value | Why |
|---|---|---|
| `ATTACK_FLOOR` | **0.003 s** | An attack shorter than 3 ms is a step, and a step is a click. |
| `RELEASE_FLOOR` | **0.015 s** | Same at the other end. |
| `EPS` | `0.0001` | Exponential ramps cannot reach 0. |
| duration floor | `0.001 s` | `dur = Math.max(0.001, duration)`. |

Attack and release are **scaled down together** if they would exceed **90% of the note**, leaving at
least 10% of body. So a 5 ms note still gets a real attack and a real release, proportionally
squeezed, rather than a rectangle.

The envelope always reaches zero **inside** `[start, start + duration]`. Note lengths are unchanged
by it. The engine stops the source `RELEASE_TAIL = 0.15 s` later, while it is already silent.

### Per-instrument settings

Attack / decay / release are ratios of duration; sustain is a fraction of peak.

| Instrument | Wave | Unison | Detune | Filter (mul / Q) | A | D | S | R |
|---|---|---|---|---|---|---|---|---|
| `sine-wave` | sine | 1 | — | — | 0.1 | 0.1 | 0.7 | 0.2 |
| `square-wave` | square | 3 | ±4 ¢ | 12× / 0.7 | 0.05 | 0.1 | 0.6 | 0.2 |
| `sawtooth-wave` | sawtooth | 3 | ±4 ¢ | 10× / 0.7 | 0.05 | 0.15 | 0.6 | 0.2 |
| `triangle-wave` | triangle | 1 | — | — | 0.15 | 0.1 | 0.8 | 0.25 |
| `organ` | periodic (10 harm.) | 1 | — | — | 0.05 | 0.05 | 0.9 | 0.1 |
| `vibraphone` | periodic (16 harm.) | 1 | — | — | 0.02 | 0.3 | 0.3 | 0.5 |
| `fm-epiano` | 2-op FM | — | — | — | 0.005 | 0.4 | 0.5 | 0.3 |
| `piano` / `violin` | sampled | — | — | — | 0.02 | **0** | **1** | 0.12 |

The per-note `peak` is `initialVolume` — **0.2** (`player.js:36`, and the `AudioEngine` constructor
default). That is not master volume; master volume lives on the
[audio graph](/developer/audio/audio-graph#master-volume).

## SynthInstrument

`instrument-manager.js:95`. Subclasses set fields; the base class builds the voice.

```javascript
export class SquareInstrument extends SynthInstrument {
  constructor(audioContext) {
    super(audioContext);
    this.name = 'square-wave';
    this.waveType = 'square';
    this.unisonCount = 3;      // 3 detuned oscillators
    this.detuneCents = 4;      // edges land at ±4 cents
    this.filterTrackMul = 12;  // lowpass at 12 × the note frequency
    this.filterQ = 0.7;
  }

  getEnvelopeSettings() {
    return { attackTimeRatio: 0.05, decayTimeRatio: 0.1, sustainLevel: 0.6, releaseTimeRatio: 0.2 };
  }
}
```

| Field | Default | Effect |
|---|---|---|
| `waveType` | `'sine'` | Used when `periodicWave` is unset. |
| `periodicWave` | `null` | Set it and `waveType` is ignored. `organ` and `vibraphone` do this. |
| `unisonCount` | `1` | `n` oscillators summed through a gain of **`1/√n`**, so perceived level stays constant. |
| `detuneCents` | `0` | Spread symmetrically: the **edge** voices land at ±`detuneCents`, the centre at 0. |
| `filterTrackMul` | `0` | `> 0` adds a per-voice biquad lowpass at `clamp(max(200, freq × mul), ≤ 0.95 × Nyquist)`. |
| `filterQ` | `0.7` | Q of that filter. |

`fm-epiano` is the one synth that overrides `createOscillator()` outright
(`synth-instruments.js:192`): a sine carrier, a sine modulator at a 1:1 ratio, and a `modGain` whose
value is `index × modFreq` feeding `carrier.frequency`. The index decays exponentially from **4** to
**0.6** over **0.28 s**, scheduled inside the voice's `start()` so it locks to the note's absolute
start.

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
source.playbackRate.value = frequency / zone.rootHz;
```

into a biquad — **lowpass** at `min(0.48 × sampleRate, 16000 / √ratio)` when shifting up, **highpass**
at `max(20, 60 × √ratio)` when shifting down, `Q = 0.5` either way.

`applyEnvelope()` multiplies the peak by `this.gain` (from the manifest's `gainDb`) and then calls the
shared `applyVoiceEnvelope`.

### The manifest (schema 1)

```json
{
  "schema": 1,
  "name": "piano",
  "displayName": "Upright Piano",
  "license": { "id": "CC0-1.0", "source": "VSCO-2 Community Edition", "author": "…", "url": "…" },
  "gainDb": 2,
  "envelope": { "attack": 0.004, "release": 0.25 },
  "zones": [
    { "root": "C1", "rootHz": 32.703, "lowHz": 0, "highHz": 40.03, "url": "C1.m4a" }
  ]
}
```

Of those fields, exactly **one** reaches the sound: `gainDb`, applied as `peak × 10^(gainDb/20)`.

::: warning `envelope` in the manifest does nothing
`_loadManifest()` parses it into `this.envelope`, but `getEnvelopeSettings()` returns **hardcoded**
ratios (`0.02 / 0 / 1 / 0.12`) and `applyEnvelope()` never reads `this.envelope`. Editing `attack` or
`release` in a manifest changes nothing. `displayName` and `license` are parsed and likewise never
rendered anywhere in the app. `zones[].loop` and `zones[].velLayers[]` are reserved and not even
parsed.
:::

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
ffmpeg -ac 1 -t 3.5 \
  -af silenceremove=start_periods=1:start_threshold=-45dB,afade=t=out:st=3.4:d=0.1 \
  -c:a aac -b:a 96k -movflags +faststart
```

Zone boundaries are the **geometric mean** of adjacent roots. The output is committed; the sources
are not.

::: danger No sample looping
Every source sample is capped at **3.5 s** (with a 0.1 s tail fade from 3.4 s). A held note longer
than its sample plays the sample out and is then **silent for the rest of its duration**. This bites
long sustained `violin` notes hardest. There is no loop-point support — `zones[].loop` is reserved
and unread.
:::

## Registration

```javascript
// src/main.js, at module load
audioEngine.registerInstruments(SynthInstruments, SampleInstruments);
```

which calls `instrumentManager.registerBuiltInInstruments(SynthInstruments, SampleInstruments)`
(`instrument-manager.js:284`). It instantiates every class value in both maps, passing the
`AudioContext` to the constructor, and skips any class literally named `SampleInstrument`.

The single-instrument entry point is **`registerInstrument(instrument)`** — not `register()` — and it
keys the registry on `instrument.name.toLowerCase()`.

```javascript
instrumentManager.registerInstrument(new MyInstrument(audioContext));
instrumentManager.getAvailableInstruments();  // registered keys, in registration order
```

::: warning Two different defaults, both spelled `sine-wave`
`InstrumentManager.defaultInstrument` (`:281`) is a **hardcoded** unknown-name fallback. It never
follows the settings system. `module.js`'s `_defaultInstrumentName` is the **inheritance** fallback,
and it *does* follow `audio.defaultInstrument`.

Consequence: a module saved with `"instrument": "cello"` always plays as `sine-wave` (with a
`console.warn`), even if the user set the default instrument to `piano`. Instrument names are not
validated on module import.
:::

The Settings → Audio dropdown is a **hardcoded list** in `settings-panel.js:98`. It currently matches
the registry exactly, but a newly registered instrument will not appear there automatically.

## Instrument inheritance

A note usually carries no instrument of its own. `Module.findInstrument(note)` (`module.js:745`)
resolves one, in this order:

1. The note has its own `instrument` property → **use it**. An explicit pin always wins.
2. Otherwise, look at the note's **frequency expression**:
   - the **first** `[N].f` reference → recurse into note *N*;
   - else, if it contains `base.f` → recurse into the BaseNote.
3. Nothing matched → the global default, `audio.defaultInstrument`.

<details>
<summary>Legacy JavaScript syntax</summary>

For a module still in the legacy method-chain format, step 2 matches
`module.getNoteById(N).getVariable('frequency')` and then
`module.baseNote.getVariable('frequency')` instead. Both formats are supported.

</details>

Three consequences worth stating plainly:

- **Inheritance follows frequency only.** A note whose `startTime` depends on note 5 but whose
  frequency is a bare literal inherits nothing from note 5.
- **Only the first reference is followed.** `[3].f * [7].f / base.f` inherits from note **3**.
- The BaseNote normally pins nothing, so it — and everything chaining up to it — resolves to
  `audio.defaultInstrument`. That is what makes the setting reach ordinary compositions. A BaseNote
  that *does* pin an instrument in its JSON overrides the setting for everything below it.

`audio.defaultInstrument` is read at boot and re-applied on `settings:changed` (`player.js:1176-1189`)
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
    this.unisonCount = 2;
    this.detuneCents = 7;
    this.filterTrackMul = 8;
  }

  getEnvelopeSettings() {
    return {
      attackTimeRatio: 0.05,   // fraction of the note's duration
      decayTimeRatio: 0.2,
      sustainLevel: 0.6,       // fraction of peak
      releaseTimeRatio: 0.15
    };
  }
}
```

Then add it to the `SynthInstruments` map in `src/instruments/synth-instruments.js` (it is picked up
by `registerBuiltInInstruments`), and add the name to `INSTRUMENTS` in
`src/settings/settings-panel.js:98` so it appears in the Settings dropdown.

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
- **No group "set instrument" action.** The group widget has exactly two actions.

## See also

- [Audio Engine](/developer/audio/audio-engine) — how a voice is scheduled and torn down
- [Audio Graph](/developer/audio/audio-graph) — the per-instrument buses a voice connects into
- [Instruments (User Guide)](/user-guide/playback/instruments) — picking one, from the user's side
