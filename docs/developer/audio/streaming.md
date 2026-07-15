---
title: Streaming Scheduler
description: The just-in-time note pump inside AudioEngine.play() — a sorted list, a 2 s lookahead, 100 ms batches, and a cycle-aware loop that never tears anything down at the seam.
---

# Streaming Scheduler

The scheduler creates Web Audio voices about **2 seconds** before they sound, in **100 ms** batches,
instead of building every oscillator up front. A ten-minute piece costs the same at press-Play as a
ten-second one.

::: warning There is no `StreamingScheduler` class
Do not go looking for one. The scheduler is a **closure** — `const pump = () => {…}` — over a mutable
state object, defined inside `AudioEngine.play()` (`src/player/audio-engine.js:258-353`). There is no
scheduler file, no scheduler object, and no `scheduler.debug` flag.
:::

## The state object

`play()` builds one object, `s`, and the pump mutates it in place. `disarmLoop()` writes to it from
outside. It is exposed as `audioEngine._streamingState` for the test harness.

| Field | Meaning |
|---|---|
| `stopped` | Set by `_stopStreaming()`. The pump checks it and bails. |
| `timerId` | The pending `setTimeout` handle. |
| `baseStartTime` | Absolute ctx time at which pass 0 begins — `ctx.currentTime + 0.1`. |
| `initialVolume` | Per-note envelope peak. |
| `list` | The note array of the pass **currently being scheduled**. |
| `nextIndex` | How far into `list` the pump has got. |
| `cycle` | `0` = the initial (possibly partial) pass. |
| `cycleStart` | Playback-relative time at which `list`'s pass begins. |
| `looping`, `period`, `loopNotes`, `firstLen` | Installed by `_applyLoop()`. |
| `cutRel`, `loopEndTime` | Set by `disarmLoop()`: the final seam. Nothing at or after it sounds. |
| `pump` | The closure itself, so `armLoop()` can restart it. |

## Two time bases

Mixing these up is the easy bug in this file.

| Name | Definition |
|---|---|
| `rel` | Playback-relative seconds: `ctx.currentTime − baseStartTime`. |
| `cycleStart` | The `rel`-time at which the current pass begins. |

A note's **absolute** start is therefore:

```
baseStartTime + cycleStart + noteData.startTime
```

which is exactly what gets passed to `_scheduleNote(noteData, s.baseStartTime + s.cycleStart, …)`.

## The pump

```javascript
const pump = () => {
  if (this._streamingState !== s || s.stopped) return;
  s.timerId = null;

  const rel = this.audioContext.currentTime - s.baseStartTime;
  const targetTime = rel + LOOKAHEAD;      // the horizon
  let more = true;

  for (let guard = 0; guard < MAX_CYCLES_PER_BATCH; guard++) {
    let horizonReached = false;

    // Drain the current pass up to the horizon.
    while (s.nextIndex < s.list.length) {
      const noteData = s.list[s.nextIndex];
      const at = s.cycleStart + noteData.startTime;

      if (s.cutRel != null && at >= s.cutRel - SEAM_EPS) { more = false; break; }
      if (at > targetTime) { horizonReached = true; break; }

      if (noteData.frequency && noteData.instrument) {          // skip measure markers
        this._scheduleNote(noteData, s.baseStartTime + s.cycleStart, s.initialVolume);
      }
      s.nextIndex++;
    }
    if (!more || horizonReached) break;
    if (!s.looping) { more = false; break; }

    // Advance to the next pass.
    const nextStart = s.firstLen + s.cycle * s.period;
    if (nextStart > targetTime) break;      // beyond the horizon; pick it up next batch

    s.cycle++;
    s.cycleStart = nextStart;
    s.list = s.loopNotes;
    s.nextIndex = 0;
  }

  if (more) s.timerId = setTimeout(pump, BATCH_INTERVAL);
};
```

Three things in there are load-bearing.

**The list is sorted and consumed by index.** `preparePlayback()` sorts by `startTime`, so the inner
`while` can break the moment it finds a note past the horizon — everything after it is later still.
`nextIndex++` advances; nothing is spliced or deleted.

**The pass advance is multiplicative, not accumulative.**

```javascript
const nextStart = s.firstLen + s.cycle * s.period;   // NOT cycleStart += period
```

An accumulator drifts, and it must agree *exactly* with the `nextStart > targetTime` test below it.
If it doesn't, a whole pass lands in the past and every note of it fires at once.

**`more` tracks "this playback still has notes at some point", not "still has notes right now".** A
non-looping pass sets `more = false` only when the list is exhausted, at which point the pump retires
— that is up to `LOOKAHEAD` before the last note actually sounds. The pre-loop scheduler stopped the
moment the last note was *scheduled*, which is precisely what a naive loop gets wrong: it plays once
and quits (and for a module shorter than the lookahead, it quits immediately).

## Constants

| Constant | Value | Scope |
|---|---|---|
| `LOOKAHEAD` | **2.0 s** | local inside `play()` (`:266`) |
| `BATCH_INTERVAL` | **100 ms** | local inside `play()` (`:267`) — not `SCHEDULE_INTERVAL` |
| `RELEASE_TAIL` | **0.15 s** | local inside `_scheduleNote()` (`:523`) |
| `MIN_LOOP_PERIOD` | **0.05 s** | module-level (`:10`) |
| `MAX_CYCLES_PER_BATCH` | **64** | module-level (`:14`) |
| `SEAM_EPS` | **1e-6** | module-level (`:16`) |
| `DECLICK_FADE` | **0.02 s** | module-level (`:6`) |

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
  instrument: 'piano', // null for measure markers
  panPos: 0.33         // null for measure markers
}
```

Measure markers carry only a `startTime`. The pump skips them explicitly
(`if (noteData.frequency && noteData.instrument)`), so they cost an index increment and nothing else.

## Looping

Looping lives **entirely inside the scheduler**. The transport does not drive it; `player.js` just
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

### Why the seam is gapless

When the current pass is fully scheduled, the pump advances `cycleStart` and keeps going. **The wrap
is just another batch.** Nothing is torn down: the instrument buses, the convolver and the limiter in
[`AudioGraph`](/developer/audio/audio-graph) are persistent, and the voices from the outgoing pass are
still in `activeOscillators` with their release tails scheduled. So a note's release and its reverb
tail ring across the boundary exactly as they would mid-module.

::: danger Do not implement looping by calling play() again
`play()` re-anchors at `ctx.currentTime + 0.1` and `_stopStreaming()`s the pass in flight — a **≥100 ms
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

## Voice teardown

Each scheduled voice is tracked as `{ voice, gainNode, panner, startTime }` in the
`activeOscillators` `Set`. Cleanup is **dual**:

```javascript
voice.onended = () => { ended = true; cleanup(); };
setTimeout(() => { if (!ended) cleanup(); },
           (start + duration + RELEASE_TAIL - ctx.currentTime) * 1000 + 60);
```

The `onended` path is preferred; the timer is a backstop for wrapper voices that do not forward
`onended`. `cleanup()` checks Set membership first, so exactly one teardown runs no matter which
fires — and so a voice already removed by `stopAll()` or `_cancelScheduledFrom()` is not torn down
twice.

## Pause, resume and seek

None of these are scheduler methods. There is no `scheduler.pause()`, `resume(fromTime)` or
`seek(toTime)`.

| Action | What actually happens |
|---|---|
| Pause | `audioEngine.pauseFade()` — 200 ms fade, then `stopAll(0)`. The streaming state is dropped. |
| Stop | `audioEngine.stopAll()` — 20 ms declick fade, then teardown. |
| Resume | `player.js` re-runs `preparePlayback(fromTime)` and calls `play()` again (`player.js:4402`). |
| Seek | Same: stop, then prepare and play from the new time. |

There is no seek-within-a-running-pump. Every position change is a fresh `play()`.

## Verifying a change

Screenshots cannot show that the pump keeps handing out voices past the end of a module. Drive the
real app instead:

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
