#!/usr/bin/env node
/**
 * Relational time (npm test).
 *
 * 1. Old modules convert exactly. scripts/fixtures/old-time-oracle.json holds
 *    every start, duration, frequency and amplitude of the library modules and
 *    of the fixtures in scripts/fixtures/old-time/, as evaluated by the engine
 *    that still had tempo, beats per measure and measure length (v2 @ 6bf71cf).
 *    Each module is loaded now (the library files are already converted on
 *    disk; the fixtures are old-format and convert on load) and every value
 *    must be the same fraction. A bar's new duration must equal its old
 *    measure length, and the reference note's duration 60 / its old tempo.
 * 2. The language: beat(), tempo(), measure(), .bpm and friends are refused
 *    with a message naming what replaced them; base.d is the time unit.
 * 3. Measure bars: Add Measure chains `[p].t + [p].d` / `[p].d`, and a saved
 *    module keeps the bar flag and no old key.
 * 4. Interpretation: attack and release evaluate, and fall back to the
 *    reference note's like amplitude; start, duration and frequency never do.
 *
 * Optional: node scripts/test-relational-time.mjs --oracle <file> <root>
 * compares another oracle (made with the old engine) against files under root.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { Module, invalidateModuleEndTimeCache } = await import('../src/module.js');
const { migrateTimeModel, needsTimeMigration } = await import('../src/migrate/relational-time.js');
const { compileDSL } = await import('../src/dsl/index.js');

let failures = 0;
let passes = 0;
const ok = (msg) => { passes++; console.log(`  ✓ ${msg}`); };
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

async function compareOracle(oracleFile, baseDir) {
  const oracle = JSON.parse(readFileSync(oracleFile, 'utf8')).modules;
  let modules = 0, values = 0;
  for (const [key, expected] of Object.entries(oracle)) {
    const file = join(baseDir, key);
    let mod;
    try {
      mod = await Module.loadFromJSON(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      bad(`${key}: does not load: ${e.message}`);
      continue;
    }
    const cache = mod.evaluateModule();
    let wrong = 0;
    const report = (id, what, want, got) => {
      if (wrong++ < 3) bad(`${key} note ${id} ${what}: expected ${want}, got ${got}`);
    };
    for (const [idStr, want] of Object.entries(expected)) {
      const id = Number(idStr);
      const rec = cache.get(id);
      if (!rec) { report(id, 'record', 'a value', 'nothing'); continue; }
      const got = { t: fr(rec.startTime), d: fr(rec.duration), f: fr(rec.frequency), a: fr(rec.amplitude) };
      // What the new values must be
      const exp = { t: want.t, d: want.d, f: want.f, a: want.a };
      if (id === 0) exp.d = fr(new Fraction(60).div(new Fraction(want.tempo)));
      if (want.measure) exp.d = want.ml;
      for (const k of ['t', 'd', 'f', 'a']) {
        values++;
        if (exp[k] !== got[k] && !temperedMatch(mod, rec, id, k, exp[k], got[k])) report(id, k, exp[k], got[k]);
      }
      if (want.measure && !mod.getNoteById(id).properties.measure) report(id, 'bar flag', true, false);
    }
    if (wrong > 3) bad(`${key}: ${wrong - 3} more differences`);
    modules++;
  }
  return { modules, values };
}

// ---------------------------------------------------------------------------
console.log('\nRelational time: old modules convert exactly');
{
  const args = process.argv.slice(2);
  if (args[0] === '--oracle') {
    const { modules, values } = await compareOracle(args[1], args[2]);
    if (failures === 0) ok(`${modules} modules, ${values} values identical to the old engine`);
    process.exit(failures === 0 ? 0 : 1);
  } else {
    const { modules, values } = await compareOracle(join(here, 'fixtures', 'old-time-oracle.json'), root);
    if (failures === 0) ok(`${modules} modules (library and old-format fixtures), ${values} values identical to the old engine, except ${temperedChanged} tempered values now exact (${temperedNowRational} of them rational, e.g. an octave of twelve 2^(1/12) steps)`);
  }
}

console.log('\nRelational time: the library is stored in the new form');
{
  const lib = JSON.parse(readFileSync(join(here, 'fixtures', 'old-time-oracle.json'), 'utf8')).modules;
  const stale = Object.keys(lib)
    .filter(k => k.startsWith('public/'))
    .filter(k => needsTimeMigration(JSON.parse(readFileSync(join(root, k), 'utf8'))));
  if (stale.length === 0) ok('no library module uses tempo, beats per measure, measure length or beat()/measure()');
  else bad(`still in the old form: ${stale.join(', ')}`);
}

console.log('\nRelational time: the language');
{
  const refused = [
    ['beat(base) * 2', /base\.d/],
    ['measure([3])', /\[N\]\.d/],
    ['tempo(base)', /tempo is no longer stored/],
    ['[3].bpm * 2', /\.bpm' was removed/],
    ['base.tempo', /\.tempo' was removed/],
    ['[2].ml', /\.ml' was removed/],
  ];
  for (const [src, msg] of refused) {
    try {
      compileDSL(src);
      bad(`"${src}" parsed; it should be refused`);
    } catch (e) {
      if (msg.test(e.message)) ok(`"${src}" is refused: ${e.message.split(':')[0]}`);
      else bad(`"${src}" refused with an unhelpful message: ${e.message}`);
    }
  }

  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '300', startTime: '0', duration: '2/3' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d * (3/2)', frequency: 'base.f' },
      { id: 2, startTime: '[1].t + [1].d', duration: '[1].d / 3', frequency: '[1].f * (5/4)' },
    ],
  });
  const c = mod.evaluateModule();
  const got = [fr(c.get(1).duration), fr(c.get(2).startTime), fr(c.get(2).duration), fr(mod.getTimeUnit())].join(' ');
  if (got === '1 1 1/3 2/3') ok('base.d is the time unit: base.d * (3/2) = 1 s at base.d = 2/3, tempo view 90 BPM');
  else bad(`time unit arithmetic: ${got}`);

  const fresh = await Module.loadFromJSON({ baseNote: {}, notes: [] });
  fresh.evaluateModule();
  if (fr(fresh.getTimeUnit()) === '1' && fr(fresh.baseNote.getVariable('frequency')) === '440') ok('a new module\'s reference note is f = 440, t = 0, d = 1');
  else bad('new module defaults');

  // The BaseNote has a start, a duration and a frequency now, yet it is the
  // reference, not a note: it must not lengthen the module (nor sound, nor draw).
  const unitOnly = await Module.loadFromJSON({
    baseNote: { frequency: '440', startTime: '0', duration: '10' },
    notes: [{ id: 1, startTime: 'base.t', duration: 'base.d / 10', frequency: 'base.f' }],
  });
  unitOnly.evaluateModule();
  const endWithNote = unitOnly.getModuleEndTime();
  invalidateModuleEndTimeCache(); // the end time is memoised for the app's one module
  const cleared = await Module.loadFromJSON({ baseNote: { frequency: '440', startTime: '0', duration: '10' }, notes: [] });
  cleared.evaluateModule();
  if (endWithNote === 1 && cleared.getModuleEndTime() === 0) ok('the BaseNote\'s duration does not count as a note: a 10 s time unit, one 1 s note, the module ends at 1 (and an empty one at 0)');
  else bad(`module end with a long time unit: ${endWithNote}, empty: ${cleared.getModuleEndTime()}`);
}

console.log('\nRelational time: measure bars');
{
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '264', startTime: '0', duration: '1/2' },
    notes: [],
  });
  const [b1] = mod.generateMeasures(mod.baseNote, 1);
  const [b2, b3] = mod.generateMeasures(b1, 2);
  mod.evaluateModule();
  const src = (n, k) => n.getExpressionSource(k);
  if (src(b1, 'startTime') === 'base.t' && src(b1, 'duration') === 'base.d * 4' &&
      src(b3, 'startTime') === `[${b2.id}].t + [${b2.id}].d` && src(b3, 'duration') === `[${b2.id}].d`) {
    ok('Add Measure writes base.t / base.d * 4, then [p].t + [p].d / [p].d');
  } else {
    bad(`bar expressions: ${[b1, b2, b3].map(b => `${src(b, 'startTime')} | ${src(b, 'duration')}`).join(' ; ')}`);
  }
  b2.setVariable('duration', 'base.d * 3');
  mod.markNoteDirty(b2.id);
  const c = mod.evaluateModule();
  if (fr(c.get(b3.id).startTime) === '7/2' && fr(c.get(b3.id).duration) === '3/2') ok('a meter change on one bar carries to the bars after it');
  else bad(`meter change: bar 3 at ${fr(c.get(b3.id).startTime)} for ${fr(c.get(b3.id).duration)}`);
  if (Math.abs(mod.getModuleEndTime() - 5) < 1e-12) ok('the module ends where the last bar ends (5 s)');
  else bad(`module end ${mod.getModuleEndTime()}`);

  const json = mod.createModuleJSON();
  const flat = JSON.stringify(json);
  if (json.notes.every(n => n.measure === true) && json.baseNote.duration && !/tempo|beatsPerMeasure|measureLength|beat\(|measure\(/.test(flat)) {
    ok('a saved module keeps "measure": true on bars and no old key or helper');
  } else {
    bad(`saved module: ${flat}`);
  }
  const again = migrateTimeModel(json);
  if (!again.migrated) ok('a saved module is not converted again');
  else bad('a saved new-format module was converted again');
}

console.log('\nRelational time: interpretation variables');
{
  const mod = await Module.loadFromJSON({
    baseNote: { frequency: '440', startTime: '0', duration: '1', attack: '1/8' },
    notes: [
      { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' },
      { id: 2, startTime: '[1].t', duration: 'base.d', frequency: 'base.f', attack: '[1].attack * 2', release: '1/4' },
      { id: 3, startTime: '[2].t', duration: 'base.d', frequency: 'base.f', release: '[2].rel + (1/4)' },
    ],
  });
  const c = mod.evaluateModule();
  const got = [c.get(1).attack, c.get(2).attack, c.get(2).release, c.get(3).release].map(v => fr(v) ?? 'null').join(' ');
  if (got === 'null 1/4 1/4 1/2') ok('attack and release evaluate; [1].attack reads the reference note\'s 1/8 when note 1 has none');
  else bad(`attack/release: ${got}`);
}

console.log(failures === 0 ? `\nAll relational-time checks passed (${passes}).` : `\n${failures} relational-time check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
