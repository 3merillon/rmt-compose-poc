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
 *   B. A note's own variables. The BaseNote's tempo reads its own frequency,
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
 *
 * On the per-note evaluator this test MUST fail: A reports a false "Dependency
 * cycle detected" and evaluates 1.f to 660, B evaluates tempo to 825/8.
 * Run via `node scripts/test-variable-deps.mjs` (part of `npm test`).
 */
import Fraction from 'fraction.js';

const { Module } = await import('../src/module.js');
const { validateExpression } = await import('../src/modals/validation.js');
const { compiler } = await import('../src/expression-compiler.js');
const { findDependencyCycle } = await import('../src/variable-deps.js');

const VARS = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
const BASE = { frequency: '263', startTime: '0', tempo: '60', beatsPerMeasure: '4' };

let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const check = (condition, msg) => (condition ? ok(msg) : fail(msg));

/** Exact text of an evaluated value: 'n/d' from the BigInt fields, or 'null'. */
const show = (v) => (v == null ? 'null' : `${v.s * v.n}/${v.d}`);

/** Assert one evaluated variable against an exact fraction written as 'n/d' or 'n'. */
function expectValue(mod, noteId, variable, expected, label) {
  const value = mod.getNoteById(noteId).getVariable(variable);
  if (value != null && value.equals(new Fraction(expected))) {
    ok(`${label}: ${expected}`);
  } else {
    fail(`${label}: got ${show(value)}, want ${expected}`);
  }
}

/** Run fn with console.warn / console.error collected instead of printed. */
function captureConsole(fn) {
  const lines = [];
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
function refusal(mod, noteId, variable, expression) {
  try {
    captureConsole(() => validateExpression(mod, noteId, expression, variable));
    return null;
  } catch (e) {
    return e.message;
  }
}

/**
 * Compare a module's current (incrementally maintained) values with a fresh
 * load of its own JSON. Returns the first difference as text, or null.
 */
async function differenceFromFreshLoad(mod) {
  const fresh = await Module.loadFromJSON(mod.createModuleJSON());
  const expected = captureConsole(() => fresh.evaluateModule()).result;
  const actual = mod.evaluateModule();

  for (const id of Object.keys(fresh.notes).map(Number)) {
    const want = expected.get(id);
    const got = actual.get(id);
    if (!got) return `note ${id} has no evaluated record`;
    for (const variable of VARS) {
      if (show(got[variable]) !== show(want[variable])) {
        return `[${id}].${variable} is ${show(got[variable])}, a fresh load gives ${show(want[variable])}`;
      }
    }
    if (got.corruptionFlags !== want.corruptionFlags) {
      return `[${id}] corruption flags ${got.corruptionFlags}, a fresh load gives ${want.corruptionFlags}`;
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
      { id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: '(3/2) * [2].f' },
      { id: 2, startTime: '[1].t + [1].d', duration: 'beat(base) * 2', frequency: '(5/4) * base.f' },
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
  mod.getNoteById(2).setVariable('frequency', '(4/3) * base.f');
  mod.getNoteById(1).setVariable('duration', 'beat(base) * 3');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 1, 'frequency', '526', 'A6 [1].f follows an edit of [2].f');
  expectValue(mod, 2, 'startTime', '3', 'A7 [2].t follows an edit of [1].d');
}

// --- B: a note's own variables -------------------------------------------------
console.log('\nB. Variables of one note reading each other\n');
{
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', tempo: 'base.f * (15/64)', beatsPerMeasure: '4' },
    notes: [
      // start reads this note's own duration
      { id: 1, startTime: '[1].d * 3', duration: 'beat(base) / 2', frequency: 'base.f' },
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 0, 'tempo', '3945/64', 'B1 base.tempo = base.f * (15/64)');
  expectValue(mod, 0, 'measureLength', '1024/263', 'B2 base.measureLength follows that tempo');
  expectValue(mod, 1, 'duration', '128/263', 'B3 [1].d = beat(base) / 2');
  expectValue(mod, 1, 'startTime', '384/263', 'B4 [1].t = [1].d * 3');
  check(lines.length === 0, `B5 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);

  // The tempo must follow its frequency at once, not one edit late
  mod.baseNote.setVariable('frequency', '300');
  captureConsole(() => mod.evaluateModule());
  expectValue(mod, 0, 'tempo', '1125/16', 'B6 base.tempo follows an edit of base.f immediately');
  expectValue(mod, 1, 'startTime', '32/25', 'B7 [1].t follows it too');
}
{
  // Order also has to follow the two implicit reads: a measure bar's computed
  // measureLength (from beatsPerMeasure and tempo) and inherited variables.
  // Here base.tempo is evaluated late, because it reads note 3; what note 3
  // reads needs base.beatsPerMeasure, which must therefore come first.
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', tempo: '[3].d * 40', beatsPerMeasure: '3' },
    notes: [
      { id: 3, startTime: 'base.t', duration: 'measure([4]) / 4 + [6].bpm / 6', frequency: 'base.f' },
      { id: 4, startTime: 'base.t', tempo: '90' },     // a bar with its own tempo, inheriting beatsPerMeasure
      { id: 6, startTime: 'base.t' },                  // a bar inheriting both
    ],
  });
  const { lines } = captureConsole(() => mod.evaluateModule());

  expectValue(mod, 4, 'measureLength', '2', 'B8 a computed measureLength waits for the inherited beatsPerMeasure');
  expectValue(mod, 3, 'duration', '1', 'B9 [3].d = measure([4]) / 4 + [6].bpm / 6');
  expectValue(mod, 0, 'tempo', '40', 'B10 base.tempo = [3].d * 40');
  expectValue(mod, 6, 'measureLength', '9/2', 'B11 and the bar inheriting that tempo follows');
  check(lines.length === 0, `B12 nothing reported (${lines.length} console line(s)${lines[0] ? `: ${lines[0].text}` : ''})`);
}

// --- C: a true cycle is still refused ------------------------------------------
console.log('\nC. A true cycle is refused\n');
{
  // C1-C6: at edit time, by the validator behind the note widget's Save button
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: '(3/2) * [2].f' },
      { id: 2, startTime: '[1].t + [1].d', duration: 'beat(base) * 2', frequency: '(5/4) * base.f' },
      { id: 3, startTime: 'base.t', duration: 'beat(base)', frequency: 'base.f * (3/2)' },
      { id: 4, startTime: 'base.t + measure(base)' },                                 // a measure bar
      { id: 5, startTime: '[4].t', duration: 'beat([4])', frequency: 'base.f' },
    ],
  });
  captureConsole(() => mod.evaluateModule());

  const CIRCULAR = 'Circular dependency detected in expression';
  const SELF = 'Expression cannot reference itself directly';

  check(refusal(mod, 2, 'frequency', '(5/4) * [1].f') === CIRCULAR,
    'C1 [2].f from [1].f while [1].f reads [2].f: refused as circular');
  check(refusal(mod, 2, 'frequency', "module.getNoteById(1).getVariable('frequency').mul(new Fraction(5, 4))") === CIRCULAR,
    'C2 the same in legacy syntax: refused as circular');
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
  check(refusal(mod, 0, 'tempo', 'base.f * (15/64)') === null,
    'C9 base.tempo from base.f: accepted');
  check(refusal(mod, 0, 'tempo', '[3].d * 60') === CIRCULAR,
    'C10 base.tempo from [3].d while [3].d reads base.tempo: refused as circular');

  // The loop may close through a read no expression spells out
  check(refusal(mod, 0, 'tempo', '[5].d * 60') === CIRCULAR,
    'C11 base.tempo from [5].d = beat([4]), a tempo note 4 inherits from the BaseNote: refused as circular');
  check(refusal(mod, 0, 'tempo', 'measure([4]) * 15') === CIRCULAR,
    'C12 base.tempo from measure([4]), computed from the inherited tempo: refused as circular');
  check(refusal(mod, 0, 'beatsPerMeasure', '[5].d * 4') === null,
    'C13 base.beatsPerMeasure from [5].d: accepted (a beat does not depend on beatsPerMeasure)');
}
{
  // C14-C17: a cycle that arrives in a file is evaluated, reported, and stable
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: '(3/2) * [2].f' },
      { id: 2, startTime: 'base.t', duration: 'beat(base)', frequency: '(5/4) * [1].f' },
      { id: 3, startTime: '[2].t + [2].d', duration: 'beat(base)', frequency: 'base.f * 2' },
    ],
  });
  const first = captureConsole(() => mod.evaluateModule());
  const cycleError = first.errors.find((text) => text.includes('Dependency cycle detected'));

  check(!!cycleError, 'C14 the evaluator reports "Dependency cycle detected" as a console error');
  check(!!cycleError && cycleError.includes('[1].frequency') && cycleError.includes('[2].frequency'),
    'C15 the error names [1].frequency and [2].frequency');
  expectValue(mod, 3, 'startTime', '1', 'C16 variables outside the loop still evaluate: [3].t');

  // Before: every re-evaluation fed the loop its own previous output, so the values grew
  const before = [show(mod.getNoteById(1).getVariable('frequency')), show(mod.getNoteById(2).getVariable('frequency'))];
  mod.baseNote.setVariable('tempo', '60');
  captureConsole(() => mod.evaluateModule());
  const after = [show(mod.getNoteById(1).getVariable('frequency')), show(mod.getNoteById(2).getVariable('frequency'))];
  check(before.join() === after.join(), `C17 the loop's values do not drift across re-evaluations (${before.join(', ')})`);
}
{
  // C18: nor do they depend on which note a batch reaches the loop from. A
  // full evaluation enters the loop [5].f <-> [6].f through note 2; the batch
  // edit of note 9 re-evaluates notes 5, 6 and 9 only, and enters it at note 5.
  const mod = await Module.loadFromJSON({
    baseNote: { ...BASE },
    notes: [
      { id: 2, startTime: 'base.t', duration: 'beat(base)', frequency: '[6].f * 2' },
      { id: 5, startTime: 'base.t', duration: 'beat(base)', frequency: '[6].f * (3/2)' },
      { id: 6, startTime: 'base.t', duration: 'beat(base)', frequency: '[5].f * (5/4)' },
      { id: 9, startTime: 'base.t', duration: 'beat(base)', frequency: '[5].f * 3' },
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
      { id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: '(3/2) * [9].f' },
      { id: 2, startTime: 'base.t + measure(base)' },                                  // a measure bar: no duration
      { id: 3, startTime: '[2].t + [2].d', duration: 'beat([2])', frequency: 'base.f' },
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
  // beat([2]) is NOT unresolved: note 2 has no tempo, so it inherits the BaseNote's
  expectValue(mod, 3, 'duration', '1', 'D5 an inherited tempo is a real value: beat([2])');
  check(!report.includes('tempo'), 'D6 and is not reported');
  check(errors.length === 1, `D7 one console error for the whole evaluation (${errors.length})`);
}

// --- E: the incremental path -------------------------------------------------------
console.log('\nE. Incremental evaluation equals a fresh load\n');
{
  // Notes 2 and 4 never mention the BaseNote, yet depend on it through notes 1 and 3
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '440', startTime: '0', tempo: '60', beatsPerMeasure: '4' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: 'base.f * (3/2)' },
      { id: 2, startTime: '[1].t + [1].d', duration: '[1].d', frequency: '[1].f * (5/4)' },
      { id: 3, startTime: 'base.t + measure(base)' },
      { id: 4, startTime: '[3].t + measure([3])' },
      // A measure bar at a fixed time, and a note timed by it: both follow the
      // BaseNote's tempo without any expression saying so
      { id: 5, startTime: '8' },
      { id: 6, startTime: '[5].t + measure([5])', duration: 'beat([5])', frequency: '[2].f' },
    ],
  });
  mod.evaluateModule();
  mod.baseNote.setVariable('frequency', '400');
  mod.baseNote.setVariable('tempo', '120');
  mod.evaluateModule();

  expectValue(mod, 2, 'frequency', '750', 'E1 a BaseNote edit reaches [2].f through [1].f');
  expectValue(mod, 2, 'startTime', '1/2', 'E2 and [2].t through [1].d');
  expectValue(mod, 4, 'startTime', '4', 'E3 and a chained measure bar');
  expectValue(mod, 6, 'startTime', '10', 'E4 and a bar whose measure length is only inherited');
  expectValue(mod, 6, 'duration', '1/2', 'E5 and an inherited beat([5])');

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
    baseNote: { frequency: '4', startTime: '0', tempo: '60', beatsPerMeasure: '4' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: 'base.f' },
      { id: 2, startTime: '[1].t + [1].d', duration: '[1].d', frequency: '[1].f ^ (1/2)' },
    ],
  });
  mod.evaluateModule();
  const graph = mod.getDependencyGraph();
  const exactBefore = show(mod.getNoteById(2).getVariable('frequency')) === '2/1' && graph.getCorruptionFlags(2) === 0;
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
  const pick = (list) => list[Math.floor(random() * list.length)];
  const ratio = () => `(${1 + Math.floor(random() * 9)}/${1 + Math.floor(random() * 9)})`;

  const atom = (ids) => {
    const target = pick(ids);
    const ref = target === 0 ? 'base' : `[${target}]`;
    const form = pick(['t', 'd', 'f', 'tempo', 'bpm', 'ml', 'beat', 'measure', 'tempo()']);
    if (form === 'beat') return `beat(${ref})`;
    if (form === 'measure') return `measure(${ref})`;
    if (form === 'tempo()') return `tempo(${ref})`;
    return `${ref}.${form}`;
  };
  const expression = (ids) => {
    let text = ratio();
    const terms = Math.floor(random() * 3);
    for (let i = 0; i < terms; i++) text += ` + ${atom(ids)} * ${ratio()}`;
    return text;
  };
  const noteVariables = (ids) => {
    const kind = random();
    if (kind < 0.2) {                                                   // measure bar
      const bar = { startTime: expression(ids) };
      if (random() < 0.3) bar.beatsPerMeasure = expression(ids);
      if (random() < 0.3) bar.tempo = expression(ids);
      return bar;
    }
    const note = { startTime: expression(ids), duration: expression(ids) };
    if (kind > 0.3) note.frequency = expression(ids);                   // else a silence
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
          const updates = [];
          const wanted = action > 0.85 ? 3 : 1;
          // Like the widget, apply only what the validator accepts. One edit in
          // ten does the opposite on purpose and closes a loop, as a hand-written
          // file could: even then the values must not depend on the edit history.
          const wantCycle = random() < 0.1;
          for (let attempt = 0; attempt < 40 && updates.length < wanted; attempt++) {
            const noteId = pick(ids);
            const note = mod.getNoteById(noteId);
            // Mostly rewrite a variable the note has; sometimes give it a new one
            // (a tempo of its own, a duration that turns a measure bar into a note)
            const varName = pick(random() < 0.2 ? VARS : VARS.filter((v) => note.hasExpression(v)));
            const expr = expression(referable());
            const closesLoop = findDependencyCycle(mod, noteId, varName, compiler.compile(expr)) !== null;
            if (closesLoop !== wantCycle && attempt < 39) continue;
            if (closesLoop && !wantCycle) continue;
            if (updates.some((u) => u.noteId === noteId)) continue;
            updates.push({ noteId, varName, expr });
          }
          if (updates.length === 1) {
            mod.getNoteById(updates[0].noteId).setVariable(updates[0].varName + 'String', updates[0].expr);
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

console.log(`\n${failures ? `${failures} failure(s).` : 'All variable-dependency checks passed.'}`);
process.exit(failures ? 1 : 0);
