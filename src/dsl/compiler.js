/**
 * DSL Compiler
 *
 * Converts AST nodes into BinaryExpression bytecode.
 */

import { BinaryExpression, OP, VAR } from '../binary-note.js';
import { NodeType } from './ast.js';
import { DSLCompileError } from './errors.js';
import { bigGcd } from '../utils/fraction-num.js';

/**
 * DSL Compiler class
 */
export class DSLCompiler {
  constructor() {
    this.expr = null;
  }

  /**
   * Compile an AST into BinaryExpression bytecode
   * @param {Object} ast - Root AST node
   * @param {string} [sourceText] - Original source text (for decompilation)
   * @returns {BinaryExpression}
   */
  compile(ast, sourceText = '') {
    this.expr = new BinaryExpression();
    this.expr.sourceText = sourceText;

    this.emit(ast);

    return this.expr;
  }

  /**
   * Emit bytecode for an AST node
   * @param {Object} node - AST node
   */
  emit(node) {
    if (!node) {
      throw new DSLCompileError('Cannot emit null node');
    }

    switch (node.type) {
      case NodeType.NumberLiteral:
        this.emitNumber(node);
        break;

      case NodeType.FractionLiteral:
        this.emitFraction(node.numerator, node.denominator);
        break;

      case NodeType.NoteReference:
        this.emitNoteReference(node);
        break;

      case NodeType.BinaryOp:
        this.emitBinaryOp(node);
        break;

      case NodeType.UnaryOp:
        this.emitUnaryOp(node);
        break;

      case NodeType.HelperCall:
        this.emitHelperCall(node);
        break;

      default:
        throw new DSLCompileError(`Unknown node type: ${node.type}`, node);
    }
  }

  /**
   * Emit a number literal
   * @param {Object} node - NumberLiteral node
   */
  emitNumber(node) {
    this.emitFraction(node.numerator, node.denominator);
  }

  /**
   * Emit a fraction constant, exact at any magnitude.
   * @param {bigint|number} num - Numerator
   * @param {bigint|number} den - Denominator
   */
  emitFraction(num, den) {
    let finalNum = BigInt(num);
    let finalDen = BigInt(den);

    if (finalDen === 0n) {
      throw new DSLCompileError('Division by zero in fraction constant');
    }

    // Ensure denominator is positive, then normalize with BigInt GCD
    if (finalDen < 0n) {
      finalNum = -finalNum;
      finalDen = -finalDen;
    }
    const gcd = bigGcd(finalNum, finalDen);
    finalNum /= gcd;
    finalDen /= gcd;

    const MIN_I32 = -2147483648n;
    const MAX_I32 = 2147483647n;

    if (finalNum >= MIN_I32 && finalNum <= MAX_I32 && finalDen <= MAX_I32) {
      // Use standard LOAD_CONST
      this.expr.writeByte(OP.LOAD_CONST);
      this.expr.writeInt32(Number(finalNum));
      this.expr.writeInt32(Number(finalDen));
    } else {
      // Use BigInt format for large values
      this.expr.writeByte(OP.LOAD_CONST_BIG);
      this.expr.writeBigIntSigned(finalNum);
      this.expr.writeBigIntUnsigned(finalDen);
    }
  }

  /**
   * Emit a note reference
   * @param {Object} node - NoteReference node
   */
  emitNoteReference(node) {
    const varIndex = this.varNameToIndex(node.property);

    if (node.noteId === 'base' || node.noteId === 0) {
      this.expr.writeByte(OP.LOAD_BASE);
      this.expr.writeByte(varIndex);
      this.expr.referencesBase = true;
    } else {
      this.expr.writeByte(OP.LOAD_REF);
      this.expr.writeUint16(node.noteId);
      this.expr.writeByte(varIndex);
      this.expr.addDependency(node.noteId);
    }
  }

  /**
   * Emit a binary operation
   * @param {Object} node - BinaryOp node
   */
  emitBinaryOp(node) {
    // Emit left operand
    this.emit(node.left);
    // Emit right operand
    this.emit(node.right);
    // Emit operator
    switch (node.operator) {
      case '+':
        this.expr.writeByte(OP.ADD);
        break;
      case '-':
        this.expr.writeByte(OP.SUB);
        break;
      case '*':
        this.expr.writeByte(OP.MUL);
        break;
      case '/':
        this.expr.writeByte(OP.DIV);
        break;
      case '^':
        this.expr.writeByte(OP.POW);
        break;
      default:
        throw new DSLCompileError(`Unknown operator: ${node.operator}`, node);
    }
  }

  /**
   * Emit a unary operation
   * @param {Object} node - UnaryOp node
   */
  emitUnaryOp(node) {
    this.emit(node.operand);

    if (node.operator === '-') {
      this.expr.writeByte(OP.NEG);
    } else {
      throw new DSLCompileError(`Unknown unary operator: ${node.operator}`, node);
    }
  }

  /**
   * Emit a helper function call
   * @param {Object} node - HelperCall node
   */
  emitHelperCall(node) {
    switch (node.helper) {
      case 'tempo':
        this.emitFindTempo(node.noteArg);
        break;

      case 'measure':
        this.emitFindMeasure(node.noteArg);
        break;

      case 'beat':
        this.emitBeatUnit(node.noteArg);
        break;

      default:
        throw new DSLCompileError(`Unknown helper function: ${node.helper}`, node);
    }
  }

  /**
   * Emit findTempo lookup
   * @param {number|'base'} noteArg
   */
  emitFindTempo(noteArg) {
    if (noteArg === 'base' || noteArg === 0) {
      this.expr.writeByte(OP.LOAD_BASE);
      this.expr.writeByte(VAR.TEMPO);
      this.expr.referencesBase = true;
    } else {
      this.expr.writeByte(OP.LOAD_REF);
      this.expr.writeUint16(noteArg);
      this.expr.writeByte(VAR.TEMPO);
      this.expr.addDependency(noteArg);
    }
  }

  /**
   * Emit findMeasureLength lookup
   * @param {number|'base'} noteArg
   */
  emitFindMeasure(noteArg) {
    if (noteArg === 'base' || noteArg === 0) {
      this.expr.writeByte(OP.LOAD_BASE);
      this.expr.writeByte(VAR.MEASURE_LENGTH);
      this.expr.referencesBase = true;
    } else {
      this.expr.writeByte(OP.LOAD_REF);
      this.expr.writeUint16(noteArg);
      this.expr.writeByte(VAR.MEASURE_LENGTH);
      this.expr.addDependency(noteArg);
    }
  }

  /**
   * Emit beat unit: 60 / tempo(ref)
   * @param {number|'base'} noteArg
   */
  emitBeatUnit(noteArg) {
    // Emit: 60
    this.emitFraction(60, 1);
    // Emit: tempo(ref)
    this.emitFindTempo(noteArg);
    // Emit: DIV
    this.expr.writeByte(OP.DIV);
  }

  /**
   * Convert variable name to index
   * @param {string} varName - Canonical variable name
   * @returns {number}
   */
  varNameToIndex(varName) {
    switch (varName) {
      case 'startTime':
        return VAR.START_TIME;
      case 'duration':
        return VAR.DURATION;
      case 'frequency':
        return VAR.FREQUENCY;
      case 'tempo':
        return VAR.TEMPO;
      case 'beatsPerMeasure':
        return VAR.BEATS_PER_MEASURE;
      case 'measureLength':
        return VAR.MEASURE_LENGTH;
      default:
        throw new DSLCompileError(`Unknown variable name: ${varName}`);
    }
  }
}

/**
 * Compile an AST to BinaryExpression
 * @param {Object} ast - Root AST node
 * @param {string} [sourceText] - Original source text
 * @returns {BinaryExpression}
 */
export function compile(ast, sourceText = '') {
  const compiler = new DSLCompiler();
  return compiler.compile(ast, sourceText);
}
