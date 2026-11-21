/**
 * Convert a module written for the old time model to relational time.
 *
 * Old model: the BaseNote carried a tempo and beats per measure, every note
 * could carry its own, and anything missing fell back to the BaseNote. Durations
 * were written in beats (`beat(base)` = 60 / tempo), and measure bars were notes
 * with only a start time whose length came from `measure([n])`
 * (= beatsPerMeasure * 60 / tempo).
 *
 * Relational model: a note has a frequency, a start and a duration, nothing
 * else that times it. The reference note's duration is the time unit, so
 * `beat(base)` becomes `base.d`. A measure bar is a silent note with a start and
 * a duration, flagged `"measure": true` so the editor draws it as a bar line
 * instead of a rest. Tempo is no longer stored; 60 / base.d is a view.
 *
 * The conversion is exact: every start, duration, frequency and amplitude
 * evaluates to the same fraction before and after (scripts/test-relational-time.mjs
 * checks this against values recorded with the old engine).
 *
 * It works on the JSON text of expressions, before anything is compiled, so it
 * does not depend on the old evaluator. Tempo, beats per measure and measure
 * length are evaluated here by a small constant evaluator; an own tempo that is
 * not a constant expression of other tempos throws a TimeMigrationError rather
 * than guessing.
 */
import Fraction from 'fraction.js';
import { isInputScore, type InputScore, type InputFields } from '../model-types.ts';

type TimeVariable = 'tempo' | 'bpm' | 'ml' | 'unit';

export class TimeMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeMigrationError';
  }
}

const OLD_KEYS = ['tempo', 'beatsPerMeasure', 'measureLength'];
const OLD_STRING_KEYS = OLD_KEYS.map(k => k + 'String');
const EXPR_KEYS = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];

// A reference in either syntax: DSL `base` / `[N]`, legacy `module.baseNote` /
// `module.getNoteById(N)`. Group 1 is the id when it names a note.
const DSL_REF = String.raw`(?:base|\[\s*(\d+)\s*\])`;
const LEGACY_REF = String.raw`(?:module\.baseNote|module\.getNoteById\s*\(\s*(\d+)\s*\))`;

const RE = {
  // legacy beat unit, before findTempo so the `60 / tempo` pair goes as one
  legacyBeat: new RegExp(String.raw`new\s+Fraction\s*\(\s*60\s*\)\s*\.div\s*\(\s*module\.findTempo\s*\(\s*${LEGACY_REF}\s*\)\s*\)`, 'g'),
  legacyTempo: new RegExp(String.raw`module\.findTempo\s*\(\s*${LEGACY_REF}\s*\)`, 'g'),
  legacyMeasure: new RegExp(String.raw`module\.findMeasureLength\s*\(\s*${LEGACY_REF}\s*\)`, 'g'),
  legacyVar: new RegExp(String.raw`${LEGACY_REF}\s*\.getVariable\s*\(\s*['"](tempo|beatsPerMeasure|measureLength)['"]\s*\)`, 'g'),
  dslHelper: new RegExp(String.raw`\b(beat|tempo|measure)\s*\(\s*${DSL_REF}\s*\)`, 'g'),
  dslProp: new RegExp(String.raw`(?:\bbase|\[\s*(\d+)\s*\])\s*\.\s*(tempo|bpm|beatsPerMeasure|ml|measureLength)\b`, 'g'),
};

const ANY_OLD_CONSTRUCT = new RegExp(
  [RE.legacyBeat, RE.legacyTempo, RE.legacyMeasure, RE.legacyVar, RE.dslHelper, RE.dslProp]
    .map(r => r.source).join('|')
);

function exprText(note: InputFields | undefined, key: string) {
  if (!note) return null;
  const s = note[key + 'String'] ?? note[key];
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length ? t : null;
}

/** An old measure bar: a start time and neither duration nor frequency. */
function isOldBar(note: InputFields) {
  return note && note.id !== 0 &&
    exprText(note, 'startTime') !== null &&
    exprText(note, 'duration') === null &&
    exprText(note, 'frequency') === null;
}

/**
 * Does this module use the old time model at all? Only the old keys and
 * constructs say so. A note with a start and nothing else is a measure bar in
 * an old module, but in a relational one it is just a start (a marker), so it
 * is converted only along with the rest of an old module.
 */
export function needsTimeMigration(data: unknown) {
  if (!isInputScore(data)) return false;
  const all = [data.baseNote, ...data.notes];
  for (const n of all) {
    if (!n || typeof n !== 'object') continue;
    for (const k of [...OLD_KEYS, ...OLD_STRING_KEYS]) if (k in n) return true;
    for (const k of EXPR_KEYS) {
      const s = exprText(n, k);
      if (s && ANY_OLD_CONSTRUCT.test(s)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Constant evaluator: numbers, + - * / ^, parentheses, `new Fraction(a[, b])`
// and legacy `.mul/.div/.add/.sub/.neg/.pow` chains. Used only for tempo,
// beats per measure and measure length, after references to those have been
// replaced by their values.
// ---------------------------------------------------------------------------

function evalConst(src: string, what: string): Fraction {
  const toks: string[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|(new)\b|(Fraction)\b|(mul|div|add|sub|neg|pow)\b|([-+*\/^(),.]))/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || m[0].length === 0) {
      throw new TimeMigrationError(`${what}: cannot convert "${src}" (not a constant expression)`);
    }
    toks.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
    i = re.lastIndex;
  }
  let p = 0;
  const peek = () => toks[p];
  const eat = (t: string) => {
    if (toks[p] !== t) throw new TimeMigrationError(`${what}: cannot convert "${src}" (expected "${t}")`);
    p++;
  };
  const isNum = (t: string | undefined) => t !== undefined && /^\d/.test(t);

  function expr(): Fraction {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = toks[p++];
      const r = term();
      v = op === '+' ? v.add(r) : v.sub(r);
    }
    return v;
  }
  function term(): Fraction {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const op = toks[p++];
      const r = unary();
      v = op === '*' ? v.mul(r) : v.div(r);
    }
    return v;
  }
  function unary(): Fraction {
    if (peek() === '-') { p++; return unary().neg(); }
    if (peek() === '+') { p++; return unary(); }
    return power();
  }
  function power(): Fraction {
    const b = postfix();
    if (peek() === '^') {
      p++;
      const e = unary();
      if (e.d !== 1n) throw new TimeMigrationError(`${what}: "${src}" has a non-integer power`);
      return b.pow(e);
    }
    return b;
  }
  function postfix(): Fraction {
    let v = primary();
    while (peek() === '.') {
      p++;
      const m = toks[p++];
      eat('(');
      if (m === 'neg') { eat(')'); v = v.neg(); continue; }
      const a = expr();
      eat(')');
      if (m === 'mul') v = v.mul(a);
      else if (m === 'div') v = v.div(a);
      else if (m === 'add') v = v.add(a);
      else if (m === 'sub') v = v.sub(a);
      else if (m === 'pow') {
        if (a.d !== 1n) throw new TimeMigrationError(`${what}: "${src}" has a non-integer power`);
        v = v.pow(a);
      } else throw new TimeMigrationError(`${what}: cannot convert "${src}"`);
    }
    return v;
  }
  function primary(): Fraction {
    const t = peek();
    if (isNum(t)) { p++; return new Fraction(t); }
    if (t === '(') { p++; const v = expr(); eat(')'); return v; }
    if (t === 'new') {
      p++; eat('Fraction'); eat('(');
      const a = expr();
      let v = a;
      if (peek() === ',') { p++; v = a.div(expr()); }
      eat(')');
      return v;
    }
    throw new TimeMigrationError(`${what}: cannot convert "${src}"`);
  }
  const v = expr();
  if (p !== toks.length) throw new TimeMigrationError(`${what}: cannot convert "${src}"`);
  return v;
}

// ---------------------------------------------------------------------------
// Formatting of exact factors
// ---------------------------------------------------------------------------

function isOne(f: Fraction) { return f.n === 1n && f.d === 1n && f.s === 1n; }

/** `3`, `(3/4)`, `(-3/4)`: a factor that can follow `*` in either precedence. */
function dslFactor(f: Fraction) {
  const s = f.s < 0n ? '-' : '';
  if (f.d === 1n) return f.s < 0n ? `(${s}${f.n})` : `${f.n}`;
  return `(${s}${f.n}/${f.d})`;
}

function legacyFraction(f: Fraction) {
  const s = f.s < 0n ? '-' : '';
  return f.d === 1n ? `new Fraction(${s}${f.n})` : `new Fraction(${s}${f.n}, ${f.d})`;
}

/** A constant written as a top-level value (BaseNote duration): `1`, `3/5`. */
function dslConstant(f: Fraction) {
  const s = f.s < 0n ? '-' : '';
  return f.d === 1n ? `${s}${f.n}` : `${s}${f.n}/${f.d}`;
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

/**
 * Convert a module object (as read from JSON) to relational time.
 * Returns a new object; the input is not modified. A module already in the
 * relational form is returned as a copy, unchanged.
 *
 * @param {object} data - { baseNote, notes[] }
 * @returns {{ data: object, migrated: boolean, report: string[] }}
 */
export function migrateTimeModel(data: InputScore) {
  const copy: InputScore = JSON.parse(JSON.stringify(data));
  if (!needsTimeMigration(copy)) return { data: copy, migrated: false, report: [] };

  const report = [];
  const base = copy.baseNote;
  const byId = new Map([[0, base]]);
  for (const n of copy.notes) byId.set(Number(n.id), n);
  const bars = new Set(copy.notes.filter(isOldBar).map(n => Number(n.id)));

  // --- old values: tempo, beats per measure, measure length per note --------
  const memo = new Map<string, Fraction>();
  const visiting = new Set<string>();

  const valueOf = (kind: TimeVariable, id: number): Fraction => {
    const key = `${kind}:${id}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) throw new TimeMigrationError(`note ${id}: ${kind} depends on itself`);
    visiting.add(key);
    try {
      const v = computeValue(kind, id);
      memo.set(key, v);
      return v;
    } finally {
      visiting.delete(key);
    }
  };

  const computeValue = (kind: TimeVariable, id: number): Fraction => {
    const note = byId.get(id);
    if (id !== 0 && !note) throw new TimeMigrationError(`a time expression names note ${id}, which does not exist`);
    let v;
    if (kind === 'tempo') {
      const s = exprText(note, 'tempo');
      v = s ? constOf(s, `note ${id} tempo`) : (id === 0 ? new Fraction(60) : valueOf('tempo', 0));
    } else if (kind === 'bpm') {
      const s = exprText(note, 'beatsPerMeasure');
      v = s ? constOf(s, `note ${id} beatsPerMeasure`) : (id === 0 ? new Fraction(4) : valueOf('bpm', 0));
    } else if (kind === 'ml') {
      const s = exprText(note, 'measureLength');
      if (s) v = constOf(s, `note ${id} measureLength`);
      else if (id === 0 || bars.has(id)) v = valueOf('bpm', id).mul(60).div(valueOf('tempo', id));
      else v = valueOf('ml', 0);
    } else { // unit
      v = new Fraction(60).div(valueOf('tempo', id));
    }
    if (v.n === 0n && kind !== 'bpm') throw new TimeMigrationError(`note ${id}: ${kind} is zero`);
    return v;
  };

  // Replace every time reference in a tempo/bpm/ml expression by its value,
  // then evaluate the arithmetic that is left.
  function constOf(src: string, what: string): Fraction {
    const lit = (f: Fraction) => `(${dslConstant(f)})`;
    const id = (g: string | undefined) => (g === undefined ? 0 : Number(g));
    let s = src
      .replace(RE.legacyBeat, (_, g) => lit(valueOf('unit', id(g))))
      .replace(RE.legacyTempo, (_, g) => lit(valueOf('tempo', id(g))))
      .replace(RE.legacyMeasure, (_, g) => lit(valueOf('ml', id(g))))
      .replace(RE.legacyVar, (_, g, v) => lit(valueOf(v === 'tempo' ? 'tempo' : v === 'beatsPerMeasure' ? 'bpm' : 'ml', id(g))))
      .replace(RE.dslHelper, (_, h, g) => lit(valueOf(h === 'beat' ? 'unit' : h === 'tempo' ? 'tempo' : 'ml', id(g))))
      .replace(RE.dslProp, (_, g, v) => lit(valueOf(v === 'tempo' ? 'tempo' : (v === 'bpm' || v === 'beatsPerMeasure') ? 'bpm' : 'ml', id(g))));
    return evalConst(s, what);
  }

  // --- every time quantity relative to the new unit, base.d ----------------------
  // Ratios need no absolute value: a note without a tempo of its own beats at
  // the BaseNote's, whatever that is. Absolute values are needed only when a
  // note sets its own tempo or a measure length is written out, and only then
  // must the BaseNote's tempo be a constant.
  const ownTempo = (id: number) => id !== 0 && exprText(byId.get(id), 'tempo') !== null;
  const ratioMemo = new Map<string, Fraction>();
  const ratio = (kind: TimeVariable, id: number): Fraction => {
    const key = `${kind}:${id}`;
    if (ratioMemo.has(key)) return ratioMemo.get(key)!;
    let r;
    if (kind === 'tempo') {
      r = ownTempo(id) ? valueOf('tempo', id).div(valueOf('tempo', 0)) : new Fraction(1);
    } else if (kind === 'unit') {
      r = new Fraction(1).div(ratio('tempo', id));
    } else { // ml, in units of base.d
      const note = byId.get(id);
      if (exprText(note, 'measureLength') !== null) r = valueOf('ml', id).div(valueOf('unit', 0));
      else if (id === 0 || bars.has(id)) r = valueOf('bpm', id).mul(ratio('unit', id));
      else r = ratio('ml', 0);
    }
    ratioMemo.set(key, r);
    return r;
  };

  // The new BaseNote duration: 60 / tempo, a constant when the tempo is one,
  // else the same relation the tempo was (e.g. a tempo read from base.f).
  let baseDuration;
  try {
    baseDuration = dslConstant(valueOf('unit', 0));
  } catch (e) {
    if (!(e instanceof TimeMigrationError)) throw e;
    const t = exprText(base, 'tempo');
    if (!t || ANY_OLD_CONSTRUCT.test(t)) throw e;
    baseDuration = /new\s+Fraction\s*\(|module\.|\.getVariable\s*\(/.test(t)
      ? `new Fraction(60).div(${t})`
      : `60 / (${t})`;
  }

  // --- what an old `.d` of the BaseNote or of a bar read (no duration: 1) ----
  const oldBaseD = exprText(base, 'duration');
  const baseDValue = oldBaseD ? constOf(oldBaseD, 'BaseNote duration') : new Fraction(1);

  // --- replacement builders ---------------------------------------------------
  const dslUnit = (k: Fraction) => (isOne(k) ? 'base.d' : `(base.d * ${dslFactor(k)})`);
  const legacyUnit = (k: Fraction) => "module.baseNote.getVariable('duration')" + (isOne(k) ? '' : `.mul(${legacyFraction(k)})`);

  const dsl = {
    unit: (id: number) => dslUnit(ratio('unit', id)),
    tempo: (id: number) => {
      const k = ratio('tempo', id);
      return isOne(k) ? '(60 / base.d)' : `(60 / base.d * ${dslFactor(k)})`;
    },
    ml: (id: number) => (bars.has(id) ? `[${id}].d` : dslUnit(ratio('ml', id))),
    bpm: (id: number) => dslFactor(valueOf('bpm', id)),
  };
  const legacy = {
    unit: (id: number) => legacyUnit(ratio('unit', id)),
    tempo: (id: number) => {
      const k = ratio('tempo', id);
      return "new Fraction(60).div(module.baseNote.getVariable('duration'))" + (isOne(k) ? '' : `.mul(${legacyFraction(k)})`);
    },
    ml: (id: number) => (bars.has(id)
      ? `module.getNoteById(${id}).getVariable('duration')`
      : legacyUnit(ratio('ml', id))),
    bpm: (id: number) => legacyFraction(valueOf('bpm', id)),
  };
  const kindOfVar = (v: string) => (v === 'tempo' ? 'tempo' : (v === 'bpm' || v === 'beatsPerMeasure') ? 'bpm' : 'ml');

  function rewrite(src: string) {
    const id = (g: string | undefined) => (g === undefined ? 0 : Number(g));
    let s = src;
    // 1. Old reads of a duration that was never set (BaseNote, bars): pin the
    //    value they had, before `base.d` and `[bar].d` gain a meaning.
    s = s.replace(/\bbase\s*\.\s*(?:d|dur|duration)\b(?!\w)/g, `(${dslConstant(baseDValue)})`);
    s = s.replace(/\[\s*0\s*\]\s*\.\s*(?:d|dur|duration)\b/g, `(${dslConstant(baseDValue)})`);
    s = s.replace(/module\.baseNote\s*\.getVariable\s*\(\s*['"]duration['"]\s*\)/g, legacyFraction(baseDValue));
    s = s.replace(/\[\s*(\d+)\s*\]\s*\.\s*(?:d|dur|duration)\b/g, (m, g) => (bars.has(Number(g)) ? '1' : m));
    s = s.replace(/module\.getNoteById\s*\(\s*(\d+)\s*\)\s*\.getVariable\s*\(\s*['"]duration['"]\s*\)/g,
      (m, g) => (bars.has(Number(g)) ? 'new Fraction(1)' : m));
    // 2. The time constructs.
    s = s.replace(RE.legacyBeat, (_, g) => legacy.unit(id(g)));
    s = s.replace(RE.legacyTempo, (_, g) => legacy.tempo(id(g)));
    s = s.replace(RE.legacyMeasure, (_, g) => legacy.ml(id(g)));
    s = s.replace(RE.legacyVar, (_, g, v) => legacy[kindOfVar(v)](id(g)));
    s = s.replace(RE.dslHelper, (_, h, g) => dsl[h === 'beat' ? 'unit' : h === 'tempo' ? 'tempo' : 'ml'](id(g)));
    s = s.replace(RE.dslProp, (_, g, v) => dsl[kindOfVar(v)](id(g)));
    return s;
  }

  // Bar durations are computed before any expression is rewritten, from the
  // old start text (which names the previous bar).
  const barDuration = new Map<number, string>();
  for (const id of bars) {
    const note = byId.get(id);
    const start = exprText(note, 'startTime')!;
    const ml = ratio('ml', id);
    let prev = null;
    let m = start.match(/^\[\s*(\d+)\s*\]\s*\.\s*(?:t|s|start|startTime)\s*\+\s*measure\s*\(\s*\[\s*(\d+)\s*\]\s*\)$/);
    if (m && m[1] === m[2]) prev = Number(m[1]);
    m = start.match(/^module\.getNoteById\s*\(\s*(\d+)\s*\)\s*\.getVariable\s*\(\s*['"]startTime['"]\s*\)\s*\.add\s*\(\s*module\.findMeasureLength\s*\(\s*module\.getNoteById\s*\(\s*(\d+)\s*\)\s*\)\s*\)$/);
    if (m && m[1] === m[2]) prev = Number(m[1]);
    if (prev !== null && bars.has(prev) && ratio('ml', prev).equals(ml)) {
      barDuration.set(id, `[${prev}].d`);
    } else {
      barDuration.set(id, isOne(ml) ? 'base.d' : `base.d * ${dslFactor(ml)}`);
    }
  }

  // --- apply -------------------------------------------------------------------
  let rewritten = 0;
  for (const note of [base, ...copy.notes]) {
    for (const k of EXPR_KEYS) {
      const s = exprText(note, k);
      if (s === null) continue;
      if (k === 'duration' && note === base) continue; // replaced below
      const r = rewrite(s);
      if (r !== s) rewritten++;
      if (note[k + 'String'] !== undefined) {
        delete note[k + 'String'];
      }
      note[k] = r;
    }
  }
  // Only now: values of later notes may read a tempo or meter of an earlier one.
  for (const note of [base, ...copy.notes]) {
    for (const k of [...OLD_KEYS, ...OLD_STRING_KEYS]) delete note[k];
  }
  for (const id of bars) {
    const note = byId.get(id);
    note!.duration = barDuration.get(id);
    note!.measure = true;
  }
  delete base.durationString;
  base.duration = baseDuration;

  report.push(
    `time unit base.d = ${baseDuration} s (was tempo ${exprText(data.baseNote, 'tempo') ?? '60'})`,
    `${bars.size} measure bar(s) given a duration`,
    `${rewritten} expression(s) rewritten`,
  );
  // Nothing of the old model may survive: a leftover would compile to 0.
  for (const note of [base, ...copy.notes]) {
    for (const k of EXPR_KEYS) {
      const s = exprText(note, k);
      if (s && ANY_OLD_CONSTRUCT.test(s)) {
        throw new TimeMigrationError(`note ${note === base ? 0 : note.id} ${k}: "${s}" still uses the old time model`);
      }
    }
  }
  return { data: copy, migrated: true, report };
}
