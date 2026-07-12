import Fraction from 'fraction.js';
import { InstrumentManager } from '../instruments/instrument-manager.js';
import { AudioGraph } from './audio-graph.js';

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

    // Streaming playback state
    this._streamingState = null;

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
        const getInstrument = (note) => {
          if (!instrumentCache.has(note.id)) {
            instrumentCache.set(note.id, module.findInstrument(note).toLowerCase());
          }
          return instrumentCache.get(note.id);
        };

        // Base-note frequency for pitch-driven stereo pan (note 0 = baseNote).
        let baseF = null;
        try {
          const baseCached = evalCache.get(0);
          if (baseCached && baseCached.frequency) baseF = baseCached.frequency.valueOf();
          else if (module.baseNote && typeof module.baseNote.getVariable === 'function') {
            const bf = module.baseNote.getVariable('frequency');
            if (bf && typeof bf.valueOf === 'function') baseF = bf.valueOf();
          }
        } catch {}
        if (!(baseF > 0)) baseF = 440;

        // Build note data list (no oscillators yet)
        const noteDataList = [];
        for (const id in module.notes) {
          const note = module.notes[id];
          const cached = evalCache.get(Number(id));
          if (!cached || !cached.startTime || !cached.duration) continue;

          const noteStart = cached.startTime.valueOf();
          const noteDuration = cached.duration.valueOf();
          const noteEnd = noteStart + noteDuration;

          if (noteEnd > fromTime && noteStart < moduleEndTime) {
            const adjustedStart = Math.max(0, noteStart - fromTime);
            const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);
            const freq = cached.frequency ? cached.frequency.valueOf() : null;

            noteDataList.push({
              id: note.id,
              startTime: adjustedStart,
              duration: adjustedDuration,
              frequency: freq,
              instrument: freq != null ? getInstrument(note) : null,
              // Normalized pan position (−1..1) before width scaling; width and
              // enable are applied live at schedule time so mid-play stereo
              // changes affect newly-scheduled notes.
              panPos: freq != null ? this.graph.panPosition(freq, baseF) : null
            });
          }
        }

        // Sort by start time for streaming playback
        noteDataList.sort((a, b) => a.startTime - b.startTime);

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
   * @param {Array} noteDataList - Note data from preparePlayback
   * @param {{initialVolume?:number}} options
   * @returns {number} baseStartTime
   */
  play(noteDataList, { initialVolume = this.INITIAL_VOLUME } = {}) {
    const baseStartTime = this.audioContext.currentTime + 0.1;

    // Stop any existing streaming
    this._stopStreaming();

    // Schedule notes in time-based batches
    // Create oscillators for notes starting within the next LOOKAHEAD seconds
    const LOOKAHEAD = 2.0; // seconds ahead to schedule
    const BATCH_INTERVAL = 100; // ms between batch processing

    let nextIndex = 0;
    let scheduledUpTo = 0; // audio time we've scheduled up to

    const scheduleNextBatch = () => {
      if (!this._streamingState || this._streamingState.stopped) return;

      const currentTime = this.audioContext.currentTime;
      const targetTime = currentTime - baseStartTime + LOOKAHEAD;

      // Schedule all notes that start before targetTime
      let scheduled = 0;
      while (nextIndex < noteDataList.length) {
        const noteData = noteDataList[nextIndex];

        // Stop if this note starts after our target window
        if (noteData.startTime > targetTime) break;

        // Skip notes without frequency (measure markers)
        if (noteData.frequency && noteData.instrument) {
          this._scheduleNote(noteData, baseStartTime, initialVolume);
        }

        nextIndex++;
        scheduled++;
      }

      scheduledUpTo = targetTime;

      // Continue scheduling if there are more notes
      if (nextIndex < noteDataList.length) {
        this._streamingState.timerId = setTimeout(scheduleNextBatch, BATCH_INTERVAL);
      }
    };

    // Initialize streaming state
    this._streamingState = {
      stopped: false,
      timerId: null,
      noteDataList,
      baseStartTime
    };

    // Start the first batch immediately
    scheduleNextBatch();

    return baseStartTime;
  }

  /**
   * Schedule a single note for playback.
   * Voice chain: source → voiceGain(env) → [StereoPanner] → instrument bus.
   */
  _scheduleNote(noteData, baseStartTime, initialVolume) {
    const ctx = this.audioContext;
    const start = baseStartTime + noteData.startTime;
    const duration = noteData.duration;

    // Create the voice (may be a bare OscillatorNode or a wrapper) + envelope.
    const voice = this.instrumentManager.createOscillator(noteData.instrument, noteData.frequency);
    const gainNode = ctx.createGain();

    try {
      this.instrumentManager.applyEnvelope(noteData.instrument, gainNode, start, duration, initialVolume);
    } catch (e) {
      console.warn('applyEnvelope failed', e);
    }

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

    // Stop past gain-zero so exponential releases finish cleanly (no click).
    const RELEASE_TAIL = 0.15;
    try {
      voice.start(start);
      voice.stop(start + duration + RELEASE_TAIL);
    } catch {}

    const entry = { voice, gainNode, panner };
    this.activeOscillators.add(entry);

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
    const ms = Math.max(0, (start + duration + RELEASE_TAIL - ctx.currentTime) * 1000) + 60;
    setTimeout(() => { if (!ended) cleanup(); }, ms);
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
        try { this.stopAll(); } finally { resolve(); }
      }, Math.max(0, rampTime * 1000));
    });
  }

  /**
   * Immediately stop and disconnect all active voices, clear tracking.
   */
  stopAll() {
    this._stopStreaming();
    const now = this.audioContext.currentTime;
    for (const entry of this.activeOscillators) {
      try { entry.voice.stop(now); } catch {}
      try { entry.voice.disconnect(); } catch {}
      try { entry.gainNode.disconnect(); } catch {}
      try { entry.panner && entry.panner.disconnect(); } catch {}
    }
    this.activeOscillators.clear();
  }
}

// Shared singleton for app usage
export const audioEngine = new AudioEngine();
