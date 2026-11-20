#!/usr/bin/env node
/**
 * Kinds of object, and the two that only relate.
 *
 * There is no type field: what an object is follows from which of f, t and d it
 * has (noteKind in src/note.js). Two kinds never sound:
 *   'reference'       a frequency alone: a tonic, a key, a chord root
 *   'reference-from'  a frequency and a start: a key change, from that start on
 *
 *   A  noteKind on JSON notes and on loaded Notes, every subset of f, t, d.
 *   B  A module that relates its notes to references evaluates exactly, with
 *      nothing reported; a note can take its start from a key change.
 *   C  References never count toward the module's end, never reach playback or
 *      MIDI (the export counts them), and survive save and load unchanged (a
 *      reference gets no start, a key change no duration).
 *
 * Exits non-zero on any failure.
 */
import Fraction from 'fraction.js';

const { Module } = await import('../src/module.js');
const { noteKind, isReferenceNote } = await import('../src/note.js');
const { planMidi } = await import('../src/midi/midi-export.js');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures++; console.error(`  ✗ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));
const quiet = (fn) => {
  const lines = []; const { warn, error } = console;
  console.warn = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  try { return { result: fn(), lines }; } finally { console.warn = warn; console.error = error; }
};

// --- A ---------------------------------------------------------------------------
console.log('A. Kinds from which variables are present\n');
{
  const cases = [
    [{ id: 1, frequency: 'base.f', startTime: 'base.t', duration: 'base.d' }, 'note'],
    [{ id: 2, startTime: 'base.t', duration: 'base.d' }, 'silence'],
    [{ id: 3, startTime: 'base.t', duration: 'base.d * 4', measure: true }, 'measure'],
    [{ id: 4, frequency: '(3/2) * base.f' }, 'reference'],
    [{ id: 5, frequency: '(3/2) * base.f', startTime: 'base.t + base.d * 4' }, 'reference-from'],
    [{ id: 6, startTime: 'base.t' }, 'marker'],
    [{ id: 7, duration: 'base.d' }, 'length'],
    [{ id: 8 }, 'name'],
    [{ id: 0, frequency: '263', startTime: '0', duration: '1' }, 'base'],
  ];
  check(cases.every(([n, k]) => noteKind(n) === k), `A1 JSON notes: ${cases.map(([n, k]) => `${n.id}=${noteKind(n)}`).join(' ')}`);
  const mod = await Module.loadFromJSON({ baseNote: { frequency: '263', startTime: '0', duration: '1' }, notes: cases.filter(([n]) => n.id !== 0).map(([n]) => n) });
  check(cases.filter(([n]) => n.id !== 0).every(([n, k]) => noteKind(mod.getNoteById(n.id)) === k), 'A2 loaded Notes give the same kinds');
  check(isReferenceNote(mod.getNoteById(4)) && isReferenceNote(mod.getNoteById(5)) && !isReferenceNote(mod.getNoteById(1)) && !isReferenceNote(mod.getNoteById(2)),
    'A3 isReferenceNote: true for 4 and 5 only');
}

// --- B ---------------------------------------------------------------------------
console.log('\nB. Notes that relate to references\n');
const JSON_MOD = {
  baseNote: { frequency: '263', startTime: '0', duration: '1/2' },
  notes: [
    { id: 1, frequency: '(4/3) * base.f' },                                   // the tonic: F over C
    { id: 2, startTime: 'base.t', duration: 'base.d * 2', frequency: '[1].f' },
    { id: 3, startTime: '[2].t + [2].d', duration: 'base.d', frequency: '(5/4) * [1].f' },
    { id: 4, frequency: '(3/2) * [1].f', startTime: '[3].t + [3].d' },         // key change to the dominant
    { id: 5, startTime: '[4].t', duration: 'base.d * 2', frequency: '[4].f' },
    { id: 6, startTime: '[5].t + [5].d', duration: 'base.d', frequency: '(5/4) * [4].f' },
  ],
};
const mod = await Module.loadFromJSON(JSON.parse(JSON.stringify(JSON_MOD)));
{
  const { lines } = quiet(() => mod.evaluateModule());
  const v = (id, k) => mod.getNoteById(id).getVariable(k);
  check(v(1, 'frequency').equals(new Fraction(1052, 3)) && v(1, 'startTime') == null && v(1, 'duration') == null,
    'B1 the reference: f = (4/3) * 263, no start, no duration');
  check(v(3, 'frequency').equals(new Fraction(1315, 3)), 'B2 a note relates to it: (5/4) * [1].f');
  check(v(4, 'frequency').equals(new Fraction(526)) && v(4, 'startTime').equals(new Fraction(3, 2)) && v(4, 'duration') == null,
    'B3 the key change: f = (3/2) * [1].f = 526, from 3/2 s on, no duration');
  check(v(5, 'startTime').equals(new Fraction(3, 2)) && v(6, 'frequency').equals(new Fraction(1315, 2)), 'B4 notes take their start and pitch from the key change');
  check(lines.length === 0, `B5 nothing reported (${lines.length}${lines[0] ? `: ${lines[0]}` : ''})`);
}

// --- C ---------------------------------------------------------------------------
console.log('\nC. References never sound and survive a save\n');
{
  check(Math.abs(Number(mod.getModuleEndTime()) - 3) < 1e-12,
    `C1 the module ends at the last sounding note, 3 s (${mod.getModuleEndTime()})`);
  const plan = quiet(() => planMidi(mod)).result;
  check(plan.report.notes.exported === 4 && plan.report.notes.references === 2,
    `C2 MIDI writes the 4 notes and counts the 2 references (exported ${plan.report.notes.exported}, references ${plan.report.notes.references})`);
  const out = mod.createModuleJSON();
  const r = out.notes.find((n) => n.id === 1), k = out.notes.find((n) => n.id === 4);
  check(r && r.frequency && r.startTime == null && r.duration == null, 'C3 saved: the reference keeps only its frequency');
  check(k && k.frequency && k.startTime && k.duration == null, 'C4 saved: the key change keeps its frequency and start, no duration');
  const again = await Module.loadFromJSON(out);
  quiet(() => again.evaluateModule());
  check(noteKind(again.getNoteById(1)) === 'reference' && noteKind(again.getNoteById(4)) === 'reference-from'
    && again.getNoteById(6).getVariable('frequency').equals(new Fraction(1315, 2)), 'C5 and loads back as the same kinds and values');
}

// --- D ---------------------------------------------------------------------------
console.log('\nD. Notes built from *String variables alone (what the add-note form passes)\n');
{
  const { Note } = await import('../src/note.js');
  const n = new Note(1, { startTimeString: 'base.t', durationString: 'base.d', frequencyString: '440' });
  check(['startTime', 'duration', 'frequency'].every((k) => n.hasExpression(k)), 'D1 a note: all three expressions are kept (before: none, an empty note)');
  check(noteKind(new Note(2, { frequencyString: '(3/2) * base.f' })) === 'reference', 'D2 a reference from frequencyString alone');
  check(noteKind(new Note(3, { frequencyString: 'base.f', startTimeString: 'base.t' })) === 'reference-from', 'D3 a key change from frequencyString and startTimeString');
  const both = new Note(4, { frequency: 'base.f', frequencyString: '(5/4) * base.f' });
  check(both.getExpressionSource('frequency').replace(/\s/g, '') === '(5/4)*base.f', 'D4 with both keys the *String source still wins');
}

console.log(`\n${failures ? `${failures} failure(s).` : 'All note-kind checks passed.'}`);
process.exit(failures ? 1 : 0);
