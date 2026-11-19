---
title: Instruments
description: The voice contract, the shared click-free envelope, the nine synth instruments, the two multisampled ones, and how to add your own.
---

# Instruments

Eleven instruments ship: **nine synthesized** and **two multisampled**. All of them implement one
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
| `harmonium` | synth | single oscillator, `PeriodicWave` with **every partial 1–16**, fixed-time envelope |
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

Build one with `makeVoice()` (`instrument-manager.js:126`):

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
applyVoiceEnvelope(gainNode, startTime, duration, peak, env, shape)
```

`instrument-manager.js:31`. `env` comes from the instrument's `getEnvelopeSettings()`, and the keys
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

### The note's own attack and release

`shape` is `{ attack, release }`, the note's `attack` and `release` variables (its own, else the
BaseNote's), each a **share of the note's own duration** (`1/8` is an eighth of it) or `null`. A given
value replaces the instrument's `attackTimeRatio` or `releaseTimeRatio` for that note; a `null` leaves
the instrument's ratio (defaults `0.01` and `0.05`). The values are clamped to 0 to 1 (`noteShape()` in
`src/instruments/instrument-manager.js`). `envelopeTimes()` turns the ratios into seconds:

- The anti-click floors stay: `ATTACK_FLOOR` 3 ms and `RELEASE_FLOOR` 15 ms still apply to a note's own
  values.
- When the note's own attack plus release exceed its duration, they are scaled down together to fit.
  A note that sets either one may use the whole duration (attack `1` is a swell to the end); instrument
  defaults still leave at least 10% as the body.
- `envelopeShares()` returns the same envelope as fractions of the duration. The renderer draws it
  inside the note, so what is seen is what is heard.

Every `applyEnvelope()` in the instrument classes takes the `shape` as its last argument and passes it
to `applyVoiceEnvelope()`.

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
| `harmonium` | periodic (16 harm.) | 1 | — | — | **30 ms** | **0** | **1** | **80 ms** |
| `harmonium-soft` | periodic (16 harm.) | 1 | — | — | **60 ms** | **0** | **1** | **120 ms** |
| `piano` / `violin` | sampled | — | — | — | 0.02 | **0** | **1** | 0.12 |

The two `harmonium` rows are **seconds, not ratios** — see [The harmonic voices](#the-harmonic-voices).

The per-note `peak` is `initialVolume` — **0.2** (`player.js:77`, and the `AudioEngine` constructor
default). That is not master volume; master volume lives on the
[audio graph](/developer/audio/audio-graph#master-volume). Three instruments scale it: `piano` by its
manifest's `gainDb`, `harmonium` by a `level` of 0.6 and `harmonium-soft` by 0.42.

## SynthInstrument

`instrument-manager.js:148`. Subclasses set fields; the base class builds the voice.

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
| `periodicWave` | `null` | Set it and `waveType` is ignored. `organ`, `vibraphone` and the two harmonium voices do this. |
| `unisonCount` | `1` | `n` oscillators summed through a gain of **`1/√n`**, so perceived level stays constant. |
| `detuneCents` | `0` | Spread symmetrically: the **edge** voices land at ±`detuneCents`, the centre at 0. |
| `filterTrackMul` | `0` | `> 0` adds a per-voice biquad lowpass at `clamp(max(200, freq × mul), ≤ 0.95 × Nyquist)`. |
| `filterQ` | `0.7` | Q of that filter. |

`fm-epiano` is the one synth that overrides `createOscillator()` outright
(`synth-instruments.js:192`): a sine carrier, a sine modulator at a 1:1 ratio, and a `modGain` whose
value is `index × modFreq` feeding `carrier.frequency`. The index decays exponentially from **4** to
**0.6** over **0.28 s**, scheduled inside the voice's `start()` so it locks to the note's absolute
start.

### The harmonic voices

`harmonium` and `harmonium-soft` are two three-line subclasses of `HarmonicVoice`
(`synth-instruments.js:265`), a `SynthInstrument` that is deliberately **not** exported in the
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

**The envelope is in seconds.** `getEnvelopeSettings(duration)` converts the two times into the
ratios `applyVoiceEnvelope` takes — the same move `MultisampleInstrument` makes for its manifest —
with no decay stage and a sustain of 1:

```javascript
{ attackTimeRatio: attackSec / duration, decayTimeRatio: 0, sustainLevel: 1, releaseTimeRatio: releaseSec / duration }
```

`applyEnvelope()` is overridden to pass `duration` through and to apply `level`. The shared floors
and the 90% clamp still hold: on a note shorter than `(attackSec + releaseSec) / 0.9` the two are
squeezed proportionally.

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
source.playbackRate.value = frequency / zone.rootHz;
```

into a biquad — **lowpass** at `min(0.48 × sampleRate, 16000 / √ratio)` when shifting up, **highpass**
at `max(20, 60 × √ratio)` when shifting down, `Q = 0.5` either way.

`applyEnvelope()` multiplies the peak by `this.gain` (from the manifest's `gainDb`) and then calls the
shared `applyVoiceEnvelope` with `getEnvelopeSettings(duration)` and the note's `shape` — the note's duration is what lets
the manifest's absolute `attack`/`release` seconds be converted to per-note ratios.

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

Two of those fields reach the sound: `gainDb`, applied as `peak × 10^(gainDb/20)`, and `envelope`.

**How `envelope` is honored.** `_loadManifest()` merges `m.envelope` over the defaults
(`{ attack: 0.006, release: 0.18 }`), and `getEnvelopeSettings(duration)` builds the per-note
envelope from it:

- The base is the default ratio set `attackTimeRatio 0.02 / decayTimeRatio 0 / sustainLevel 1 /
  releaseTimeRatio 0.12`. A manifest may declare any of those **ratio keys directly** and they are
  taken as-is.
- `attack` and `release` are **absolute seconds**: when the note's duration is known they override
  the ratios as `attack / duration` and `release / duration`, so a 4 ms attack is 4 ms whether the
  note lasts 0.2 s or 4 s.
- The result still passes through `applyVoiceEnvelope`'s guards — the 3 ms attack / 15 ms release
  floors, and the clamp that keeps attack+release inside ~90% of the note.

`displayName` and `license` are parsed and never rendered anywhere in the app. `zones[].loop` and
`zones[].velLayers[]` are reserved and not even parsed.

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
(`instrument-manager.js:343`). It instantiates every class value in both maps, passing the
`AudioContext` to the constructor, and skips any class literally named `SampleInstrument`.

The single-instrument entry point is **`registerInstrument(instrument)`** — not `register()` — and it
keys the registry on `instrument.name.toLowerCase()`.

```javascript
instrumentManager.registerInstrument(new MyInstrument(audioContext));
instrumentManager.getAvailableInstruments();  // registered keys, in registration order
```

::: warning Two different defaults, both spelled `sine-wave`
`InstrumentManager.defaultInstrument` (`instrument-manager.js:340`) is a **hardcoded** unknown-name fallback. It never
follows the settings system. `module.js`'s `_defaultInstrumentName` is the **inheritance** fallback,
and it *does* follow `audio.defaultInstrument`.

Consequence: a module saved with `"instrument": "cello"` always plays as `sine-wave` (with a
`console.warn`), even if the user set the default instrument to `piano`. Instrument names are not
validated on module import.
:::

The Settings → Audio dropdown is a **hardcoded list** in `settings-panel.js:98`. It currently matches
the registry exactly, but a newly registered instrument will not appear there automatically.

## Instrument inheritance

A note usually carries no instrument of its own. `Module.findInstrument(note)` (`module.js:765`)
resolves one, in this order:

1. The note has its own `instrument` property → **use it**. An explicit pin always wins.
2. Otherwise, look at the note's **frequency expression**:
   - the **first** `[N].f` reference → recurse into note *N*;
   - else, if it contains `base.f` → recurse into the BaseNote.
3. Nothing matched → the global default, `audio.defaultInstrument`.

Three consequences worth stating plainly:

- **Inheritance follows frequency only.** A note whose `startTime` depends on note 5 but whose
  frequency is a bare literal inherits nothing from note 5.
- **Only the first reference is followed.** `[3].f * [7].f / base.f` inherits from note **3**.
- The BaseNote normally pins nothing, so it — and everything chaining up to it — resolves to
  `audio.defaultInstrument`. That is what makes the setting reach ordinary compositions. A BaseNote
  that *does* pin an instrument in its JSON overrides the setting for everything below it.

`audio.defaultInstrument` is read at boot and re-applied on `settings:changed` (`player.js:1042-1057`)
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

Then register it in **two** places, and list it in a third:

1. the `SynthInstruments` object in `src/main.js` — this is the one the app passes to
   `audioEngine.registerInstruments()`, and it names each class explicitly, so a class missing from
   it is never registered;
2. the `SynthInstruments` map exported from `src/instruments/synth-instruments.js`, which the app
   itself does not read but `scripts/perf/check-purity.mjs` does;
3. `INSTRUMENTS` in `src/settings/settings-panel.js:98`, so it appears in the Settings dropdown.

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
