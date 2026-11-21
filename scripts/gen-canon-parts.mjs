// The startup score keeps the transcription's IDs. The library numbers each
// file in score order. Run with --check to verify the published copies.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Module } from '../src/module.js';

const directory = new URL('../public/modules/', import.meta.url);
const score = JSON.parse(readFileSync(new URL('defaultModule.json', directory), 'utf8'));
const original = new Map(score.notes.map(note => [note.id, note]));
const module = await Module.loadFromJSON(score);
module.evaluateModule();
const pitch = id => module.getNoteById(id).getExactVariable('frequency');
const pitchParent = note => Number(note.frequency.match(/\[(\d+)\]\.f/)?.[1] ?? 0);

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

async function publish(name, notes, baseNote) {
  const ids = new Map(notes.map((note, index) => [note.id, index + 1]));
  const remap = expression => expression.replace(/\[(\d+)\]/g, (_, old) => {
    assert(ids.has(+old), `missing reference to ${old} in ${name}`);
    return `[${ids.get(+old)}]`;
  });
  const projected = notes.map(note => {
    const copy = { ...note, id: ids.get(note.id) };
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
      copy.frequency = remap(copy.frequency);
    }
    copy.startTime = remap(copy.startTime);
    copy.duration = remap(copy.duration);
    return copy;
  });

  const data = { baseNote, notes: projected };
  const loaded = await Module.loadFromJSON(data);
  loaded.evaluateModule();
  for (const note of notes) {
    const copy = loaded.getNoteById(ids.get(note.id));
    for (const key of note.frequency ? ['startTime', 'duration', 'frequency'] : ['startTime', 'duration']) {
      assert(copy.getExactVariable(key).equals(module.getNoteById(note.id).getExactVariable(key)),
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
