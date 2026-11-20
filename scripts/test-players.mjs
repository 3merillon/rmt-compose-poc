#!/usr/bin/env node
/**
 * Players — an instrument follows the START TIME (Phase I, npm test).
 *
 * The rule is src/players.js (design/phase-i-instruments.md §4, the owner's
 * revision of 20 November 2026). This pins it down:
 *
 *   A. The canon (default module) has exactly three players: the theme, 25 notes
 *      from note 9; the first bass, 70 notes from note 10; the second bass, 58 from
 *      note 24 (a copy of the first, note by note).
 *   B. Setting one note's instrument changes its whole line: note 9 the theme, note
 *      24 the second bass; note 10 the first bass and, until 24 sets its own, the
 *      second (whose first note is written from note 10).
 *   C. A silence carries the line (a player can rest); so does a rest written as
 *      an offset after a note's end.
 *   D. A chord tone written from a note's start is its own player but takes that
 *      note's instrument; a note written from a measure bar takes the BaseNote's.
 *   E. A note that sets its own instrument mid-line starts a new player, and the
 *      notes after it follow it.
 *   F. No note of any library module changes instrument (against the rule before).
 *   G. An old module whose instruments the new rule would change is migrated on
 *      load (the old instrument is written onto those notes); a saved module carries
 *      `instrumentRule` and is not migrated again; the round trip is stable.
 *   H. The group widget's "One player": the instrument on the selection's line
 *      heads, the rest inherit.
 *   I. A frequency loop and a 1000-note chain resolve without overflowing.
 *
 * Run via `node scripts/test-players.mjs`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'public', 'modules');
const { Module } = await import('../src/module.js');
const { legacyInstrumentOf, INSTRUMENT_RULE } = await import('../src/players.js');
const { isMeasureNote } = await import('../src/note.js');
const groupEdit = await import('../src/utils/group-edit.js');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const sounding = (m) => Object.values(m.notes).filter((n) => n.id !== 0 && !isMeasureNote(n) && n.getExpressionSource('frequency') && n.getExpressionSource('duration') && n.getExpressionSource('startTime'));
const load = async (json) => { const m = await Module.loadFromJSON(json); m.evaluateModule?.(); return m; };
const players = (m) => {
  const memo = new Map(), by = new Map();
  for (const n of sounding(m)) { const h = m.findPlayer(n, memo).head; by.set(h, (by.get(h) || 0) + 1); }
  return by;
};
const inst = (m, id) => m.findInstrument(m.getNoteById(id));

// ── A, B: the canon ──
console.log('\nThe canon\n');
const canonJson = JSON.parse(readFileSync(join(modulesDir, 'defaultModule.json'), 'utf8'));
{
  const m = await load(canonJson);
  const by = players(m);
  check(by.size === 3 && by.get(9) === 25 && by.get(10) === 70 && by.get(24) === 58,
    `A three players: ${[...by].map(([h, n]) => `${n} notes from [${h}]`).join(', ')}`);
  const memo = new Map();
  const theme = sounding(m).filter((n) => m.findPlayer(n, memo).head === 9).map((n) => n.id);
  const bass1 = sounding(m).filter((n) => m.findPlayer(n, memo).head === 10).map((n) => n.id);
  const bass2 = sounding(m).filter((n) => m.findPlayer(n, memo).head === 24).map((n) => n.id);
  m.getNoteById(9).setVariable('instrument', 'violin');
  check(theme.every((id) => inst(m, id) === 'violin') && bass1.every((id) => inst(m, id) !== 'violin') && bass2.every((id) => inst(m, id) !== 'violin'),
    'B1 the instrument of note 9 is the whole theme\'s, and only the theme\'s');
  m.getNoteById(10).setVariable('instrument', 'piano');
  check(bass1.every((id) => inst(m, id) === 'piano') && bass2.every((id) => inst(m, id) === 'piano'),
    'B2 note 10 decides the first bass, and the second too while note 24 sets none (24 is written from 10)');
  m.getNoteById(24).setVariable('instrument', 'organ');
  check(bass2.every((id) => inst(m, id) === 'organ') && bass1.every((id) => inst(m, id) === 'piano'),
    'B3 note 24 decides the second bass alone');
}

// ── C, D, E: small modules ──
console.log('\nLines, silences, rests, chords, bars\n');
{
  const m = await load({ instrumentRule: INSTRUMENT_RULE, baseNote: { frequency: '263', startTime: '0', duration: '1' }, notes: [
    { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f', instrument: 'piano' },
    { id: 2, startTime: '[1].t + [1].d', duration: 'base.d' },                                    // a silence
    { id: 3, startTime: '[2].t + [2].d', duration: 'base.d', frequency: '(3/2) * base.f' },
    { id: 4, startTime: '[3].t + [3].d + base.d * (1/2)', duration: 'base.d', frequency: '(5/4) * base.f' }, // after a rest
    { id: 5, startTime: '[1].t', duration: 'base.d', frequency: '(5/4) * [1].f' },                // a chord tone on 1
    { id: 6, startTime: 'base.t', duration: 'base.d * 4', measure: true },
    { id: 7, startTime: '[6].t + [6].d', duration: 'base.d', frequency: '[1].f' },                // written from a bar
    { id: 8, startTime: '[4].t + [4].d', duration: 'base.d', frequency: 'base.f', instrument: 'organ' }, // its own, mid-line
    { id: 9, startTime: '[8].t + [8].d', duration: 'base.d', frequency: 'base.f' },
  ] });
  const p = (id) => m.findPlayer(m.getNoteById(id));
  check(inst(m, 3) === 'piano' && p(3).head === 1 && p(3).prev === 2, 'C1 a note after a silence plays on the same player, the silence before it');
  check(inst(m, 4) === 'piano' && p(4).head === 1 && p(4).prev === 3, 'C2 a rest written after a note\'s end keeps the player');
  check(inst(m, 5) === 'piano' && p(5).head === 5 && p(5).prev === null, 'D1 a chord tone on note 1 takes its instrument as a player of its own');
  check(inst(m, 7) === 'sine-wave', 'D2 a note written from a measure bar takes the BaseNote\'s instrument (not its frequency parent\'s)');
  check(inst(m, 8) === 'organ' && p(8).head === 8 && p(8).prev === null && inst(m, 9) === 'organ' && p(9).head === 8,
    'E a note with its own instrument starts a new player, and the line goes on from it');
}

// ── F: the library ──
console.log('\nThe library\n');
{
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const q = join(d, f); if (statSync(q).isDirectory()) walk(q); else if (f.endsWith('.json') && f !== 'library.json' && f !== 'index.json') files.push(q); } };
  walk(modulesDir);
  let notes = 0, changed = 0, mods = 0;
  for (const file of files) {
    if (/voices-(20000|100000)/.test(file)) continue;   // generated stress files: the 5000 one stands for them
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const m = await load({ ...json, instrumentRule: INSTRUMENT_RULE });   // the rule as it is, no migration
    const now = new Map(), old = new Map();
    let c = 0;
    for (const n of sounding(m)) { notes++; if (m.findInstrument(n, now) !== legacyInstrumentOf(m, n, old, 'sine-wave')) c++; }
    if (c) { changed += c; console.error(`    ${relative(modulesDir, file)}: ${c} note(s) change`); }
    mods++;
  }
  check(changed === 0, `F no note of ${mods} library modules (${notes} sounding notes) changes instrument`);
}

// ── G: migration ──
console.log('\nOld modules\n');
{
  // Note 2 follows note 1 in time but reads its pitch from note 3 (organ): before, it played organ.
  const old = { baseNote: { frequency: '263', startTime: '0', duration: '1' }, notes: [
    { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f', instrument: 'piano' },
    { id: 2, startTime: '[1].t + [1].d', duration: 'base.d', frequency: '(3/2) * [3].f' },
    { id: 3, startTime: 'base.t', duration: 'base.d * 2', frequency: '(1/2) * base.f', instrument: 'organ' },
    { id: 4, startTime: '[2].t + [2].d', duration: 'base.d', frequency: 'base.f' },
  ] };
  const m = await load(old);
  check(inst(m, 2) === 'organ' && m.getNoteById(2).properties.instrument === 'organ', 'G1 an old module keeps the instrument it had (note 2 stays organ, now written on it)');
  check(inst(m, 4) === 'sine-wave' && m.getNoteById(4).properties.instrument === 'sine-wave',
    'G2 note 4 read base.f (sine-wave) and would now follow note 2: it keeps sine-wave, written on it');
  const memoOld = new Map();
  check(sounding(m).every((n) => inst(m, n.id) === legacyInstrumentOf(m, n, memoOld, 'sine-wave')), 'G3 every note plays what it played before');
  const saved = m.createModuleJSON();
  check(saved.instrumentRule === INSTRUMENT_RULE, 'G4 a saved module carries instrumentRule');
  const again = await load(saved);
  check(JSON.stringify(again.createModuleJSON()) === JSON.stringify(saved), 'G5 loading it again migrates nothing: the round trip is stable');
  const marked = await load({ ...old, instrumentRule: INSTRUMENT_RULE });
  check(inst(marked, 2) === 'piano' && !marked.getNoteById(2).properties.instrument, 'G6 a module saved under the rule is read by the rule (note 2 plays with note 1)');
}

// ── H: one player for a selection ──
console.log('\nGroup widget: one player\n');
{
  const m = await load(canonJson);
  const memo = new Map();
  const theme = sounding(m).filter((n) => m.findPlayer(n, memo).head === 9).map((n) => n.id);
  const r = groupEdit.setGroupOnePlayer(m, theme, 'violin');
  check(r.players === 1 && m.getNoteById(9).properties.instrument === 'violin' && theme.filter((id) => id !== 9).every((id) => !m.getNoteById(id).properties.instrument),
    'H1 one player for the theme: set on note 9, the other 24 inherit');
  check(theme.every((id) => inst(m, id) === 'violin'), 'H2 …and the whole theme plays violin');
  const basses = sounding(m).filter((n) => { const h = m.findPlayer(n, new Map()).head; return h === 10 || h === 24; }).map((n) => n.id);
  const r2 = groupEdit.setGroupOnePlayer(m, basses, 'organ');
  check(r2.players === 2 && m.getNoteById(10).properties.instrument === 'organ' && m.getNoteById(24).properties.instrument === 'organ',
    'H3 both basses selected: two players (two lines), the instrument on 10 and 24');
  const r3 = groupEdit.setGroupProperty(m, theme.slice(0, 3), 'instrument', 'piano');
  check(r3.changed.length === 3 && theme.slice(0, 3).every((id) => m.findPlayer(m.getNoteById(id)).head === id),
    'H4 "each note its own player" makes each selected note the first of a player');
}

// ── I: safety ──
console.log('\nSafety\n');
{
  const loop = await load({ baseNote: { frequency: '263', startTime: '0', duration: '1' }, notes: [
    { id: 1, startTime: 'base.t', duration: 'base.d', frequency: '[2].f' },
    { id: 2, startTime: 'base.t', duration: 'base.d', frequency: '[1].f' },
  ] });
  check(typeof inst(loop, 1) === 'string', 'I1 a frequency loop resolves to an instrument (no overflow)');
  const chain = await load(JSON.parse(readFileSync(join(modulesDir, 'perf', 'chain-1000.json'), 'utf8')));
  const t0 = performance.now();
  const memo = new Map();
  for (const n of sounding(chain)) chain.findInstrument(n, memo);
  check(performance.now() - t0 < 2000, `I2 a 1000-note chain resolves in ${(performance.now() - t0).toFixed(0)} ms`);
}

console.log(failures ? `\n${failures} player check(s) FAILED` : '\nAll player checks passed.');
process.exit(failures ? 1 : 0);
