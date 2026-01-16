/**
 * Binary System Utilities
 *
 * Helper functions for working with the binary expression system.
 */

import Fraction from 'fraction.js';
import { Module } from './module.js';
import { compiler, decompiler } from './expression-compiler.js';

/**
 * Get performance statistics for a module
 *
 * @param {Module} module
 * @returns {Object} - Statistics object
 */
export function getModuleStats(module) {
  const poolStats = module.getPoolStats ? module.getPoolStats() : null;
  const graphStats = module.getDependencyGraph ? module.getDependencyGraph().stats() : null;

  return {
    noteCount: Object.keys(module.notes).length - 1,
    pool: poolStats,
    dependencies: graphStats,
  };
}

/**
 * Compile an expression to binary format (for debugging/inspection)
 *
 * @param {string} expr - Expression string
 * @param {string} varName - Variable name context
 * @returns {Object} - Compilation result with bytecode info
 */
export function inspectExpression(expr, varName = null) {
  const binary = compiler.compile(expr, varName);

  return {
    source: expr,
    bytecodeLength: binary.length,
    dependencies: Array.from(binary.getDependencySet()),
    referencesBase: binary.referencesBase,
    decompiled: decompiler.decompile(binary),
  };
}

/**
 * Performance monitoring utilities
 */
export const perfMonitor = {
  _samples: [],
  _maxSamples: 100,

  /**
   * Record an evaluation time sample
   */
  record(label, timeMs) {
    this._samples.push({ label, time: timeMs, ts: Date.now() });
    if (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }
  },

  /**
   * Get average time for a label
   */
  getAverage(label) {
    const matching = this._samples.filter(s => s.label === label);
    if (matching.length === 0) return 0;
    const sum = matching.reduce((a, b) => a + b.time, 0);
    return sum / matching.length;
  },

  /**
   * Get all statistics
   */
  getStats() {
    const labels = new Set(this._samples.map(s => s.label));
    const stats = {};
    for (const label of labels) {
      const matching = this._samples.filter(s => s.label === label);
      stats[label] = {
        count: matching.length,
        avg: this.getAverage(label),
        min: Math.min(...matching.map(s => s.time)),
        max: Math.max(...matching.map(s => s.time)),
      };
    }
    return stats;
  },

  /**
   * Clear all samples
   */
  clear() {
    this._samples = [];
  },
};

/**
 * Measure and record evaluation time
 */
export function timedEvaluate(module, label = 'evaluate') {
  const start = performance.now();
  const result = module.evaluateModule();
  const elapsed = performance.now() - start;
  perfMonitor.record(label, elapsed);
  return result;
}
