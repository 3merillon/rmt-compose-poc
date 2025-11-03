import { eventBus } from '../utils/event-bus.js';

class HistoryManager {
  constructor(maxSize = 50) {
    this._maxSize = maxSize;
    this._undo = [];
    this._redo = [];
    this._isRestoring = false;
  }

  maxSize() { return this._maxSize; }
  setMaxSize(n) { this._maxSize = Math.max(1, Number(n) || 50); }

  canUndo() { return this._undo.length > 1; }
  canRedo() { return this._redo.length > 0; }

  size() {
    return {
      undo: this._undo.length,
      redo: this._redo.length
    };
  }

  clear() {
    this._undo.length = 0;
    this._redo.length = 0;
    this._emitStackChanged();
  }

  capture({ label = 'Change', snapshot }) {
    // Ignore invalid input or captures triggered during restore
    if (this._isRestoring) return;
    if (!snapshot) return;

    // Never record "Initial" as a regular capture (only allowed via seedIfEmpty)
    const normalized = String(label || '').trim().toLowerCase();
    if (normalized === 'initial') return;

    // Push snapshot to undo stack
    this._undo.push({
      label: String(label || 'Change'),
      snapshot: this._deepClone(snapshot)
    });

    // Enforce cap (drop oldest)
    while (this._undo.length > this._maxSize) {
      this._undo.shift();
    }

    // Any new capture invalidates/clears the redo stack
    if (this._redo.length) {
      this._redo.length = 0;
    }

    this._emitStackChanged();
  }

  undo() {
    if (!this.canUndo()) return;

    // Move current (top) to redo, restore to previous
    const current = this._undo.pop();
    this._redo.push(current);

    const prev = this._undo[this._undo.length - 1];
    if (!prev) return;

    this._isRestoring = true;
    try {
      eventBus.emit('history:requestRestore', {
        snapshot: this._deepClone(prev.snapshot),
        source: 'undo',
        label: current.label
      });
    } finally {
      this._isRestoring = false;
      this._emitStackChanged();
    }
  }

  redo() {
    if (!this.canRedo()) return;

    const next = this._redo.pop();
    if (!next) return;

    // Pushing onto undo to make it the new "current"
    this._undo.push(next);

    this._isRestoring = true;
    try {
      eventBus.emit('history:requestRestore', {
        snapshot: this._deepClone(next.snapshot),
        source: 'redo',
        label: next.label
      });
    } finally {
      this._isRestoring = false;
      this._emitStackChanged();
    }
  }

  seedIfEmpty({ label = 'Initial', snapshot }) {
    if (this._undo.length === 0 && snapshot) {
      this._undo.push({
        label: String(label || 'Initial'),
        snapshot: this._deepClone(snapshot)
      });
      this._emitStackChanged();
    }
  }

  _emitStackChanged() {
    try {
      eventBus.emit('history:stackChanged', {
        undo: this._undo.length,
        redo: this._redo.length,
        canUndo: this.canUndo(),
        canRedo: this.canRedo()
      });
    } catch (e) {
      // no-op
    }
  }

  _deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      // Fallback shallow if something unusual is passed
      return obj;
    }
  }
}

// Shared singleton
export const history = new HistoryManager();

// EventBus wiring for decoupled integration
try {
  eventBus.on('history:capture', (payload) => {
    try {
      // Accept either (label, snapshot) or just { snapshot } with default label
      if (!payload || !payload.snapshot) return;
      const label = payload.label || 'Change';
      history.capture({ label, snapshot: payload.snapshot });
    } catch (e) {
      // ignore
    }
  });

  eventBus.on('history:seedIfEmpty', (payload) => {
    try {
      if (!payload || !payload.snapshot) return;
      const label = payload.label || 'Initial';
      history.seedIfEmpty({ label, snapshot: payload.snapshot });
    } catch (e) {
      // ignore
    }
  });

  eventBus.on('history:undo', () => {
    try { history.undo(); } catch {}
  });

  eventBus.on('history:redo', () => {
    try { history.redo(); } catch {}
  });
} catch {
  // if eventBus not ready yet, consumer can import { history } and operate directly
}