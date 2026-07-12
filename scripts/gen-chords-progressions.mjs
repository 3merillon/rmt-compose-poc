#!/usr/bin/env node
/**
 * Generate chords + progressions + cadences (ROADMAP Phase 6.4).
 *
 * THE SUBTREE RULE (RMT-native relational harmony):
 *   - Each chord is a subtree rooted at its chord ROOT note.
 *   - Chord tones reference the chord root:  frequency "(s/n) * [rootId].f".
 *   - Chord roots chain by functional intervals: the first root is expressed
 *     from base ("(r/n) * base.f"), every later root from the PREVIOUS root
 *     ("(r/n) * [prevRootId].f"). Only the first root touches base.
 *   => octave-shifting the first root retunes/transposes the whole progression,
 *      and the module imports cleanly onto both a note and the base note.
 *
 * A generation-time self-check resolves every note's exact frequency ratio
 * relative to base (BigInt fractions) and asserts the intended absolute root
 * pitches (e.g. V root = 3/2, I root = 1/1). Wrong ratio math fails the build.
 *
 * Usage:  node scripts/gen-chords-progressions.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modulesDir = join(root, 'public', 'modules');
const chordsDir = join(modulesDir, 'chords');
const progDir = join(modulesDir, 'progressions');
const libraryPath = join(modulesDir, 'library.json');

const BASE_NOTE = { frequency: '263', startTime: '0', tempo: '120', beatsPerMeasure: '4' };

// ---- BigInt fraction helpers (for the self-check) ----
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a || 1n; };
const F = (n, d = 1) => { n = BigInt(n); d = BigInt(d); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const mul = (a, b) => F(a.n * b.n, a.d * b.d);
const eqF = (a, b) => a.n === b.n && a.d === b.d;
const fstr = (a) => `${a.n}/${a.d}`;

// ---- note colour by tone ratio (relative to the chord root) ----
const TONE_COLOR = {
  '1/1': 'rgba(128,128,128,0.7)', '2/1': 'rgba(128,128,128,0.7)', '3/1': 'rgba(128,128,128,0.7)',
  '5/4': 'rgba(0,200,80,0.7)', '6/5': 'rgba(0,180,130,0.7)', '9/7': 'rgba(0,200,80,0.7)', '25/16': 'rgba(0,200,80,0.7)',
  '4/3': 'rgba(240,150,30,0.7)', '3/2': 'rgba(220,60,60,0.7)',
  '7/4': 'rgba(70,120,230,0.7)', '9/5': 'rgba(70,120,230,0.7)', '16/9': 'rgba(70,120,230,0.7)', '7/3': 'rgba(70,120,230,0.7)',
  '15/8': 'rgba(160,90,220,0.7)', '7/5': 'rgba(120,120,210,0.7)', '5/3': 'rgba(0,180,130,0.7)', '11/5': 'rgba(155,109,255,0.7)',
};
const toneColor = (nd) => TONE_COLOR[`${nd[0]}/${nd[1]}`] || 'rgba(180,180,190,0.7)';

// ---- chord shapes: ratios [num,den] relative to the chord root (first = root) ----
const SHAPES = {
  major:  [[1, 1], [5, 4], [3, 2]],
  minor:  [[1, 1], [6, 5], [3, 2]],
  majOct: [[1, 1], [5, 4], [3, 2], [2, 1]], // major triad + octave (resolution chord)
  dom7:   [[1, 1], [5, 4], [3, 2], [16, 9]], // 36:45:54:64 — 16/9 gives the canonical 64/45 dominant tritone (3rd->7th)
  harm7:  [[1, 1], [5, 4], [3, 2], [7, 4]],
  min7:   [[1, 1], [6, 5], [3, 2], [9, 5]],
  maj7:   [[1, 1], [5, 4], [3, 2], [15, 8]],
  dim:    [[1, 1], [6, 5], [7, 5]],
  aug:    [[1, 1], [5, 4], [25, 16]],
  sus4:   [[1, 1], [4, 3], [3, 2]],
  base3:  [[1, 1], [5, 3], [7, 3], [3, 1]],
  base5:  [[1, 1], [7, 5], [9, 5], [11, 5]],
};

// extended colon ratio (e.g. major -> "4:5:6") from a shape
function colonRatio(shape) {
  let lcm = 1n;
  for (const [, d] of shape) { const dd = BigInt(d); lcm = (lcm / gcd(lcm, dd)) * dd; }
  const ints = shape.map(([n, d]) => (BigInt(n) * lcm) / BigInt(d));
  let g = ints[0]; for (const x of ints) g = gcd(g, x);
  return ints.map((x) => (x / g).toString()).join(':');
}

const ratioFreq = (nd, ref) => (nd[0] === 1 && nd[1] === 1) ? `${ref}.f` : `(${nd[0]}/${nd[1]}) * ${ref}.f`;
const rootFreq = (nd, ref) => (nd[0] === 1 && nd[1] === 1) ? `${ref}.f` : `(${nd[0]}/${nd[1]}) * ${ref}.f`;

/**
 * Build the notes for a sequence of chords.
 * chords: [{ shapeKey, root:[n,d], beats }] — root of chord 0 is from base,
 *         roots of later chords are from the previous root.
 * Returns { notes, rootRatios } (rootRatios = absolute ratio-from-base per chord).
 */
function buildChords(chords) {
  const notes = [];
  let id = 1;
  let prevRootId = null;
  let prevRootRatio = F(1);
  const rootRatios = [];
  chords.forEach((ch, ci) => {
    const shape = SHAPES[ch.shapeKey];
    const beats = ch.beats;
    const rootId = id++;
    const rootRatio = ci === 0 ? F(ch.root[0], ch.root[1]) : mul(F(ch.root[0], ch.root[1]), prevRootRatio);
    rootRatios.push(rootRatio);

    // root note
    const rootRef = ci === 0 ? 'base' : `[${prevRootId}]`;
    const startExpr = ci === 0 ? 'base.t' : `[${prevRootId}].t + beat(base) * ${chords[ci - 1].beats}`;
    notes.push({
      id: rootId,
      startTime: startExpr,
      duration: `beat(base) * ${beats}`,
      frequency: rootFreq(ch.root, rootRef),
      color: 'rgba(128,128,128,0.7)',
    });

    // chord tones (skip the root shape[0])
    for (let k = 1; k < shape.length; k++) {
      const toneId = id++;
      notes.push({
        id: toneId,
        startTime: `[${rootId}].t`,
        duration: `beat(base) * ${beats}`,
        frequency: ratioFreq(shape[k], `[${rootId}]`),
        color: toneColor(shape[k]),
      });
    }
    prevRootId = rootId;
    prevRootRatio = rootRatio;
  });
  return { notes, rootRatios };
}

function moduleFrom(notes) {
  return { baseNote: { ...BASE_NOTE }, notes };
}

function writeModule(dir, file, data) {
  writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n');
}

// ============ CHORDS (standalone, root = base) ============
const CHORDS = [
  { file: 'major.json',  name: 'Major',        key: 'major',  tags: ['triad', 'major'] },
  { file: 'minor.json',  name: 'Minor',        key: 'minor',  tags: ['triad', 'minor'] },
  { file: 'dom7.json',   name: 'Dominant 7th', key: 'dom7',   tags: ['seventh', 'dominant'] },
  { file: 'harm7.json',  name: 'Harmonic 7th', key: 'harm7',  tags: ['seventh', 'septimal', 'barbershop', '4:5:6:7'] },
  { file: 'min7.json',   name: 'Minor 7th',    key: 'min7',   tags: ['seventh', 'minor'] },
  { file: 'maj7.json',   name: 'Major 7th',    key: 'maj7',   tags: ['seventh', 'major'] },
  { file: 'dim.json',    name: 'Diminished',   key: 'dim',    tags: ['triad', 'diminished', 'septimal'] },
  { file: 'aug.json',    name: 'Augmented',    key: 'aug',    tags: ['triad', 'augmented'] },
  { file: 'sus4.json',   name: 'Sus4',         key: 'sus4',   tags: ['suspended', 'sus4'] },
  { file: 'base3.json',  name: 'Base-3 chord', key: 'base3',  tags: ['rmt', 'harmonic', '3:5:7:9', 'odd'] },
  { file: 'base5.json',  name: 'Base-5 chord', key: 'base5',  tags: ['rmt', 'harmonic', '5:7:9:11', 'odd'] },
];

if (!existsSync(chordsDir)) mkdirSync(chordsDir, { recursive: true });
const chordItems = [];
const chordWanted = new Set();
for (const c of CHORDS) {
  const { notes, rootRatios } = buildChords([{ shapeKey: c.key, root: [1, 1], beats: 2 }]);
  // self-check: standalone chord root must be exactly base (1/1)
  if (!eqF(rootRatios[0], F(1))) throw new Error(`${c.file}: root ratio ${fstr(rootRatios[0])} != 1/1`);
  writeModule(chordsDir, c.file, moduleFrom(notes));
  chordWanted.add(c.file);
  chordItems.push({ file: `chords/${c.file}`, name: c.name, ratio: colonRatio(SHAPES[c.key]), family: 'chord', tags: c.tags });
}

// ============ PROGRESSIONS + CADENCES (root chains) ============
// Each chord: { shapeKey, root:[n,d] (from base for i=0, else from prev root), beats }
// `expectRoots` lists the intended ABSOLUTE root ratios for the self-check.
const PROGS = [
  {
    file: 'V7-I.json', name: 'V7 – I', tags: ['progression', 'dominant', 'authentic'],
    chords: [
      { shapeKey: 'harm7', root: [3, 2], beats: 2 },   // V7 (root a fifth above tonic)
      { shapeKey: 'majOct', root: [2, 3], beats: 2 },  // I  (back to tonic)
    ],
    expectRoots: ['3/2', '1/1'],
  },
  {
    file: 'ii-V-I.json', name: 'ii – V – I', tags: ['progression', 'cadential'],
    chords: [
      { shapeKey: 'minor', root: [9, 8], beats: 2 },   // ii  (supertonic minor)
      { shapeKey: 'harm7', root: [4, 3], beats: 2 },   // V7  (up a fourth -> 3/2)
      { shapeKey: 'majOct', root: [2, 3], beats: 4 },  // I   (down a fifth -> 1/1)
    ],
    expectRoots: ['9/8', '3/2', '1/1'],
  },
  {
    file: 'I-IV-V-I.json', name: 'I – IV – V – I', tags: ['progression', 'primary'],
    chords: [
      { shapeKey: 'major', root: [1, 1], beats: 2 },   // I
      { shapeKey: 'major', root: [4, 3], beats: 2 },   // IV (up a fourth)
      { shapeKey: 'major', root: [9, 8], beats: 2 },   // V  (up a tone -> 3/2)
      { shapeKey: 'majOct', root: [2, 3], beats: 2 },  // I  (down a fifth -> 1/1)
    ],
    expectRoots: ['1/1', '4/3', '3/2', '1/1'],
  },
  {
    file: 'I-vi-IV-V.json', name: 'I – vi – IV – V', tags: ['progression', 'doo-wop', '50s'],
    chords: [
      { shapeKey: 'major', root: [1, 1], beats: 2 },   // I
      { shapeKey: 'minor', root: [5, 3], beats: 2 },   // vi (up a major sixth)
      { shapeKey: 'major', root: [4, 5], beats: 2 },   // IV (down a major third -> 4/3)
      { shapeKey: 'major', root: [9, 8], beats: 2 },   // V  (up a tone -> 3/2)
    ],
    expectRoots: ['1/1', '5/3', '4/3', '3/2'],
  },
  {
    file: 'authentic-cadence.json', name: 'Authentic (V–I)', tags: ['cadence', 'authentic', 'perfect'],
    chords: [
      { shapeKey: 'major', root: [3, 2], beats: 2 },   // V
      { shapeKey: 'majOct', root: [2, 3], beats: 2 },  // I
    ],
    expectRoots: ['3/2', '1/1'],
  },
  {
    file: 'plagal-cadence.json', name: 'Plagal (IV–I)', tags: ['cadence', 'plagal', 'amen'],
    chords: [
      { shapeKey: 'major', root: [4, 3], beats: 2 },   // IV
      { shapeKey: 'majOct', root: [3, 4], beats: 2 },  // I (down a fourth -> 1/1)
    ],
    expectRoots: ['4/3', '1/1'],
  },
  {
    file: 'deceptive-cadence.json', name: 'Deceptive (V–vi)', tags: ['cadence', 'deceptive', 'interrupted'],
    chords: [
      { shapeKey: 'major', root: [3, 2], beats: 2 },   // V
      { shapeKey: 'minor', root: [10, 9], beats: 2 },  // vi (up a minor tone -> 5/3)
    ],
    expectRoots: ['3/2', '5/3'],
  },
  {
    file: 'half-cadence.json', name: 'Half (I–V)', tags: ['cadence', 'half', 'imperfect'],
    chords: [
      { shapeKey: 'major', root: [1, 1], beats: 2 },   // I
      { shapeKey: 'major', root: [3, 2], beats: 2 },   // V (ends on the dominant)
    ],
    expectRoots: ['1/1', '3/2'],
  },
];

if (!existsSync(progDir)) mkdirSync(progDir, { recursive: true });
const progItems = [];
const progWanted = new Set();
for (const p of PROGS) {
  const { notes, rootRatios } = buildChords(p.chords);
  // self-check: absolute root pitches must match the intended functional roots
  const got = rootRatios.map(fstr);
  if (got.length !== p.expectRoots.length || got.some((g, i) => g !== p.expectRoots[i])) {
    throw new Error(`${p.file}: root motion ${got.join(' ')} != expected ${p.expectRoots.join(' ')}`);
  }
  // self-check: only the first root may reference base
  const baseRefs = notes.filter((n) => /\bbase\.f\b/.test(n.frequency));
  if (baseRefs.length !== 1 || baseRefs[0].id !== 1) {
    throw new Error(`${p.file}: expected exactly one base.f frequency ref on note 1, got ${baseRefs.map((n) => n.id).join(',')}`);
  }
  writeModule(progDir, p.file, moduleFrom(notes));
  progWanted.add(p.file);
  const isCadence = p.tags.includes('cadence');
  progItems.push({ file: `progressions/${p.file}`, name: p.name, family: isCadence ? 'cadence' : 'progression', tags: p.tags });
}

// ---- remove orphaned old chord/progression files, regen legacy index.json ----
for (const f of readdirSync(chordsDir)) {
  if (f === 'index.json' || !f.endsWith('.json')) continue;
  if (!chordWanted.has(f)) { unlinkSync(join(chordsDir, f)); console.log('removed orphan chord file:', f); }
}
writeFileSync(join(chordsDir, 'index.json'), JSON.stringify([...chordWanted], null, 2) + '\n');
writeFileSync(join(progDir, 'index.json'), JSON.stringify([...progWanted], null, 2) + '\n');

// ---- patch library.json chords + progressions sections ----
const lib = JSON.parse(readFileSync(libraryPath, 'utf8'));
const setSection = (id, label, items) => {
  let sec = lib.sections.find((s) => s.id === id);
  if (!sec) { sec = { id, label, items: [] }; }
  sec.label = label; sec.items = items;
  return sec;
};
const chordsSec = setSection('chords', 'Chords', chordItems);
const progSec = setSection('progressions', 'Progressions', progItems);
// Rebuild section order: intervals, chords, progressions, then the rest (melodies, custom, ...)
const byId = Object.fromEntries(lib.sections.map((s) => [s.id, s]));
byId['chords'] = chordsSec; byId['progressions'] = progSec;
const order = ['intervals', 'chords', 'progressions', 'melodies', 'scale-systems', 'custom'];
const seen = new Set();
const newSections = [];
for (const id of order) { if (byId[id]) { newSections.push(byId[id]); seen.add(id); } }
for (const s of lib.sections) { if (!seen.has(s.id)) { newSections.push(s); seen.add(s.id); } }
lib.sections = newSections;
writeFileSync(libraryPath, JSON.stringify(lib, null, 2) + '\n');

console.log(`\nGenerated ${chordItems.length} chords, ${progItems.length} progressions/cadences.`);
console.log('Chords:', chordItems.map((c) => `${c.name}(${c.ratio})`).join(', '));
console.log('Progressions:', progItems.map((p) => p.name).join(', '));
