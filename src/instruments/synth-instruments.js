import { SynthInstrument, makeVoice, applyVoiceEnvelope } from './instrument-manager.js';

export class SineInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'sine-wave';
        this.waveType = 'sine';
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.1,
            decayTimeRatio: 0.1,
            sustainLevel: 0.7,
            releaseTimeRatio: 0.2
        };
    }
}

export class SquareInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'square-wave';
        this.waveType = 'square';
        // 3-osc unison (±4¢) + a pitch-tracked lowpass to tame the harshness.
        this.unisonCount = 3;
        this.detuneCents = 4;
        this.filterTrackMul = 12;
        this.filterQ = 0.7;
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.05,
            decayTimeRatio: 0.1,
            sustainLevel: 0.6,
            releaseTimeRatio: 0.2
        };
    }
}

export class SawtoothInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'sawtooth-wave';
        this.waveType = 'sawtooth';
        this.unisonCount = 3;
        this.detuneCents = 4;
        this.filterTrackMul = 10;
        this.filterQ = 0.7;
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.05,
            decayTimeRatio: 0.15,
            sustainLevel: 0.6,
            releaseTimeRatio: 0.2
        };
    }
}

export class TriangleInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'triangle-wave';
        this.waveType = 'triangle';
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.15,
            decayTimeRatio: 0.1,
            sustainLevel: 0.8,
            releaseTimeRatio: 0.25
        };
    }
}

export class OrganInstrument extends SynthInstrument {
    constructor(audioContext) {
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

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.05,
            decayTimeRatio: 0.05,
            sustainLevel: 0.9,
            releaseTimeRatio: 0.1
        };
    }
}

export class VibraphoneInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'vibraphone';
        this.periodicWave = this.createVibraphoneWave();
    }

    createVibraphoneWave() {
        const harmonicCount = 16;
        const real = new Float32Array(harmonicCount);
        const imag = new Float32Array(harmonicCount);

        real[0] = 0;
        real[1] = 0.6;
        real[2] = 0.1;
        real[3] = 0.05;
        real[4] = 0.8;
        real[5] = 0.05;
        real[6] = 0.03;
        real[7] = 0.02;
        real[8] = 0.01;
        real[9] = 0.01;
        real[10] = 0.4;
        real[11] = 0.1;
        real[12] = 0.05;
        real[13] = 0.03;
        real[14] = 0.02;
        real[15] = 0.01;

        imag[1] = 0.002;
        imag[4] = 0.004;
        imag[10] = 0.003;

        return this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.02,
            decayTimeRatio: 0.3,
            sustainLevel: 0.3,
            releaseTimeRatio: 0.5
        };
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
    constructor(audioContext) {
        super(audioContext);
        this.name = 'fm-epiano';
        this.modRatio = 1;       // modulator : carrier frequency ratio
        this.indexStart = 4;     // deviation = index * modFreq (bright attack)
        this.indexEnd = 0.6;     // settles to a mellow tone
        this.indexDecay = 0.28;  // seconds
    }

    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.005,
            decayTimeRatio: 0.4,
            sustainLevel: 0.5,
            releaseTimeRatio: 0.3
        };
    }

    createOscillator(frequency) {
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

        const scheduleIndex = (when) => {
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
 *     between them. The other synths use fractions of the note, so a long chord
 *     on them swells slowly and fades through its last tenth or more.
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
    /**
     * @param {BaseAudioContext} audioContext
     * @param {{name:string, knee:number, attackSec:number, releaseSec:number, level:number}} voice
     *   knee: the partial above which the roll-off steepens; level: scales the per-note peak
     */
    constructor(audioContext, { name, knee, attackSec, releaseSec, level }) {
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

    // Seconds become the ratios the shared envelope takes, as the multisampled
    // instruments do it: no decay stage, full level until the release.
    getEnvelopeSettings(duration) {
        const dur = duration > 0 ? duration : 1;
        return {
            attackTimeRatio: this.attackSec / dur,
            decayTimeRatio: 0,
            sustainLevel: 1,
            releaseTimeRatio: this.releaseSec / dur
        };
    }

    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0, shape = null) {
        applyVoiceEnvelope(gainNode, startTime, duration, initialVolume * this.level, this.getEnvelopeSettings(duration), shape);
    }
}

/**
 * The full voice: a tune, or chords that should show their tuning. The browser
 * scales a PeriodicWave to a peak of 1, and at that peak this dense wave is
 * louder than the other synths; `level` brings one note to the loudness of one
 * note of the organ (A-weighted, at 263 Hz).
 */
export class HarmoniumInstrument extends HarmonicVoice {
    constructor(audioContext) {
        super(audioContext, { name: 'harmonium', knee: 8, attackSec: 0.03, releaseSec: 0.08, level: 0.6 });
    }
}

/**
 * The same reed behind a darker filter, slower to speak and about 3 dB quieter
 * (A-weighted, one note at 263 Hz): a bed under a tune. Its 7th and 11th
 * partials are still there, 24.5 dB and 32 dB under the fundamental.
 */
export class SoftHarmoniumInstrument extends HarmonicVoice {
    constructor(audioContext) {
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
