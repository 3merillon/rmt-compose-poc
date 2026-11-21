#!/usr/bin/env node
/**
 * Phase L: rewrite the chord, progression and melody modules of the library so
 * they read as the relations a composer means (one-off; kept as the record of
 * how the library was rewritten). What each module plays does not change:
 * scripts/test-library.mjs compares it with what it played before.
 *
 *  - A single chord: the BaseNote is the root. Every tone hangs from base.f; the
 *    other tones start with the root tone and last as long as it does.
 *  - A progression: each chord's root is a key change (a frequency and a start,
 *    no sound), a ratio of the previous root, starting when the previous chord
 *    ends. The root tone and the other tones hang from their root.
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
import type { ExactValue } from '../src/value/exact.ts';
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'public', 'modules');
const dry = process.argv.includes('--dry-run');
const { Module } = await import('../src/module.ts');
const X = await import('../src/value/exact.ts');

const ROOT_COLOR = 'rgba(150,150,150,0.5)';
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
  const old = m.notes;
  const byId = new Map(old.map((n) => [n.id, n]));
  // The chord roots: the first note, then each note that starts after a root
  const roots: number[] = [];
  for (const n of old) {
    if (n === old[0]) { roots.push(n.id); continue; }
    const mm = /^\[(\d+)\]\.t \+ /.exec(n.startTime || '');
    if (mm && roots.includes(Number(mm[1]))) roots.push(n.id);
  }
  const already = old.some((n) => !n.duration); // written with key changes already (a sample)
  if (already) { console.log(`${f}: already written with key changes`); continue; }
  const notes: typeof m.notes = [];
  let id = 0;
  const keyOf = new Map<number, number>(), toneOf = new Map<number, number>();
  const ref = (s: string) => s.replace(/\[(\d+)\]\.(f|t)\b/g, (x, k, p) => (keyOf.has(Number(k)) ? `[${keyOf.get(Number(k))}].${p}` : x));
  for (const r of roots) {
    const R = byId.get(r);
    assert(R?.frequency);
    const k = ++id, t = ++id;
    keyOf.set(r, k); toneOf.set(r, t);
    // the root's start: base.t, or the previous chord's end when it begins there
    let start = R.startTime;
    const mm = /^\[(\d+)\]\.t \+ (.+)$/.exec(start);
    if (mm) {
      const prev = byId.get(Number(mm[1]));
      assert(prev);
      start = (mm[2] === prev.duration) ? `[${toneOf.get(prev.id)}].t + [${toneOf.get(prev.id)}].d` : `[${keyOf.get(prev.id)}].t + ${mm[2]}`;
    }
    notes.push({ id: k, startTime: start, frequency: tidy(ref(R.frequency)), color: ROOT_COLOR });
    notes.push({ id: t, startTime: `[${k}].t`, duration: tidy(R.duration), frequency: `[${k}].f`, ...(R.color ? { color: R.color } : {}), ...(R.instrument ? { instrument: R.instrument } : {}) });
    for (const n of old) {
      if (roots.includes(n.id) || n.startTime !== `[${r}].t`) continue;
      assert(n.frequency);
      notes.push({
        ...n,
        id: ++id,
        startTime: `[${t}].t`,
        duration: n.duration === R.duration ? `[${t}].d` : tidy(n.duration),
        frequency: tidy(n.frequency.replace(new RegExp(`\\[${r}\\]\\.f`, 'g'), `[${k}].f`)),
      });
    }
  }
  if (notes.filter((n) => n.duration).length !== old.length) throw new Error(`${f}: ${old.length} notes in, ${notes.filter((n) => n.duration).length} sounding out`);
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
  if (!X.isRational(v)) throw new Error('a melody time that is not rational');
  return v.d === 1n ? `${v.s * v.n}` : `(${v.s * v.n}/${v.d})`;
}
