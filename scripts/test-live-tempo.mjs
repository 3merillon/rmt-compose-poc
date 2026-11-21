#!/usr/bin/env node
/**
 * Live tempo: the score-to-clock map, rescheduling at a rate change, the loop
 * seam, and "Commit tempo".
 *
 *   A  TimeMap: identity at rate 1, a rate change keeps everything before it, the
 *      map is continuous at the change and clockAt inverts scoreAt.
 *   B  The engine at a rate change, driven with a fake audio clock: every note is
 *      scheduled exactly once, notes before the change keep their times, notes
 *      after it land where the new map puts them, the playhead (scoreElapsed) is
 *      continuous, and frequencies are untouched.
 *   C  The loop seam: pass boundaries are score times, so after a rate change the
 *      clock gap across a seam is the same as inside a pass, and a disarm after a
 *      rate change ends at the seam the new map puts on the clock.
 *   D  Commit: the live BPM is snapped to an integer and base.d becomes exactly
 *      60 / BPM; every time scales exactly; MIDI export writes the committed tempo.
 *
 * Exits non-zero on any failure.
 */
import Fraction from 'fraction.js';

// The engine module builds a singleton AudioEngine (and its audio graph) on import.
// Give it a permissive stand-in for Web Audio: every node, parameter and method is
// the same inert proxy. The tests below drive their own engine with a fake clock.
const inert = new Proxy(function () {}, {
  get: (t, p) => (p === Symbol.toPrimitive ? () => 0 : p === 'then' ? undefined : inert),
  apply: () => inert, construct: () => inert, set: () => true,
});
globalThis.window = globalThis.window || { AudioContext: function () { return inert; } };
// The settings store warns that localStorage is missing in Node; keep it quiet.
const { warn } = console; console.warn = () => {};
const { AudioEngine } = await import('../src/player/audio-engine.js');
console.warn = warn;
const { TimeMap, snapTempo, clampRate } = await import('../src/player/time-map.js');
const { Module } = await import('../src/module.js');
const { planMidi } = await import('../src/midi/midi-export.js');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures++; console.error(`  ✗ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- A: the map --------------------------------------------------------------
console.log('Live tempo: the score-to-clock map\n');
{
  const m = new TimeMap(1);
  check(m.scoreAt(3.25) === 3.25 && m.clockAt(3.25) === 3.25, 'A1 rate 1 is the identity');
  const s = m.setRate(2, 4);
  check(s === 4, 'A2 a change at clock 4 begins at score 4');
  check(m.scoreAt(3) === 3 && m.clockAt(3) === 3, 'A3 before the change nothing moves');
  check(m.scoreAt(5) === 6 && m.clockAt(6) === 5, 'A4 after it, twice as fast');
  check(near(m.scoreAt(4 - 1e-9), m.scoreAt(4 + 1e-9), 1e-8), 'A5 continuous at the change (no jump)');
  m.setRate(0.5, 6);
  let inv = true;
  for (let c = 0; c < 12; c += 0.37) if (!near(m.clockAt(m.scoreAt(c)), c, 1e-9)) inv = false;
  check(inv, 'A6 clockAt inverts scoreAt across several changes');
  const m2 = new TimeMap(1); m2.setRate(2, 4); m2.setRate(3, 4);
  check(m2.segs.length === 2 && m2.rate === 3, 'A7 a second change at the same instant replaces the first');
  const m3 = new TimeMap(1); m3.setRate(2, 0);
  check(m3.segs.length === 1 && m3.scoreAt(1) === 2, 'A8 a change before the playback starts re-times all of it');
  check(clampRate(NaN) === 1 && clampRate(0) === 1 && clampRate(100) === 10 && clampRate(0.01) === 0.1, 'A9 rates are finite and clamped to 0.1-10');
}

// --- a fake engine: the real methods, a hand-driven clock --------------------
function fakeEngine() {
  const e = Object.create(AudioEngine.prototype);
  e.audioContext = { currentTime: 0 };
  e.activeOscillators = new Set();
  e._streamingState = null;
  e._pauseFadeTimer = null;
  e.rate = 1;
  e.INITIAL_VOLUME = 0.2;
  e.scheduled = [];
  // Record what would be built; keep the entry shape setRate() cancels against.
  e._scheduleNote = function (noteData, passStartTime, vol, timing) {
    const start = passStartTime + noteData.startTime;
    const entry = {
      startTime: start, scoreStart: timing ? timing.scoreStart : null, frequency: noteData.frequency,
      duration: timing ? timing.duration : noteData.duration, cancelled: false,
      voice: { stop() { entry.cancelled = true; }, disconnect() {} }, gainNode: { disconnect() {} }, panner: null,
    };
    this.activeOscillators.add(entry);
    this.scheduled.push(entry);
  };
  return e;
}
// Advance the clock in pump-sized steps, running the pump as its timer would.
function run(e, until, step = 0.1) {
  const s = e._streamingState;
  while (e.audioContext.currentTime < until - 1e-12) {
    e.audioContext.currentTime = Math.min(until, e.audioContext.currentTime + step);
    if (s && !s.stopped && s.pump) { if (s.timerId) { clearTimeout(s.timerId); s.timerId = null; } s.pump(); }
  }
}
const stopEngine = (e) => { try { e._stopStreaming(); } catch {} };
const notes = (n, every, len, f = 440) => Array.from({ length: n }, (_, i) => ({ startTime: i * every, duration: len, frequency: f * (1 + i / 100), instrument: 'sine-wave', amplitude: 1 }));
const live = (e) => e.scheduled.filter((x) => !x.cancelled);

// --- B: a rate change in a playback ------------------------------------------
console.log('\nLive tempo: rescheduling at a rate change\n');
{
  const e = fakeEngine();
  const list = notes(20, 0.5, 0.5);           // 10 s of score, a note every 0.5 s
  const base = e.play(list, { initialVolume: 0.2 });
  check(base === 0.1, 'B0 playback starts 0.1 s after the clock');
  run(e, 1.0);
  const beforeChange = e.scoreElapsed();
  e.setRate(2);
  const afterChange = e.scoreElapsed();
  check(near(beforeChange, afterChange, 1e-12), 'B1 the playhead does not jump at the change');
  const cutClock = 1.0 - base + 0.05, cutScore = cutClock;   // rate 1 until the cut
  run(e, 8);
  const L = live(e);
  const byScore = new Map(); for (const x of L) byScore.set(x.scoreStart, (byScore.get(x.scoreStart) ?? 0) + 1);
  check(L.length === 20 && [...byScore.values()].every((c) => c === 1), `B2 every note scheduled exactly once (${L.length} live voices)`);
  check(L.filter((x) => x.scoreStart < cutScore).every((x) => near(x.startTime, base + x.scoreStart)), 'B3 notes before the change keep their times');
  check(L.filter((x) => x.scoreStart >= cutScore).every((x) => near(x.startTime, base + cutClock + (x.scoreStart - cutScore) / 2) && near(x.duration, 0.25)),
    'B4 notes after it start and last as the new map says (rate 2: half the clock time)');
  check(L.every((x, i) => x.frequency === list.find((n) => n.startTime === x.scoreStart).frequency), 'B5 frequencies are untouched');
  check(near(e.scoreElapsed(), cutScore + (8 - base - cutClock) * 2), 'B6 the playhead runs at the new rate');
  stopEngine(e);
}

// --- C: the loop seam ----------------------------------------------------------
console.log('\nLive tempo: the loop seam\n');
{
  const e = fakeEngine();
  const body = notes(3, 1, 1);                // a 3 s pass: notes at 0, 1, 2
  const base = e.play(body, { initialVolume: 0.2, loop: { period: 3, notes: body, firstCycleAudioLength: 3 } });
  run(e, 4.0);                                // into pass 2
  e.setRate(1.5);
  run(e, 14);
  const L = live(e).sort((a, b) => a.startTime - b.startTime);
  const ss = L.map((x) => x.scoreStart);
  check(ss.every((v, i) => i === 0 || near(v - ss[i - 1], 1)), 'C1 each note once, one score second apart, across every seam');
  const cut = 4.0 - base + 0.05;
  const after = L.filter((x) => x.startTime > base + cut + 1e-9);
  const gaps = after.slice(1).map((x, i) => x.startTime - after[i].startTime);
  check(gaps.length > 4 && gaps.every((g) => near(g, 1 / 1.5, 1e-9)), `C2 after the change every gap is 1/1.5 s, seams included (${gaps.length} gaps)`);
  const endsAt = e.disarmLoop();
  const s = e._streamingState;
  check(near(endsAt, base + s.map.clockAt(s.cutRel)) && near((s.cutRel) % 3, 0, 1e-9), 'C3 a disarm ends on a score seam, placed on the clock by the new map');
  const endAfter = e.getLoopEndTime();
  e.setRate(0.5);
  check(e.getLoopEndTime() > endAfter, 'C4 slowing down after the disarm moves the final seam later on the clock');
  stopEngine(e);
}

// --- D: commit -------------------------------------------------------------------
console.log('\nLive tempo: commit\n');
{
  const s1 = snapTempo(new Fraction(3, 5), 1.2);
  check(s1.bpm === 120 && s1.text === '1/2', 'D1 100 BPM (base.d 3/5) at rate 1.2 commits 120 BPM, base.d = 1/2');
  const s2 = snapTempo(new Fraction(7, 10), 90 / (60 / 0.7));
  check(s2.bpm === 90 && s2.text === '2/3', 'D2 a non-integer notated tempo (85.71 BPM) snaps to the shown integer: 90 BPM, base.d = 2/3');
  const s3 = snapTempo(new Fraction(10, 11), 1);
  check(s3.bpm === 66 && s3.text === '10/11', 'D3 at rate 1, 66 BPM commits exactly what is written');

  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', duration: '3/5' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d * 4', measure: true },
      { id: 2, startTime: 'base.t + base.d * (3/2)', duration: 'base.d', frequency: '(3/2) * base.f', instrument: 'sine-wave' },
    ],
  });
  mod.evaluateModule();
  const oldStart = mod.getNoteById(2).getVariable('startTime');
  const snap = snapTempo(mod.baseNote.getVariable('duration'), 1.2);
  mod.baseNote.setVariable('durationString', snap.text);
  for (const id of Object.keys(mod.notes)) mod.markNoteDirty(Number(id));
  mod.evaluateModule();
  const d = mod.baseNote.getVariable('duration'), t = mod.getNoteById(2).getVariable('startTime');
  check(d.equals(new Fraction(1, 2)), 'D4 base.d is exactly 1/2 after the commit');
  check(t.equals(oldStart.mul(new Fraction(1, 2)).div(new Fraction(3, 5))), 'D5 a start scales exactly by new base.d / old base.d');
  check(mod.getNoteById(2).getVariable('frequency').equals(new Fraction(789, 2)), 'D6 frequencies are untouched');
  const plan = planMidi(mod);
  check(plan.report.tempo.exactBpm === '120' || Number(plan.report.tempo.exactBpm) === 120, `D7 MIDI export writes the committed tempo (${plan.report.tempo.exactBpm} BPM)`);
}

// --- E: the slider's range (Settings > Audio > Live tempo > Tempo range) --------
console.log('\nLive tempo: the slider range\n');
{
  const { defaultSettings, validateSettings, tempoSliderBounds } = await import('../src/settings/settings-schema.js');
  const def = defaultSettings().audio.tempoRange;
  check(def.min === 20 && def.max === 300, 'E1 the default range is 20-300 BPM');
  check(validateSettings({ audio: { tempoRange: { min: 300, max: 40 } } }).audio.tempoRange.min === 20, 'E2 an inverted range falls back to the default');
  const v = validateSettings({ audio: { tempoRange: { min: 40.4, max: 5000 } } }).audio.tempoRange;
  check(v.min === 40 && v.max === 1000, 'E3 whole BPM, clamped to 1-1000');
  const b1 = tempoSliderBounds({ min: 20, max: 300 }, 100);
  check(b1[0] === 20 && b1[1] === 300, 'E4 at 100 BPM written, the slider spans the range');
  const b2 = tempoSliderBounds({ min: 20, max: 300 }, 10);
  check(b2[0] === 10 && b2[1] === 100, 'E5 at 10 BPM written: down to the written tempo, up to 10x it (the rate rail)');
  const b3 = tempoSliderBounds({ min: 60, max: 120 }, 40);
  check(b3[0] === 40 && b3[1] === 120, 'E6 and it always reaches the written tempo, here below the range');
}

console.log(`\n${failures ? `${failures} failure(s).` : 'All live-tempo checks passed.'}`);
process.exit(failures ? 1 : 0);
