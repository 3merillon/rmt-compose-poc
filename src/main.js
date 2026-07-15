import Fraction from 'fraction.js';
import { Module } from './module.js';
import { Note } from './note.js';
import { InstrumentManager, SynthInstrument, SampleInstrument } from './instruments/instrument-manager.js';
import * as SynthInstrumentsModule from './instruments/synth-instruments.js';
import * as SampleInstrumentsModule from './instruments/sample-instruments.js';
import { initStackClick } from './stack-click.js';
import { initViewport } from './utils/viewport.js';
import { eventBus } from './utils/event-bus.js';
import { modals } from './modals/index.js';
import { audioEngine } from './player/audio-engine.js';
import './store/history.js';

// WASM module initialization
import { initWasm, isWasmAvailable, getWasmVersion } from './wasm/index.js';
import { WASM_CONFIG } from './wasm/config.js';

 // Globals are exposed via registerGlobals below to centralize window.* writes

// Desktop-app feel: ctrl/⌘ + wheel must NEVER page-zoom the app.
//
// Reaching for a modifier to zoom is a common reflex, and having the browser page-zoom
// the whole document on that reflex breaks the illusion that this is an application
// rather than a web page. Over the workspace, the camera turns ctrl+wheel into the SAME
// app zoom as a plain wheel (see camera-controller); over the UI chrome — top bar, module
// library, any panel — it does nothing at all.
//
// Capture phase at module scope, so it is live before the first frame and beats every
// other wheel listener. preventDefault() here does NOT stop propagation, so the camera
// still receives the event and zooms. It fires only for a MODIFIED wheel, so ordinary
// scrolling (the module library, widget bodies) is untouched. `passive: false` is
// mandatory: wheel listeners default to passive, where preventDefault is silently ignored.
try {
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }, { passive: false, capture: true });
} catch {}

// Publish --app-width / --app-height before anything lays out. Not inside initApp():
// that awaits the WASM load, and the chrome would spend those frames sized against
// the wrong viewport.
try { initViewport(); } catch (e) {}

// Create the SynthInstruments object with all instrument classes
const SynthInstruments = {
    SineInstrument: SynthInstrumentsModule.SineInstrument,
    SquareInstrument: SynthInstrumentsModule.SquareInstrument,
    SawtoothInstrument: SynthInstrumentsModule.SawtoothInstrument,
    TriangleInstrument: SynthInstrumentsModule.TriangleInstrument,
    OrganInstrument: SynthInstrumentsModule.OrganInstrument,
    VibraphoneInstrument: SynthInstrumentsModule.VibraphoneInstrument,
    FMEPianoInstrument: SynthInstrumentsModule.FMEPianoInstrument
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
    // Initialize WASM module (non-blocking)
    try {
        const wasmLoaded = await initWasm();
        if (wasmLoaded) {
            console.log(`RMT Core WASM v${getWasmVersion()} initialized`);
        } else if (WASM_CONFIG.debug) {
            console.log('WASM not available, using JavaScript fallback');
        }
    } catch (e) {
        console.warn('WASM initialization failed:', e);
    }

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

    // Settings system: initialize the store (loads persisted settings) and wire the
    // top-bar gear. The old "Settings…" entry in the + menu is gone — the gear is
    // always visible, so the menu entry was a second door to the same room.
    try {
        const { settingsStore } = await import('./settings/settings-store.js');
        const { toggleSettingsPanel } = await import('./settings/settings-panel.js');
        // Touch the store so it loads + emits 'settings:loaded' early.
        settingsStore.getAll();

        // Top-bar gear: opens the panel, and a second click closes it again.
        const gearBtn = document.getElementById('settingsGearBtn');
        if (gearBtn) {
            gearBtn.addEventListener('click', () => toggleSettingsPanel());
            // Track the panel's REAL state, so the gear also un-lights when the
            // panel is closed from its own × or with Escape.
            eventBus.on('settings:panelToggled', ({ open }) => {
                gearBtn.classList.toggle('open', !!open);
                gearBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }
    } catch (e) {
        console.error('Failed to initialize settings', e);
    }

    // Perf harness (dev tool): only loaded with ?perf=1 in the URL
    try {
        if (new URLSearchParams(location.search).has('perf')) {
            await import('./dev/perf-harness.js');
        }
    } catch (e) {
        console.warn('perf harness failed to load', e);
    }
    
    // Player is imported at top-level to ensure its DOMContentLoaded handler is registered before firing.

}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

export { Module, Note, InstrumentManager, Fraction };