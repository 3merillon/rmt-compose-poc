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
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { Module } = await import('../src/module.js');
const { legacyToDSL, migrateSyntax, isLegacyExpression, SyntaxMigrationError } = await import('../src/migrate/legacy-syntax.js');
const { compiler } = await import('../src/expression-compiler.js');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const fr = (v) => (v == null ? null : v.toFraction());

// Phase C: a tempered value (an irrational power, or computed from one) was
// recorded by the old engines as a float-derived fraction; it is now exact.
// Such a value may differ from the record, by less than 1e-9 relative, and
// only when the evaluation marks the variable as tempered.
const VAR_BITS = { t: 0x01, d: 0x02, f: 0x04, a: 0x08, atk: 0x10, rel: 0x20 };
const VAR_NAMES_BY_KEY = { t: 'startTime', d: 'duration', f: 'frequency', a: 'amplitude', atk: 'attack', rel: 'release' };
let temperedChanged = 0, temperedNowRational = 0;
function temperedMatch(mod, rec, id, k, want, got) {
  if (want == null || got == null) return false;
  const w = new Fraction(want), g = new Fraction(got);
  const rel = Math.abs(g.div(w).valueOf() - 1);
  if (!(rel < 1e-9)) return false;
  const name = VAR_NAMES_BY_KEY[k];
  const ex = rec.exact && rec.exact[name];
  const graph = mod.getDependencyGraph?.();
  const tempered = (rec.corruptionFlags & VAR_BITS[k]) || (ex && ex.kind === 'irrational') ||
    (k === 'f' && graph?.isFrequencyTransitivelyCorrupted?.(Number(id)));
  if (!tempered) return false;
  temperedChanged++;
  if (!ex) temperedNowRational++;
  return true;
}

const quiet = console.info;
console.info = () => {};

const RETRANSLATED = ['public/modules/defaultModule.json', 'public/modules/custom/canon base.json'];

// ---------------------------------------------------------------------------
console.log('\nOne syntax: old modules convert exactly');
{
  const oracle = JSON.parse(readFileSync(join(here, 'fixtures', 'legacy-syntax-oracle.json'), 'utf8')).modules;
  let modules = 0, values = 0, rewritten = 0, retranslated = 0;
  for (const [key, expected] of Object.entries(oracle)) {
    // Rewritten in Phase L with new note ids (each root a key change plus a root
    // tone), so a note-by-note comparison by id no longer applies; what they play
    // is checked note for note by scripts/test-library.mjs, recorded from the
    // library this test had verified.
    if (key.startsWith('public/modules/progressions/')) { rewritten++; continue; }
    // Retranslated on 19 November 2026 (the canon with one bass for both voices, the
    // owner's choice): new pitches and new ids, checked by test-library.mjs instead.
    if (RETRANSLATED.includes(key)) { retranslated++; continue; }
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
        if (!got || (got[k] !== want[k] && !(k !== 'c' && temperedMatch(mod, rec, id, k, want[k], got[k])))) {
          if (wrong++ < 3) bad(`${key} note ${id} ${k}: expected ${want[k]}, got ${got ? got[k] : 'no record'}`);
        }
      }
    }
    if (wrong > 3) bad(`${key}: ${wrong - 3} more differences`);
    modules++;
  }
  if (rewritten) console.log(`  · ${rewritten} progressions rewritten in Phase L: checked by test-library.mjs instead`);
  if (retranslated) console.log(`  · ${retranslated} canon modules retranslated (one bass for both voices): checked by test-library.mjs instead`);
  if (failures === 0) ok(`${modules} modules, ${values} values identical to the method-chain engine, except ${temperedChanged} tempered values now exact (${temperedNowRational} of them rational)`);

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
    ["module.getNoteById(16777216).getVariable('frequency')", /out of range/],
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
