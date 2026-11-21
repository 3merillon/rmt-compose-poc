/**
 * Binary System Utilities
 *
 * Helper functions for working with the binary expression system.
 */

interface Sample { label: string; time: number; ts: number }
interface Stats { count: number; avg: number; min: number; max: number }
import type { Module } from './module.ts';
import { compiler, decompiler } from './expression-compiler.ts';

/**
 * Get performance statistics for a module
 *
 * @param {Module} module
 * @returns {Object} - Statistics object
 */
export function getModuleStats(module: Module) {
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
export function inspectExpression(expr: string, varName: string | null = null) {
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
  _samples: [] as Sample[],
  _maxSamples: 100,

  /**
   * Record an evaluation time sample
   */
  record(label: string, timeMs: number) {
    this._samples.push({ label, time: timeMs, ts: Date.now() });
    if (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }
  },

  /**
   * Get average time for a label
   */
  getAverage(label: string) {
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
    const stats: Record<string, Stats> = {};
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
export function timedEvaluate(module: Module, label = 'evaluate') {
  const start = performance.now();
  const result = module.evaluateModule();
  const elapsed = performance.now() - start;
  perfMonitor.record(label, elapsed);
  return result;
}
