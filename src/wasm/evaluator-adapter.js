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
import * as X from '../value/exact.js';

// Dev/A-B override: ?evaluator=js forces the JS path (and disables the
// WASM hot-swap in module.js, since createEvaluator keeps returning JS).
// ?evaluator=wasm opts in to the async evaluator hot-swap (P1) — kept
// opt-in until the WASM wrapper's in-browser behavior is fully verified,
// because the wrapper had never actually run in production before the
// hot-swap existed (module creation always won the race against WASM init).
// In Node (tests, benches) the same choice is the RMT_EVALUATOR environment
// variable.
const IN_BROWSER = typeof window !== 'undefined';
const EVALUATOR_PARAM = (() => {
  try {
    if (typeof location !== 'undefined') {
      return new URLSearchParams(location.search).get('evaluator');
    }
    if (typeof process !== 'undefined' && process.env) {
      return process.env.RMT_EVALUATOR || null;
    }
  } catch {
    // no location, no environment: the default
  }
  return null;
})();

// Whether the Rust core reads the bytecode as the JavaScript evaluator does:
// the same variables (startTime, duration, frequency, amplitude, attack,
// release), the same opcodes, the same exact values (src/value/exact.js).
// scripts/test-wasm-parity.mjs (in npm test) compares the two exactly; set
// this to false to keep the WASM evaluator off everywhere, even when
// ?evaluator=wasm asks for it, should a change to one engine leave the other behind.
const WASM_MATCHES_VARIABLE_LAYOUT = true;

// RMT_EVALUATOR=wasm in Node runs the Rust core even while the flag is false,
// so that the parity test can hold it to the JavaScript evaluator's results
// before the flag is set. The browser always obeys the flag.
const NODE_OPT_IN = !IN_BROWSER && EVALUATOR_PARAM === 'wasm';

const FORCE_JS_EVALUATOR = EVALUATOR_PARAM === 'js' || (!WASM_MATCHES_VARIABLE_LAYOUT && !NODE_OPT_IN);

if (IN_BROWSER && EVALUATOR_PARAM === 'wasm' && !WASM_MATCHES_VARIABLE_LAYOUT) {
  console.warn('[RMT] ?evaluator=wasm ignored: WASM_MATCHES_VARIABLE_LAYOUT is false (src/wasm/evaluator-adapter.js); using the JavaScript evaluator.');
}

// The evaluated variables in bytecode index order. Taken from VAR_NAMES so
// that a variable added there is registered with, and read back from, the
// Rust core without another list to keep in step.
const VARIABLE_NAMES = [];
for (let index = 0; VAR_NAMES[index] !== undefined; index++) {
  VARIABLE_NAMES.push(VAR_NAMES[index]);
}

// What PersistentEvaluator.readNote() says about one value (rust/src/evaluator.rs)
const KIND_SMALL = 1;        // rational: signed numerator, denominator
const KIND_BIG = 2;          // rational too large for numbers: readValueText()
const KIND_IRRATIONAL = 3;   // irrational, exact: readValueText() gives its terms
const KIND_APPROX_SMALL = 4; // approximate: signed numerator, denominator
const KIND_APPROX_BIG = 5;   // approximate, too large for numbers: readValueText()

// What this adapter calls on the Rust core. A binary built before one of
// these existed must not be used: it would order whole notes.
const REQUIRED_CORE_METHODS = [
  'registerNotes', 'removeNote', 'invalidateAll', 'evaluateDirty',
  'takeCycles', 'takeUnresolved', 'takeFailures', 'takeDivisionsByZero',
  'hasCachedNote', 'readNote', 'readNotes', 'readValueText', 'clearValues',
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
  // As fraction.js makes its own results (newFraction): same fields, same order
  const fraction = Object.create(Fraction.prototype);
  if (numerator < 0n) {
    fraction.s = -1n;
    fraction.n = -numerator;
  } else {
    fraction.s = 1n;
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
 * The evaluation cache of the WASM path: a Map of noteId -> record, filled
 * with the records of every batch right after it is evaluated (in one call),
 * so that reading it is a plain Map read and it behaves exactly as the JS
 * evaluator's cache does: the same records, keys, order and size.
 *
 * Only delete() and clear() do more: the Rust core holds the values that
 * evaluation reads, so they must go there as well.
 */
class WasmEvaluationCache extends Map {
  constructor(evaluatorWrapper) {
    super();
    this._evaluator = evaluatorWrapper;
  }

  /**
   * Drop a note's values. Module.removeNote() calls this when a note is gone,
   * so WASM has to forget the note as well: left registered, whatever still
   * references it would go on reading its last values instead of defaults.
   */
  delete(noteId) {
    this._evaluator.removeNote(Number(noteId));
    return super.delete(noteId);
  }

  /** Drop every value, here and in the core (the notes stay registered) */
  clear() {
    this._evaluator.clearValues();
    super.clear();
  }
}

const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const mapClear = Map.prototype.clear;

/**
 * Incremental evaluator backed by the Rust core.
 *
 * Which notes are dirty is tracked here, exactly as JSIncrementalEvaluator
 * does. Everything else happens in one WASM call per batch: the core orders
 * the batch per (note, variable), evaluates it, and says what it could not
 * get right (rust/src/evaluator.rs, the twin of
 * BinaryEvaluator.evaluateVariables()). One more call reads the batch's
 * records into the cache.
 */
class WasmIncrementalEvaluator {
  constructor(module, dependencyGraph, evaluator) {
    this.module = module;
    this.graph = dependencyGraph;
    this.evaluator = evaluator; // WasmPersistentEvaluatorWrapper

    // Set of dirty note IDs needing re-evaluation
    this.dirty = new Set();

    // noteId -> record, as JSIncrementalEvaluator.cache
    this.cache = new WasmEvaluationCache(evaluator);

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
    mapClear.call(this.cache);
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
   * @returns {WasmEvaluationCache} noteId -> record
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
        mapDelete.call(this.cache, noteId);
        continue;
      }
      if (!this.evaluator.isRegistered(noteId)) {
        unregistered.push(note);
      }
      ids[count++] = noteId;
    }
    this.evaluator.registerNotes(unregistered);

    // SINGLE WASM CALL - orders and evaluates the whole batch
    const batch = ids.subarray(0, count);
    this.evaluator.evaluateDirty(batch);

    // Only the notes of the batch change; every other record stays as it is.
    // Map.set keeps a key where it was, as the JS evaluator's cache does.
    this.evaluator.readRecords(batch, (noteId, record) => mapSet.call(this.cache, noteId, record));

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
 * Compiled expressions go to WASM once per note; evaluated values live there,
 * and each batch's records come back as fraction.js values in one call.
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
  }

  /** Forget every value; the notes stay registered */
  clearValues() {
    this.evaluator.clearValues();
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
   * One note's evaluated values, read from WASM
   * @param {number} noteId - The note ID
   * @returns {Object|null} Evaluated values with Fraction.js objects
   */
  getEvaluatedNote(noteId) {
    const packed = this.evaluator.readNote(noteId);
    if (packed.length === 0) return null;
    return this._toRecord(noteId, packed, 0);
  }

  /**
   * The records of several notes, read in one call
   * @param {Uint32Array} noteIds
   * @param {function(number, Object)} put - Receives each note that has a record
   */
  readRecords(noteIds, put) {
    if (noteIds.length === 0) return;
    const packed = this.evaluator.readNotes(noteIds);
    const stride = 2 + 3 * VARIABLE_NAMES.length;
    for (let i = 0, at = 0; i < noteIds.length; i++, at += stride) {
      if (packed[at] >= 0) put(noteIds[i], this._toRecord(noteIds[i], packed, at));
    }
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
   * Convert what readNote() returned into the record the JS evaluator makes
   * (createEvaluationRecord in src/binary-evaluator.js): a fraction.js value
   * (or null) per variable, the flags, and `exact` holding the value of each
   * variable that is not rational, whose field then holds its shadow.
   *
   * @param {number} noteId
   * @param {Float64Array} packed - The two flag sets, then (kind, a, b) per variable
   * @param {number} start - Where the note's record starts in `packed`
   * @returns {Object}
   */
  _toRecord(noteId, packed, start) {
    const record = {
      startTime: null,
      duration: null,
      frequency: null,
      amplitude: null,
      attack: null,
      release: null,
      corruptionFlags: packed[start],
      approxFlags: packed[start + 1],
      exact: null,
    };

    for (let varIndex = 0; varIndex < VARIABLE_NAMES.length; varIndex++) {
      const at = start + 2 + 3 * varIndex;
      const name = VARIABLE_NAMES[varIndex];
      switch (packed[at]) {
        case KIND_SMALL:
          record[name] = reducedFraction(BigInt(packed[at + 1]), BigInt(packed[at + 2]));
          break;

        case KIND_BIG:
          record[name] = fractionFromText(this.evaluator.readValueText(noteId, varIndex));
          break;

        case KIND_IRRATIONAL: {
          const value = irrationalFromText(this.evaluator.readValueText(noteId, varIndex));
          if (record.exact === null) record.exact = {};
          record.exact[name] = value;
          record[name] = X.shadow(value);
          break;
        }

        case KIND_APPROX_SMALL:
        case KIND_APPROX_BIG: {
          const frac = packed[at] === KIND_APPROX_SMALL
            ? reducedFraction(BigInt(packed[at + 1]), BigInt(packed[at + 2]))
            : fractionFromText(this.evaluator.readValueText(noteId, varIndex));
          if (record.exact === null) record.exact = {};
          record.exact[name] = new X.Approx(frac);
          record[name] = reducedFraction(frac.s * frac.n, frac.d);
          break;
        }
      }
    }

    return record;
  }
}

/**
 * A fraction from the core's text: `-1f/a0`, hexadecimal, the sign on the
 * numerator, already in lowest terms.
 * @param {string} text
 * @returns {Fraction}
 */
function fractionFromText(text) {
  const negative = text.charCodeAt(0) === 45; // '-'
  const slash = text.indexOf('/');
  const magnitude = BigInt('0x' + text.slice(negative ? 1 : 0, slash));
  return reducedFraction(negative ? -magnitude : magnitude, BigInt('0x' + text.slice(slash + 1)));
}

/**
 * An irrational value from the core's text (exact::irrational_text): terms
 * separated by `;`, each its coefficient then `*base^exponent` per radical,
 * all hexadecimal. The terms are canonical already, in exact.js's order.
 * @param {string} text
 * @returns {X.Irrational}
 */
function irrationalFromText(text) {
  const terms = [];
  for (const termText of text.split(';')) {
    const parts = termText.split('*');
    const rad = [];
    for (let i = 1; i < parts.length; i++) {
      const caret = parts[i].indexOf('^');
      rad.push([BigInt('0x' + parts[i].slice(0, caret)), fractionFromText(parts[i].slice(caret + 1))]);
    }
    terms.push([fractionFromText(parts[0]), rad]);
  }
  return X.irrationalFromCanonicalTerms(terms);
}

// Re-export JS implementations for direct use
export { JSBinaryEvaluator as BinaryEvaluator, JSIncrementalEvaluator as IncrementalEvaluator };
