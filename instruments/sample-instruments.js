/*
 * Sample Instruments - Collection of all sample-based instruments
 * Each instrument extends the SampleInstrument base class
 */

// Define a namespace for all sample instruments
const SampleInstruments = {};

/*
 * Piano instrument using a sample
 */
SampleInstruments.PianoInstrument = class PianoInstrument extends SampleInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'piano';
        
        // Load the piano sample (A4 = 440Hz)
        this.loadSample('instruments/samples/piano.wav', 440);
    }
    
    // Custom envelope for piano
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.002,  // Very fast attack for piano
            decayTimeRatio: 0.008,   // Quick initial decay
            sustainLevel: 0.9,       // High sustain to let the sample decay naturally
            releaseTimeRatio: 0.05   // Short release to avoid clicks
        };
    }
};

SampleInstruments.ViolinInstrument = class ViolinInstrument extends SampleInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'violin';
        
        // Load the violin sample (C5 = 523.25Hz)
        this.loadSample('instruments/samples/violin.wav', 523.25);
    }
    
    // Custom envelope for violin
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.08,    // Slower attack for violin (bowing takes time)
            decayTimeRatio: 0.05,     // Slight decay after initial attack
            sustainLevel: 0.85,       // Strong sustain level for violin
            releaseTimeRatio: 0.15    // Longer, more gradual release
        };
    }
    
    // Override the applyEnvelope method for more violin-specific behavior
    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0) {
        const env = this.getEnvelopeSettings();
        
        // Determine if this is a short note
        const isShortNote = duration < 0.3; // Less than 300ms is considered short
        
        // Calculate envelope timings - adjusted for note length
        let attackTime, decayTime, releaseTime, sustainTime;
        
        if (isShortNote) {
            // For short notes, use a faster attack and longer release
            attackTime = Math.min(duration * 0.2, 0.03); // Very quick attack, max 30ms
            decayTime = 0; // No decay phase for short notes
            releaseTime = Math.min(duration * 0.8, 0.25); // Longer release, up to 250ms
            sustainTime = duration - attackTime - releaseTime;
            
            // Ensure we have a minimum sustain time
            if (sustainTime < 0.01) {
                releaseTime = Math.max(duration - attackTime - 0.01, 0.01);
                sustainTime = duration - attackTime - releaseTime;
            }
        } else {
            // For longer notes, use the standard envelope
            attackTime = Math.min(0.15, duration * env.attackTimeRatio);
            decayTime = Math.min(0.1, duration * env.decayTimeRatio);
            releaseTime = Math.min(0.3, duration * env.releaseTimeRatio);
            sustainTime = duration - attackTime - decayTime - releaseTime;
            
            // If duration is very short, adjust envelope phases proportionally
            if (sustainTime < 0) {
                const ratio = duration / (attackTime + decayTime + releaseTime);
                attackTime *= ratio * 0.5;  // Prioritize attack
                decayTime *= ratio * 0.2;   // Reduce decay
                releaseTime *= ratio * 0.3; // Maintain some release
                sustainTime = 0;
            }
        }
        
        // Apply the envelope
        gainNode.gain.cancelScheduledValues(startTime);
        
        // Start at a small non-zero value to avoid clicks
        gainNode.gain.setValueAtTime(0.01, startTime);
        
        if (isShortNote) {
            // For short notes, use a simpler envelope with quick attack and longer release
            gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
            
            if (sustainTime > 0) {
                gainNode.gain.setValueAtTime(initialVolume, startTime + attackTime + sustainTime);
            }
            
            // Use a curved release for short notes to avoid abrupt cutoffs
            const releaseStartTime = startTime + attackTime + sustainTime;
            const releaseCurve = 0.7; // Controls how quickly the release starts dropping
            const releaseMidpoint = releaseStartTime + (releaseTime * releaseCurve);
            const releaseMidLevel = initialVolume * 0.4;
            
            // Two-stage release for smoother tail
            gainNode.gain.linearRampToValueAtTime(releaseMidLevel, releaseMidpoint);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration); // Can't ramp to 0, so use 0.001
            gainNode.gain.setValueAtTime(0, startTime + duration);
        } else {
            // For longer notes, use the more complex envelope
            // Attack phase - use a curved attack for violin (slight S-curve)
            const attackCurve = 0.3; // Controls the curve shape (0 = linear, higher = more curved)
            const attackMidpoint = startTime + (attackTime * attackCurve);
            const attackMidLevel = initialVolume * 0.4;
            
            gainNode.gain.linearRampToValueAtTime(attackMidLevel, attackMidpoint);
            gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
            
            // Decay to sustain level
            if (decayTime > 0) {
                gainNode.gain.linearRampToValueAtTime(
                    initialVolume * env.sustainLevel, 
                    startTime + attackTime + decayTime
                );
            }
            
            // Hold at sustain level
            if (sustainTime > 0) {
                gainNode.gain.setValueAtTime(
                    initialVolume * env.sustainLevel, 
                    startTime + attackTime + decayTime + sustainTime
                );
            }
            
            // Add a slight swell before release for a more natural bowed sound
            if (duration > 0.5) {
                const swellTime = Math.min(0.1, duration * 0.1);
                const swellStart = startTime + duration - releaseTime - swellTime;
                const swellLevel = initialVolume * env.sustainLevel * 1.1; // 10% increase
                
                gainNode.gain.linearRampToValueAtTime(swellLevel, swellStart + swellTime);
            }
            
            // Release phase - use a curved release for violin
            // Use exponentialRampToValueAtTime for a more natural decay
            gainNode.gain.linearRampToValueAtTime(initialVolume * 0.3, startTime + duration - (releaseTime * 0.3));
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration); // Can't ramp to 0, so use 0.001
            gainNode.gain.setValueAtTime(0, startTime + duration);
        }
        
        // Add a small tail after the note's official end to avoid abrupt cutoffs
        // This helps with the stuttering effect for sequences of short notes
        const tailDuration = isShortNote ? 0.15 : 0.05; // Longer tail for short notes
        gainNode.gain.setValueAtTime(0.001, startTime + duration);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + tailDuration);
        gainNode.gain.setValueAtTime(0, startTime + duration + tailDuration);
    }
}

// Export the instruments namespace
window.SampleInstruments = SampleInstruments;