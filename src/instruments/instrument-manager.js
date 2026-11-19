/**
 * Instruments + envelope core (ROADMAP.md Phase 5b synth quality).
 *
 * Voice contract: `createOscillator(frequency)` returns a *voice* object that
 * exposes `{ frequency, start(when), stop(when), connect(dest), disconnect(),
 * onended }`. A voice may wrap several oscillators (unison/FM) and an optional
 * per-voice filter; the AudioEngine treats them all uniformly.
 *
 * Envelope: `applyVoiceEnvelope` is a shared anti-click ADSR with absolute
 * attack/release floors (3 ms / 15 ms) and exponential decay/release. It stays
 * within [start, start+duration] and reaches 0 at the end, so note *lengths*
 * are unchanged from the pre-overhaul behavior; the AudioEngine stops the
 * oscillator a short tail later (while already silent) so the stop is clean.
 */

const ATTACK_FLOOR = 0.003;   // 3 ms — kills attack clicks on very short notes
const RELEASE_FLOOR = 0.015;  // 15 ms — kills release clicks
const EPS = 0.0001;           // exponential ramps can't touch 0

/**
 * Apply a click-free ADSR envelope to a gain node.
 * @param {GainNode} gainNode
 * @param {number} startTime absolute audio time of note start
 * @param {number} duration note length in seconds
 * @param {number} peak peak gain (per-note initial volume)
 * @param {{attackTimeRatio?:number,decayTimeRatio?:number,sustainLevel?:number,releaseTimeRatio?:number}} env
 * @param {{attack?:number|null, release?:number|null}} [shape] the note's own
 *   attack and release, as shares of its duration (the interpretation variables
 *   `attack` and `release`); each replaces the instrument's ratio when given.
 */
export function applyVoiceEnvelope(gainNode, startTime, duration, peak, env = {}, shape = null) {
  const g = gainNode.gain;
  const { dur, attack, decay, release } = envelopeTimes(env, duration, shape);

  const p = Math.max(EPS, peak);
  const sustain = Math.max(EPS, p * (env.sustainLevel != null ? env.sustainLevel : 0.7));

  const t0 = startTime;
  const attackEnd = t0 + attack;
  const decayEnd = attackEnd + decay;
  const releaseStart = t0 + dur - release; // >= decayEnd (decay clamped to body)
  const end = t0 + dur;

  g.cancelScheduledValues(t0);
  g.setValueAtTime(EPS, t0);
  g.linearRampToValueAtTime(p, attackEnd);                 // attack (from ~0, click-free)
  if (decay > 0.0005 && sustain < p) {
    g.exponentialRampToValueAtTime(sustain, decayEnd);     // exponential decay
    g.setValueAtTime(sustain, releaseStart);               // hold sustain
  } else {
    g.setValueAtTime(p, releaseStart);
  }
  g.exponentialRampToValueAtTime(EPS, end);                // exponential release
  g.linearRampToValueAtTime(0, end + 0.004);               // hard-zero → clean stop
}

/**
 * The times of the envelope applyVoiceEnvelope draws, in seconds: attack,
 * decay and release, after the anti-click floors and the fit inside the note.
 * The renderer draws the same shape (envelopeShares), so what is seen is what
 * is heard.
 * @param {{attackTimeRatio?:number,decayTimeRatio?:number,sustainLevel?:number,releaseTimeRatio?:number}} env
 * @param {number} duration note length in seconds
 * @param {{attack?:number|null, release?:number|null}} [shape]
 * @returns {{dur:number, attack:number, decay:number, release:number}}
 */
export function envelopeTimes(env = {}, duration, shape = null) {
  const dur = Math.max(0.001, duration);
  const own = noteShape(shape);

  const attackRatio = own.attack != null ? own.attack : (env.attackTimeRatio != null ? env.attackTimeRatio : 0.01);
  const releaseRatio = own.release != null ? own.release : (env.releaseTimeRatio != null ? env.releaseTimeRatio : 0.05);
  // The floors stay: they are what keeps a note from clicking.
  let attack = Math.max(ATTACK_FLOOR, dur * attackRatio);
  let release = Math.max(RELEASE_FLOOR, dur * releaseRatio);
  // Keep attack+release inside the note: the instrument leaves >=10% for the
  // body; a note's own shape may use all of it (attack 1 is a swell to the end).
  const maxAR = dur * (own.attack != null || own.release != null ? 1 : 0.9);
  if (attack + release > maxAR) {
    const s = maxAR / (attack + release);
    attack *= s;
    release *= s;
  }
  const body = Math.max(0, dur - attack - release);
  const decay = Math.min(Math.max(0, dur * (env.decayTimeRatio != null ? env.decayTimeRatio : 0.05)), body);
  return { dur, attack, decay, release };
}

/**
 * The envelope as shares of the note, for drawing: attack, decay and release
 * as fractions of the duration, and the level held between decay and release
 * (relative to the peak; 1 when the envelope holds the peak, as
 * applyVoiceEnvelope does when there is no decay to speak of).
 * @returns {{attack:number, decay:number, sustain:number, release:number}}
 */
export function envelopeShares(env = {}, duration, shape = null) {
  const t = envelopeTimes(env, duration, shape);
  const level = env.sustainLevel != null ? env.sustainLevel : 0.7;
  const decays = t.decay > 0.0005 && level < 1;
  return {
    attack: t.attack / t.dur,
    decay: decays ? t.decay / t.dur : 0,
    sustain: decays ? Math.max(0, level) : 1,
    release: t.release / t.dur,
  };
}

/**
 * A note's own attack and release shares, clamped to [0, 1]; null when unset
 * or not a finite number.
 * @param {{attack?:number|null, release?:number|null}|null} shape
 * @returns {{attack:number|null, release:number|null}}
 */
export function noteShape(shape) {
  const clamp = (v) => (v == null || !Number.isFinite(v) ? null : Math.min(1, Math.max(0, v)));
  return { attack: clamp(shape && shape.attack), release: clamp(shape && shape.release) };
}

/**
 * Build a voice wrapper from one or more source nodes and an output node.
 * @param {AudioScheduledSourceNode[]} sources nodes to start/stop together
 * @param {AudioNode} output node connected downstream
 * @param {number} frequency
 * @param {(when:number)=>void} [onStart] extra scheduling at start() (e.g. FM index)
 */
export function makeVoice(sources, output, frequency, onStart) {
  const last = sources[sources.length - 1];
  let onendedCb = null;
  return {
    frequency: { value: frequency },
    start(when) {
      if (onStart) { try { onStart(when); } catch {} }
      for (const s of sources) { try { s.start(when); } catch {} }
    },
    stop(when) {
      for (const s of sources) { try { s.stop(when); } catch {} }
    },
    connect(dest) { try { output.connect(dest); } catch {} return dest; },
    disconnect() {
      try { output.disconnect(); } catch {}
      for (const s of sources) { try { s.disconnect(); } catch {} }
    },
    get onended() { return onendedCb; },
    set onended(fn) { onendedCb = fn; try { last.onended = fn; } catch {} },
  };
}

export class SynthInstrument {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.name = 'base';
        this.type = 'synth';
        // Voice-shaping knobs; subclasses tune these.
        this.waveType = 'sine';          // used when periodicWave is unset
        this.periodicWave = null;        // organ/vibraphone set this
        this.unisonCount = 1;            // >1 → detuned unison stack
        this.detuneCents = 0;            // full spread for the unison edges
        this.filterTrackMul = 0;         // >0 → per-voice lowpass at freq*mul
        this.filterQ = 0.7;
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.1,
            decayTimeRatio: 0.1,
            sustainLevel: 0.7,
            releaseTimeRatio: 0.2
        };
    }

    createOscillator(frequency) {
        const ctx = this.audioContext;
        const count = Math.max(1, this.unisonCount | 0);
        const oscs = [];
        const sum = ctx.createGain();
        // Keep perceived level ~constant regardless of the unison count.
        sum.gain.value = count > 1 ? 1 / Math.sqrt(count) : 1;

        const half = (count - 1) / 2;
        for (let i = 0; i < count; i++) {
            const osc = ctx.createOscillator();
            if (this.periodicWave) osc.setPeriodicWave(this.periodicWave);
            else osc.type = this.waveType || 'sine';
            osc.frequency.value = frequency;
            if (count > 1 && half > 0) {
                // Symmetric spread: edges at ±detuneCents, center at 0.
                osc.detune.value = ((i - half) / half) * this.detuneCents;
            }
            osc.connect(sum);
            oscs.push(osc);
        }

        let output = sum;
        if (this.filterTrackMul > 0) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            const nyq = ctx.sampleRate * 0.5;
            lp.frequency.value = Math.min(nyq * 0.95, Math.max(200, frequency * this.filterTrackMul));
            lp.Q.value = this.filterQ;
            sum.connect(lp);
            output = lp;
        }

        return makeVoice(oscs, output, frequency);
    }

    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0, shape = null) {
        applyVoiceEnvelope(gainNode, startTime, duration, initialVolume, this.getEnvelopeSettings(), shape);
    }
}

export class SampleInstrument {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.name = 'base-sample';
        this.type = 'sample';
        this.buffers = new Map();
        this.baseFrequency = 440;
        this.isLoaded = false;
        this.loadPromise = null;
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.005,
            decayTimeRatio: 0.01,
            sustainLevel: 0.95,
            releaseTimeRatio: 0.1
        };
    }

    loadSample(url, baseFrequency = 440) {
        this.baseFrequency = baseFrequency;

        this.loadPromise = new Promise((resolve, reject) => {
            fetch(url)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to load sample: ${url}`);
                    }
                    return response.arrayBuffer();
                })
                .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
                .then(audioBuffer => {
                    this.buffers.set('default', audioBuffer);
                    this.isLoaded = true;
                    resolve(audioBuffer);
                })
                .catch(error => {
                    console.error(`Error loading sample: ${error.message}`);
                    reject(error);
                });
        });

        return this.loadPromise;
    }

    waitForLoad() {
        return this.loadPromise || Promise.resolve();
    }

    createFallbackOscillator(frequency) {
        const fallbackOsc = this.audioContext.createOscillator();
        fallbackOsc.frequency.value = frequency;
        fallbackOsc.type = 'sine';
        return fallbackOsc;
    }

    createOscillator(frequency) {
        if (!this.isLoaded) {
            console.warn(`Sample for ${this.name} not loaded yet, using fallback`);
            return this.createFallbackOscillator(frequency);
        }

        const buffer = this.buffers.get('default');
        if (!buffer) {
            console.error('No sample loaded for', this.name);
            return this.createFallbackOscillator(frequency);
        }

        const pitchRatio = frequency / this.baseFrequency;

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitchRatio;

        const filter = this.audioContext.createBiquadFilter();

        if (pitchRatio > 1.0) {
            filter.type = 'lowpass';
            filter.frequency.value = Math.min(20000, 8000 / Math.sqrt(pitchRatio));
            filter.Q.value = 0.5;
        } else {
            filter.type = 'highpass';
            filter.frequency.value = Math.max(20, 80 * Math.sqrt(pitchRatio));
            filter.Q.value = 0.5;
        }

        source.connect(filter);

        // Forward the source's natural 'ended' event so callers can clean up,
        // and disconnect both nodes on teardown (the old wrapper leaked the
        // source and never fired onended).
        return {
            frequency: { value: frequency },
            start: (when) => { try { source.start(when); } catch {} },
            stop: (when) => { try { source.stop(when); } catch {} },
            connect: (destination) => { try { filter.connect(destination); } catch {} return destination; },
            disconnect: () => { try { filter.disconnect(); } catch {} try { source.disconnect(); } catch {} },
            get onended() { return source.onended; },
            set onended(fn) { try { source.onended = fn; } catch {} },
        };
    }

    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0, shape = null) {
        const env = this.getEnvelopeSettings();
        const own = noteShape(shape);

        let attackTime = own.attack != null ? duration * own.attack : Math.min(0.01, duration * env.attackTimeRatio);
        let releaseTime = own.release != null ? duration * own.release : Math.min(0.1, duration * env.releaseTimeRatio);
        if (attackTime + releaseTime > duration) {
            const s = duration / (attackTime + releaseTime);
            attackTime *= s;
            releaseTime *= s;
        }
        const sustainTime = duration - attackTime - releaseTime;

        gainNode.gain.cancelScheduledValues(startTime);
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
        gainNode.gain.setValueAtTime(initialVolume, startTime + attackTime + sustainTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }
}

export class InstrumentManager {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.instruments = new Map();
        this.defaultInstrument = 'sine-wave';
    }

    registerBuiltInInstruments(SynthInstruments, SampleInstruments) {
        if (SynthInstruments) {
            Object.values(SynthInstruments).forEach(InstrumentClass => {
                if (typeof InstrumentClass === 'function') {
                    this.registerInstrument(new InstrumentClass(this.audioContext));
                }
            });
        }

        if (SampleInstruments) {
            Object.values(SampleInstruments).forEach(InstrumentClass => {
                if (typeof InstrumentClass === 'function' &&
                    InstrumentClass.name !== 'SampleInstrument') {
                    this.registerInstrument(new InstrumentClass(this.audioContext));
                }
            });
        }
    }

    registerInstrument(instrument) {
        if (!instrument || !instrument.name) {
            console.error('Invalid instrument provided to register');
            return false;
        }

        this.instruments.set(instrument.name.toLowerCase(), instrument);
        return true;
    }

    getInstrument(name) {
        const instrumentName = (name || this.defaultInstrument).toLowerCase();

        if (this.instruments.has(instrumentName)) {
            return this.instruments.get(instrumentName);
        }

        console.warn(`Instrument "${name}" not found, using default instrument "${this.defaultInstrument}"`);
        return this.instruments.get(this.defaultInstrument);
    }

    getAvailableInstruments() {
        return Array.from(this.instruments.keys());
    }

    createOscillator(instrumentName, frequency) {
        const instrument = this.getInstrument(instrumentName);
        return instrument.createOscillator(frequency);
    }

    /**
     * @param {{attack?:number|null, release?:number|null}} [shape] the note's own
     *   attack and release (shares of its duration); null keeps the instrument's.
     */
    applyEnvelope(instrumentName, gainNode, startTime, duration, initialVolume = 1.0, shape = null) {
        const instrument = this.getInstrument(instrumentName);
        instrument.applyEnvelope(gainNode, startTime, duration, initialVolume, shape);
    }
}
