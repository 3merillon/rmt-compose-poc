/**
 * DSL Module Public API
 *
 * Main entry point for the expression DSL system.
 * Provides functions for compiling, decompiling, and detecting DSL syntax.
 */

import { BinaryExpression, OP } from '../binary-note.js';
import { tokenize, DSLLexer } from './lexer.js';
import { parse, DSLParser } from './parser.js';
import { compile, DSLCompiler } from './compiler.js';
import { decompile, DSLDecompiler } from './decompiler.js';
import { DSLError, DSLLexerError, DSLParseError, DSLCompileError, ErrorMessages } from './errors.js';
import { TokenType, PropertyMap, PropertyShortNames, HelperFunctions, getCanonicalPropertyName, getShortPropertyName } from './constants.js';
import { NodeType, createNumberLiteral, createFractionLiteral, createNoteReference, createBinaryOp, createUnaryOp, createHelperCall, collectDependencies, referencesBase, printAST } from './ast.js';

/**
 * Check if a string uses DSL syntax (vs legacy JavaScript syntax)
 *
 * @param {string} expr - Expression string to check
 * @returns {boolean} True if DSL syntax, false if legacy
 */
export function isDSLSyntax(expr) {
  if (!expr || typeof expr !== 'string') {
    return false;
  }

  const trimmed = expr.trim();
  if (!trimmed) {
    return false;
  }

  // DSL indicators (check these first)
  // Note references: [123].f, [0].t
  if (/^\[[\d]+\]\./.test(trimmed)) return true;
  // Base reference: base.f
  if (/^base\./.test(trimmed)) return true;
  // Fraction literal: (3/2) at start or after operator
  if (/^\(\s*-?\d+\s*\/\s*-?\d+\s*\)/.test(trimmed)) return true;
  // Helper functions: tempo(...), measure(...), beat(...)
  if (/^(tempo|measure|beat)\s*\(/.test(trimmed)) return true;
  // Contains DSL-style references anywhere
  if (/\[[\d]+\]\./.test(trimmed)) return true;
  if (/\bbase\.[a-z]/.test(trimmed)) return true;

  // Legacy indicators
  // new Fraction(...)
  if (/new\s+Fraction\s*\(/.test(trimmed)) return false;
  // module.getNoteById(...)
  if (/module\.getNoteById/.test(trimmed)) return false;
  // module.baseNote
  if (/module\.baseNote/.test(trimmed)) return false;
  // .getVariable(...)
  if (/\.getVariable\s*\(/.test(trimmed)) return false;
  // .mul(...), .div(...), .add(...), .sub(...), .pow(...)
  if (/\.(mul|div|add|sub|pow|neg)\s*\(/.test(trimmed)) return false;
  // module.findTempo(...), module.findMeasureLength(...)
  if (/module\.find(Tempo|MeasureLength)/.test(trimmed)) return false;

  // Simple numbers are valid in both - treat as DSL
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return true;

  // If no clear indicator, default to legacy for safety
  // This ensures existing expressions work unchanged
  return false;
}

/**
 * Compile a DSL expression string to BinaryExpression bytecode
 *
 * @param {string} source - DSL expression string
 * @returns {BinaryExpression} Compiled binary expression
 * @throws {DSLError} On syntax or compilation errors
 */
export function compileDSL(source) {
  const trimmed = (source || '').trim();

  if (!trimmed) {
    // Return a zero constant for empty expressions
    const expr = new BinaryExpression();
    expr.sourceText = source;
    expr.writeByte(OP.LOAD_CONST);
    expr.writeInt32(0);
    expr.writeInt32(1);
    return expr;
  }

  // Tokenize
  const tokens = tokenize(trimmed);

  // Parse to AST
  const ast = parse(tokens);

  // Compile to bytecode
  const binary = compile(ast, source);

  return binary;
}

/**
 * Decompile a BinaryExpression to DSL syntax
 *
 * @param {BinaryExpression} binary - Binary expression to decompile
 * @returns {string} DSL syntax string
 */
export function decompileToDSL(binary) {
  if (!binary || binary.isEmpty()) {
    return '0';
  }

  return decompile(binary);
}

/**
 * Compile an expression string, auto-detecting DSL vs legacy syntax
 *
 * @param {string} source - Expression string (DSL or legacy)
 * @param {Function} legacyCompiler - Fallback legacy compiler function
 * @param {string} [varName] - Variable name for context
 * @returns {BinaryExpression} Compiled binary expression
 */
export function compileAuto(source, legacyCompiler, varName = null) {
  if (isDSLSyntax(source)) {
    return compileDSL(source);
  }
  // Fall back to legacy compiler
  return legacyCompiler(source, varName);
}

/**
 * Validate a DSL expression without fully compiling
 *
 * @param {string} source - DSL expression string
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateDSL(source) {
  try {
    const trimmed = (source || '').trim();
    if (!trimmed) {
      return { valid: true };
    }

    const tokens = tokenize(trimmed);
    parse(tokens);

    return { valid: true };
  } catch (e) {
    if (e instanceof DSLError) {
      return { valid: false, error: e.userMessage };
    }
    return { valid: false, error: e.message };
  }
}

/**
 * Get syntax help for DSL
 * @returns {string} Syntax help text
 */
export function getSyntaxHelp() {
  return `DSL Syntax Help:

Note References:
  [id].f     - frequency of note id
  [id].t     - startTime of note id
  [id].d     - duration of note id
  [id].tempo - tempo of note id
  [id].bpm   - beatsPerMeasure of note id
  [id].ml    - measureLength of note id
  base.f     - baseNote frequency (same as [0].f)

Literals:
  440        - integer
  (3/2)      - fraction (3 divided by 2)
  (1/12)     - fraction for TET intervals

Operators:
  a + b      - addition
  a - b      - subtraction
  a * b      - multiplication
  a / b      - division
  a ^ b      - power (e.g., 2^(1/12) for semitone)
  -a         - negation

Helpers:
  tempo([id])   - get tempo for note
  measure([id]) - get measure length for note
  beat([id])    - get beat duration (60/tempo)

Examples:
  base.f * (3/2)           - perfect fifth
  [1].t + [1].d            - end time of note 1
  base.f * 2^(7/12)        - 12-TET perfect fifth
  beat(base) * (1/4)       - quarter beat
`;
}

// Re-export for advanced usage
export {
  // Classes
  DSLLexer,
  DSLParser,
  DSLCompiler,
  DSLDecompiler,

  // Functions
  tokenize,
  parse,
  compile,
  decompile,

  // Error types
  DSLError,
  DSLLexerError,
  DSLParseError,
  DSLCompileError,
  ErrorMessages,

  // Constants
  TokenType,
  PropertyMap,
  PropertyShortNames,
  HelperFunctions,
  getCanonicalPropertyName,
  getShortPropertyName,

  // AST
  NodeType,
  createNumberLiteral,
  createFractionLiteral,
  createNoteReference,
  createBinaryOp,
  createUnaryOp,
  createHelperCall,
  collectDependencies,
  referencesBase,
  printAST,
};
