#!/usr/bin/env node
/**
 * Generate public-domain melodies (relational) + reorganize scale systems
 * (ROADMAP Phase 6.4b).
 *
 * MELODIES are relational: every note frequency is a just-intonation scale
 * degree times base.f, and timing is measured from base.t in beats. So the whole
 * tune transposes when the base changes and RE-ROOTS onto the target when dropped
 * on a note (base.f -> [target].f, base.t -> [target].t). Imports onto note AND base.
 *
 * SCALE SYSTEMS: the equal-temperament / non-octave scales (TET-12/19/31, BP-13,
 * Mixed-Base) move out of "melodies" into their own section, plus a Tesla 9-EDO
 * scale. The redundant rational-approximation "12.json" is dropped.
 *
 * Usage:  node scripts/gen-melodies.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modulesDir = join(root, 'public', 'modules');
const melodiesDir = join(modulesDir, 'melodies');
const scalesDir = join(modulesDir, 'scale-systems');
const libraryPath = join(modulesDir, 'library.json');

// ---- BigInt fraction helpers ----
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a || 1n; };
const F = (n, d = 1) => { n = BigInt(n); d = BigInt(d); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const mul = (a, b) => F(a.n * b.n, a.d * b.d);
const pow2 = (k) => (k >= 0 ? F(2n ** BigInt(k), 1) : F(1, 2n ** BigInt(-k)));

// ---- just-intonation scale degrees (relative to tonic) ----
const DEG = {
  '1': [1, 1], '2': [9, 8], '3': [5, 4], '4': [4, 3], '5': [3, 2], '6': [5, 3], '7': [15, 8],
  'b2': [16, 15], 'b3': [6, 5], '#4': [45, 32], 'b5': [64, 45], 'b6': [8, 5], 'b7': [9, 5], '#5': [25, 16], '#7': [15, 8],
};

// token like "3", "5_", "b3", "1^", "7__" -> reduced fraction ratio-from-base
function tokenRatio(tok) {
  const m = /^([#b]?\d+)([\^_]*)$/.exec(tok);
  if (!m) throw new Error('bad degree token: ' + tok);
  const deg = m[1];
  const octChars = m[2];
  const oct = (octChars.match(/\^/g) || []).length - (octChars.match(/_/g) || []).length;
  if (!DEG[deg]) throw new Error('unknown degree: ' + deg);
  return mul(F(DEG[deg][0], DEG[deg][1]), pow2(oct));
}

const freqExpr = (ratio) => (ratio.n === 1n && ratio.d === 1n) ? 'base.f' : `(${ratio.n}/${ratio.d}) * base.f`;
const beatMul = (bn, bd) => (bn === bd) ? 'beat(base)' : `beat(base) * (${bn}/${bd})`;

// melody note colour by scale-degree pitch (subtle rainbow, cohesive teal-ish)
const DEG_COLOR = {
  '1': 'rgba(128,128,128,0.75)', '2': 'rgba(90,170,120,0.75)', '3': 'rgba(60,190,110,0.75)',
  '4': 'rgba(230,150,40,0.75)', '5': 'rgba(210,70,70,0.75)', '6': 'rgba(80,160,180,0.75)', '7': 'rgba(150,90,210,0.75)',
};
const noteColor = (tok) => { const d = tok.replace(/[\^_#b]/g, ''); return DEG_COLOR[d] || 'rgba(47,179,160,0.75)'; };

// build a relational melody module from [token, beats] pairs (beats may be fractional)
function buildMelody(seq, baseNote) {
  const notes = [];
  let cum = F(0);
  seq.forEach(([tok, beats], i) => {
    const b = typeof beats === 'number' ? F(Math.round(beats * 12), 12) : F(beats[0], beats[1]);
    const ratio = tokenRatio(tok);
    const startExpr = (cum.n === 0n) ? 'base.t' : `base.t + beat(base) * (${cum.n}/${cum.d})`;
    notes.push({
      id: i + 1,
      startTime: startExpr,
      duration: beatMul(b.n, b.d),
      frequency: freqExpr(ratio),
      color: noteColor(tok),
    });
    cum = F(cum.n * b.d + b.n * cum.d, cum.d * b.d);
  });
  return { baseNote: { ...baseNote }, notes };
}

const MEL_BASE = { frequency: '263', startTime: '0', tempo: '120', beatsPerMeasure: '4' };
const WALTZ_BASE = { frequency: '263', startTime: '0', tempo: '150', beatsPerMeasure: '3' };

// [token, beats] — beats in quarter-note units (fractional ok)
const MELODIES = [
  {
    file: 'ode-to-joy.json', name: 'Ode to Joy', base: MEL_BASE,
    tags: ['beethoven', 'classical', 'major', 'public-domain'],
    seq: [['3',1],['3',1],['4',1],['5',1], ['5',1],['4',1],['3',1],['2',1], ['1',1],['1',1],['2',1],['3',1], ['3',1.5],['2',0.5],['2',2]],
  },
  {
    file: 'twinkle.json', name: 'Twinkle Twinkle', base: MEL_BASE,
    tags: ['nursery', 'major', 'public-domain'],
    seq: [['1',1],['1',1],['5',1],['5',1],['6',1],['6',1],['5',2], ['4',1],['4',1],['3',1],['3',1],['2',1],['2',1],['1',2]],
  },
  {
    file: 'frere-jacques.json', name: 'Frère Jacques', base: MEL_BASE,
    tags: ['canon', 'round', 'nursery', 'major', 'public-domain'],
    seq: [
      ['1',1],['2',1],['3',1],['1',1], ['1',1],['2',1],['3',1],['1',1],
      ['3',1],['4',1],['5',2], ['3',1],['4',1],['5',2],
      ['5',0.5],['6',0.5],['5',0.5],['4',0.5],['3',1],['1',1], ['5',0.5],['6',0.5],['5',0.5],['4',0.5],['3',1],['1',1],
      ['1',1],['5_',1],['1',2], ['1',1],['5_',1],['1',2],
    ],
  },
  {
    file: 'amazing-grace.json', name: 'Amazing Grace', base: WALTZ_BASE,
    tags: ['hymn', 'pentatonic', 'major', 'public-domain'],
    seq: [['5_',1], ['1',2],['3',0.5],['1',0.5], ['3',2],['2',1], ['1',3], ['3',2],['3',1], ['5',3], ['5',2],['3',1], ['1',2],['3',0.5],['1',0.5], ['3',2],['2',1], ['1',3]],
  },
  {
    file: 'greensleeves.json', name: 'Greensleeves', base: WALTZ_BASE,
    tags: ['renaissance', 'dorian', 'minor', 'public-domain'],
    // corrected per melody-verify workflow: ascending G#-A-B-C turn + half-cadence to low E
    seq: [['1',1],['b3',2],['4',1],['5',1.5],['6',0.5],['5',1],['4',2],['2',1],['7_',1.5],['1',0.5],['2',1],['b3',2],['1',1],['1',1.5],['7_',0.5],['5_',1]],
  },
  {
    file: 'bach-minuet.json', name: 'Bach Minuet in G', base: WALTZ_BASE,
    tags: ['bach', 'baroque', 'classical', 'major', 'public-domain'],
    seq: [['5',2],['1',1],['2',1],['3',1],['4',1], ['5',2],['1',1],['1',2],['1',1], ['6',2],['4',1],['5',1],['6',1],['7',1], ['1^',2],['1',1],['1',2],['1',1]],
  },
  {
    file: 'scarborough-fair.json', name: 'Scarborough Fair', base: WALTZ_BASE,
    tags: ['folk', 'dorian', 'minor', 'public-domain'],
    seq: [['1',2],['1',1], ['5',2],['5',1], ['6',1],['5',1],['4',1], ['b3',2],['1',1], ['2',2],['1',1], ['b7_',2],['4_',1], ['5_',3], ['5_',3]],
  },
];

// ================= write melodies =================
if (!existsSync(melodiesDir)) mkdirSync(melodiesDir, { recursive: true });
const melItems = [];
const melWanted = new Set();
for (const m of MELODIES) {
  writeFileSync(join(melodiesDir, m.file), JSON.stringify(buildMelody(m.seq, m.base), null, 2) + '\n');
  melWanted.add(m.file);
  melItems.push({ file: `melodies/${m.file}`, name: m.name, family: 'melody', tags: m.tags });
}

// ================= scale systems =================
if (!existsSync(scalesDir)) mkdirSync(scalesDir, { recursive: true });
// Move existing scale files out of melodies/ into scale-systems/.
const SCALE_MOVES = ['TET-12.json', 'TET-19.json', 'TET-31.json', 'BP-13.json', 'Mixed-Base.json'];
for (const f of SCALE_MOVES) {
  const src = join(melodiesDir, f);
  const dst = join(scalesDir, f);
  if (existsSync(src)) { copyFileSync(src, dst); unlinkSync(src); console.log('moved scale ->', f); }
}

// A relational scale from fixed ratios-over-base (each note "(n/d)*base.f",
// played sequentially). Transposes with base and re-roots onto a drop target.
function ratioScale(ratios, color, base) {
  const notes = ratios.map(([n, d], i) => ({
    id: i + 1,
    startTime: i === 0 ? 'base.t' : `base.t + beat(base) * ${i}`,
    duration: 'beat(base)',
    frequency: (n === 1 && d === 1) ? 'base.f' : `(${n}/${d}) * base.f`,
    color,
  }));
  return { baseNote: { ...base }, notes };
}
// Tesla's 9-note base-3 scale (cybercyril.com): odd harmonics 9,11,13,15,17,19,21,23,25
// over the 9th harmonic — i.e. 1, 11/9, 13/9, 5/3, 17/9, 19/9, 7/3, 23/9, 25/9. Base 3 (9=3^2),
// honoring 3-6-9; ascends ~1.77 octaves (not octave-repeating).
const TESLA = [[1, 1], [11, 9], [13, 9], [5, 3], [17, 9], [19, 9], [7, 3], [23, 9], [25, 9]];
writeFileSync(
  join(scalesDir, 'tesla-9.json'),
  JSON.stringify(ratioScale(TESLA, 'rgba(53,196,215,0.75)', { frequency: '263', startTime: '0', tempo: '160', beatsPerMeasure: '4' }), null, 2) + '\n'
);

const scaleItems = [
  { file: 'scale-systems/TET-12.json', name: '12-TET', family: 'scale', tags: ['equal', '12', 'chromatic'] },
  { file: 'scale-systems/TET-19.json', name: '19-TET', family: 'scale', tags: ['equal', '19', 'microtonal'] },
  { file: 'scale-systems/TET-31.json', name: '31-TET', family: 'scale', tags: ['equal', '31', 'microtonal'] },
  { file: 'scale-systems/BP-13.json', name: 'Bohlen–Pierce', family: 'scale', tags: ['bohlen-pierce', '13', 'tritave', 'base-3'] },
  { file: 'scale-systems/tesla-9.json', name: 'Tesla 9', family: 'scale', tags: ['tesla', 'base-3', '3-6-9', 'odd-harmonics', '9-note'] },
  { file: 'scale-systems/Mixed-Base.json', name: 'Mixed-Base', family: 'scale', tags: ['mixed', 'experimental'] },
];
const scaleWanted = new Set(scaleItems.map((s) => s.file.split('/').pop()));

// ================= clean up melodies dir (unship test/test3, V7-I/V-I, 12) =================
const REMOVE_FROM_MELODIES = ['test.json', 'test3.json', 'V7-I.json', 'V-I.json', '12.json'];
for (const f of readdirSync(melodiesDir)) {
  if (f === 'index.json' || !f.endsWith('.json')) continue;
  if (!melWanted.has(f)) { unlinkSync(join(melodiesDir, f)); console.log('unshipped from melodies:', f); }
}
writeFileSync(join(melodiesDir, 'index.json'), JSON.stringify([...melWanted], null, 2) + '\n');
writeFileSync(join(scalesDir, 'index.json'), JSON.stringify([...scaleWanted], null, 2) + '\n');

// ================= patch library.json =================
const lib = JSON.parse(readFileSync(libraryPath, 'utf8'));
const byId = Object.fromEntries(lib.sections.map((s) => [s.id, s]));
byId['melodies'] = { id: 'melodies', label: 'Melodies', items: melItems };
byId['scale-systems'] = { id: 'scale-systems', label: 'Scale Systems', items: scaleItems };
const order = ['intervals', 'chords', 'progressions', 'melodies', 'scale-systems', 'custom'];
const seen = new Set();
lib.sections = [];
for (const id of order) if (byId[id]) { lib.sections.push(byId[id]); seen.add(id); }
for (const [id, s] of Object.entries(byId)) if (!seen.has(id)) lib.sections.push(s);
writeFileSync(libraryPath, JSON.stringify(lib, null, 2) + '\n');

console.log(`\nGenerated ${melItems.length} melodies, ${scaleItems.length} scale systems.`);
console.log('Melodies:', melItems.map((m) => m.name).join(', '));
console.log('Scales:', scaleItems.map((s) => s.name).join(', '));
