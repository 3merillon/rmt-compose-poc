#!/usr/bin/env node
/**
 * What an edit costs in the module's size, without changing what it does (npm test).
 *
 * 1. Module.createModuleJSONString() (undo history and the autosave) is exactly
 *    JSON.stringify(createModuleJSON()), on every module of the library and the
 *    stress modules, and stays so through edits made by every route: setVariable,
 *    properties and expressions written directly, a BinaryExpression changed in
 *    place, notes added and deleted, the BaseNote edited.
 * 2. The checked rewrites of src/utils/simplify.js (multiplyExpressionByFraction,
 *    the simplifiers) reach the same verdict as when every check evaluated with a
 *    record of every note of the module, as they did before they read only the
 *    notes an expression references.
 * 3. toNumber() (src/utils/fraction-num.js), which the renderer runs on every
 *    value of every note, gives the same double as when it counted digits.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { Module } = await import('../src/module.js');
const { compiler } = await import('../src/expression-compiler.js');
const { EXPRESSION_VARS } = await import('../src/note.js');
const S = await import('../src/utils/simplify.js');
const { BinaryEvaluator } = await import('../src/binary-evaluator.js');
const { compileDSL } = await import('../src/dsl/index.js');
const { simplifyDSL, scaleDSL } = await import('../src/dsl/simplify.js');
const { validateExpressionSyntax } = await import('../src/utils/safe-expression-validator.js');
const X = await import('../src/value/exact.js');
const { toNumber, bigDigits } = await import('../src/utils/fraction-num.js');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures++; console.error(`  ✗ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

async function load(data) {
  const quiet = console.info, warn = console.warn;
  console.info = () => {}; console.warn = () => {};
  try {
    const m = await Module.loadFromJSON(JSON.parse(JSON.stringify(data)));
    m.evaluateModule();
    return m;
  } finally {
    console.info = quiet; console.warn = warn;
  }
}

// Every module JSON of the library (and the small stress modules, when generated)
function moduleFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'perf') walk(p); continue; }
      if (!name.endsWith('.json') || name === 'library.json' || name === 'index.json') continue;
      out.push(p);
    }
  };
  walk(join(root, 'public', 'modules'));
  for (const name of ['chain-1000', 'fan-1000', 'lattice-1000', 'chords-dense', 'comma-chain-400']) {
    const p = join(root, 'public', 'modules', 'perf', `${name}.json`);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

const same = (m) => m.createModuleJSONString() === JSON.stringify(m.createModuleJSON());

console.log('\nThe module JSON text: the same as JSON.stringify(createModuleJSON())');
const files = moduleFiles();
const modules = [];
{
  let n = 0, diff = [];
  for (const file of files) {
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (!data || !Array.isArray(data.notes)) continue;
    const m = await load(data);
    modules.push({ file, m });
    n++;
    // Twice: the second call is served from the kept texts
    if (!same(m) || !same(m)) diff.push(file.slice(root.length + 1));
  }
  check(n > 50 && diff.length === 0, `${n} modules give the same text, first call and second${diff.length ? ': differ in ' + diff.slice(0, 5).join(', ') : ''}`);
}

{
  const canon = JSON.parse(readFileSync(join(root, 'public', 'modules', 'defaultModule.json'), 'utf8'));
  const m = await load(canon);
  m.createModuleJSONString();
  const ids = Object.keys(m.notes).map(Number).filter((id) => id !== 0).sort((a, b) => a - b);
  const withF = ids.filter((id) => m.getNoteById(id).hasExpression('frequency'));
  const a = m.getNoteById(withF[1]), b = m.getNoteById(withF[2]), c = m.getNoteById(withF[3]);

  a.setVariable('frequencyString', `(3/2) * ${a.getExpressionSource('frequency')}`);
  check(same(m), 'after setVariable on an expression');

  a.properties.color = 'rgba(1,2,3,0.5)';
  check(same(m), 'after a colour written straight into the properties');
  b.setVariable('instrument', 'piano');
  check(same(m), 'after setVariable(instrument)');
  b.properties.instrument = null;
  check(same(m), 'after the instrument cleared directly');
  c.properties.measure = true;
  check(same(m), 'after a note flagged as a measure directly');
  c.properties.measure = false;
  check(same(m), '…and unflagged');

  b.expressions.duration = compiler.compile('base.d * (1/3)', 'duration');
  check(same(m), 'after an expression replaced directly, bypassing setVariable');
  b.expressions.duration.sourceText = 'base.d * (2/3)';
  check(same(m), 'after a BinaryExpression\'s source text changed in place');
  b.clearExpression('amplitude');
  c.setVariable('amplitudeString', '(1/2)');
  check(same(m), 'after an amplitude set on one note and cleared on another');
  c.clearExpression('amplitude');
  check(same(m), '…and cleared again');

  const colour = { toJSON: () => 'rgba(9,9,9,1)' };
  a.properties.color = colour;
  check(same(m), 'with a colour that is an object');
  colour.toJSON = () => 'rgba(8,8,8,1)';
  check(same(m), '…changed in place');
  a.properties.color = 'rgba(1,2,3,0.5)';

  const nid = m.nextId || (Math.max(...ids) + 1);
  const fresh = new (a.constructor)(nid, { startTime: 'base.t', duration: 'base.d', frequency: 'base.f * (5/4)' });
  fresh.module = m;
  m.notes[nid] = fresh;
  check(same(m), 'after a note added');
  delete m.notes[ids[4]];
  check(same(m), 'after a note deleted');
  m.notes[ids[4]] = fresh; // the same object under another id
  check(same(m), 'after a note object kept under a second id');
  delete m.notes[ids[4]];

  m.baseNote.setVariable('frequencyString', '(9/8) * 440');
  m.baseNote.properties.repeat = '(3/2) * base.f';
  m.baseNote.properties.color = 'rgba(0,0,0,1)';
  check(same(m), 'after the BaseNote edited');
}

{
  const ids = [1, 127, 129, 511];
  const m = await load({ baseNote: {}, notes: ids.map(id => ({
    id, startTime: 'base.t', duration: 'base.d', frequency: 'base.f'
  })) });
  const initial = m.historySnapshot();
  m.batchSetExpressions([{ noteId: 129, varName: 'frequency', expr: '2^(1/12) * base.f' }]);
  m.getNoteById(1).setVariable('color', 'rgba(12,34,56,1)');
  const edited = m.historySnapshot(true);
  check(edited.snapshotStr === JSON.stringify(m.createModuleJSON()), 'batch and property edits preserve canonical text across sparse history pages');
  for (const state of [initial, edited]) {
    check(m.restoreHistoryVersion(state.version), 'restore a compatible history version');
    const reference = await load(JSON.parse(state.snapshotStr));
    m.evaluateModule();
    check(m.createModuleJSONString() === reference.createModuleJSONString() &&
      ids.every(id => X.equals(m.notes[id].getExactVariable('frequency'), reference.notes[id].getExactVariable('frequency'))),
      'patched text and exact frequencies match a fresh load');
  }
  m.notes[129].setVariable('frequency', '[1].f');
  m.historySnapshot(true);
  check(!m.restoreHistoryVersion(initial.version), 'a changed variable dependency asks for a full restore');
  delete m.notes[127];
  m.notes[511].properties.instrument = 'triangle';
  check(m.historySnapshot().snapshotStr === m.createModuleJSONString(), 'unscoped checkpoints include direct field writes and removed notes');
}

{
  const m = await load({ baseNote: {}, notes: [
    { id: 1, startTime: 'base.t', duration: '5 * base.d', frequency: 'base.f' },
    { id: 130, startTime: '[1].d', duration: 'base.d', frequency: 'base.f' },
    { id: 200000, startTime: 'base.t', duration: '4 * base.d', frequency: 'base.f' }
  ] });
  check(m.getModuleEndTime() === 6, 'end index includes sparse IDs and dependent starts');
  m.notes[1].setVariable('duration', '2 * base.d');
  m.evaluateModule();
  check(m.getModuleEndTime() === 4, 'shortening the last note reveals the next maximum after evaluation');
  m.removeNote(200000);
  check(m.getModuleEndTime() === 3, 'removing the maximum reveals the dependent note');
  const bar = m.addNote({startTime: '7 * base.d', duration: '2 * base.d', measure: true});
  m.addNote({startTime: '7 * base.d', duration: '3 * base.d', measure: true});
  check(m.getModuleEndTime() === 9, 'audio end keeps the first measure at equal exact start times');
  bar.setVariable('measure', false);
  check(m.getModuleEndTime() === 10, 'changing note kind updates the measure set');
  m.baseNote.setVariable('duration', '1/2');
  check(m.getModuleEndTime() === 5, 'changing the base time unit updates every affected end');
}



console.log('\nChecked rewrites: the same verdict as a check that reads every note');
// The check as it was: a record of every note of the module, built up front.
function evaluateEager(expr, moduleInstance) {
  if (!validateExpressionSyntax(expr).valid) return null;
  let binary;
  try { binary = compileDSL(expr); } catch { return null; }
  const evalCache = new Map();
  const rec = (n) => ({
    startTime: n.getExactVariable?.('startTime'), duration: n.getExactVariable?.('duration'),
    frequency: n.getExactVariable?.('frequency'), amplitude: n.getExactVariable?.('amplitude'),
    attack: n.getExactVariable?.('attack'), release: n.getExactVariable?.('release')
  });
  if (moduleInstance) {
    if (moduleInstance.baseNote) { try { evalCache.set(0, rec(moduleInstance.baseNote)); } catch {} }
    for (const id in moduleInstance.notes || {}) {
      const n = moduleInstance.notes[id];
      if (n) { try { evalCache.set(parseInt(id, 10), rec(n)); } catch {} }
    }
  }
  try {
    const ev = new BinaryEvaluator(moduleInstance);
    const v = ev.evaluate(binary, evalCache);
    if (v == null) return null;
    return { value: ev._lastExact ?? new Fraction(v.s * v.n, v.d), corrupted: !!ev._lastEvalWasCorrupted };
  } catch { return null; }
}
function multiplyEager(expr, num, den, m) {
  const scaled = scaleDSL(expr, num, den);
  const before = evaluateEager(expr, m), after = evaluateEager(scaled, m);
  if (before && after && after.corrupted === before.corrupted && X.equals(after.value, X.mul(before.value, new Fraction(num, den)))) return scaled;
  return `${den === 1 ? `${num}` : `(${num}/${den})`} * (${expr})`;
}
function simplifyEager(expr, m) {
  try {
    const out = simplifyDSL(expr);
    const a = evaluateEager(expr, m), b = evaluateEager(out, m);
    return (a && b && a.corrupted === b.corrupted && X.equals(a.value, b.value)) ? out : expr;
  } catch { return expr; }
}
{
  let exprs = 0, differ = [];
  const factors = [[2, 1], [1, 2], [3, 2], [81, 80]];
  // The library's modules: the stress modules would make the check that reads
  // every note quadratic in their size
  for (const { file, m } of modules.filter((x) => !x.file.includes('perf'))) {
    for (const note of Object.values(m.notes)) {
      for (const name of EXPRESSION_VARS) {
        const src = note.getExpressionSource(name);
        if (!src) continue;
        exprs++;
        for (const [n, d] of factors) {
          const got = S.multiplyExpressionByFraction(src, n, d, name, m);
          const want = multiplyEager(src, n, d, m);
          if (got !== want) differ.push(`${file.slice(root.length + 1)} [${note.id}].${name} x ${n}/${d}: ${got} vs ${want}`);
        }
        // A variant the simplifier's cache has not seen
        const variant = `(${src}) * 1`;
        const got = S.simplifyGeneric(variant, name, m), want = simplifyEager(variant, m);
        if (got !== want) differ.push(`${file.slice(root.length + 1)} [${note.id}].${name} simplify: ${got} vs ${want}`);
      }
    }
  }
  check(exprs > 500 && differ.length === 0, `${exprs} expressions, scaled by ${factors.map((f) => f.join('/')).join(', ')} and simplified: the same text${differ.length ? '; differ: ' + differ.slice(0, 3).join(' | ') : ''}`);

  // References the module cannot resolve, and amplitudes that inherit
  const m = modules[0].m;
  const cases = ['[9999].f * 2', '[9999].a', 'base.a * [1].a', '[1].a * (3/2)', '[1].r + base.r', '2^(1/12) * base.f', '[1].f * 2^(7/12)', 'base.f'];
  const off = cases.filter((e) => S.multiplyExpressionByFraction(e, 2, 1, 'frequency', m) !== multiplyEager(e, 2, 1, m) ||
                                  S.multiplyExpressionByFraction(e, 1, 2, 'amplitude', m) !== multiplyEager(e, 1, 2, m));
  check(off.length === 0, `unresolved references, inherited amplitudes and TET powers: the same text${off.length ? ' (differ: ' + off.join(', ') + ')' : ''}`);
  check(S.multiplyExpressionByFraction('base.f', 2, 1, 'frequency', null) === multiplyEager('base.f', 2, 1, null), 'without a module: the same text');
}

{
  // A pending edit is evaluated before the check reads the module, as before
  const canon = JSON.parse(readFileSync(join(root, 'public', 'modules', 'defaultModule.json'), 'utf8'));
  const m = await load(canon);
  const ids = Object.keys(m.notes).map(Number).filter((id) => id !== 0 && m.getNoteById(id).hasExpression('frequency'));
  const id = ids[0];
  m.getNoteById(id).setVariable('frequencyString', 'base.f * (7/4)');
  check(m._dirtyNotes.size > 0, 'an edit leaves the module to evaluate');
  const got = S.multiplyExpressionByFraction(`[${id}].f`, 2, 1, 'frequency', m);
  check(got === multiplyEager(`[${id}].f`, 2, 1, m) && m._dirtyNotes.size === 0, `a check on a note just edited reads its new value (${got})`);
}

console.log('\ntoNumber: the same double as counting digits');
{
  // toNumber as it was: decided by the digit count of each side
  function toNumberByDigits(frac, fallback = 0) {
    const n = frac.n, d = frac.d;
    const s = frac.s != null && frac.s < 0n ? -1 : 1;
    const nDigits = bigDigits(n), dDigits = bigDigits(d);
    if (nDigits > 300 || dDigits > 300) {
      const shift = BigInt(Math.min(nDigits, dDigits) - 15 > 0 ? Math.min(nDigits, dDigits) - 15 : 0);
      const p = 10n ** shift;
      const nv = Number(n / p), dv = Number(d / p);
      if (dv === 0) return s * (nv === 0 ? fallback : Infinity);
      return s * (nv / dv);
    }
    return s * (Number(n) / Number(d));
  }
  const edges = [0n, 1n, 3n, 10n ** 299n, 10n ** 300n - 1n, 10n ** 300n, 10n ** 300n + 1n, 10n ** 301n,
    10n ** 308n * 17n, 10n ** 309n, 10n ** 400n + 7n, 2n ** 1023n, 2n ** 1024n];
  const values = [];
  for (const n of edges) for (const d of edges) if (d !== 0n) for (const s of [1n, -1n]) values.push({ s, n, d });
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const big = (k) => { let v = 1n; for (let j = 0; j < k; j++) v = v * BigInt(rand() % 1000 + 1) + BigInt(rand() % 10); return v; };
  for (let i = 0; i < 2000; i++) values.push({ s: rand() % 2 ? 1n : -1n, n: big(rand() % 120), d: big(rand() % 120) || 1n });
  const off = values.filter((v) => !Object.is(toNumber(v), toNumberByDigits(v)));
  check(off.length === 0, `${values.length} fractions, at and around 300 digits and far past: the same double${off.length ? ' (differ at ' + off.slice(0, 2).map((v) => `${bigDigits(v.n)}/${bigDigits(v.d)} digits`).join(', ') + ')' : ''}`);
  check(toNumber(new Fraction(3, 7)) === 3 / 7 && toNumber(new Fraction(-5, 4)) === -1.25 && toNumber(null, 9) === 9,
    'a Fraction, a negative one, null: as before');
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll edit-cost checks passed');
process.exit(failures ? 1 : 0);
