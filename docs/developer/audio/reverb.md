---
title: Reverb
description: How RMT Compose synthesises its stereo reverb impulse response at runtime — decorrelated noise, exponential decay, early reflections, a damping sweep, and no shipped audio assets.
---

# Reverb

RMT Compose ships **no reverb assets**. The impulse response fed to the `ConvolverNode` is
synthesised in the browser, at runtime, by `generateImpulseResponse()` in `src/player/reverb.js`
(153 lines: one exported pure function, two clamp helpers, no state).

That is a licensing decision as much as a size one: a recorded IR would drag someone else's licence
into an MIT-licensed repo. Rendering our own keeps the relicense clean.

Reverb is **on by default** (`audio.reverb.enabled: true`, `settings-schema.js:72`) at 25% wet.

## The function

```javascript
import { generateImpulseResponse } from './player/reverb.js';

const ir = await generateImpulseResponse(audioContext, {
  roomSize: 0.5,   // [0, 1]     — clamped
  decaySec: 1.8,   // [0.1, 12]  — clamped
  damping: 0.5,    // [0, 1]     — clamped
  sampleRate: 48000  // optional; defaults to audioContext.sampleRate, then 44100
});
```

Returns a `Promise<AudioBuffer>` — a **stereo** buffer, rendered in an
`OfflineAudioContext(2, length, sampleRate)`. The `audioContext` argument is used only for its
sample rate.

Throws `Error('OfflineAudioContext unavailable')` if neither `OfflineAudioContext` nor
`webkitOfflineAudioContext` exists. `AudioGraph._regenIR()` catches this, warns, and leaves the
convolver with whatever buffer it had.

## What gets rendered

The IR is **`decaySec + 0.12` seconds** long — the decay time plus a short pad so the tail is not
clipped.

### 1. Decorrelated stereo noise

Each channel is filled with **independent** white noise. Independent, not a copy: that is what makes
the tail wide rather than a mono blob in the centre.

### 2. An exponential decay envelope

```
amplitude(t) = noise · build(t) · e^(−t · ln(1000) / decaySec)
```

`ln(1000)` (`LN1000 = 6.907755278982137`) puts the envelope at roughly **−60 dB at `decaySec`**, so
the slider means what a reverb slider is supposed to mean.

### 3. A build-up ramp, not a hard onset

`build(t)` ramps the noise density in linearly over the early-reflection window, instead of starting
at full scale at sample 0. A real room's diffuse field *builds up*; it does not exist at full
strength the instant the impulse fires.

::: info Be honest about what this buys
It takes about 2.5 dB off the first 50 ms of the impulse response, and **nothing** off the peak.
Because `convolver.normalize = true`, the node rescales by total IR energy — so most of the energy
the ramp removes is handed straight back as normalisation gain. Net, the late tail you hear in a
musical rest comes out about **1 dB hotter**, not quieter.

It is kept because a build-up is the physically right shape, not because it quiets anything. The
levers on rest-tail level are `decaySec` and `wet`.
:::

### 4. Early reflections — the "size" cue

Seven discrete taps per channel are added inside the early-reflection window:

```
erWindowSec = max(0.006, roomSize × 0.08)      // 6 ms floor, up to 80 ms
tap_i       = floor(frac_i × erWindowSec × sampleRate)
data[tap_i] += (1 − frac_i) × 0.5 × ±1          // sign randomized per tap
```

The tap fractions are **irregular and different per channel**:

```javascript
const ER_TAPS_L = [0.043, 0.137, 0.271, 0.409, 0.577, 0.719, 0.907];
const ER_TAPS_R = [0.079, 0.191, 0.323, 0.463, 0.617, 0.787, 0.953];
```

They are irregular on purpose. An earlier version placed the taps on a *uniform* `(e + k) / 7`
grid — which is a comb filter. At the default room size the taps landed 274.3 samples (5.715 ms)
apart, putting comb teeth every 175 Hz across the wet path (autocorrelation of the tap spectrum at
175 Hz: 0.977). These offsets bring that to −0.05, i.e. no periodicity.

::: info This was hygiene, not a fix
In the rendered IR the taps sit ~29 dB below the noise bed. The comb was undetectable in the output
either way. Do not go looking for the "before" sound; there isn't one.
:::

`roomSize` does exactly one thing: it sets the width of that window. At the default 0.5 the early
reflections span 40 ms.

### 5. Damping — a lowpass that sweeps down across the tail

Air and surfaces eat the highs, so a tail has to get darker as it decays. A fixed lowpass cannot do
that. This one sweeps:

```javascript
hiCut = 16000 − damping × 10000;                    // 16 kHz … 6 kHz
loCut = Math.max(250, hiCut × Math.pow(0.08, damping));

lp.frequency.setValueAtTime(hiCut, 0);
lp.frequency.exponentialRampToValueAtTime(loCut, durationSec);
lp.Q.value = 0.2;
```

| `damping` | Sweeps from | …down to |
|---|---|---|
| `0` | 16 kHz | 16 kHz (no sweep) |
| **`0.5`** (default) | **~11 kHz** | **~3.1 kHz** |
| `1` | 6 kHz | 480 Hz |

Note what darkening does to the *shares*: at the default damping, 52% of the IR's energy sits above
5 kHz (the previous law left 64% there), while the 1–5 kHz share **rises** from 29% to 39% — because
the band above it shrank, not because anything was added.

### 6. A fixed highpass, so the tail doesn't boom

A gentle highpass at **120 Hz**, `Q = 0.2`, ahead of the lowpass in the chain:

```
noise source → highpass (120 Hz) → lowpass (damping sweep) → offline destination
```

## Parameters, and which ones cost a render

| Setting | Default | Range | Needs a new IR? |
|---|---|---|---|
| `audio.reverb.roomSize` | `0.5` | 0–1 | **Yes** |
| `audio.reverb.decaySec` | `1.8` | 0.1–12 | **Yes** |
| `audio.reverb.damping` | `0.5` | 0–1 | **Yes** |
| `audio.reverb.preDelayMs` | `20` | 0–200 | No — live `DelayNode` param |
| `audio.reverb.wet` | `0.25` | 0–1 | No — live gain on `reverbReturn` |
| `audio.reverb.enabled` | `true` | on/off | No — ramps the sends and return to 0 |

Re-renders are **debounced by 250 ms** and **token-guarded**, so a slider drag renders once at the
end and a stale render never wins the swap-in race. That machinery lives in
[`AudioGraph`](/developer/audio/audio-graph#which-reverb-params-force-a-re-render), not here — this
function is pure and knows nothing about settings.

An IR is also generated **at construction, even when reverb is off**, so the first time a user
enables it there is no pause and no pop. Offline rendering works fine while the `AudioContext` is
still suspended.

## A known limitation you cannot fix

A **sustained tone's reverb tail warbles** — measured at roughly 5.5 dB standard deviation around the
smooth decay, at about 3.4 Hz.

This is Rayleigh statistics, not a bug in the algorithm. The tail of a narrowband input is the IR's
spectrum sampled over a narrow band, and *every* IR with a random spectrum does this — recorded ones
included.

::: warning Allpass "diffusion" cannot help
An allpass filter leaves `|H(f)|` unchanged by construction. Adding diffusion stages to the IR will
not smooth the warble, and any proposal to do so is founded on a misunderstanding. The only levers on
how present the tail is in a musical rest are **`decaySec`** and **`wet`** — `1.0 / 0.12` measures
−19 dB against the shipped `1.8 / 0.25`.
:::

## Notes for maintainers

- `Math.random()` for the noise is fine here. This function never runs inside a workflow script, and
  the IR is not required to be reproducible.
- Nothing in this file reads settings, touches the DOM, or holds state. If you need to test it, call
  it directly with an offline-capable context and inspect the returned buffer.
- The IR is rendered *per parameter change*, not per note. A render costs an
  `OfflineAudioContext.startRendering()` over `decaySec + 0.12` seconds of audio — cheap, but not
  free at `decaySec = 12`.

## See also

- [Audio Graph](/developer/audio/audio-graph) — the send/return the IR plugs into, and the regen guard
- [Audio Engine](/developer/audio/audio-engine) — why a Stop without a declick fade smears through the convolver
- [Settings](/user-guide/interface/settings) — the Room / Reverb controls
