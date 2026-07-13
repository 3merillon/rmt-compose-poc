/**
 * DSL Expression Simplifier
 *
 * Folds the rational coefficients of a DSL expression while leaving every note
 * reference, helper call and irrational power exactly where the author put them.
 *
 * The normal form mirrors the evaluator's SymbolicPower algebra (see
 * binary-evaluator.js): a value is a rational coefficient times a product of
 * base^exp terms, and like-base powers merge by adding exponents. Coefficients
 * never migrate into a power term, so a TET expression keeps its shape:
 *
 *   2 * (1/2) * base.f            -> base.f
 *   (1/2) * (1/2) * 2 * 2 * base.f -> base.f
 *   2 * base.f * 2^(7/12)         -> 2 * base.f * 2^(7/12)   (coefficient stays out of the power)
 *   2^(1/12) * 2^(1/12) * base.f  -> base.f * 2^(1/6)        (like bases merge, still irrational)
 *
 * Whether a note reads as "corrupted" (crosshatched) is decided by the POW
 * opcode producing an irrational, so preserving the power terms preserves the
 * crosshatching. Callers additionally re-evaluate before/after and reject any
 * rewrite that moves the value or the corruption flag (see utils/simplify.js).
 */
import Fraction from 'fraction.js';
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { NodeType } from './ast.js';
import { getShortPropertyName } from './constants.js';

// Precedence levels of an emitted string, used to decide parenthesisation.
// Mirrors the grammar in parser.js: the base of '^' must be a `primary`, so it
// needs ATOMIC; an operand of '*' needs MULTIPLICATIVE.
const PREC = {
  ADDITIVE: 1,
  MULTIPLICATIVE: 2,
  UNARY: 3,
  POWER: 4,
  ATOMIC: 5,
};

/** Thrown when a construct cannot be canonicalised; the caller keeps the original. */
class Bail extends Error {}

/**
 * Simplify a DSL expression string.
 * Returns the original string unchanged if it cannot be canonicalised.
 *
 * @param {string} expr - DSL expression
 * @returns {string} Simplified DSL expression
 */
export function simplifyDSL(expr) {
  return rewrite(expr, null) ?? expr;
}

/**
 * Multiply a DSL expression by a rational factor, folding it into the
 * expression's coefficient rather than prepending another multiplier.
 *
 * @param {string} expr - DSL expression
 * @param {number} num - Factor numerator
 * @param {number} den - Factor denominator
 * @returns {string} Scaled DSL expression
 */
export function scaleDSL(expr, num, den) {
  const factor = new Fraction(num, den);
  const scaled = rewrite(expr, factor);
  if (scaled !== null) return scaled;

  // Canonicalisation bailed. Fall back to an explicit multiplier, parenthesised
  // so the factor still applies to the whole expression when it is a sum.
  return `${emitConstant(factor)} * (${expr})`;
}

/**
 * Canonicalise `expr`, optionally scaling every term by `factor`.
 * Returns null when the expression cannot be canonicalised.
 */
function rewrite(expr, factor) {
  const source = (expr || '').trim();
  if (!source) return null;

  try {
    const terms = canonicalize(parse(tokenize(source)), { order: 0 });
    if (factor) {
      for (const term of terms) term.coeff = term.coeff.mul(factor);
    }
    return emitSum(group(terms));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Canonical model
// ─────────────────────────────────────────────────────────────────
//
// A canonicalised expression is a list of Terms (a sum).
//
//   Term = {
//     coeff: Fraction,             // folded rational multiplier
//     coeffOrder: number,          // source position of the first constant, for emission order
//     factors: Map<string, Factor> // keyed by the factor's base string
//   }
//
//   Factor = {
//     key: string,     // base string, used to merge like factors
//     str: string,     // emitted base, e.g. "base.f", "2", "(x + y)"
//     prec: number,    // precedence of `str`
//     exp: Fraction,   // exponent; negative exponents emit as divisors
//     order: number,   // source position, for emission order
//     isConst: boolean // true for a numeric base, e.g. the 2 in 2^(1/12)
//   }
//
// Terms are grouped by their factor signature, so `base.f + base.f` collapses to
// `2 * base.f`. Products are never distributed over sums: a sum used as a factor
// becomes an opaque atom, which keeps `(1/2) * 2 * (a + b)` collapsing to `a + b`
// without exploding the expression.

function newTerm(coeff = new Fraction(1)) {
  return { coeff, coeffOrder: Infinity, factors: new Map() };
}

/**
 * Canonicalise an AST node into a sum of terms.
 * @param {Object} node - AST node
 * @param {{order: number}} ctx - Shared source-position counter
 * @returns {Array} Terms
 */
function canonicalize(node, ctx) {
  switch (node.type) {
    case NodeType.NumberLiteral:
    case NodeType.FractionLiteral: {
      const term = newTerm(new Fraction(node.numerator, node.denominator));
      term.coeffOrder = ctx.order++;
      return [term];
    }

    case NodeType.NoteReference:
    case NodeType.HelperCall:
      return [termFromAtom(atomFor(node), ctx)];

    case NodeType.UnaryOp: {
      if (node.operator !== '-') throw new Bail();
      const terms = canonicalize(node.operand, ctx);
      for (const term of terms) term.coeff = term.coeff.neg();
      return terms;
    }

    case NodeType.BinaryOp:
      return canonicalizeBinary(node, ctx);

    default:
      throw new Bail();
  }
}

function canonicalizeBinary(node, ctx) {
  const { operator: op } = node;

  if (op === '+' || op === '-') {
    const left = canonicalize(node.left, ctx);
    const right = canonicalize(node.right, ctx);
    if (op === '-') {
      for (const term of right) term.coeff = term.coeff.neg();
    }
    return [...left, ...right];
  }

  if (op === '*' || op === '/') {
    const left = collapse(canonicalize(node.left, ctx), ctx);
    const right = collapse(canonicalize(node.right, ctx), ctx);
    if (op === '/' && right.coeff.n === 0) throw new Bail(); // division by zero
    return [mulTerms(left, right, op === '/')];
  }

  if (op === '^') return [canonicalizePow(node, ctx)];

  throw new Bail();
}

/**
 * Canonicalise `base ^ exponent`.
 *
 * A constant base raised to a rational exponent follows the evaluator exactly:
 * if the result is rational it folds into the coefficient (so 4^(1/2) is 2, and
 * is not corrupted), otherwise it becomes a power factor that merges with other
 * powers of the same base — never with the coefficient.
 */
function canonicalizePow(node, ctx) {
  const exponent = collapse(canonicalize(node.right, ctx), ctx);
  // Only a rational exponent can be reasoned about symbolically.
  if (exponent.factors.size > 0) return termFromAtom(opaqueAtom(node), ctx);
  const exp = exponent.coeff;

  const base = collapse(canonicalize(node.left, ctx), ctx);

  // Constant base: mirror MusicValue.pow / tryRationalPower.
  if (base.factors.size === 0) {
    const rational = tryRationalPow(base.coeff, exp);
    if (rational) {
      const term = newTerm(rational);
      term.coeffOrder = Math.min(base.coeffOrder, exponent.coeffOrder);
      return term;
    }

    // Irrational. The evaluator only keeps a symbolic form for positive integer
    // bases; anything else degrades to a plain f64, which we must not reshape.
    const baseValue = base.coeff.valueOf();
    if (!Number.isInteger(baseValue) || baseValue <= 0) {
      return termFromAtom(opaqueAtom(node), ctx);
    }

    const term = newTerm();
    const order = ctx.order++;
    const str = String(baseValue);
    term.factors.set(str, {
      key: str, str, prec: PREC.ATOMIC, exp, order, isConst: true,
    });
    return term;
  }

  // Non-constant base (e.g. base.f^2). Distributing the exponent is only exact
  // when the coefficient survives it rationally.
  const coeff = tryRationalPow(base.coeff, exp);
  if (!coeff) return termFromAtom(opaqueAtom(node), ctx);

  const term = newTerm(coeff);
  term.coeffOrder = base.coeffOrder;
  for (const factor of base.factors.values()) {
    term.factors.set(factor.key, { ...factor, exp: factor.exp.mul(exp) });
  }
  return term;
}

/**
 * Reduce a sum to a single term. A multi-term sum becomes an opaque atom so we
 * never distribute a product over it.
 */
function collapse(terms, ctx) {
  const grouped = group(terms);
  if (grouped.length === 0) return newTerm(new Fraction(0));
  if (grouped.length === 1) return grouped[0];

  const str = emitSum(grouped);
  const term = newTerm();
  term.factors.set(str, {
    key: str,
    str,
    prec: PREC.ADDITIVE, // parenthesised by whoever consumes it, if they need it
    exp: new Fraction(1),
    order: ctx.order++,
    isConst: false,
  });
  return term;
}

/** Multiply (or divide) two terms, merging like factors by adding exponents. */
function mulTerms(a, b, invert) {
  const term = newTerm(invert ? a.coeff.div(b.coeff) : a.coeff.mul(b.coeff));
  term.coeffOrder = Math.min(a.coeffOrder, b.coeffOrder);

  for (const factor of a.factors.values()) mergeFactor(term, factor, factor.exp);
  for (const factor of b.factors.values()) {
    mergeFactor(term, factor, invert ? factor.exp.neg() : factor.exp);
  }

  normalizeFactors(term);
  return term;
}

function mergeFactor(term, factor, exp) {
  const existing = term.factors.get(factor.key);
  if (existing) {
    existing.exp = existing.exp.add(exp);
  } else {
    term.factors.set(factor.key, { ...factor, exp });
  }
}

/**
 * Drop factors that cancelled out, and fold constant powers that became rational.
 *
 * The fold matches SymbolicPower.isRational(): only an integer exponent counts.
 * A merged exponent that is still fractional (4^(1/4) * 4^(1/4) = 4^(1/2)) stays
 * a power term, exactly as the evaluator leaves it symbolic — and so stays
 * flagged as corrupted.
 */
function normalizeFactors(term) {
  for (const [key, factor] of [...term.factors]) {
    if (factor.exp.n === 0) {
      term.factors.delete(key);
      continue;
    }
    if (factor.isConst && factor.exp.d === 1) {
      term.coeff = term.coeff.mul(new Fraction(Number(factor.str)).pow(factor.exp));
      term.coeffOrder = Math.min(term.coeffOrder, factor.order);
      term.factors.delete(key);
    }
  }
}

/** Sum terms that share the same factors, and drop the ones that cancelled to zero. */
function group(terms) {
  const groups = new Map();

  for (const term of terms) {
    const signature = [...term.factors.values()]
      .map(f => `${f.key}^${f.exp.toFraction()}`)
      .sort()
      .join('*');

    const existing = groups.get(signature);
    if (existing) {
      existing.coeff = existing.coeff.add(term.coeff);
      existing.coeffOrder = Math.min(existing.coeffOrder, term.coeffOrder);
    } else {
      groups.set(signature, term);
    }
  }

  return [...groups.values()].filter(term => term.coeff.n !== 0);
}

/** base^exp as an exact rational, or null when irrational. Mirrors tryRationalPower. */
function tryRationalPow(base, exp) {
  if (exp.n === 0) return new Fraction(1);
  try {
    return base.pow(exp); // fraction.js returns null when the result is irrational
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────

function termFromAtom(atom, ctx) {
  const term = newTerm();
  term.factors.set(atom.key, { ...atom, exp: new Fraction(1), order: ctx.order++, isConst: false });
  return term;
}

function atomFor(node) {
  const str = printNode(node);
  return { key: str, str, prec: PREC.ATOMIC };
}

/** A subtree we refuse to reshape; kept verbatim. */
function opaqueAtom(node) {
  const str = printNode(node);
  return { key: str, str, prec: precOf(node) };
}

// ─────────────────────────────────────────────────────────────────
// Emission
// ─────────────────────────────────────────────────────────────────

function emitSum(terms) {
  if (terms.length === 0) return '0';

  // A lone term is the whole expression, so it never needs to be parenthesised
  // against a neighbouring '+' or '-'.
  if (terms.length === 1) return emitTerm(terms[0], true, true);

  let out = emitTerm(terms[0], true, false);
  for (let i = 1; i < terms.length; i++) {
    const term = terms[i];
    if (term.coeff.s < 0) {
      out += ` - ${emitTerm({ ...term, coeff: term.coeff.abs() }, false, false)}`;
    } else {
      out += ` + ${emitTerm(term, false, false)}`;
    }
  }
  return out;
}

/**
 * Emit one term as `coeff * factor * factor / divisor`.
 *
 * Factors keep their source order and the coefficient keeps the slot of the first
 * constant it absorbed, so `base.f * (3/2)` is not churned into `(3/2) * base.f`.
 * A coefficient with no source position (one the arrows introduced) leads.
 *
 * `alone` means the term is the entire expression. Only then may a single sum
 * factor shed its parentheses: as one term among others it must keep them, or a
 * preceding '-' would bind to just the sum's first term.
 */
function emitTerm(term, isFirst, alone) {
  const coeff = isFirst ? term.coeff : term.coeff.abs();
  const factors = [...term.factors.values()];
  const numerators = factors.filter(f => f.exp.s >= 0).sort((a, b) => a.order - b.order);
  const divisors = factors.filter(f => f.exp.s < 0).sort((a, b) => a.order - b.order);

  const parts = numerators.map(f => ({ order: f.order, ...emitFactor(f, f.exp) }));

  const isUnit = coeff.equals(1);
  if (!isUnit || parts.length === 0) {
    const order = term.coeffOrder === Infinity ? -1 : term.coeffOrder;
    parts.push({ order, ...emitConstantAtom(coeff) });
    parts.sort((a, b) => a.order - b.order);
  }

  if (alone && parts.length === 1 && divisors.length === 0) {
    return parts[0].str;
  }

  let out = parts.map(inMul).join(' * ');
  for (const factor of divisors) {
    out += ` / ${inDivisor(emitFactor(factor, factor.exp.neg()))}`;
  }
  return out;
}

/** Emit `base` or `base^exp`; `exp` is always positive here. */
function emitFactor(factor, exp) {
  if (exp.equals(1)) return { str: factor.str, prec: factor.prec };

  // The base of '^' must be a primary (see the grammar), so anything below
  // ATOMIC gets parenthesised.
  const base = factor.prec >= PREC.ATOMIC ? factor.str : `(${factor.str})`;
  return { str: `${base}^${emitConstant(exp)}`, prec: PREC.POWER };
}

function emitConstantAtom(frac) {
  return { str: emitConstant(frac), prec: frac.s < 0 ? PREC.UNARY : PREC.ATOMIC };
}

/** Integers print bare; fractions print as `(n/d)`, which the lexer reads as one literal. */
function emitConstant(frac) {
  const n = frac.s * frac.n;
  return frac.d === 1 ? String(n) : `(${n}/${frac.d})`;
}

function inMul({ str, prec }) {
  return prec >= PREC.MULTIPLICATIVE ? str : `(${str})`;
}

function inDivisor({ str, prec }) {
  // '/' is left-associative, so its right operand must bind tighter than '*'.
  return prec > PREC.MULTIPLICATIVE ? str : `(${str})`;
}

// ─────────────────────────────────────────────────────────────────
// AST printer (verbatim re-emission of subtrees we do not reshape)
// ─────────────────────────────────────────────────────────────────

function precOf(node) {
  switch (node.type) {
    case NodeType.NumberLiteral:
    case NodeType.FractionLiteral:
      return node.numerator < 0 ? PREC.UNARY : PREC.ATOMIC;
    case NodeType.NoteReference:
    case NodeType.HelperCall:
      return PREC.ATOMIC;
    case NodeType.UnaryOp:
      return PREC.UNARY;
    case NodeType.BinaryOp:
      if (node.operator === '^') return PREC.POWER;
      if (node.operator === '*' || node.operator === '/') return PREC.MULTIPLICATIVE;
      return PREC.ADDITIVE;
    default:
      throw new Bail();
  }
}

function printNode(node) {
  switch (node.type) {
    case NodeType.NumberLiteral:
    case NodeType.FractionLiteral:
      return emitConstant(new Fraction(node.numerator, node.denominator));

    case NodeType.NoteReference: {
      const target = node.noteId === 'base' ? 'base' : `[${node.noteId}]`;
      return `${target}.${getShortPropertyName(node.property)}`;
    }

    case NodeType.HelperCall: {
      const arg = node.noteArg === 'base' ? 'base' : `[${node.noteArg}]`;
      return `${node.helper}(${arg})`;
    }

    case NodeType.UnaryOp:
      return `-${wrap(node.operand, PREC.UNARY)}`;

    case NodeType.BinaryOp: {
      const op = node.operator;
      if (op === '^') {
        // Right-associative, and its base must be a primary.
        return `${wrap(node.left, PREC.ATOMIC)}^${wrap(node.right, PREC.POWER)}`;
      }
      const prec = (op === '*' || op === '/') ? PREC.MULTIPLICATIVE : PREC.ADDITIVE;
      // Left-associative: the right operand must bind strictly tighter.
      return `${wrap(node.left, prec)} ${op} ${wrap(node.right, prec + 1)}`;
    }

    default:
      throw new Bail();
  }
}

function wrap(node, required) {
  const str = printNode(node);
  return precOf(node) >= required ? str : `(${str})`;
}
