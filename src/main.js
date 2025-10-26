import Fraction from 'fraction.js';
import tapspace from 'tapspace';
import { Module } from './module.js';
import { Note } from './note.js';
import { InstrumentManager, SynthInstrument, SampleInstrument } from './instruments/instrument-manager.js';
import * as SynthInstrumentsModule from './instruments/synth-instruments.js';
import * as SampleInstrumentsModule from './instruments/sample-instruments.js';
import { initStackClick } from './stack-click.js';
import { eventBus } from './utils/event-bus.js';
import { modals } from './modals/index.js';
import { audioEngine } from './player/audio-engine.js';

// Globals are exposed via registerGlobals below to centralize window.* writes

// Create the SynthInstruments object with all instrument classes
const SynthInstruments = {
    SineInstrument: SynthInstrumentsModule.SineInstrument,
    SquareInstrument: SynthInstrumentsModule.SquareInstrument,
    SawtoothInstrument: SynthInstrumentsModule.SawtoothInstrument,
    TriangleInstrument: SynthInstrumentsModule.TriangleInstrument,
    OrganInstrument: SynthInstrumentsModule.OrganInstrument,
    VibraphoneInstrument: SynthInstrumentsModule.VibraphoneInstrument
};

// Create the SampleInstruments object
const SampleInstruments = {
    PianoInstrument: SampleInstrumentsModule.PianoInstrument,
    ViolinInstrument: SampleInstrumentsModule.ViolinInstrument
};


// Register built-in instruments in the shared audio engine
try {
    audioEngine.registerInstruments(SynthInstruments, SampleInstruments);
} catch (e) {
    console.error('Failed to register instruments in audioEngine', e);
}

 // Ensure legacy player registers its DOMContentLoaded handler before it fires
 import './player.js';
 
 // Import and initialize the legacy modules
// These will be loaded as regular scripts since they're too complex to fully convert immediately
async function initApp() {
    // Initialize stack click functionality
    initStackClick();

    // Initialize ES module modals (and keep window.modals for legacy callers)
    try {
        modals.init();
    } catch (e) {
        console.error('Failed to initialize modals', e);
    }

    // Load and initialize menu bar via dynamic import (ensures globals are set first)
    try {
        const { initMenuBar } = await import('./menu/index.js');
        if (typeof initMenuBar === 'function') {
            initMenuBar();
        }
    } catch (e) {
        console.error('Failed to load or initialize ./menu/index.js', e);
    }
    
    // Player is imported at top-level to ensure its DOMContentLoaded handler is registered before firing.

}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

export { Module, Note, InstrumentManager, Fraction, tapspace };