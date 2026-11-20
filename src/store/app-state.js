// Centralized app state to retire window.* globals
import { audioEngine } from '../player/audio-engine.js';
import { eventBus } from '../utils/event-bus.js';
import { initWasm } from '../wasm/index.js';

// Eagerly initialize WASM for faster first-play performance
initWasm().catch(() => {
  // Silently fail - JS fallback will be used
});

let moduleRef = null;
let evaluatedNotesRef = null;

export function setModule(moduleInstance, { skipBackgroundEval = false } = {}) {
  moduleRef = moduleInstance;
  // Settings > Audio > Loop shows the module's own repeat: tell it the module changed.
  try { eventBus.emit('module:repeatChanged', { repeat: moduleInstance?.baseNote?.properties?.repeat || null }); } catch {}
  // Pre-evaluate module in the background to avoid delay on first play
  // Skip when caller will immediately evaluate synchronously (undo/redo/load)
  if (!skipBackgroundEval && moduleInstance && typeof moduleInstance.evaluateModule === 'function') {
    // Use requestIdleCallback to evaluate during idle time, or setTimeout as fallback
    const scheduleEvaluation = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
    scheduleEvaluation(() => {
      try {
        moduleInstance.evaluateModule();
      } catch (e) {
        // Silently ignore - evaluation will happen on-demand if this fails
      }
    });
  }
}
export function getModule() { return moduleRef; }

export function setEvaluatedNotes(notes) { evaluatedNotesRef = notes; }
export function getEvaluatedNotes() { return evaluatedNotesRef; }

export function getInstrumentManager() {
  try {
    return audioEngine.nodes().instrumentManager;
  } catch {
    return undefined;
  }
}