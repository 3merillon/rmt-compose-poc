#!/usr/bin/env node
/**
 * Variable-level dependency test.
 *
 * Evaluation order and cycle checks work per (note, variable), not per note.
 * This locks that in:
 *
 *   A. Cross-variable references between two notes. Note 1's frequency reads
 *      note 2's frequency while note 2's start reads note 1's start and
 *      duration. Between whole notes that is a loop; between variables it is
 *      not, and every value must come out exact, on the first evaluation.
 *   B. A note's own variables. The BaseNote's duration reads its own frequency,
 *      and a note's start reads its own duration: the order inside a note
 *      follows the expressions, not a fixed list.
 *   C. A true cycle is still refused. The note widget's validator rejects it
 *      with its visible errors, and a cycle that arrives in a JSON file is
 *      named in a console error and evaluates to the same values every time.
 *   D. A reference nothing defines no longer vanishes into a silent default:
 *      the console error names the note and variable on both ends.
 *   E. The incremental path. After any sequence of edits the module must
 *      equal a fresh load of its own JSON, variable for variable. Checked on
 *      named cases (edits that reach notes only through the BaseNote) and on
 *      seeded random modules and edits, cyclic ones included.
 *   F. Amplitude, an interpretation variable, is part of all of it: ordered per
 *      variable, inherited from the BaseNote, cycle-checked, and compared in
 *      E. It differs in one thing: an amplitude nobody sets is 1 by
 *      definition, so reading it is not an unresolved reference.
 *
 * On the per-note evaluator this test MUST fail: A reports a false "Dependency
 * cycle detected" and evaluates 1.f to 660, B evaluates base.d one edit late.
 * Run via `node scripts/test-variable-deps.mjs` (part of `npm test`).
 */
import type { ScoreFields } from '../src/model-types.ts';
import type { ExpressionUpdate } from '../src/module.ts';
import { required } from './fixtures/required.ts';
import type { ExpressionName } from '../src/model-types.ts';
import type { Module as ScoreModule } from '../src/module.ts';
import Fraction from 'fraction.js';

const { Module } = await import('../src/module.ts');
const { validateExpression } = await import('../src/modals/validation.ts');
const { compiler } = await import('../src/expression-compiler.ts');
const { findDependencyCycle } = await import('../src/variable-deps.ts');

const VARS: ExpressionName[] = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];
const BASE = { frequency: '263', startTime: '0', duration: '1' };

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (condition: unknown, msg: string) => (condition ? ok(msg) : fail(msg));

/** Exact text of an evaluated value: 'n/d' from the BigInt fields, or 'null'. */
const show = (v: Fraction | null | undefined) => (v == null ? 'null' : `${v.s * v.n}/${v.d}`);

/** Assert one evaluated variable against an exact fraction written as 'n/d' or 'n'. */
function expectValue(mod: ScoreModule, noteId: number, variable: ExpressionName, expected: string, label: string) {
  const value = mod.getNoteById(noteId)!.getVariable(variable);
  if (value != null && value.equals(new Fraction(expected))) {
    ok(`${label}: ${expected}`);
  } else {
    fail(`${label}: got ${show(value)}, want ${expected}`);
  }
}

/** Run fn with console.warn / console.error collected instead of printed. */
function captureConsole<T>(fn: () => T) {
  const lines: { level: string; text: string }[] = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args) => lines.push({ level: 'warn', text: args.map(String).join(' ') });
  console.error = (...args) => lines.push({ level: 'error', text: args.map(String).join(' ') });
  try {
    const result = fn();
    return { result, lines, errors: lines.filter((l) => l.level === 'error').map((l) => l.text) };
  } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
}

/** The widget's validator: the error message it would show, or null when it accepts. */
function refusal(mod: ScoreModule, noteId: number, variable: ExpressionName, expression: string) {
  try {
    captureConsole(() => validateExpression(mod, noteId, expression, variable));
    return null;
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return e.message;
  }
}

/**
 * Compare a module's current (incrementally maintained) values with a fresh
 * load of its own JSON. Returns the first difference as text, or null.
 */
async function differenceFromFreshLoad(mod: ScoreModule) {
  const fresh = await Module.loadFromJSON(mod.createModuleJSON());
  const expected = captureConsole(() => fresh.evaluateModule()).result;
  const actual = mod.evaluateModule();

  for (const id of Object.keys(fresh.notes).map(Number)) {
    const want = expected.get(id);
    const got = actual.get(id);
    if (!got) return `note ${id} has no evaluated record`;
    for (const variable of VARS) {
      if (show(got[variable]) !== show(required(want)[variable])) {
        return `[${id}].${variable} is ${show(got[variable])}, a fresh load gives ${show(required(want)[variable])}`;
      }
    }
    if (got.corruptionFlags !== required(want).corruptionFlags) {
      return `[${id}] corruption flags ${got.corruptionFlags}, a fresh load gives ${required(want).corruptionFlags}`;
    }
  }
  return null;
}

// --- A: cross-variable references between two notes -----------------------------
console.log('A. Two notes reading each other through different variables\n');
{
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: '(3/2) * [2].f' },
      { id: 2, startTime: '[1].t + [1].d', duration: 'base.d * 2', frequency: '(5/4) * base.f' },
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 1, 'frequency', '3945/8', 'A1 [1].f = (3/2) * [2].f');
  expectValue(mod, 2, 'frequency', '1315/4', 'A2 [2].f = (5/4) * base.f');
  expectValue(mod, 2, 'startTime', '1', 'A3 [2].t = [1].t + [1].d');
  check(lines.length === 0, `A4 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);

  // Same values after re-evaluation: no dependence on what was cached before
  mod.baseNote.setVariable('frequency', '263');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 1, 'frequency', '3945/8', 'A5 [1].f unchanged by a re-evaluation');

  // A change to [2].f reaches [1].f; a change to [1].d reaches [2].t
  mod.getNoteById(2)!.setVariable('frequency', '(4/3) * base.f');
  mod.getNoteById(1)!.setVariable('duration', 'base.d * 3');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 1, 'frequency', '526', 'A6 [1].f follows an edit of [2].f');
  expectValue(mod, 2, 'startTime', '3', 'A7 [2].t follows an edit of [1].d');
}

// --- B: a note's own variables -------------------------------------------------
console.log('\nB. Variables of one note reading each other\n');
{
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', duration: '256 / base.f' },
    notes: [
      // start reads this note's own duration
      { id: 1, startTime: '[1].d * 3', duration: 'base.d / 2', frequency: 'base.f' },
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 0, 'duration', '256/263', 'B1 base.d = 256 / base.f');
  expectValue(mod, 1, 'duration', '128/263', 'B3 [1].d = base.d / 2');
  expectValue(mod, 1, 'startTime', '384/263', 'B4 [1].t = [1].d * 3');
  check(lines.length === 0, `B5 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);

  // The time unit must follow its frequency at once, not one edit late
  mod.baseNote.setVariable('frequency', '300');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 0, 'duration', '64/75', 'B6 base.d follows an edit of base.f immediately');
  expectValue(mod, 1, 'startTime', '32/25', 'B7 [1].t follows it too');
}
{
  // Order has to follow reads into the BaseNote as well. base.d is evaluated
  // late, because it reads note 3, which reads a bar of fixed length; the bar
  // after that one reads base.d, so it must come later still.
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', duration: '[3].d * (3/2)' },
    notes: [
      { id: 3, startTime: 'base.t', duration: '[4].d / 2', frequency: 'base.f' },
      { id: 4, startTime: 'base.t', duration: '2', measure: true },                // a bar of its own length
      { id: 6, startTime: '[4].t + [4].d', duration: 'base.d * 3', measure: true }, // a bar three time units long
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 4, 'duration', '2', 'B8 a bar of fixed length: [4].d = 2');
  expectValue(mod, 3, 'duration', '1', 'B9 [3].d = [4].d / 2');
  expectValue(mod, 0, 'duration', '3/2', 'B10 base.d = [3].d * (3/2), evaluated after note 3');
  expectValue(mod, 6, 'duration', '9/2', 'B11 and the bar reading base.d follows');
  check(lines.length === 0, `B12 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);
}

// --- C: a true cycle is still refused ------------------------------------------
console.log('\nC. A true cycle is refused\n');
{
  // C1-C6: at edit time, by the validator behind the note widget's Save button
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: '(3/2) * [2].f' },
      { id: 2, startTime: '[1].t + [1].d', duration: 'base.d * 2', frequency: '(5/4) * base.f' },
      { id: 3, startTime: 'base.t', duration: 'base.d', frequency: 'base.f * (3/2)' },
      { id: 4, startTime: 'base.t + base.d * 4', duration: 'base.d * 4', measure: true }, // a measure bar
      { id: 5, startTime: '[4].t', duration: '[4].d / 4', frequency: 'base.f' },
    ],
  });
  captureConsole(() => mod.evaluateModule());

  const CIRCULAR = 'Circular dependency detected in expression';
  const SELF = 'Expression cannot reference itself directly';

  check(refusal(mod, 2, 'frequency', '(5/4) * [1].f') === CIRCULAR,
    'C1 [2].f from [1].f while [1].f reads [2].f: refused as circular');
  check((refusal(mod, 2, 'frequency', "module.getNoteById(1)!.getVariable('frequency').mul(new Fraction(5, 4))") || '').startsWith('The method-chain syntax was retired'),
    'C2 the same typed in the retired method-chain syntax: refused, with its DSL form');
  check(refusal(mod, 1, 'frequency', '[1].f * 2') === SELF,
    'C3 [1].f from [1].f: refused as a self-reference');
  check(refusal(mod, 0, 'frequency', 'base.f * 2') === SELF,
    'C4 base.f from base.f: refused as a self-reference');
  check(refusal(mod, 0, 'frequency', '[3].f * 2') === CIRCULAR,
    'C5 base.f from [3].f while [3].f reads base.f: refused as circular');
  check(refusal(mod, 1, 'duration', '[2].t / 2') === CIRCULAR,
    'C6 [1].d from [2].t while [2].t reads [1].d: refused as circular');

  // ...and only true cycles: these read the same notes through other variables
  check(refusal(mod, 2, 'duration', '[1].d * 2') === null,
    'C7 [2].d from [1].d: accepted (notes 1 and 2 read each other, no variable reads itself)');
  check(refusal(mod, 3, 'startTime', '[3].d * 2') === null,
    'C8 [3].t from [3].d: accepted (another variable of the same note)');
  check(refusal(mod, 0, 'duration', '256 / base.f') === null,
    'C9 base.d from base.f: accepted');
  check(refusal(mod, 0, 'duration', '[3].d * 2') === CIRCULAR,
    'C10 base.d from [3].d while [3].d reads base.d: refused as circular');

  // The loop may close through a bar
  check(refusal(mod, 0, 'duration', '[5].d * 4') === CIRCULAR,
    'C11 base.d from [5].d = [4].d / 4, where the bar [4].d reads base.d: refused as circular');
  check(refusal(mod, 0, 'duration', '[4].d / 4') === CIRCULAR,
    'C12 base.d from a bar\'s duration that reads base.d: refused as circular');
  check(refusal(mod, 0, 'frequency', '[5].d * 440') === null,
    'C13 base.f from [5].d: accepted (time and pitch are separate variables)');
}
{
  // C14-C17: a cycle that arrives in a file is evaluated, reported, and stable
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: '(3/2) * [2].f' },
      { id: 2, startTime: 'base.t', duration: 'base.d', frequency: '(5/4) * [1].f' },
      { id: 3, startTime: '[2].t + [2].d', duration: 'base.d', frequency: 'base.f * 2' },
    ],
  });
  const first = captureConsole(() => mod.evaluateModule());
  const cycleError = first.errors.find((text) => text.includes('Dependency cycle detected'));

  check(!!cycleError, 'C14 the evaluator reports "Dependency cycle detected" as a console error');
  check(!!cycleError && cycleError.includes('[1].frequency') && cycleError.includes('[2].frequency'),
    'C15 the error names [1].frequency and [2].frequency');
  expectValue(mod, 3, 'startTime', '1', 'C16 variables outside the loop still evaluate: [3].t');

  // Before: every re-evaluation fed the loop its own previous output, so the values grew
  const before = [show(mod.getNoteById(1)!.getVariable('frequency')), show(mod.getNoteById(2)!.getVariable('frequency'))];
  mod.baseNote.setVariable('duration', '1');
  captureConsole(() => mod.evaluateModule());
  const after = [show(mod.getNoteById(1)!.getVariable('frequency')), show(mod.getNoteById(2)!.getVariable('frequency'))];
  check(before.join() === after.join(), `C17 the loop's values do not drift across re-evaluations (${before.join(', ')})`);
}
{
  // C18: nor do they depend on which note a batch reaches the loop from. A
  // full evaluation enters the loop [5].f <-> [6].f through note 2; the batch
  // edit of note 9 re-evaluates notes 5, 6 and 9 only, and enters it at note 5.
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 2, startTime: 'base.t', duration: 'base.d', frequency: '[6].f * 2' },
      { id: 5, startTime: 'base.t', duration: 'base.d', frequency: '[6].f * (3/2)' },
      { id: 6, startTime: 'base.t', duration: 'base.d', frequency: '[5].f * (5/4)' },
      { id: 9, startTime: 'base.t', duration: 'base.d', frequency: '[5].f * 3' },
    ],
  });
  captureConsole(() => mod.evaluateModule());
  captureConsole(() => {
    mod.batchSetExpressions([{ noteId: 9, varName: 'frequency', expr: '[5].f * 4' }]);
    mod.evaluateModule();
  });
  const difference = await differenceFromFreshLoad(mod);
  check(difference === null, `C18 a loop evaluates the same from any entry point${difference ? `: ${difference}` : ''}`);
}

// --- D: unresolved references are named ------------------------------------------
console.log('\nD. A reference nothing defines is named\n');
{
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: '(3/2) * [9].f' },
      { id: 2, startTime: 'base.t + base.d * 4' },                                     // a start alone: no duration
      { id: 3, startTime: '[2].t + [2].d', duration: 'base.d', frequency: 'base.f' },
    ],
  });
  const { errors } = captureConsole(() => mod.evaluateModule());
  const report = errors.find((text) => text.includes('Unresolved reference')) || '';

  check(report.includes('[1].frequency reads [9].frequency') && report.includes('note 9 does not exist'),
    'D1 a reference to a missing note names reader and target: [1].frequency reads [9].frequency');
  check(report.includes('[3].startTime reads [2].duration') && report.includes('note 2 has no duration'),
    'D2 a reference to a variable the note lacks: [3].startTime reads [2].duration');
  expectValue(mod, 1, 'frequency', '660', 'D3 the documented default is still what gets used: 440 * (3/2)');
  expectValue(mod, 3, 'startTime', '5', 'D4 and 1 for a duration: [2].t + 1');
  // base.d is never unresolved: every module's reference note has a duration
  expectValue(mod, 3, 'duration', '1', 'D5 the time unit is a real value: [3].d = base.d');
  check(!report.includes('[3].duration'), 'D6 and is not reported');
  check(errors.length === 1, `D7 one console error for the whole evaluation (${errors.length})`);
}

// --- E: the incremental path -------------------------------------------------------
console.log('\nE. Incremental evaluation equals a fresh load\n');
{
  // Notes 2 and 4 never mention the BaseNote, yet depend on it through notes 1 and 3
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '440', startTime: '0', duration: '1' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f * (3/2)' },
      { id: 2, startTime: '[1].t + [1].d', duration: '[1].d', frequency: '[1].f * (5/4)' },
      { id: 3, startTime: 'base.t + base.d * 4', duration: 'base.d * 4', measure: true },
      { id: 4, startTime: '[3].t + [3].d', duration: '[3].d', measure: true },
      // A measure bar at a fixed time, four time units long, and a note timed by it
      { id: 5, startTime: '8', duration: 'base.d * 4', measure: true },
      { id: 6, startTime: '[5].t + [5].d', duration: 'base.d', frequency: '[2].f' },
    ],
  });
  mod.evaluateModule();
  mod.baseNote.setVariable('frequency', '400');
  mod.baseNote.setVariable('duration', '1/2');
  mod.evaluateModule();

  expectValue(mod, 2, 'frequency', '750', 'E1 a BaseNote edit reaches [2].f through [1].f');
  expectValue(mod, 2, 'startTime', '1/2', 'E2 and [2].t through [1].d');
  expectValue(mod, 4, 'startTime', '4', 'E3 and a chained measure bar, which never names the BaseNote');
  expectValue(mod, 6, 'startTime', '10', 'E4 and a note after a bar whose length reads base.d');
  expectValue(mod, 6, 'duration', '1/2', 'E5 and a note lasting base.d');

  // Removing a note re-evaluates what referenced it, as a reload would
  const { errors } = captureConsole(() => { mod.removeNote(1); mod.evaluateModule(); });
  expectValue(mod, 2, 'frequency', '550', 'E6 after removeNote(1), [2].f is what a reload gives');
  check(errors.some((text) => text.includes('[2].frequency reads [1].frequency')),
    'E7 and the broken reference is named');
  const difference = await differenceFromFreshLoad(mod);
  check(difference === null, `E8 the module equals a fresh load of its JSON${difference ? `: ${difference}` : ''}`);
}
{
  // The irrational-value ("corruption") flag is refreshed for every note that
  // gets re-evaluated, also one reached only through the BaseNote: [2].f is a
  // square root of [1].f, exact while base.f is 4 and irrational once it is 2.
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '4', startTime: '0', duration: '1' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' },
      { id: 2, startTime: '[1].t + [1].d', duration: '[1].d', frequency: '[1].f ^ (1/2)' },
    ],
  });
  mod.evaluateModule();
  const graph = mod.getDependencyGraph();
  const exactBefore = show(mod.getNoteById(2)!.getVariable('frequency')) === '2/1' && graph.getCorruptionFlags(2) === 0;
  mod.baseNote.setVariable('frequency', '2');
  mod.evaluateModule();
  check(exactBefore && graph.getCorruptionFlags(2) === 0x04,
    `E9 the irrational flag of [2].f follows a BaseNote edit (flags ${graph.getCorruptionFlags(2)})`);
}
{
  // Seeded random modules and edits. Every expression is a sum of positive
  // terms, so no value is ever zero and no division can fail.
  let seed = 0;
  const random = () => {                       // mulberry32
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const ratio = () => `(${1 + Math.floor(random() * 9)}/${1 + Math.floor(random() * 9)})`;

  const atom = (ids: number[]) => {
    const target = pick(ids);
    const ref = target === 0 ? 'base' : `[${target}]`;
    const form = pick(['t', 'd', 'f', 'a', 'attack', 'release']);
    return `${ref}.${form}`;
  };
  const expression = (ids: number[]) => {
    let text = ratio();
    const terms = Math.floor(random() * 3);
    for (let i = 0; i < terms; i++) text += ` + ${atom(ids)} * ${ratio()}`;
    return text;
  };
  const noteVariables = (ids: number[]) => {
    const kind = random();
    if (kind < 0.2) {                                                   // measure bar
      return { startTime: expression(ids), duration: expression(ids), measure: true };
    }
    const note: ScoreFields = { startTime: expression(ids), duration: expression(ids) };
    if (kind > 0.3) note.frequency = expression(ids);                   // else a silence
    if (random() < 0.3) note.amplitude = expression(ids);
    if (random() < 0.15) note.attack = expression(ids);
    if (random() < 0.15) note.release = expression(ids);
    return note;
  };

  const SEEDS = 60;
  const EDITS = 30;
  let comparisons = 0;
  let cyclicStates = 0;
  let firstFailure = null;

  for (let s = 1; s <= SEEDS && !firstFailure; s++) {
    seed = s * 7919;
    const size = 6 + Math.floor(random() * 10);
    const trail = [];

    // Start from an acyclic module: each note reads only earlier ones
    const notes = [];
    for (let id = 1; id <= size; id++) {
      notes.push({ id, ...noteVariables(Array.from({ length: id }, (_, n) => n)) });
    }
    const mod = await Module.loadFromJSON({ baseNote: { ...BASE }, notes });
    // ids a reference may name: the existing notes, the BaseNote, and now and then a missing one
    const referable = () => Object.keys(mod.notes).map(Number).concat(random() < 0.05 ? [99] : []);

    for (let step = 0; step <= EDITS && !firstFailure; step++) {
      if (step > 0) {
        const ids = Object.keys(mod.notes).map(Number);
        const action = random();
        if (action < 0.08) {
          const id = mod.addNote(noteVariables(referable())).id;
          trail.push(`add ${id}`);
        } else if (action < 0.14 && ids.length > 3) {
          const id = pick(ids.filter((n) => n !== 0));
          captureConsole(() => mod.removeNote(id));
          trail.push(`remove ${id}`);
        } else {
          // One edit, or several applied as a batch
          const updates: ExpressionUpdate[] = [];
          const wanted = action > 0.85 ? 3 : 1;
          // Like the widget, apply only what the validator accepts. One edit in
          // ten does the opposite on purpose and closes a loop, as a hand-written
          // file could: even then the values must not depend on the edit history.
          const wantCycle = random() < 0.1;
          for (let attempt = 0; attempt < 40 && updates.length < wanted; attempt++) {
            const noteId = pick(ids);
            const note = mod.getNoteById(noteId);
            // Mostly rewrite a variable the note has; sometimes give it a new one
            // (an attack of its own, a frequency that turns a silence into a note)
            const varName = pick(random() < 0.2 ? VARS : VARS.filter((v) => required(note).hasExpression(v)));
            const expr = expression(referable());
            const closesLoop = findDependencyCycle(mod, noteId, varName, compiler.compile(expr)) !== null;
            if (closesLoop !== wantCycle && attempt < 39) continue;
            if (closesLoop && !wantCycle) continue;
            if (updates.some((u) => u.noteId === noteId)) continue;
            updates.push({ noteId, varName, expr });
          }
          if (updates.length === 1) {
            mod.getNoteById(updates[0].noteId)!.setVariable(updates[0].varName + 'String', updates[0].expr);
          } else if (updates.length > 1) {
            mod.batchSetExpressions(updates);
          }
          trail.push(...updates.map((u) => `[${u.noteId}].${u.varName} = ${u.expr}`));
        }
      }

      const { errors } = captureConsole(() => mod.evaluateModule());
      if (errors.some((text) => text.includes('Dependency cycle detected'))) cyclicStates++;
      const difference = await differenceFromFreshLoad(mod);
      comparisons++;
      if (difference) {
        firstFailure = `seed ${s}, step ${step}: ${difference}\n      last edits: ${trail.slice(-4).join(' | ')}`;
      }
    }
  }

  check(firstFailure === null,
    `E10 ${comparisons} random states (${SEEDS} modules, ${cyclicStates} of them re-evaluated with a cycle present) equal a fresh load${firstFailure ? `\n      ${firstFailure}` : ''}`);
}

// --- F: amplitude ---------------------------------------------------------------------
console.log('\nF. Amplitude: ordered, inherited and cycle-checked like the others\n');
{
  const tone = { startTime: 'base.t', duration: 'base.d', frequency: 'base.f' };
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE, amplitude: '(3/4)' },
    notes: [
      { id: 1, ...tone, amplitude: '(1/2)' },
      { id: 2, ...tone, amplitude: '(121/100) * [1].a' },
      { id: 3, ...tone, amplitude: 'base.a * 2' },
      { id: 4, ...tone, amplitude: '[5].a * 2' },
      { id: 5, ...tone },                                    // sets none: sounds at the BaseNote's
      // Two notes that never mention the BaseNote, in any variable
      { id: 7, startTime: '0', duration: '1', frequency: '440' },
      { id: 8, startTime: '0', duration: '1', frequency: '440', amplitude: '[7].a * 2' },
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 2, 'amplitude', '121/200', 'F1 from another note: [2].a = (121/100) * [1].a');
  expectValue(mod, 3, 'amplitude', '3/2', 'F2 from the BaseNote: [3].a = base.a * 2');
  expectValue(mod, 4, 'amplitude', '3/2', 'F3 through a note that sets none: [5].a is the BaseNote\'s');
  check(required(mod.evaluateModule().get(5)).amplitude === null, 'F4 and that note still stores no amplitude of its own');
  check(lines.length === 0, `F5 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);

  // [8].a names only note 7, and neither note mentions the BaseNote anywhere:
  // the edit can reach it only because an inherited amplitude is a dependency.
  mod.baseNote.setVariable('amplitude', '(1/4)');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 8, 'amplitude', '1/2', 'F6 a BaseNote amplitude edit reaches [8].a, which never names the BaseNote');
  expectValue(mod, 4, 'amplitude', '1/2', 'F7 and [4].a through the inheriting note 5');
  expectValue(mod, 3, 'amplitude', '1/2', 'F8 and [3].a, which names the BaseNote');
  const difference = await differenceFromFreshLoad(mod);
  check(difference === null, `F9 the module equals a fresh load of its JSON${difference ? `: ${difference}` : ''}`);
}
{
  // Nobody sets an amplitude. 1 is then its value, not a stand-in for a missing
  // one, so reading it is not reported; a note that does not exist still is.
  const tone = { startTime: 'base.t', duration: 'base.d', frequency: 'base.f' };
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, ...tone },
      { id: 2, ...tone, amplitude: '[1].a * 2 + base.a' },
      { id: 3, ...tone, amplitude: '[9].a * 2' },
    ],
  });
  const { errors } = captureConsole(() => mod.evaluateModule());
  const report = errors.find((text) => text.includes('Unresolved reference')) || '';

  expectValue(mod, 2, 'amplitude', '3', 'F10 with no amplitude set anywhere, [1].a and base.a are 1');
  check(!report.includes('[2].amplitude'), 'F11 and reading them is not reported as unresolved');
  check(report.includes('[3].amplitude reads [9].amplitude') && report.includes('note 9 does not exist'),
    'F12 an amplitude read from a missing note is: [3].amplitude reads [9].amplitude');
  expectValue(mod, 3, 'amplitude', '2', 'F13 with 1 used in its place');
  check(errors.length === 1, `F14 one console error for the whole evaluation (${errors.length})`);
}
{
  // Across variables: note 1's amplitude reads note 2's duration while note 2's
  // start and frequency read note 1's amplitude. A loop between the notes, a
  // tree between the variables. (A fixed "amplitude last" order cannot do this.)
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f', amplitude: '[2].d / base.d' },
      { id: 2, startTime: '[1].t + [1].d * [1].a', duration: 'base.d * 2', frequency: '[1].f * [1].a' },
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 1, 'amplitude', '2', 'F15 [1].a = [2].d / base.d');
  expectValue(mod, 2, 'startTime', '2', 'F16 [2].t = [1].t + [1].d * [1].a, on the first evaluation');
  expectValue(mod, 2, 'frequency', '526', 'F17 a frequency may read an amplitude: [2].f = [1].f * [1].a');
  check(lines.length === 0, `F18 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);

  mod.getNoteById(2)!.setVariable('duration', 'base.d * 3');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 2, 'startTime', '3', 'F19 an edit of [2].d reaches [2].t through [1].a');
}
{
  // F20-F26: a true cycle is refused by the validator behind the widget's Save button
  const tone = { startTime: 'base.t', duration: 'base.d', frequency: 'base.f' };
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE, amplitude: '(3/4)' },
    notes: [
      { id: 1, ...tone, amplitude: '(1/2)' },
      { id: 2, ...tone, amplitude: '(121/100) * [1].a' },
      { id: 5, ...tone },                                    // inherits the BaseNote's
      { id: 6, ...tone, amplitude: '[5].a * 2' },
    ],
  });
  captureConsole(() => mod.evaluateModule());

  const CIRCULAR = 'Circular dependency detected in expression';
  const SELF = 'Expression cannot reference itself directly';

  check(refusal(mod, 1, 'amplitude', '[2].a * 2') === CIRCULAR,
    'F20 [1].a from [2].a while [2].a reads [1].a: refused as circular');
  check((refusal(mod, 1, 'amplitude', "module.getNoteById(2)!.getVariable('amplitude').mul(new Fraction(2))") || '').startsWith('The method-chain syntax was retired'),
    'F21 the same typed in the retired method-chain syntax: refused, with its DSL form');
  check(refusal(mod, 1, 'amplitude', '[1].a * 2') === SELF,
    'F22 [1].a from [1].a: refused as a self-reference');
  check(refusal(mod, 0, 'amplitude', '[6].a * 2') === CIRCULAR,
    'F23 base.a from [6].a = [5].a * 2, an amplitude note 5 inherits from the BaseNote: refused as circular');
  check(refusal(mod, 0, 'amplitude', '[5].a * 2') === SELF,
    'F24 base.a from [5].a, which is the BaseNote\'s own: refused as a self-reference');

  // ...and only true cycles
  check(refusal(mod, 1, 'duration', '[2].a * base.d') === null,
    'F25 [1].d from [2].a while [2].a reads [1].a: accepted (no variable reads itself)');
  check(refusal(mod, 1, 'amplitude', '[6].a + [1].d') === null,
    'F26 [1].a from [6].a and its own duration: accepted');
}
{
  // F27-F30: a cycle that arrives in a file is evaluated, reported, and stable
  const tone = { startTime: 'base.t', duration: 'base.d', frequency: 'base.f' };
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, ...tone, amplitude: '[2].a * 2' },
      { id: 2, ...tone, amplitude: '[1].a * (1/2) + 1' },
      { id: 3, ...tone, amplitude: '(3/2)' },
    ],
  });
  const first = captureConsole(() => mod.evaluateModule());
  const cycleError = first.errors.find((text) => text.includes('Dependency cycle detected'));

  check(!!cycleError && cycleError.includes('[1].amplitude') && cycleError.includes('[2].amplitude'),
    'F27 the evaluator reports the cycle and names [1].amplitude and [2].amplitude');
  expectValue(mod, 3, 'amplitude', '3/2', 'F28 an amplitude outside the loop still evaluates');

  const before = [show(mod.getNoteById(1)!.getVariable('amplitude')), show(mod.getNoteById(2)!.getVariable('amplitude'))];
  mod.baseNote.setVariable('duration', '1');
  captureConsole(() => mod.evaluateModule());
  const after = [show(mod.getNoteById(1)!.getVariable('amplitude')), show(mod.getNoteById(2)!.getVariable('amplitude'))];
  check(before.join() === after.join(), `F29 the loop's values do not drift across re-evaluations (${before.join(', ')})`);
  const difference = await differenceFromFreshLoad(mod);
  check(difference === null, `F30 and equal a fresh load${difference ? `: ${difference}` : ''}`);
}
{
  // Order has to follow the inherited read. base.d needs [4].a, and [4].a
  // reads [5].a, which is the BaseNote's own amplitude: base.a must come first,
  // although nothing on the way names it.
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', duration: '[4].a * (2/3)', amplitude: '(3/4)' },
    notes: [
      { id: 4, startTime: '0', duration: '1', frequency: '440', amplitude: '[5].a * 2' },
      { id: 5, startTime: '0', duration: '1', frequency: '440' },
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 0, 'duration', '1', 'F31 base.d = [4].a * (2/3) waits for the amplitude note 5 inherits');
  check(lines.length === 0, `F32 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);
}

// --- G: a drag that lands at a note's end follows it (src/utils/followed-note.js) ---
console.log('\nG. A note dragged exactly to the end of another follows it\n');
{
  const { findFollowedNote, followExpr } = await import('../src/utils/followed-note.ts');
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', duration: '1/2' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d * 4', measure: true },
      { id: 2, startTime: 'base.t', duration: 'base.d * 2', frequency: 'base.f' },
      { id: 3, startTime: 'base.t + base.d', duration: 'base.d', frequency: '(5/4) * base.f' },
      { id: 4, startTime: 'base.t + base.d * 3', duration: 'base.d', frequency: '(3/2) * [2].f' },
      { id: 5, startTime: '[4].t', duration: 'base.d * (1/2)', frequency: '(2/1) * [4].f' },
      { id: 6, startTime: '[1].t + [1].d', duration: '[1].d', measure: true },
    ],
  });
  captureConsole(() => mod.evaluateModule());
  const n = (id: number) => required(mod.getNoteById(id));
  // Notes 2 and 3 both end at 1 s. 3 starts later, so it is the one followed.
  const f1 = findFollowedNote(mod, n(4), 1);
  check(f1 && f1.id === 3, `G1 at 1 s notes 2 and 3 both end; the later-starting 3 is followed (got ${f1 && f1.id})`);
  const f2 = findFollowedNote(mod, n(4), 1, n(2));
  check(f2 && f2.id === 2, 'G2 the current start parent wins when it ends there too');
  check(findFollowedNote(mod, n(4), 1.125) === null, 'G3 no note ends at 1.125 s: nothing to follow');
  check(findFollowedNote(mod, n(3), 4) === null, 'G4 a bar is never followed (bar 6 ends at 4 s, the only end there)');
  // 5 depends on 4 (t and f). Moving 4 to 5's end would make 4 hang from 5: a cycle.
  check(findFollowedNote(mod, n(4), 1.75) === null, 'G5 a note that depends on the moved one is not followed (no cycle)');
  n(4).setVariable('startTimeString', followExpr(3));
  captureConsole(() => mod.evaluateModule());
  check(n(4).variables.startTimeString === '[3].t + [3].d' && required(n(4).getVariable('startTime')).equals(new Fraction(1)),
    'G6 written [3].t + [3].d, it evaluates to exactly 1 s, and note 5 follows it');
}

{
  const { findFollowedNote } = await import('../src/utils/followed-note.ts');
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '440', startTime: '0', duration: '1' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' },
      { id: 2048, startTime: '100 * base.d', duration: 'base.d' },
      { id: 4100, startTime: '100 * base.d', duration: 'base.d', frequency: 'base.f' },
    ],
  });
  const find = (time: number) => findFollowedNote(mod, mod.notes[1], time)?.id ?? null;
  check(find(101) === 2048, 'G7 a rest is eligible and the lowest ID breaks an equal-start tie across blocks');
  mod.notes[2048].setVariable('durationString', '7 * base.d');
  check(find(101) === 4100 && find(107) === 2048, 'G8 a cached range expands and its old match disappears');
  mod.notes[2048].setVariable('startTimeString', '51 * base.d');
  check(find(107) === null && find(58.00005) === 2048 && find(58.00007) === null,
    'G9 shrinking a range preserves the original landing tolerance at its boundary');
  mod.removeNote(2048);
  check(find(58) === null, 'G10 removing the only note in a sparse block removes its match');
  const added = mod.addNote({ startTimeString: '200 * base.d', durationString: 'base.d', frequencyString: 'base.f' });
  check(find(201) === added.id, 'G11 an added note is reachable in the rebuilt index');
  for (let i = 0; i < 10; i++) {
    added.setVariable('durationString', (i + 2) + ' * base.d');
    mod.evaluateModule();
  }
  check(find(211) === added.id && find(201) === null, 'G12 a gap in the evaluation journal rebuilds drop ranges');
}

console.log(`\n${failures ? `${failures} failure(s).` : 'All variable-dependency checks passed.'}`);
process.exit(failures ? 1 : 0);
