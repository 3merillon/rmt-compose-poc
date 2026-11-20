/**
 * Evaluator Adapter
 *
 * Provides a unified interface for binary expression evaluation,
 * using WASM when available and falling back to JavaScript.
 */

import Fraction from 'fraction.js';
import { getWasm, isWasmAvailable } from './index.js';
import { WASM_CONFIG, shouldUseWasm } from './config.js';
import { VAR_NAMES } from '../binary-note.js';
import { getVariableExpression } from '../variable-deps.js';
import { BinaryEvaluator as JSBinaryEvaluator, IncrementalEvaluator as JSIncrementalEvaluator } from '../binary-evaluator.js';

// Dev/A-B override: ?evaluator=js forces the JS path (and disables the
// WASM hot-swap in module.js, since createEvaluator keeps returning JS).
// ?evaluator=wasm opts in to the async evaluator hot-swap (P1) — kept
// opt-in until the WASM wrapper's in-browser behavior is fully verified,
// because the wrapper had never actually run in production before the
// hot-swap existed (module creation always won the race against WASM init).
const EVALUATOR_PARAM = (() => {
  try {
    return typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('evaluator')
      : null;
  } catch {
    return null;
  }
})();

const FORCE_JS_EVALUATOR = EVALUATOR_PARAM === 'js';

// The evaluated variables in bytecode index order. Taken from VAR_NAMES so
// that a variable added there is registered with, and read back from, the
// Rust core without another list to keep in step.
const VARIABLE_NAMES = [];
for (let index = 0; VAR_NAMES[index] !== undefined; index++) {
  VARIABLE_NAMES.push(VAR_NAMES[index]);
}

// What PersistentEvaluator.readNote() says about one value (rust/src/evaluator.rs)
const KIND_SMALL = 1;      // exact: signed numerator, denominator
const KIND_BIG = 2;        // exact, too large for a number: readBigValue()
const KIND_IRRATIONAL = 3; // the float, then its magnitude times 1,000,000

// What this adapter calls on the Rust core. A binary built before one of
// these existed must not be used: it would order whole notes.
const REQUIRED_CORE_METHODS = [
  'registerNotes', 'removeNote', 'invalidateAll', 'evaluateDirty',
  'takeCycles', 'takeUnresolved', 'takeFailures', 'takeDivisionsByZero',
  'hasCachedNote', 'readNote', 'readBigValue',
];

/**
 * A fraction.js value from a numerator and denominator the Rust core has
 * already reduced to lowest terms. The Fraction constructor would reduce them
 * again, and for the long fractions of a comma chain that gcd costs more than
 * the evaluation did. (FractionPool in binary-evaluator.js fills its
 * instances the same way.)
 *
 * @param {bigint} numerator - Signed
 * @param {bigint} denominator - Positive
 * @returns {Fraction}
 */
function reducedFraction(numerator, denominator) {
  const fraction = new Fraction(0); // s = 1n, n = 0n, d = 1n
  if (numerator < 0n) {
    fraction.s = -1n;
    fraction.n = -numerator;
  } else {
    fraction.n = numerator;
  }
  fraction.d = denominator;
  return fraction;
}

/**
 * Whether module.js should hot-swap to the WASM evaluator when WASM
 * finishes initializing. Currently opt-in (?evaluator=wasm); headless
 * (Node) environments allow it so tests can exercise the swap.
 */
export function isEvaluatorHotSwapEnabled() {
  if (FORCE_JS_EVALUATOR) return false;
  if (typeof window === 'undefined') return true; // headless tests/benches
  return EVALUATOR_PARAM === 'wasm';
}

/**
 * Check whether an evaluator instance is WASM-backed
 * @param {Object} evaluator
 * @returns {boolean}
 */
export function isWasmBackedEvaluator(evaluator) {
  return evaluator instanceof WasmPersistentEvaluatorWrapper;
}

/**
 * Create a binary evaluator using the appropriate implementation
 * @param {Object} module - The module to evaluate
 * @returns {Object} Evaluator instance
 */
export function createEvaluator(module) {
  if (!FORCE_JS_EVALUATOR && shouldUseWasm('evaluator') && isWasmAvailable()) {
    try {
      return new WasmPersistentEvaluatorWrapper(getWasm(), module);
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        console.warn('WASM evaluator unusable, using the JavaScript evaluator:', e.message || e);
        return new JSBinaryEvaluator(module);
      }
      throw e;
    }
  }
  return new JSBinaryEvaluator(module);
}

/**
 * Create an incremental evaluator
 * @param {Object} module - The module
 * @param {Object} dependencyGraph - The dependency graph
 * @param {Object} evaluator - The base evaluator
 * @returns {Object} Incremental evaluator instance
 */
export function createIncrementalEvaluator(module, dependencyGraph, evaluator) {
  if (evaluator instanceof WasmPersistentEvaluatorWrapper) {
    return new WasmIncrementalEvaluator(module, dependencyGraph, evaluator);
  }
  return new JSIncrementalEvaluator(module, dependencyGraph, evaluator);
}

// ============================================================================
// WasmIncrementalEvaluator - dirty tracking in JS, evaluation in one WASM call
// ============================================================================

/**
 * Lazy cache proxy that reads from WASM on-demand
 * Implements Map-like interface for compatibility with existing code
 */
class LazyWasmCacheProxy {
  constructor(evaluatorWrapper) {
    this._evaluator = evaluatorWrapper;
    this._localCache = new Map();
  }

  get(noteId) {
    // Check local cache first (for values fetched this cycle)
    if (this._localCache.has(noteId)) {
      return this._localCache.get(noteId);
    }

    // Fetch from WASM
    const result = this._evaluator.getEvaluatedNote(noteId);
    if (result) {
      this._localCache.set(noteId, result);
    }
    return result;
  }

  set(noteId, value) {
    // Store locally - WASM cache is the source of truth
    this._localCache.set(noteId, value);
  }

  has(noteId) {
    return this._localCache.has(noteId) || this._evaluator.hasCachedNote(noteId);
  }

  /**
   * Drop a note's values. Module.removeNote() calls this when a note is gone,
   * so WASM has to forget the note as well: left registered, whatever still
   * references it would go on reading its last values instead of defaults.
   */
  delete(noteId) {
    this._localCache.delete(noteId);
    this._evaluator.removeNote(Number(noteId));
  }

  clear() {
    this._localCache.clear();
  }

  get size() {
    // Return WASM cache size
    return this._evaluator.evaluator.cacheSize || 0;
  }

  *entries() {
    // Yield cached entries - note: this only yields what's been accessed
    // Full iteration would require getting all IDs from WASM
    for (const [key, value] of this._localCache) {
      yield [key, value];
    }
  }

  *keys() {
    for (const key of this._localCache.keys()) {
      yield key;
    }
  }

  *values() {
    for (const value of this._localCache.values()) {
      yield value;
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

/**
 * Incremental evaluator backed by the Rust core.
 *
 * Which notes are dirty is tracked here, exactly as JSIncrementalEvaluator
 * does. Everything else happens in one WASM call per batch: the core orders
 * the batch per (note, variable), evaluates it, and says what it could not
 * get right (rust/src/evaluator.rs, the twin of
 * BinaryEvaluator.evaluateVariables()).
 */
class WasmIncrementalEvaluator {
  constructor(module, dependencyGraph, evaluator) {
    this.module = module;
    this.graph = dependencyGraph;
    this.evaluator = evaluator; // WasmPersistentEvaluatorWrapper

    // Set of dirty note IDs needing re-evaluation
    this.dirty = new Set();

    // Lazy cache proxy for WASM cache access
    this.cache = new LazyWasmCacheProxy(evaluator);

    // Generation counter
    this.generation = 0;
  }

  setModule(module) {
    this.module = module;
    this.evaluator.setModule(module);
    this.invalidateAll();
  }

  /**
   * Invalidate a note whose bytecode may have changed: it is registered
   * again before the next evaluation, and everything that reads it, also
   * through the BaseNote, is re-evaluated with it.
   *
   * @param {number} noteId
   * @param {Set<number>} [dependents] - graph.getEvaluationDependents(noteId),
   *   when the caller has already computed it
   */
  invalidate(noteId, dependents = null) {
    this.dirty.add(noteId);
    this.evaluator.unregisterNote(noteId);

    // Dependents keep their registration: their bytecode is unchanged
    for (const dep of dependents || this.graph.getEvaluationDependents(noteId)) {
      this.dirty.add(dep);
    }

    this.generation++;
  }

  /**
   * Mark a note as dirty WITHOUT unregistering it.
   * Use for dependents whose values changed but bytecode didn't.
   */
  markDirtyOnly(noteId) {
    this.dirty.add(noteId);
  }

  invalidateAll() {
    this.evaluator.invalidateAll();
    this.cache.clear();
    this.dirty.clear();
    this.generation++;

    // Mark all notes dirty
    if (this.module.notes instanceof Map) {
      for (const [id] of this.module.notes) {
        this.dirty.add(id);
      }
    } else {
      for (const id of Object.keys(this.module.notes)) {
        this.dirty.add(Number(id));
      }
    }
  }

  /**
   * Evaluate all dirty notes, one variable at a time, in dependency order
   * @returns {LazyWasmCacheProxy} Cache (Map-like interface)
   */
  evaluateDirty() {
    if (this.dirty.size === 0) {
      return this.cache;
    }

    // Ascending ids, as the JS evaluator walks them. The core sorts again;
    // doing it here keeps the registration order fixed as well.
    const ids = Uint32Array.from(this.dirty).sort();

    // A dirty id without a note is a note that was deleted: WASM forgets it.
    // A note whose bytecode is new or changed is registered first.
    const unregistered = [];
    let count = 0;
    for (let i = 0; i < ids.length; i++) {
      const noteId = ids[i];
      const note = this.module.getNoteById(noteId);
      if (!note) {
        this.evaluator.removeNote(noteId);
        continue;
      }
      if (!this.evaluator.isRegistered(noteId)) {
        unregistered.push(note);
      }
      ids[count++] = noteId;
    }
    this.evaluator.registerNotes(unregistered);

    // Only the notes of the batch change; every other record stays as it is
    const batch = ids.subarray(0, count);
    for (let i = 0; i < count; i++) {
      this.cache._localCache.delete(batch[i]);
    }

    // SINGLE WASM CALL - orders and evaluates the whole batch
    this.evaluator.evaluateDirty(batch);

    this.dirty.clear();
    return this.cache;
  }

  getEvaluatedNote(noteId) {
    return this.cache.get(noteId);
  }

  isCacheValid() {
    return this.dirty.size === 0;
  }
}

// ============================================================================
// WasmPersistentEvaluatorWrapper - notes and values live in WASM memory
// ============================================================================

/**
 * Wrapper around the Rust PersistentEvaluator.
 *
 * Compiled expressions go to WASM once per note; evaluated values stay there
 * and are converted to fraction.js objects only for the notes someone reads.
 */
class WasmPersistentEvaluatorWrapper {
  constructor(wasm, module) {
    const core = wasm.PersistentEvaluator;
    if (!core || REQUIRED_CORE_METHODS.some((name) => typeof core.prototype[name] !== 'function')) {
      throw new Error('src/wasm/rmt_core_bg.wasm is older than its adapter (run `npm run wasm:build`)');
    }

    this.wasm = wasm;
    this.module = module;
    this.evaluator = new core();
    this.generation = 0;

    // fraction.js records of the notes read so far (lazy conversion from WASM)
    this._jsCache = new Map();

    // Track which notes have been registered
    this._registeredNotes = new Set();

    // Scratch buffer for registerNotes()
    this._packed = new Uint8Array(4096);

    // A JS evaluator, created when there is first something to report
    this._reporter = null;
  }

  setModule(module) {
    this.module = module;
    this.invalidateAll();
  }

  invalidateAll() {
    this.evaluator.invalidateAll();
    this._jsCache.clear();
    this._registeredNotes.clear();
    this.generation++;
  }

  /**
   * Hand the compiled expressions of some notes to WASM, in one call.
   * Registering a note again replaces all of its expressions.
   * @param {Array<Object>} notes
   */
  registerNotes(notes) {
    if (notes.length === 0) return;

    // Per note: u32 id, u8 expression count, then per expression
    // u8 variable index, u32 length, bytecode (integers little-endian)
    let packed = this._packed;
    let view = new DataView(packed.buffer);
    let at = 0;
    const reserve = (size) => {
      if (at + size <= packed.length) return;
      const grown = new Uint8Array(Math.max(packed.length * 2, at + size));
      grown.set(packed.subarray(0, at));
      packed = this._packed = grown;
      view = new DataView(packed.buffer);
    };

    for (const note of notes) {
      reserve(5);
      view.setUint32(at, note.id, true);
      const countAt = at + 4;
      at += 5;

      let count = 0;
      for (let varIndex = 0; varIndex < VARIABLE_NAMES.length; varIndex++) {
        const expr = getVariableExpression(note, varIndex);
        if (expr === null) continue;
        reserve(5 + expr.length);
        packed[at] = varIndex;
        view.setUint32(at + 1, expr.length, true);
        packed.set(expr.bytecode.subarray(0, expr.length), at + 5);
        at += 5 + expr.length;
        count++;
      }
      packed[countAt] = count;
    }

    this.evaluator.registerNotes(packed.subarray(0, at));
    for (const note of notes) {
      this._registeredNotes.add(note.id);
      this._jsCache.delete(note.id);
    }
  }

  /**
   * Register one note
   * @param {Object} note
   */
  registerNote(note) {
    if (!note || note.id == null) return;
    this.registerNotes([note]);
  }

  /**
   * Check if a note has been registered
   * @param {number} noteId - The note ID
   * @returns {boolean}
   */
  isRegistered(noteId) {
    return this._registeredNotes.has(noteId);
  }

  /**
   * Unregister a note (force re-registration on next evaluateDirty)
   * Call this when a note's bytecode has changed.
   * @param {number} noteId - The note ID
   */
  unregisterNote(noteId) {
    this._registeredNotes.delete(noteId);
  }

  /**
   * Forget a note that no longer exists: its expressions and its values
   * @param {number} noteId - The note ID
   */
  removeNote(noteId) {
    this.evaluator.removeNote(noteId);
    this._registeredNotes.delete(noteId);
    this._jsCache.delete(noteId);
  }

  /**
   * Evaluate a batch of registered notes in a single WASM call, each
   * variable after the variables it reads, and report what went wrong.
   * @param {Uint32Array|Array<number>} noteIds
   * @returns {number} Number of notes evaluated
   */
  evaluateDirty(noteIds) {
    const ids = noteIds instanceof Uint32Array ? noteIds : new Uint32Array(noteIds);
    const count = this.evaluator.evaluateDirty(ids);
    this.generation++;

    // The notes of the batch have new values; nothing else changed
    for (let i = 0; i < ids.length; i++) {
      this._jsCache.delete(ids[i]);
    }

    if (this.evaluator.hasProblems) {
      this._reportProblems();
    }
    return count;
  }

  /**
   * Report what the last evaluation could not get right, in the words of the
   * JS evaluator: true dependency cycles and references that fell back to a
   * hard-coded default are console errors naming every variable involved.
   */
  _reportProblems() {
    const core = this.evaluator;

    const failures = core.takeFailures();
    if (failures !== '') {
      for (const line of failures.split('\n')) {
        const tab = line.indexOf('\t');
        const variable = Number(line.slice(0, tab));
        console.warn(`Failed to evaluate ${VAR_NAMES[variable & 7]} for note ${variable >> 3}:`, line.slice(tab + 1));
      }
    }

    for (let n = core.takeDivisionsByZero(); n > 0; n--) {
      console.warn('Division by zero in binary evaluator, using 1');
    }

    // Each loop arrives as its length followed by its variables
    const packedCycles = core.takeCycles();
    const cycles = [];
    for (let at = 0; at < packedCycles.length; at += 1 + packedCycles[at]) {
      cycles.push(Array.from(packedCycles.subarray(at + 1, at + 1 + packedCycles[at])));
    }
    const unresolved = core.takeUnresolved(); // (reader, reference) pairs

    if (cycles.length > 0 || unresolved.length > 0) {
      // The wording, and the reason given for each unresolved reference,
      // are the JS evaluator's own, so both engines report alike
      const reporter = this._reporter || (this._reporter = new JSBinaryEvaluator(this.module));
      reporter.module = this.module;
      reporter._unresolved = unresolved.length > 0 ? Array.from(unresolved) : null;
      reporter.reportProblems(cycles.length > 0 ? cycles : null);
    }
  }

  /**
   * Check if a note is in the WASM cache
   * @param {number} noteId - The note ID
   * @returns {boolean}
   */
  hasCachedNote(noteId) {
    return this.evaluator.hasCachedNote(noteId);
  }

  /**
   * Get evaluated values for a note (with lazy Fraction.js conversion)
   * @param {number} noteId - The note ID
   * @returns {Object|null} Evaluated values with Fraction.js objects
   */
  getEvaluatedNote(noteId) {
    const cached = this._jsCache.get(noteId);
    if (cached !== undefined) {
      return cached;
    }

    const packed = this.evaluator.readNote(noteId);
    if (packed.length === 0) return null;

    const record = this._toRecord(noteId, packed);
    this._jsCache.set(noteId, record);
    return record;
  }

  /**
   * Evaluate a single note (for compatibility with the JS evaluator's interface)
   * @param {Object} note - The note to evaluate
   * @returns {Object} Evaluated values
   */
  evaluateNote(note) {
    this.registerNote(note);
    this.evaluateDirty([note.id]);
    return this.getEvaluatedNote(note.id);
  }

  /**
   * Evaluate a binary expression (for compatibility)
   * Not available on this evaluator: expressions are evaluated in WASM as
   * part of a note, by evaluateDirty().
   */
  evaluate(expr) {
    if (!expr.isEmpty()) {
      console.warn('WasmPersistentEvaluatorWrapper.evaluate() called - single expressions are not evaluated on the WASM path');
    }
    return new Fraction(0, 1);
  }

  getCachedValue(noteId, varIndex) {
    const cached = this.getEvaluatedNote(noteId);
    if (!cached) return null;
    return cached[VARIABLE_NAMES[varIndex]] || null;
  }

  getPoolStats() {
    return {
      used: this.evaluator.cacheSize,
      total: this.evaluator.cacheSize,
      utilization: '100% (WASM persistent)'
    };
  }

  /**
   * Convert what readNote() returned into the record shape the JS evaluator
   * produces: one fraction.js value (or null) per variable, and the flags.
   *
   * @param {number} noteId
   * @param {Float64Array} packed - The flags, then (kind, a, b) per variable
   * @returns {Object}
   */
  _toRecord(noteId, packed) {
    const record = {};
    for (const name of VARIABLE_NAMES) {
      record[name] = null;
    }
    record.corruptionFlags = packed[0];

    // A core built with fewer variables than this side knows simply leaves the rest null
    const count = Math.min(VARIABLE_NAMES.length, (packed.length - 1) / 3);
    for (let varIndex = 0; varIndex < count; varIndex++) {
      const at = 1 + 3 * varIndex;
      switch (packed[at]) {
        case KIND_SMALL:
          record[VARIABLE_NAMES[varIndex]] = reducedFraction(BigInt(packed[at + 1]), BigInt(packed[at + 2]));
          break;

        case KIND_BIG: {
          // Exact at any size: the digits cross the boundary as text,
          // `-1f/a0`, hexadecimal with the sign on the numerator
          const text = this.evaluator.readBigValue(noteId, varIndex);
          const negative = text.charCodeAt(0) === 45;
          const slash = text.indexOf('/');
          const magnitude = BigInt('0x' + text.slice(negative ? 1 : 0, slash));
          record[VARIABLE_NAMES[varIndex]] = reducedFraction(
            negative ? -magnitude : magnitude,
            BigInt('0x' + text.slice(slash + 1))
          );
          break;
        }

        case KIND_IRRATIONAL: {
          // A fraction to six decimals for whatever reads valueOf(); the
          // float itself rides along for playback and display
          const float = packed[at + 1];
          const value = new Fraction(BigInt(packed[at + 2]) * (float < 0 ? -1n : 1n), 1000000n);
          value._irrational = true;
          value._floatValue = float;
          record[VARIABLE_NAMES[varIndex]] = value;
          break;
        }
      }
    }

    return record;
  }
}

// Re-export JS implementations for direct use
export { JSBinaryEvaluator as BinaryEvaluator, JSIncrementalEvaluator as IncrementalEvaluator };
