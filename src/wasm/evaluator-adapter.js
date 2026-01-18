/**
 * Evaluator Adapter
 *
 * Provides a unified interface for binary expression evaluation,
 * using WASM when available and falling back to JavaScript.
 */

import Fraction from 'fraction.js';
import { getWasm, isWasmAvailable } from './index.js';
import { WASM_CONFIG, shouldUseWasm } from './config.js';
import { BinaryEvaluator as JSBinaryEvaluator, IncrementalEvaluator as JSIncrementalEvaluator } from '../binary-evaluator.js';

/**
 * Create a binary evaluator using the appropriate implementation
 * @param {Object} module - The module to evaluate
 * @returns {Object} Evaluator instance
 */
export function createEvaluator(module) {
  if (shouldUseWasm('evaluator') && isWasmAvailable()) {
    const wasm = getWasm();
    try {
      // Use PersistentEvaluator if available and enabled
      if (WASM_CONFIG.usePersistentCache && wasm.PersistentEvaluator) {
        return new WasmPersistentEvaluatorWrapper(wasm, module);
      }
      return new WasmEvaluatorWrapper(wasm, module);
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM Evaluator creation failed, using JS fallback:', e);
        }
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
  // Use WASM incremental evaluator if the base evaluator is WasmPersistentEvaluatorWrapper
  if (evaluator instanceof WasmPersistentEvaluatorWrapper) {
    return new WasmIncrementalEvaluator(module, dependencyGraph, evaluator);
  }
  // Otherwise use JS incremental evaluator
  return new JSIncrementalEvaluator(module, dependencyGraph, evaluator);
}

/**
 * Wrapper around WASM Evaluator to match JS interface
 */
class WasmEvaluatorWrapper {
  constructor(wasm, module) {
    this.wasm = wasm;
    this.module = module;
    this.evaluator = new wasm.Evaluator();
    this.cache = new Map();
    this.generation = 0;
    // PERFORMANCE: Cache converted eval values to avoid repeated serialization
    this._convertedCache = null;
    this._convertedCacheGeneration = -1;
    this._lastEvalCacheRef = null;
  }

  setModule(module) {
    this.module = module;
    this.invalidateAll();
  }

  invalidateAll() {
    this.cache.clear();
    this.generation++;
    // Invalidate converted cache
    this._convertedCache = null;
    this._convertedCacheGeneration = -1;
    this._lastEvalCacheRef = null;
  }

  invalidate(noteId) {
    this.cache.delete(noteId);
    this.generation++;
    // Invalidate converted cache when any note changes
    this._convertedCache = null;
  }

  beginBatch() {
    // Reset converted cache at start of batch for fresh conversion
    this._convertedCache = null;
    this._lastEvalCacheRef = null;
  }

  /**
   * Evaluate a binary expression
   * @param {Object} expr - BinaryExpression with bytecode
   * @param {Map} evalCache - Pre-evaluated note values
   * @returns {Object} Fraction result
   */
  evaluate(expr, evalCache = null) {
    if (expr.isEmpty()) {
      return this._createFraction(0, 1);
    }

    try {
      // PERFORMANCE: Only convert evalCache once per batch, not per expression
      // Check if we need to rebuild the converted cache
      let cacheObj = this._convertedCache;
      if (!cacheObj || evalCache !== this._lastEvalCacheRef) {
        cacheObj = {};
        if (evalCache) {
          for (const [id, values] of evalCache) {
            const key = String(id);
            cacheObj[key] = this._convertEvalValues(values);
          }
        }
        this._convertedCache = cacheObj;
        this._lastEvalCacheRef = evalCache;
      }

      // PERFORMANCE: Reuse bytecode view instead of slicing (avoids copy)
      // If the expression has a pre-created view, use it; otherwise create one
      let bytecodeView;
      if (expr._wasmView && expr._wasmViewLength === expr.length) {
        bytecodeView = expr._wasmView;
      } else {
        bytecodeView = expr.bytecode.subarray ?
          expr.bytecode.subarray(0, expr.length) :
          expr.bytecode.slice(0, expr.length);
        // Cache for reuse if expression doesn't change
        expr._wasmView = bytecodeView;
        expr._wasmViewLength = expr.length;
      }

      // Call WASM evaluator
      const result = this.evaluator.evaluateExpression(
        bytecodeView,
        expr.length,
        cacheObj
      );

      // Convert result back to fraction.js format
      return this._fractionFromWasm(result);
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM evaluation failed, using default:', e);
        }
        return this._createFraction(0, 1);
      }
      throw e;
    }
  }

  /**
   * Evaluate a note and cache results
   * @param {Object} note - The note to evaluate
   * @param {Map} evalCache - Pre-evaluated dependencies
   * @returns {Object} Evaluated values
   */
  evaluateNote(note, evalCache = null) {
    const result = {
      startTime: null,
      duration: null,
      frequency: null,
      tempo: null,
      beatsPerMeasure: null,
      measureLength: null,
    };

    // PERFORMANCE: Convert evalCache to WASM format ONCE for all expressions in this note
    // This avoids O(N * M) serialization where N = notes and M = expressions per note
    const cacheObj = {};
    if (evalCache) {
      for (const [id, values] of evalCache) {
        const key = String(id);
        cacheObj[key] = this._convertEvalValues(values);
      }
    }
    // Add this note's partial result (updated as we evaluate each expression)
    const noteKey = String(note.id);
    cacheObj[noteKey] = this._convertEvalValues(result);

    // Helper to get expression
    const getExpr = (name) => {
      if (note.expressions && note.expressions[name]) {
        return note.expressions[name];
      }
      if (note[name]) {
        return note[name];
      }
      return null;
    };

    // Direct evaluation without going through this.evaluate() to avoid extra overhead
    const safeEvaluate = (name) => {
      try {
        const expr = getExpr(name);
        if (expr && !expr.isEmpty()) {
          // PERFORMANCE: Use subarray instead of slice when possible
          const bytecodeView = expr.bytecode.subarray ?
            expr.bytecode.subarray(0, expr.length) :
            expr.bytecode.slice(0, expr.length);

          const wasmResult = this.evaluator.evaluateExpression(
            bytecodeView,
            expr.length,
            cacheObj
          );

          // Create a new Fraction for caching
          const value = this._createFraction(
            (wasmResult.s || 1) * (wasmResult.n || 0),
            wasmResult.d || 1
          );
          result[name] = value;

          // Update the converted cache for this note so subsequent expressions can see it
          cacheObj[noteKey] = this._convertEvalValues(result);

          return value;
        }
      } catch (e) {
        if (WASM_CONFIG.debug) {
          console.warn(`Failed to evaluate ${name} for note ${note.id}:`, e);
        }
      }
      return null;
    };

    // Evaluate in dependency order
    result.tempo = safeEvaluate('tempo');
    result.beatsPerMeasure = safeEvaluate('beatsPerMeasure');
    result.frequency = safeEvaluate('frequency');
    result.measureLength = safeEvaluate('measureLength');

    result.startTime = safeEvaluate('startTime');
    result.duration = safeEvaluate('duration');

    // If measureLength wasn't explicitly defined but this is a measure note or base note,
    // compute it from beatsPerMeasure and tempo. This is needed because findMeasureLength()
    // references are compiled as LOAD_REF which looks up measureLength in the cache.
    // Only compute for measure notes (have startTime, no duration/frequency) or base note (id=0)
    // to avoid expensive Fraction operations for regular notes.
    const isMeasureNote = result.startTime && !result.duration && !result.frequency;
    if (!result.measureLength && (isMeasureNote || note.id === 0)) {
      // Get beatsPerMeasure - use this note's value or fall back to base note
      let beats = result.beatsPerMeasure;
      if (!beats && evalCache) {
        const baseCache = evalCache.get(0);
        if (baseCache) beats = baseCache.beatsPerMeasure;
      }
      // Get tempo - use this note's value or fall back to base note
      let tempo = result.tempo;
      if (!tempo && evalCache) {
        const baseCache = evalCache.get(0);
        if (baseCache) tempo = baseCache.tempo;
      }
      // Compute measureLength = beatsPerMeasure / tempo * 60 using fast native math
      const beatsVal = beats ? (typeof beats.valueOf === 'function' ? beats.valueOf() : Number(beats)) : 4;
      const tempoVal = tempo ? (typeof tempo.valueOf === 'function' ? tempo.valueOf() : Number(tempo)) : 60;
      const measureLenVal = (beatsVal / tempoVal) * 60;
      // Store as simple object with s/n/d for compatibility, avoiding Fraction constructor
      result.measureLength = { s: 1, n: Math.round(measureLenVal * 1000000), d: 1000000, valueOf: () => measureLenVal };
    }

    this.cache.set(note.id, result);
    return result;
  }

  getCachedValue(noteId, varIndex) {
    const cached = this.cache.get(noteId);
    if (!cached) return null;

    const varNames = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    return cached[varNames[varIndex]] || null;
  }

  getPoolStats() {
    return { used: 0, total: 0, utilization: 'N/A (WASM)' };
  }

  // Private helper methods

  _createFraction(num, den) {
    // Create a fraction.js compatible object
    return new Fraction(num, den);
  }

  _fractionFromWasm(wasmResult) {
    // wasmResult has { s, n, d } format
    const frac = new Fraction(0);
    frac.s = wasmResult.s || 1;
    frac.n = wasmResult.n || 0;
    frac.d = wasmResult.d || 1;
    return frac;
  }

  _convertEvalValues(values) {
    const result = {};
    for (const [key, val] of Object.entries(values)) {
      if (val != null) {
        // Handle both Fraction objects and plain numbers
        const numVal = typeof val.valueOf === 'function' ? val.valueOf() : Number(val);
        // For Fraction objects, use s/n/d directly; for numbers, compute them
        const hasSnD = typeof val.s === 'number' && typeof val.n === 'number' && typeof val.d === 'number';
        if (hasSnD) {
          result[key] = {
            s: val.s === 0 ? (numVal < 0 ? -1 : 1) : val.s,
            n: val.n,
            d: val.d
          };
        } else {
          // Fallback for plain numbers or malformed fractions
          result[key] = {
            s: numVal < 0 ? -1 : 1,
            n: Math.abs(Math.round(numVal * 1000000)),
            d: 1000000
          };
        }
      }
    }
    return result;
  }
}

// ============================================================================
// WasmIncrementalEvaluator - O(N) batch evaluation with WASM-resident cache
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

  delete(noteId) {
    this._localCache.delete(noteId);
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
 * Incremental evaluator that uses WASM batch evaluation
 *
 * This evaluator registers bytecode once per note, then evaluates
 * all dirty notes in a single WASM call.
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
   * Invalidate a note whose bytecode has changed.
   * Unregisters the note for re-registration and marks dependents dirty.
   */
  invalidate(noteId) {
    this.dirty.add(noteId);

    // Mark this note for re-registration (its bytecode changed)
    this.evaluator.unregisterNote(noteId);

    // Also mark all dependents as dirty (but DON'T unregister - their bytecode is unchanged)
    const dependents = this.graph.getAllDependents(noteId);
    for (const dep of dependents) {
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
   * Evaluate all dirty notes using batch WASM evaluation
   * @returns {Map|LazyWasmCacheProxy} Cache (Map-like interface)
   */
  evaluateDirty() {
    if (this.dirty.size === 0) {
      return this.cache;
    }

    // 1. Register bytecode for any notes not yet registered
    for (const noteId of this.dirty) {
      if (!this.evaluator.isRegistered(noteId)) {
        const note = this.module.getNoteById(noteId);
        if (note) {
          this.evaluator.registerNote(note);
        }
      }
    }

    // 2. Topological sort dirty notes
    const sorted = this.topoSort(this.dirty);

    // 3. Clear stale local cache entries BEFORE WASM evaluation
    // This ensures fresh values will be fetched from WASM
    for (const noteId of this.dirty) {
      this.cache._localCache.delete(noteId);
      // Also clear the wrapper's JS cache to ensure fresh corruptionFlags are read
      this.evaluator._jsCache.delete(noteId);
    }

    // 4. SINGLE WASM CALL - evaluates all dirty notes in order
    this.evaluator.evaluateDirty(sorted);

    // 5. Clear dirty set
    this.dirty.clear();

    return this.cache;
  }

  /**
   * Topological sort using Kahn's algorithm
   * (Same implementation as JSIncrementalEvaluator)
   */
  topoSort(noteIds) {
    const inDegree = new Map();
    const result = [];
    const resultSet = new Set();

    const baseNoteDependents = this.graph.getBaseNoteDependents();
    const hasBaseNote = noteIds.has(0);

    // Calculate in-degrees
    for (const id of noteIds) {
      const deps = this.graph.getDependencies(id);
      let count = 0;
      for (const d of deps) {
        if (noteIds.has(d)) count++;
      }
      if (hasBaseNote && id !== 0 && baseNoteDependents.has(id)) {
        count++;
      }
      inDegree.set(id, count);
    }

    // Start with nodes that have no dependencies
    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    queue.sort((a, b) => a - b);

    // Process queue
    let queueIdx = 0;
    while (queueIdx < queue.length) {
      const id = queue[queueIdx++];
      result.push(id);
      resultSet.add(id);

      const dependents = this.graph.getDependents(id);
      const newZeroDegree = [];
      const newZeroSet = new Set();
      for (const dep of dependents) {
        if (!inDegree.has(dep)) continue;
        const newDeg = inDegree.get(dep) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) {
          newZeroDegree.push(dep);
          newZeroSet.add(dep);
        }
      }

      if (id === 0) {
        for (const dep of baseNoteDependents) {
          if (!inDegree.has(dep)) continue;
          const newDeg = inDegree.get(dep) - 1;
          inDegree.set(dep, newDeg);
          if (newDeg === 0 && !newZeroSet.has(dep)) {
            newZeroDegree.push(dep);
            newZeroSet.add(dep);
          }
        }
      }

      newZeroDegree.sort((a, b) => a - b);
      queue.push(...newZeroDegree);
    }

    // Handle cycles
    if (result.length !== noteIds.size) {
      console.warn('Dependency cycle detected! Some notes could not be evaluated.');
      const remaining = [];
      for (const id of noteIds) {
        if (!resultSet.has(id)) remaining.push(id);
      }
      remaining.sort((a, b) => a - b);
      result.push(...remaining);
    }

    return result;
  }

  getEvaluatedNote(noteId) {
    return this.cache.get(noteId);
  }

  isCacheValid() {
    return this.dirty.size === 0;
  }
}

// ============================================================================
// WasmPersistentEvaluatorWrapper - O(N) evaluation with WASM-resident cache
// ============================================================================

/**
 * Wrapper around PersistentEvaluator for O(N) evaluation
 *
 * This wrapper keeps the evaluation cache in WASM memory to avoid
 * O(N²) serialization overhead. JS only accesses the cache on-demand.
 */
class WasmPersistentEvaluatorWrapper {
  constructor(wasm, module) {
    this.wasm = wasm;
    this.module = module;
    this.evaluator = new wasm.PersistentEvaluator();
    this.generation = 0;

    // Local JS cache for Fraction.js objects (lazy conversion from WASM)
    this._jsCache = new Map();
    this._jsCacheGeneration = -1;

    // Track which notes have been registered
    this._registeredNotes = new Set();
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

  invalidate(noteId) {
    this.evaluator.invalidateNote(noteId);
    this._jsCache.delete(noteId);
    this.generation++;
  }

  beginBatch() {
    // Clear JS cache at start of batch - will be repopulated lazily
    this._jsCache.clear();
  }

  /**
   * Register a note's bytecode with WASM (one-time per note)
   * @param {Object} note - The note to register
   */
  registerNote(note) {
    if (!note || note.id == null) return;

    const expressions = {};
    const varNames = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

    for (const varName of varNames) {
      const expr = note.expressions?.[varName] || note[varName];
      if (expr && typeof expr.isEmpty === 'function' && !expr.isEmpty()) {
        // Use subarray to avoid copying bytecode
        const bytecodeView = expr.bytecode.subarray ?
          expr.bytecode.subarray(0, expr.length) :
          expr.bytecode.slice(0, expr.length);

        expressions[varName] = {
          bytecode: Array.from(bytecodeView), // Convert to regular array for serialization
          length: expr.length
        };
      }
    }

    try {
      this.evaluator.registerNote(note.id, expressions);
      this._registeredNotes.add(note.id);
    } catch (e) {
      if (WASM_CONFIG.debug) {
        console.warn(`Failed to register note ${note.id}:`, e);
      }
    }
  }

  /**
   * Mark a note as dirty in WASM
   * @param {number} noteId - The note ID
   */
  markDirty(noteId) {
    this.evaluator.markDirty(noteId);
    this._jsCache.delete(noteId);
  }

  /**
   * Mark multiple notes as dirty
   * @param {Array<number>} noteIds - Array of note IDs
   */
  markDirtyBatch(noteIds) {
    this.evaluator.markDirtyBatch(new Uint32Array(noteIds));
    for (const id of noteIds) {
      this._jsCache.delete(id);
    }
  }

  /**
   * Evaluate all dirty notes in topological order (single WASM call!)
   * @param {Array<number>} sortedIds - Topologically sorted note IDs
   * @returns {number} Number of notes evaluated
   */
  evaluateDirty(sortedIds) {
    const count = this.evaluator.evaluateDirty(new Uint32Array(sortedIds));
    this.generation++;
    // Clear JS cache - will be repopulated lazily on access
    this._jsCache.clear();
    return count;
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
    // Check JS cache first
    if (this._jsCache.has(noteId)) {
      return this._jsCache.get(noteId);
    }

    // Fetch from WASM and convert to Fraction.js
    const wasmResult = this.evaluator.getCachedNote(noteId);
    if (!wasmResult || wasmResult === null) return null;

    const jsResult = this._convertToFractionJs(wasmResult);
    this._jsCache.set(noteId, jsResult);
    return jsResult;
  }

  /**
   * Evaluate a single note (for compatibility with old interface)
   * @param {Object} note - The note to evaluate
   * @param {Map} evalCache - Ignored (uses internal WASM cache)
   * @returns {Object} Evaluated values
   */
  evaluateNote(note, evalCache = null) {
    // Register if not already registered
    if (!this._registeredNotes.has(note.id)) {
      this.registerNote(note);
    }

    // Evaluate single note
    this.evaluator.evaluateNoteInternal(note.id);

    // Return result
    return this.getEvaluatedNote(note.id);
  }

  /**
   * Evaluate a binary expression (for compatibility)
   * Note: This is less efficient than batch evaluation
   */
  evaluate(expr, evalCache = null) {
    if (expr.isEmpty()) {
      return this._createFraction(0, 1);
    }

    // For single expression evaluation, fall back to basic approach
    // This shouldn't be called in the optimized path
    console.warn('WasmPersistentEvaluatorWrapper.evaluate() called - use evaluateDirty() for better performance');
    return this._createFraction(0, 1);
  }

  getCachedValue(noteId, varIndex) {
    const cached = this.getEvaluatedNote(noteId);
    if (!cached) return null;

    const varNames = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    return cached[varNames[varIndex]] || null;
  }

  getPoolStats() {
    return {
      used: this.evaluator.cacheSize,
      total: this.evaluator.cacheSize,
      utilization: '100% (WASM persistent)'
    };
  }

  /**
   * Export the entire cache (for JSON save)
   * @returns {Object} Cache as plain object
   */
  exportCache() {
    return this.evaluator.exportCache();
  }

  /**
   * Import cache from JSON (for undo/redo or file load)
   * @param {Object} cacheJson - Cache data
   */
  importCache(cacheJson) {
    this.evaluator.importCache(cacheJson);
    this._jsCache.clear();
    this.generation++;
  }

  // Private helper methods

  _createFraction(num, den) {
    return new Fraction(num, den);
  }

  _convertToFractionJs(wasmNote) {
    const result = {
      startTime: null,
      duration: null,
      frequency: null,
      tempo: null,
      beatsPerMeasure: null,
      measureLength: null,
      corruptionFlags: wasmNote.corruptionFlags || 0
    };

    for (const key of ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength']) {
      const val = wasmNote[key];
      if (val && val.s !== undefined) {
        const frac = new Fraction(0);
        // Be careful with sign: 0 is valid (means zero value), don't default to 1
        frac.s = (val.s !== undefined && val.s !== null) ? val.s : 1;
        frac.n = val.n || 0;
        frac.d = val.d || 1;
        // For irrational values, store the float value if available
        if (val.corrupted && val.f !== undefined) {
          frac._irrational = true;
          frac._floatValue = val.f;
        }
        result[key] = frac;
      }
    }

    return result;
  }
}

// Re-export JS implementations for direct use
export { JSBinaryEvaluator as BinaryEvaluator, JSIncrementalEvaluator as IncrementalEvaluator };
