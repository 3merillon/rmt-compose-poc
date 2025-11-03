// Centralized app state to retire window.* globals
import { audioEngine } from '../player/audio-engine.js';

let moduleRef = null;
let evaluatedNotesRef = null;

export function setModule(moduleInstance) { moduleRef = moduleInstance; }
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