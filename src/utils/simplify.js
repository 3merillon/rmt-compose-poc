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

  // Build eval cache
  const evalCache = new Map();
  if (moduleInstance) {
    const baseNote = moduleInstance.baseNote;
    if (baseNote) {
      try {
        evalCache.set(0, {
          startTime: baseNote.getExactVariable('startTime'),
          duration: baseNote.getExactVariable('duration'),
          frequency: baseNote.getExactVariable('frequency'),
          amplitude: baseNote.getExactVariable('amplitude'),
          attack: baseNote.getExactVariable('attack'),
          release: baseNote.getExactVariable('release')
        });
      } catch {}
    }
    for (const id in moduleInstance.notes || {}) {
      const noteObj = moduleInstance.notes[id];
      if (noteObj) {
        try {
          evalCache.set(parseInt(id, 10), {
            startTime: noteObj.getExactVariable?.('startTime'),
            duration: noteObj.getExactVariable?.('duration'),
            frequency: noteObj.getExactVariable?.('frequency'),
            amplitude: noteObj.getExactVariable?.('amplitude'),
            attack: noteObj.getExactVariable?.('attack'),
            release: noteObj.getExactVariable?.('release')
          });
        } catch {}
      }
    }
  }

  // Evaluate using safe binary evaluator
  try {
    const evaluator = new BinaryEvaluator(moduleInstance);
    const shadowValue = evaluator.evaluate(binary, evalCache);
    if (shadowValue == null) return null;
    const value = evaluator._lastExact ?? new Fraction(shadowValue.s * shadowValue.n, shadowValue.d);
    return { value, corrupted: !!evaluator._lastEvalWasCorrupted };
  } catch {
    return null;
  }
}
