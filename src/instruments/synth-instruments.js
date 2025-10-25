import { SynthInstrument } from './instrument-manager.js';

export class SineInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'sine-wave';
    }

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        return oscillator;
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
    }

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'square';
        oscillator.frequency.value = frequency;
        return oscillator;
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
    }

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = frequency;
        return oscillator;
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
    }

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        return oscillator;
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

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.setPeriodicWave(this.periodicWave);
        oscillator.frequency.value = frequency;
        return oscillator;
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

    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.setPeriodicWave(this.periodicWave);
        oscillator.frequency.value = frequency;
        return oscillator;
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

export const SynthInstruments = {
    SineInstrument,
    SquareInstrument,
    SawtoothInstrument,
    TriangleInstrument,
    OrganInstrument,
    VibraphoneInstrument
};