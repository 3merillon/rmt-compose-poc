#!/usr/bin/env node
/**
 * One syntax (npm test).
 *
 * 1. Old modules convert exactly. scripts/fixtures/legacy-syntax-oracle.json
 *    holds every start, duration, frequency, amplitude, attack, release and
 *    corruption flag of the library modules and of every fixture, as evaluated
 *    by the engine that still had the method-chain compiler (v2 @ 03e9621).
 *    The fixtures in scripts/fixtures/legacy-syntax/ are in that syntax: four
 *    library modules as the old decompiler wrote them, and shapes.json, every
 *    building block and call order the converter accepts. Each module loads
 *    now and every value must be the same.
 * 2. The converter: what it writes, and what it refuses (call orders the old
 *    compiler did not read as written, unknown variables, mixed syntax).
 * 3. One language: the library holds no method-chain text, and a typed
 *    method-chain expression is refused with a message saying what replaced it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { Module } = await import('../src/module.js');
const { legacyToDSL, migrateSyntax, isLegacyExpression, SyntaxMigrationError } = await import('../src/migrate/legacy-syntax.js');
const { compiler } = await import('../src/expression-compiler.js');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const fr = (v) => (v == null ? null : v.toFraction());

const quiet = console.info;
console.info = () => {};

// ---------------------------------------------------------------------------
console.log('\nOne syntax: old modules convert exactly');
{
  const oracle = JSON.parse(readFileSync(join(here, 'fixtures', 'legacy-syntax-oracle.json'), 'utf8')).modules;
  let modules = 0, values = 0;
  for (const [key, expected] of Object.entries(oracle)) {
    let mod;
    try {
      mod = await Module.loadFromJSON(JSON.parse(readFileSync(join(root, key), 'utf8')));
    } catch (e) {
      bad(`${key}: does not load: ${e.message}`);
      continue;
    }
    const cache = mod.evaluateModule();
    let wrong = 0;
    for (const [id, want] of Object.entries(expected)) {
      const rec = cache.get(Number(id));
      const got = rec && {
        t: fr(rec.startTime), d: fr(rec.duration), f: fr(rec.frequency),
        a: fr(rec.amplitude), atk: fr(rec.attack), rel: fr(rec.release),
        c: rec.corruptionFlags || 0,
      };
      for (const k of Object.keys(want)) {
        values++;
        if (!got || got[k] !== want[k]) {
          if (wrong++ < 3) bad(`${key} note ${id} ${k}: expected ${want[k]}, got ${got ? got[k] : 'no record'}`);
        }
      }
    }
    if (wrong > 3) bad(`${key}: ${wrong - 3} more differences`);
    modules++;
  }
  if (failures === 0) ok(`${modules} modules, ${values} values identical to the method-chain engine`);

  for (const f of ['shapes.json', 'defaultModule.json', 'TET-12.json', 'twinkle.json', 'ii-V-I.json']) {
    const data = JSON.parse(readFileSync(join(here, 'fixtures', 'legacy-syntax', f), 'utf8'));
    const { data: out, migrated } = migrateSyntax(data);
    const left = [out.baseNote, ...out.notes].flatMap(n => Object.values(n)).filter(isLegacyExpression);
    if (migrated && left.length === 0) ok(`${f}: every expression is DSL after loading`);
    else bad(`${f}: ${left.length} method-chain expression(s) left, e.g. ${left[0]}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nOne syntax: the converter');
{
  const writes = [
    ["module.getNoteById(3).getVariable('frequency').mul(new Fraction(3, 2))", '[3].f * (3/2)'],
    ["module.baseNote.getVariable('duration')", 'base.d'],
    ["module.getNoteById(1).getVariable('startTime').add(module.getNoteById(1).getVariable('duration'))", '[1].t + [1].d'],
    ["new Fraction(2).pow(new Fraction(1, 12)).mul(module.baseNote.getVariable('frequency'))", '2^(1/12) * base.f'],
    ["(module.getNoteById(1).getVariable('startTime').add(new Fraction(1))).mul(new Fraction(2))", '([1].t + 1) * 2'],
    ["module.getNoteById(2).getVariable('duration').div(module.getNoteById(1).getVariable('duration').mul(new Fraction(2)))", '[2].d / ([1].d * 2)'],
    ["module.getNoteById(2).getVariable('startTime').sub(new Fraction(1, 3).add(new Fraction(1, 5)))", '[2].t - ((1/3) + (1/5))'],
    ["new Fraction(0.25)", '(1/4)'],
    ["new Fraction(1.5, 3)", '(1/2)'],
    ["new Fraction(3, -4)", '(-3/4)'],
    ["module.baseNote.getVariable('frequency').mul(new Fraction(-3))", 'base.f * -3'],
    ["new Fraction(-3).pow(new Fraction(3))", '(-3)^3'],
    ['frequency', 'base.f'],
    ["module.getNoteById(4).getVariable('amplitude').mul(new Fraction(1, 2))", '[4].a * (1/2)'],
  ];
  for (const [src, want] of writes) {
    try {
      const got = legacyToDSL(src);
      if (got === want) ok(`${src.length > 60 ? src.slice(0, 57) + '...' : src}  ->  ${got}`);
      else bad(`${src}: expected "${want}", got "${got}"`);
    } catch (e) {
      bad(`${src}: refused: ${e.message}`);
    }
  }

  const refuses = [
    ["module.baseNote.getVariable('startTime').add(new Fraction(1)).mul(new Fraction(2))", /\.mul\(\) after \.add\(\)/],
    ["module.baseNote.getVariable('frequency').mul(new Fraction(2)).pow(new Fraction(1, 2))", /\.pow\(\) after \.mul\(\)/],
    ["new Fraction(2).pow(new Fraction(1, 2)).pow(new Fraction(2))", /\.pow\(\) after \.pow\(\)/],
    ["module.baseNote.getVariable('frequency').neg()", /\.neg\(\)/],
    ['module.baseNote.getVariable("frequency")', /unexpected/],
    ["module.baseNote.getVariable('tempo')", /unknown variable 'tempo'/],
    ["module.findTempo(module.baseNote)", /expected baseNote|getNoteById/],
    ["new Fraction('1/3')", /unexpected/],
    ["[1].f.mul(new Fraction(3, 2))", /unexpected/],
    ["new Fraction(1, 0)", /division by zero/],
    ["module.getNoteById(70000).getVariable('frequency')", /out of range/],
  ];
  for (const [src, msg] of refuses) {
    try {
      const got = legacyToDSL(src);
      bad(`${src}: converted to "${got}"; it should be refused`);
    } catch (e) {
      if (e instanceof SyntaxMigrationError && msg.test(e.message)) ok(`refused: ${e.message}`);
      else bad(`${src}: refused with an unexpected message: ${e.message}`);
    }
  }

  // A module with one unreadable expression does not load, and says where.
  try {
    await Module.loadFromJSON({
      baseNote: { frequency: '263', startTime: '0', duration: '1' },
      notes: [{ id: 4, startTime: 'base.t', duration: 'base.d', frequency: "module.baseNote.getVariable('frequency').neg()" }],
    });
    bad('a module with an unreadable method-chain expression loaded');
  } catch (e) {
    if (/note 4 frequency/.test(e.message)) ok(`a module that cannot be converted is refused: ${e.message.slice(0, 60)}...`);
    else bad(`refused without naming the note: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nOne syntax: one language');
{
  const oracle = JSON.parse(readFileSync(join(here, 'fixtures', 'legacy-syntax-oracle.json'), 'utf8')).modules;
  const stale = [];
  for (const key of Object.keys(oracle).filter(k => k.startsWith('public/'))) {
    const data = JSON.parse(readFileSync(join(root, key), 'utf8'));
    for (const n of [data.baseNote, ...data.notes]) {
      for (const v of Object.values(n)) if (isLegacyExpression(v)) stale.push(`${key} note ${n.id ?? 0}`);
    }
  }
  if (stale.length === 0) ok('no library module holds method-chain text');
  else bad(`method-chain text in ${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ` and ${stale.length - 3} more` : ''}`);

  try {
    compiler.compile("module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))");
    bad('a typed method-chain expression compiled; it should be refused');
  } catch (e) {
    if (/method-chain syntax was retired/.test(e.message) && /base\.f \* \(3\/2\)/.test(e.message)) {
      ok(`a typed method-chain expression is refused: ${e.message}`);
    } else bad(`typed method-chain refused with an unhelpful message: ${e.message}`);
  }
}

console.info = quiet;
if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll one-syntax checks passed');
