import type { BinaryExpression } from './binary-note.ts';

interface CacheLink { next: CacheLink; prev: CacheLink }
interface CacheEntry extends CacheLink { key: string; binary: BinaryExpression }
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

import { compileDSL, decompileToDSL } from './dsl/index.ts';
import { isLegacyExpression, legacyToDSL } from './migrate/legacy-syntax.ts';

// Cap the compile cache. Drag/resize commits generate a fresh fraction
// string per commit, so an unbounded cache grows without limit over a long
// session. Least-recently-used eviction keeps memory bounded
// while retaining the hot working set.
const COMPILE_CACHE_MAX = 4000;

function retiredSyntaxError(text: string) {
  let hint = '';
  try {
    hint = ` In the DSL this reads: ${legacyToDSL(text)}`;
  } catch {
    // not convertible: no hint
  }
  return new Error(`The method-chain syntax was retired; write expressions in the DSL, e.g. [3].f * (3/2).${hint}`);
}

export class ExpressionCompiler {
  declare cache: Map<string, CacheEntry>;
  declare order: CacheLink;

  constructor() {
    this.cache = new Map();
    this.order = {} as CacheLink; // both links close the sentinel immediately below
    this.order.next = this.order.prev = this.order;
  }

  /**
   * Compile a DSL expression to bytecode.
   * @param {string} textExpr
   * @returns {BinaryExpression} a fresh copy (callers may mutate it)
   * @throws {Error} on a syntax error, naming what is wrong
   */
  compile(textExpr: string, _variableContext?: string | null): BinaryExpression {
    let entry = this.cache.get(textExpr);
    if (entry) {
      if (entry === this.order.prev) return entry.binary.clone();
      entry.prev.next = entry.next;
      entry.next.prev = entry.prev;
    } else {
      if (isLegacyExpression(textExpr)) throw retiredSyntaxError(textExpr);
      const binary = compileDSL(textExpr);
      if (this.cache.size === COMPILE_CACHE_MAX) {
        // A full cache always has an oldest entry after the sentinel.
        entry = this.order.next as CacheEntry;
        this.order.next = entry.next;
        entry.next.prev = this.order;
        this.cache.delete(entry.key);
      } else {
        // Complete the reused/new entry before exposing it to any caller.
        entry = {} as CacheEntry;
      }
      entry.key = textExpr;
      entry.binary = binary;
      this.cache.set(textExpr, entry);
    }

    // Touching a hot key and evicting the oldest key are both constant time.
    // Recreating a Map iterator for every miss repeatedly walked deleted slots.
    entry.prev = this.order.prev;
    entry.next = this.order;
    entry.prev.next = entry;
    this.order.prev = entry;
    return entry.binary.clone();
  }

  clearCache() {
    this.cache.clear();
    this.order.next = this.order.prev = this.order;
  }
}

/**
 * Bytecode -> text: the text the expression was written as, or the DSL the
 * bytecode decompiles to when it has none.
 */
export class ExpressionDecompiler {
  decompile(binary: BinaryExpression): string {
    if (binary && binary.sourceText) return binary.sourceText;
    return decompileToDSL(binary);
  }
}

export const compiler = new ExpressionCompiler();
export const decompiler = new ExpressionDecompiler();
