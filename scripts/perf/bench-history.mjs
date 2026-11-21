// Generate the voices fixture with npm run perf:gen, or pass its path here.
// node --expose-gc --max-old-space-size=8192 scripts/perf/bench-history.mjs [score.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Module } from '../../src/module.js';
import { history, moduleSnapshot } from '../../src/store/history.js';
import { eventBus } from '../../src/utils/event-bus.js';

assert(global.gc, 'Run with --expose-gc to measure retained heap.');
const path = process.argv[2] || new URL('../../public/modules/perf/voices-500000.json', import.meta.url);
const score = await Module.loadFromJSON(JSON.parse(readFileSync(path, 'utf8')));
const notes = Object.keys(score.notes).length - 1;
const edits = 20;
const hash = text => createHash('sha256').update(text).digest('hex');
const actual = () => hash(score.createModuleJSONString());
const expected = [];
let autosaveLength;
let restored;
eventBus.on('history:requestRestore', event => { restored = event; });

function capture(index) {
  const snap = moduleSnapshot(score, index > 0);
  const digest = actual();
  assert.equal(typeof snap.snapshotStr, 'string');
  assert.equal(hash(snap.snapshotStr), digest, 'captured autosave must match the live score');
  assert(!expected.includes(digest), 'edit must produce a distinct state');
  expected.push(digest);
  autosaveLength = snap.snapshotStr.length;
  const topic = index ? 'history:capture' : 'history:seedIfEmpty';
  eventBus.emit(topic, { label: index ? `Edit ${index}` : 'Initial', ...snap });
}

function restore(direction, index) {
  restored = null;
  eventBus.emit(`history:${direction}`);
  assert.equal(restored?.source, direction, `missing ${direction} to state ${index}`);
  assert(score.restoreHistoryVersion(restored.version), 'compatible expression edit must restore in place');
  assert.equal(actual(), expected[index], `${direction} live score at state ${index}`);
  assert.equal(hash(restored.version.text), expected[index], `${direction} autosave at state ${index}`);
  restored = null;
}

function heap() {
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
}

capture(0);
const seeded = heap();
for (let i = 1; i <= edits; i++) {
  const id = Math.ceil(notes * i / edits);
  score.getNoteById(id).setVariable('durationString', `base.d / ${i + 2}`);
  capture(i);
}
assert.deepEqual(history.size(), { undo: edits + 1, redo: 0 });
const captured = heap();
for (let index = edits - 1; index >= 0; index--) restore('undo', index);
assert.deepEqual(history.size(), { undo: 1, redo: edits });
const undone = heap();
for (let index = 1; index <= edits; index++) restore('redo', index);
assert.deepEqual(history.size(), { undo: edits + 1, redo: 0 });
const redone = heap();
history.clear();
const cleared = heap();
// Keep the live module, its serializer cache and its current checkpoint reachable
// across the control measurement. Only the older history versions were released.
assert.equal(actual(), expected[edits]);
console.log(JSON.stringify({
  node: process.version, notes, edits, verifiedUndos: edits, verifiedRedos: edits, autosaveLength,
  heapUsedBytes: { seeded, captured, undone, redone, cleared },
  retainedHistoryHeapBytes: redone - cleared
}, null, 2));
