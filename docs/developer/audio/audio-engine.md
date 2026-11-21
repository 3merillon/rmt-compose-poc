---
title: Audio Engine
description: AudioEngine owns the AudioContext, prepares note data, schedules voices just in time, and implements play, pause, stop and loop playback.
---

# Audio Engine

`AudioEngine` (`src/player/audio-engine.ts`) is the transport's back end. It owns the
`AudioContext`, builds the [signal graph](/developer/audio/audio-graph), holds the
[instrument registry](/developer/audio/instruments), and turns a module into sound with a
[streaming scheduler](/developer/audio/streaming).

It does **not** own transport state. `isPlaying`, the playhead and the loop icon live in
`src/player.ts`; the engine only exposes the primitives that transport drives.

## The singleton

```javascript
import { audioEngine } from './player/audio-engine.ts';
```

`audio-engine.ts` ends with `export const audioEngine = new AudioEngine()`. That runs at
**module import time**, so the `AudioContext` — and with it the whole `AudioGraph`, including the
first offline reverb render — exists before the user has touched anything.

::: warning The context starts suspended
Browsers hand you a suspended `AudioContext` until a user gesture resumes it. Everything below
that touches `ctx.currentTime` still works while suspended (the clock just does not advance), which
is why `setMasterVolume` has a `ctx.state !== 'running'` branch. Call [`unlock()`](#unlock) from a
real gesture before you expect sound.
:::

## Constructor

```javascript
const engine = new AudioEngine({ initialVolume: 0.2, rampTime: 0.2 });
```

| Option | Default | Meaning |
|---|---|---|
| `initialVolume` | `0.2` | Peak gain of a single note's envelope. **Not** the master volume. |
| `rampTime` | `0.2` | Default fade length for `pauseFade()`, in seconds. |

The shipped singleton is constructed with **no options** (`audio-engine.ts`), so both defaults
apply as written. Nothing overrides them: `src/player.ts` declares its own `INITIAL_VOLUME` and
`GENERAL_VOLUME_RAMP_TIME` at the same `0.2`, and passes them per call to `play()` and `pauseFade()`.

Master volume is a separate thing entirely and lives on the graph — see [`setVolume()`](#setvolume).

## nodes()

```javascript
const { audioContext, generalVolumeGainNode, compressor, instrumentManager } = audioEngine.nodes();
```

Two of those keys are **back-compat aliases**, not separate nodes:

| Key | Actually returns |
|---|---|
| `generalVolumeGainNode` | `graph.masterGain` |
| `compressor` | `graph.limiter` |

There is no "general volume" node and no compressor any more. The names survive because
`player.ts` destructures them. New code should reach through `audioEngine.graph`.

## unlock()

```javascript
playPauseBtn.addEventListener('pointerdown', () => {
  audioEngine.unlock();   // synchronous, first statement, nothing awaited before it
});
```

`unlock()` (`audio-engine.ts`) is **synchronous by contract**. It resumes the context if it is
suspended, then — once, guarded by `_unlocked` — starts a silent one-sample buffer into
`ctx.destination`.

Both halves matter, and `ensureResumed()` is not a substitute for either:

- Mobile Safari grants audio on **transient activation**. `resume()` has to be called from inside
  the gesture's own task, not merely at some point after the user touched the page. The play
  button's loop gesture fires from a 500 ms `setTimeout`, and a timer callback is not a gesture —
  so the `resume()` buried inside `preparePlayback()` is too late by definition. The symptom before
  the fix: the very first long-press on a freshly loaded page armed loop mode and played **silence**,
  while every long-press after any normal tap worked.
- The context can report `running` and still stay muted on iOS until a source has actually been
  *started* inside a gesture. That is what the silent buffer is for.

Its only call site is the `pointerdown` handler on `#playPauseBtn` (`player.ts`). If you add
another entry point to playback, it needs this call too.

## ensureResumed()

```javascript
await audioEngine.ensureResumed();
```

Resumes a suspended context, awaiting the promise. Fine for a click that leads directly to
playback; useless for unlocking iOS from a timer. Use `unlock()` for that.

## preparePlayback()

```javascript
const noteDataList = await audioEngine.preparePlayback(module, fromTime);
```

Evaluates the module and returns a plain array — **no oscillators are created here**. Each entry:

```javascript
{
  id: 3,
  startTime: 0.5,      // seconds, relative to fromTime
  duration: 0.25,
  frequency: 440,      // null for a silence or a measure bar
  temperedFrequency: 442.3,  // the same pitch on the nearest of 12 equal steps from the BaseNote; null when there is no frequency
  instrument: 'piano', // null when there is no frequency; lowercased
  amplitude: 1,        // gain on the envelope peak, clamped to 0..4; 1 when unset
  attack: 0.125,       // the note's own (else the BaseNote's) attack as a share of its duration; null when neither sets one
  release: null,       // likewise for release; null means the instrument's own envelope applies
  panPos: 0.33         // null when there is no frequency
}
```

The BaseNote never sounds, although it has a duration now (the time unit), so it is skipped. Attack
and release are the evaluated values, passed on as shares of the note's own duration, converted with
`toNumber()`; the clamp happens later, in the envelope (the attack to `[0, 1]`, the release to `[0, 4]`).

What it does, in order (`audio-engine.ts`):

1. Resumes the context if suspended.
2. Reads `module.getModuleEndTime()` and the evaluation cache.
3. Keeps a note when `noteEnd > fromTime && noteStart < moduleEndTime`. A note **straddling**
   `fromTime` is truncated — its `startTime` becomes 0 and its `duration` is shortened. That is why
   a prepared list is only valid for the pass it was prepared for.
4. Resolves the instrument per note via `module.findInstrument(note, memo)`, lowercased and memoised (one memo per pass, so each line is walked once), and the note's player via `module.findPlayer(note, memo)`: `player` (the first note of its line) and `prev` (its line predecessor) go on the note's data. Nothing audible uses them yet.
5. Resolves `baseF` from the evaluation cache's note 0, **falling back to 440 Hz** if the BaseNote
   has no usable frequency (`audio-engine.ts`), and computes `panPos` with
   `graph.panPosition(freq, baseF)` and `temperedFrequency` with
   [`temperedFrequency(freq, baseF)`](#tempered-playback). Both are always computed, whatever the
   settings say: which pitch sounds, and whether the pan is used, is decided per voice when it is
   scheduled.
6. Sorts by `startTime`.
7. Preloads exactly the multisample zones the upcoming notes will hit, by calling
   `instrument.prepare(freqs)` with the frequency list each instrument may play — both pitches of
   every note, since the two can fall in different zones.
8. Resolves.

::: warning It does not reject
On a sample-load failure it logs and resolves `[]` (`audio-engine.ts`). There is no
autoplay-policy rejection path to catch here — `preparePlayback` never throws `NotAllowedError`.
:::

## play()

```javascript
const baseStartTime = audioEngine.play(noteDataList, {
  initialVolume: 0.2,
  loop: { period, notes, firstCycleAudioLength }   // optional
});
```

Returns the audio-clock start time. The opening gets at least 100 ms of preparation, with extra lead when many voices enter together.

`play()` stops any existing streaming, builds the streaming state, and runs the pump immediately.
The pump's mechanics — the time bases, the multiplicative pass advance, the loop wrap — are
covered in [Streaming Scheduler](/developer/audio/streaming).

### Loop API

| Method | Behaviour |
|---|---|
| `armLoop(loop)` | Turns looping on for a playback **already in flight**, with no audio restart. Restarts the pump if it had already retired. Returns `boolean`. |
| `disarmLoop()` | Stops looping but lets the pass in flight finish. Returns the absolute ctx time of the final seam, or `null`. |
| `isLooping()` | Whether the loop is currently armed. |
| `getLoopEndTime()` | Absolute ctx time of the final seam once disarmed, else `null`. |

A loop descriptor is validated by `_applyLoop()` and **refused** if the period is
non-finite or `< MIN_LOOP_PERIOD` (0.05 s), if the note array is empty, or if no entry has both a
`frequency` and an `instrument` (an all-measure-marker module). This is not defensive dressing: a
NaN period makes every comparison in the pump false, so the horizon break never fires and the tab
hangs.

`disarmLoop()` cancels pending voices via `_cancelScheduledFrom(atTime)`, which kills every
voice whose **own `startTime`** is at or after the seam. It keys on start time, not on the cycle
counter, because around a seam the active set holds voices from two passes at once — the outgoing
pass's release tails (which ring after the note's end) overlap the incoming pass's attacks — and the pump's `cycle` runs ahead of the
pass you can actually hear.

## setRate() and scoreElapsed()

| Method | Behaviour |
|---|---|
| `setRate(rate)` | Live tempo: score seconds per clock second, clamped to 0.1–10. Re-times the playback in flight from 50 ms ahead of now (later voices are cancelled and scheduled again) and every later playback. Returns the rate in force. |
| `scoreElapsed()` | Score seconds elapsed in the playback in flight, through its time map; negative during startup; `null` when nothing plays. The playhead stays at the chosen position until the first attack. |
| `rate` | field | The live rate (1 = as written). Not saved: `player.ts` resets it on every module load. |

The mechanics, and why the loop seam survives a change, are in
[Streaming Scheduler → Live tempo](/developer/audio/streaming#live-tempo).

## pauseFade() {#pausefade}

```javascript
await audioEngine.pauseFade(0.2);
```

Each playback has a gain node for each instrument, just before its dry and
reverb paths. Play opens these gains over 8 ms. Pause closes them over 200 ms
on the audio clock while the sounding notes follow their own envelopes.
Pending attacks are cancelled. A timer resolves the UI promise, so a suspended
context can finish the fade when its audio clock resumes.

## stopAll() {#stopall}

```javascript
audioEngine.stopAll();  // 20 ms fade
```

Stop fades the outgoing playback from its current level and detaches its voices
as their sources end. A rapid restart gets fresh gain nodes, so the outgoing
fade can finish independently of the new attack. Clicking empty canvas while a
piece plays uses this same fade and parks the playhead at the selected time.

## finish(): the end of a piece rings out

A note's end is a note-off, so when the playhead reaches the module's end the last notes are still in
their release. `player.ts` then calls `stop(false, true)` (`player.ts`), which calls
`audioEngine.finish()` instead of `stopAll()`: scheduling stops, and each voice already
sounding stops itself at the end of its tail. The same happens at the final seam of a loop that was
switched off. Stop, Pause, a new Play (which calls `stopAll()` first when the transport is idle) and
loading a module still cut the tails.

## The voice limit

The release-tail budget is set by `audio.maxVoices`, available to the engine as `graph.maxVoices`
(Settings → Audio → **Most voices at once**: 128 to 4096), and `MAX_VOICES = 256` is its default and
the fallback. `_makeRoomAt(start)` runs before
each voice is connected: while that many voices that are not already fading sound at the new voice's start,
it takes the one whose note-off lies furthest in the past (the furthest into its release), rebuilds its release ramp up to that instant and fades it to zero over 15 ms. A voice before
its note-off is never stolen, so a module with more notes held at once than the limit goes over it
rather than cutting a held note. `voiceStats` counts the peak number of voices in flight and
the release tails reclaimed.

## setVolume()

```javascript
audioEngine.setVolume(0.5);
```

A thin delegate to `graph.setMasterVolume()`. Range 0–1, ramped over 50 ms. This is the
**master** volume — the same value as the transport slider and Settings → Audio → Master volume.
It is not `initialVolume`.

## Scheduling one note

`_scheduleNote(noteData, passStartTime, initialVolume)` builds the voice chain:

```
voice → gainNode (envelope) → [StereoPanner] → graph.getBus(instrument)
```

`passStartTime` is `baseStartTime` for a normal playback and `baseStartTime + cycleStart` when
looping; the note's absolute start is `passStartTime + noteData.startTime`.

The voice is created at `noteData.frequency` — or at `noteData.temperedFrequency` when
`graph.temperedEnabled` is true at that moment. See [Tempered playback](#tempered-playback).

The envelope peak is `initialVolume * noteData.amplitude`. `noteData.attack` and `noteData.release` go to
`applyEnvelope()` as a `shape` (`{ attack, release }`, each a share of the duration or `null`), together with the sounding frequency (`frequency`, the tempered one when tempered playback is on), which some envelopes follow. The amplitude comes from the note's
`amplitude` expression (its own, else the BaseNote's, else 1), clamped once by `amplitudeToGain()`
in `src/player/amplitude.ts` to `[0, 4]`. A note whose amplitude is 0 is skipped by the pump — no
voice is built for it.

The panner is created only when `graph.stereoEnabled` is true, the note has a `panPos`, and
`ctx.createStereoPanner` exists. Where it does not, the voice connects straight to the bus and the
note is centred — there is no fallback panning.

Voices are tracked as `{ voice, gainNode, panner, startTime }` entries in the `activeOscillators`
`Set`. Teardown is **dual**: `voice.onended` plus a `setTimeout` backstop for wrapper voices that do
not forward `onended`, with a Set-membership check so exactly one teardown runs.

### The click-free contract

Two invariants in this file exist to keep the output free of clicks. Break either and you will hear it.

**1. A voice's gain node starts at 0, not at the Web Audio default of 1.**

```javascript
const gainNode = ctx.createGain();
gainNode.gain.value = 0;   // audio-engine.ts — deliberate
```

Voices are built up to `LOOKAHEAD` (2 s) before they sound. The default of `1.0` is what a *pending*
voice's gain reads back as, so a fade-out would anchor it at 1.0, cancel its envelope, and let it
start mid-fade at 5× its intended peak with no attack — an audible blast of a note that should never
have sounded. Rest at silence; the envelope's `setValueAtTime(EPS, start)` takes over from there.

**2. `cancelScheduledValues()` needs an anchor.**

Every fade in this file — `pauseFade`, `stopAll`, and `AudioGraph.setMasterVolume` — follows the same
three-step shape:

```javascript
const cur = g.value;              // snapshot FIRST
g.cancelScheduledValues(now);
g.setValueAtTime(cur, now);       // anchor the current value at `now`
g.linearRampToValueAtTime(0, now + fade);
```

`cancelScheduledValues(now)` removes future events but **does not hold the current value**. The ramp
that follows interpolates from the last *surviving* event — which is in the past — so a bare
cancel-then-ramp steps the gain instead of fading it. That step is the very click you were trying to
remove. On master volume it shows up as a jump on the second and subsequent changes (the zipper).

Snapshot `g.value`, cancel, `setValueAtTime(cur, now)`, then ramp. Every time.

### Where the envelope lives

`_scheduleNote` does not shape the envelope itself — it calls
`instrumentManager.applyEnvelope(instrument, gainNode, start, duration, peak, shape, frequency)`, where `shape` is
`{ attack: noteData.attack ?? null, release: noteData.release ?? null }`. That routes to the shared
`applyVoiceEnvelope()` in `src/instruments/instrument-manager.ts`. Its times in seconds, floors, the note's own
attack and release, and the hard-zero ending are documented in
[Instruments](/developer/audio/instruments#the-envelope-core).

The one fact that belongs here: a note's end is a note-off, so the envelope reaches zero **after**
`start + duration`, when the release has rung out. The engine asks `instrumentManager.voiceLength(instrument,
duration, shape, frequency)` for the length of the voice (the note, its release, 4 ms to zero and a
20 ms margin) and stops the source at `start + length` (`audio-engine.ts`), while it is already
silent. If the envelope cannot be computed, `length` stays `duration + FALLBACK_TAIL`
(`FALLBACK_TAIL = 0.15 s`, module level). Stopping past gain-zero is what lets exponential releases finish without
a click. Note *lengths* are unaffected.

## Tempered playback

```javascript
import { temperedFrequency } from './player/audio-engine.ts';

temperedFrequency(328.75, 263);   // → 331.359…  (5/4 on a 263 Hz BaseNote, moved up 13.7 cents)
```

`temperedFrequency(freq, baseFreq)` is the whole of the `audio.tempered` setting's
arithmetic: the nearest of twelve equal steps to the octave, counted from the BaseNote.

```javascript
baseFreq * Math.pow(2, Math.round(12 * Math.log2(freq / baseFreq)) / 12)
```

It returns `freq` unchanged if either argument is not a positive number. The BaseNote and its
octaves come back bit-identical; two notes a comma apart usually come back as one frequency.

Three things about where it sits:

- **It is on the float side of the boundary.** The evaluator's exact fractions are converted with
  `toNumber()` first and tempered afterwards. Nothing upstream — the module, the evaluation cache,
  the renderer, a saved file — ever sees a tempered value.
- **Both pitches travel with the note.** `preparePlayback()` always fills in `temperedFrequency`,
  and `_scheduleNote()` picks one when it builds the voice, reading `graph.temperedEnabled` the way
  it reads `graph.stereoEnabled`. So the setting can be switched while a module plays, loops
  included, and takes hold with the next voice scheduled — up to `LOOKAHEAD` ahead of the playhead.
  Voices already built keep the pitch they were built with.
- **Nothing else follows it.** `panPos` is computed from the pure frequency either way, and so is
  the instrument. A note handed to the pump without a `temperedFrequency` (a hand-built list, as in
  `scripts/perf/shot-loop-playback.mjs`) plays its `frequency`.

`scripts/perf/check-purity.mjs` asserts all of this against the running engine: what the instruments
are handed with the setting off and on, and that no other field of the note list changes.

## Constants

The [streaming scheduler constants](/developer/audio/streaming#constants) set the scheduling windows, loop bounds and fallback tail. The transport fade lengths are described under [Pause](#pausefade) and [Stop](#stopall).

## There is no dispose()

`AudioEngine` has no `dispose()`, `destroy()` or `close()`. The singleton lives for the page's
lifetime; the graph, buses, convolver and limiter are persistent by design (that persistence is
exactly what makes loop seams gapless). `AudioGraph` does have a `dispose()`
(`audio-graph.ts`), but nothing calls it.

## See also

- [Audio Graph](/developer/audio/audio-graph) — everything downstream of a voice
- [Streaming Scheduler](/developer/audio/streaming) — the pump, in detail
- [Instruments](/developer/audio/instruments) — the voice contract and the envelope core
- [Reverb](/developer/audio/reverb) — the algorithmic impulse response
- [Transport Controls](/user-guide/playback/transport) — the user-facing side
