import type { Module } from '../module.ts';
import type { EvaluationCache } from '../model-types.ts';
// Centralized app state to retire window.* globals
import { audioEngine } from '../player/audio-engine.ts';
import { eventBus } from '../utils/event-bus.ts';

let moduleRef: Module | null = null;
let evaluatedNotesRef: EvaluationCache | null = null;

export function setModule(moduleInstance: Module | null, { skipBackgroundEval = false } = {}) {
  moduleRef = moduleInstance;
  // Settings > Audio > Loop shows the module's own repeat: tell it the module changed.
  try { eventBus.emit('module:repeatChanged', { repeat: moduleInstance?.baseNote?.properties?.repeat || null }); } catch {}
  // Pre-evaluate module in the background to avoid delay on first play
  // Skip when caller will immediately evaluate synchronously (undo/redo/load)
  if (!skipBackgroundEval && moduleInstance && typeof moduleInstance.evaluateModule === 'function') {
    // Use requestIdleCallback to evaluate during idle time, or setTimeout as fallback
    const scheduleEvaluation = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 0));
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

export function setEvaluatedNotes(notes: EvaluationCache | null) { evaluatedNotesRef = notes; }
export function getEvaluatedNotes() { return evaluatedNotesRef; }

export function getInstrumentManager() {
  try {
    return audioEngine.nodes().instrumentManager;
  } catch {
    return undefined;
  }
}