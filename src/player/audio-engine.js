import Fraction from 'fraction.js';
import { InstrumentManager } from '../instruments/instrument-manager.js';

export class AudioEngine {
  constructor({ initialVolume = 0.2, rampTime = 0.2 } = {}) {
    this.INITIAL_VOLUME = initialVolume;
    this.GENERAL_VOLUME_RAMP_TIME = rampTime;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.generalVolumeGainNode = this.audioContext.createGain();
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.generalVolumeGainNode.connect(this.compressor);
    this.compressor.connect(this.audioContext.destination);

    this.instrumentManager = new InstrumentManager(this.audioContext);

    // Track currently scheduled/playing oscillators for pause/stop
    /** @type {Set<{oscillator:any,gainNode:GainNode}>} */
    this.activeOscillators = new Set();

    // Streaming playback state
    this._streamingState = null;
  }

  // Return nodes so legacy code can alias them without deep coupling
  nodes() {
    return {
      audioContext: this.audioContext,
      generalVolumeGainNode: this.generalVolumeGainNode,
      compressor: this.compressor,
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
    if (!this.audioContext || !this.generalVolumeGainNode) return;
    if (this.audioContext.state !== 'running') {
      this.generalVolumeGainNode.gain.value = value;
      return;
    }
    this.generalVolumeGainNode.gain.linearRampToValueAtTime(
      value,
      this.audioContext.currentTime + this.GENERAL_VOLUME_RAMP_TIME
    );
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

            noteDataList.push({
              id: note.id,
              startTime: adjustedStart,
              duration: adjustedDuration,
              frequency: cached.frequency ? cached.frequency.valueOf() : null,
              instrument: cached.frequency ? getInstrument(note) : null
            });
          }
        }

        // Sort by start time for streaming playback
        noteDataList.sort((a, b) => a.startTime - b.startTime);

        const t2 = performance.now();

        // Collect unique instruments and wait for samples to load
        const uniqueInstruments = new Set();
        noteDataList.forEach(note => {
          if (note.instrument) uniqueInstruments.add(note.instrument);
        });

        const loadPromises = Array.from(uniqueInstruments).map(instrumentName => {
          const instrument = this.instrumentManager.getInstrument(instrumentName);
          if (instrument && instrument.type === 'sample' && typeof instrument.waitForLoad === 'function') {
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
   * Schedule a single note for playback
   */
  _scheduleNote(noteData, baseStartTime, initialVolume) {
    const start = baseStartTime + noteData.startTime;
    const duration = noteData.duration;

    // Create oscillator and gain node just-in-time
    const oscillator = this.instrumentManager.createOscillator(noteData.instrument, noteData.frequency);
    const gainNode = this.audioContext.createGain();

    try {
      this.instrumentManager.applyEnvelope(noteData.instrument, gainNode, start, duration, initialVolume);
    } catch (e) {
      console.warn('applyEnvelope failed', e);
    }

    try {
      oscillator.connect(gainNode);
      gainNode.connect(this.generalVolumeGainNode);
    } catch {}

    try {
      oscillator.start(start);
      oscillator.stop(start + duration);
    } catch {}

    const entry = { oscillator, gainNode };
    this.activeOscillators.add(entry);

    // Cleanup on natural end
    try {
      oscillator.onended = () => {
        this.activeOscillators.delete(entry);
      };
    } catch {}
  }

  /**
   * Stop the streaming scheduler
   */
  _stopStreaming() {
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
      this._stopStreaming();
      const now = this.audioContext.currentTime;
      for (const entry of this.activeOscillators) {
        try {
          entry.gainNode.gain.cancelScheduledValues(now);
          entry.gainNode.gain.linearRampToValueAtTime(0, now + rampTime);
        } catch {}
      }
      setTimeout(() => {
        try { this.stopAll(); } finally { resolve(); }
      }, Math.max(0, rampTime * 1000));
    });
  }

  /**
   * Immediately stop and disconnect all active oscillators, clear tracking.
   */
  stopAll() {
    this._stopStreaming();
    const now = this.audioContext.currentTime;
    for (const entry of this.activeOscillators) {
      try { entry.oscillator.stop(now); } catch {}
      try { entry.oscillator.disconnect(); } catch {}
      try { entry.gainNode.disconnect(); } catch {}
    }
    this.activeOscillators.clear();
  }
}

// Shared singleton for app usage
export const audioEngine = new AudioEngine();
