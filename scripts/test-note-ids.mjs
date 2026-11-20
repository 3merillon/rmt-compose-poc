#!/usr/bin/env node
/**
 * Note ids above 65535.
 *
 * A reference to a note up to 65535 compiles to LOAD_REF (a 2-byte id), above
 * that to LOAD_REF_WIDE (4 bytes); MAX_NOTE_ID (src/binary-note.js) is the
 * largest id a note can have. These checks hold the compiler, the decompiler,
 * the dependency lists, the parser, the loader and the evaluation to that, on
 * a module of 70,000 notes as well.
 */
const { compileDSL, decompileToDSL } = await import('../src/dsl/index.js');
const { OP, MAX_NOTE_ID } = await import('../src/binary-note.js');
const { Module } = await import('../src/module.js');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const check = (condition, msg) => (condition ? ok(msg) : fail(msg));
const quiet = async (fn) => {
  const { warn, log, info, error } = console;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  console.log = console.info = console.error = () => {};
  try { return { value: await fn(), warnings }; } finally { Object.assign(console, { warn, log, info, error }); }
};
const text = (f) => (f == null ? 'null' : `${f.s * f.n}/${f.d}`);

console.log('\nNote ids: the bytecode');
{
  check(MAX_NOTE_ID === 16777215, `MAX_NOTE_ID is 2^24 - 1 (${MAX_NOTE_ID})`);
  const small = compileDSL('[65535].f');
  check(small.bytecode[0] === OP.LOAD_REF && small.length === 4, 'up to 65535: LOAD_REF, two bytes of id (the bytecode as before)');
  const wide = compileDSL('[65536].t');
  check(wide.bytecode[0] === OP.LOAD_REF_WIDE && wide.length === 6, 'from 65536: LOAD_REF_WIDE, four bytes of id');
  const top = compileDSL(`[${MAX_NOTE_ID}].d`);
  check(Array.from(top.bytecode.subarray(1, 5)).join(',') === '0,255,255,255', 'the id is big-endian');

  const expr = compileDSL(`[70000].f * (3/2) + [12].t + [${MAX_NOTE_ID}].d`);
  check(decompileToDSL(expr) === `[70000].f * (3/2) + [12].t + [${MAX_NOTE_ID}].d`, `decompiles back: ${decompileToDSL(expr)}`);
  const refs = expr.getVariableRefs().map((r) => `${r >> 3}.${r & 7}`).join(' ');
  check(refs === `70000.2 12.0 ${MAX_NOTE_ID}.1`, `variable references: ${refs}`);
  const deps = Array.from(expr.dependencies.subarray(0, expr.depCount)).join(' ');
  check(deps === `70000 12 ${MAX_NOTE_ID}`, `dependency list: ${deps}`);
  const byProperty = expr.getPropertyDependencies();
  check(byProperty.get(70000)?.has(2) && byProperty.get(MAX_NOTE_ID)?.has(1), 'property dependencies name the wide references');
}

console.log('\nNote ids: what is refused');
{
  for (const bad of [`[${MAX_NOTE_ID + 1}].f`, '[-1].f']) {
    let refused = false;
    try { compileDSL(bad); } catch (e) { refused = /Invalid note ID/.test(e.message); }
    check(refused, `the parser refuses ${bad}`);
  }
  const { value: mod, warnings } = await quiet(() => Module.loadFromJSON({
    baseNote: { frequency: '263', startTime: '0', duration: '1/2' },
    notes: [
      { id: 1, frequency: 'base.f', startTime: 'base.t', duration: 'base.d' },
      { id: 70000, frequency: '[1].f * (3/2)', startTime: '[1].t + [1].d', duration: '[1].d' },
      { id: MAX_NOTE_ID, frequency: '[70000].f * (3/2)', startTime: '[70000].t + [70000].d', duration: '[70000].d' },
      { id: MAX_NOTE_ID + 1, frequency: 'base.f', startTime: 'base.t', duration: 'base.d' },
    ],
  }));
  check(mod.getNoteById(70000) && mod.getNoteById(MAX_NOTE_ID), `the loader keeps notes 70000 and ${MAX_NOTE_ID}`);
  check(!mod.getNoteById(MAX_NOTE_ID + 1) && warnings.some((w) => w.includes(String(MAX_NOTE_ID + 1))), `and skips ${MAX_NOTE_ID + 1} with a warning`);

  console.log('\nNote ids: evaluation across them');
  const cache = (await quiet(() => mod.evaluateModule())).value;
  check(text(cache.get(MAX_NOTE_ID).frequency) === '2367/4' && text(cache.get(MAX_NOTE_ID).startTime) === '1/1',
    `[${MAX_NOTE_ID}] reads [70000], which reads [1]: f ${text(cache.get(MAX_NOTE_ID).frequency)}, t ${text(cache.get(MAX_NOTE_ID).startTime)}`);
  const dependents = mod.getDependentNotes(1);
  check(dependents.includes?.(70000) || dependents.has?.(70000), 'note 1 has note 70000 among its dependents');
  await quiet(() => mod.getNoteById(1).setVariable('frequencyString', 'base.f * 2'));
  const after = (await quiet(() => mod.evaluateModule())).value;
  check(text(after.get(MAX_NOTE_ID).frequency) === '2367/2', `an edit of [1] reaches [${MAX_NOTE_ID}]: ${text(after.get(MAX_NOTE_ID).frequency)}`);
  const fresh = (await quiet(() => Module.loadFromJSON(mod.createModuleJSON()))).value;
  const again = (await quiet(() => fresh.evaluateModule())).value;
  check(text(again.get(MAX_NOTE_ID).frequency) === '2367/2', 'saved and loaded again, the same value');
}

console.log('\nNote ids: a module of 70,000 notes');
{
  const notes = [{ id: 1, frequency: 'base.f', startTime: 'base.t', duration: 'base.d' }];
  for (let id = 2; id <= 70000; id++) {
    notes.push({ id, frequency: `[${id - 1}].f * ${['(3/2)', '(4/3)', '(1/2)'][id % 3]}`, startTime: `[${id - 1}].t + [${id - 1}].d`, duration: 'base.d' });
  }
  const { value: big } = await quiet(() => Module.loadFromJSON({ baseNote: { frequency: '440', startTime: '0', duration: '1' }, notes }));
  check(Object.keys(big.notes).length === 70001, `all ${Object.keys(big.notes).length - 1} notes loaded, and the BaseNote`);
  const cache = (await quiet(() => big.evaluateModule())).value;
  check(text(cache.get(70000).startTime) === '69999/1', `[70000] starts at ${text(cache.get(70000).startTime)} (each note after the one before)`);
  check(cache.size === 70001, `every note has a record (${cache.size})`);
  await quiet(() => big.getNoteById(65536).setVariable('startTimeString', '[65535].t + [65535].d + 1'));
  const after = (await quiet(() => big.evaluateModule())).value;
  check(text(after.get(70000).startTime) === '70000/1' && text(after.get(65535).startTime) === '65534/1',
    `an edit at 65536 moves everything after it, and nothing before (${text(after.get(70000).startTime)}, ${text(after.get(65535).startTime)})`);
}

console.log(failures === 0 ? '\nAll note-id checks passed.' : `\n${failures} note-id check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
