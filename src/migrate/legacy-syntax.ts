import type { AstNode } from '../dsl/ast.ts';
import type { BinaryExpression, ExpressionName } from '../binary-note.ts';
import type { InputScore } from '../model-types.ts';
/**
 * Convert expressions written in the retired method-chain syntax to the DSL.
 *
 * Old:  module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))
 * New:  [3].f * (3/2)
 *
 * RMT Compose has one expression language, the DSL. Modules saved in the old
 * syntax are converted once, when they are loaded (Module.loadFromJSON, right
 * after the relational-time conversion), and nothing after that ever sees the
 * old text.
 *
 * The conversion is exact and refuses rather than guesses:
 *  - The parser below accepts exactly the old building blocks: `new Fraction(a)`
 *    and `new Fraction(a, b)` with decimal arguments, bare decimals,
 *    `module.baseNote.getVariable('x')`, `module.getNoteById(N).getVariable('x')`,
 *    a bare variable name (which the old compiler read as the BaseNote's),
 *    parentheses, and `.mul .div .add .sub .pow` calls.
 *  - A chain must call its methods in the order `.pow`, then `.mul`/`.div`, then
 *    `.add`/`.sub`, each group optional. Only for that shape did the old compiler
 *    read the text the way it is written: it silently dropped a `.mul()` or
 *    `.div()` that followed an `.add()`, a `.pow()` that followed a `.mul()`, and
 *    every `.neg()`. For any other order the text and the old engine disagree,
 *    and the conversion refuses.
 *  - The DSL text is checked by compiling it: it must give the same bytecode as
 *    the parsed expression, or the conversion refuses.
 *
 * scripts/test-legacy-syntax.mjs checks every converted value against values
 * recorded with the old compiler (scripts/fixtures/legacy-syntax-oracle.json).
 */
import { createFractionLiteral, createNoteReference, createBinaryOp, createUnaryOp } from '../dsl/ast.ts';
import { compile as compileAST } from '../dsl/compiler.ts';
import { compileDSL, decompileToDSL } from '../dsl/index.ts';
import { decimalStringToBigFraction } from '../utils/fraction-num.ts';
import { MAX_NOTE_ID } from '../binary-note.ts';

export class SyntaxMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyntaxMigrationError';
  }
}

const EXPR_KEYS: ExpressionName[] = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];
const VARIABLES = new Set<string>(EXPR_KEYS);
const isVariable = (name: string): name is ExpressionName => VARIABLES.has(name);
const METHODS = new Set(['mul', 'div', 'add', 'sub', 'pow']);
const OPERATOR = { mul: '*', div: '/', add: '+', sub: '-', pow: '^' } as const;
// Method order within one chain: pow (rank 0), mul/div (1), add/sub (2).
const RANK = { pow: 0, mul: 1, div: 1, add: 2, sub: 2 };

const isMethod = (name: string): name is keyof typeof OPERATOR => METHODS.has(name);

const LEGACY_MARKER = /new\s+Fraction\s*\(|\bmodule\s*\.|\.\s*getVariable\s*\(|\.\s*(?:mul|div|add|sub|pow|neg)\s*\(/;

/**
 * Is this text in the old method-chain syntax? True for anything carrying one
 * of its markers, and for a bare variable name ("frequency"), which the old
 * compiler read as the BaseNote's variable.
 */
export function isLegacyExpression(text: unknown) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  return LEGACY_MARKER.test(t) || VARIABLES.has(t);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

function tokenize(src: string) {
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|'([A-Za-z_][A-Za-z0-9_]*)'|([().,\-]))/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new SyntaxMigrationError(`unexpected "${src.slice(i, i + 12)}"`);
    if (m[1] !== undefined) toks.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) toks.push({ k: 'id', v: m[2] });
    else if (m[3] !== undefined) toks.push({ k: 'str', v: m[3] });
    else toks.push({ k: m[4], v: m[4] });
    i = re.lastIndex;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Parser: old text -> DSL syntax tree
// ---------------------------------------------------------------------------

function parseLegacy(src: string): AstNode {
  const toks = tokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const is = (k: string, v?: string) => peek() && peek().k === k && (v === undefined || peek().v === v);
  const eat = (k: string, v?: string) => {
    if (!is(k, v)) {
      const t = peek();
      throw new SyntaxMigrationError(`expected ${v ?? k} but found ${t ? `"${t.v}"` : 'the end'}`);
    }
    return toks[p++];
  };

  // A decimal, optionally signed: an argument of new Fraction() or a bare number.
  function decimal() {
    let sign = '';
    if (is('-')) { p++; sign = '-'; }
    const t = eat('num');
    const f = decimalStringToBigFraction(sign + t.v);
    if (!f) throw new SyntaxMigrationError(`"${sign}${t.v}" is not a number`);
    return f;
  }

  function constant(num: bigint, den: bigint) {
    if (den === 0n) throw new SyntaxMigrationError('division by zero in a constant');
    if (den < 0n) { num = -num; den = -den; }
    // A negative integer prints as `-3`, which the DSL reads as -(3); build it
    // that way so the printed text compiles to the same bytecode.
    if (den === 1n && num < 0n) return createUnaryOp('-', createFractionLiteral(-num, 1n));
    return createFractionLiteral(num, den);
  }

  function variable() {
    const name = eat('str').v;
    if (!isVariable(name)) throw new SyntaxMigrationError(`unknown variable '${name}'`);
    return name;
  }

  function primary(): AstNode {
    if (is('(')) {
      p++;
      const e = chain();
      eat(')');
      return e;
    }
    if (is('num') || is('-')) {
      const f = decimal();
      return constant(f.num, f.den);
    }
    if (is('id', 'new')) {
      p++;
      eat('id', 'Fraction');
      eat('(');
      const a = decimal();
      let num = a.num, den = a.den;
      if (is(',')) {
        p++;
        const b = decimal();
        num = a.num * b.den;
        den = a.den * b.num;
      }
      eat(')');
      return constant(num, den);
    }
    if (is('id', 'module')) {
      p++;
      eat('.');
      if (is('id', 'baseNote')) {
        p++;
        eat('.'); eat('id', 'getVariable'); eat('(');
        const v = variable();
        eat(')');
        return createNoteReference('base', v);
      }
      eat('id', 'getNoteById');
      eat('(');
      const idTok = eat('num');
      if (!/^\d+$/.test(idTok.v)) throw new SyntaxMigrationError(`note id "${idTok.v}" is not an integer`);
      const id = Number(idTok.v);
      if (id > MAX_NOTE_ID) throw new SyntaxMigrationError(`note id ${id} out of range (max ${MAX_NOTE_ID})`);
      eat(')');
      eat('.'); eat('id', 'getVariable'); eat('(');
      const v = variable();
      eat(')');
      return createNoteReference(id, v);
    }
    const bareName = peek()?.v;
    if (is('id') && isVariable(bareName)) {
      p++;
      return createNoteReference('base', bareName);
    }
    const t = peek();
    throw new SyntaxMigrationError(t ? `unexpected "${t.v}"` : 'unexpected end');
  }

  function chain(): AstNode {
    let node = primary();
    let rank = -1;
    let pows = 0;
    let lastMethod = null;
    while (is('.')) {
      p++;
      const m = eat('id').v;
      if (m === 'neg') {
        throw new SyntaxMigrationError('.neg() was ignored by the old compiler, so what it meant is unclear');
      }
      if (!isMethod(m)) throw new SyntaxMigrationError(`unknown method .${m}()`);
      if (RANK[m] < rank || (m === 'pow' && pows > 0)) {
        throw new SyntaxMigrationError(
          `.${m}() after .${lastMethod}() was not read as written by the old compiler, so what it meant is unclear`
        );
      }
      rank = RANK[m];
      if (m === 'pow') pows++;
      lastMethod = m;
      eat('(');
      const arg = chain();
      eat(')');
      node = createBinaryOp(OPERATOR[m], node, arg);
    }
    return node;
  }

  const tree = chain();
  if (p !== toks.length) throw new SyntaxMigrationError(`unexpected "${peek().v}"`);
  return tree;
}

function sameBytecode(a: BinaryExpression, b: BinaryExpression) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a.bytecode[i] !== b.bytecode[i]) return false;
  return true;
}

/**
 * Convert one expression from the old syntax to the DSL.
 * @param {string} text - old method-chain text
 * @returns {string} DSL text with the same meaning
 * @throws {SyntaxMigrationError} when the text cannot be converted exactly
 */
export function legacyToDSL(text: string) {
  let tree;
  try {
    tree = parseLegacy(String(text).trim());
  } catch (e) {
    if (e instanceof SyntaxMigrationError) {
      throw new SyntaxMigrationError(`cannot convert "${text}": ${e.message}`);
    }
    throw e;
  }
  const expected = compileAST(tree, text);
  const dsl = decompileToDSL(expected);
  let actual;
  try {
    actual = compileDSL(dsl);
  } catch (e) {
    throw new SyntaxMigrationError(`cannot convert "${text}": its DSL form "${dsl}" does not compile (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!sameBytecode(expected, actual)) {
    throw new SyntaxMigrationError(`cannot convert "${text}": its DSL form "${dsl}" compiles to something else`);
  }
  return dsl;
}

/**
 * Convert every old-syntax expression of a module object (as read from JSON).
 * Returns a new object; the input is not modified. DSL expressions are kept
 * as they are. Throws a SyntaxMigrationError naming the note and variable when
 * one expression cannot be converted, so a module never loads with a value
 * read differently from what it says.
 *
 * @param {object} data - { baseNote, notes[] }
 * @returns {{ data: object, migrated: boolean, report: string[] }}
 */
export function migrateSyntax(data: InputScore) {
  const copy: InputScore = JSON.parse(JSON.stringify(data));
  if (!copy || typeof copy !== 'object' || !copy.baseNote || !Array.isArray(copy.notes)) {
    return { data: copy, migrated: false, report: [] };
  }
  let converted = 0;
  for (const note of [copy.baseNote, ...copy.notes]) {
    if (!note || typeof note !== 'object') continue;
    for (const k of EXPR_KEYS) {
      for (const key of [k + 'String', k]) {
        const s = note[key];
        if (typeof s !== 'string' || !isLegacyExpression(s)) continue;
        const where = note === copy.baseNote ? 'BaseNote' : `note ${note.id}`;
        try {
          note[key] = legacyToDSL(s);
        } catch (e) {
          if (e instanceof SyntaxMigrationError) throw new SyntaxMigrationError(`${where} ${k}: ${e.message}`);
          throw e;
        }
        converted++;
      }
    }
  }
  return {
    data: copy,
    migrated: converted > 0,
    report: converted > 0 ? [`${converted} expression(s) converted from the method-chain syntax to the DSL`] : [],
  };
}
