class SynthInstrument {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.name = 'base';
        this.type = 'synth';
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
        const oscillator = this.audioContext.createOscillator();
        oscillator.frequency.value = frequency;
        return oscillator;
    }

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

class SampleInstrument {
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
        
        const wrapper = {
            frequency: { value: frequency },
            start: (when) => source.start(when),
            stop: (when) => source.stop(when),
            connect: (destination) => filter.connect(destination),
            disconnect: () => filter.disconnect()
        };
        
        return wrapper;
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

class InstrumentManager {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.instruments = new Map();
        this.defaultInstrument = 'sine-wave';
        this.registerBuiltInInstruments();
    }

    registerBuiltInInstruments() {
        if (typeof SynthInstruments !== 'undefined') {
            Object.values(SynthInstruments).forEach(InstrumentClass => {
                if (typeof InstrumentClass === 'function') {
                    this.registerInstrument(new InstrumentClass(this.audioContext));
                }
            });
        } else {
            console.warn('SynthInstruments not loaded yet.');
        }
        
        if (typeof SampleInstruments !== 'undefined') {
            Object.values(SampleInstruments).forEach(InstrumentClass => {
                if (typeof InstrumentClass === 'function' && 
                    InstrumentClass.name !== 'SampleInstrument') {
                    this.registerInstrument(new InstrumentClass(this.audioContext));
                }
            });
        } else {
            console.warn('SampleInstruments not loaded yet.');
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

window.SynthInstrument = SynthInstrument;
window.SampleInstrument = SampleInstrument;
window.InstrumentManager = InstrumentManager;
