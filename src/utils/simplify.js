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
import { toNumber } from './fraction-num.js';

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
  const before = evaluateExpr(expr, moduleInstance);
  const after = evaluateExpr(scaled, moduleInstance);
  if (before && after && after.corrupted === before.corrupted) {
    if (!before.corrupted && before.value instanceof Fraction && after.value instanceof Fraction) {
      // Rational both sides: the fold must be exact, so compare exactly.
      if (after.value.equals(before.value.mul(new Fraction(num, den)))) {
        return scaled;
      }
    } else {
      const expected = toNumber(before.value, NaN) * (num / den);
      if (isFinite(expected) && closeEnough(toNumber(after.value, NaN), expected)) {
        return scaled;
      }
    }
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
 * Safety evaluation: compile old/new; rational results must match exactly,
 * irrational (corrupted) ones within a 1e-12 relative tolerance.
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
    if (!a.corrupted && a.value instanceof Fraction && b.value instanceof Fraction) {
      return a.value.equals(b.value);
    }
    const av = toNumber(a.value, NaN);
    const bv = toNumber(b.value, NaN);
    if (!isFinite(av) || !isFinite(bv)) return false;
    return closeEnough(av, bv);
  } catch {
    // If evaluation blows up, stay conservative: prefer original
    return false;
  }
}

/**
 * Rational expressions evaluate exactly, so they compare bit-for-bit. Irrational
 * ones do not: the POW opcode approximates each irrational result as a Fraction,
 * so an exact identity like 2^(1/12) * 2^(1/12) = 2^(1/6) still lands ~1e-11 apart
 * simply because it rounds once instead of twice. The tolerance is therefore
 * relative to magnitude. It stays far tighter than any real algebra slip: dropping
 * or duplicating a factor moves the value by a whole ratio, not by 1e-12 of it.
 */
function closeEnough(a, b) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-12 * scale;
}

/**
 * Safely evaluate an expression using binary compilation.
 * SECURITY: This function DOES NOT use eval() or new Function().
 *
 * @returns {{value: Fraction, corrupted: boolean}|null} `corrupted` is true when the
 *   expression produced an irrational value (what drives the crosshatch overlay).
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
          startTime: baseNote.getVariable('startTime'),
          duration: baseNote.getVariable('duration'),
          frequency: baseNote.getVariable('frequency'),
          amplitude: baseNote.getVariable('amplitude'),
          attack: baseNote.getVariable('attack'),
          release: baseNote.getVariable('release')
        });
      } catch {}
    }
    for (const id in moduleInstance.notes || {}) {
      const noteObj = moduleInstance.notes[id];
      if (noteObj) {
        try {
          evalCache.set(parseInt(id, 10), {
            startTime: noteObj.getVariable?.('startTime'),
            duration: noteObj.getVariable?.('duration'),
            frequency: noteObj.getVariable?.('frequency'),
            amplitude: noteObj.getVariable?.('amplitude'),
            attack: noteObj.getVariable?.('attack'),
            release: noteObj.getVariable?.('release')
          });
        } catch {}
      }
    }
  }

  // Evaluate using safe binary evaluator
  try {
    const evaluator = new BinaryEvaluator(moduleInstance);
    const value = evaluator.evaluate(binary, evalCache);
    if (value == null) return null;
    return { value, corrupted: !!evaluator._lastEvalWasCorrupted };
  } catch {
    return null;
  }
}
