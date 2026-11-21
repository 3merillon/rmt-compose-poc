#!/usr/bin/env node
/**
 * Dirty marking: one walk per dirty cycle, and the same values as a reload.
 *
 * Module.markNoteDirty() marks a note and everything that reads it,
 * transitively. Many callers (the octave buttons, drags, the modals) then mark
 * each dependent again; a note already reached by an earlier walk of the same
 * cycle does not walk again (Module._dirtyClosed). These checks hold that to
 *  1. linear work: marking a note and then each of its dependents walks once;
 *  2. the values: after every pattern below, each note's evaluated values are
 *     exactly those of the same module loaded afresh.
 */
import Fraction from 'fraction.js';

const { Module } = await import('../src/module.js');
const X = await import('../src/value/exact.js');
const { exactValue } = await import('../src/binary-evaluator.js');

const VARS = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const check = (condition, msg) => (condition ? ok(msg) : fail(msg));

/** A chain: each note starts where the previous ends and sounds 9/8 above it */
function chain(length) {
  const notes = [{ id: 1, frequency: 'base.f', startTime: 'base.t', duration: 'base.d' }];
  for (let id = 2; id <= length; id++) {
    notes.push({ id, frequency: `[${id - 1}].f * (9/8)`, startTime: `[${id - 1}].t + [${id - 1}].d`, duration: `[${id - 1}].d` });
  }
  return { baseNote: { frequency: '263', startTime: '0', duration: '1/2' }, notes };
}

const quiet = async (fn) => {
  const { warn, log, info, error } = console;
  console.warn = console.log = console.info = console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.log = log; console.info = info; console.error = error; }
};

/** Every value of every note equals what a fresh load of the module evaluates to */
async function sameAsReload(mod, label) {
  const fresh = await quiet(() => Module.loadFromJSON(mod.createModuleJSON()));
  const a = await quiet(() => mod.evaluateModule());
  const b = await quiet(() => fresh.evaluateModule());
  let differences = 0;
  for (const id of Object.keys(mod.notes).map(Number)) {
    for (const name of VARS) {
      const x = exactValue(a.get(id), name);
      const y = exactValue(b.get(id), name);
      const same = x == null || y == null ? x == null && y == null : X.equals(x, y);
      if (!same && differences++ < 3) fail(`${label}: [${id}].${name} is ${x ? X.toText(x) : 'null'}, a reload gives ${y ? X.toText(y) : 'null'}`);
    }
  }
  check(differences === 0, `${label}: every value as after a reload`);
}

function countWalks(mod) {
  const graph = mod._dependencyGraph;
  const original = graph.getEvaluationDependents;
  const counter = { walks: 0 };
  graph.getEvaluationDependents = function (...args) {
    counter.walks++;
    return original.apply(this, args);
  };
  return counter;
}

console.log('\nDirty marking: one walk per cycle');
{
  const mod = await Module.loadFromJSON(chain(400));
  mod.evaluateModule();
  const counter = countWalks(mod);
  // What handleOctaveChange does: the note, then each of its dependents
  const note = mod.getNoteById(200);
  note.setVariable('frequencyString', '[199].f * (9/4)');
  mod.markNoteDirty(200);
  for (const dep of mod.getDependentNotes(200)) mod.markNoteDirty(dep);
  check(counter.walks === 1, `a note and its 200 dependents marked: ${counter.walks} walk(s)`);
  await sameAsReload(mod, 'octave pattern');

  // After the evaluation a new cycle walks again
  counter.walks = 0;
  mod.getNoteById(300).setVariable('startTimeString', '[299].t + [299].d + 1');
  for (const dep of mod.getDependentNotes(300)) mod.markNoteDirty(dep);
  check(counter.walks === 1, `the next cycle walks again, once: ${counter.walks} walk(s)`);
  await sameAsReload(mod, 'next cycle');
}

console.log('\nDirty marking: the values stay right');
{
  // A dependent's own expression changes after an ancestor's walk reached it
  const mod = await Module.loadFromJSON(chain(30));
  mod.evaluateModule();
  mod.getNoteById(10).setVariable('frequencyString', '[9].f * (3/2)');
  mod.getNoteById(20).setVariable('frequencyString', 'base.f * (5/4)');
  for (const dep of mod.getDependentNotes(10)) mod.markNoteDirty(dep);
  await sameAsReload(mod, 'a reached dependent rewritten');

  // A note that starts reading a reached note
  mod.getNoteById(10).setVariable('durationString', '[9].d * 2');
  const added = mod.addNote({ frequency: '[25].f * 2', startTime: '[25].t', duration: '[25].d' });
  mod.getNoteById(5).setVariable('frequencyString', `[${added.id}].f / 4`);
  await quiet(() => mod.evaluateModule());
  await sameAsReload(mod, 'new readers of reached notes');

  // The BaseNote: everything follows
  const counter = countWalks(mod);
  mod.baseNote.setVariable('frequencyString', '440');
  for (const id of Object.keys(mod.notes).map(Number)) if (id !== 0) mod.markNoteDirty(id);
  check(counter.walks === 1, `a BaseNote edit, then every note marked: ${counter.walks} walk(s)`);
  await sameAsReload(mod, 'BaseNote edit');

  // A removal: its readers fall back to defaults, as after a reload
  await quiet(() => mod.removeNote(15));
  await quiet(() => mod.evaluateModule());
  await sameAsReload(mod, 'a note removed');

  // Interpretation variables inherited from the BaseNote
  mod.baseNote.setVariable('attackString', '1/8');
  mod.getNoteById(3).setVariable('releaseString', '[2].attack * 2');
  for (const dep of mod.getDependentNotes(3)) mod.markNoteDirty(dep);
  await quiet(() => mod.evaluateModule());
  await sameAsReload(mod, 'inherited attack read by a release');
}

console.log(failures === 0 ? '\nAll dirty-marking checks passed.' : `\n${failures} dirty-marking check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
