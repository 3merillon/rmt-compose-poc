import { toNumber } from '../utils/fraction-num.js';
import { InstrumentManager } from '../instruments/instrument-manager.js';
import { AudioGraph } from './audio-graph.js';
import { amplitudeToGain } from './amplitude.js';
import { TimeMap, clampRate } from './time-map.js';

// Short enough to read as instant, long enough that the cut is not a step.
const DECLICK_FADE = 0.02; // seconds

// Loop guards. A pass shorter than this would let the scheduler spin through
// hundreds of cycles per lookahead window; a zero/NaN period would spin forever.
const MIN_LOOP_PERIOD = 0.05; // seconds
// Backstop only. The pump's own "next pass is past the horizon" break bounds the
// cycle count at LOOKAHEAD / MIN_LOOP_PERIOD; this is here so that a future bug in
// that arithmetic degrades into a glitch rather than a hung tab.
const MAX_CYCLES_PER_BATCH = 64;
// Float slop when comparing a note's scheduled time against a pass boundary.
const SEAM_EPS = 1e-6;
// A voice whose envelope could not be computed is stopped this long after its
// note's end (the length every voice had before the release followed the note-off).
const FALLBACK_TAIL = 0.15;
// At most this many voices sound at once (the default of Settings → Audio → Most
// voices at once, audio.maxVoices, which the graph holds as maxVoices). Above it
// the quietest voice already past its note-off is faded out over STEAL_FADE; a
// voice before its note-off is never stolen (design/phase-i-instruments.md §9).
export const MAX_VOICES = 256;
const STEAL_FADE = 0.015;
const EPS_GAIN = 0.0001; // the envelope's floor (instrument-manager.js EPS)
// A live tempo change takes effect this far ahead of the audio clock, so no voice
// is ever rescheduled into the past (the pump runs on a 100 ms timer).
const RATE_CHANGE_LEAD = 0.05; // seconds

/**
 * The same pitch on the nearest key of a keyboard tuned from the BaseNote:
 * twelve equal steps to the octave, counted from `baseFreq`. This is what the
 * `audio.tempered` setting sounds instead of the module's own frequency. It
 * lives on the float side of the boundary on purpose — the module's exact
 * fractions are never rewritten, only what a voice is handed.
 *
 * The BaseNote and its octaves come back unchanged, bit for bit; two notes a
 * comma apart come back as one key.
 *
 * @param {number} freq Hz
 * @param {number} baseFreq Hz, the BaseNote's frequency
 * @returns {number} Hz (freq itself if either argument is not a positive number)
 */
export function temperedFrequency(freq, baseFreq) {
  if (!(freq > 0) || !(baseFreq > 0)) return freq;
  return baseFreq * Math.pow(2, Math.round(12 * Math.log2(freq / baseFreq)) / 12);
}

export class AudioEngine {
  constructor({ initialVolume = 0.2, rampTime = 0.2 } = {}) {
    this.INITIAL_VOLUME = initialVolume;
    this.GENERAL_VOLUME_RAMP_TIME = rampTime;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // The full signal graph (master/limiter, reverb send/return, per-instrument
    // buses, pitch pan) lives in AudioGraph and is the sole consumer of the
    // `audio.*` settings. Per-note voices connect into it via getBus().
    this.graph = new AudioGraph(this.audioContext);

    this.instrumentManager = new InstrumentManager(this.audioContext);

    // Track currently scheduled/playing voices for pause/stop.
    /** @type {Set<{voice:any,gainNode:GainNode,panner:StereoPannerNode|null}>} */
    this.activeOscillators = new Set();
    // Voices in flight at most, and voices stolen to stay under MAX_VOICES.
    this.voiceStats = { peak: 0, stolen: 0 };

    // Streaming playback state
    this._streamingState = null;

    // Live tempo: score seconds per clock second (see time-map.js). Outside the
    // notation; player.js resets it to 1 when a module is loaded.
    this.rate = 1;

    // Pending pause-fade teardown (cancelable so a quick pause→play can't let a
    // stale timer stopAll() the new playback).
    this._pauseFadeTimer = null;
    this._pauseFadeResolve = null;
  }

  // Return nodes so legacy code can alias them without deep coupling.
  // `generalVolumeGainNode`/`compressor` keys are kept for back-compat and now
  // alias the graph's master gain + limiter (see app-state.js, player.js).
  nodes() {
    return {
      audioContext: this.audioContext,
      generalVolumeGainNode: this.graph.masterGain,
      compressor: this.graph.limiter,
      instrumentManager: this.instrumentManager
    };
  }

  // Called from main after globals are registered
  registerInstruments(SynthInstruments, SampleInstruments) {
    try {
      this.instrumentManager.registerBuiltInInstruments(SynthInstruments, SampleInstruments);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to register instruments in AudioEngine:', e);
    }
  }

  async ensureResumed() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Unlock audio from inside a user gesture. SYNCHRONOUS on purpose — it must be
   * callable directly from a pointerdown/click handler, with nothing awaited before
   * it, or the gesture no longer counts.
   *
   * ensureResumed() is not a substitute. Mobile Safari grants audio on TRANSIENT
   * activation: resume() has to be called from within the gesture's own task, not
   * merely at some point after the user has touched the page. Anything that starts
   * playback from a timer (the play button's 500 ms long-press) is therefore too
   * late by definition, and resumes nothing — which is why the very first long-press
   * on a freshly loaded page was silent while every one after a normal tap worked.
   *
   * The silent one-sample buffer is the second half of the iOS handshake: the
   * context can report "running" and still stay muted until a source has actually
   * been started inside a gesture.
   */
  unlock() {
    const ctx = this.audioContext;
    if (!ctx) return;
    try { if (ctx.state === 'suspended') ctx.resume(); } catch {}
    if (this._unlocked) return;
    this._unlocked = true;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {}
  }

  setVolume(value) {
    if (!this.audioContext || !this.graph) return;
    this.graph.setMasterVolume(Number(value));
  }

  /**
   * preparePlayback(module, fromTime)
   * Prepares note data for playback without creating oscillators upfront.
   * Oscillators are created just-in-time during play() to avoid blocking.
   */
  preparePlayback(module, fromTime) {
    return new Promise((resolve) => {
      const resumePromise = this.audioContext.state === 'suspended'
        ? this.audioContext.resume()
        : Promise.resolve();

      resumePromise.then(() => {
        const t0 = performance.now();

        // evaluateModule() is now called inside getModuleEndTime() if needed
        const moduleEndTime = module.getModuleEndTime();
        const evalCache = module.getEvaluationCache();

        const t1 = performance.now();

        // Cache instrument lookups
        const instrumentCache = new Map();
        const instrumentMemo = new Map(); // shared by every lookup: each chain is walked once
        const getInstrument = (note) => {
          if (!instrumentCache.has(note.id)) {
            instrumentCache.set(note.id, module.findInstrument(note, instrumentMemo).toLowerCase());
          }
          return instrumentCache.get(note.id);
        };

        // Base-note frequency for pitch-driven stereo pan (note 0 = baseNote).
        let baseF = null;
        try {
          const baseCached = evalCache.get(0);
          if (baseCached && baseCached.frequency) baseF = toNumber(baseCached.frequency);
          else if (module.baseNote && typeof module.baseNote.getVariable === 'function') {
            const bf = module.baseNote.getVariable('frequency');
            if (bf != null) baseF = toNumber(bf);
          }
        } catch {}
        if (!(baseF > 0)) baseF = 440;

        // BaseNote amplitude: what every note without its own inherits (the
        // same fallback Module.findAmplitude and the evaluator's [id].a use).
        let baseAmplitude = null;
        // Likewise its attack and release (shares of each note's duration);
        // null when the BaseNote sets none, and then the instrument's apply.
        let baseAttack = null, baseRelease = null;
        try {
          const baseCached = evalCache.get(0);
          if (baseCached && baseCached.amplitude) baseAmplitude = baseCached.amplitude;
          if (baseCached && baseCached.attack) baseAttack = baseCached.attack;
          if (baseCached && baseCached.release) baseRelease = baseCached.release;
        } catch {}
        const share = (v) => (v ? toNumber(v) : null);

        // Build note data list (no oscillators yet)
        const noteDataList = [];
        for (const id in module.notes) {
          // The BaseNote has a duration now (the time unit), but it never sounds and is not drawn as a note.
          if (Number(id) === 0) continue;
          const note = module.notes[id];
          const cached = evalCache.get(Number(id));
          if (!cached || !cached.startTime || !cached.duration) continue;

          const noteStart = toNumber(cached.startTime);
          const noteDuration = toNumber(cached.duration);
          const noteEnd = noteStart + noteDuration;

          if (noteEnd > fromTime && noteStart < moduleEndTime) {
            const adjustedStart = Math.max(0, noteStart - fromTime);
            const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);
            const freq = cached.frequency ? toNumber(cached.frequency) : null;

            noteDataList.push({
              id: note.id,
              startTime: adjustedStart,
              duration: adjustedDuration,
              frequency: freq,
              // Its tempered twin, always computed: which of the two sounds is
              // decided per voice in _scheduleNote, so the setting can be
              // switched while the module plays.
              temperedFrequency: freq != null ? temperedFrequency(freq, baseF) : null,
              instrument: freq != null ? getInstrument(note) : null,
              // Its player (src/players.js): the first note of its line, and the note
              // it follows in the line (null for a first note).
              ...(freq != null ? (() => { const pl = module.findPlayer ? module.findPlayer(note, instrumentMemo) : null; return pl ? { player: pl.head, prev: pl.prev } : {}; })() : {}),
              // Relative gain on the per-note peak, clamped to [0, 4] (see
              // amplitude.js); exactly 1 when neither the note nor the
              // BaseNote defines an amplitude.
              amplitude: amplitudeToGain(cached.amplitude || baseAmplitude),
              // The note's own envelope shape, or the BaseNote's, or null (the
              // instrument's): shares of the duration, clamped in the envelope.
              attack: share(cached.attack || baseAttack),
              release: share(cached.release || baseRelease),
              // Normalized pan position (−1..1) before width scaling; width and
              // enable are applied live at schedule time so mid-play stereo
              // changes affect newly-scheduled notes.
              panPos: freq != null ? this.graph.panPosition(freq, baseF) : null
            });
          }
        }

        // Sort by start time for streaming playback (id tie-break keeps the
        // pump's scheduling order deterministic for simultaneous notes).
        noteDataList.sort((a, b) => (a.startTime - b.startTime) || (a.id - b.id));

        const t2 = performance.now();

        // Collect unique instruments + the frequencies each will play, so
        // multisample instruments can preload exactly the zones they need.
        const uniqueInstruments = new Set();
        const freqsByInstrument = new Map();
        noteDataList.forEach(note => {
          if (!note.instrument) return;
          uniqueInstruments.add(note.instrument);
          if (note.frequency != null) {
            let list = freqsByInstrument.get(note.instrument);
            if (!list) { list = []; freqsByInstrument.set(note.instrument, list); }
            list.push(note.frequency);
            // Either pitch may be the one that sounds, and the two can fall in
            // different sample zones: have both decoded.
            if (note.temperedFrequency != null && note.temperedFrequency !== note.frequency) {
              list.push(note.temperedFrequency);
            }
          }
        });

        const loadPromises = Array.from(uniqueInstruments).map(instrumentName => {
          const instrument = this.instrumentManager.getInstrument(instrumentName);
          if (!instrument) return Promise.resolve();
          // Multisample instruments preload only the zones the upcoming notes hit.
          if (typeof instrument.prepare === 'function') {
            return instrument.prepare(freqsByInstrument.get(instrumentName) || []);
          }
          if (instrument.type === 'sample' && typeof instrument.waitForLoad === 'function') {
            return instrument.waitForLoad();
          }
          return Promise.resolve();
        });

        Promise.all(loadPromises)
          .then(() => {
            const t3 = performance.now();
            /*console.log(`[AudioEngine] preparePlayback timing:
  getModuleEndTime: ${(t1-t0).toFixed(1)}ms
  buildNoteData: ${(t2-t1).toFixed(1)}ms
  loadSamples: ${(t3-t2).toFixed(1)}ms
  TOTAL: ${(t3-t0).toFixed(1)}ms
  notes: ${noteDataList.length}`);*/

            // Return note data (not oscillators) - oscillators created in play()
            resolve(noteDataList);
          })
          .catch(error => {
            console.error('Error loading samples:', error);
            resolve([]);
          });
      });
    });
  }

  /**
   * Schedule and start playback with streaming oscillator creation.
   * Creates oscillators in batches to avoid blocking the main thread.
   *
   * LOOPING. With a `loop` descriptor the pump never runs out of notes: when the
   * current pass is fully scheduled it advances to the next one and keeps going,
   * so the wrap is just another batch. Nothing is torn down and rebuilt at the
   * seam — the buses, convolver and limiter in AudioGraph are persistent — so a
   * note's release and its reverb tail ring on across the boundary exactly as
   * they would mid-module. That is what makes the loop seamless, and it is why
   * looping cannot be done by calling play() again from the playhead (that path
   * re-anchors at currentTime + 0.1 and stopAll()s the tail: a ≥100 ms hole).
   *
   * Time is measured three ways here, and mixing them up is the easy bug:
   *   - clock rel    playback-relative clock seconds (ctx.currentTime - baseStartTime)
   *   - `rel`        playback-relative SCORE seconds: s.map.scoreAt(clock rel). Every
   *                  other time in the state (cycleStart, firstLen, period, cutRel) is
   *                  score time, so pass boundaries do not move when the tempo does.
   *   - `cycleStart` rel-time at which the current pass begins
   * A note's absolute start is therefore baseStartTime + map.clockAt(cycleStart + startTime);
   * at rate 1 that is baseStartTime + cycleStart + startTime, as before live tempo.
   *
   * @param {Array} noteDataList notes for the FIRST pass (from preparePlayback(fromTime),
   *   so their startTimes are relative to fromTime and the head note may be truncated)
   * @param {{initialVolume?:number, loop?:{period:number,notes:Array,firstCycleAudioLength?:number}|null}} options
   * @returns {number} baseStartTime
   */
  play(noteDataList, { initialVolume = this.INITIAL_VOLUME, loop = null } = {}) {
    const baseStartTime = this.audioContext.currentTime + 0.1;

    // Stop any existing streaming
    this._stopStreaming();

    // Schedule notes in time-based batches
    // Create oscillators for notes starting within the next LOOKAHEAD seconds
    const LOOKAHEAD = 2.0; // seconds ahead to schedule
    const BATCH_INTERVAL = 100; // ms between batch processing

    // The pump mutates this in place (disarmLoop() writes to it from outside).
    const s = {
      stopped: false,
      timerId: null,
      baseStartTime,
      initialVolume,
      list: noteDataList, // notes of the pass currently being scheduled
      firstList: noteDataList, // pass 0's notes (setRate() may rewind into it)
      // Score time -> clock time for this playback, at the live rate.
      map: new TimeMap(this.rate),
      nextIndex: 0,
      cycle: 0,           // 0 = the initial (possibly partial) pass
      cycleStart: 0,      // rel-time at which `list`'s pass begins
      // Loop fields, installed by _applyLoop().
      looping: false,
      period: 0,
      loopNotes: null,
      firstLen: 0,        // rel-time at which pass 0 ends (period - fromTime)
      // Set by disarmLoop(): rel-time of the final seam. Nothing at/after it sounds.
      cutRel: null,
      loopEndTime: null,  // absolute ctx time of that seam
      pump: null
    };
    this._streamingState = s;

    if (loop) this._applyLoop(s, loop);

    const pump = () => {
      if (this._streamingState !== s || s.stopped) return;
      s.timerId = null;

      const clockRel = this.audioContext.currentTime - s.baseStartTime;
      const targetTime = s.map.scoreAt(clockRel + LOOKAHEAD); // score time

      // `more` = this playback still has notes to schedule at some point.
      let more = true;

      for (let guard = 0; guard < MAX_CYCLES_PER_BATCH; guard++) {
        // Drain the current pass up to the lookahead horizon.
        let horizonReached = false;
        while (s.nextIndex < s.list.length) {
          const noteData = s.list[s.nextIndex];
          const at = s.cycleStart + noteData.startTime;

          // Past the final seam (the loop was disarmed): this note belongs to a pass
          // that will never sound. Nothing later can sound either — the list is sorted
          // and every subsequent pass starts later still — so this playback is done.
          if (s.cutRel != null && at >= s.cutRel - SEAM_EPS) { more = false; break; }

          // Not due yet.
          if (at > targetTime) { horizonReached = true; break; }

          // Skip notes without frequency (measure markers) and silent notes
          // (amplitude 0): there is nothing to hear, so no voice is built.
          if (noteData.frequency && noteData.instrument && noteData.amplitude !== 0) {
            // Through the time map: the clock start, and the clock length of the
            // note's score span (attack and release are shares of it, so they scale).
            const startClock = s.map.clockAt(at);
            const duration = s.map.clockAt(at + noteData.duration) - startClock;
            const start = s.baseStartTime + startClock;
            // passStartTime keeps its contract (passStartTime + noteData.startTime is
            // the note's absolute start) at any rate.
            this._scheduleNote(noteData, start - noteData.startTime, s.initialVolume, { duration, scoreStart: at });
          }
          s.nextIndex++;
        }
        if (!more || horizonReached) break;

        // The current pass is fully scheduled.
        if (!s.looping) { more = false; break; }

        // Advance to the next pass. Multiplicative, not `cycleStart += period`: an
        // accumulator would drift, and it must agree exactly with the test below or a
        // whole pass lands in the past and every note of it fires at once.
        const nextStart = s.firstLen + s.cycle * s.period; // start of pass s.cycle + 1
        if (nextStart > targetTime) break; // beyond the horizon; pick it up next batch

        s.cycle++;
        s.cycleStart = nextStart;
        s.list = s.loopNotes;
        s.nextIndex = 0;
      }

      // Keep pumping while notes remain in this pass OR more passes are coming. The
      // pre-loop version stopped the moment the last note was SCHEDULED, which is up
      // to LOOKAHEAD before it sounds — with a loop that would end playback after
      // exactly one pass (and immediately, for a module shorter than the lookahead).
      if (more) s.timerId = setTimeout(pump, BATCH_INTERVAL);
    };
    s.pump = pump;

    // Start the first batch immediately
    pump();

    return baseStartTime;
  }

  /**
   * Validate a loop descriptor and install it into a streaming state.
   *
   * The validation is not defensive dressing: an empty note list or a zero/NaN
   * period makes the pump's inner while() a no-op, so every iteration "exhausts"
   * the pass and advances a cycle. With a NaN period the `nextStart > targetTime`
   * break never fires either (every comparison with NaN is false), so without this
   * the tab hangs. A module with no notes DOES reach here (player.js forces
   * fromTime = 0 when the module is empty).
   *
   * @returns {boolean} whether the loop was armed
   */
  _applyLoop(s, loop) {
    if (!s || !loop) return false;
    const period = Number(loop.period);
    if (!Number.isFinite(period) || period < MIN_LOOP_PERIOD) return false;

    const notes = loop.notes;
    if (!Array.isArray(notes) || notes.length === 0) return false;
    // All-measure-marker modules would schedule nothing, forever.
    if (!notes.some(n => n && n.frequency && n.instrument)) return false;

    let firstLen = Number(loop.firstCycleAudioLength);
    if (!Number.isFinite(firstLen) || firstLen <= 0) firstLen = period;

    s.looping = true;
    s.period = period;
    s.loopNotes = notes;
    s.firstLen = firstLen;
    s.cutRel = null;
    s.loopEndTime = null;
    return true;
  }

  /**
   * Turn looping on for a playback that is already running (the user armed the mode
   * mid-module). Safe to call when the pump has already retired.
   * @returns {boolean} whether the loop was armed
   */
  armLoop(loop) {
    const s = this._streamingState;
    if (!s || s.stopped) return false;
    if (!this._applyLoop(s, loop)) return false;

    // The pump may have retired already (a non-looping playback stops rescheduling
    // as soon as the last note is scheduled). Restart it; pump() is idempotent — it
    // only ever schedules what is due.
    if (s.timerId) { clearTimeout(s.timerId); s.timerId = null; }
    if (s.pump) s.pump();
    return true;
  }

  /**
   * Stop looping, but let the pass in flight finish: playback runs to the next seam
   * and stops there.
   *
   * The lookahead means voices for the NEXT pass may already exist (and for a module
   * shorter than LOOKAHEAD, voices for several passes). They are cancelled here by
   * absolute start time rather than by cycle index — the scheduler's cycle counter
   * runs ahead of the pass you can actually hear, so it is the wrong thing to ask.
   *
   * @returns {number|null} absolute ctx time at which the final pass ends
   */
  disarmLoop() {
    const s = this._streamingState;
    if (!s || s.stopped || !s.looping) return null;

    const rel = s.map.scoreAt(this.audioContext.currentTime - s.baseStartTime);
    const cutRel = this._nextSeamRel(rel, s);

    s.looping = false;
    s.cutRel = cutRel;
    s.loopEndTime = s.baseStartTime + s.map.clockAt(cutRel);

    this._cancelScheduledFrom(s.loopEndTime);
    return s.loopEndTime;
  }

  isLooping() {
    const s = this._streamingState;
    return !!(s && !s.stopped && s.looping);
  }

  getLoopEndTime() {
    const s = this._streamingState;
    if (!s) return null;
    // Recomputed: a tempo change after the disarm moves the final seam on the clock.
    if (s.cutRel != null && s.map) s.loopEndTime = s.baseStartTime + s.map.clockAt(s.cutRel);
    return s.loopEndTime;
  }

  /**
   * Score seconds elapsed in the playback in flight (negative during the 0.1 s
   * lead-in), through the same map the voices were scheduled with: the playhead
   * follows this, so it moves with the sound at any rate. null when nothing plays.
   */
  scoreElapsed() {
    const s = this._streamingState;
    if (!s || s.stopped || !s.map) return null;
    return s.map.scoreAt(this.audioContext.currentTime - s.baseStartTime);
  }

  /**
   * Live tempo. From RATE_CHANGE_LEAD ahead of now the playback in flight runs at
   * `rate` score seconds per clock second; later playbacks start at it.
   *
   * Voices that begin after the change are cancelled (they have not sounded) and
   * the pump rewinds to the first note at or after that score instant, so they are
   * scheduled again through the new map. Voices already begun keep their length.
   * Pass boundaries are score times, so a loop stays seamless across a change.
   * Frequencies are untouched.
   * @returns {number} the rate now in force
   */
  setRate(rate) {
    const r = clampRate(rate);
    this.rate = r;
    const s = this._streamingState;
    if (!s || s.stopped || !s.map) return r;
    if (r === s.map.rate) return r;

    const cutClock = Math.max(0, this.audioContext.currentTime - s.baseStartTime + RATE_CHANGE_LEAD);
    const cutScore = s.map.setRate(r, cutClock);

    // Cancel by score position: the same numbers the rewind below compares, so a
    // note is either kept or rescheduled, never both and never neither.
    for (const entry of Array.from(this.activeOscillators)) {
      if (entry.scoreStart == null || entry.scoreStart < cutScore) continue;
      this.activeOscillators.delete(entry);
      try { entry.voice.stop(entry.startTime); } catch {}
      try { entry.voice.disconnect(); } catch {}
      try { entry.gainNode.disconnect(); } catch {}
      try { entry.panner && entry.panner.disconnect(); } catch {}
    }

    // Rewind the pump to the pass holding cutScore and the first note at or after it.
    let cycle = 0, cycleStart = 0, list = s.firstList;
    if (s.loopNotes && s.period > 0 && cutScore >= s.firstLen) {
      cycle = Math.floor((cutScore - s.firstLen) / s.period) + 1;
      cycleStart = s.firstLen + (cycle - 1) * s.period;
      list = s.loopNotes;
    }
    let i = 0;
    while (i < list.length && cycleStart + list[i].startTime < cutScore) i++;
    // Only ever rewind: a pump that is behind keeps its place (nothing it has not
    // scheduled yet was cancelled).
    if (cycle < s.cycle || (cycle === s.cycle && i < s.nextIndex)) {
      s.cycle = cycle;
      s.cycleStart = cycleStart;
      s.list = list;
      s.nextIndex = i;
    }
    if (s.timerId) { clearTimeout(s.timerId); s.timerId = null; }
    if (s.pump) s.pump();
    return r;
  }

  /** Playback-relative time of the first pass boundary STRICTLY after `rel`. */
  _nextSeamRel(rel, s) {
    if (rel < s.firstLen) return s.firstLen;
    const k = Math.floor((rel - s.firstLen) / s.period) + 1;
    return s.firstLen + k * s.period;
  }

  /**
   * Cancel every voice scheduled to start at or after `atTime`.
   *
   * A voice whose start is still in the future and whose stop is moved to its own
   * start never produces sound (the same property stopAll() relies on), so this is
   * silent — no fade needed. Voices already sounding are left alone: their release
   * and reverb tail are part of the pass that is still playing.
   */
  _cancelScheduledFrom(atTime) {
    for (const entry of Array.from(this.activeOscillators)) {
      if (!(entry.startTime >= atTime - SEAM_EPS)) continue;

      // Drop it from tracking first: the entry's own cleanup() timer checks
      // membership and will now bail, leaving this the only teardown.
      this.activeOscillators.delete(entry);
      try { entry.voice.stop(entry.startTime); } catch {}
      try { entry.voice.disconnect(); } catch {}
      try { entry.gainNode.disconnect(); } catch {}
      try { entry.panner && entry.panner.disconnect(); } catch {}
    }
  }

  /**
   * Schedule a single note for playback.
   * Voice chain: source → voiceGain(env) → [StereoPanner] → instrument bus.
   * The source's pitch is the note's own frequency, or its tempered twin when
   * the `audio.tempered` setting is on at this moment.
   *
   * @param {number} passStartTime absolute ctx time such that passStartTime +
   *   noteData.startTime is the note's start (at rate 1: baseStartTime + cycleStart)
   * @param {{duration?:number, scoreStart?:number}} [timing] the note's clock length
   *   through the time map (default noteData.duration), and its score position,
   *   which setRate() cancels against
   */
  _scheduleNote(noteData, passStartTime, initialVolume, timing = null) {
    const ctx = this.audioContext;
    const start = passStartTime + noteData.startTime;
    const duration = (timing && Number.isFinite(timing.duration) && timing.duration > 0) ? timing.duration : noteData.duration;

    // Pure or tempered (Settings → Audio), read here like the stereo placement:
    // per voice, as it is scheduled. A note prepared without a tempered pitch
    // plays the one it has.
    const frequency = (this.graph.temperedEnabled && noteData.temperedFrequency > 0)
      ? noteData.temperedFrequency
      : noteData.frequency;

    // Create the voice (may be a bare OscillatorNode or a wrapper) + envelope.
    const voice = this.instrumentManager.createOscillator(noteData.instrument, frequency);
    const gainNode = ctx.createGain();
    // A GainNode defaults to 1, and voices are built up to LOOKAHEAD seconds
    // before they sound. That default is what a pending voice's gain reads back
    // as, so a fade-out (pauseFade/stopAll) would anchor it at 1.0, cancel its
    // envelope, and let it start mid-fade at 5x the intended peak — an audible
    // blast of a note that should never have sounded. Rest at silence instead;
    // the envelope's setValueAtTime(EPS, start) takes over from here.
    gainNode.gain.value = 0;

    // The note's amplitude scales the envelope peak. `?? 1` keeps callers that
    // build noteData without it (and every module that never sets amplitude)
    // at exactly the old peak: x * 1 === x.
    const peak = initialVolume * (noteData.amplitude ?? 1);

    // The note's end is a note-off: its release rings after it, so the voice
    // lives for `length` seconds, the note and its tail.
    const shape = { attack: noteData.attack ?? null, release: noteData.release ?? null };
    let length = duration + FALLBACK_TAIL;
    let times = null;
    try {
      this.instrumentManager.applyEnvelope(noteData.instrument, gainNode, start, duration, peak, shape, frequency);
      length = this.instrumentManager.voiceLength(noteData.instrument, duration, shape, frequency);
      times = this.instrumentManager.envelopeTimesFor(noteData.instrument, duration, shape, frequency);
    } catch (e) {
      console.warn('applyEnvelope failed', e);
    }
    this._makeRoomAt(start);

    // Pitch-driven stereo pan (only when enabled and supported).
    let panner = null;
    if (this.graph.stereoEnabled && noteData.panPos != null && typeof ctx.createStereoPanner === 'function') {
      try {
        panner = ctx.createStereoPanner();
        const p = noteData.panPos * this.graph.stereoWidth;
        panner.pan.value = p < -1 ? -1 : p > 1 ? 1 : p;
      } catch { panner = null; }
    }

    const bus = this.graph.getBus(noteData.instrument);
    try {
      voice.connect(gainNode);
      if (panner) {
        gainNode.connect(panner);
        panner.connect(bus);
      } else {
        gainNode.connect(bus);
      }
    } catch {}

    // Stop once the release has reached zero (no click).
    try {
      voice.start(start);
      voice.stop(start + length);
    } catch {}

    // `startTime` is what disarmLoop() cancels against — around a loop seam the set
    // holds voices from two passes at once (the outgoing pass's release tails overlap
    // the incoming pass's attacks), so "which pass is this voice in" can only be
    // answered from its own scheduled time.
    const entry = {
      voice, gainNode, panner, startTime: start, scoreStart: timing ? timing.scoreStart : null, noteId: noteData.id,
      // The note-off and the end of the tail (absolute ctx time), and the gain at a
      // time in the release: what _makeRoomAt needs to steal it without a step.
      offTime: start + (times ? times.off : duration), endTime: start + length,
      levelAt: times ? (x) => {
        const p = Math.max(EPS_GAIN, peak), atOff = Math.max(EPS_GAIN, p * times.levelAtEnd);
        const k = Math.min(1, Math.max(0, (x - start - times.off) / times.release));
        return atOff * Math.pow(EPS_GAIN / atOff, k);
      } : null,
    };
    this.activeOscillators.add(entry);
    if (this.activeOscillators.size > this.voiceStats.peak) this.voiceStats.peak = this.activeOscillators.size;

    const cleanup = () => {
      if (!this.activeOscillators.has(entry)) return;
      this.activeOscillators.delete(entry);
      try { voice.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      try { panner && panner.disconnect(); } catch {}
    };
    // Prefer the node's own 'ended' event; fall back to a timer for wrappers
    // that don't forward onended.
    let ended = false;
    try {
      voice.onended = () => { ended = true; cleanup(); };
    } catch {}
    const ms = Math.max(0, (start + length - ctx.currentTime) * 1000) + 60;
    setTimeout(() => { if (!ended) cleanup(); }, ms);
  }

  /**
   * Keep the voices sounding at `at` under MAX_VOICES: while there are as many as
   * that, fade out the one whose note-off is the longest past (the furthest into
   * its release, so the quietest), from `at` over STEAL_FADE. Its gain follows its
   * own release up to `at` (the exponential is rebuilt through that point), so the
   * fade starts from the level it has there. A voice before its note-off is left.
   */
  _makeRoomAt(at) {
    const limit = (this.graph && this.graph.maxVoices > 0) ? this.graph.maxVoices : MAX_VOICES;
    let sounding = 0;
    // A voice already being stolen no longer counts: it is fading out.
    for (const e of this.activeOscillators) if (!e.stolen && e.startTime <= at && e.endTime > at) sounding++;
    while (sounding >= limit) {
      let victim = null;
      for (const e of this.activeOscillators) {
        if (!(e.offTime <= at && e.endTime > at + STEAL_FADE) || !e.levelAt || e.stolen) continue;
        if (!victim || e.offTime < victim.offTime) victim = e;
      }
      if (!victim) return;
      victim.stolen = true;
      try {
        const g = victim.gainNode.gain;
        g.cancelScheduledValues(at);
        g.exponentialRampToValueAtTime(victim.levelAt(at), at);
        g.linearRampToValueAtTime(0, at + STEAL_FADE);
        victim.voice.stop(at + STEAL_FADE + 0.005);
        victim.endTime = at + STEAL_FADE + 0.005;
      } catch {}
      this.voiceStats.stolen++;
      sounding--;
    }
  }

  /**
   * The playback reached its end (the module's end, or the final seam of a loop
   * that was switched off): stop scheduling, but let the voices already sounding
   * ring out their releases. Each stops itself at the end of its tail. A new
   * play(), stopAll() or pauseFade() still cuts them.
   */
  finish() {
    this._stopStreaming();
  }

  /**
   * Stop the streaming scheduler
   */
  _stopStreaming() {
    // Cancel any in-flight pause-fade teardown and settle its promise so the
    // transport state machine (player.js pause().then) doesn't dangle when a
    // new playback supersedes the fade.
    if (this._pauseFadeTimer) {
      clearTimeout(this._pauseFadeTimer);
      this._pauseFadeTimer = null;
      const r = this._pauseFadeResolve;
      this._pauseFadeResolve = null;
      if (r) { try { r(); } catch {} }
    }
    if (this._streamingState) {
      this._streamingState.stopped = true;
      if (this._streamingState.timerId) {
        clearTimeout(this._streamingState.timerId);
      }
      this._streamingState = null;
    }
  }

  /**
   * Fade out all active oscillators and stop/cleanup after ramp.
   * @param {number} rampTime seconds
   * @returns {Promise<void>}
   */
  pauseFade(rampTime = this.GENERAL_VOLUME_RAMP_TIME) {
    return new Promise((resolve) => {
      // _stopStreaming() cancels any prior pending fade (and resolves it).
      this._stopStreaming();
      const now = this.audioContext.currentTime;
      for (const entry of this.activeOscillators) {
        try {
          const g = entry.gainNode.gain;
          // Anchor the current value before the fade — cancelScheduledValues
          // alone leaves a stale past envelope event as the ramp's start point,
          // which would step the gain down instantly (click) instead of fading.
          const cur = g.value;
          g.cancelScheduledValues(now);
          g.setValueAtTime(cur, now);
          g.linearRampToValueAtTime(0, now + rampTime);
        } catch {}
      }
      // Store the teardown so a new playback (which calls _stopStreaming) can
      // cancel it — otherwise this timer would stopAll() the new notes.
      this._pauseFadeResolve = resolve;
      this._pauseFadeTimer = setTimeout(() => {
        this._pauseFadeTimer = null;
        this._pauseFadeResolve = null;
        // Voices are already at zero from the fade above — no declick needed.
        try { this.stopAll(0); } finally { resolve(); }
      }, Math.max(0, rampTime * 1000));
    });
  }

  /**
   * Stop all active voices and clear tracking.
   *
   * Cutting a sounding voice with stop(now)+disconnect steps the bus from the
   * voice's instantaneous sample value to zero within one sample. Measured over a
   * sweep of cut phases, that step reaches 17.5x the natural slew of the sustain
   * it interrupts — a broadband edge. The reverb send runs at unity, so it hits
   * the convolver and smears across the IR's full length as a tick plus hiss.
   * (It rides *under* the note's own reverb tail rather than above it, so it does
   * not raise the level — but it puts 40 dB of splatter into 1-5 kHz and 57 dB
   * into >5 kHz that has no business being there. That is the "pshhh" on Stop.)
   * Fade the voices out first (inaudibly short), then stop and disconnect: the
   * step then never exceeds the sustain's own slew, at any cut phase.
   *
   * @param {number} fadeSec declick fade. Pass 0 when the caller has already
   *   faded the voices to zero (pauseFade), so teardown isn't delayed twice.
   */
  stopAll(fadeSec = DECLICK_FADE) {
    this._stopStreaming();
    const now = this.audioContext.currentTime;
    const entries = Array.from(this.activeOscillators);
    // Clear tracking up front so the per-note cleanup() timers bail out (they
    // check membership) and the deferred disconnect below is the only teardown.
    this.activeOscillators.clear();
    if (!entries.length) return;

    const fade = Math.max(0, fadeSec);
    const stopAt = now + fade;

    for (const entry of entries) {
      if (fade > 0) {
        try {
          const g = entry.gainNode.gain;
          // Anchor the current value at `now` before ramping — cancelScheduledValues
          // alone leaves a past envelope event as the ramp's start point, which
          // would step the gain instead of fading it (the very click we're killing).
          const cur = g.value;
          g.cancelScheduledValues(now);
          g.setValueAtTime(cur, now);
          g.linearRampToValueAtTime(0, stopAt);
        } catch {}
      }
      // Overrides the stop already scheduled when the note was created. A voice
      // whose start is still in the future simply never sounds.
      try { entry.voice.stop(stopAt); } catch {}
    }

    const disconnectAll = () => {
      for (const entry of entries) {
        try { entry.voice.disconnect(); } catch {}
        try { entry.gainNode.disconnect(); } catch {}
        try { entry.panner && entry.panner.disconnect(); } catch {}
      }
    };
    if (fade > 0) setTimeout(disconnectAll, fade * 1000 + 30);
    else disconnectAll();
  }
}

// Shared singleton for app usage
export const audioEngine = new AudioEngine();
