import type { HistoryCapture } from '../utils/event-bus.ts';
import type { Module } from '../module.ts';
interface HistoryEntry { label: string; version?: PagedSnapshot; snapshot: string }
import { eventBus } from '../utils/event-bus.ts';
import { PagedSnapshot } from './snapshot-pages.ts';

// The string supplied to autosave can become a flat, score-sized allocation.
// Keep only the page version in history and assemble text for a full restore.
function pagedEntry(label: string, version: PagedSnapshot) {
  return { label, version, get snapshot() { return this.version.text; } };
}

class HistoryManager {
  declare _maxSize: number;
  declare _maxBytes: number;
  declare _undo: HistoryEntry[];
  declare _redo: HistoryEntry[];
  declare _isRestoring: boolean;

  constructor(maxSize = 50) {
    this._maxSize = maxSize;
    // Budget history beyond the current paged checkpoint. Standalone strings
    // still use the original serialized-length budget.
    this._maxBytes = 12 * 1024 * 1024; // 12 MB
    this._undo = [];
    this._redo = [];
    this._isRestoring = false;
  }

  // Serialize a snapshot object to a minified JSON string (with fallback).
  _serialize(obj: unknown): string | null | undefined {
    if (typeof obj === 'string') return obj;
    try { return JSON.stringify(obj); } catch (e) {
      // A snapshot that cannot be stringified (e.g. a BigInt or Fraction leaked
      // into the payload) means undo capture is being dropped — say so loudly.
      console.error('[history] snapshot serialization failed; undo capture dropped:', e);
      return null;
    }
  }
  // Parse a stored snapshot string back to a fresh object (each restore gets its own
  // copy => same isolation the old deep-clone provided). Tolerates a raw object too.
  _deserialize(str: string | object): unknown {
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return null; }
  }

  _entry(label: string, snapshot: unknown, snapshotStr: string | undefined, version?: PagedSnapshot): HistoryEntry | null {
    if (version instanceof PagedSnapshot) return pagedEntry(label, version);
    const text = typeof snapshotStr === 'string' ? snapshotStr : this._serialize(snapshot);
    return text == null ? null : { label, version, snapshot: text };
  }

  // Called on a new capture after dropping any redo branch. Undo and redo only
  // move entries between stacks; neither operation allocates historical pages.
  _enforceCaps() {
    const entries = this._undo;
    while (entries.length > this._maxSize) entries.shift();
    if (entries.length <= 2) return;
    const versions = new Set<PagedSnapshot>();
    const pages = new Set<object>();
    let bytes = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const v = entry.version;
      if (!(v instanceof PagedSnapshot)) {
        bytes += entry.snapshot.length;
      } else if (!versions.has(v)) {
        versions.add(v);
        // A directory per version, one copy of each distinct page. Allow for
        // Map slots, up to two bytes per code unit, and the packed row offsets.
        let cost = 32 * v.pages.size + 2 * (v.baseText.length + (v.ruleText?.length || 0));
        for (const page of v.pages.values()) {
          if (pages.has(page)) continue;
          pages.add(page);
          cost += 2 * page.text.length + page.ends.byteLength;
        }
        if (i !== entries.length - 1) bytes += cost;
      }
      if (bytes > this._maxBytes && i < entries.length - 2) {
        entries.splice(0, i + 1);
        break;
      }
    }
  }

  maxSize() { return this._maxSize; }
  setMaxSize(n: number) { this._maxSize = Math.max(1, Number(n) || 50); }

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

  capture({ label = 'Change', snapshot, snapshotStr, version }: HistoryCapture) {
    // Ignore invalid input or captures triggered during restore
    if (this._isRestoring) return;
    if (snapshot == null && snapshotStr == null) return;

    // Never record "Initial" as a regular capture (only allowed via seedIfEmpty)
    const normalized = String(label || '').trim().toLowerCase();
    if (normalized === 'initial') return;

    const entry = this._entry(String(label || 'Change'), snapshot, snapshotStr, version);
    if (!entry) return;
    this._redo.length = 0;
    this._undo.push(entry);
    this._enforceCaps();

    this._emitStackChanged();
  }

  undo() {
    if (!this.canUndo()) return;

    // Move current (top) to redo, restore to previous
    const current = this._undo.pop()!;
    this._redo.push(current);

    const prev = this._undo[this._undo.length - 1];
    if (!prev) return;
    let parsed: unknown;
    const deserialize = () => this._deserialize(prev.snapshot);

    this._isRestoring = true;
    try {
      eventBus.emit('history:requestRestore', {
        version: prev.version,
        get snapshot() { return parsed ??= deserialize(); },
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
    let parsed: unknown;
    const deserialize = () => this._deserialize(next.snapshot);

    this._isRestoring = true;
    try {
      eventBus.emit('history:requestRestore', {
        version: next.version,
        get snapshot() { return parsed ??= deserialize(); },
        source: 'redo',
        label: next.label
      });
    } finally {
      this._isRestoring = false;
      this._emitStackChanged();
    }
  }

  seedIfEmpty({ label = 'Initial', snapshot, snapshotStr, version }: HistoryCapture) {
    if (this._undo.length === 0 && (snapshot != null || snapshotStr != null)) {
      const entry = this._entry(String(label || 'Initial'), snapshot, snapshotStr, version);
      if (!entry) return;
      this._undo.push(entry);
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

  _deepClone(obj: unknown): unknown {
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

/**
 * The module for a history:capture / history:seedIfEmpty payload: its JSON text
 * as { snapshotStr } (Module.createModuleJSONString, the same text the history
 * and the autosave would make from the object, without serializing every note
 * again). Should that fail, the object as { snapshot }, so that the history and
 * the autosave report the failure as they always have.
 */
export function moduleSnapshot(module: Pick<Module, 'createModuleJSON'> & Partial<Pick<Module, 'historySnapshot' | 'createModuleJSONString'>>, tracked: boolean | number[] = false): HistoryCapture {
  try {
    if (typeof module?.historySnapshot === 'function') return module.historySnapshot(tracked);
    if (module && typeof module.createModuleJSONString === 'function') {
      return { snapshotStr: module.createModuleJSONString() };
    }
  } catch {}
  return { snapshot: module.createModuleJSON() };
}

// EventBus wiring for decoupled integration
try {
  eventBus.on('history:capture', (payload) => {
    try {
      // Accept either (label, snapshot) or just { snapshot } with default label.
      // snapshotStr (pre-serialized) is optional and preferred when present (dedupe).
      if (!payload || (payload.snapshot == null && payload.snapshotStr == null)) return;
      const label = payload.label || 'Change';
      history.capture({ label, snapshot: payload.snapshot, snapshotStr: payload.snapshotStr, version: payload.version });
    } catch (e) {
      // ignore
    }
  });

  eventBus.on('history:seedIfEmpty', (payload) => {
    try {
      if (!payload || (payload.snapshot == null && payload.snapshotStr == null)) return;
      const label = payload.label || 'Initial';
      history.seedIfEmpty({ label, snapshot: payload.snapshot, snapshotStr: payload.snapshotStr, version: payload.version });
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
