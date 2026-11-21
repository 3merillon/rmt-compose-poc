#!/usr/bin/env node
/**
 * The library sounds as it did (npm test).
 *
 * scripts/fixtures/library-oracle.json holds, for every module of the library,
 * what it plays: the multiset of its sounding notes (exact start, duration and
 * frequency, irrational values in their exact form) and of its measure bars,
 * first recorded before the library was rewritten to be native to v2 (Phase L).
 * The canon and the octave voicings of the progressions have since been revised.
 * Every module must match its recorded notes and bars exactly.
 *
 *   node scripts/test-library.mjs            compare
 *   node scripts/test-library.mjs --record   write the oracle from the library as it is
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modulesDir = join(root, 'public', 'modules');
const oracleFile = join(here, 'fixtures', 'library-oracle.json');
const { Module } = await import('../src/module.js');
const X = await import('../src/value/exact.js');
const { noteKind } = await import('../src/note.js');

const recording = 'v2 library, including the November 2026 canon and progression voicings';

const walk = (d, o = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'perf') walk(p, o); }
    else if (f.endsWith('.json') && f !== 'index.json' && f !== 'library.json') o.push(p);
  }
  return o;
};

async function sounds(file) {
  const quiet = console.info; console.info = () => {};
  const mod = await Module.loadFromJSON(JSON.parse(readFileSync(file, 'utf8')));
  mod.evaluateModule();
  console.info = quiet;
  const notes = [], bars = [];
  const t = (n, k) => X.toText(n.getExactVariable(k));
  for (const n of Object.values(mod.notes)) {
    if (n.id === 0) continue;
    if (n.properties?.measure) { bars.push(`${t(n, 'startTime')} | ${t(n, 'duration')}`); continue; }
    if (noteKind(n) !== 'note') continue;
    notes.push(`${t(n, 'startTime')} | ${t(n, 'duration')} | ${t(n, 'frequency')}`);
  }
  return { notes: notes.sort(), bars: bars.sort() };
}

const files = walk(modulesDir).sort();
if (process.argv.includes('--record')) {
  const out = {};
  for (const f of files) out[relative(modulesDir, f).replace(/\\/g, '/')] = await sounds(f);
  writeFileSync(oracleFile, JSON.stringify({ recorded: recording, modules: out }, null, 1) + '\n');
  console.log(`${files.length} modules recorded`);
  process.exit(0);
}

const oracle = JSON.parse(readFileSync(oracleFile, 'utf8')).modules;
let failures = 0, same = 0, notesChecked = 0;
console.log('\nThe library sounds as recorded');
for (const f of files) {
  const key = relative(modulesDir, f).replace(/\\/g, '/');
  const want = oracle[key];
  if (!want) { failures++; console.error(`  ✗ ${key}: not in the oracle (a new module? record it deliberately)`); continue; }
  const got = await sounds(f);
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (eq(got.notes, want.notes) && eq(got.bars, want.bars)) { same++; notesChecked += got.notes.length; continue; }
  failures++;
  const missing = want.notes.filter((x) => !got.notes.includes(x)).slice(0, 2);
  const extra = got.notes.filter((x) => !want.notes.includes(x)).slice(0, 2);
  console.error(`  ✗ ${key}: plays something else (${got.notes.length} notes, was ${want.notes.length}; missing ${missing.join(' ; ')}; new ${extra.join(' ; ')})`);
}
if (failures === 0) console.log(`  ✓ ${same} modules, ${notesChecked} sounding notes and their bars exactly as recorded`);
for (const k of Object.keys(oracle)) if (!files.some((f) => relative(modulesDir, f).replace(/\\/g, '/') === k)) { failures++; console.error(`  ✗ ${k}: in the oracle but no longer in the library`); }
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll library checks passed');
