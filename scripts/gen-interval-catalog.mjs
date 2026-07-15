#!/usr/bin/env node
/**
 * Generate the interval catalog for the module library.
 *
 * Emits one single-note module per interval into public/modules/intervals/,
 * (re)writes the legacy intervals/index.json array, and patches the `intervals`
 * section of public/modules/library.json with computed cents + metadata.
 *
 * Each interval module is a subtree of the base note:
 *   note 1: frequency = "(N/D) * base.f", startTime base.t, duration beat(base).
 * So it imports cleanly onto BOTH a note and the base note (the invariant).
 *
 * Cents are computed from the ratio (1200·log2(N/D)) so they are always exact.
 *
 * Usage:  node scripts/gen-interval-catalog.mjs
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const intervalsDir = join(root, 'public', 'modules', 'intervals');
const libraryPath = join(root, 'public', 'modules', 'library.json');

const BASE_NOTE = { frequency: '263', startTime: '0', tempo: '60', beatsPerMeasure: '4' };

// Family → tile hue (matches icon-factory) as an rgba note colour.
const FAMILY_COLOR = {
  '3-limit': 'rgba(242,167,27,0.7)',
  '5-limit': 'rgba(63,185,80,0.7)',
  '7-limit': 'rgba(74,144,226,0.7)',
  'higher': 'rgba(155,109,255,0.7)',
  'comma': 'rgba(154,160,166,0.7)',
};

// [ n, d, name, tags... ]  — grouped by family.
const CATALOG = {
  '3-limit': [
    [1, 1, 'Unison', ['P1', 'unison', 'prime']],
    [9, 8, 'Major 2nd', ['M2', 'whole tone', 'pythagorean']],
    [32, 27, 'Pythagorean minor 3rd', ['m3', 'pythagorean']],
    [81, 64, 'Pythagorean major 3rd', ['M3', 'ditone', 'pythagorean']],
    [4, 3, 'Perfect 4th', ['P4', 'perfect']],
    [729, 512, 'Pythagorean tritone', ['tritone', 'A4', 'pythagorean']],
    [3, 2, 'Perfect 5th', ['P5', 'perfect', 'fifth']],
    [27, 16, 'Pythagorean major 6th', ['M6', 'pythagorean']],
    [16, 9, 'Pythagorean minor 7th', ['m7', 'pythagorean']],
    [243, 128, 'Pythagorean major 7th', ['M7', 'pythagorean']],
    [2, 1, 'Octave', ['P8', 'octave']],
  ],
  '5-limit': [
    [16, 15, 'Just minor 2nd', ['m2', 'diatonic semitone']],
    [10, 9, 'Minor whole tone', ['M2', 'minor tone']],
    [6, 5, 'Just minor 3rd', ['m3', 'minor third']],
    [5, 4, 'Just major 3rd', ['M3', 'major third']],
    [45, 32, 'Just augmented 4th', ['A4', 'tritone']],
    [64, 45, 'Just diminished 5th', ['d5', 'tritone']],
    [8, 5, 'Just minor 6th', ['m6']],
    [5, 3, 'Just major 6th', ['M6']],
    [9, 5, 'Just minor 7th', ['m7']],
    [15, 8, 'Just major 7th', ['M7']],
  ],
  '7-limit': [
    [8, 7, 'Septimal whole tone', ['supermajor 2nd', 'septimal']],
    [7, 6, 'Septimal minor 3rd', ['subminor 3rd', 'septimal']],
    [9, 7, 'Septimal major 3rd', ['supermajor 3rd', 'septimal']],
    [7, 5, 'Septimal tritone', ['lesser tritone', 'septimal']],
    [10, 7, 'Septimal tritone (wide)', ['greater tritone', 'septimal']],
    [14, 9, 'Septimal minor 6th', ['subminor 6th', 'septimal']],
    [32, 21, 'Septimal narrow 5th', ['septimal', 'subfifth']],
    [7, 4, 'Harmonic 7th', ['septimal minor 7th', 'subminor 7th', 'septimal']],
    [12, 7, 'Septimal major 6th', ['supermajor 6th', 'septimal']],
    [63, 32, 'Septimal major 7th', ['septimal']],
  ],
  'higher': [
    [11, 8, 'Undecimal tritone', ['11-limit', '11th harmonic', 'semiaugmented 4th']],
    [11, 9, 'Undecimal neutral 3rd', ['11-limit', 'neutral third']],
    [11, 6, 'Undecimal neutral 7th', ['11-limit', 'neutral seventh']],
    [13, 8, 'Tridecimal neutral 6th', ['13-limit', '13th harmonic']],
    [13, 9, 'Tridecimal diminished 5th', ['13-limit', 'tridecimal']],
    [13, 12, 'Tridecimal neutral 2nd', ['13-limit', 'neutral second']],
    [17, 16, '17th harmonic', ['17-limit', 'minor second']],
    [19, 16, '19th harmonic', ['19-limit', 'minor third']],
    [23, 16, '23rd harmonic', ['23-limit']],
  ],
  'comma': [
    [81, 80, 'Syntonic comma', ['comma', 'didymus']],
    [64, 63, 'Septimal comma', ['comma', 'archytas']],
    [128, 125, 'Enharmonic diesis', ['diesis', 'lesser diesis']],
    [531441, 524288, 'Pythagorean comma', ['comma', 'ditonic']],
    [2048, 2025, 'Diaschisma', ['comma']],
    [32805, 32768, 'Schisma', ['comma']],
  ],
};

const centsOf = (n, d) => 1200 * Math.log2(n / d);
const round3 = (x) => Math.round(x * 1000) / 1000;
const slug = (n, d) => `${n}-${d}`;

function moduleJson(n, d, color) {
  return {
    baseNote: { ...BASE_NOTE },
    notes: [
      {
        id: 1,
        startTime: 'base.t',
        duration: 'beat(base)',
        frequency: `(${n}/${d}) * base.f`,
        color,
      },
    ],
  };
}

// --- Emit module files + build manifest items ---
const items = [];
const wanted = new Set();
for (const [family, list] of Object.entries(CATALOG)) {
  const color = FAMILY_COLOR[family];
  for (const [n, d, name, tags] of list) {
    const file = `intervals/${slug(n, d)}.json`;
    wanted.add(`${slug(n, d)}.json`);
    writeFileSync(join(root, 'public', 'modules', file), JSON.stringify(moduleJson(n, d, color), null, 2) + '\n');
    items.push({
      file,
      name,
      ratio: `${n}/${d}`,
      cents: round3(centsOf(n, d)),
      family,
      tags: [...tags],
    });
  }
}

// --- Remove orphaned old-named interval files (keep index.json + generated set) ---
for (const f of readdirSync(intervalsDir)) {
  if (f === 'index.json') continue;
  if (!f.endsWith('.json')) continue;
  if (!wanted.has(f)) {
    unlinkSync(join(intervalsDir, f));
    console.log('removed orphan interval file:', f);
  }
}

// --- Regenerate legacy intervals/index.json (array fallback) ---
writeFileSync(
  join(intervalsDir, 'index.json'),
  JSON.stringify([...wanted], null, 2) + '\n'
);

// --- Patch the `intervals` section of library.json ---
const lib = JSON.parse(readFileSync(libraryPath, 'utf8'));
const sec = lib.sections.find((s) => s.id === 'intervals');
if (!sec) throw new Error('library.json has no intervals section');
sec.label = 'Intervals';
sec.items = items;
writeFileSync(libraryPath, JSON.stringify(lib, null, 2) + '\n');

console.log(`\nGenerated ${items.length} interval modules across ${Object.keys(CATALOG).length} families.`);
for (const [fam, list] of Object.entries(CATALOG)) console.log(`  ${fam}: ${list.length}`);
