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
import assert from 'node:assert/strict';
import Fraction from 'fraction.js';
import { isLibraryManifest } from '../src/library/manifest.ts';
import type { Module as ScoreModule } from '../src/module.ts';
import type { Note } from '../src/note.ts';
import type { ExpressionName } from '../src/model-types.ts';
import { readOracle, librarySounds } from './fixtures/read-oracle.ts';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modulesDir = join(root, 'public', 'modules');
const oracleFile = join(here, 'fixtures', 'library-oracle.json');
const { Module } = await import('../src/module.ts');
const X = await import('../src/value/exact.ts');
const { noteKind } = await import('../src/note.ts');

const recording = 'v2 library, including the November 2026 canon and progression voicings';

const walk = (d: string, o: string[] = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'perf') walk(p, o); }
    else if (f.endsWith('.json') && f !== 'index.json' && f !== 'library.json') o.push(p);
  }
  return o;
};

const manifest: unknown = JSON.parse(readFileSync(join(modulesDir, 'library.json'), 'utf8'));
assert.ok(isLibraryManifest(manifest), 'Expected the shipped top-bar library manifest');
const shipped = new Map(manifest.sections.flatMap(section =>
  section.items.map(item => [item.file, section.id] as const)));

async function assertEditableProgression(mod: ScoreModule, notes: Note[], label: string) {
  const pitch = (note: Note) => {
    const value = note.getExactVariable('frequency');
    assert.ok(X.isRational(value), `${label}: expected an exact fraction for note ${note.id}`);
    return value;
  };
  const written = notes.map(note => ({
    note,
    pitch: pitch(note),
    start: note.getVariable('startTime')!,
    duration: note.getVariable('duration')!,
  }));
  // The first written voice at each onset is the harmonic root, including in
  // inversions that put another chord member in the bass.
  const roots = new Map<string, Note>();
  for (const { start, note } of written) {
    const onset = start.toFraction();
    if (!roots.has(onset)) roots.set(onset, note);
  }
  assert.ok(roots.size > 1, `${label}: expected a progression`);
  const raised = new Fraction(81, 80);
  for (const root of roots.values()) {
    const onset = root.getVariable('startTime')!;
    const original = root.getExpressionSource('frequency');
    assert.ok(original, `${label}: expected a written frequency for root ${root.id}`);
    root.setVariable('frequencyString', `(81/80) * (${original})`);
    mod.evaluateModule();
    for (const voice of written) {
      const expected = voice.start.compare(onset) >= 0 ? voice.pitch.mul(raised) : voice.pitch;
      const context = `${label}: edit root ${root.id}, check voice ${voice.note.id}`;
      assert.equal(pitch(voice.note).toFraction(), expected.toFraction(), context);
      assert.equal(X.toText(voice.note.getExactVariable('startTime')), X.toText(voice.start), context);
      assert.equal(X.toText(voice.note.getExactVariable('duration')), X.toText(voice.duration), context);
    }
    root.setVariable('frequencyString', original);
    mod.evaluateModule();
  }
  const reopened = await Module.loadFromJSON(mod.createModuleJSON());
  reopened.evaluateModule();
  for (const note of notes) {
    const attack = { head: note.id, prev: null };
    assert.deepEqual(mod.findPlayer(note), attack, `${label}: independent attack on note ${note.id}`);
    assert.deepEqual(reopened.findPlayer(reopened.notes[note.id]), attack, `${label}: reopened attack on note ${note.id}`);
  }
}

async function sounds(file: string, checkTile?: { key: string; section: string }) {
  const quiet = console.info; console.info = () => {};
  const mod = await Module.loadFromJSON(JSON.parse(readFileSync(file, 'utf8')));
  mod.evaluateModule();
  console.info = quiet;
  const notes = [], bars = [];
  const t = (n: Note, k: ExpressionName) => X.toText(n.getExactVariable(k));
  const material = Object.values(mod.notes).filter(n => n.id !== 0);
  if (checkTile) {
    const sounding = material.filter(n => !n.properties.measure);
    assert.ok(sounding.length > 0, `${checkTile.key}: no sounding notes`);
    for (const n of material) {
      const context: string = `${checkTile.key}: tile note ${n.id}`;
      assert.ok(X.toNumber(n.getExactVariable('duration')) > 0, context);
      if (n.properties.measure) {
        assert.ok(n.hasExpression('startTime'), context);
        assert.equal(n.hasExpression('frequency'), false, context);
        continue;
      }
      assert.equal(noteKind(n), 'note', context);
      assert.ok(X.toNumber(n.getExactVariable('frequency')) > 0, context);
      const amplitude = mod.findAmplitude(n);
      assert.ok(amplitude.s > 0n && amplitude.n > 0n, context);
    }
    if (checkTile.section === 'progressions') await assertEditableProgression(mod, sounding, checkTile.key);
  }
  for (const n of material) {
    if (n.properties?.measure) { bars.push(`${t(n, 'startTime')} | ${t(n, 'duration')}`); continue; }
    if (noteKind(n) !== 'note') continue;
    notes.push(`${t(n, 'startTime')} | ${t(n, 'duration')} | ${t(n, 'frequency')}`);
  }
  return { notes: notes.sort(), bars: bars.sort() };
}

const files = walk(modulesDir).sort();
if (process.argv.includes('--record')) {
  const out: Record<string, Awaited<ReturnType<typeof sounds>>> = {};
  for (const f of files) out[relative(modulesDir, f).replace(/\\/g, '/')] = await sounds(f);
  writeFileSync(oracleFile, JSON.stringify({ recorded: recording, modules: out }, null, 1) + '\n');
  console.log(`${files.length} modules recorded`);
  process.exit(0);
}

const oracle = readOracle(oracleFile, librarySounds);
let failures = 0, same = 0, notesChecked = 0;
console.log('\nThe library sounds as recorded');
for (const f of files) {
  const key = relative(modulesDir, f).replace(/\\/g, '/');
  const want = oracle[key];
  if (!want) { failures++; console.error(`  ✗ ${key}: not in the oracle (a new module? record it deliberately)`); continue; }
  const section = shipped.get(key);
  const got = await sounds(f, section ? { key, section } : undefined);
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (eq(got.notes, want.notes) && eq(got.bars, want.bars)) { same++; notesChecked += got.notes.length; continue; }
  failures++;
  const missing = want.notes.filter((x) => !got.notes.includes(x)).slice(0, 2);
  const extra = got.notes.filter((x) => !want.notes.includes(x)).slice(0, 2);
  console.error(`  ✗ ${key}: plays something else (${got.notes.length} notes, was ${want.notes.length}; missing ${missing.join(' ; ')}; new ${extra.join(' ; ')})`);
}
for (const key of shipped.keys()) assert.ok(oracle[key], `${key}: missing shipped tile in the oracle`);
if (failures === 0) {
  console.log(`  ✓ ${same} modules, ${notesChecked} sounding notes and their bars exactly as recorded`);
  console.log(`  ✓ All ${shipped.size} shipped tiles contain sounding notes. Progressions retain exact voicings and independent attacks.`);
}
for (const k of Object.keys(oracle)) if (!files.some((f) => relative(modulesDir, f).replace(/\\/g, '/') === k)) { failures++; console.error(`  ✗ ${k}: in the oracle but no longer in the library`); }
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll library checks passed');
