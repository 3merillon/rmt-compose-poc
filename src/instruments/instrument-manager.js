/**
 * Instruments + envelope core.
 *
 * Voice contract: `createOscillator(frequency)` returns a *voice* object that
 * exposes `{ frequency, start(when), stop(when), connect(dest), disconnect(),
 * onended }`. A voice may wrap several oscillators (unison/FM) and an optional
 * per-voice filter; the AudioEngine treats them all uniformly.
 *
 * Envelope (Phase I, design/phase-i-instruments.md §2): a note's end is a
 * NOTE-OFF, not the end of its sound. The attack and the decay start at the
 * note's start; the sustain (or a natural decay) lasts until the note's end;
 * the release starts there and rings after it, as when a key is lifted or a bow
 * leaves the string. Each instrument gives its envelope in seconds
 * (`getEnvelopeSettings(duration, frequency)`), so a short note keeps the shape
 * of a long one: a 0.1 s piano note is a 0.1 s strike and its damper. A note's
 * own `attack` and `release` are shares of its duration: the attack from its
 * start, the release from its end.
 */

const ATTACK_FLOOR = 0.003;   // 3 ms — kills attack clicks on very short notes
const RELEASE_FLOOR = 0.015;  // 15 ms — kills release clicks
const EPS = 0.0001;           // exponential ramps can't touch 0 (-80 dB re a peak of 1)
const ZERO_RAMP = 0.004;      // the linear step from EPS to 0 after the release
const STOP_MARGIN = 0.02;     // the voice is stopped this long after its gain reached 0
/** The largest share of its duration a note's release may ring after its end. */
export const MAX_RELEASE_SHARE = 4;

/**
 * An instrument's envelope, in seconds, as getEnvelopeSettings() returns it.
 * @typedef {object} Envelope
 * @property {number} [attack]   rise from silence to the peak (linear), from the note's start
 * @property {number} [decay]    then an exponential fall to `sustain`
 * @property {number} [sustain]  the level held until the note's end (share of the peak; default 1)
 * @property {number} [t60]      instead of decay and sustain: a natural decay, -60 dB every t60 seconds
 * @property {number} [release]  after the note's end: exponential fall to silence (to -80 dB)
 */

/**
 * A value that follows pitch: v1 at f1, v2 at f2, geometric in between (a
 * straight line on log-log axes), held beyond either end.
 * @param {number} freq Hz
 * @param {[number, number]} lo [f1, v1]
 * @param {[number, number]} hi [f2, v2]
 */
export function byPitch(freq, [f1, v1], [f2, v2]) {
  if (!(freq > 0)) return v1;
  const x = Math.min(1, Math.max(0, Math.log(freq / f1) / Math.log(f2 / f1)));
  return v1 * Math.pow(v2 / v1, x);
}

/**
 * Apply a note's envelope to a gain node: attack, then decay or natural decay
 * until the note's end, release after it. See envelopeTimes for the times.
 * @param {GainNode} gainNode
 * @param {number} startTime absolute audio time of the note's start
 * @param {number} duration the note's length in seconds (its note-off)
 * @param {number} peak peak gain (per-note volume)
 * @param {Envelope} env the instrument's envelope
 * @param {{attack?:number|null, release?:number|null}} [shape] the note's own
 *   attack and release, as shares of its duration (the interpretation variables
 *   `attack` and `release`); each replaces the instrument's when given.
 */
export function applyVoiceEnvelope(gainNode, startTime, duration, peak, env = {}, shape = null) {
  const g = gainNode.gain;
  const T = envelopeTimes(env, duration, shape);
  const p = Math.max(EPS, peak);
  const level = (share) => Math.max(EPS, p * share);
  const t0 = startTime;

  g.cancelScheduledValues(t0);
  g.setValueAtTime(EPS, t0);
  g.linearRampToValueAtTime(p, t0 + T.attack);                          // attack (from ~0, click-free)
  if (T.off > T.attack) {
    if (T.t60 > 0) {
      g.exponentialRampToValueAtTime(level(T.levelAtEnd), t0 + T.off);   // natural decay to the note-off
    } else if (T.decay > 0) {
      const decayEnd = T.attack + T.decay;
      if (decayEnd < T.off) {
        g.exponentialRampToValueAtTime(level(T.sustain), t0 + decayEnd); // decay
        g.setValueAtTime(level(T.sustain), t0 + T.off);                  // hold to the note-off
      } else {
        g.exponentialRampToValueAtTime(level(T.levelAtEnd), t0 + T.off); // note-off during the decay
      }
    } else {
      g.setValueAtTime(p, t0 + T.off);                                   // hold to the note-off
    }
  }
  g.exponentialRampToValueAtTime(EPS, t0 + T.end);                      // release, after the note's end
  g.linearRampToValueAtTime(0, t0 + T.end + ZERO_RAMP);                 // hard zero → clean stop
}

/**
 * The times of the envelope applyVoiceEnvelope schedules, in seconds from the
 * note's start, after the anti-click floors. The renderer draws from the same
 * numbers (envelopeShares), so what is seen is what is heard.
 * @param {Envelope} env
 * @param {number} duration the note's length in seconds
 * @param {{attack?:number|null, release?:number|null}} [shape]
 * @returns {{dur:number, attack:number, decay:number, sustain:number, t60:number,
 *   release:number, off:number, levelAtEnd:number, end:number}}
 *   `off` is the note-off (the note's end, or the end of an attack longer than
 *   the note), `levelAtEnd` the level there (share of the peak), `end` the end
 *   of the release (silence).
 */
export function envelopeTimes(env = {}, duration, shape = null) {
  const dur = Math.max(0.001, Number.isFinite(duration) ? duration : 0.001);
  const own = noteShape(shape);
  const num = (v, d) => (v != null && Number.isFinite(+v) && +v >= 0 ? +v : d);

  // The attack fits inside the note (a note shorter than its instrument's attack
  // is attacked over its whole length); the floor keeps it from clicking.
  const attack = Math.max(ATTACK_FLOOR, Math.min(own.attack != null ? dur * own.attack : num(env.attack, 0.01), dur));
  const release = Math.max(RELEASE_FLOOR, own.release != null ? dur * own.release : num(env.release, 0.05));
  const t60 = num(env.t60, 0);
  const sustain = Math.min(1, num(env.sustain, 1));
  const decay = t60 > 0 || !(sustain < 1) ? 0 : num(env.decay, 0);
  const off = Math.max(dur, attack);

  let levelAtEnd = 1;
  if (t60 > 0) levelAtEnd = Math.pow(10, (-3 * (off - attack)) / t60);
  else if (decay > 0) levelAtEnd = off - attack >= decay ? sustain : Math.pow(sustain, (off - attack) / decay);
  return { dur, attack, decay, sustain: decay > 0 ? sustain : 1, t60, release, off, levelAtEnd, end: off + release };
}

/**
 * The gain applyVoiceEnvelope schedules, `t` seconds after the note's start: the
 * attack, the decay or natural decay, the hold, the release, silence after it.
 * What a fade that interrupts a voice (a damper, a slur, a stolen voice) starts from.
 * @param {ReturnType<typeof envelopeTimes>} T
 * @param {number} peak
 * @param {number} t seconds from the note's start
 */
export function envelopeGainAt(T, peak, t) {
  const p = Math.max(EPS, peak);
  if (!T || !(t > 0)) return EPS;
  if (t < T.attack) return EPS + (p - EPS) * (t / T.attack);
  if (t <= T.off) {
    // The exponential ramps applyVoiceEnvelope schedules, between the same points
    // (their targets floored at EPS, as there)
    const u = t - T.attack;
    const ramp = (to, over) => (over > 0 ? p * Math.pow(Math.max(EPS, to) / p, Math.min(1, u / over)) : p);
    if (T.t60 > 0) return ramp(p * T.levelAtEnd, T.off - T.attack);
    if (T.decay > 0) {
      if (T.attack + T.decay < T.off) return u >= T.decay ? Math.max(EPS, p * T.sustain) : ramp(p * T.sustain, T.decay);
      return ramp(p * T.levelAtEnd, T.off - T.attack);
    }
    return p;
  }
  if (t <= T.end) {
    const atOff = Math.max(EPS, p * T.levelAtEnd);
    return atOff * Math.pow(EPS / atOff, (t - T.off) / T.release);
  }
  return 0;
}

/**
 * How long after its start a voice must sound: to the end of its release, plus
 * the step to zero and a margin. The AudioEngine stops the voice there.
 */
export function envelopeLength(env = {}, duration, shape = null) {
  return envelopeTimes(env, duration, shape).end + ZERO_RAMP + STOP_MARGIN;
}

/**
 * The envelope as shares of the note, for drawing: the attack and the decay as
 * shares of the duration, the level the body reaches (relative to the peak:
 * the sustain, or the level at the note-off when the note ends during its decay
 * or natural decay), and the release, which lies AFTER the note's end, as a
 * share of the duration (it may exceed 1).
 * @returns {{attack:number, decay:number, sustain:number, release:number}}
 */
export function envelopeShares(env = {}, duration, shape = null) {
  const t = envelopeTimes(env, duration, shape);
  const body = t.off - t.attack;
  let decay = 0, sustain = 1;
  if (t.t60 > 0 || (t.decay > 0 && t.decay > body)) { decay = body; sustain = t.levelAtEnd; }
  else if (t.decay > 0) { decay = t.decay; sustain = t.sustain; }
  return { attack: t.attack / t.dur, decay: decay / t.dur, sustain, release: t.release / t.dur };
}

/**
 * A note's own attack and release shares: attack clamped to [0, 1], release to
 * [0, MAX_RELEASE_SHARE] (it rings after the note, so it may outlast it); null
 * when unset or not a finite number.
 * @param {{attack?:number|null, release?:number|null}|null} shape
 * @returns {{attack:number|null, release:number|null}}
 */
export function noteShape(shape) {
  const clamp = (v, hi) => (v == null || !Number.isFinite(v) ? null : Math.min(hi, Math.max(0, v)));
  return { attack: clamp(shape && shape.attack, 1), release: clamp(shape && shape.release, MAX_RELEASE_SHARE) };
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
        // How a line is played (Phase I, design §5): 'sustained' notes join by their
        // releases overlapping; 'struck' ones damp a voice still ringing on the same
        // pitch when they strike it again; 'bowed' ones are slurred within a line.
        this.articulation = 'sustained';
    }

    /**
     * The envelope, in seconds (see Envelope). Subclasses tune it; it may
     * depend on the note's length and pitch.
     * @param {number} [duration] @param {number} [frequency]
     */
    getEnvelopeSettings(duration, frequency) {
        return { attack: 0.015, release: 0.1 };
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

    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0, shape = null, frequency = null) {
        applyVoiceEnvelope(gainNode, startTime, duration, initialVolume, this.getEnvelopeSettings(duration, frequency), shape);
    }

    /** Seconds from the note's start until the voice can be stopped. */
    voiceLength(duration, shape = null, frequency = null) {
        return envelopeLength(this.getEnvelopeSettings(duration, frequency), duration, shape);
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
                if (typeof InstrumentClass === 'function') {
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
     * @param {number|null} [frequency] the pitch that sounds (some envelopes follow it)
     */
    applyEnvelope(instrumentName, gainNode, startTime, duration, initialVolume = 1.0, shape = null, frequency = null) {
        const instrument = this.getInstrument(instrumentName);
        instrument.applyEnvelope(gainNode, startTime, duration, initialVolume, shape, frequency);
    }

    /** The envelope times (envelopeTimes) a note of this instrument sounds with. */
    envelopeTimesFor(instrumentName, duration, shape = null, frequency = null) {
        const instrument = this.getInstrument(instrumentName);
        const env = instrument && instrument.getEnvelopeSettings ? instrument.getEnvelopeSettings(duration, frequency) : {};
        return envelopeTimes(env, duration, shape);
    }

    /**
     * Seconds from a note's start until its voice is silent and may be stopped:
     * its length, its release after the note-off, and a margin.
     */
    voiceLength(instrumentName, duration, shape = null, frequency = null) {
        const instrument = this.getInstrument(instrumentName);
        if (instrument && typeof instrument.voiceLength === 'function') return instrument.voiceLength(duration, shape, frequency);
        const env = instrument && instrument.getEnvelopeSettings ? instrument.getEnvelopeSettings(duration, frequency) : {};
        return envelopeLength(env, duration, shape);
    }
}
