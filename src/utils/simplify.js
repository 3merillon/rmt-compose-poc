/**
 * Expression simplifier and octave-safe multiplier, with an evaluation check.
 *
 * The algebra is the DSL's own (src/dsl/simplify.js: simplifyDSL, scaleDSL).
 * This module adds the safety net the editor relies on: a rewrite is kept only
 * when it evaluates, in the current module, to exactly the same value (and the
 * same corruption flag) as the text it replaces; otherwise the original text
 * is returned unchanged.
 */
import Fraction from 'fraction.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { compileDSL } from '../dsl/index.js';
import { simplifyDSL, scaleDSL } from '../dsl/simplify.js';
import { validateExpressionSyntax } from './safe-expression-validator.js';
import * as X from '../value/exact.js';

// Memoization caches
const __simplifyCache = new Map(); // key: kind + '|' + expr
const __evalBinaryCache = new Map(); // compile cache for safe binary evaluation

// =============== Public API ===============
// `kind` is kept in the signatures for the callers; the DSL's canonical form
// does not depend on it.
export function simplifyGeneric(expr, kind, moduleInstance) {
  return _simplify(expr, kind, moduleInstance);
}

export function simplifyFrequency(expr, moduleInstance) {
  return _simplify(expr, 'frequency', moduleInstance);
}

export function simplifyDuration(expr, moduleInstance) {
  return _simplify(expr, 'duration', moduleInstance);
}

export function simplifyStartTime(expr, moduleInstance) {
  return _simplify(expr, 'startTime', moduleInstance);
}

export function multiplyExpressionByFraction(expr, num, den, kind, moduleInstance) {
  const scaled = scaleDSL(expr, num, den);
  // scaleDSL folds the factor into the expression's coefficient, so it can
  // genuinely get the value wrong. Check it: it must land on exactly
  // `factor x original`, without changing the corruption flag.
  // Values are exact (src/value/exact.js), irrational ones included, so the
  // check is an equality.
  const before = evaluateExpr(expr, moduleInstance);
  const after = evaluateExpr(scaled, moduleInstance);
  if (before && after && after.corrupted === before.corrupted &&
      X.equals(after.value, X.mul(before.value, new Fraction(num, den)))) {
    return scaled;
  }
  // Fall back to an explicit multiplier, parenthesised so it applies to the
  // whole expression even when that expression is a sum.
  const factorStr = den === 1 ? `${num}` : `(${num}/${den})`;
  return `${factorStr} * (${expr})`;
}

// =============== Internals ===============

function _simplify(expr, kind, moduleInstance) {
  try {
    const key = kind + '|' + expr;
    const cached = __simplifyCache.get(key);
    if (cached !== undefined) return cached;
    const out = simplifyDSL(expr);
    const result = safeEquivalent(expr, out, moduleInstance) ? out : expr;
    __simplifyCache.set(key, result);
    return result;
  } catch (e) {
    return expr;
  }
}

/**
 * Safety evaluation: compile old/new; the values must be exactly equal
 * (src/value/exact.js: irrational values are exact too).
 *
 * The corruption flag is part of the comparison. A note is crosshatched when one of
 * its POW ops yields an irrational (TET scales), so a rewrite that folded a power
 * away — or introduced one — would silently repaint the note even though the value
 * still matched. Such a rewrite is rejected and the original is kept.
 */
function safeEquivalent(oldExpr, newExpr, moduleInstance) {
  try {
    const a = evaluateExpr(oldExpr, moduleInstance);
    const b = evaluateExpr(newExpr, moduleInstance);
    if (a == null || b == null) return false;
    if (a.corrupted !== b.corrupted) return false;
    return X.equals(a.value, b.value);
  } catch {
    // If evaluation blows up, stay conservative: prefer original
    return false;
  }
}

/** A note's exact values as the evaluator reads them from a record (recordValue). */
function noteRecord(note) {
  return {
    startTime: note.getExactVariable?.('startTime'),
    duration: note.getExactVariable?.('duration'),
    frequency: note.getExactVariable?.('frequency'),
    amplitude: note.getExactVariable?.('amplitude'),
    attack: note.getExactVariable?.('attack'),
    release: note.getExactVariable?.('release')
  };
}

/**
 * The module's evaluated values as BinaryEvaluator.evaluate() reads them:
 * `get(id)` gives the record of note `id`. The evaluator asks only for the notes
 * the expression references (and the BaseNote), so each record is built when
 * first asked for. Building one for every note of the module, as this used to,
 * made each check cost the module's size (twice per octave step on a
 * 20,000-note module: most of the step). What a record holds, and which ids
 * have one, are unchanged.
 */
function noteRecords(moduleInstance) {
  const records = new Map();
  if (moduleInstance) {
    // Bring the evaluation up to date first, as building every record did
    try { moduleInstance.getEvaluationCache?.(); } catch {}
  }
  const build = (id) => {
    if (!moduleInstance) return undefined;
    const noteObj = (moduleInstance.notes || {})[id];
    if (noteObj) {
      try { return noteRecord(noteObj); } catch {}
    }
    // The BaseNote, also when the module's own entry for it is missing or failed
    if (id === 0 && moduleInstance.baseNote) {
      try { return noteRecord(moduleInstance.baseNote); } catch {}
    }
    return undefined;
  };
  return {
    get(id) {
      if (records.has(id)) return records.get(id);
      const rec = build(id);
      records.set(id, rec);
      return rec;
    }
  };
}

/**
 * Safely evaluate an expression using binary compilation.
 * SECURITY: This function DOES NOT use eval() or new Function().
 *
 * @returns {{value: Fraction|Irrational|Approx, corrupted: boolean}|null} the exact value;
 *   `corrupted` is true when the expression made an irrational value itself (what
 *   drives the crosshatch overlay).
 */
function evaluateExpr(expr, moduleInstance) {
  const validation = validateExpressionSyntax(expr);
  if (!validation.valid) {
    return null;
  }

  let binary = __evalBinaryCache.get(expr);
  if (!binary) {
    try {
      binary = compileDSL(expr);
      __evalBinaryCache.set(expr, binary);
    } catch {
      return null;
    }
  }

  // Evaluate using safe binary evaluator
  try {
    const evaluator = new BinaryEvaluator(moduleInstance);
    const shadowValue = evaluator.evaluate(binary, noteRecords(moduleInstance));
    if (shadowValue == null) return null;
    const value = evaluator._lastExact ?? new Fraction(shadowValue.s * shadowValue.n, shadowValue.d);
    return { value, corrupted: !!evaluator._lastEvalWasCorrupted };
  } catch {
    return null;
  }
}
