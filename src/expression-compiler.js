/**
 * Expression Compiler: Text → Binary Bytecode
 *
 * Compiles text-based expressions (e.g., "module.getNoteById(124).getVariable('startTime').add(new Fraction(1,4))")
 * into compact binary bytecode that can be evaluated without runtime string compilation.
 */

import Fraction from 'fraction.js';
import { BinaryExpression, OP, VAR } from './binary-note.js';

/**
 * Expression compiler that converts text expressions to binary bytecode
 */
export class ExpressionCompiler {
  constructor() {
    // Cache compiled expressions to avoid recompiling
    this.cache = new Map();
  }

  /**
   * Compile a text expression to binary bytecode
   *
   * @param {string} textExpr - The text expression to compile
   * @param {string} varName - The variable name (for context, e.g., 'startTime')
   * @returns {BinaryExpression} - The compiled binary expression
   */
  compile(textExpr, varName = null) {
    // Check cache
    const cacheKey = textExpr;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey).clone();
    }

    const binary = new BinaryExpression();
    binary.sourceText = textExpr;

    try {
      const ast = this.parse(textExpr);
      this.emitBytecode(ast, binary);
    } catch (e) {
      // If parsing fails, create a fallback that returns 0
      console.warn(`Failed to compile expression: ${textExpr}`, e);
      binary.clear();
      binary.sourceText = textExpr;
      // Emit a constant 0
      this.emitConstant(binary, 0, 1);
    }

    this.cache.set(cacheKey, binary);
    return binary.clone();
  }

  /**
   * Clear the compilation cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Parse a text expression into an AST
   */
  parse(expr) {
    const trimmed = expr.trim();
    if (!trimmed) {
      return { type: 'const', num: 0, den: 1 };
    }

    // Try to parse as a sum of products (handles .add/.sub chains)
    const addSubResult = this.splitAddSub(trimmed);
    if (addSubResult.terms.length > 1) {
      return {
        type: 'sum',
        terms: addSubResult.terms.map(t => ({
          sign: t.sign,
          node: this.parseProduct(t.expr)
        }))
      };
    }

    // Single term (possibly a product)
    return this.parseProduct(trimmed);
  }

  /**
   * Parse a product expression (handles .mul/.div chains)
   */
  parseProduct(expr) {
    const trimmed = expr.trim();

    // Try to split by .mul/.div
    const mulDivResult = this.splitMulDiv(trimmed);
    if (mulDivResult.factors.length > 0) {
      return {
        type: 'product',
        base: this.parseAtomic(mulDivResult.base),
        operations: mulDivResult.factors.map(f => ({
          op: f.op,
          node: this.parseAtomic(f.expr)
        }))
      };
    }

    // Single atomic
    return this.parseAtomic(trimmed);
  }

  /**
   * Parse an atomic expression (Fraction literal, variable reference, etc.)
   */
  parseAtomic(expr) {
    const trimmed = this.stripOuterParens(expr.trim());

    // 1. Try Fraction literal: new Fraction(n) or new Fraction(n, d)
    // Must match exactly (no trailing method calls)
    const fracMatch = trimmed.match(/^new\s*Fraction\s*\(\s*([^)]+)\s*\)$/);
    if (fracMatch) {
      const args = fracMatch[1].split(',').map(s => s.trim());
      if (args.length === 1) {
        const num = this.parseNumber(args[0]);
        if (num !== null) {
          const frac = this.decimalToFraction(num);
          return { type: 'const', num: frac.num, den: frac.den };
        }
      } else if (args.length === 2) {
        const num = this.parseNumber(args[0]);
        const den = this.parseNumber(args[1]);
        if (num !== null && den !== null) {
          return { type: 'const', num, den };
        }
      }
    }

    // 2. Try baseNote reference: module.baseNote.getVariable('varName')
    const baseVarMatch = trimmed.match(/^module\.baseNote\.getVariable\s*\(\s*'([^']+)'\s*\)$/);
    if (baseVarMatch) {
      const varName = baseVarMatch[1];
      return { type: 'baseRef', varName };
    }

    // 3. Try note reference: module.getNoteById(id).getVariable('varName')
    const noteVarMatch = trimmed.match(/^module\.getNoteById\s*\(\s*(\d+)\s*\)\.getVariable\s*\(\s*'([^']+)'\s*\)$/);
    if (noteVarMatch) {
      const noteId = parseInt(noteVarMatch[1], 10);
      const varName = noteVarMatch[2];
      return { type: 'noteRef', noteId, varName };
    }

    // 4. Try findTempo: module.findTempo(ref)
    const tempoMatch = trimmed.match(/^module\.findTempo\s*\(\s*(module\.baseNote|module\.getNoteById\s*\(\s*\d+\s*\))\s*\)$/);
    if (tempoMatch) {
      const ref = this.parseRefArg(tempoMatch[1]);
      return { type: 'findTempo', ref };
    }

    // 5. Try findMeasureLength: module.findMeasureLength(ref)
    const measureMatch = trimmed.match(/^module\.findMeasureLength\s*\(\s*(module\.baseNote|module\.getNoteById\s*\(\s*\d+\s*\))\s*\)$/);
    if (measureMatch) {
      const ref = this.parseRefArg(measureMatch[1]);
      return { type: 'findMeasure', ref };
    }

    // 6. Try beat unit pattern: new Fraction(60).div(module.findTempo(ref))
    const beatMatch = trimmed.match(/^new\s*Fraction\s*\(\s*60\s*\)\s*\.div\s*\(\s*module\.findTempo\s*\(\s*(module\.baseNote|module\.getNoteById\s*\(\s*\d+\s*\))\s*\)\s*\)$/);
    if (beatMatch) {
      const ref = this.parseRefArg(beatMatch[1]);
      return { type: 'beatUnit', ref };
    }

    // 7. Try simple number literal (and convert decimals to fractions)
    // Also try stripping parentheses again in case they weren't removed
    let numStr = trimmed;
    while (numStr.startsWith('(') && numStr.endsWith(')')) {
      numStr = numStr.slice(1, -1).trim();
    }
    const numValue = this.parseNumber(numStr);
    if (numValue !== null) {
      const frac = this.decimalToFraction(numValue);
      return { type: 'const', num: frac.num, den: frac.den };
    }

    // 8. Check for .pow() expressions: base.pow(exponent)
    const powResult = this.splitPow(trimmed);
    if (powResult) {
      return {
        type: 'power',
        base: this.parseProduct(powResult.base),
        exponent: this.parseProduct(powResult.exponent)
      };
    }

    // 9. Check for Fraction with method chain: new Fraction(...).mul/div/add/sub(...)
    // This handles expressions like "new Fraction(1, 2).mul(something)"
    const fracChainMatch = trimmed.match(/^new\s*Fraction\s*\(\s*([^)]+)\s*\)\s*\.(mul|div|add|sub|pow)\s*\(/);
    if (fracChainMatch) {
      // Parse as a product/sum - splitMulDiv/splitAddSub should handle this
      const mulDivResult = this.splitMulDiv(trimmed);
      if (mulDivResult.factors.length > 0) {
        return {
          type: 'product',
          base: this.parseAtomic(mulDivResult.base),
          operations: mulDivResult.factors.map(f => ({
            op: f.op,
            node: this.parseAtomic(f.expr)
          }))
        };
      }
      const addSubResult = this.splitAddSub(trimmed);
      if (addSubResult.terms.length > 1) {
        return {
          type: 'sum',
          terms: addSubResult.terms.map(t => ({
            sign: t.sign,
            node: this.parseProduct(t.expr)
          }))
        };
      }
    }

    // 9. Fallback: try splitting by method chains
    const addSubResult = this.splitAddSub(trimmed);
    if (addSubResult.terms.length > 1) {
      return {
        type: 'sum',
        terms: addSubResult.terms.map(t => ({
          sign: t.sign,
          node: this.parseProduct(t.expr)
        }))
      };
    }

    const mulDivResult = this.splitMulDiv(trimmed);
    if (mulDivResult.factors.length > 0) {
      return {
        type: 'product',
        base: this.parseAtomic(mulDivResult.base),
        operations: mulDivResult.factors.map(f => ({
          op: f.op,
          node: this.parseAtomic(f.expr)
        }))
      };
    }

    // 10. Handle bare variable names (legacy compatibility)
    // If someone passes just "tempo" or "beatsPerMeasure", treat as baseNote reference
    const bareVarNames = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    if (bareVarNames.includes(trimmed)) {
      console.warn(`Bare variable name detected: ${trimmed} - treating as module.baseNote.getVariable('${trimmed}')`);
      return { type: 'baseRef', varName: trimmed };
    }

    // Truly opaque - this shouldn't happen for valid expressions
    console.warn(`Unable to parse expression: ${trimmed}`);
    return { type: 'const', num: 0, den: 1 };
  }

  /**
   * Parse a reference argument (module.baseNote or module.getNoteById(n))
   */
  parseRefArg(s) {
    if (/^module\.baseNote$/.test(s.trim())) {
      return { kind: 'base' };
    }
    const match = s.match(/module\.getNoteById\s*\(\s*(\d+)\s*\)/);
    if (match) {
      return { kind: 'note', id: parseInt(match[1], 10) };
    }
    return { kind: 'base' };
  }

  /**
   * Parse a number (integer or float)
   * Returns number for small values, BigInt string for large integers, or null if invalid
   */
  parseNumber(s) {
    const trimmed = s.trim();

    // Check if this looks like an integer (possibly large)
    if (/^-?\d+$/.test(trimmed)) {
      // For large integers that exceed safe integer range, return as string
      // The emitConstant function will convert to BigInt
      const num = Number(trimmed);
      if (Number.isSafeInteger(num)) {
        return num;
      }
      // For large integers, return the string - BigInt(str) will be used later
      return trimmed;
    }

    // Handle floats
    const num = Number(trimmed);
    if (isFinite(num) && !isNaN(num)) {
      return num;
    }
    return null;
  }

  /**
   * Convert a decimal number to fraction components { num, den }
   */
  decimalToFraction(value) {
    if (Number.isInteger(value)) {
      return { num: value, den: 1 };
    }

    // Handle common decimal fractions
    const tolerance = 1e-10;
    const maxDen = 10000;

    // Check for exact simple fractions first
    const simpleTests = [
      [0.25, 1, 4], [0.5, 1, 2], [0.75, 3, 4],
      [0.125, 1, 8], [0.375, 3, 8], [0.625, 5, 8], [0.875, 7, 8],
      [0.2, 1, 5], [0.4, 2, 5], [0.6, 3, 5], [0.8, 4, 5],
      [0.333333, 1, 3], [0.666666, 2, 3],
      [0.1666666, 1, 6], [0.8333333, 5, 6],
      // Common values > 1
      [1.25, 5, 4], [1.5, 3, 2], [1.75, 7, 4], [2.5, 5, 2],
    ];

    const absVal = Math.abs(value);
    const sign = value < 0 ? -1 : 1;

    for (const [dec, n, d] of simpleTests) {
      if (Math.abs(absVal - dec) < tolerance) {
        return { num: sign * n, den: d };
      }
    }

    // Use continued fraction approximation for other decimals
    let num = 1, den = 1;
    let bestNum = Math.round(value), bestDen = 1;
    let bestErr = Math.abs(value - bestNum);

    for (let d = 1; d <= maxDen; d++) {
      const n = Math.round(value * d);
      const err = Math.abs(value - n / d);
      if (err < bestErr) {
        bestNum = n;
        bestDen = d;
        bestErr = err;
        if (err < tolerance) break;
      }
    }

    return { num: bestNum, den: bestDen };
  }

  /**
   * Split expression by top-level .add()/.sub() calls
   */
  splitAddSub(expr) {
    const terms = [];
    let depth = 0;
    let i = 0;
    let lastSplit = 0;
    let currentSign = 1;

    // First term has positive sign by default
    let foundFirst = false;

    while (i < expr.length) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0) {
        if (expr.startsWith('.add(', i)) {
          if (!foundFirst) {
            terms.push({ sign: currentSign, expr: expr.substring(lastSplit, i).trim() });
            foundFirst = true;
          }
          const { arg, nextIndex } = this.readCallArgument(expr, i + 5);
          terms.push({ sign: 1, expr: arg });
          i = nextIndex - 1;
          lastSplit = nextIndex;
        } else if (expr.startsWith('.sub(', i)) {
          if (!foundFirst) {
            terms.push({ sign: currentSign, expr: expr.substring(lastSplit, i).trim() });
            foundFirst = true;
          }
          const { arg, nextIndex } = this.readCallArgument(expr, i + 5);
          terms.push({ sign: -1, expr: arg });
          i = nextIndex - 1;
          lastSplit = nextIndex;
        }
      }
      i++;
    }

    // If no splits found, return original as single term
    if (!foundFirst) {
      return { terms: [{ sign: 1, expr: expr.trim() }] };
    }

    return { terms };
  }

  /**
   * Split expression by top-level .pow() calls
   * Returns { base, exponent } if found, or null
   */
  splitPow(expr) {
    let depth = 0;
    let i = 0;

    while (i < expr.length) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0 && expr.startsWith('.pow(', i)) {
        const base = expr.substring(0, i).trim();
        const { arg, nextIndex } = this.readCallArgument(expr, i + 5);

        // Check if there are more operations after .pow()
        // If so, we need to handle it differently
        if (nextIndex < expr.length) {
          // There's more after .pow(), so we can't split here as a simple pow
          // Return null and let the normal product/sum handling deal with it
          return null;
        }

        return { base, exponent: arg };
      }
      i++;
    }

    return null;
  }

  /**
   * Split expression by top-level .mul()/.div() calls
   */
  splitMulDiv(expr) {
    const factors = [];
    let depth = 0;
    let i = 0;
    let base = '';

    // Find first .mul or .div at depth 0
    let firstOp = -1;
    while (i < expr.length) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0) {
        if (expr.startsWith('.mul(', i) || expr.startsWith('.div(', i)) {
          firstOp = i;
          break;
        }
      }
      i++;
    }

    if (firstOp === -1) {
      return { base: expr.trim(), factors: [] };
    }

    base = expr.substring(0, firstOp).trim();
    i = firstOp;
    depth = 0;

    while (i < expr.length) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0) {
        if (expr.startsWith('.mul(', i)) {
          const { arg, nextIndex } = this.readCallArgument(expr, i + 5);
          factors.push({ op: 'mul', expr: arg });
          i = nextIndex - 1;
        } else if (expr.startsWith('.div(', i)) {
          const { arg, nextIndex } = this.readCallArgument(expr, i + 5);
          factors.push({ op: 'div', expr: arg });
          i = nextIndex - 1;
        }
      }
      i++;
    }

    return { base, factors };
  }

  /**
   * Read a call argument starting at given index (after opening paren)
   */
  readCallArgument(expr, startIndex) {
    let depth = 0;
    let i = startIndex;

    while (i < expr.length) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) {
          return { arg: expr.substring(startIndex, i).trim(), nextIndex: i + 1 };
        }
        depth--;
      }
      i++;
    }

    return { arg: expr.substring(startIndex).trim(), nextIndex: expr.length };
  }

  /**
   * Strip outer parentheses if they match
   */
  stripOuterParens(s) {
    const trimmed = s.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
      return trimmed;
    }

    // Check if outer parens are matching
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') depth++;
      else if (trimmed[i] === ')') {
        depth--;
        if (depth === 0 && i !== trimmed.length - 1) {
          return trimmed; // Outer parens don't match
        }
      }
    }

    if (depth === 0) {
      return trimmed.substring(1, trimmed.length - 1).trim();
    }
    return trimmed;
  }

  /**
   * Emit bytecode for an AST node
   */
  emitBytecode(ast, binary) {
    switch (ast.type) {
      case 'const':
        this.emitConstant(binary, ast.num, ast.den);
        break;

      case 'baseRef':
        this.emitBaseRef(binary, ast.varName);
        break;

      case 'noteRef':
        this.emitNoteRef(binary, ast.noteId, ast.varName);
        break;

      case 'findTempo':
        this.emitFindTempo(binary, ast.ref);
        break;

      case 'findMeasure':
        this.emitFindMeasure(binary, ast.ref);
        break;

      case 'beatUnit':
        // Beat unit = 60 / tempo
        // Emit: LOAD_CONST 60, FIND_TEMPO, DIV
        this.emitConstant(binary, 60, 1);
        this.emitFindTempo(binary, ast.ref);
        binary.writeByte(OP.DIV);
        break;

      case 'sum':
        this.emitSum(binary, ast.terms);
        break;

      case 'product':
        this.emitProduct(binary, ast.base, ast.operations);
        break;

      case 'power':
        // Emit base, then exponent, then POW opcode
        this.emitBytecode(ast.base, binary);
        this.emitBytecode(ast.exponent, binary);
        binary.writeByte(OP.POW);
        break;

      default:
        console.warn(`Unknown AST node type: ${ast.type}`);
        this.emitConstant(binary, 0, 1);
    }
  }

  /**
   * Emit a constant Fraction
   * Automatically chooses LOAD_CONST for small values or LOAD_CONST_BIG for large values
   */
  emitConstant(binary, num, den) {
    // Check if inputs are integers (as number or string)
    const numIsInteger = (typeof num === 'string' && /^-?\d+$/.test(num)) || Number.isInteger(num);
    const denIsInteger = (typeof den === 'string' && /^-?\d+$/.test(den)) || Number.isInteger(den);

    // Convert to BigInt for range checking and to handle large values
    let finalNumBig = BigInt(num);
    let finalDenBig = BigInt(den);

    // For decimal inputs, convert to fraction first
    if (!numIsInteger || !denIsInteger) {
      const value = Number(num) / Number(den);
      const frac = this.decimalToFraction(value);
      finalNumBig = BigInt(frac.num);
      finalDenBig = BigInt(frac.den);
    }

    // Normalize using Fraction.js for proper reduction (if values fit in safe integer range)
    const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
    const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

    if (finalNumBig >= MIN_SAFE && finalNumBig <= MAX_SAFE &&
        finalDenBig >= MIN_SAFE && finalDenBig <= MAX_SAFE) {
      try {
        const frac = new Fraction(Number(finalNumBig), Number(finalDenBig));
        finalNumBig = BigInt(frac.s) * BigInt(frac.n);
        finalDenBig = BigInt(frac.d);
      } catch (e) {
        console.warn(`Fraction normalization failed for ${num}/${den}:`, e);
      }
    }
    // For very large values, we skip Fraction.js normalization and trust the input is already reduced

    // Check if values fit in i32 range for backward-compatible LOAD_CONST
    const MIN_I32 = -2147483648n;
    const MAX_I32 = 2147483647n;

    if (finalNumBig >= MIN_I32 && finalNumBig <= MAX_I32 &&
        finalDenBig >= MIN_I32 && finalDenBig <= MAX_I32) {
      // Use legacy format for backward compatibility
      binary.writeByte(OP.LOAD_CONST);
      binary.writeInt32(Number(finalNumBig));
      binary.writeInt32(Number(finalDenBig));
    } else {
      // Use new BigInt format for large values
      binary.writeByte(OP.LOAD_CONST_BIG);
      binary.writeBigIntSigned(finalNumBig);
      binary.writeBigIntUnsigned(finalDenBig < 0n ? -finalDenBig : finalDenBig);
    }
  }

  /**
   * Emit a baseNote variable reference
   */
  emitBaseRef(binary, varName) {
    const varIndex = this.varNameToIndex(varName);
    binary.writeByte(OP.LOAD_BASE);
    binary.writeByte(varIndex);
    binary.referencesBase = true;
    // Note: We don't add note 0 as an explicit dependency here because:
    // 1. The base note (0) referencing itself would create a self-cycle
    // 2. The evaluator already ensures base note is evaluated first
    // 3. referencesBase flag is used separately to track baseNote references
  }

  /**
   * Emit a note variable reference
   */
  emitNoteRef(binary, noteId, varName) {
    const varIndex = this.varNameToIndex(varName);
    binary.writeByte(OP.LOAD_REF);
    binary.writeUint16(noteId);
    binary.writeByte(varIndex);
    binary.addDependency(noteId);
  }

  /**
   * Emit findTempo lookup
   */
  emitFindTempo(binary, ref) {
    if (ref.kind === 'base') {
      binary.writeByte(OP.LOAD_BASE);
      binary.writeByte(VAR.TEMPO);
      binary.referencesBase = true;
      // Note: Don't add explicit dependency on 0 to avoid self-cycle on base note
    } else {
      binary.writeByte(OP.LOAD_REF);
      binary.writeUint16(ref.id);
      binary.writeByte(VAR.TEMPO);
      binary.addDependency(ref.id);
    }
  }

  /**
   * Emit findMeasureLength lookup
   */
  emitFindMeasure(binary, ref) {
    if (ref.kind === 'base') {
      binary.writeByte(OP.LOAD_BASE);
      binary.writeByte(VAR.MEASURE_LENGTH);
      binary.referencesBase = true;
      // Note: Don't add explicit dependency on 0 to avoid self-cycle on base note
    } else {
      binary.writeByte(OP.LOAD_REF);
      binary.writeUint16(ref.id);
      binary.writeByte(VAR.MEASURE_LENGTH);
      binary.addDependency(ref.id);
    }
  }

  /**
   * Emit a sum of terms
   */
  emitSum(binary, terms) {
    if (terms.length === 0) {
      this.emitConstant(binary, 0, 1);
      return;
    }

    // Emit first term
    const first = terms[0];
    this.emitBytecode(first.node, binary);
    if (first.sign < 0) {
      binary.writeByte(OP.NEG);
    }

    // Emit remaining terms with add/sub
    for (let i = 1; i < terms.length; i++) {
      const term = terms[i];
      this.emitBytecode(term.node, binary);
      if (term.sign < 0) {
        binary.writeByte(OP.SUB);
      } else {
        binary.writeByte(OP.ADD);
      }
    }
  }

  /**
   * Emit a product of factors
   */
  emitProduct(binary, base, operations) {
    // Emit base
    this.emitBytecode(base, binary);

    // Apply operations
    for (const op of operations) {
      this.emitBytecode(op.node, binary);
      if (op.op === 'mul') {
        binary.writeByte(OP.MUL);
      } else if (op.op === 'div') {
        binary.writeByte(OP.DIV);
      }
    }
  }

  /**
   * Convert variable name to index
   */
  varNameToIndex(varName) {
    switch (varName) {
      case 'startTime': return VAR.START_TIME;
      case 'duration': return VAR.DURATION;
      case 'frequency': return VAR.FREQUENCY;
      case 'tempo': return VAR.TEMPO;
      case 'beatsPerMeasure': return VAR.BEATS_PER_MEASURE;
      case 'measureLength': return VAR.MEASURE_LENGTH;
      default:
        console.warn(`Unknown variable name: ${varName}`);
        return VAR.START_TIME;
    }
  }
}

/**
 * Decompiler: Binary bytecode → Text expression
 * Used for JSON serialization to maintain backwards compatibility
 */
export class ExpressionDecompiler {
  /**
   * Decompile binary bytecode back to text expression
   *
   * @param {BinaryExpression} binary - The binary expression
   * @returns {string} - The text expression
   */
  decompile(binary) {
    // If we have the original source text, use it
    if (binary.sourceText) {
      return binary.sourceText;
    }

    if (binary.isEmpty()) {
      return 'new Fraction(0, 1)';
    }

    // Stack-based decompilation
    const stack = [];
    const bytecode = binary.bytecode;
    let pc = 0;

    while (pc < binary.length) {
      const op = bytecode[pc++];

      switch (op) {
        case OP.LOAD_CONST: {
          const num = this.readInt32(bytecode, pc);
          pc += 4;
          const den = this.readInt32(bytecode, pc);
          pc += 4;
          if (den === 1) {
            stack.push(`new Fraction(${num})`);
          } else {
            stack.push(`new Fraction(${num}, ${den})`);
          }
          break;
        }

        case OP.LOAD_CONST_BIG: {
          // Read signed numerator
          const { value: num, bytesRead: numBytes } = this.readBigIntSigned(bytecode, pc);
          pc += numBytes;
          // Read unsigned denominator
          const { value: den, bytesRead: denBytes } = this.readBigIntUnsigned(bytecode, pc);
          pc += denBytes;
          if (den === 1n) {
            stack.push(`new Fraction(${num})`);
          } else {
            stack.push(`new Fraction(${num}, ${den})`);
          }
          break;
        }

        case OP.LOAD_REF: {
          const noteId = this.readUint16(bytecode, pc);
          pc += 2;
          const varIdx = bytecode[pc++];
          const varName = this.indexToVarName(varIdx);
          stack.push(`module.getNoteById(${noteId}).getVariable('${varName}')`);
          break;
        }

        case OP.LOAD_BASE: {
          const varIdx = bytecode[pc++];
          const varName = this.indexToVarName(varIdx);
          stack.push(`module.baseNote.getVariable('${varName}')`);
          break;
        }

        case OP.ADD: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(`${a}.add(${b})`);
          break;
        }

        case OP.SUB: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(`${a}.sub(${b})`);
          break;
        }

        case OP.MUL: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(`${a}.mul(${b})`);
          break;
        }

        case OP.DIV: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(`${a}.div(${b})`);
          break;
        }

        case OP.NEG: {
          const a = stack.pop();
          stack.push(`${a}.neg()`);
          break;
        }

        case OP.POW: {
          const exp = stack.pop();
          const base = stack.pop();
          stack.push(`${base}.pow(${exp})`);
          break;
        }

        case OP.FIND_TEMPO: {
          const ref = stack.pop();
          stack.push(`module.findTempo(${ref})`);
          break;
        }

        case OP.FIND_MEASURE: {
          const ref = stack.pop();
          stack.push(`module.findMeasureLength(${ref})`);
          break;
        }

        case OP.DUP: {
          const top = stack[stack.length - 1];
          stack.push(top);
          break;
        }

        case OP.SWAP: {
          const a = stack.pop();
          const b = stack.pop();
          stack.push(a);
          stack.push(b);
          break;
        }

        default:
          console.warn(`Unknown opcode during decompilation: 0x${op.toString(16)}`);
          break;
      }
    }

    return stack.length > 0 ? stack[0] : 'new Fraction(0, 1)';
  }

  readUint16(bytecode, offset) {
    return (bytecode[offset] << 8) | bytecode[offset + 1];
  }

  readInt32(bytecode, offset) {
    const val = (bytecode[offset] << 24) |
                (bytecode[offset + 1] << 16) |
                (bytecode[offset + 2] << 8) |
                bytecode[offset + 3];
    return val | 0;
  }

  /**
   * Read a signed BigInt from bytecode
   * Format: [sign(1)] [len(2)] [bytes(n)]
   * @returns {{ value: bigint, bytesRead: number }}
   */
  readBigIntSigned(bytecode, offset) {
    const sign = bytecode[offset];
    const { value: magnitude, bytesRead: magBytes } = this.readBigIntUnsigned(bytecode, offset + 1);
    const value = sign === 0x01 ? -magnitude : magnitude;
    return { value, bytesRead: 1 + magBytes };
  }

  /**
   * Read an unsigned BigInt from bytecode
   * Format: [len(2)] [bytes(n)]
   * @returns {{ value: bigint, bytesRead: number }}
   */
  readBigIntUnsigned(bytecode, offset) {
    const len = (bytecode[offset] << 8) | bytecode[offset + 1];
    let value = 0n;
    for (let i = 0; i < len; i++) {
      value = (value << 8n) | BigInt(bytecode[offset + 2 + i]);
    }
    return { value, bytesRead: 2 + len };
  }

  indexToVarName(idx) {
    switch (idx) {
      case VAR.START_TIME: return 'startTime';
      case VAR.DURATION: return 'duration';
      case VAR.FREQUENCY: return 'frequency';
      case VAR.TEMPO: return 'tempo';
      case VAR.BEATS_PER_MEASURE: return 'beatsPerMeasure';
      case VAR.MEASURE_LENGTH: return 'measureLength';
      default: return 'startTime';
    }
  }
}

// Export singleton instances for convenience
export const compiler = new ExpressionCompiler();
export const decompiler = new ExpressionDecompiler();
