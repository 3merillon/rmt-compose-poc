/**
 * Expression Compiler Adapter
 *
 * Provides a unified interface for expression compilation,
 * using WASM when available and falling back to JavaScript.
 */

import { getWasm, isWasmAvailable } from './index.js';
import { WASM_CONFIG, shouldUseWasm } from './config.js';
import { ExpressionCompiler as JSExpressionCompiler, ExpressionDecompiler as JSExpressionDecompiler } from '../expression-compiler.js';
import { BinaryExpression } from '../binary-note.js';

/**
 * Create an expression compiler using the appropriate implementation
 * @returns {Object} Compiler instance
 */
export function createCompiler() {
  if (shouldUseWasm('compiler') && isWasmAvailable()) {
    const wasm = getWasm();
    try {
      return new WasmCompilerWrapper(wasm);
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM Compiler creation failed, using JS fallback:', e);
        }
        return new JSExpressionCompiler();
      }
      throw e;
    }
  }
  return new JSExpressionCompiler();
}

/**
 * Wrapper around WASM ExpressionCompiler to match JS interface
 */
class WasmCompilerWrapper {
  constructor(wasm) {
    this.wasm = wasm;
    this.compiler = new wasm.ExpressionCompiler();
    this.cache = new Map();
  }

  /**
   * Compile a text expression to binary bytecode
   * @param {string} textExpr - The text expression to compile
   * @param {string} [varName] - The variable name (for context)
   * @returns {BinaryExpression}
   */
  compile(textExpr, varName = null) {
    // Check cache
    const cacheKey = textExpr;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey).clone();
    }

    try {
      // Call WASM compiler
      const result = this.compiler.compile(textExpr);

      // Convert to BinaryExpression format
      const binary = new BinaryExpression();
      binary.sourceText = result.sourceText || textExpr;

      // Copy bytecode
      if (result.bytecode && result.bytecode.length > 0) {
        binary.ensureCapacity(result.bytecode.length);
        for (let i = 0; i < result.bytecode.length; i++) {
          binary.bytecode[i] = result.bytecode[i];
        }
        binary.length = result.bytecode.length;
      }

      // Copy dependencies
      if (result.dependencies) {
        for (const dep of result.dependencies) {
          binary.addDependency(dep);
        }
      }

      // Set references_base flag
      binary.referencesBase = result.referencesBase || false;

      // Cache the result
      this.cache.set(cacheKey, binary);

      return binary.clone();
    } catch (e) {
      if (WASM_CONFIG.fallbackOnError) {
        if (WASM_CONFIG.debug) {
          console.warn('WASM compilation failed, using JS fallback:', e);
        }
        // Fall back to JS compiler for this expression
        const jsCompiler = new JSExpressionCompiler();
        return jsCompiler.compile(textExpr, varName);
      }
      throw e;
    }
  }

  /**
   * Clear the compilation cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Re-export JS implementations for direct use
export { JSExpressionCompiler as ExpressionCompiler, JSExpressionDecompiler as ExpressionDecompiler };

// Export singleton instances for convenience
let _compiler = null;
let _decompiler = null;

export function getCompiler() {
  if (!_compiler) {
    _compiler = createCompiler();
  }
  return _compiler;
}

export function getDecompiler() {
  if (!_decompiler) {
    _decompiler = new JSExpressionDecompiler();
  }
  return _decompiler;
}
