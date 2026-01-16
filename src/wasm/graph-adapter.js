/**
 * Dependency Graph Adapter
 *
 * Provides a unified interface for dependency graph operations,
 * using WASM when available and falling back to JavaScript.
 */

import { getWasm, isWasmAvailable } from './index.js';
import { WASM_CONFIG, shouldUseWasm } from './config.js';
import { DependencyGraph as JSDependencyGraph } from '../dependency-graph.js';

/**
 * Create a dependency graph using the appropriate implementation
 * @returns {Object} DependencyGraph instance
 */
export function createDependencyGraph() {
  if (shouldUseWasm('graph') && isWasmAvailable()) {
    const wasm = getWasm();
    try {
      return new WasmGraphWrapper(wasm);
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM DependencyGraph creation failed, using JS fallback:', e);
        }
        return new JSDependencyGraph();
      }
      throw e;
    }
  }
  return new JSDependencyGraph();
}

/**
 * Wrapper around WASM DependencyGraph to match JS interface
 */
class WasmGraphWrapper {
  constructor(wasm) {
    this.wasm = wasm;
    this.graph = new wasm.DependencyGraph();
  }

  /**
   * Register dependencies for a note from its binary expression
   * @param {number} noteId - The note being registered
   * @param {Object} expr - The expression to extract dependencies from
   */
  registerExpression(noteId, expr) {
    const deps = Array.from(expr.getDependencySet());
    this.graph.addNote(noteId, new Uint32Array(deps), expr.referencesBase);
  }

  /**
   * Register all dependencies for a note
   * @param {number} noteId - The note being registered
   * @param {Object} note - The binary note
   */
  registerNote(noteId, note) {
    const allDeps = Array.from(note.getAllDependencies());
    const refsBase = note.referencesBaseNote();
    this.graph.addNote(noteId, new Uint32Array(allDeps), refsBase);
  }

  /**
   * Remove a note from the graph
   * @param {number} noteId - The note to remove
   */
  removeNote(noteId) {
    this.graph.removeNote(noteId);
  }

  /**
   * Get direct dependencies for a note
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getDependencies(noteId) {
    const deps = this.graph.getDependencies(noteId);
    return new Set(deps);
  }

  /**
   * Get direct dependents of a note
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getDependents(noteId) {
    const deps = this.graph.getDependents(noteId);
    return new Set(deps);
  }

  /**
   * Get all transitive dependents
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllDependents(noteId) {
    const deps = this.graph.getAllDependents(noteId);
    return new Set(deps);
  }

  /**
   * Get all transitive dependencies
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllDependencies(noteId) {
    const deps = this.graph.getAllDependencies(noteId);
    return new Set(deps);
  }

  /**
   * Get all notes that depend on baseNote
   * @returns {Set<number>}
   */
  getBaseNoteDependents() {
    const deps = this.graph.getBaseNoteDependents();
    return new Set(deps);
  }

  /**
   * Check if there's a dependency path from source to target
   * @param {number} source
   * @param {number} target
   * @returns {boolean}
   */
  hasDependencyPath(source, target) {
    return this.graph.hasDependencyPath(source, target);
  }

  /**
   * Detect cycles in the dependency graph
   * @returns {Array<Array<number>>}
   */
  detectCycles() {
    return this.graph.detectCycles();
  }

  /**
   * Get evaluation order (topological sort)
   * @param {Iterable<number>} noteIds
   * @returns {Array<number>}
   */
  getEvaluationOrder(noteIds) {
    const ids = Array.from(noteIds);
    return Array.from(this.graph.getEvaluationOrder(new Uint32Array(ids)));
  }

  /**
   * Clear the entire graph
   */
  clear() {
    this.graph.clear();
  }

  /**
   * Get statistics about the graph
   * @returns {Object}
   */
  stats() {
    return this.graph.getStats();
  }

  /**
   * Debug: Print the graph structure
   */
  debug() {
    console.log('=== Dependency Graph (WASM) ===');
    console.log('Stats:', this.stats());
  }

  /**
   * Internal: Update dependencies directly
   */
  _updateDependencies(noteId, newDeps, referencesBase) {
    const deps = Array.from(newDeps);
    this.graph.addNote(noteId, new Uint32Array(deps), referencesBase);
  }
}

// Re-export JS implementation for direct use
export { JSDependencyGraph as DependencyGraph };
