/**
 * Expression compiler: text -> bytecode, with a cache.
 *
 * RMT Compose has one expression language, the DSL (`[3].f * (3/2)`,
 * `base.d`, see src/dsl/). This module is the app's entry point to it: a
 * bounded cache in front of the DSL compiler, and a decompiler that gives an
 * expression's text back.
 *
 * The method-chain syntax of earlier versions
 * (`module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))`) is
 * no longer compiled. Modules written in it are converted when they are loaded
 * (src/migrate/legacy-syntax.js); typed now, it is refused with its DSL form.
 */

import { compileDSL, decompileToDSL } from './dsl/index.js';
import { isLegacyExpression, legacyToDSL } from './migrate/legacy-syntax.js';

// Cap the compile cache. Drag/resize commits generate a fresh fraction
// string per commit, so an unbounded cache grows without limit over a long
// session. LRU eviction (Map keeps insertion order) keeps memory bounded
// while retaining the hot working set.
const COMPILE_CACHE_MAX = 4000;

function retiredSyntaxError(text) {
  let hint = '';
  try {
    hint = ` In the DSL this reads: ${legacyToDSL(text)}`;
  } catch {
    // not convertible: no hint
  }
  return new Error(`The method-chain syntax was retired; write expressions in the DSL, e.g. [3].f * (3/2).${hint}`);
}

export class ExpressionCompiler {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Compile a DSL expression to bytecode.
   * @param {string} textExpr
   * @returns {BinaryExpression} a fresh copy (callers may mutate it)
   * @throws {Error} on a syntax error, naming what is wrong
   */
  compile(textExpr) {
    const cached = this.cache.get(textExpr);
    if (cached) {
      // Mark as recently used so one-off expressions are evicted first.
      this.cache.delete(textExpr);
      this.cache.set(textExpr, cached);
      return cached.clone();
    }
    if (isLegacyExpression(textExpr)) throw retiredSyntaxError(textExpr);
    const binary = compileDSL(textExpr);
    if (this.cache.size >= COMPILE_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(textExpr, binary);
    return binary.clone();
  }

  clearCache() {
    this.cache.clear();
  }
}

/**
 * Bytecode -> text: the text the expression was written as, or the DSL the
 * bytecode decompiles to when it has none.
 */
export class ExpressionDecompiler {
  decompile(binary) {
    if (binary && binary.sourceText) return binary.sourceText;
    return decompileToDSL(binary);
  }
}

export const compiler = new ExpressionCompiler();
export const decompiler = new ExpressionDecompiler();
