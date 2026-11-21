---
title: Streaming Scheduler
description: How AudioEngine schedules sparse and dense passages, changes tempo, and repeats a score on the audio clock.
---

# Streaming Scheduler

The scheduler creates voices up to two seconds before they sound. It shortens that
window in dense passages to reduce the number of connected Web Audio nodes. A
large opening chord gets extra preparation time before its common attack.

The pump is a closure inside `AudioEngine.play()` in `src/player/audio-engine.ts`. Each playback owns its state.

## The state object

`play()` builds one object, `s`, and the pump mutates it in place. `disarmLoop()` writes to it from
outside. It is exposed as `audioEngine._streamingState` for the test harness.

| Field | Meaning |
|---|---|
| `stopped` | Set by `_stopStreaming()`. The pump checks it and bails. |
| `timerId` | The pending `setTimeout` handle. |
| `baseStartTime` | Absolute audio-clock time at which pass 0 begins, with at least 100 ms of preparation time. |
| `initialVolume` | Per-note envelope peak. |
| `list` | The note array of the pass **currently being scheduled**. |
| `firstList` | Pass 0's note array (the list `play()` was given), kept so `setRate()` can rewind into it. |
| `map` | The playback's [`TimeMap`](#live-tempo): score time to clock time at the live rate. |
| `nextIndex` | How far into `list` the pump has got. |
| `cycle` | `0` = the initial (possibly partial) pass. |
| `cycleStart` | Playback-relative time at which `list`'s pass begins. |
| `looping`, `period`, `loopNotes`, `firstLen` | Installed by `_applyLoop()`. |
| `cutRel`, `loopEndTime` | Set by `disarmLoop()`: the final seam. Nothing at or after it sounds. |
| `pump` | The closure itself, so `armLoop()` can restart it. |

## Three time bases

Mixing these up is the easy bug in this file.

| Name | Definition |
|---|---|
| clock rel | Playback-relative clock seconds: `ctx.currentTime − baseStartTime`. |
| `rel` | Playback-relative **score** seconds: `s.map.scoreAt(clock rel)`. Every other time in the state (`cycleStart`, `firstLen`, `period`, `cutRel`) is score time, so pass boundaries do not move when the tempo does. |
| `cycleStart` | The `rel`-time at which the current pass begins. |

A note's **absolute** start is therefore:

```
baseStartTime + s.map.clockAt(cycleStart + noteData.startTime)
```

At rate 1 the map is the identity and this is `baseStartTime + cycleStart + noteData.startTime`, as it
was before live tempo. `_scheduleNote()` still receives a `passStartTime` such that
`passStartTime + noteData.startTime` is the absolute start (the loop harness relies on that), plus the
note's clock length through the map and its score position.

## The pump

Each pump checks upcoming density, including repeats inside a two-second horizon. The dense test looks 128 entries beyond the next score entry or projects at least 128 entries from upcoming repeats. In dense passages it schedules up to 400 ms ahead at normal tempo,
shortening that to a minimum of 180 ms at faster tempos. It checks its time
budget every 32 score entries. After about 5 ms of work it yields, then resumes
at the same score entry. Notes in a simultaneous chord keep their shared time
even when they are submitted in different batches. The normal timer wakes after at most 100 ms or one quarter of the window, whichever comes first. At startup the engine counts audible entries in the first 100 ms at the current rate and allows the larger of 100 ms and 0.5 ms per opening voice before the first attack.

**The list is sorted and consumed by index.** `preparePlayback()` sorts by `startTime`, so the inner
`while` can break the moment it finds a note past the horizon — everything after it is later still.
`nextIndex++` advances; nothing is spliced or deleted.

**The pass advance is multiplicative, not accumulative.**

```javascript
const nextStart = s.firstLen + s.cycle * s.period;   // NOT cycleStart += period
```

An accumulator drifts, and it must agree *exactly* with the scheduler’s `nextStart > targetTime` test.
If it doesn't, a whole pass lands in the past and every note of it fires at once.

**`more` tracks "this playback still has notes at some point", not "still has notes right now".** A
non-looping pass sets `more = false` only when the list is exhausted, at which point the pump retires
— that is up to `LOOKAHEAD` before the last note actually sounds. The pre-loop scheduler stopped the
moment the last note was *scheduled*, which is precisely what a naive loop gets wrong: it plays once
and quits (and for a module shorter than the lookahead, it quits immediately).

## Constants

| Constant | Value | Scope |
|---|---|---|
| `LOOKAHEAD` | **2.0 s** | local inside `play()` |
| `BATCH_INTERVAL` | **100 ms** | local inside `play()` — not `SCHEDULE_INTERVAL` |
| `DENSE_WINDOW_NOTES` | **128** | Density threshold inside the sparse lookahead |
| `DENSE_LOOKAHEAD` | **0.4 s** | Maximum dense lookahead at normal speed |
| `PUMP_BUDGET_MS` | **5 ms** | Work budget per turn, checked every 32 entries |
| `FALLBACK_TAIL` | **0.15 s** | module-level; the voice's tail past the note only if its envelope cannot be computed |
| `MIN_LOOP_PERIOD` | **0.05 s** | module-level |
| `MAX_CYCLES_PER_BATCH` | **64** | module-level |
| `SEAM_EPS` | **1e-6** | module-level |
| `DECLICK_FADE` | **0.02 s** | module-level |
| `RATE_CHANGE_LEAD` | **0.05 s** | module-level: how far ahead of the clock a tempo change takes effect |

There is no `MIN_NOTE_DURATION`. Short notes are handled by the envelope's attack/release floors and
its 1 ms duration floor — see
[the envelope core](/developer/audio/instruments#the-envelope-core).

`MAX_CYCLES_PER_BATCH` is a **backstop, not the real bound**. The pump's own "next pass is past the
horizon" break already bounds the cycle count at `LOOKAHEAD / MIN_LOOP_PERIOD`. The guard is there so
that a future arithmetic bug degrades into a glitch rather than a hung tab.

## Note data

The pump consumes plain objects from
[`preparePlayback()`](/developer/audio/audio-engine#prepareplayback):

```javascript
{
  id: 3,
  startTime: 0.5,      // seconds, relative to the pass start
  duration: 0.25,
  frequency: 440,      // null for measure markers
  temperedFrequency: 442.3,  // the pitch played instead when audio.tempered is on; null for measure markers
  instrument: 'piano', // null for measure markers
  panPos: 0.33         // null for measure markers
}
```

Measure markers carry only a `startTime`. The pump skips them explicitly
(`if (noteData.frequency && noteData.instrument)`), so they cost an index increment and nothing else.

## Looping

Looping lives **entirely inside the scheduler**. The transport does not drive it; `player.ts` just
hands `play()` a descriptor and then asks the engine whether the loop actually armed.

```javascript
audioEngine.play(firstPassNotes, {
  initialVolume: 0.2,
  loop: {
    period: moduleEndTime,          // the pass length
    notes: loopBodyNotes,           // preparePlayback(0) — a full pass
    firstCycleAudioLength: moduleEndTime - fromTime
  }
});
```

Two note lists, because they are genuinely different: the first pass comes from
`preparePlayback(fromTime)` — its start times are offset, and a note straddling `fromTime` has been
truncated — so it is only valid for that one pass. The loop body comes from `preparePlayback(0)`.
When `fromTime === 0` the promise is shared rather than evaluated twice.

### Transposed passes

A module may transpose each repeat: its BaseNote's `repeat`, the ratio from one repeat to the next (an expression, e.g.
`9/8` or `[24].f / base.f`; see `src/player/display-transpose.ts`). `player.ts` evaluates it exactly (`moduleRepeatRatio`,
which refuses anything outside 1/16 to 16) and hands
`play()` a `transpose` option, `{ ratio, fold, offset }`: the ratio, the fold preference (Settings → Audio → Loop →
Keep within an octave) and the pass the playback starts in (kept across Pause and seeks, 0 after Stop). Without it
nothing is transposed (`_transposeState`, `audio-engine.ts`). The pump hands each voice the factor of
its pass, `_passFactor(s, s.cycle)` (`audio-engine.ts`): `passTransposition(ratio, offset + cycle, fold)`, exact, folded into one
octave (`[1, 2)` rising, `(1/2, 1]` falling) by exact comparison, then made a float once per pass. `_scheduleNote()`
multiplies the written frequency by it and takes the tempered twin and the stereo place from the transposed pitch.
`_prepareTransposed()` decodes every zone of the sampled instruments the notes use, so a later pass never falls back
to a sine while a zone it now needs loads. The display follows the pass being heard through
`setDisplayTransposition()` (the BaseNote circle in the renderer, the frequency rows of the note widget); the module is
never written.

### Why the seam is gapless

When the current pass is fully scheduled, the pump advances `cycleStart` and keeps going. **The wrap
is just another batch.** Nothing is torn down: the instrument buses, the convolver and the limiter in
[`AudioGraph`](/developer/audio/audio-graph) are persistent, and the voices from the outgoing pass are
still in `activeOscillators` with their release tails scheduled. So a note's release and its reverb
tail ring across the boundary exactly as they would mid-module.

::: danger Do not implement looping by calling play() again
`play()` re-anchors after the startup lead and `_stopStreaming()`s the pass in flight — a **≥100 ms
hole** every lap, plus a cut tail. The pump's wrap exists precisely to avoid this.
:::

### Disarming

`disarmLoop()` computes the next seam with `_nextSeamRel(rel, s)` — the first pass boundary
**strictly after** `rel` — writes it into `s.cutRel` / `s.loopEndTime`, and calls
`_cancelScheduledFrom(loopEndTime)`.

The 2 s lookahead means voices for the *next* pass may already exist — and for a module shorter than
the lookahead, voices for several passes. They are cancelled by **absolute start time**, not by cycle
index: around a seam the active set holds voices from two passes at once, so "which pass is this voice
in" can only be answered from its own scheduled time. The scheduler's `cycle` counter runs ahead of
the pass you can hear, and is the wrong thing to ask.

Cancelling is **silent, with no fade**. A voice whose start is still in the future and whose `stop()`
is moved to its own `start()` never produces a sample. Voices already sounding are left alone — their
release and reverb tail belong to the pass that is still playing.

### Refusals

`_applyLoop()` refuses to arm — and playback then just runs once and stops — when:

- the period is non-finite, or `< MIN_LOOP_PERIOD` (50 ms);
- the note array is empty;
- no note has both a `frequency` and an `instrument` (an all-measure-marker module).

These are not cosmetic guards. An empty list or a zero period makes the inner `while` a no-op, so
every iteration of the `for` "exhausts" the pass and advances a cycle. With a **NaN** period the
`nextStart > targetTime` break never fires either — every comparison with NaN is false — and the tab
hangs outright.

## Live tempo

Playback can run faster or slower than the piece is written, without touching the module: a
performance setting outside the notation. The rate is **score seconds per clock second** (2 plays
twice as fast); frequencies never pass through it. It lives in `audioEngine.rate`, and `player.ts`
resets it to 1 whenever a module is loaded.

Each playback carries a `TimeMap` (`src/player/time-map.ts`): a chain of segments, each holding one
rate from a clock instant on. `scoreAt(c)` and `clockAt(s)` are the only things the scheduler and the
playhead ask of it, so a tempo curve (an accelerando drawn over time) can later replace a segment's
linear law by its integral without touching either.

`setRate(rate)` (`src/player/audio-engine.ts`) does four things:

1. **Splits the map** `RATE_CHANGE_LEAD` (50 ms) ahead of the clock (`TimeMap.setRate`,
   `time-map.ts`). Everything before that instant keeps the times it had, so the playhead does not
   jump and nothing already heard moves.
2. **Cancels the voices that start after it**, by their score position (`entry.scoreStart`), the
   same number the rewind compares, so a note is either kept or rescheduled, never both or neither.
   They have not sounded yet, so this is silent. A voice already begun keeps its length.
3. **Rewinds the pump** to the pass holding that instant and the first note at or after it (it never
   moves the pump forward: a pump that is behind keeps its place).
4. **Restarts the pump**, which schedules those notes again through the new map.

**The loop stays seamless.** Pass boundaries are score times, so at any rate the seam is just another
pair of notes one score interval apart; the clock gap across it is the same as inside a pass.
`getLoopEndTime()` recomputes the final seam's clock time from the map, so a tempo change after a
disarm moves it too, and the playhead stops where the sound does.

**The playhead** follows `scoreElapsed()`, the score time through the same map, plus the
time the playback started from. It no longer derives its position from `ctx.currentTime` directly.

**Commit tempo** (`commitLiveTempo()`, `src/player.ts`) writes the rate into the piece. The live
BPM (60 / `base.d` × rate) is first snapped to the whole number the toolbar shows, then `base.d`
becomes exactly 60 / BPM (`snapTempo()`, `time-map.ts`); a float is never written as if it were
exact. Every time in the module scales with `base.d`, the rate returns to 1, and the commit is one
undo step. MIDI export reads the module, so it writes the committed tempo, never a live rate.

`node scripts/test-live-tempo.mjs` checks the map, the rescheduling at a change (each note exactly
once, before-change notes unmoved, after-change notes where the new map puts them, a continuous
playhead), the loop seam across a change, and the commit.

## Voice teardown

Built-in voices disconnect when the source fires `ended`. A wrapper without
that event uses a timer that checks the audio clock before disconnecting. A
suspended context can therefore resume a note whose wall-clock timer has fired.
Both paths check membership in `activeOscillators` so stop or cancellation can
release a voice exactly once.

## Pause, resume and seek

None of these are scheduler methods. There is no `scheduler.pause()`, `resume(fromTime)` or
`seek(toTime)`.

| Action | What actually happens |
|---|---|
| Pause | `audioEngine.pauseFade()` — The engine stops scheduling and fades the current playback over 200 ms. |
| Stop | `audioEngine.stopAll()` — 20 ms declick fade, then teardown. |
| The module's end | `audioEngine.finish()` — scheduling stops; the voices still sounding ring out their releases and stop themselves. A new Play cuts what is left. |
| Resume | `player.ts` re-runs `preparePlayback(fromTime)` and calls `play()` again (`player.ts`). |
| Seek | A background click while playing fades the outgoing session and parks at the selected score time. Play prepares a fresh session there. |

There is no seek-within-a-running-pump. Every position change is a fresh `play()`.

## Dense-score verification {#verifying-a-change}

For a real score, capture the signal after the master limiter and compare note
onsets with the loaded score. The following command uses the file picker, sets
the tempo through the transport, then plays through the reverb tail. Run this from the repository root with the app running. It uses the shipped canon as a short check and writes a JSON report to the named output path. Substitute another input and a fresh report path to compare a larger score. On Windows the harness selects Chrome by default.

```sh
node scripts/perf/check-file-audio.mjs http://localhost:3000 public/modules/defaultModule.json canon-report.json --bpm=300
```

The comparison documented in commit `da23273` used a 44,307-note sine score at 300 BPM in Chrome 157. The baseline
submitted every onset on time but reported 27.27 seconds of output underruns.
With the revised scheduler and renderer, all 44,307 onsets had at least 90 ms
of lead. The recorded output contained zero clipped samples or unexpected
silent 20 ms windows. The device reported one 8.6 ms startup underrun, also
observed with an idle audio graph. Separate pointer tests parked the playhead
at score times 54 s and 44 s and resumed through both passages.

For comparisons, record the input hash, browser version, BPM, seek position and device statistics from the report. Scheduled onset lead, captured PCM and device underruns measure different stages. Use `--idle-control` on a separate run to check the device baseline. [Performance measurement](/developer/performance)

To check waveform continuity across Play, Pause, Stop, rapid restart and two seeks into sustained chords, run the transport fade harness against a local Vite server. Without a score argument it constructs a 64-voice chord.

```sh
node scripts/perf/check-transport-fades.mjs http://localhost:3000
```

To exercise the loop and its transport gestures:

```bash
npm run dev
node scripts/perf/shot-loop-playback.mjs --url http://localhost:3000
```

`scripts/perf/shot-loop-playback.mjs` is a Playwright harness that asserts the seam arithmetic, the
wrap, the disarm cut, the play-button gestures, arming mid-playback without a restart, and the
first-touch audio unlock. It is not wired to an npm script; run it with `node`.

## See also

- [Audio Engine](/developer/audio/audio-engine) — `play()`, the loop API, and the click-free contract
- [Audio Graph](/developer/audio/audio-graph) — the persistent nodes that make the seam gapless
- [Instruments](/developer/audio/instruments) — what `_scheduleNote()` builds a voice from
- [Transport Controls](/user-guide/playback/transport) — the user-facing side, including loop playback
