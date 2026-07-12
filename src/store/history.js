import { eventBus } from '../utils/event-bus.js';

class HistoryManager {
  constructor(maxSize = 50) {
    this._maxSize = maxSize;
    // Hard cap on total retained snapshot bytes (Phase 8). Snapshots are stored as
    // minified JSON STRINGS (see capture()), which are ~3-5x more heap-compact than
    // the old parsed object graphs; this bound stops a very large module (e.g. 1000
    // notes ~130KB/snapshot) from growing the undo stack without limit.
    this._maxBytes = 12 * 1024 * 1024; // 12 MB
    this._undo = [];
    this._redo = [];
    this._isRestoring = false;
  }

  // Serialize a snapshot object to a minified JSON string (with fallback).
  _serialize(obj) {
    if (typeof obj === 'string') return obj;
    try { return JSON.stringify(obj); } catch { return null; }
  }
  // Parse a stored snapshot string back to a fresh object (each restore gets its own
  // copy => same isolation the old deep-clone provided). Tolerates a raw object too.
  _deserialize(str) {
    if (str && typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return null; }
  }

  // Enforce the count cap and the byte cap (drop oldest). Keeps >=2 entries so undo
  // stays possible even when a single snapshot is very large.
  _enforceCaps() {
    while (this._undo.length > this._maxSize) this._undo.shift();
    let bytes = 0;
    for (const e of this._undo) bytes += (e.snapshot ? e.snapshot.length : 0);
    while (this._undo.length > 2 && bytes > this._maxBytes) {
      const dropped = this._undo.shift();
      bytes -= (dropped && dropped.snapshot ? dropped.snapshot.length : 0);
    }
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

  capture({ label = 'Change', snapshot, snapshotStr }) {
    // Ignore invalid input or captures triggered during restore
    if (this._isRestoring) return;
    if (snapshot == null && snapshotStr == null) return;

    // Never record "Initial" as a regular capture (only allowed via seedIfEmpty)
    const normalized = String(label || '').trim().toLowerCase();
    if (normalized === 'initial') return;

    // Store the snapshot as a minified JSON STRING. Callers may pass a pre-serialized
    // `snapshotStr` (Phase 8 dedupe: captureSnapshot serializes once and shares it with
    // the localStorage autosave) to avoid a second JSON.stringify here.
    const str = (typeof snapshotStr === 'string') ? snapshotStr : this._serialize(snapshot);
    if (str == null) return;

    this._undo.push({ label: String(label || 'Change'), snapshot: str });
    this._enforceCaps();

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
        snapshot: this._deserialize(prev.snapshot),
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
        snapshot: this._deserialize(next.snapshot),
        source: 'redo',
        label: next.label
      });
    } finally {
      this._isRestoring = false;
      this._emitStackChanged();
    }
  }

  seedIfEmpty({ label = 'Initial', snapshot, snapshotStr }) {
    if (this._undo.length === 0 && (snapshot != null || snapshotStr != null)) {
      const str = (typeof snapshotStr === 'string') ? snapshotStr : this._serialize(snapshot);
      if (str == null) return;
      this._undo.push({ label: String(label || 'Initial'), snapshot: str });
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
      // Accept either (label, snapshot) or just { snapshot } with default label.
      // snapshotStr (pre-serialized) is optional and preferred when present (dedupe).
      if (!payload || (payload.snapshot == null && payload.snapshotStr == null)) return;
      const label = payload.label || 'Change';
      history.capture({ label, snapshot: payload.snapshot, snapshotStr: payload.snapshotStr });
    } catch (e) {
      // ignore
    }
  });

  eventBus.on('history:seedIfEmpty', (payload) => {
    try {
      if (!payload || (payload.snapshot == null && payload.snapshotStr == null)) return;
      const label = payload.label || 'Initial';
      history.seedIfEmpty({ label, snapshot: payload.snapshot, snapshotStr: payload.snapshotStr });
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