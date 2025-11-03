/**
 * Central expression simplifier and octave-safe multiplier.
 *
 * Goals:
 * - Preserve all original variable references (anchors) exactly
 *   (module.getNoteById(id).getVariable('...'), module.baseNote.getVariable('...'),
 *    module.findTempo(ref), module.findMeasureLength(ref)).
 * - Collapse chained numeric multipliers/divisors to a single Fraction coefficient per product term.
 * - Never distribute products over sums; we only flatten method-chain algebra (.add/.sub/.mul/.div).
 * - Keep canonical per-kind forms:
 *   - frequency: coeff * FrequencyRef
 *   - duration: sums of coeff * BeatUnit(ref) | coeff * MeasureUnit(ref) | coeff * DurationRef
 *   - startTime: sums of StartTimeRef + coeff * BeatUnit(ref) + coeff * MeasureUnit(ref) + coeff * DurationRef
 * - Use fraction.js for exact rational arithmetic (no artificial max denominator).
 * - Safety-check: evaluate before/after with a module instance; if mismatch, return original.
 */
import Fraction from 'fraction.js';

// Memoization caches
const __simplifyCache = new Map(); // key: kind + '|' + expr
const __evalFnCache = new Map();   // compile cache for evaluateExpr

// =============== Public API ===============
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
  try {
    const ast = parseToSumOfProducts(expr);
    const factor = new Fraction(num, den);
    if (!ast.ok) return expr;
    // Multiply every product term coefficient, including opaque terms (emit will wrap opaque safely)
    ast.terms.forEach(t => {
      t.coeff = t.coeff.mul(factor);
    });
    const out = emitExpression(ast, kind);
    // Do NOT run equivalence check here; this is an intentional scaling operation.
    return out;
  } catch {
    // Conservative fallback: wrap original so scaling still applies;
    // downstream callers may simplify further if desired.
    return `new Fraction(${num}, ${den}).mul(${expr})`;
  }
}

// =============== Internals ===============

/**
 * Top-level simplify by kind with evaluation safety.
 */
function _simplify(expr, kind, moduleInstance) {
  try {
    const key = kind + '|' + expr;
    const cached = __simplifyCache.get(key);
    if (cached !== undefined) return cached;

    const ast = parseToSumOfProducts(expr);
    if (!ast.ok) { __simplifyCache.set(key, expr); return expr; }

    const normalized = normalizeForKind(ast, kind);
    const out = emitExpression(normalized, kind);

    const result = safeEquivalent(expr, out, moduleInstance) ? out : expr;
    __simplifyCache.set(key, result);
    return result;
  } catch (e) {
    return expr;
  }
}

/**
 * Safety evaluation: compile old/new; compare |a-b| <= 1e-12.
 * If evaluation fails (e.g., missing refs during editing), we accept the simplified result
 * only when parse step was a no-op on opaque structures (we already kept opaque as-is).
 */
function safeEquivalent(oldExpr, newExpr, moduleInstance) {
  const tol = 1e-12;
  try {
    const a = evaluateExpr(oldExpr, moduleInstance);
    const b = evaluateExpr(newExpr, moduleInstance);
    if (a == null || b == null) return false;
    const av = valueOfMaybeFraction(a);
    const bv = valueOfMaybeFraction(b);
    if (!isFinite(av) || !isFinite(bv)) return false;
    return Math.abs(av - bv) <= tol;
  } catch {
    // If evaluation blows up, stay conservative: prefer original
    return false;
  }
}

function evaluateExpr(expr, moduleInstance) {
  let f = __evalFnCache.get(expr);
  if (!f) {
    // eslint-disable-next-line no-new-func
    f = new Function('module', 'Fraction', `return (${expr});`);
    __evalFnCache.set(expr, f);
  }
  return f(moduleInstance, Fraction);
}

function valueOfMaybeFraction(x) {
  if (x == null) return NaN;
  if (typeof x === 'number') return x;
  if (typeof x.valueOf === 'function') return x.valueOf();
  return Number(x);
}

// =============== AST model ===============
//
// SumOfProducts = {
//   ok: boolean,
//   terms: Array<Product> // sum of product terms
// }
//
// Product = {
//   coeff: Fraction,           // collapsed numeric multiplier
//   anchors: Array<Anchor>,   // ordered anchors (non-commutative references kept)
//   opaque: boolean            // if true, leave term fully intact as original string
//   original?: string          // original term string (used when opaque)
// }
//
// Anchor = {
//   type: 'FREQ'|'START'|'DUR'|'BEAT'|'MEASURE'|'OPAQUE'|'REF', // REF for generic untyped references
//   key: string,                // canonical key for grouping
//   emit: () => string          // emitter to toString the anchor in canonical code
// }
//
// Notes:
// - BEAT denotes the atomic unit (60 / findTempo(ref)), not multiplied by any extra fraction.
// - MEASURE denotes module.findMeasureLength(ref)
// - START is module.(baseNote|getNoteById).getVariable('startTime')
// - DUR is module.getNoteById(...).getVariable('duration')
// - FREQ is a frequency variable reference
// - REF is a generic immutable anchor (for safety) if we recognize a variable but not typed for this kind.
//
// We never distribute; .add/.sub produce multiple Product terms. .mul/.div collapse numeric factors and collect anchors.
//

/**
 * Parse an expression into SumOfProducts by scanning method-chains (.add/.sub/.mul/.div).
 * We keep it conservative and robust for all patterns used in the app.
 */
function parseToSumOfProducts(expr) {
  const trimmed = trim(expr);
  if (!trimmed) return opaqueSum(expr);

  // Split by top-level .add/.sub chains
  const addSub = splitTopLevelAddSub(trimmed);
  if (!addSub || addSub.calls.length === 0) {
    // Just a product (or atomic)
    const p = parseProduct(trimmed);
    return {
      ok: true,
      terms: [p]
    };
  }

  // Left base + calls
  const terms = [];
  const baseStr = addSub.base;
  terms.push(parseProduct(baseStr));
  for (const call of addSub.calls) {
    const t = parseToSumOfProducts(call.arg); // argument itself could be a sum (rare), flatten
    if (!t.ok) {
      // Opaque argument: preserve as opaque product with sign
      const prod = opaqueProduct(call.arg);
      if (call.name === 'sub') prod.coeff = prod.coeff.mul(-1);
      terms.push(prod);
    } else {
      t.terms.forEach(prod => {
        const prodCopy = cloneProduct(prod);
        if (call.name === 'sub') prodCopy.coeff = prodCopy.coeff.mul(-1);
        terms.push(prodCopy);
      });
    }
  }
  return { ok: true, terms };
}

function cloneProduct(p) {
  return {
    coeff: new Fraction(p.coeff),
    anchors: [...p.anchors],
    opaque: !!p.opaque,
    original: p.original
  };
}

function opaqueSum(original) {
  return {
    ok: true,
    terms: [opaqueProduct(original)]
  };
}

function opaqueProduct(original) {
  return {
    coeff: new Fraction(1, 1),
    anchors: [mkOpaqueAnchor(original)],
    opaque: true,
    original
  };
}

// =============== Parsing helpers ===============

function parseProduct(expr) {
  const s = trim(expr);
  if (!s) return opaqueProduct(expr);

  // Split method chain for mul/div at top-level
  const chain = splitTopLevelMulDiv(s);
  if (!chain || (chain.calls.length === 0 && chain.base.length === 0)) {
    return parseAtomicAsProduct(s);
  }

  // General flow: start from base, apply mul/div calls
  let prod = emptyProduct();

  // If base is empty (should not happen), treat as 1
  const baseAtom = chain.base ? parseAtomic(chain.base) : mkCoeffAtom(new Fraction(1,1));
  prod = mergeAtomIntoProduct(prod, baseAtom, 'mul');

  for (const call of chain.calls) {
    const atom = parseAtomic(call.arg);
    prod = mergeAtomIntoProduct(prod, atom, call.name);
    if (prod === null) {
      // Turn entire product opaque if unsupported division happened
      return opaqueProduct(expr);
    }
  }

  // Special recognition: beat unit pattern new Fraction(60).div(module.findTempo(ref))
  prod = tryPromoteBeatUnit(prod);

  // Special recognition: k * module.findMeasureLength(ref)
  prod = tryPromoteMeasureUnit(prod);

  return prod;
}

function emptyProduct() {
  return {
    coeff: new Fraction(1, 1),
    anchors: [],
    opaque: false
  };
}

function parseAtomicAsProduct(s) {
  const atom = parseAtomic(s);
  const prod = emptyProduct();
  const merged = mergeAtomIntoProduct(prod, atom, 'mul');
  return merged ?? opaqueProduct(s);
}

function parseAtomic(s) {
  const str = trim(stripOuterParens(s));
  if (!str) return mkOpaqueAtom(s);

  // 1) Beat unit (strict pattern): new Fraction(60).div(module.findTempo(ref))
  const beat = tryParseBeatUnit(str);
  if (beat) return beat;

  // 2) Measure unit optionally with multiplier handled by product phase
  if (isMeasureRef(str)) {
    const ref = parseMeasureRef(str);
    return mkAnchorAtom(mkMeasureAnchor(ref));
  }

  // 3) Fraction literal
  const frac = tryParseFractionLiteral(str);
  if (frac) return mkCoeffAtom(frac);

  // 4) Known variable references
  const vref = tryParseKnownVariableRef(str);
  if (vref) return mkAnchorAtom(vref);

  // 5) Parenthesized nested sum or other expressions: keep opaque (we do not distribute)
  if (startsWithParen(str) && endsWithParen(str)) {
    // If the inner contains .add/.sub at top-level, keep opaque
    return mkOpaqueAtom(s);
  }

  // 6) Fallback to opaque
  return mkOpaqueAtom(s);
}

function mergeAtomIntoProduct(prod, atom, op) {
  // If atom is coefficient
  if (atom.kind === 'coeff') {
    if (op === 'mul') {
      prod.coeff = prod.coeff.mul(atom.frac);
      return prod;
    } else if (op === 'div') {
      // divide by fraction
      if (atom.frac.n === 0) return null; // division by zero, bail
      prod.coeff = prod.coeff.div(atom.frac);
      return prod;
    }
  }

  // If atom is anchor
  if (atom.kind === 'anchor') {
    if (op === 'mul') {
      prod.anchors.push(atom.anchor);
      return prod;
    } else if (op === 'div') {
      // Only supported division pattern is Fraction(60) / findTempo(ref) promoted later.
      // If we divide by a TEMPO anchor directly, mark a pendingDivTempo.
      if (atom.anchor.__isTempoRaw) {
        // Represent as a temporary marker anchor which tryPromoteBeatUnit will transform.
        prod.anchors.push(atom.anchor);
        return prod;
      }
      // Any other division by anchor is unsupported safely → mark opaque
      return null;
    }
  }

  // Opaque atom
  if (atom.kind === 'opaque') {
    if (op === 'mul') {
      prod.anchors.push(mkOpaqueAnchor(atom.original));
      return prod;
    } else if (op === 'div') {
      // x / opaque → not supported; bail opaque product
      return null;
    }
  }

  return prod;
}

// Promote Fraction(60)/findTempo(ref) to BEAT anchor
function tryPromoteBeatUnit(prod) {
  // Look for a TEMPO raw anchor
  const tempoIdx = prod.anchors.findIndex(a => a.__isTempoRaw === true);
  if (tempoIdx < 0) return prod;

  const tempoAnchor = prod.anchors[tempoIdx];
  // Check coefficient equals 60 (allow sign), and no other non-tempo anchors before promotion
  // We will convert coeff=±60 / tempo -> (sign)*1 * BEAT(ref)
  const absCoeff = prod.coeff.abs();
  const is60 = absCoeff.n === 60 && absCoeff.d === 1;
  if (!is60) {
    // We still can form BEAT * remaining coeff/60 if coeff is multiple of 60, but keep conservative for robustness.
    return prod;
  }

  const sign = prod.coeff.s; // 1 or -1

  // Remove the tempo raw anchor
  const anchors = prod.anchors.slice();
  anchors.splice(tempoIdx, 1);

  const beatAnchor = mkBeatAnchor(tempoAnchor.__tempoRef);
  const result = {
    coeff: new Fraction(sign, 1), // move numeric 60 fully into BEAT definition, leaving only sign
    anchors: [beatAnchor, ...anchors],
    opaque: false
  };
  return result;
}

// Promote k * findMeasureLength(ref) to coeff * MEASURE(ref)
function tryPromoteMeasureUnit(prod) {
  // Already MEASURE anchors are fine; this promotion handles cases where we see a Fraction(k) next to a MEASURE anchor
  // Nothing special needed, since numeric was already in coeff and MEASURE anchor in anchors list.
  return prod;
}

// =============== Emission and normalization ===============

function normalizeForKind(sumAst, kind) {
  // We must:
  // - collapse anchors order deterministically
  // - group like terms (same anchor key sequence)
  // - keep all refs intact
  const grouped = new Map();
  for (const t of sumAst.terms) {
    if (t.opaque) {
      // keep opaque term as-is; do not group
      const k = `OPAQUE:${t.original}`;
      const existing = grouped.get(k);
      if (existing) {
        existing.coeff = existing.coeff.add(t.coeff);
      } else {
        grouped.set(k, cloneProduct(t));
      }
      continue;
    }

    // Sort anchors deterministically by type+key to stabilize emissions
    const sortedAnchors = [...t.anchors].sort((a, b) => {
      const ka = a.type + ':' + a.key;
      const kb = b.type + ':' + b.key;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    const key = sortedAnchors.map(a => `${a.type}:${a.key}`).join('*') || 'SCALAR';

    const existing = grouped.get(key);
    if (existing) {
      existing.coeff = existing.coeff.add(t.coeff);
    } else {
      grouped.set(key, {
        coeff: new Fraction(t.coeff),
        anchors: sortedAnchors,
        opaque: false
      });
    }
  }

  // Remove exact zeros
  const terms = [];
  for (const [k, p] of grouped.entries()) {
    if (p.coeff.n === 0) continue;
    terms.push(p);
  }

  return { ok: true, terms };
}

function emitExpression(sumAst, kind) {
  if (!sumAst.terms || sumAst.terms.length === 0) {
    // Emit 0 for numeric zero
    return `new Fraction(0,1)`;
  }

  // Choose first as base; then .add/.sub others.
  const pieces = sumAst.terms.map(t => emitProduct(t, kind));

  // Build .add/.sub chain tightly
  let out = pieces[0].expr;
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.sign < 0) {
      out += `.sub(${p.inner})`;
    } else {
      out += `.add(${p.inner})`;
    }
  }
  return out;
}

function emitProduct(prod, kind) {
  if (prod.opaque) {
    // sign * (opaque)
    const sign = prod.coeff.s;
    const abs = prod.coeff.abs();
    if (abs.n === 1 && abs.d === 1) {
      return {
        sign,
        expr: sign < 0 ? `new Fraction(-1,1).mul(${prod.original})` : prod.original,
        inner: prod.original
      };
    }
    const prefix = `new Fraction(${abs.n}, ${abs.d})`;
    const expr = (sign < 0 ? `new Fraction(-${abs.n}, ${abs.d})` : prefix) + `.mul(${prod.original})`;
    return { sign: 1, expr, inner: `${prefix}.mul(${prod.original})` };
  }

  const sign = prod.coeff.s;
  const abs = prod.coeff.abs();

  // For each kind, we may tweak ordering; but by default we use: (coeff if !=1) * anchors chained by .mul()
  let base = null;
  if (!(abs.n === 1 && abs.d === 1)) {
    base = `new Fraction(${abs.n}, ${abs.d})`;
  }

  // Emit anchors
  let chain = '';
  for (const a of prod.anchors) {
    const as = a.emit();
    if (!base && chain === '' && kind === 'frequency' && a.type === 'FREQ') {
      // In frequency expressions, if coeff==1 we prefer to emit just the frequency ref (no 1*).
      base = as;
    } else {
      if (!base) {
        base = as;
      } else {
        base += `.mul(${as})`;
      }
    }
  }

  if (!base) {
    // Pure scalar; emit as Fraction
    base = `new Fraction(${abs.n}, ${abs.d})`;
  }

  if (sign < 0) {
    // Represent negative as (-1)*base
    const out = `new Fraction(-1,1).mul(${base})`;
    return { sign: 1, expr: out, inner: base };
  }
  return { sign: 1, expr: base, inner: base };
}

// =============== Recognizers and emitters for anchors ===============

function mkBeatAnchor(ref) {
  const key = refKey(ref);
  return {
    type: 'BEAT',
    key,
    emit: () => `new Fraction(60).div(module.findTempo(${emitRefArg(ref)}))`
  };
}

function mkMeasureAnchor(ref) {
  const key = refKey(ref);
  return {
    type: 'MEASURE',
    key,
    emit: () => `module.findMeasureLength(${emitRefArg(ref)})`
  };
}

function mkStartAnchor(ref) {
  const key = `start:${refKey(ref)}`;
  return {
    type: 'START',
    key,
    emit: () => `${emitRefArg(ref)}.getVariable('startTime')`
  };
}

function mkDurationAnchor(ref) {
  const key = `duration:${refKey(ref)}`;
  return {
    type: 'DUR',
    key,
    emit: () => `${emitRefArg(ref)}.getVariable('duration')`
  };
}

function mkFrequencyAnchor(ref) {
  const key = `frequency:${refKey(ref)}`;
  return {
    type: 'FREQ',
    key,
    emit: () => `${emitRefArg(ref)}.getVariable('frequency')`
  };
}

function mkTempoRawAnchor(ref) {
  // internal only for promotion to BEAT
  return {
    type: 'REF',
    key: `tempo:${refKey(ref)}`,
    __isTempoRaw: true,
    __tempoRef: ref,
    emit: () => `module.findTempo(${emitRefArg(ref)})`
  };
}

function mkOpaqueAnchor(original) {
  return {
    type: 'OPAQUE',
    key: original,
    emit: () => `(${original})`
  };
}

function mkCoeffAtom(frac) {
  return { kind: 'coeff', frac };
}
function mkAnchorAtom(anchor) {
  return { kind: 'anchor', anchor };
}
function mkOpaqueAtom(original) {
  return { kind: 'opaque', original };
}

function refKey(ref) {
  return ref.kind === 'base' ? 'base' : `note:${ref.id}`;
}
function emitRefArg(ref) {
  return ref.kind === 'base' ? 'module.baseNote' : `module.getNoteById(${ref.id})`;
}

function tryParseBeatUnit(s) {
  // Pattern: new Fraction(60).div(module.findTempo(ref))
  const m = s.match(/^new\s*Fraction\s*\(\s*60\s*\)\s*\.div\s*\(\s*module\.findTempo\s*\(\s*(module\.baseNote|module\.getNoteById\(\s*\d+\s*\))\s*\)\s*\)\s*$/);
  if (!m) return null;
  const ref = parseRefArg(m[1]);
  return mkAnchorAtom(mkBeatAnchor(ref));
}

function isMeasureRef(s) {
  return /^(?:module\.)?findMeasureLength\s*\(\s*(module\.baseNote|module\.getNoteById\(\s*\d+\s*\))\s*\)\s*$/.test(s);
}

function parseMeasureRef(s) {
  const m = s.match(/^(?:module\.)?findMeasureLength\s*\(\s*(module\.baseNote|module\.getNoteById\(\s*\d+\s*\))\s*\)\s*$/);
  return parseRefArg(m[1]);
}

function tryParseKnownVariableRef(s) {
  // module.baseNote.getVariable('...') or module.getNoteById(n).getVariable('...')
  const m = s.match(/^(module\.baseNote|module\.getNoteById\(\s*\d+\s*\))\.getVariable\s*\(\s*'([^']+)'\s*\)\s*$/);
  if (!m) {
    // Tempo raw?
    const tr = s.match(/^module\.findTempo\s*\(\s*(module\.baseNote|module\.getNoteById\(\s*\d+\s*\))\s*\)\s*$/);
    if (tr) {
      const ref = parseRefArg(tr[1]);
      return mkTempoRawAnchor(ref);
    }
    return null;
  }
  const ref = parseRefArg(m[1]);
  const varName = m[2];
  if (varName === 'startTime') return mkStartAnchor(ref);
  if (varName === 'duration') return mkDurationAnchor(ref);
  if (varName === 'frequency') return mkFrequencyAnchor(ref);
  // Other variables (tempo, beatsPerMeasure) — emit as generic REF to avoid losing semantics
  return {
    type: 'REF',
    key: `${varName}:${refKey(ref)}`,
    emit: () => `${emitRefArg(ref)}.getVariable('${varName}')`
  };
}

function parseRefArg(s) {
  if (/^module\.baseNote$/.test(s)) return { kind: 'base' };
  const m = s.match(/^module\.getNoteById\(\s*(\d+)\s*\)$/);
  if (m) return { kind: 'note', id: parseInt(m[1], 10) };
  // Fallback to base
  return { kind: 'base' };
}

// =============== Fraction literal parsing ===============

function tryParseFractionLiteral(s) {
  // new Fraction(a) or new Fraction(a,b)
  const m = s.match(/^new\s*Fraction\s*\(\s*([^)]+)\s*\)\s*$/);
  if (!m) return null;
  const args = m[1].split(',').map(x => x.trim());
  try {
    if (args.length === 1) {
      const a = parseNumeric(args[0]);
      if (a == null) return null;
      return new Fraction(a);
    } else if (args.length === 2) {
      const a = parseNumeric(args[0]);
      const b = parseNumeric(args[1]);
      if (a == null || b == null) return null;
      return new Fraction(a, b);
    }
  } catch {
    return null;
  }
  return null;
}

function parseNumeric(x) {
  // Accept integer or float literal
  const n = Number(x);
  if (!isFinite(n)) return null;
  return n;
}

// =============== Chain splitters (.add/.sub and .mul/.div) ===============

function splitTopLevelAddSub(expr) {
  const calls = [];
  let i = 0, depth = 0, baseEnd = expr.length, firstCallPos = -1;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && expr.startsWith('.add(', i)) {
      firstCallPos = i;
      break;
    } else if (depth === 0 && expr.startsWith('.sub(', i)) {
      firstCallPos = i;
      break;
    }
    i++;
  }
  if (firstCallPos < 0) {
    return { base: expr, calls: [] };
  }
  const base = expr.substring(0, firstCallPos);

  // Read subsequent .add/.sub(...)
  i = firstCallPos;
  while (i < expr.length) {
    if (depth === 0 && expr.startsWith('.add(', i)) {
      const { arg, nextIndex } = readCallArgument(expr, i + 5); // position after ".add("
      calls.push({ name: 'add', arg });
      i = nextIndex;
    } else if (depth === 0 && expr.startsWith('.sub(', i)) {
      const { arg, nextIndex } = readCallArgument(expr, i + 5);
      calls.push({ name: 'sub', arg });
      i = nextIndex;
    } else {
      i++;
    }
  }

  return { base: base || '', calls };
}

function splitTopLevelMulDiv(expr) {
  const calls = [];
  // find the first .mul/.div or return base-only
  let i = 0, depth = 0, first = -1;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && (expr.startsWith('.mul(', i) || expr.startsWith('.div(', i))) {
      first = i;
      break;
    }
    i++;
  }
  if (first < 0) return { base: expr, calls: [] };
  const base = expr.substring(0, first);

  i = first;
  while (i < expr.length) {
    if (depth === 0 && expr.startsWith('.mul(', i)) {
      const { arg, nextIndex } = readCallArgument(expr, i + 5);
      calls.push({ name: 'mul', arg });
      i = nextIndex;
    } else if (depth === 0 && expr.startsWith('.div(', i)) {
      const { arg, nextIndex } = readCallArgument(expr, i + 5);
      calls.push({ name: 'div', arg });
      i = nextIndex;
    } else {
      i++;
    }
  }

  return { base: base || '', calls };
}

function readCallArgument(expr, startIndex) {
  // startIndex points to first char of argument
  let depth = 0;
  let i = startIndex;
  let start = startIndex;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        // end of this call
        const arg = expr.substring(start, i);
        // Next index is after ')'
        return { arg: arg.trim(), nextIndex: i + 1 };
      }
      depth--;
    }
    i++;
  }
  // Unbalanced, return the rest
  return { arg: expr.substring(start).trim(), nextIndex: expr.length };
}

// =============== Small string helpers ===============

function trim(s) {
  return (s || '').trim();
}
function stripOuterParens(s) {
  const t = trim(s);
  if (!startsWithParen(t)) return t;
  // Strip only if fully balanced outer pair
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0 && i !== t.length - 1) {
        return t; // outer paren closes before end => not a single outer pair
      }
    }
  }
  if (depth === 0 && t.startsWith('(') && t.endsWith(')')) {
    return t.substring(1, t.length - 1).trim();
  }
  return t;
}
function startsWithParen(s) { return s.startsWith('('); }
function endsWithParen(s) { return s.endsWith(')'); }

// =============== Quick runtime self-checks (non-fatal) ===============

/**
 * Minimal smoke tests. Call manually when needed:
 * window.__simplifySmoke && window.__simplifySmoke();
 */
export function __simplifySmoke(moduleInstance) {
  try {
    const pairs = [
      // Frequency: nested multipliers
      [`new Fraction(2,1).mul(module.baseNote.getVariable('frequency')).mul(new Fraction(3,2))`, 'frequency'],
      // Duration: beat units
      [`new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(3,4))`, 'duration'],
      // StartTime: base + beat
      [`module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(1,4)))`, 'startTime']
    ];
    for (const [e,k] of pairs) {
      const out = _simplify(e, k, moduleInstance);
      // eslint-disable-next-line no-console
      console.log('[simplify smoke]', k, '=>', out);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('simplify smoke failed', e);
  }
}

// =============== End of file ===============