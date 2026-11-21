import { toNumber as exactToNumber } from '../value/exact.ts';
import { toNumber } from '../utils/fraction-num.ts';
import { InstrumentManager, envelopeGainAt } from '../instruments/instrument-manager.ts';
import { AudioGraph } from './audio-graph.ts';
import { amplitudeToGain } from './amplitude.ts';
import { TimeMap, clampRate } from './time-map.ts';
import { passTransposition } from './display-transpose.ts';

import type { Module } from '../module.ts';
import type { Note } from '../note.ts';
import type { ExactValue } from '../value/exact.ts';
import type { InstrumentClasses, Voice } from '../instruments/instrument-manager.ts';

export interface PlaybackNote {
  id?: number;
  startTime: number;
  duration: number;
  frequency: number | null;
  temperedFrequency?: number | null;
  instrument: string | null;
  player?: number;
  prev?: number | null;
  slur?: boolean;
  amplitude?: number;
  attack?: number | null;
  release?: number | null;
  panPos?: number | null;
}

export type PreparedNote = PlaybackNote & { id: number };
type SoundingNote = PlaybackNote & { frequency: number; instrument: string };
function sounds(note: PlaybackNote): note is SoundingNote {
  return !!note.frequency && !!note.instrument && note.amplitude !== 0;
}

interface Loop {
  period: number;
  notes: PlaybackNote[];
  firstCycleAudioLength?: number;
}
interface Transposition {
  ratio: ExactValue | null;
  fold?: boolean;
  offset?: number;
}
interface PlaybackOptions {
  initialVolume?: number;
  loop?: Loop | null;
  transpose?: Transposition | null;
}

type Times = ReturnType<InstrumentManager['envelopeTimesFor']>;
interface ScheduledVoice {
  voice: Voice;
  gainNode: GainNode;
  panner: StereoPannerNode | null;
  startTime: number;
  scoreStart: number | null | undefined;
  noteId: number | undefined;
  frequency: number;
  instrument: string;
  slur: boolean;
  offTime: number;
  endTime: number;
  levelAt: ((at: number) => number) | null;
  times: Times | null;
  peak: number;
  faded: ScheduledVoice[];
  stolen?: boolean;
  fade?: { at: number; origEnd: number } | null;
}

interface VoiceCensus {
  at: number;
  sounding: number;
  victims: ScheduledVoice[];
  next: number;
}
interface Timing {
  duration?: number;
  scoreStart?: number;
  transpose?: number;
  room?: Partial<VoiceCensus>;
}
interface StreamingState {
  stopped: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  baseStartTime: number;
  initialVolume: number;
  list: PlaybackNote[];
  firstList: PlaybackNote[];
  map: TimeMap;
  nextIndex: number;
  cycle: number;
  transposeRatio: ExactValue | null;
  transposeFold: boolean;
  passOffset: number;
  passFactors: Map<number, number>;
  cycleStart: number;
  looping: boolean;
  period: number;
  loopNotes: PlaybackNote[] | null;
  firstLen: number;
  cutRel: number | null;
  loopEndTime: number | null;
  pump: (() => void) | null;
}

type TransportBus = { node: GainNode; from: number; to: number; start: number; end: number };

// Short enough to read as instant, long enough that the cut is not a step.
const DECLICK_FADE = 0.02; // seconds
const START_FADE = 0.008; // seconds, only at transport start/resume

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
// Lines (Phase I, design §5): a slur's crossfade (violin), a new bow stroke on the
// same pitch, a damper on a re-struck pitch (piano, vibraphone, fm-epiano).
const SLUR_XFADE = 0.04;
const REBOW_FADE = 0.03;
const DAMP_FADE = 0.02;
const EPS_GAIN = 0.0001; // the envelope's floor (instrument-manager.js EPS)
// A live tempo change takes effect this far ahead of the audio clock, so no voice
// is ever rescheduled into the past (the pump runs on a 100 ms timer).
const RATE_CHANGE_LEAD = 0.05; // seconds
// Sparse scores can be queued well ahead. In a dense passage each future
// voice is another connected Web Audio graph until its source ends.
const DENSE_WINDOW_NOTES = 128;
const DENSE_LOOKAHEAD = 0.4;
const PUMP_BUDGET_MS = 5;

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
export function temperedFrequency(freq: number, baseFreq: number) {
  if (!(freq > 0) || !(baseFreq > 0)) return freq;
  return baseFreq * Math.pow(2, Math.round(12 * Math.log2(freq / baseFreq)) / 12);
}

export class AudioEngine {
  declare INITIAL_VOLUME: number;
  declare GENERAL_VOLUME_RAMP_TIME: number;
  declare audioContext: AudioContext;
  declare graph: AudioGraph;
  declare instrumentManager: InstrumentManager;
  declare activeOscillators: Set<ScheduledVoice>;
  declare _transportBuses: Map<string, TransportBus>;
  declare voiceStats: { peak: number; stolen: number };
  declare _streamingState: StreamingState | null;
  declare rate: number;
  declare _baseF?: number;
  declare _unlocked?: boolean;
  declare _pauseFadeTimer: ReturnType<typeof setTimeout> | null;
  declare _pauseFadeResolve: (() => void) | null;

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
    this.activeOscillators = new Set();
    this._transportBuses = new Map();
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
  registerInstruments(SynthInstruments: InstrumentClasses, SampleInstruments: InstrumentClasses) {
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

  setVolume(value: number) {
    if (!this.audioContext || !this.graph) return;
    this.graph.setMasterVolume(Number(value));
  }

  /**
   * preparePlayback(module, fromTime)
   * Prepares note data for playback without creating oscillators upfront.
   * Oscillators are created just-in-time during play() to avoid blocking.
   */
  preparePlayback(module: Module, fromTime: number): Promise<PreparedNote[]> {
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
        const instrumentCache = new Map<number, string>();
        const instrumentMemo = new Map<number, string>(); // shared by every lookup: each chain is walked once
        const getInstrument = (note: Note): string => {
          const cached = instrumentCache.get(note.id);
          if (cached !== undefined) return cached;
          const resolved: string = module.findInstrument(note, instrumentMemo).toLowerCase();
          instrumentCache.set(note.id, resolved);
          return resolved;
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
        if (baseF == null || !(baseF > 0)) baseF = 440;
        // Kept for transposed loop passes: their tempered twins and stereo places.
        this._baseF = baseF;

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
        const share = (v: Parameters<typeof toNumber>[0]) => (v ? toNumber(v) : null);

        // Build note data list (no oscillators yet)
        const noteDataList: PreparedNote[] = [];
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
              ...(freq != null ? (() => {
                const pl = module.findPlayer ? module.findPlayer(note, instrumentMemo) : null;
                if (!pl) return {};
                // Slurred (bowed instruments) when it starts exactly where the note it
                // follows in its line ends: no rest between them, compared exactly.
                let slur = false;
                if (pl.prev != null) {
                  const pc = evalCache.get(pl.prev);
                  try { slur = !!(pc && pc.startTime && pc.duration && pc.frequency && pc.startTime.add(pc.duration).equals(cached.startTime)); } catch {}
                }
                return { player: pl.head, prev: pl.prev, slur };
              })() : {}),
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
        const uniqueInstruments = new Set<string>();
        const freqsByInstrument = new Map<string, number[]>();
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
   * re-anchors after the startup lead and stopAll()s the tail: a ≥100 ms hole).
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
  play(noteDataList: PlaybackNote[], { initialVolume = this.INITIAL_VOLUME, loop = null, transpose = null }: PlaybackOptions = {}) {
    // Retire any voices still sounding from a previous play or pause fade.
    this.stopAll();

    // Schedule notes in time-based batches
    // Create oscillators for notes starting within the next LOOKAHEAD seconds
    const LOOKAHEAD = 2.0; // seconds ahead to schedule
    const BATCH_INTERVAL = 100; // ms between batch processing

    // The pump mutates this in place (disarmLoop() writes to it from outside).
    const s: StreamingState = {
      stopped: false,
      timerId: null,
      baseStartTime: 0,
      initialVolume,
      list: noteDataList, // notes of the pass currently being scheduled
      firstList: noteDataList, // pass 0's notes (setRate() may rewind into it)
      // Score time -> clock time for this playback, at the live rate.
      map: new TimeMap(this.rate),
      nextIndex: 0,
      cycle: 0,           // 0 = the initial (possibly partial) pass
      // Repeat transposition, fixed for this playback: pass c sounds at
      // passTransposition(ratio, passOffset + c, fold) times the written frequencies
      // (exact; see display-transpose.js). The player hands it in: the module's own
      // repeat (its BaseNote's `repeat`) and the fold preference; without it, none.
      ...this._transposeState(transpose),
      passFactors: new Map(),
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
    this._prepareTransposed(s, noteDataList);
    // Seeking into a chord restarts every held voice together. Budget time
    // to build the opening in slices before its common audio-clock start.
    let openingVoices = 0;
    for (const note of noteDataList) {
      if (note.startTime > 0.1 * this.rate) break;
      if (note.frequency && note.instrument && note.amplitude !== 0) openingVoices++;
    }
    const baseStartTime = this.audioContext.currentTime + Math.max(0.1, openingVoices * 0.0005);
    s.baseStartTime = baseStartTime;

    const pump = () => {
      if (this._streamingState !== s || s.stopped) return;
      s.timerId = null;

      const clockRel = Math.max(0, this.audioContext.currentTime - s.baseStartTime);
      const horizon = s.map.scoreAt(clockRel + LOOKAHEAD);
      const laterNote = s.list[s.nextIndex + DENSE_WINDOW_NOTES];
      const nextPass = s.firstLen + s.cycle * s.period;
      const repeatsInWindow = s.looping ? Math.max(0, (horizon - nextPass) / s.period) : 0;
      const dense = (laterNote && s.cycleStart + laterNote.startTime <= horizon)
        || (repeatsInWindow > 0 && s.loopNotes && repeatsInWindow * s.loopNotes.length >= DENSE_WINDOW_NOTES);
      // Hold fewer clock seconds of nodes when the score is running faster.
      // Wake at least four times per window to leave room for a late timer.
      const windowSeconds = dense ? Math.max(0.18, DENSE_LOOKAHEAD / Math.max(1, s.map.rate)) : LOOKAHEAD;
      const interval = Math.min(BATCH_INTERVAL, windowSeconds * 250);
      const targetTime = s.map.scoreAt(clockRel + windowSeconds);
      const deadline = performance.now() + PUMP_BUDGET_MS;
      let examined = 0;
      let yielded = false;
      const room = {};

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
          // Give the UI a turn between bursts. Resume promptly, keeping the
          // same ordered cursor even when a chord spans more than one batch.
          if (examined && examined % 32 === 0 && performance.now() >= deadline) {
            yielded = horizonReached = true;
            break;
          }

          // Skip notes without frequency (measure markers) and silent notes
          // (amplitude 0): there is nothing to hear, so no voice is built.
          if (sounds(noteData)) {
            // Through the time map: the clock start, and the clock length of the
            // note's score span (attack and release are shares of it, so they scale).
            const startClock = s.map.clockAt(at);
            const duration = s.map.clockAt(at + noteData.duration) - startClock;
            const start = s.baseStartTime + startClock;
            // passStartTime keeps its contract (passStartTime + noteData.startTime is
            // the note's absolute start) at any rate.
            const transpose = this._passFactor(s, s.cycle);
            this._scheduleNote(noteData, start - noteData.startTime, s.initialVolume, { duration, scoreStart: at, transpose, room });
          }
          s.nextIndex++;
          examined++;
        }
        if (!more || horizonReached) break;

        // The current pass is fully scheduled.
        if (!s.looping || !s.loopNotes) { more = false; break; }

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
      if (more) s.timerId = setTimeout(pump, yielded ? 0 : interval);
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
  _applyLoop(s: StreamingState, loop: Loop | null) {
    if (!s || !loop) return false;
    const period = Number(loop.period);
    if (!Number.isFinite(period) || period < MIN_LOOP_PERIOD) return false;

    const notes = loop.notes;
    if (!Array.isArray(notes) || notes.length === 0) return false;
    // A score of measure markers, rests or muted notes has nothing to repeat.
    if (!notes.some(n => n && n.frequency && n.instrument && n.amplitude !== 0)) return false;

    let firstLen = Number(loop.firstCycleAudioLength);
    if (!Number.isFinite(firstLen) || firstLen <= 0) firstLen = period;

    s.looping = true;
    s.period = period;
    s.loopNotes = notes;
    s.firstLen = firstLen;
    s.cutRel = null;
    s.loopEndTime = null;
    this._prepareTransposed(s, notes);
    return true;
  }

  /** The transposition fields of a streaming state, from play()'s `transpose` or the setting. */
  _transposeState(transpose?: Transposition | null) {
    if (transpose) {
      return { transposeRatio: transpose.ratio || null, transposeFold: transpose.fold !== false, passOffset: Math.max(0, (transpose.offset ?? 0) | 0) };
    }
    // Without one, no transposition: a repeat belongs to the module (its BaseNote's
    // `repeat`), which the player reads; nothing app-wide is imposed.
    return { transposeRatio: null, transposeFold: true, passOffset: 0 };
  }

  /** The factor every written frequency of pass `cycle` of this playback is multiplied by. */
  _passFactor(s: Pick<StreamingState, 'transposeRatio' | 'passOffset' | 'transposeFold' | 'passFactors'>, cycle: number) {
    if (!s.transposeRatio) return 1;
    const pass = s.passOffset + cycle;
    if (pass === 0) return 1;
    let f = s.passFactors.get(pass);
    if (f === undefined) {
      try { f = exactToNumber(passTransposition(s.transposeRatio, pass, s.transposeFold), 1); } catch { f = 1; }
      if (!(f > 0)) f = 1;
      s.passFactors.set(pass, f);
    }
    return f;
  }

  // A transposed pass reaches pitches its notes' preparation did not: decode every
  // zone of the sampled instruments these notes use, so no note of a later pass
  // falls back to a sine while its zone loads.
  _prepareTransposed(s: StreamingState, notes: PlaybackNote[]) {
    if (!s.transposeRatio || !Array.isArray(notes)) return;
    const names = new Set(notes.map((n) => n && n.instrument).filter(Boolean));
    for (const name of names) {
      try {
        const inst = this.instrumentManager.getInstrument(name);
        if (inst && typeof inst.prepare === 'function' && Array.isArray(inst.zones)) inst.prepare(inst.zones.map((z) => z.rootHz));
      } catch {}
    }
  }

  /**
   * Turn looping on for a playback that is already running (the user armed the mode
   * mid-module). Safe to call when the pump has already retired.
   * @returns {boolean} whether the loop was armed
   */
  armLoop(loop: Loop | null) {
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
   * Score seconds elapsed in the playback in flight (negative during the startup
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
  setRate(rate: number) {
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
      this._restoreFaded(entry);
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
  _nextSeamRel(rel: number, s: StreamingState) {
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
  _cancelScheduledFrom(atTime: number) {
    for (const entry of Array.from(this.activeOscillators)) {
      if (!(entry.startTime >= atTime - SEAM_EPS)) continue;

      // Drop it from tracking first: the entry's own cleanup() timer checks
      // membership and will now bail, leaving this the only teardown.
      this.activeOscillators.delete(entry);
      this._restoreFaded(entry);
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
  _scheduleNote(noteData: SoundingNote, passStartTime: number, initialVolume: number, timing: Timing | null = null) {
    const ctx = this.audioContext;
    const start = passStartTime + noteData.startTime;
    const duration = (timing?.duration != null && Number.isFinite(timing.duration) && timing.duration > 0) ? timing.duration : noteData.duration;

    // Pure or tempered (Settings → Audio), read here like the stereo placement:
    // per voice, as it is scheduled. A note prepared without a tempered pitch
    // plays the one it has.
    // A transposed loop pass: every written frequency times one factor; its
    // tempered twin is taken from the transposed pitch.
    const k = (timing?.transpose != null && timing.transpose > 0) ? timing.transpose : 1;
    const frequency = k === 1
      ? ((this.graph.temperedEnabled && noteData.temperedFrequency != null && noteData.temperedFrequency > 0) ? noteData.temperedFrequency : noteData.frequency)
      : (this.graph.temperedEnabled ? temperedFrequency(noteData.frequency * k, this._baseF || 440) : noteData.frequency * k);

    // Create the voice (may be a bare OscillatorNode or a wrapper) + envelope.
    const voice = this.instrumentManager.createOscillator(noteData.instrument, frequency);
    const gainNode = ctx.createGain();
    // Remain silent until the envelope starts on the audio clock.
    gainNode.gain.value = 0;

    // The note's amplitude scales the envelope peak. `?? 1` keeps callers that
    // build noteData without it (and every module that never sets amplitude)
    // at exactly the old peak: x * 1 === x.
    const peak = initialVolume * (noteData.amplitude ?? 1);

    // A line (src/players.js): a bowed note that starts exactly where the previous
    // note of its line ends is slurred from it, unless it repeats its pitch (a new
    // stroke). preparePlayback marks the notes that touch their predecessor.
    let articulation = 'sustained';
    try { articulation = this.instrumentManager.getInstrument(noteData.instrument)?.articulation || 'sustained'; } catch {}
    const prevVoice = articulation === 'bowed' && noteData.slur && noteData.prev != null ? this._voiceOf(noteData.prev, start) : null;
    const repeatsPitch = !!prevVoice && Math.abs(prevVoice.frequency - frequency) <= 1e-9 * frequency;
    const slur = !!prevVoice && !repeatsPitch;

    // The note's end is a note-off: its release rings after it, so the voice
    // lives for `length` seconds, the note and its tail. A slurred note has no bow
    // attack of its own: it enters over the crossfade.
    const shape = {
      attack: noteData.attack ?? (slur ? Math.min(1, SLUR_XFADE / Math.max(duration, 1e-3)) : null),
      release: noteData.release ?? null,
    };
    let length = duration + FALLBACK_TAIL;
    let times = null;
    try {
      this.instrumentManager.applyEnvelope(noteData.instrument, gainNode, start, duration, peak, shape, frequency);
      length = this.instrumentManager.voiceLength(noteData.instrument, duration, shape, frequency);
      times = this.instrumentManager.envelopeTimesFor(noteData.instrument, duration, shape, frequency);
    } catch (e) {
      console.warn('applyEnvelope failed', e);
    }
    this._makeRoomAt(start, timing?.room);
    // The voice this one takes over from (a slur, a new stroke, a re-struck pitch)
    // fades from the level it has at this note's start.
    const faded = [];
    if (slur) faded.push(this._fadeVoice(prevVoice, start, SLUR_XFADE, true));
    else if (repeatsPitch) faded.push(this._fadeVoice(prevVoice, start, REBOW_FADE, false));
    if (articulation === 'struck') {
      for (const e of this.activeOscillators) {
        if (e.instrument !== noteData.instrument || e.fade || !(e.startTime < start && e.endTime > start)) continue;
        if (Math.abs(e.frequency - frequency) <= 1e-9 * frequency) faded.push(this._fadeVoice(e, start, DAMP_FADE, false));
      }
    }

    // Pitch-driven stereo pan (only when enabled and supported).
    let panner = null;
    if (this.graph.stereoEnabled && noteData.panPos != null && typeof ctx.createStereoPanner === 'function') {
      try {
        panner = ctx.createStereoPanner();
        const pos = k === 1 ? noteData.panPos : this.graph.panPosition(noteData.frequency * k, this._baseF || 440);
        const p = pos * this.graph.stereoWidth;
        panner.pan.value = p < -1 ? -1 : p > 1 ? 1 : p;
      } catch { panner = null; }
    }

    const bus = this._transportBus(noteData.instrument);
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
      voice.start(start, slur ? (voice.bowOffset || 0) : 0);
      voice.stop(start + length);
    } catch {}

    // `startTime` is what disarmLoop() cancels against — around a loop seam the set
    // holds voices from two passes at once (the outgoing pass's release tails overlap
    // the incoming pass's attacks), so "which pass is this voice in" can only be
    // answered from its own scheduled time.
    const entry: ScheduledVoice = {
      voice, gainNode, panner, startTime: start, scoreStart: timing ? timing.scoreStart : null, noteId: noteData.id, frequency,
      instrument: noteData.instrument, slur,
      // The note-off and the end of the tail (absolute ctx time), and the gain at
      // any time: what a fade (_makeRoomAt, _fadeVoice) starts from, without a step.
      offTime: start + (times ? times.off : duration), endTime: start + length,
      levelAt: times ? (x) => envelopeGainAt(times, peak, x - start) : null,
      times, peak,
      // The voices this one faded (restored if it is cancelled before it sounds)
      faded: faded.filter(e => e !== null),
    };
    const voices = this.activeOscillators;
    const transportBuses = this._transportBuses;
    voices.add(entry);
    if (this.activeOscillators.size > this.voiceStats.peak) this.voiceStats.peak = this.activeOscillators.size;

    const cleanup = () => {
      if (!voices.delete(entry)) return;
      try { voice.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      try { panner && panner.disconnect(); } catch {}
      if (!voices.size && transportBuses !== this._transportBuses) {
        for (const { node } of transportBuses.values()) node.disconnect();
      }
    };
    // Prefer the node's own 'ended' event; fall back to a timer for wrappers
    // that don't forward onended.
    if ('onended' in voice) {
      try { voice.onended = cleanup; return; } catch {}
    }
    const cleanupWhenEnded = () => {
      if (!voices.has(entry)) return;
      const remaining = entry.endTime - ctx.currentTime;
      if (remaining <= 0 || ctx.state === 'closed') cleanup();
      else setTimeout(cleanupWhenEnded, Math.max(100, remaining * 1000 + 60));
    };
    setTimeout(cleanupWhenEnded, Math.max(0, (entry.endTime - ctx.currentTime) * 1000) + 60);
  }

  /**
   * Keep the voices sounding at `at` under MAX_VOICES: while there are as many as
   * that, fade out the one whose note-off is the longest past (the furthest into
   * its release, so the quietest), from `at` over STEAL_FADE. Its gain follows its
   * own release up to `at` (the exponential is rebuilt through that point), so the
   * fade starts from the level it has there. A voice before its note-off is left.
   */
  _makeRoomAt(at: number, room: Partial<VoiceCensus> = {}) {
    const limit = (this.graph && this.graph.maxVoices > 0) ? this.graph.maxVoices : MAX_VOICES;
    if (this.activeOscillators.size < limit) return;
    // All voices of a chord see the same existing releases. Reserve capacity
    // in score order, sharing the census only within this synchronous pump.
    if (room.at !== at) {
      room.at = at;
      room.sounding = 0;
      room.victims = [];
      for (const e of this.activeOscillators) {
        if (e.stolen || e.startTime > at || e.endTime <= at) continue;
        room.sounding++;
        if (e.offTime <= at && e.endTime > at + STEAL_FADE && e.levelAt) room.victims.push(e);
      }
      room.victims.sort((a, b) => a.offTime - b.offTime);
      room.next = 0;
    }
    // All fields are populated together on the first call at this instant.
    const census = room as VoiceCensus;
    while (census.sounding >= limit && census.next < census.victims.length) {
      const victim = census.victims[census.next++];
      if (victim.endTime <= at + STEAL_FADE) continue;
      victim.stolen = true;
      victim.fade = victim.fade || { at, origEnd: victim.endTime };
      try {
        const g = victim.gainNode.gain;
        g.cancelScheduledValues(at);
        g.exponentialRampToValueAtTime(victim.levelAt!(at), at);
        g.linearRampToValueAtTime(0, at + STEAL_FADE);
        victim.voice.stop(at + STEAL_FADE + 0.005);
        victim.endTime = at + STEAL_FADE + 0.005;
      } catch {}
      this.voiceStats.stolen++;
      census.sounding--;
    }
    census.sounding++;
  }

  /** The voice of note `noteId` sounding at `at` (the latest that began before it), or null. */
  _voiceOf(noteId: number, at: number) {
    let best = null;
    for (const e of this.activeOscillators) {
      if (e.noteId !== noteId || !(e.startTime < at) || !(e.endTime > at - 1e-3) || e.fade) continue;
      if (!best || e.startTime > best.startTime) best = e;
    }
    return best;
  }

  /**
   * Fade a voice out from `at` over `dur`, starting from the gain its envelope has
   * there (the exponential is rebuilt up to that point, so there is no step);
   * equal-power (a quarter cosine) for a slur's crossfade, linear otherwise.
   * @returns {object|null} the entry, marked with its fade
   */
  _fadeVoice(e: ScheduledVoice | null, at: number, dur: number, equalPower: boolean) {
    if (!e || e.fade || !e.levelAt) return null;
    try {
      const g = e.gainNode.gain;
      const L = Math.max(EPS_GAIN, e.levelAt(at));
      g.cancelScheduledValues(at);
      g.exponentialRampToValueAtTime(L, at);
      if (equalPower) {
        const N = 16, curve = new Float32Array(N);
        for (let i = 0; i < N; i++) curve[i] = L * Math.cos((Math.PI / 2) * (i / (N - 1)));
        g.setValueCurveAtTime(curve, at + 1e-4, dur);
      } else {
        g.linearRampToValueAtTime(0, at + dur);
      }
      e.voice.stop(at + dur + 0.01);
      e.fade = { at, origEnd: e.endTime };
      e.endTime = at + dur + 0.01;
    } catch { return null; }
    return e;
  }

  /**
   * Undo a fade whose cause never sounds (the voice that faded it was cancelled:
   * a live tempo change, a loop switched off): when the fade began in the faded
   * voice's release, that release is rebuilt as it was.
   */
  _restoreFaded(entry: ScheduledVoice) {
    for (const e of entry.faded || []) {
      if (!e.fade || !this.activeOscillators.has(e) || !e.times || !e.levelAt) continue;
      const at = e.fade.at;
      if (at < e.offTime - 1e-9) continue;   // faded in its body: left faded (rare)
      try {
        const g = e.gainNode.gain;
        g.cancelScheduledValues(at);
        g.exponentialRampToValueAtTime(Math.max(EPS_GAIN, e.levelAt(at)), at);
        g.exponentialRampToValueAtTime(EPS_GAIN, e.startTime + e.times.end);
        g.linearRampToValueAtTime(0, e.startTime + e.times.end + 0.004);
        e.voice.stop(e.fade.origEnd);
        e.endTime = e.fade.origEnd;
        e.fade = null;
      } catch {}
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
    // Cancel any in-flight pause notification and settle its promise so the
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

  // Each transport session feeds its own gain into each instrument's dry/reverb
  // bus. A fade multiplies the live mix, including attacks, releases and slurs.
  _transportBus(instrument: string) {
    let route = this._transportBuses.get(instrument);
    if (route) return route.node;
    const ctx = this.audioContext;
    const node = ctx.createGain();
    const start = this._streamingState?.baseStartTime;
    if (start != null && ctx.currentTime < start + START_FADE) {
      node.gain.value = 0;
      node.gain.setValueAtTime(0, start);
      node.gain.linearRampToValueAtTime(1, start + START_FADE);
      route = { node, from: 0, to: 1, start, end: start + START_FADE };
    } else {
      route = { node, from: 1, to: 1, start: 0, end: 0 };
    }
    node.connect(this.graph.getBus(instrument));
    this._transportBuses.set(instrument, route);
    return node;
  }

  _fadeTransport(seconds: number) {
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const end = now + Math.max(0, seconds);
    for (const route of this._transportBuses.values()) {
      // A quick Stop during Pause can shorten a fade already in flight.
      if (route.to === 0 && route.end <= end) continue;
      const fraction = route.end > route.start
        ? Math.min(1, Math.max(0, (now - route.start) / (route.end - route.start))) : 1;
      const held = route.from + (route.to - route.from) * fraction;
      const gain = route.node.gain;
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else {
        gain.cancelScheduledValues(now);
        // Restore the part of the old ramp before the cut on older browsers.
        if (fraction > 0 && fraction < 1) gain.linearRampToValueAtTime(held, now);
      }
      gain.setValueAtTime(held, now);
      gain.linearRampToValueAtTime(0, end);
      Object.assign(route, { from: held, to: 0, start: now, end });
    }
    for (const entry of this.activeOscillators) {
      // A pending attack must never enter the fading mix. Sounding notes keep
      // their own envelopes until the gate reaches zero or they end naturally.
      const stop = entry.startTime > now ? now : end;
      if (stop >= entry.endTime) continue;
      try { entry.voice.stop(stop); } catch {}
      entry.endTime = stop;
    }
  }

  pauseFade(rampTime = this.GENERAL_VOLUME_RAMP_TIME) {
    this._stopStreaming();
    this._fadeTransport(rampTime);
    return new Promise<void>(resolve => {
      // This timer settles the UI promise only. Source stops and gain changes
      // use the audio clock, which can stall or suspend independently of it.
      this._pauseFadeResolve = resolve;
      this._pauseFadeTimer = setTimeout(() => {
        this._pauseFadeTimer = null;
        this._pauseFadeResolve = null;
        resolve();
      }, Math.max(0, rampTime * 1000));
    });
  }

  stopAll(fadeSec = DECLICK_FADE) {
    this._stopStreaming();
    if (this.activeOscillators.size) {
      this._fadeTransport(fadeSec);
      // Ended handlers retain their own set and routes until their sources
      // finish. A new play has a fresh gate and can start independently.
      this.activeOscillators = new Set();
    } else if (this._transportBuses) {
      for (const { node } of this._transportBuses.values()) node.disconnect();
    }
    this._transportBuses = new Map();
  }
}

// Shared singleton for app usage
export const audioEngine = new AudioEngine();
