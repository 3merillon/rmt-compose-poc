/*
 * Instrument Manager - handles loading and registering instruments
 * Includes the base SynthInstrument and SampleInstrument classes
 */

/*
 * Base class for synthesized instruments
 */
class SynthInstrument {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.name = 'base'; // To be overridden by subclasses
        this.type = 'synth';
    }

    // Default envelope settings - can be overridden by specific instruments
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.1,
            decayTimeRatio: 0.1,
            sustainLevel: 0.7,
            releaseTimeRatio: 0.2
        };
    }

    // Create and configure an oscillator
    createOscillator(frequency) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.frequency.value = frequency;
        return oscillator;
    }

    // Apply envelope to a gain node
    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0) {
        const env = this.getEnvelopeSettings();
        
        const attackTime = duration * env.attackTimeRatio;
        const decayTime = duration * env.decayTimeRatio;
        const releaseTime = duration * env.releaseTimeRatio;
        const sustainTime = duration - attackTime - decayTime - releaseTime;
        
        gainNode.gain.cancelScheduledValues(startTime);
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
        gainNode.gain.linearRampToValueAtTime(initialVolume * env.sustainLevel, startTime + attackTime + decayTime);
        gainNode.gain.setValueAtTime(initialVolume * env.sustainLevel, startTime + attackTime + decayTime + sustainTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }
}

/*
 * Base class for sample-based instruments
 */
class SampleInstrument {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.name = 'base-sample'; // To be overridden by subclasses
        this.type = 'sample';
        this.buffers = new Map(); // Map to store loaded audio buffers
        this.baseFrequency = 440; // Default reference frequency (A4)
        this.isLoaded = false;
        this.loadPromise = null;
    }

    // Default envelope settings - can be overridden by specific instruments
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.005,  // Very short attack to avoid clicks
            decayTimeRatio: 0.01,    // Short decay
            sustainLevel: 0.95,      // High sustain to preserve the sample's natural decay
            releaseTimeRatio: 0.1    // Short release to avoid clicks
        };
    }

    // Load a sample file
    loadSample(url, baseFrequency = 440) {
        this.baseFrequency = baseFrequency;
        
        // Create a promise to load the sample
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
                    //console.log(`Sample loaded: ${url}`);
                    resolve(audioBuffer);
                })
                .catch(error => {
                    console.error(`Error loading sample: ${error.message}`);
                    reject(error);
                });
        });
        
        return this.loadPromise;
    }

    // Wait for all samples to load
    waitForLoad() {
        return this.loadPromise || Promise.resolve();
    }

    // Create a fallback oscillator if sample loading fails
    createFallbackOscillator(frequency) {
        const fallbackOsc = this.audioContext.createOscillator();
        fallbackOsc.frequency.value = frequency;
        fallbackOsc.type = 'sine';
        return fallbackOsc;
    }

    // Create an oscillator with advanced pitch shifting
    createOscillator(frequency) {
        // If the sample hasn't loaded yet, return a silent oscillator
        if (!this.isLoaded) {
            console.warn(`Sample for ${this.name} not loaded yet, using fallback`);
            return this.createFallbackOscillator(frequency);
        }
        
        const buffer = this.buffers.get('default');
        if (!buffer) {
            console.error('No sample loaded for', this.name);
            return this.createFallbackOscillator(frequency);
        }
        
        // Calculate pitch ratio
        const pitchRatio = frequency / this.baseFrequency;
        
        // Create the source with pitch shifting
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitchRatio;
        
        // Add a filter to compensate for the spectral changes
        const filter = this.audioContext.createBiquadFilter();
        
        if (pitchRatio > 1.0) {
            // For upward pitch shifts, add a low pass filter to reduce harshness
            filter.type = 'lowpass';
            filter.frequency.value = Math.min(20000, 8000 / Math.sqrt(pitchRatio));
            filter.Q.value = 0.5;
        } else {
            // For downward pitch shifts, add a high pass filter to maintain clarity
            filter.type = 'highpass';
            filter.frequency.value = Math.max(20, 80 * Math.sqrt(pitchRatio));
            filter.Q.value = 0.5;
        }
        
        // Connect the source to the filter
        source.connect(filter);
        
        // Create a wrapper object that mimics an oscillator
        const wrapper = {
            frequency: { value: frequency },
            start: (when) => source.start(when),
            stop: (when) => source.stop(when),
            connect: (destination) => filter.connect(destination),
            disconnect: () => filter.disconnect()
        };
        
        return wrapper;
    }

    // Apply envelope to a gain node
    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0) {
        const env = this.getEnvelopeSettings();
        
        // For samples, we want a very short attack to avoid clicks
        const attackTime = Math.min(0.01, duration * env.attackTimeRatio);
        
        // For natural sounding samples, we often want to let the sample's
        // natural decay handle most of the envelope
        const releaseTime = Math.min(0.1, duration * env.releaseTimeRatio);
        
        // The rest of the time is sustain
        const sustainTime = duration - attackTime - releaseTime;
        
        gainNode.gain.cancelScheduledValues(startTime);
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
        gainNode.gain.setValueAtTime(initialVolume, startTime + attackTime + sustainTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }
}

class InstrumentManager {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.instruments = new Map();
        this.defaultInstrument = 'sine-wave';
        
        // Register built-in instruments
        this.registerBuiltInInstruments();
    }

    // Register all built-in instruments
    registerBuiltInInstruments() {
        // Register synth instruments
        if (typeof SynthInstruments !== 'undefined') {
            Object.values(SynthInstruments).forEach(InstrumentClass => {
                if (typeof InstrumentClass === 'function') {
                    this.registerInstrument(new InstrumentClass(this.audioContext));
                }
            });
        } else {
            console.warn('SynthInstruments not loaded yet.');
        }
        
        // Register sample instruments
        if (typeof SampleInstruments !== 'undefined') {
            Object.values(SampleInstruments).forEach(InstrumentClass => {
                if (typeof InstrumentClass === 'function' && 
                    InstrumentClass.name !== 'SampleInstrument') { // Skip the base class
                    this.registerInstrument(new InstrumentClass(this.audioContext));
                }
            });
        } else {
            console.warn('SampleInstruments not loaded yet.');
        }
    }

    // Register a new instrument
    registerInstrument(instrument) {
        if (!instrument || !instrument.name) {
            console.error('Invalid instrument provided to register');
            return false;
        }
        
        this.instruments.set(instrument.name.toLowerCase(), instrument);
        return true;
    }

    // Get an instrument by name
    getInstrument(name) {
        const instrumentName = (name || this.defaultInstrument).toLowerCase();
        
        if (this.instruments.has(instrumentName)) {
            return this.instruments.get(instrumentName);
        }
        
        console.warn(`Instrument "${name}" not found, using default instrument "${this.defaultInstrument}"`);
        return this.instruments.get(this.defaultInstrument);
    }

    // Get all available instrument names
    getAvailableInstruments() {
        return Array.from(this.instruments.keys());
    }

    // Create an oscillator for a specific instrument
    createOscillator(instrumentName, frequency) {
        const instrument = this.getInstrument(instrumentName);
        return instrument.createOscillator(frequency);
    }

    // Apply envelope to a gain node using the specified instrument's settings
    applyEnvelope(instrumentName, gainNode, startTime, duration, initialVolume = 1.0) {
        const instrument = this.getInstrument(instrumentName);
        instrument.applyEnvelope(gainNode, startTime, duration, initialVolume);
    }
}

// Export the classes
window.SynthInstrument = SynthInstrument;
window.SampleInstrument = SampleInstrument;
window.InstrumentManager = InstrumentManager;