#!/usr/bin/env node
/**
 * The WASM evaluator against the JavaScript one, compared exactly.
 *
 * Every module is loaded twice, one copy evaluating on src/binary-evaluator.js
 * and one on the Rust core (rust/src/evaluator.rs through
 * src/wasm/evaluator-adapter.js). After every evaluation each record must be
 * the same on both: every variable's Fraction (numerator, denominator, sign),
 * the exact value of every variable that is not rational (irrational terms,
 * approximations), the corruption and approximation flags, and what the
 * evaluation reported (cycles, unresolved references, failures).
 *
 *  1. Every module of the library (public/modules) and of the fixtures
 *     (scripts/fixtures/old-time, the modules old-time-oracle.json was made
 *     from, legacy-syntax): a full evaluation, a commit in the middle, a
 *     BaseNote edit, a note removed.
 *  2. Fuzz: seeded random modules over the exact algebra (tempered powers,
 *     sums of radicals, roots of negatives, `~`, division by zero and by sums,
 *     big constants, inherited interpretation variables, cycles), each with an
 *     edit.
 *  3. The suites that test evaluation, run whole on the WASM evaluator
 *     (scripts/wasm-node.mjs): their own expectations must hold there too.
 *     test-variable-deps.mjs holds the per-variable ordering and cycle cases,
 *     test-relational-time.mjs checks old-time-oracle.json.
 *
 * Usage: node scripts/test-wasm-parity.mjs [--fuzz N] [--seed S] [--no-suites]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const FUZZ_MODULES = option('--fuzz', 400);
const SEED = option('--seed', 20261120);
const RUN_SUITES = !args.includes('--no-suites');

// The WASM evaluator for every Module created from here on (see scripts/wasm-node.mjs)
await import(pathToFileURL(join(here, 'wasm-node.mjs')).href);
const { Module } = await import('../src/module.js');
const { BinaryEvaluator, IncrementalEvaluator } = await import('../src/binary-evaluator.js');
const { isWasmBackedEvaluator } = await import('../src/wasm/evaluator-adapter.js');
const X = await import('../src/value/exact.js');

const VARS = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];

let failures = 0;
let compared = 0;
// What the comparisons met, so a pass is known to have covered something
const seen = { rational: 0, irrational: 0, approximate: 0, cycleReports: 0, unresolvedReports: 0, warnings: 0 };
const MAX_SHOWN = 25;
function fail(message) {
  failures++;
  if (failures <= MAX_SHOWN) console.log(`  ✗ ${message}`);
}

// ---------------------------------------------------------------------------
// One module, two engines
// ---------------------------------------------------------------------------

/** Put a module on the JavaScript evaluator (what _upgradeEvaluators does, the other way) */
function onJavaScript(mod) {
  mod._binaryEvaluator = new BinaryEvaluator(mod);
  mod._incrementalEvaluator = new IncrementalEvaluator(mod, mod._dependencyGraph, mod._binaryEvaluator);
  mod._evaluationCache = new Map();
  mod._incrementalEvaluator.invalidateAll();
  for (const id of Object.keys(mod.notes)) mod._dirtyNotes.add(Number(id));
  return mod;
}

async function pair(json) {
  const text = JSON.stringify(json);
  const wasm = await quietly(() => Module.loadFromJSON(JSON.parse(text)));
  const js = onJavaScript((await quietly(() => Module.loadFromJSON(JSON.parse(text)))).value);
  if (!isWasmBackedEvaluator(wasm.value._binaryEvaluator)) throw new Error('the WASM copy is not on the WASM evaluator');
  if (isWasmBackedEvaluator(js._binaryEvaluator)) throw new Error('the JavaScript copy is on the WASM evaluator');
  return { js, wasm: wasm.value };
}

/** Run fn with console.error / console.warn captured */
async function quietly(fn) {
  const errors = [];
  const warnings = [];
  const { error, warn, log, info } = console;
  console.log = console.info = () => {}; // the loader announces conversions
  console.error = (...a) => errors.push(a.map(String).join(' '));
  // Only the first argument: the JavaScript evaluator adds the Error object,
  // the WASM adapter the reason as text
  console.warn = (...a) => warnings.push(String(a[0]));
  try {
    const value = await fn();
    return { value, errors, warnings };
  } finally {
    console.error = error;
    console.warn = warn;
    console.log = log;
    console.info = info;
  }
}

const show = (f) => (f == null ? 'null' : `${f.s * f.n}/${f.d}`);
const sameFraction = (a, b) => (a == null || b == null ? a == null && b == null : a.s === b.s && a.n === b.n && a.d === b.d);
const sameExact = (a, b) => (a == null || b == null ? a == null && b == null : X.kindOf(a) === X.kindOf(b) && X.equals(a, b));

function compareRecords(label, js, wasm) {
  const ids = new Set([...Object.keys(js.notes), ...Object.keys(wasm.notes)].map(Number));
  const jsCache = js.getEvaluationCache();
  const wasmCache = wasm.getEvaluationCache();
  for (const id of ids) {
    compared++;
    const a = jsCache.get(id) || null;
    const b = wasmCache.get(id) || null;
    if (a === null || b === null) {
      if (a !== b) fail(`${label} [${id}]: record ${a ? 'only on JS' : 'only on WASM'}`);
      continue;
    }
    for (const name of VARS) {
      if (!sameFraction(a[name], b[name])) fail(`${label} [${id}].${name}: JS ${show(a[name])}, WASM ${show(b[name])}`);
      const ea = a.exact?.[name] ?? null;
      const eb = b.exact?.[name] ?? null;
      if (b[name] != null) seen[eb ? X.kindOf(eb) : "rational"]++;
      if (!sameExact(ea, eb)) {
        fail(`${label} [${id}].${name} exact: JS ${ea ? X.toText(ea) : 'rational'}, WASM ${eb ? X.toText(eb) : 'rational'}`);
      }
    }
    if (a.corruptionFlags !== b.corruptionFlags) fail(`${label} [${id}] corruptionFlags: JS ${a.corruptionFlags}, WASM ${b.corruptionFlags}`);
    if ((a.approxFlags || 0) !== (b.approxFlags || 0)) fail(`${label} [${id}] approxFlags: JS ${a.approxFlags}, WASM ${b.approxFlags}`);
  }
}

/** Evaluate both copies and compare everything */
async function evaluateAndCompare(label, js, wasm) {
  const ra = await quietly(() => js.evaluateModule());
  const rb = await quietly(() => wasm.evaluateModule());
  compareRecords(label, js, wasm);
  for (const line of rb.errors) {
    if (line.startsWith("Dependency cycle")) seen.cycleReports++;
    if (line.startsWith("Unresolved reference")) seen.unresolvedReports++;
  }
  seen.warnings += rb.warnings.length;
  if (ra.errors.join('\n') !== rb.errors.join('\n')) {
    fail(`${label}: reports differ\n      JS:   ${ra.errors.join(' | ').slice(0, 400)}\n      WASM: ${rb.errors.join(' | ').slice(0, 400)}`);
  }
  const wa = [...ra.warnings].sort().join('\n');
  const wb = [...rb.warnings].sort().join('\n');
  if (wa !== wb) fail(`${label}: warnings differ\n      JS:   ${wa.slice(0, 300)}\n      WASM: ${wb.slice(0, 300)}`);
}

/** Apply the same edit to both copies, then compare */
async function edit(label, js, wasm, change) {
  await quietly(() => change(js));
  await quietly(() => change(wasm));
  await evaluateAndCompare(label, js, wasm);
}

async function checkModule(label, json) {
  const { js, wasm } = await pair(json);
  await evaluateAndCompare(`${label} full`, js, wasm);

  const ids = Object.keys(js.notes).map(Number).filter((id) => id !== 0).sort((a, b) => a - b);
  if (ids.length === 0) return;
  const mid = ids[Math.floor(ids.length / 2)];

  // A commit in the middle: its start (or frequency) moves
  const note = js.getNoteById(mid);
  const t = note.variables.startTimeString;
  const f = note.variables.frequencyString;
  if (t) {
    await edit(`${label} commit [${mid}].t`, js, wasm, (m) => m.getNoteById(mid).setVariable('startTimeString', `(${t}) + base.d / 8`));
  } else if (f) {
    await edit(`${label} commit [${mid}].f`, js, wasm, (m) => m.getNoteById(mid).setVariable('frequencyString', `(${f}) * 3/2`));
  }

  // A BaseNote edit dirties everything that reads it
  if (js.baseNote.variables.frequencyString) {
    await edit(`${label} base.f`, js, wasm, (m) => m.baseNote.setVariable('frequencyString', '441'));
  }

  // A note removed: whatever read it falls back to defaults
  await edit(`${label} remove [${mid}]`, js, wasm, (m) => m.removeNote(mid));
}

function moduleFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...moduleFiles(path));
    else if (name.endsWith('.json')) out.push(path);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// 1. Library and fixtures
// ---------------------------------------------------------------------------

const sources = [
  ...moduleFiles(join(root, 'public', 'modules')),
  ...moduleFiles(join(root, 'scripts', 'fixtures', 'old-time')),
  ...(existsSync(join(root, 'scripts', 'fixtures', 'legacy-syntax')) ? moduleFiles(join(root, 'scripts', 'fixtures', 'legacy-syntax')) : []),
];
const oracle = JSON.parse(readFileSync(join(root, 'scripts', 'fixtures', 'old-time-oracle.json'), 'utf8'));
for (const path of Object.keys(oracle.modules)) {
  if (!sources.includes(join(root, path))) fail(`old-time-oracle.json module not found: ${path}`);
}

let moduleCount = 0;
for (const path of sources) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    continue; // not a module
  }
  if (!json || typeof json !== 'object' || (!json.baseNote && !json.notes)) continue;
  const before = failures;
  try {
    await checkModule(relative(root, path).replace(/\\/g, '/'), json);
  } catch (e) {
    fail(`${relative(root, path)}: ${e.message}`);
  }
  moduleCount++;
  if (failures > before && failures <= MAX_SHOWN) console.log(`    (in ${relative(root, path)})`);
}
console.log(`library and fixtures: ${moduleCount} modules`);

// ---------------------------------------------------------------------------
// 2. Fuzz
// ---------------------------------------------------------------------------

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONSTANTS = [
  '1', '2', '3', '3/2', '5/4', '-7/3', '0', '81/80', '1.25', '9/8',
  '12345678901234567890/7', '340282366920938463463374607431768211457',
  '~261.63', '~0.5', '2^(1/12)', '2^(7/12)', '3^(1/2)', '(2^(1/2) + 1)', '(2^(1/2) - 3^(1/2))',
  '(-8)^(1/3)', '(-2)^(1/2)', '0^(-1)', '12^(1/2)', '(2/3)^(1/2)', '4^(-1/2)', '(1/2)^(-3)',
  '2^(70000)', '(81/80)^(1/5)', '65537^(1/2)', '(4294967311 * 3)^(1/2)', '(3/2)^(1/12)',
];
const EXPONENTS = ['2', '3', '1/2', '1/3', '7/12', '-1', '-1/2', '2/3', '0', '1/12', '5', '-2/3'];
const REF_VARS = ['f', 't', 'd', 'a', 'attack', 'release'];

function fuzzModule(random, count) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const ref = () => {
    const id = Math.floor(random() * (count + 2)); // sometimes a note that does not exist
    const v = random() < 0.7 ? pick(['f', 't', 'd']) : pick(REF_VARS);
    return id === 0 ? `base.${v}` : `[${id}].${v}`;
  };
  const expr = (depth) => {
    const r = random();
    if (depth <= 0 || r < 0.3) return random() < 0.5 ? ref() : pick(CONSTANTS);
    if (r < 0.4) return `-(${expr(depth - 1)})`;
    if (r < 0.55) return `(${expr(depth - 1)})^(${pick(EXPONENTS)})`;
    const op = pick(['+', '-', '*', '/', '*', '+']);
    return `(${expr(depth - 1)} ${op} ${expr(depth - 1)})`;
  };
  const baseNote = { frequency: pick(['263', '440', '~261.63', '2^(1/2) * 300', '263 * 3/2']), startTime: '0', duration: pick(['1', '3/5']) };
  if (random() < 0.3) baseNote.amplitude = pick(['1/2', '3/4', '[1].a', '2^(-1/2)']);
  if (random() < 0.3) baseNote.attack = pick(['1/10', 'base.release', '[2].d / 8']);
  if (random() < 0.3) baseNote.release = pick(['1/5', 'base.attack * 2']);
  const notes = [];
  for (let id = 1; id <= count; id++) {
    const note = { id };
    const kind = pick(['note', 'note', 'note', 'reference', 'silence', 'bar', 'marker', 'key']);
    const depth = 1 + Math.floor(random() * 3);
    if (kind === 'note' || kind === 'reference' || kind === 'key') note.frequency = expr(depth);
    if (kind !== 'reference') note.startTime = expr(depth);
    if (kind === 'note' || kind === 'silence' || kind === 'bar') note.duration = expr(depth);
    if (kind === 'bar') note.measure = true;
    if (kind === 'note' && random() < 0.25) note.amplitude = expr(1);
    if (kind === 'note' && random() < 0.15) note.attack = expr(1);
    if (kind === 'note' && random() < 0.15) note.release = expr(1);
    notes.push(note);
  }
  return { baseNote, notes };
}

{
  const random = prng(SEED);
  const before = failures;
  for (let i = 0; i < FUZZ_MODULES; i++) {
    const count = 3 + Math.floor(random() * 10);
    const json = fuzzModule(random, count);
    const label = `fuzz #${i}`;
    try {
      const { js, wasm } = await pair(json);
      await evaluateAndCompare(label, js, wasm);
      // An edit: one note's frequency or start rewritten
      const id = 1 + Math.floor(random() * count);
      const field = random() < 0.5 ? 'frequencyString' : 'startTimeString';
      const replacement = `[${1 + Math.floor(random() * count)}].f * 3/2`;
      if (js.getNoteById(id)?.variables[field]) {
        await edit(`${label} edit [${id}]`, js, wasm, (m) => m.getNoteById(id).setVariable(field, field === 'frequencyString' ? replacement : `[${id === 1 ? 2 : 1}].t + 1`));
      }
    } catch (e) {
      fail(`${label}: ${e.message}`);
    }
    if (failures > before && failures - before <= 3 && failures <= MAX_SHOWN) console.log(`    module: ${JSON.stringify(json).slice(0, 600)}`);
  }
  console.log(`fuzz: ${FUZZ_MODULES} modules (seed ${SEED})`);
}

// ---------------------------------------------------------------------------
// 3. The evaluation suites, on the WASM evaluator
// ---------------------------------------------------------------------------

const SUITES = [
  'scripts/test-variable-deps.mjs',
  'scripts/test-relational-time.mjs',
  'scripts/test-exact-values.mjs',
  'scripts/test-exactness.mjs',
  'scripts/test-note-kinds.mjs',
  'scripts/test-amplitude.mjs',
  'scripts/test-envelopes.mjs',
  'scripts/test-library.mjs',
  'scripts/test-legacy-syntax.mjs',
];

if (RUN_SUITES) {
  for (const suite of SUITES) {
    const run = spawnSync(process.execPath, ['--import', './scripts/wasm-node.mjs', suite], { cwd: root, encoding: 'utf8' });
    if (run.status === 0) {
      console.log(`  ✓ ${suite} passes on the WASM evaluator`);
    } else {
      fail(`${suite} fails on the WASM evaluator (exit ${run.status})\n${(run.stdout + run.stderr).split('\n').filter((l) => /✗|FAIL|Error/.test(l)).slice(0, 8).join('\n')}`);
    }
  }
}

console.log(`${compared} records compared; values met: ${seen.rational} rational, ${seen.irrational} irrational, ${seen.approximate} approximate; ${seen.cycleReports} cycle reports, ${seen.unresolvedReports} unresolved reports, ${seen.warnings} warnings`);
if (failures > 0) {
  console.log(`${failures} difference(s)${failures > MAX_SHOWN ? ` (first ${MAX_SHOWN} shown)` : ''}`);
  process.exit(1);
}
console.log('JS and WASM agree exactly.');
