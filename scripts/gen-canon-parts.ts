// The startup score keeps the transcription's IDs. The library numbers each
// file in score order. Run with --check to verify the published copies.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Module } from '../src/module.ts';
import { readLibraryScore } from './library-score.ts';
import { equals, isRational } from '../src/value/exact.ts';
import type { ScoreFields } from '../src/model-types.ts';

const directory = new URL('../public/modules/', import.meta.url);
const score = readLibraryScore(new URL('defaultModule.json', directory));
const original = new Map(score.notes.map(note => [note.id, note]));
const module = await Module.loadFromJSON(score);
module.evaluateModule();
const pitch = (id: number) => {
  const frequency = module.getNoteById(id)?.getExactVariable('frequency');
  assert(isRational(frequency), `Expected a rational canon pitch at ${id}`);
  return frequency;
};
type CanonNote = (typeof score.notes)[number];
const pitchParent = (note: CanonNote | undefined) => {
  assert(note?.frequency, "Missing pitch anchor in the canon");
  return Number(note.frequency.match(/\[(\d+)\]\.f/)?.[1] ?? 0);
};

// Check every chain before projecting it, including paths through another voice.
for (const note of score.notes.filter(note => note.frequency)) {
  const seen = new Set([note.id]);
  let parent = pitchParent(note);
  while (parent) {
    assert(!seen.has(parent), `frequency cycle through note ${parent}`);
    seen.add(parent);
    parent = pitchParent(original.get(parent));
  }
}

async function publish(name: string, notes: CanonNote[], baseNote: ScoreFields) {
  const ids = new Map(notes.map((note, index) => [note.id, index + 1]));
  const remap = (expression: string) => expression.replace(/\[(\d+)\]/g, (_, old) => {
    assert(ids.has(+old), `missing reference to ${old} in ${name}`);
    return `[${ids.get(+old)}]`;
  });
  const projected = notes.map(note => {
    const copy = { ...note, id: ids.get(note.id)! };
    if (note.frequency) {
      // A standalone part can still refer forward or backward within its own
      // line. Skip intervening pitches that belonged to the omitted voices.
      let parent = pitchParent(note);
      if (parent && !ids.has(parent)) {
        while (parent && !ids.has(parent)) parent = pitchParent(original.get(parent));
        const ratio = pitch(note.id).div(pitch(parent));
        const anchor = parent ? `[${parent}].f` : 'base.f';
        copy.frequency = ratio.equals(1) ? anchor : `(${ratio.toFraction()}) * ${anchor}`;
      }
      copy.frequency = remap(copy.frequency ?? note.frequency);
    }
    copy.startTime = remap(copy.startTime);
    assert(copy.duration, `Missing duration for canon note ${note.id}`);
    copy.duration = remap(copy.duration);
    return copy;
  });

  const data = { baseNote, notes: projected };
  const loaded = await Module.loadFromJSON(data);
  loaded.evaluateModule();
  for (const note of notes) {
    const copy = loaded.getNoteById(ids.get(note.id)!);
    const source = module.getNoteById(note.id);
    assert(copy && source);
    for (const key of (note.frequency ? ['startTime', 'duration', 'frequency'] as const : ['startTime', 'duration'] as const)) {
      assert(equals(copy.getExactVariable(key), source.getExactVariable(key)),
        `${name}: note ${note.id} changed its ${key}`);
    }
  }
  const file = new URL(`custom/${name}.json`, directory);
  if (process.argv.includes('--check')) {
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), data, `regenerate ${name}`);
  } else {
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  }
}

const { repeat, ...partBase } = score.baseNote;
await publish('canon', score.notes, score.baseNote);
await publish('canon base', score.notes.filter(note => note.color === 'rgba(0,0,255,0.5)'), partBase);
await publish('canon melody', score.notes.filter(note => note.color === 'rgba(255,0,0,0.5)'), partBase);
