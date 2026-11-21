import { SynthInstrument, makeVoice, applyVoiceEnvelope, byPitch } from './instrument-manager.ts';

import type { NoteShape } from './instrument-manager.ts';

// Envelopes are in seconds (design/phase-i-instruments.md §3): the attack from the
// note's start, the release after its end.

export class SineInstrument extends SynthInstrument {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'sine-wave';
        this.waveType = 'sine';
    }

    // The reference tone: it speaks quickly and holds its level to the note-off.
    getEnvelopeSettings() {
        return { attack: 0.015, release: 0.1 };
    }
}

export class SquareInstrument extends SynthInstrument {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'square-wave';
        this.waveType = 'square';
        // One oscillator at exactly the written pitch (until 20 November 2026 a
        // 3-oscillator unison at ±4 cents, which made every note beat by itself and
        // hid whether a chord's partials stand still; the owner: "remove it, one
        // oscillator"), and a pitch-tracked lowpass to tame the harshness.
        this.unisonCount = 1;
        this.detuneCents = 0;
        this.filterTrackMul = 12;
        this.filterQ = 0.7;
    }

    getEnvelopeSettings() {
        return { attack: 0.008, decay: 0.25, sustain: 0.7, release: 0.1 };
    }
}

export class SawtoothInstrument extends SynthInstrument {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'sawtooth-wave';
        this.waveType = 'sawtooth';
        // One oscillator, exactly the written pitch (see square-wave)
        this.unisonCount = 1;
        this.detuneCents = 0;
        this.filterTrackMul = 10;
        this.filterQ = 0.7;
    }

    getEnvelopeSettings() {
        return { attack: 0.008, decay: 0.25, sustain: 0.7, release: 0.1 };
    }
}

export class TriangleInstrument extends SynthInstrument {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'triangle-wave';
        this.waveType = 'triangle';
    }

    getEnvelopeSettings() {
        return { attack: 0.015, release: 0.12 };
    }
}

export class OrganInstrument extends SynthInstrument {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'organ';
        this.periodicWave = this.createOrganWave();
    }

    createOrganWave() {
        const harmonicCount = 10;
        const real = new Float32Array(harmonicCount);
        const imag = new Float32Array(harmonicCount);

        real[0] = 0;
        real[1] = 0.8;
        real[2] = 0;
        real[3] = 0.4;
        real[4] = 0.2;
        real[5] = 0.3;
        real[6] = 0.1;
        real[7] = 0;
        real[8] = 0.1;
        real[9] = 0.05;

        for (let i = 1; i < harmonicCount; i++) {
            imag[i] = 0.003 * Math.cos(i * 0.7);
        }

        return this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // A pipe speaks in about 30 ms and holds as long as the key is down.
    getEnvelopeSettings() {
        return { attack: 0.03, release: 0.06 };
    }
}

/**
 * A struck bar. Its spectrum is the one it always had (partials 1, 4 and 10
 * strong: the bar's modes, tuned to the note, two octaves up and a pure major
 * third above that), but the modes now decay at their own rates, as a struck
 * bar's do: partial 4 three times and partials 10–15 six times as fast as the
 * fundamental (whose decay is the envelope's t60). So a long note starts bright
 * and settles on its fundamental. Three oscillators at the same frequency, each
 * through a PeriodicWave holding its group of partials, started together (in
 * phase), scaled so that at the strike their sum is exactly the old wave.
 */
export class VibraphoneInstrument extends SynthInstrument {
    declare waveBody: PeriodicWave;
    declare waveMode4: PeriodicWave;
    declare waveMode10: PeriodicWave;
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'vibraphone';
        this.articulation = 'struck';   // one bar per pitch: struck again, it is damped first
        this.createVibraphoneWaves();
    }

    createVibraphoneWaves() {
        const N = 16;
        const real = new Float32Array(N), imag = new Float32Array(N);
        const amp = [0, 0.6, 0.1, 0.05, 0.8, 0.05, 0.03, 0.02, 0.01, 0.01, 0.4, 0.1, 0.05, 0.03, 0.02, 0.01];
        for (let n = 1; n < N; n++) real[n] = amp[n];
        imag[1] = 0.002; imag[4] = 0.004; imag[10] = 0.003;
        // The browser scales a PeriodicWave to a peak of 1; do it once by hand, for
        // the whole sum, so the three groups add up to that same wave.
        let peak = 0;
        for (let i = 0; i < 2048; i++) {
            const th = (2 * Math.PI * i) / 2048;
            let v = 0;
            for (let n = 1; n < N; n++) v += real[n] * Math.cos(n * th) + imag[n] * Math.sin(n * th);
            peak = Math.max(peak, Math.abs(v));
        }
        const k = peak > 0 ? 1 / peak : 1;
        const group = (pick: (partial: number) => boolean) => {
            const r = new Float32Array(N), im = new Float32Array(N);
            for (let n = 1; n < N; n++) if (pick(n)) { r[n] = real[n] * k; im[n] = imag[n] * k; }
            return this.audioContext.createPeriodicWave(r, im, { disableNormalization: true });
        };
        this.waveBody = group((n) => n !== 4 && n < 10);   // the fundamental and its neighbours
        this.waveMode4 = group((n) => n === 4);             // the bar's second mode
        this.waveMode10 = group((n) => n >= 10);            // its third mode and above
        this.periodicWave = this.waveBody;
    }

    t60For(frequency?: number | null) { return byPitch(frequency, [65, 6], [2000, 2]); }

    createOscillator(frequency: number) {
        const ctx = this.audioContext;
        const make = (wave: PeriodicWave) => { const o = ctx.createOscillator(); o.setPeriodicWave(wave); o.frequency.value = frequency; return o; };
        const body = make(this.waveBody), m4 = make(this.waveMode4), m10 = make(this.waveMode10);
        const g4 = ctx.createGain(), g10 = ctx.createGain(), out = ctx.createGain();
        body.connect(out); m4.connect(g4); g4.connect(out); m10.connect(g10); g10.connect(out);
        const t60 = this.t60For(frequency);
        // Beyond the envelope's decay (t60), partial 4 falls a further 6/t60 decades a
        // second (3× the rate in all) and partials 10–15 a further 15/t60 (6×), from the
        // strike, until they are 140 dB down.
        const decay = (g: GainNode, extra: number, when: number) => {
            try {
                g.gain.cancelScheduledValues(when);
                g.gain.setValueAtTime(1, when);
                g.gain.exponentialRampToValueAtTime(1e-7, when + (7 * t60) / extra);
            } catch {}
        };
        return makeVoice([body, m4, m10], out, frequency, (when) => { decay(g4, 6, when); decay(g10, 15, when); });
    }

    // A struck bar: no sustain, a natural decay (longer for the low bars) until
    // the note-off, then a soft damper.
    getEnvelopeSettings(duration: number, frequency?: number | null) {
        return { attack: 0.002, t60: this.t60For(frequency), release: 0.4 };
    }
}

/**
 * 2-operator FM electric piano (Rhodes/DX-ish "tine"). A sine carrier is
 * frequency-modulated by a sine operator at the same ratio; the modulation
 * index starts bright and decays over the note onset, giving the characteristic
 * percussive-then-mellow FM timbre. Scheduling of the index envelope happens in
 * the voice's start() so it locks to the note's absolute start time.
 */
export class FMEPianoInstrument extends SynthInstrument {
    declare modRatio: number;
    declare indexStart: number;
    declare indexEnd: number;
    declare indexDecay: number;
    constructor(audioContext: BaseAudioContext) {
        super(audioContext);
        this.name = 'fm-epiano';
        this.articulation = 'struck';   // one tine per pitch
        this.modRatio = 1;       // modulator : carrier frequency ratio
        this.indexStart = 4;     // deviation = index * modFreq (bright attack)
        this.indexEnd = 0.6;     // settles to a mellow tone
        this.indexDecay = 0.28;  // seconds
    }

    // A struck tine: natural decay until the note-off, then its damper.
    getEnvelopeSettings(duration: number, frequency?: number | null) {
        return { attack: 0.002, t60: byPitch(frequency, [65, 5], [2000, 1.5]), release: 0.25 };
    }

    createOscillator(frequency: number) {
        const ctx = this.audioContext;
        const modFreq = frequency * this.modRatio;

        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = frequency;

        const modulator = ctx.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.value = modFreq;

        const modGain = ctx.createGain();
        modGain.gain.value = this.indexStart * modFreq;
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        const out = ctx.createGain();
        carrier.connect(out);

        const scheduleIndex = (when: number) => {
            const g = modGain.gain;
            try {
                g.cancelScheduledValues(when);
                g.setValueAtTime(this.indexStart * modFreq, when);
                g.exponentialRampToValueAtTime(
                    Math.max(0.0001, this.indexEnd * modFreq),
                    when + this.indexDecay
                );
            } catch {}
        };

        // Modulator must start/stop with the carrier; makeVoice starts both.
        return makeVoice([carrier, modulator], out, frequency, scheduleIndex);
    }
}

/**
 * Steady harmonic voices for pure intervals. The model is the reed organ: the
 * tuning experiments of the nineteenth century were made on it (Helmholtz's
 * harmonium, Bosanquet's with 53 keys to the octave), because its tone is
 * sustained and full of partials, and that is what makes mistuning plain.
 *
 * Two notes a ratio p/q apart share a partial: the p-th of the lower note is the
 * q-th of the upper. Pure, the two are one steady tone; mistuned, they beat.
 * That beat is the loudest cue to tuning there is. It is not the only one: a
 * sine has no partials to share, and a pure chord of sines still differs
 * audibly from a tempered one, in its pitches and in the difference tones the
 * ear adds. These voices make the difference more salient, and for that the
 * partials have to be there, each of them has to stand still, and the note has
 * to hold its level long enough to listen. So:
 *
 *   - every partial from 1 to 16 sounds. (The organ above has no 2nd and no 7th,
 *     so a 7/4 played on it has nothing to meet.) 7/4 meets on the 7th partial,
 *     11/8 on the 11th, 13/8 on the 13th, 16/15 on the 16th;
 *   - one oscillator through one PeriodicWave: no unison, no detune, no vibrato;
 *   - attack and release are fixed times in seconds, with the full level held
 *     from the attack to the note's end; the release follows the end. (When
 *     these voices were made the other synths used fractions of the note, so a
 *     long chord on them swelled slowly and faded through its last tenth or
 *     more; since Phase I every instrument's envelope is in seconds.)
 *
 * The spectrum is a sawtooth's with the top rolled off:
 *
 *     amplitude(n) = 1 / (n · √(1 + (n / knee)²))
 *
 * 6 dB per octave below the knee, 12 dB above it. The partials are in sine phase
 * (the sawtooth's own shape). In cosine phase, as the organ's are, they would
 * all peak together and the same sound would need twice the headroom: a crest
 * factor of 10.6 dB against 4.5 dB.
 *
 * Not in the SynthInstruments map, so it is not registered itself.
 */
const HARMONIC_VOICE_PARTIALS = 16;

class HarmonicVoice extends SynthInstrument {
    declare partials: number[];
    declare attackSec: number;
    declare releaseSec: number;
    declare level: number;
    /**
     * @param {BaseAudioContext} audioContext
     * @param {{name:string, knee:number, attackSec:number, releaseSec:number, level:number}} voice
     *   knee: the partial above which the roll-off steepens; level: scales the per-note peak
     */
    constructor(audioContext: BaseAudioContext, { name, knee, attackSec, releaseSec, level }: { name: string; knee: number; attackSec: number; releaseSec: number; level: number }) {
        super(audioContext);
        this.name = name;
        this.attackSec = attackSec;
        this.releaseSec = releaseSec;
        this.level = level;
        // Amplitude of partial n at index n - 1.
        this.partials = Array.from({ length: HARMONIC_VOICE_PARTIALS }, (_, i) => {
            const n = i + 1;
            return 1 / (n * Math.sqrt(1 + (n / knee) ** 2));
        });
        this.periodicWave = this.createWave();
    }

    createWave() {
        const real = new Float32Array(this.partials.length + 1); // index 0 is DC
        const imag = new Float32Array(this.partials.length + 1);
        for (let n = 1; n <= this.partials.length; n++) {
            imag[n] = this.partials[n - 1];
        }
        return this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // No decay stage: full level from the attack to the note-off, then the release.
    getEnvelopeSettings() {
        return { attack: this.attackSec, release: this.releaseSec };
    }

    applyEnvelope(gainNode: GainNode, startTime: number, duration: number, initialVolume = 1.0, shape: NoteShape | null = null) {
        applyVoiceEnvelope(gainNode, startTime, duration, initialVolume * this.level, this.getEnvelopeSettings(), shape);
    }
}

/**
 * The full voice: a tune, or chords that should show their tuning. The browser
 * scales a PeriodicWave to a peak of 1, and at that peak this dense wave is
 * louder than the other synths; `level` brings one note to the loudness of one
 * note of the organ (A-weighted, at 263 Hz).
 */
export class HarmoniumInstrument extends HarmonicVoice {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext, { name: 'harmonium', knee: 8, attackSec: 0.03, releaseSec: 0.08, level: 0.6 });
    }
}

/**
 * The same reed behind a darker filter, slower to speak and about 3 dB quieter
 * (A-weighted, one note at 263 Hz): a bed under a tune. Its 7th and 11th
 * partials are still there, 24.5 dB and 32 dB under the fundamental.
 */
export class SoftHarmoniumInstrument extends HarmonicVoice {
    constructor(audioContext: BaseAudioContext) {
        super(audioContext, { name: 'harmonium-soft', knee: 3, attackSec: 0.06, releaseSec: 0.12, level: 0.42 });
    }
}

export const SynthInstruments = {
    SineInstrument,
    SquareInstrument,
    SawtoothInstrument,
    TriangleInstrument,
    OrganInstrument,
    VibraphoneInstrument,
    FMEPianoInstrument,
    HarmoniumInstrument,
    SoftHarmoniumInstrument
};
