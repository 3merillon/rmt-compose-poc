/**
 * DSL Module Public API
 *
 * Main entry point for the expression DSL system.
 * Provides functions for compiling, decompiling, and detecting DSL syntax.
 */

import { BinaryExpression, OP } from '../binary-note.ts';
import { tokenize, DSLLexer } from './lexer.ts';
import { parse, DSLParser } from './parser.ts';
import { compile, DSLCompiler } from './compiler.ts';
import { decompile, DSLDecompiler } from './decompiler.ts';
import { DSLError, DSLLexerError, DSLParseError, DSLCompileError, ErrorMessages } from './errors.ts';
import { TokenType, PropertyMap, PropertyShortNames, getCanonicalPropertyName, getShortPropertyName } from './constants.ts';
import { NodeType, createNumberLiteral, createFractionLiteral, createNoteReference, createBinaryOp, createUnaryOp, collectDependencies, referencesBase, printAST } from './ast.ts';

/**
 * Compile a DSL expression string to BinaryExpression bytecode
 *
 * @param {string} source - DSL expression string
 * @returns {BinaryExpression} Compiled binary expression
 * @throws {DSLError} On syntax or compilation errors
 */
export function compileDSL(source: string) {
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
export function decompileToDSL(binary: BinaryExpression | null | undefined) {
  if (!binary || binary.isEmpty()) {
    return '0';
  }

  return decompile(binary);
}

/**
 * Validate a DSL expression without fully compiling
 *
 * @param {string} source - DSL expression string
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateDSL(source: string): { valid: true } | { valid: false; error: string } {
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
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
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
  base.f     - reference note frequency (same as [0].f)
  base.d     - reference note duration: the time unit (one beat)

Interpretation (how a note sounds; not relations of the notation):
  [id].a       - amplitude (relative gain)
  [id].attack  - attack, as a share of the note's own duration
  [id].release - release, as a share of the note's own duration

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

Examples:
  base.f * (3/2)           - perfect fifth
  [1].t + [1].d            - end time of note 1
  base.f * 2^(7/12)        - 12-TET perfect fifth
  base.d * (1/4)           - a quarter of the time unit
  [4].d * 3                - three times as long as note 4
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
  getCanonicalPropertyName,
  getShortPropertyName,

  // AST
  NodeType,
  createNumberLiteral,
  createFractionLiteral,
  createNoteReference,
  createBinaryOp,
  createUnaryOp,
  collectDependencies,
  referencesBase,
  printAST,
};
