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
 */
export function applyVoiceEnvelope(gainNode, startTime, duration, peak, env = {}) {
  const g = gainNode.gain;
  const dur = Math.max(0.001, duration);

  let attack = Math.max(ATTACK_FLOOR, dur * (env.attackTimeRatio != null ? env.attackTimeRatio : 0.01));
  let release = Math.max(RELEASE_FLOOR, dur * (env.releaseTimeRatio != null ? env.releaseTimeRatio : 0.05));
  // Keep attack+release inside the note, leaving >=10% for the body.
  const maxAR = dur * 0.9;
  if (attack + release > maxAR) {
    const s = maxAR / (attack + release);
    attack *= s;
    release *= s;
  }
  const body = Math.max(0, dur - attack - release);
  let decay = Math.min(Math.max(0, dur * (env.decayTimeRatio != null ? env.decayTimeRatio : 0.05)), body);

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

    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0) {
        applyVoiceEnvelope(gainNode, startTime, duration, initialVolume, this.getEnvelopeSettings());
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

    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0) {
        const env = this.getEnvelopeSettings();

        const attackTime = Math.min(0.01, duration * env.attackTimeRatio);
        const releaseTime = Math.min(0.1, duration * env.releaseTimeRatio);
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

    applyEnvelope(instrumentName, gainNode, startTime, duration, initialVolume = 1.0) {
        const instrument = this.getInstrument(instrumentName);
        instrument.applyEnvelope(gainNode, startTime, duration, initialVolume);
    }
}
