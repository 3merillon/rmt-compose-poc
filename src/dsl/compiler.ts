import type { AstNode, NumberLiteral, NoteReference, BinaryOp, UnaryOp } from './ast.ts';
/**
 * DSL Compiler
 *
 * Converts AST nodes into BinaryExpression bytecode.
 */

import { BinaryExpression, OP, VAR } from '../binary-note.ts';
import { NodeType } from './ast.ts';
import { DSLCompileError } from './errors.ts';
import { bigGcd } from '../utils/fraction-num.ts';

/**
 * DSL Compiler class
 */
export class DSLCompiler {
  declare expr: BinaryExpression | null;
  constructor() {
    this.expr = null;
  }

  /**
   * Compile an AST into BinaryExpression bytecode
   * @param {Object} ast - Root AST node
   * @param {string} [sourceText] - Original source text (for decompilation)
   * @returns {BinaryExpression}
   */
  compile(ast: AstNode, sourceText = ''): BinaryExpression {
    this.expr = new BinaryExpression();
    this.expr.sourceText = sourceText;

    this.emit(ast);

    return this.expr;
  }

  /**
   * Emit bytecode for an AST node
   * @param {Object} node - AST node
   */
  // compile() installs the output buffer before the first synchronous emission.
  emit(node: AstNode): void {
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

      case NodeType.Approximate:
        // The literal, then APPROX: the value is approximate
        this.emit(node.literal);
        this.expr!.writeByte(OP.APPROX);
        break;

      default:
        throw new DSLCompileError(`Unknown node type: ${(node as { type: unknown }).type}`, node);
    }
  }

  /**
   * Emit a number literal
   * @param {Object} node - NumberLiteral node
   */
  emitNumber(node: NumberLiteral): void {
    this.emitFraction(node.numerator, node.denominator);
  }

  /**
   * Emit a fraction constant, exact at any magnitude.
   * @param {bigint|number} num - Numerator
   * @param {bigint|number} den - Denominator
   */
  emitFraction(num: bigint, den: bigint): void {
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
      this.expr!.writeByte(OP.LOAD_CONST);
      this.expr!.writeInt32(Number(finalNum));
      this.expr!.writeInt32(Number(finalDen));
    } else {
      // Use BigInt format for large values
      this.expr!.writeByte(OP.LOAD_CONST_BIG);
      this.expr!.writeBigIntSigned(finalNum);
      this.expr!.writeBigIntUnsigned(finalDen);
    }
  }

  /**
   * Emit a note reference
   * @param {Object} node - NoteReference node
   */
  emitNoteReference(node: NoteReference): void {
    const varIndex = this.varNameToIndex(node.property);

    if (node.noteId === 'base' || node.noteId === 0) {
      this.expr!.writeByte(OP.LOAD_BASE);
      this.expr!.writeByte(varIndex);
      this.expr!.referencesBase = true;
    } else {
      // Two bytes of note id while they suffice, so every module whose ids
      // fit compiles to the same bytecode as before LOAD_REF_WIDE existed
      if (node.noteId > 0xFFFF) {
        this.expr!.writeByte(OP.LOAD_REF_WIDE);
        this.expr!.writeUint32(node.noteId);
      } else {
        this.expr!.writeByte(OP.LOAD_REF);
        this.expr!.writeUint16(node.noteId);
      }
      this.expr!.writeByte(varIndex);
      this.expr!.addDependency(node.noteId);
    }
  }

  /**
   * Emit a binary operation
   * @param {Object} node - BinaryOp node
   */
  emitBinaryOp(node: BinaryOp): void {
    // Emit left operand
    this.emit(node.left);
    // Emit right operand
    this.emit(node.right);
    // Emit operator
    switch (node.operator) {
      case '+':
        this.expr!.writeByte(OP.ADD);
        break;
      case '-':
        this.expr!.writeByte(OP.SUB);
        break;
      case '*':
        this.expr!.writeByte(OP.MUL);
        break;
      case '/':
        this.expr!.writeByte(OP.DIV);
        break;
      case '^':
        this.expr!.writeByte(OP.POW);
        break;
      default:
        throw new DSLCompileError(`Unknown operator: ${node.operator}`, node);
    }
  }

  /**
   * Emit a unary operation
   * @param {Object} node - UnaryOp node
   */
  emitUnaryOp(node: UnaryOp): void {
    this.emit(node.operand);

    if (node.operator === '-') {
      this.expr!.writeByte(OP.NEG);
    } else {
      throw new DSLCompileError(`Unknown unary operator: ${node.operator}`, node);
    }
  }

  /**
   * Convert variable name to index
   * @param {string} varName - Canonical variable name
   * @returns {number}
   */
  varNameToIndex(varName: string) {
    switch (varName) {
      case 'startTime':
        return VAR.START_TIME;
      case 'duration':
        return VAR.DURATION;
      case 'frequency':
        return VAR.FREQUENCY;
      case 'amplitude':
        return VAR.AMPLITUDE;
      case 'attack':
        return VAR.ATTACK;
      case 'release':
        return VAR.RELEASE;
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
export function compile(ast: AstNode, sourceText = '') {
  const compiler = new DSLCompiler();
  return compiler.compile(ast, sourceText);
}
