import { SampleInstrument } from './instrument-manager.js';

export class PianoInstrument extends SampleInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'piano';
        this.loadSample('/instruments/samples/piano.wav', 440);
    }
    
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.002,
            decayTimeRatio: 0.008,
            sustainLevel: 0.9,
            releaseTimeRatio: 0.05
        };
    }
}

export class ViolinInstrument extends SampleInstrument {
    constructor(audioContext) {
        super(audioContext);
        this.name = 'violin';
        this.loadSample('/instruments/samples/violin.wav', 523.25);
    }
    
    getEnvelopeSettings() {
        return {
            attackTimeRatio: 0.08,
            decayTimeRatio: 0.05,
            sustainLevel: 0.85,
            releaseTimeRatio: 0.15
        };
    }
    
    applyEnvelope(gainNode, startTime, duration, initialVolume = 1.0) {
        const env = this.getEnvelopeSettings();
        const isShortNote = duration < 0.3;
        
        let attackTime, decayTime, releaseTime, sustainTime;
        
        if (isShortNote) {
            attackTime = Math.min(duration * 0.2, 0.03);
            decayTime = 0;
            releaseTime = Math.min(duration * 0.8, 0.25);
            sustainTime = duration - attackTime - releaseTime;
            
            if (sustainTime < 0.01) {
                releaseTime = Math.max(duration - attackTime - 0.01, 0.01);
                sustainTime = duration - attackTime - releaseTime;
            }
        } else {
            attackTime = Math.min(0.15, duration * env.attackTimeRatio);
            decayTime = Math.min(0.1, duration * env.decayTimeRatio);
            releaseTime = Math.min(0.3, duration * env.releaseTimeRatio);
            sustainTime = duration - attackTime - decayTime - releaseTime;
            
            if (sustainTime < 0) {
                const ratio = duration / (attackTime + decayTime + releaseTime);
                attackTime *= ratio * 0.5;
                decayTime *= ratio * 0.2;
                releaseTime *= ratio * 0.3;
                sustainTime = 0;
            }
        }
        
        gainNode.gain.cancelScheduledValues(startTime);
        gainNode.gain.setValueAtTime(0.01, startTime);
        
        if (isShortNote) {
            gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
            
            if (sustainTime > 0) {
                gainNode.gain.setValueAtTime(initialVolume, startTime + attackTime + sustainTime);
            }
            
            const releaseStartTime = startTime + attackTime + sustainTime;
            const releaseCurve = 0.7;
            const releaseMidpoint = releaseStartTime + (releaseTime * releaseCurve);
            const releaseMidLevel = initialVolume * 0.4;
            
            gainNode.gain.linearRampToValueAtTime(releaseMidLevel, releaseMidpoint);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            gainNode.gain.setValueAtTime(0, startTime + duration);
        } else {
            const attackCurve = 0.3;
            const attackMidpoint = startTime + (attackTime * attackCurve);
            const attackMidLevel = initialVolume * 0.4;
            
            gainNode.gain.linearRampToValueAtTime(attackMidLevel, attackMidpoint);
            gainNode.gain.linearRampToValueAtTime(initialVolume, startTime + attackTime);
            
            if (decayTime > 0) {
                gainNode.gain.linearRampToValueAtTime(
                    initialVolume * env.sustainLevel, 
                    startTime + attackTime + decayTime
                );
            }
            
            if (sustainTime > 0) {
                gainNode.gain.setValueAtTime(
                    initialVolume * env.sustainLevel, 
                    startTime + attackTime + decayTime + sustainTime
                );
            }
            
            if (duration > 0.5) {
                const swellTime = Math.min(0.1, duration * 0.1);
                const swellStart = startTime + duration - releaseTime - swellTime;
                const swellLevel = initialVolume * env.sustainLevel * 1.1;
                
                gainNode.gain.linearRampToValueAtTime(swellLevel, swellStart + swellTime);
            }
            
            gainNode.gain.linearRampToValueAtTime(initialVolume * 0.3, startTime + duration - (releaseTime * 0.3));
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            gainNode.gain.setValueAtTime(0, startTime + duration);
        }
        
        const tailDuration = isShortNote ? 0.15 : 0.05;
        gainNode.gain.setValueAtTime(0.001, startTime + duration);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + tailDuration);
        gainNode.gain.setValueAtTime(0, startTime + duration + tailDuration);
    }
}

export const SampleInstruments = {
    PianoInstrument,
    ViolinInstrument
};