import { SynthInstrument, makeVoice } from './instrument-manager.js';

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

export const SynthInstruments = {
    SineInstrument,
    SquareInstrument,
    SawtoothInstrument,
    TriangleInstrument,
    OrganInstrument,
    VibraphoneInstrument,
    FMEPianoInstrument
};
