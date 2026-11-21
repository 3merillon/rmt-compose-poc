#!/usr/bin/env node
/**
 * Group editing (npm test): selecting notes by their relations, and Set / Scale /
 * Inherit on a selection (src/utils/group-edit.js). Run on the default module, the
 * canon: a theme whose notes are chained by start and two basses a bar apart.
 * Their frequency references can point to an earlier or later sounding note.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { Module } = await import('../src/module.js');
const X = await import('../src/value/exact.js');
const G = await import('../src/utils/group-edit.js');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures++; console.error(`  ✗ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const canon = JSON.parse(readFileSync(join(root, 'public', 'modules', 'defaultModule.json'), 'utf8'));
async function load(data = canon) {
  const quiet = console.info; console.info = () => {};
  const m = await Module.loadFromJSON(JSON.parse(JSON.stringify(data)));
  m.evaluateModule();
  console.info = quiet;
  return m;
}
const RED = 'rgba(255,0,0,0.5)', BLUE = 'rgba(0,0,255,0.5)', GREEN = 'rgba(0,255,0,0.5)';
const ofColor = (m, c) => Object.values(m.notes).filter((n) => n.properties?.color === c).map((n) => Number(n.id));
const ex = (m, id, k) => m.getNoteById(id).getExactVariable(k);
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const firstOf = (m, ids) => ids.slice().sort((a, b) => X.compare(ex(m, a, 'startTime'), ex(m, b, 'startTime')))[0];
const lastOf = (m, ids) => ids.slice().sort((a, b) => X.compare(ex(m, b, 'startTime'), ex(m, a, 'startTime')))[0];

console.log('\nGroup editing: selecting by relation');
{
  const m = await load();
  const sameHighlights = Object.values(m.notes).every(note => {
    const tree = m.getChildrenTreeByAllProperties(note.id);
    const affected = m.getDependentsByProperty(note.id);
    return ['frequency', 'startTime', 'duration'].every(prop => {
      const edges = tree.edgesByProperty[prop];
      return JSON.stringify(edges) === JSON.stringify(m.getChildrenTreeByProperty(note.id, prop).edges) &&
        sameSet(new Set(edges.map(edge => edge.childId)), new Set(affected[prop]));
    });
  });
  check(sameHighlights, 'one selection traversal gives the same ordered lines and highlighted notes as the individual property walks');
  const red = ofColor(m, RED), blue = ofColor(m, BLUE), green = ofColor(m, GREEN);
  const theme = new Set([firstOf(m, red), ...G.relatedNoteIds(m, firstOf(m, red), 'dependents', 't')]);
  check(sameSet(theme, new Set(red)), `the theme's first note and its dependents by t are the whole theme (${theme.size} of ${red.length} notes, nothing else)`);
  const basses = new Set([firstOf(m, blue), ...G.relatedNoteIds(m, firstOf(m, blue), 'dependents', 't')]);
  check(sameSet(basses, new Set([...blue, ...green])), `the bass's first note and its dependents by t are both basses (${basses.size} notes): the second is written from the first`);
  const b = Number(/\[(\d+)\]\.f/.exec(m.getNoteById(green[0]).getExpressionSource('frequency'))[1]);
  const byF = G.relatedNoteIds(m, b, 'dependents', 'f');
  check(byF.size === 1 && byF.has(green[0]), `the dependents by f of a bass note are the note that answers it a fifth higher (${[...byF]})`);
  const up = G.relatedNoteIds(m, lastOf(m, red), 'dependencies', 't');
  check(sameSet(up, new Set(red.filter((id) => id !== lastOf(m, red)))), `the dependencies by t of the theme's last note are the rest of the theme (${up.size} notes; the BaseNote is never included)`);
  const all = G.relatedNoteIds(m, firstOf(m, blue), 'dependents', 'all');
  check(!all.has(0) && !all.has(firstOf(m, blue)), 'a walk never returns the BaseNote or the note it starts from');
  let threw = false; try { G.relatedNoteIds(m, 1, 'sideways', 't'); } catch { threw = true; }
  check(threw, 'an unknown direction is refused');
}

console.log('\nGroup editing: Scale keeps the relations, and changes each note once');
{
  const m = await load();
  const blue = ofColor(m, BLUE), green = ofColor(m, GREEN);
  const before = new Map([...blue, ...green].map((id) => [id, ex(m, id, 'frequency')]));
  const answerAnchor = m.getNoteById(81).getExpressionSource('frequency');
  const r = G.scaleGroup(m, [...blue, ...green], 'frequency', '3/2');
  m.evaluateModule();
  check(r.changed.length === 47 && r.followed.length === 81 && r.skipped.length === 0,
    `transposing both basses by 3/2: ${r.changed.length} roots scaled, ${r.followed.length} linked pitches follow, none skipped`);
  const wrong = [...before].filter(([id, f]) => !X.equals(ex(m, id, 'frequency'), X.mul(f, new Fraction(3, 2))));
  check(wrong.length === 0, `every note of both basses is exactly 3/2 higher, none twice (${wrong.length} wrong)`);
  const g = m.getNoteById(green[0]).getExpressionSource('frequency');
  check(/^\(3\/2\) \* \[\d+\]\.f$/.test(g), `the second bass is still written from the first: ${g}`);
  check(r.followed.includes(81) && m.getNoteById(81).getExpressionSource('frequency') === answerAnchor,
    'the A in bar 5 follows the later E through the group transposition');
}
{
  const m = await load();
  const red = ofColor(m, RED);
  const d0 = new Map(red.map((id) => [id, ex(m, id, 'duration')]));
  const r = G.scaleGroup(m, red, 'duration', '2');
  m.evaluateModule();
  const wrong = red.filter((id) => !X.equals(ex(m, id, 'duration'), X.mul(d0.get(id), new Fraction(2))));
  check(r.changed.length === red.length && wrong.length === 0, `doubling the theme's lengths doubles every one exactly (${r.changed.length} notes)`);
  const chained = red.filter((id) => /^\[(\d+)\]\.t \+ \[\1\]\.d/.test(m.getNoteById(id).getExpressionSource('startTime')));
  const spread = chained.every((id) => {
    const p = Number(/^\[(\d+)\]/.exec(m.getNoteById(id).getExpressionSource('startTime'))[1]);
    return X.compare(ex(m, id, 'startTime'), X.add(ex(m, p, 'startTime'), ex(m, p, 'duration'))) >= 0;
  });
  check(spread, `and the theme spreads out by itself: each of its ${chained.length} chained notes still begins where the one before ends`);
}
{
  const m = await load();
  const red = ofColor(m, RED);
  const r = G.scaleGroup(m, red, 'amplitude', '0.75');
  m.evaluateModule();
  check(r.changed.length === red.length && red.every((id) => X.equals(ex(m, id, 'amplitude'), new Fraction(3, 4))),
    `amplitude × 0.75 on notes that had none (the default 1): each is now exactly 3/4`);
  const r2 = G.scaleGroup(m, red, 'attack', '1/2');
  check(r2.changed.length === 0 && r2.skipped.length === red.length && /envelope/.test(r2.skipped[0].reason),
    `attack × 1/2 where nothing sets an attack: every note skipped, "${r2.skipped[0].reason}"`);
}
{
  const m = await load();
  const id = ofColor(m, RED)[3];
  const f0 = ex(m, id, 'frequency');
  G.scaleGroup(m, [id, ofColor(m, RED)[5]], 'frequency', '2^(1/12)');
  m.evaluateModule();
  const f1 = ex(m, id, 'frequency');
  check(X.isIrrational(f1) && X.equals(f1, X.mul(f0, X.pow(new Fraction(2), new Fraction(1, 12)))),
    `a tempered factor stays exact: × 2^(1/12) gives ${X.toText(f1)}`);
  let threw = false; try { G.scaleGroup(m, [id], 'frequency', '3 +'); } catch { threw = true; }
  check(threw, 'a factor that does not parse is refused before anything is written');
}

console.log('\nGroup editing: Set, Inherit, instrument and colour');
{
  const m = await load();
  const red = ofColor(m, RED);
  const k = red[0];
  const r = G.setGroup(m, red, 'amplitude', `[${k}].a * (1/2)`);
  m.evaluateModule();
  check(r.changed.length === red.length - 1 && r.skipped.length === 1 && r.skipped[0].id === k,
    `Set amplitude [${k}].a * (1/2) on the theme: written to ${r.changed.length} notes, refused on note ${k} itself (${r.skipped[0]?.reason})`);
  check(X.equals(ex(m, red[1], 'amplitude'), new Fraction(1, 2)), 'and the others read note ' + k + ' (1/2 of its default 1)');
  const s = G.scaleGroup(m, red, 'amplitude', '2');
  check(s.followed.length === red.length - 1 && s.changed.length === 1, `then × 2: only note ${k} is scaled, the ${s.followed.length} that read it follow`);
  const i = G.inheritGroup(m, red, 'amplitude');
  m.evaluateModule();
  check(i.changed.length === red.length && red.every((id) => X.equals(m.findAmplitude(m.getNoteById(id)), new Fraction(1))),
    `Inherit removes the notes' own amplitude: all ${i.changed.length} back to 1`);
  let threw = false; try { G.inheritGroup(m, red, 'frequency'); } catch { threw = true; }
  check(threw, 'a frequency cannot inherit');
}
{
  const m = await load();
  const red = ofColor(m, RED);
  G.setGroupProperty(m, red, 'instrument', 'organ');
  check(red.every((id) => m.findInstrument(m.getNoteById(id)) === 'organ'), 'instrument organ on the theme: every note plays the organ');
  G.setGroupProperty(m, red, 'instrument', null);
  check(red.every((id) => m.getNoteById(id).properties.instrument == null), 'instrument cleared: every note inherits again');
  G.setGroupProperty(m, red, 'color', 'rgba(10,20,30,0.5)');
  const json = m.createModuleJSON();
  check(json.notes.filter((n) => red.includes(n.id)).every((n) => n.color === 'rgba(10,20,30,0.5)'), 'colour set on the theme, and saved with the module');
  const bars = Object.values(m.notes).filter((n) => n.properties?.measure).map((n) => Number(n.id));
  const r = G.setGroup(m, [0, ...bars, red[0]], 'amplitude', '1/2');
  check(r.changed.length === 1 && r.changed[0] === red[0], 'the BaseNote and measure bars are never edited by a group action');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll group editing checks passed');
