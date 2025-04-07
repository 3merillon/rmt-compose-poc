/*
 * Synth Instruments - Collection of all synthesized instruments
 * Each instrument extends the SynthInstrument base class
 */

// Define a namespace for all synth instruments
const SynthInstruments = {};

/*
 * Sine wave instrument
 */
SynthInstruments.SineInstrument = class SineInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'sine-wave';
    }

    // Override the createOscillator method
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Custom envelope for sine wave
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.1,
            decayTimeRatio: 0.1,
            sustainLevel: 0.7,
            releaseTimeRatio: 0.2
        };
    }
};

/*
 * Square wave instrument
 */
SynthInstruments.SquareInstrument = class SquareInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'square-wave';
    }

    // Override the createOscillator method
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'square';
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Custom envelope for square wave
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.05, // Faster attack for square wave
            decayTimeRatio: 0.1,
            sustainLevel: 0.6,  // Slightly lower sustain for square wave
            releaseTimeRatio: 0.2
        };
    }
};

/*
 * Sawtooth wave instrument
 */
SynthInstruments.SawtoothInstrument = class SawtoothInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'sawtooth-wave';
    }

    // Override the createOscillator method
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Custom envelope for sawtooth wave
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.05, // Faster attack for sawtooth
            decayTimeRatio: 0.15, // Longer decay
            sustainLevel: 0.6,
            releaseTimeRatio: 0.2
        };
    }
};

/*
 * Triangle wave instrument
 */
SynthInstruments.TriangleInstrument = class TriangleInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'triangle-wave';
    }

    // Override the createOscillator method
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Custom envelope for triangle wave
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.15, // Slower attack for triangle
            decayTimeRatio: 0.1,
            sustainLevel: 0.8, // Higher sustain for triangle
            releaseTimeRatio: 0.25 // Longer release
        };
    }
};

/*
 * Organ instrument using custom periodic wave
 */
SynthInstruments.OrganInstrument = class OrganInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'organ';
        this.periodicWave = this.createOrganWave();
    }

    // Create organ periodic wave with richer harmonics
    createOrganWave() {
        const harmonicCount = 10;
        const real = new Float32Array(harmonicCount);
        const imag = new Float32Array(harmonicCount);
        
        // DC offset
        real[0] = 0;
        
        // Hammond B-3 typical drawbar settings (8', 5 1/3', 4', etc.)
        // These simulate the 9 drawbars of a Hammond organ
        real[1] = 0.8;    // 8' fundamental
        real[2] = 0;      // 4' octave (off in this registration)
        real[3] = 0.4;    // 2 2/3' fifth
        real[4] = 0.2;    // 2' octave
        real[5] = 0.3;    // 1 3/5' third
        real[6] = 0.1;    // 1 1/3' fifth
        real[7] = 0;      // 1' octave (off)
        real[8] = 0.1;    // 4/5' flat seventh
        real[9] = 0.05;   // 2/3' ninth
        
        // Add some chorus/vibrato effect with subtle phase differences
        for (let i = 1; i < harmonicCount; i++) {
            imag[i] = 0.003 * Math.cos(i * 0.7);
        }
        
        return this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // Override the createOscillator method
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.setPeriodicWave(this.periodicWave);
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Custom envelope for organ
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.05, // Fast attack for organ
            decayTimeRatio: 0.05, // Short decay
            sustainLevel: 0.9,    // High sustain for organ
            releaseTimeRatio: 0.1  // Short release
        };
    }
};

/*
 * Vibraphone instrument using custom periodic wave
 */
SynthInstruments.VibraphoneInstrument = class VibraphoneInstrument extends SynthInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'vibraphone';
        this.periodicWave = this.createVibraphoneWave();
    }

    // Create a vibraphone periodic wave
    createVibraphoneWave() {
        // Vibraphones have a complex, inharmonic spectrum characteristic of metal bars
        const harmonicCount = 16;
        const real = new Float32Array(harmonicCount);
        const imag = new Float32Array(harmonicCount);
        
        // DC offset
        real[0] = 0;
        
        // Fundamental - present but not as dominant as in other instruments
        real[1] = 0.6;
        
        // Vibraphone has strong 4th harmonic (double octave) which gives it the metallic quality
        real[2] = 0.1;   // 2nd harmonic (octave) - relatively weak
        real[3] = 0.05;  // 3rd harmonic - very weak
        real[4] = 0.8;   // 4th harmonic (double octave) - very strong, characteristic of vibraphone
        
        // The 10th harmonic is also prominent in vibraphones (creates the bell-like quality)
        real[5] = 0.05;
        real[6] = 0.03;
        real[7] = 0.02;
        real[8] = 0.01;
        real[9] = 0.01;
        real[10] = 0.4;  // 10th harmonic - prominent, gives bell-like character
        
        // Higher harmonics add some shimmer
        real[11] = 0.1;
        real[12] = 0.05;
        real[13] = 0.03;
        real[14] = 0.02;
        real[15] = 0.01;
        
        // Minimal phase information - just enough to add some complexity
        imag[1] = 0.002;
        imag[4] = 0.004;
        imag[10] = 0.003;
        
        return this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // Override the createOscillator method
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.setPeriodicWave(this.periodicWave);
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Custom envelope for vibraphone
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.02, // Very fast attack for vibraphone
            decayTimeRatio: 0.3,   // Longer decay for vibraphone
            sustainLevel: 0.3,     // Lower sustain for vibraphone
            releaseTimeRatio: 0.5  // Long release for vibraphone
        };
    }
};

// Export the instruments namespace
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SynthInstruments;
} else {
    window.SynthInstruments = SynthInstruments;
}