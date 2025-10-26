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
      // eslint-disable-next-line no-console
      console.log('Instruments registered:', this.instrumentManager.getAvailableInstruments());
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
   * Mirrors the legacy player preparePlayback behavior but uses this.audioContext
   * and this.instrumentManager. Returns a Promise<PreparedNote[]> identical
   * to the legacy shape so the caller can schedule start/stop the same way.
   */
  preparePlayback(module, fromTime) {
    return new Promise((resolve) => {
      const resumePromise = this.audioContext.state === 'suspended'
        ? this.audioContext.resume()
        : Promise.resolve();

      resumePromise.then(() => {
        const evaluatedNotes = module.evaluateModule();

        // Compute module end time like legacy getModuleEndTime()
        const measureNotes = Object.values(module.notes).filter(note =>
          note.variables.startTime && !note.variables.duration && !note.variables.frequency
        );
        let measureEnd = 0;
        if (measureNotes.length > 0) {
          measureNotes.sort((a, b) => a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf());
          const lastMeasure = measureNotes[measureNotes.length - 1];
          measureEnd = lastMeasure.getVariable('startTime')
            .add(module.findMeasureLength(lastMeasure))
            .valueOf();
        }
        let lastNoteEnd = 0;
        Object.values(module.notes).forEach(note => {
          if (note.variables.startTime && note.variables.duration && note.variables.frequency) {
            const noteStart = note.getVariable('startTime').valueOf();
            const noteDuration = note.getVariable('duration').valueOf();
            const noteEnd = noteStart + noteDuration;
            if (noteEnd > lastNoteEnd) lastNoteEnd = noteEnd;
          }
        });
        const moduleEndTime = Math.max(measureEnd, lastNoteEnd);

        const activeNotes = [];
        for (const id in module.notes) {
          const note = module.notes[id];
          if (!note.getVariable('startTime') || !note.getVariable('duration')) continue;

          const noteStart = note.getVariable('startTime').valueOf();
          const noteDuration = note.getVariable('duration').valueOf();
          const noteEnd = noteStart + noteDuration;

          if (noteEnd > fromTime && noteStart < moduleEndTime) {
            activeNotes.push({
              noteInstance: note,
              id: note.id,
              startTime: note.getVariable('startTime'),
              duration: note.getVariable('duration'),
              frequency: note.getVariable('frequency')
            });
          }
        }

        const uniqueInstruments = new Set();
        activeNotes.forEach(note => {
          if (!note.frequency) return;
          const instrumentName = module.findInstrument(note.noteInstance).toLowerCase();
          uniqueInstruments.add(instrumentName);
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
            const preparedNotes = activeNotes.map(activeNote => {
              const noteStart = activeNote.startTime.valueOf();
              const noteDuration = activeNote.duration.valueOf();
              const noteEnd = noteStart + noteDuration;

              const adjustedStart = Math.max(0, noteStart - fromTime);
              const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);

              if (!activeNote.frequency) {
                return {
                  note: {
                    ...activeNote,
                    startTime: new Fraction(adjustedStart),
                    duration: new Fraction(adjustedDuration)
                  },
                  oscillator: null,
                  gainNode: null
                };
              }

              const instrumentName = module.findInstrument(activeNote.noteInstance).toLowerCase();
              const oscillator = this.instrumentManager.createOscillator(instrumentName, activeNote.frequency.valueOf());
              const gainNode = this.audioContext.createGain();

              return {
                note: {
                  ...activeNote,
                  startTime: new Fraction(adjustedStart),
                  duration: new Fraction(adjustedDuration),
                  instrument: instrumentName
                },
                oscillator,
                gainNode
              };
            });

            resolve(preparedNotes);
          })
          .catch(error => {
            // eslint-disable-next-line no-console
            console.error('Error loading samples:', error);
            resolve([]);
          });
      });
    });
  }
  /**
   * Schedule and start playback of prepared notes.
   * Returns the baseStartTime used so legacy UI timebase stays consistent.
   * @param {Array} preparedNotes
   * @param {{initialVolume?:number}} options
   * @returns {number} baseStartTime (AudioContext time used to schedule start)
   */
  play(preparedNotes, { initialVolume = this.INITIAL_VOLUME } = {}) {
    const baseStartTime = this.audioContext.currentTime + 0.1;

    for (const prep of preparedNotes) {
      if (!prep || !prep.note || !prep.oscillator || !prep.gainNode) {
        continue; // skip measure points/silence
      }
      const start = baseStartTime + prep.note.startTime.valueOf();
      const duration = prep.note.duration.valueOf();
      const instrumentName = prep.note.instrument;

      try {
        this.instrumentManager.applyEnvelope(instrumentName, prep.gainNode, start, duration, initialVolume);
      } catch (e) {
        console.warn('applyEnvelope failed', e);
      }

      try {
        prep.oscillator.connect(prep.gainNode);
        prep.gainNode.connect(this.generalVolumeGainNode);
      } catch {}

      try {
        prep.oscillator.start(start);
        prep.oscillator.stop(start + duration);
      } catch {}

      this.activeOscillators.add({ oscillator: prep.oscillator, gainNode: prep.gainNode });
      // On natural end, remove from tracking
      try {
        prep.oscillator.onended = () => {
          for (const entry of this.activeOscillators) {
            if (entry.oscillator === prep.oscillator) {
              this.activeOscillators.delete(entry);
              break;
            }
          }
        };
      } catch {}
    }

    return baseStartTime;
  }

  /**
   * Fade out all active oscillators and stop/cleanup after ramp.
   * @param {number} rampTime seconds
   * @returns {Promise<void>}
   */
  pauseFade(rampTime = this.GENERAL_VOLUME_RAMP_TIME) {
    return new Promise((resolve) => {
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