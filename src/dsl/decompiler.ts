import type { BinaryExpression } from '../binary-note.ts';
/**
 * DSL Decompiler
 *
 * Converts BinaryExpression bytecode back to DSL syntax.
 * Used for:
 * - Auto-converting legacy expressions to DSL display format
 * - Round-trip preservation
 */

import { OP, VAR } from '../binary-note.ts';
import { getShortPropertyName, Precedence } from './constants.ts';

/**
 * DSL Decompiler class
 */
export class DSLDecompiler {
  declare stack: string[];
  declare precStack: number[];
  constructor() {
    // Stack for expression strings during decompilation
    this.stack = [];
    // Stack for tracking precedence (to determine parenthesization)
    this.precStack = [];
  }

  /**
   * Decompile a BinaryExpression to DSL syntax
   * @param {BinaryExpression} expr - The binary expression
   * @returns {string} DSL syntax
   */
  decompile(expr: BinaryExpression): string {
    if (expr.isEmpty()) {
      return '0';
    }

    this.stack = [];
    this.precStack = [];

    const bytecode = expr.bytecode;
    let pc = 0;

    while (pc < expr.length) {
      const op = bytecode[pc++];

      switch (op) {
        case OP.LOAD_CONST: {
          const num = this.readInt32(bytecode, pc);
          pc += 4;
          const den = this.readInt32(bytecode, pc);
          pc += 4;
          this.pushConst(num, den, Precedence.ATOMIC);
          break;
        }

        case OP.LOAD_CONST_BIG: {
          const { value: num, bytesRead: numBytes } = this.readBigIntSigned(bytecode, pc);
          pc += numBytes;
          const { value: den, bytesRead: denBytes } = this.readBigIntUnsigned(bytecode, pc);
          pc += denBytes;
          // Keep the BigInts — template interpolation prints every digit;
          // Number() would round and emit unparseable scientific notation.
          this.pushConst(num, den, Precedence.ATOMIC);
          break;
        }

        case OP.LOAD_REF:
        case OP.LOAD_REF_WIDE: {
          let noteId;
          if (op === OP.LOAD_REF) {
            noteId = this.readUint16(bytecode, pc);
            pc += 2;
          } else {
            noteId = ((bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3]) >>> 0;
            pc += 4;
          }
          const varIdx = bytecode[pc++];
          const prop = this.varIndexToShortName(varIdx);
          this.push(`[${noteId}].${prop}`, Precedence.ATOMIC);
          break;
        }

        case OP.LOAD_BASE: {
          const varIdx = bytecode[pc++];
          const prop = this.varIndexToShortName(varIdx);
          this.push(`base.${prop}`, Precedence.ATOMIC);
          break;
        }

        case OP.ADD: {
          const [b, bPrec] = this.pop();
          const [a, aPrec] = this.pop();
          // Wrap operands if they have lower precedence
          const aStr = this.wrapIfLower(a, aPrec, Precedence.ADDITIVE);
          const bStr = this.wrapIfLower(b, bPrec, Precedence.ADDITIVE);
          this.push(`${aStr} + ${bStr}`, Precedence.ADDITIVE);
          break;
        }

        case OP.SUB: {
          const [b, bPrec] = this.pop();
          const [a, aPrec] = this.pop();
          const aStr = this.wrapIfLower(a, aPrec, Precedence.ADDITIVE);
          // Right operand needs wrapping if same or lower precedence (left-associative)
          const bStr = this.wrapIfLowerOrEqual(b, bPrec, Precedence.ADDITIVE);
          this.push(`${aStr} - ${bStr}`, Precedence.ADDITIVE);
          break;
        }

        case OP.MUL: {
          const [b, bPrec] = this.pop();
          const [a, aPrec] = this.pop();
          const aStr = this.wrapIfLower(a, aPrec, Precedence.MULTIPLICATIVE);
          const bStr = this.wrapIfLower(b, bPrec, Precedence.MULTIPLICATIVE);
          this.push(`${aStr} * ${bStr}`, Precedence.MULTIPLICATIVE);
          break;
        }

        case OP.DIV: {
          const [b, bPrec] = this.pop();
          const [a, aPrec] = this.pop();

          const aStr = this.wrapIfLower(a, aPrec, Precedence.MULTIPLICATIVE);
          const bStr = this.wrapIfLowerOrEqual(b, bPrec, Precedence.MULTIPLICATIVE);
          this.push(`${aStr} / ${bStr}`, Precedence.MULTIPLICATIVE);
          break;
        }

        case OP.NEG: {
          const [a, aPrec] = this.pop();
          const aStr = this.wrapIfLower(a, aPrec, Precedence.UNARY);
          this.push(`-${aStr}`, Precedence.UNARY);
          break;
        }

        case OP.APPROX: {
          // Follows a constant: ~261.63, ~-3, ~(3/2)
          const [a] = this.pop();
          this.push(`~${a}`, Precedence.ATOMIC);
          break;
        }

        case OP.POW: {
          const [exp, expPrec] = this.pop();
          const [base, basePrec] = this.pop();
          // Power is right-associative, so wrap left if lower, right only if strictly lower
          const baseStr = this.wrapIfLower(base, basePrec, Precedence.POWER);
          const expStr = this.wrapIfLower(exp, expPrec, Precedence.POWER);
          this.push(`${baseStr}^${expStr}`, Precedence.POWER);
          break;
        }

        case OP.DUP: {
          const [top, prec] = this.peek();
          this.push(top, prec);
          break;
        }

        case OP.SWAP: {
          const [a, aPrec] = this.pop();
          const [b, bPrec] = this.pop();
          this.push(a, aPrec);
          this.push(b, bPrec);
          break;
        }

        default:
          console.warn(`Unknown opcode during decompilation: 0x${op.toString(16)}`);
          break;
      }
    }

    return this.stack.length > 0 ? this.stack[0] : '0';
  }

  /**
   * Push a value and its precedence onto the stack
   */
  push(value: string, prec: number): void {
    this.stack.push(value);
    this.precStack.push(prec);
  }

  /**
   * Pop a value and its precedence from the stack
   * @returns {[string, number]}
   */
  pop(): [string, number] {
    // Compiler-produced operations pop matching operands and precedence entries.
    return [this.stack.pop()!, this.precStack.pop()!];
  }

  /**
   * Peek at top of stack
   * @returns {[string, number]}
   */
  peek(): [string, number] {
    return [this.stack[this.stack.length - 1], this.precStack[this.precStack.length - 1]];
  }

  /**
   * Push a constant (number or fraction; components may be Number or BigInt)
   */
  pushConst(num: bigint | number, den: bigint | number, prec = Precedence.ATOMIC): void {
    if (den === 1 || den === 1n) {
      this.push(String(num), prec);
    } else {
      this.push(`(${num}/${den})`, prec);
    }
  }

  /**
   * Wrap expression if its precedence is lower than required
   */
  wrapIfLower(expr: string, exprPrec: number, required: number): string {
    if (exprPrec < required) {
      return `(${expr})`;
    }
    return expr;
  }

  /**
   * Wrap expression if its precedence is lower or equal (for right operand of left-assoc ops)
   */
  wrapIfLowerOrEqual(expr: string, exprPrec: number, required: number): string {
    if (exprPrec <= required) {
      return `(${expr})`;
    }
    return expr;
  }

  /**
   * Convert variable index to short property name
   */
  varIndexToShortName(idx: number) {
    switch (idx) {
      case VAR.START_TIME:
        return 't';
      case VAR.DURATION:
        return 'd';
      case VAR.FREQUENCY:
        return 'f';
      case VAR.AMPLITUDE:
        return 'a';
      case VAR.ATTACK:
        return 'attack';
      case VAR.RELEASE:
        return 'release';
      default:
        return 't';
    }
  }

  /**
   * Read 16-bit unsigned integer (big-endian)
   */
  readUint16(bytecode: Uint8Array, offset: number) {
    return (bytecode[offset] << 8) | bytecode[offset + 1];
  }

  /**
   * Read 32-bit signed integer (big-endian)
   */
  readInt32(bytecode: Uint8Array, offset: number) {
    const val = (bytecode[offset] << 24) |
                (bytecode[offset + 1] << 16) |
                (bytecode[offset + 2] << 8) |
                bytecode[offset + 3];
    return val | 0;
  }

  /**
   * Read signed BigInt
   * @returns {{ value: bigint, bytesRead: number }}
   */
  readBigIntSigned(bytecode: Uint8Array, offset: number) {
    const sign = bytecode[offset];
    const { value: magnitude, bytesRead: magBytes } = this.readBigIntUnsigned(bytecode, offset + 1);
    const value = sign === 0x01 ? -magnitude : magnitude;
    return { value, bytesRead: 1 + magBytes };
  }

  /**
   * Read unsigned BigInt
   * @returns {{ value: bigint, bytesRead: number }}
   */
  readBigIntUnsigned(bytecode: Uint8Array, offset: number) {
    const len = (bytecode[offset] << 8) | bytecode[offset + 1];
    let value = 0n;
    for (let i = 0; i < len; i++) {
      value = (value << 8n) | BigInt(bytecode[offset + 2 + i]);
    }
    return { value, bytesRead: 2 + len };
  }
}

/**
 * Decompile a BinaryExpression to DSL syntax
 * @param {BinaryExpression} expr - The binary expression
 * @returns {string} DSL syntax
 */
export function decompile(expr: BinaryExpression) {
  const decompiler = new DSLDecompiler();
  return decompiler.decompile(expr);
}
