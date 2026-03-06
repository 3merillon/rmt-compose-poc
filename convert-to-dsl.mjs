/**
 * Converts all legacy-format module JSON files to DSL format.
 * Run with: node convert-to-dsl.mjs
 */
import fs from 'fs';
import path from 'path';

const VAR_MAP = {
  startTime: 't',
  duration: 'd',
  frequency: 'f',
  tempo: 'tempo',
  beatsPerMeasure: 'bpm',
  measureLength: 'ml',
};

function convertExpr(expr) {
  if (typeof expr !== 'string') return expr;
  const trimmed = expr.trim();
  if (!trimmed) return expr;

  // Already DSL? Skip
  if (/^\[?\d+\]\./.test(trimmed) || /^base\./.test(trimmed) || /^\(\d+\/\d+\)/.test(trimmed)) {
    return expr;
  }
  // Simple number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  try {
    return convertLegacy(trimmed);
  } catch (e) {
    console.warn(`  WARNING: Could not convert: ${trimmed.substring(0, 80)}... -> keeping as-is`);
    return expr;
  }
}

function convertLegacy(s) {
  // Tokenize the expression into a list of tokens for easier processing
  s = s.trim();

  // Strip leading outer parens if the whole thing is wrapped: (EXPR)
  if (s.startsWith('(') && findMatchingParen(s, 0) === s.length - 1) {
    const inner = s.slice(1, -1).trim();
    // Only unwrap if it doesn't change semantics (no top-level .add after)
    if (!s.includes('.add(') && !s.includes('.sub(')) {
      s = inner;
    }
  }

  // First, handle the method chain by splitting into base + chain calls
  const result = parseChainedExpr(s);
  return result;
}

function parseChainedExpr(s) {
  s = s.trim();

  // Split into segments: base, then .method(arg) calls at top level
  const segments = splitMethodChain(s);
  if (segments.length === 0) return s;

  let base;
  let startIdx = 1;

  // Special: new Fraction(60).div(module.findTempo(REF)) → beat(REF)
  if (segments.length >= 2 && segments[1].method === 'div') {
    const baseVal = segments[0].value.trim();
    const divArg = segments[1].arg.trim();
    const fracMatch = baseVal.match(/^new\s+Fraction\s*\(\s*60\s*\)$/);
    const tempoMatch = divArg.match(/^module\.findTempo\s*\(\s*(.*?)\s*\)$/);
    if (fracMatch && tempoMatch) {
      base = `beat(${convertRef(tempoMatch[1])})`;
      startIdx = 2;
    }
  }

  if (!base) {
    base = convertAtom(segments[0].value);
  }

  for (let i = startIdx; i < segments.length; i++) {
    const seg = segments[i];
    const argConverted = convertExprInner(seg.arg);

    if (seg.method === 'mul') {
      // Special: coefficient * base -> use multiplication
      base = wrapBinary(base, '*', argConverted);
    } else if (seg.method === 'div') {
      base = wrapBinary(base, '/', argConverted);
    } else if (seg.method === 'add') {
      base = wrapBinary(base, '+', argConverted);
    } else if (seg.method === 'sub') {
      base = wrapBinary(base, '-', argConverted);
    } else if (seg.method === 'pow') {
      base = wrapBinary(base, '^', argConverted);
    } else {
      throw new Error(`Unknown method: ${seg.method}`);
    }
  }

  return base;
}

function convertExprInner(s) {
  s = s.trim();
  // If it contains method chains, parse as chained
  if (hasTopLevelMethodCall(s)) {
    return parseChainedExpr(s);
  }
  return convertAtom(s);
}

function convertAtom(s) {
  s = s.trim();

  // Strip outer parens for analysis but may need to keep for precedence
  let inner = s;
  if (inner.startsWith('(') && findMatchingParen(inner, 0) === inner.length - 1) {
    inner = inner.slice(1, -1).trim();
  }

  // new Fraction(60).div(module.findTempo(REF)) -> beat(REF)
  const beatMatch = s.match(/^new\s+Fraction\s*\(\s*60\s*\)\.div\s*\(\s*module\.findTempo\s*\(\s*(.*?)\s*\)\s*\)$/);
  if (beatMatch) {
    return `beat(${convertRef(beatMatch[1])})`;
  }

  // module.findTempo(REF) -> standalone (shouldn't appear alone normally)
  const tempoMatch = s.match(/^module\.findTempo\s*\(\s*(.*?)\s*\)$/);
  if (tempoMatch) {
    return `tempo(${convertRef(tempoMatch[1])})`;
  }

  // module.findMeasureLength(REF)
  const measureMatch = s.match(/^module\.findMeasureLength\s*\(\s*(.*?)\s*\)$/);
  if (measureMatch) {
    return `measure(${convertRef(measureMatch[1])})`;
  }

  // new Fraction(N, D)
  const frac2Match = s.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
  if (frac2Match) {
    const n = parseInt(frac2Match[1]);
    const d = parseInt(frac2Match[2]);
    if (d === 1) return `${n}`;
    return `(${n}/${d})`;
  }

  // new Fraction(N) where N is integer
  const frac1Match = s.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*\)$/);
  if (frac1Match) {
    return frac1Match[1];
  }

  // new Fraction(N) where N is float like 0.25, 1.5 etc
  const fracFloatMatch = s.match(/^new\s+Fraction\s*\(\s*(-?\d+\.?\d*)\s*\)$/);
  if (fracFloatMatch) {
    return floatToFraction(parseFloat(fracFloatMatch[1]));
  }

  // bare number (0.25, 1.5, etc) used as method arg
  const bareNum = s.match(/^(-?\d+\.?\d*)$/);
  if (bareNum) {
    const f = parseFloat(bareNum[1]);
    if (Number.isInteger(f)) return `${f}`;
    return floatToFraction(f);
  }

  // module.baseNote.getVariable('VAR')
  const baseVarMatch = s.match(/^module\.baseNote\.getVariable\s*\(\s*'(\w+)'\s*\)$/);
  if (baseVarMatch) {
    const short = VAR_MAP[baseVarMatch[1]];
    if (short) return `base.${short}`;
    return `base.${baseVarMatch[1]}`;
  }

  // module.getNoteById(N).getVariable('VAR')
  const noteVarMatch = s.match(/^module\.getNoteById\s*\(\s*(\d+)\s*\)\.getVariable\s*\(\s*'(\w+)'\s*\)$/);
  if (noteVarMatch) {
    const id = noteVarMatch[1];
    const short = VAR_MAP[noteVarMatch[2]];
    if (short) return `[${id}].${short}`;
    return `[${id}].${noteVarMatch[2]}`;
  }

  // Might be a complex nested expression with method chains
  if (hasTopLevelMethodCall(s)) {
    return parseChainedExpr(s);
  }

  // Wrapped in parens
  if (inner !== s) {
    const converted = convertAtom(inner);
    // Only wrap if needed
    return converted;
  }

  throw new Error(`Unrecognized atom: ${s}`);
}

function convertRef(s) {
  s = s.trim();
  if (/^module\.baseNote$/.test(s)) return 'base';
  const noteMatch = s.match(/^module\.getNoteById\s*\(\s*(\d+)\s*\)$/);
  if (noteMatch) return `[${noteMatch[1]}]`;
  return s;
}

function floatToFraction(f) {
  if (Number.isInteger(f)) return `${f}`;
  // Common fractions
  const fracs = [
    [0.25, '(1/4)'], [0.5, '(1/2)'], [0.75, '(3/4)'],
    [1.25, '(5/4)'], [1.5, '(3/2)'], [2.0, '2'], [3.0, '3'], [4.0, '4'],
    [0.125, '(1/8)'], [0.375, '(3/8)'], [0.625, '(5/8)'], [0.875, '(7/8)'],
  ];
  for (const [v, repr] of fracs) {
    if (Math.abs(f - v) < 1e-12) return repr;
    if (Math.abs(f + v) < 1e-12) return `-${repr}`;
  }
  // Try to find rational approximation
  const sign = f < 0 ? -1 : 1;
  const af = Math.abs(f);
  for (let d = 1; d <= 1000; d++) {
    const n = Math.round(af * d);
    if (Math.abs(n / d - af) < 1e-12) {
      if (d === 1) return `${sign * n}`;
      return `(${sign * n}/${d})`;
    }
  }
  return `${f}`;
}

function wrapBinary(left, op, right) {
  // Simplify: if left is just a number 1 and op is *, skip the 1
  if (op === '*' && left === '1') return right;
  if (op === '*' && right === '1') return left;
  return `${left} ${op} ${right}`;
}

// Split a string into base + method chain segments
function splitMethodChain(s) {
  const segments = [];
  let i = 0;
  let depth = 0;

  // Find the base (everything before the first top-level .method()
  let baseEnd = s.length;
  for (i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0 && s[i] === '.') {
      const rest = s.substring(i);
      const methodMatch = rest.match(/^\.(mul|div|add|sub|pow)\s*\(/);
      if (methodMatch) {
        baseEnd = i;
        break;
      }
    }
  }

  const base = s.substring(0, baseEnd).trim();
  segments.push({ type: 'base', value: base });

  // Now parse method calls
  i = baseEnd;
  while (i < s.length) {
    const rest = s.substring(i);
    const methodMatch = rest.match(/^\.(mul|div|add|sub|pow)\s*\(/);
    if (!methodMatch) {
      i++;
      continue;
    }

    const method = methodMatch[1];
    const argStart = i + methodMatch[0].length;

    // Find the matching closing paren
    depth = 0;
    let j = argStart;
    while (j < s.length) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }

    const arg = s.substring(argStart, j).trim();
    segments.push({ type: 'call', method, arg });
    i = j + 1; // skip past ')'
  }

  return segments;
}

function hasTopLevelMethodCall(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0 && s[i] === '.') {
      const rest = s.substring(i);
      if (/^\.(mul|div|add|sub|pow)\s*\(/.test(rest)) return true;
    }
  }
  return false;
}

function findMatchingParen(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Process a single module JSON object
function convertModule(data) {
  const result = {};

  // Convert baseNote
  if (data.baseNote) {
    result.baseNote = {};
    for (const [key, value] of Object.entries(data.baseNote)) {
      if (typeof value === 'string' && ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'].includes(key)) {
        result.baseNote[key] = convertExpr(value);
      } else {
        result.baseNote[key] = value;
      }
    }
  }

  // Convert notes
  if (data.notes) {
    result.notes = data.notes.map(note => {
      const converted = {};
      for (const [key, value] of Object.entries(note)) {
        if (typeof value === 'string' && ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'].includes(key)) {
          converted[key] = convertExpr(value);
        } else {
          converted[key] = value;
        }
      }
      return converted;
    });
  }

  return result;
}

// Main
const modulesDir = path.resolve('public/modules');

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(fullPath);
    } else if (entry.name.endsWith('.json') && entry.name !== 'index.json') {
      console.log(`Converting: ${path.relative(modulesDir, fullPath)}`);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(raw);

        // Skip non-module files
        if (!data.baseNote && !data.notes) {
          console.log(`  Skipping (not a module file)`);
          continue;
        }

        const converted = convertModule(data);
        fs.writeFileSync(fullPath, JSON.stringify(converted, null, 2) + '\n');
        console.log(`  Done (${(data.notes || []).length} notes)`);
      } catch (e) {
        console.error(`  ERROR: ${e.message}`);
      }
    }
  }
}

processDir(modulesDir);
console.log('\nConversion complete!');
