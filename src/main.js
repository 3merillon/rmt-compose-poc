import Fraction from 'fraction.js';
import tapspace from 'tapspace';
import { Module, invalidateModuleEndTimeCache } from './module.js';
import { Note } from './note.js';
import { InstrumentManager, SynthInstrument, SampleInstrument } from './instruments/instrument-manager.js';
import * as SynthInstrumentsModule from './instruments/synth-instruments.js';
import * as SampleInstrumentsModule from './instruments/sample-instruments.js';
import { initStackClick } from './stack-click.js';

// Make Fraction and tapspace globally available for the legacy code
window.Fraction = Fraction;
window.tapspace = tapspace;

// Expose core classes globally
window.Module = Module;
window.Note = Note;
window.InstrumentManager = InstrumentManager;
window.SynthInstrument = SynthInstrument;
window.SampleInstrument = SampleInstrument;

// Create the SynthInstruments object with all instrument classes
window.SynthInstruments = {
    SineInstrument: SynthInstrumentsModule.SineInstrument,
    SquareInstrument: SynthInstrumentsModule.SquareInstrument,
    SawtoothInstrument: SynthInstrumentsModule.SawtoothInstrument,
    TriangleInstrument: SynthInstrumentsModule.TriangleInstrument,
    OrganInstrument: SynthInstrumentsModule.OrganInstrument,
    VibraphoneInstrument: SynthInstrumentsModule.VibraphoneInstrument
};

// Create the SampleInstruments object
window.SampleInstruments = {
    PianoInstrument: SampleInstrumentsModule.PianoInstrument,
    ViolinInstrument: SampleInstrumentsModule.ViolinInstrument
};

window.invalidateModuleEndTimeCache = invalidateModuleEndTimeCache;

// Import and initialize the legacy modules
// These will be loaded as regular scripts since they're too complex to fully convert immediately
async function initApp() {
    // Initialize stack click functionality
    initStackClick();
    
    // The modals, menu-bar, and player scripts will be loaded via script tags
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