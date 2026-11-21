#!/usr/bin/env node
/**
 * Phase L: rewrite the chord, progression and melody modules of the library so
 * they read as the relations a composer means (one-off; kept as the record of
 * how the library was rewritten). What each module plays does not change:
 * scripts/test-library.mjs compares it with what it played before.
 *
 *  - A single chord: the BaseNote is the root. Every tone hangs from base.f; the
 *    other tones start with the root tone and last as long as it does.
 *  - A progression: fold the older silent key changes into the first sounding
 *    tone of each chord. Preserve the voiced octaves, chord attacks and the
 *    sequence of root-to-root pitch and timing relationships.
 *  - A melody: the BaseNote is the tonic; each note begins when the one before
 *    it ends ([p].t + [p].d), plus a rest when there is one. Pitches as written.
 *
 *   node scripts/rewrite-library.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert/strict';
import { readLibraryScore } from './library-score.ts';
import { rewriteNoteReferences } from '../src/dsl/remap-note-ids.ts';
import type { ExactValue } from '../src/value/exact.ts';
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'public', 'modules');
const dry = process.argv.includes('--dry-run');
const { Module } = await import('../src/module.ts');
const X = await import('../src/value/exact.ts');

function tidy(s: string): string;
function tidy(s: string | undefined): string | undefined;
function tidy(s: string | undefined) { return (typeof s === 'string' ? s.replace(/\((-?\d+)\/1\)/g, '$1') : s); }
const list = (sub: string) => readdirSync(join(dir, sub)).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => `${sub}/${f}`);
const read = (f: string) => readLibraryScore(join(dir, f));
const write = (f: string, m: ReturnType<typeof read>) => { if (!dry) writeFileSync(join(dir, f), JSON.stringify(m, null, 2) + '\n'); console.log(`${dry ? 'would rewrite' : 'rewrote'} ${f}`); };

// ── chords ─────────────────────────────────────────────────────────────────
for (const f of list('chords')) {
  const m = read(f);
  const [root, ...tones] = m.notes;
  if (root.frequency !== 'base.f' || root.startTime !== 'base.t') throw new Error(`${f}: the first note is not the root on the BaseNote`);
  m.notes = [
    { ...root, duration: tidy(root.duration) },
    ...tones.map((n) => {
      if (n.startTime !== `[${root.id}].t`) throw new Error(`${f} note ${n.id}: does not start with the root`);
      assert(n.frequency);
      const fr = n.frequency.replace(new RegExp(`\\[${root.id}\\]\\.f`, 'g'), 'base.f');
      return { ...n, startTime: `[${root.id}].t`, duration: n.duration === root.duration ? `[${root.id}].d` : tidy(n.duration), frequency: tidy(fr) };
    }),
  ];
  write(f, m);
}

// ── progressions ──────────────────────────────────────────────────────────
for (const f of list('progressions')) {
  const m = read(f);
  if (m.notes.every(n => n.duration && n.frequency)) {
    console.log(f + ': already uses sounding tones');
    continue;
  }
  const model = await Module.loadFromJSON(m);
  const tones = m.notes.filter(n => n.duration);
  const newIds = new Map(tones.map((n, i) => [n.id, i + 1]));
  function remapTime(source: string) {
    const mapped = rewriteNoteReferences(source, id => {
      if (id === 0) return 0;
      const replacement = newIds.get(id);
      assert(replacement !== undefined, f + ': unexpected reference to silent note ' + id);
      return replacement;
    });
    assert(mapped !== null);
    return mapped;
  }

  const notes: typeof m.notes = [];
  let root = model.baseNote;
  let rootRef = 'base';
  let key: typeof m.notes[number] | undefined;
  for (const n of m.notes) {
    if (!n.duration) {
      assert(!key && n.frequency, f + ': expected one pitched key before each chord');
      key = n;
      continue;
    }
    const note = model.getNoteById(n.id);
    const pitch = note?.getExactVariable('frequency');
    const rootPitch = root.getExactVariable('frequency');
    assert(note && pitch && rootPitch, f + ': expected a pitched chord tone');
    const ratio = X.div(pitch, rootPitch);
    const frequency = X.isRational(ratio) && ratio.equals(1)
      ? rootRef + '.f'
      : valueText(ratio) + ' * ' + rootRef + '.f';
    const id = newIds.get(n.id)!;
    let startTime: string;
    if (key) {
      assert.equal(n.startTime, '[' + key.id + '].t', f + ': expected the chord onset to read its key');
      startTime = '(' + remapTime(key.startTime) + ')';
      root = note;
      rootRef = '[' + id + ']';
      key = undefined;
    } else {
      startTime = remapTime(n.startTime);
    }
    notes.push({ ...n, id, startTime, duration: remapTime(n.duration), frequency });
  }
  assert(!key, f + ': missing sounding root after final key');
  m.notes = notes;
  write(f, m);
}

// ── melodies ──────────────────────────────────────────────────────────────
for (const f of list('melodies')) {
  const m = read(f);
  const quiet = console.info; console.info = () => {};
  const mod = await Module.loadFromJSON(m);
  mod.evaluateModule();
  console.info = quiet;
  const unit = mod.baseNote.getExactVariable('duration');
  const base0 = mod.baseNote.getExactVariable('startTime');
  assert(unit && base0);
  const timed = m.notes.map(n => {
    const note = mod.getNoteById(n.id);
    const t = note?.getExactVariable('startTime');
    const d = note?.getExactVariable('duration');
    assert(t && d, `Missing time for melody note ${n.id}`);
    return {n, t, d};
  });
  timed.sort((a, b) => X.compare(a.t, b.t) || a.n.id - b.n.id);
  let prev = null;
  for (const { n, t, d } of timed) {
    if (!prev) {
      const off = X.sub(t, base0);
      n.startTime = X.isZero(off) ? 'base.t' : `base.t + base.d * ${valueText(X.div(off, unit))}`;
    } else {
      const end = X.add(prev.t, prev.d);
      const c = X.compare(t, end);
      if (c === 0) n.startTime = `[${prev.n.id}].t + [${prev.n.id}].d`;
      else if (c > 0) n.startTime = `[${prev.n.id}].t + [${prev.n.id}].d + base.d * ${valueText(X.div(X.sub(t, end), unit))}`;
      else n.startTime = `[${prev.n.id}].t + base.d * ${valueText(X.div(X.sub(t, prev.t), unit))}`;
    }
    n.duration = tidy(n.duration);
    prev = { n, t, d };
  }
  // Pitches hang from the tonic, the BaseNote: a pitch written against a note
  // that is itself exactly base.f is written against base.f
  const isTonic = new Set(m.notes.filter((n) => n.frequency === 'base.f').map((n) => n.id));
  for (const n of m.notes) {
    if (typeof n.frequency !== 'string') continue;
    n.frequency = n.frequency.replace(/\[(\d+)\]\.f\b/g, (x, k) => (isTonic.has(Number(k)) ? 'base.f' : x));
    if (n.frequency === '1 * base.f') n.frequency = 'base.f';
  }
  m.notes = timed.map((x) => x.n);
  write(f, m);
}

function valueText(v: ExactValue) {
  if (!X.isRational(v)) throw new Error('expected an exact rational library value');
  return v.d === 1n ? `${v.s * v.n}` : `(${v.s * v.n}/${v.d})`;
}
