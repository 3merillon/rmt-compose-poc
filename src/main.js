import Fraction from 'fraction.js';
import tapspace from 'tapspace';
import { Module, invalidateModuleEndTimeCache } from './module.js';
import { Note } from './note.js';
import { InstrumentManager, SynthInstrument, SampleInstrument } from './instruments/instrument-manager.js';
import * as SynthInstrumentsModule from './instruments/synth-instruments.js';
import * as SampleInstrumentsModule from './instruments/sample-instruments.js';
import { initStackClick } from './stack-click.js';
import { registerGlobals } from './utils/compat.js';
import { eventBus } from './utils/event-bus.js';
import { modals } from './modals/index.js';

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

registerGlobals({
    Fraction,
    tapspace,
    Module,
    Note,
    InstrumentManager,
    SynthInstrument,
    SampleInstrument,
    SynthInstruments,
    SampleInstruments,
    invalidateModuleEndTimeCache,
    eventBus,
    modals
});

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
        } else if (window.menuBar && typeof window.menuBar.init === 'function') {
            // Fallback for legacy global if export is missing
            window.menuBar.init();
        }
    } catch (e) {
        console.error('Failed to load or initialize ./menu/index.js', e);
    }
    
    // The player script will be loaded via script tag
    // but we ensure the core ES6 modules are available first
    console.log('ES6 modules loaded successfully');
    console.log('Core classes available:', { Module, Note, InstrumentManager, Fraction, tapspace });
    console.log('Instruments registered:', {
        SynthInstruments: Object.keys(window.SynthInstruments),
        SampleInstruments: Object.keys(window.SampleInstruments)
    });
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

export { Module, Note, InstrumentManager, Fraction, tapspace };