import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module } from '../src/module.js';
import { buildModuleFromSelection } from '../src/utils/copy-selection.js';
import { equals, isApprox, isRational } from '../src/value/exact.js';

const base = { startTime: '0', frequency: '330', duration: '1' };
const note = (id, frequency, startTime = 'base.t') => ({
  id, frequency, startTime, duration: 'base.d',
});
const pitch = (module, id) => Number(module.getNoteById(id).getVariable('frequency'));
async function copy(baseNote, notes, ids) {
  const source = await Module.loadFromJSON({ baseNote, notes, instrumentRule: 'start-time' });
  const data = buildModuleFromSelection(source, ids);
  const reopened = await Module.loadFromJSON(JSON.parse(JSON.stringify(data)));
  return { source, data, reopened };
}

test('a BaseNote anchored outside the group reopens at the source pitch', async () => {
  // The omitted ID 1 is reused by the copy. A stale reference would now read
  // the first copied note, which reads the BaseNote back.
  const { data, reopened } = await copy({ ...base, frequency: '[1].f' }, [
    note(1, '330'), note(21, 'base.f'), note(22, 'base.f * 2'),
  ], [21, 22]);
  assert.equal(data.baseNote.frequency, '330');
  assert.deepEqual([0, 1, 2].map(id => pitch(reopened, id)), [330, 330, 660]);
  reopened.baseNote.setVariable('frequencyString', '350');
  assert.deepEqual([1, 2].map(id => pitch(reopened, id)), [350, 700]);
});

test('spaced internal references keep following their renumbered note', async () => {
  const { data, reopened } = await copy(base, [
    note(21, '330'),
    note(22, '[ 21 ].f + [\t21\t].f # [99] is a comment', '[ 21 ].t + [ 21 ].d'),
  ], [22, 21]);
  assert.deepEqual([1, 2].map(id => pitch(reopened, id)), [330, 660]);
  assert.match(data.notes[1].frequency, /# \[99\] is a comment$/);
  reopened.getNoteById(1).setVariable('frequencyString', '350');
  reopened.getNoteById(1).setVariable('durationString', '2');
  assert.equal(pitch(reopened, 2), 700);
  assert.equal(Number(reopened.getNoteById(2).getVariable('startTime')), 2);
});

test('a BaseNote can follow a copied note across copy and ordered file export', async () => {
  const { reopened } = await copy({ ...base, frequency: '[ 21 ].f' }, [
    note(21, '330'), note(22, 'base.f * 2'),
    { id: 23, startTime: '1', duration: 'base.d * 4', measure: true },
  ], [21, 22, 23]);
  // Save Module sorts the bar first, moving the BaseNote's pitch reference again.
  const saved = await Module.loadFromJSON(JSON.parse(await reopened.exportOrderedModule()));
  assert.equal(saved.getNoteById(1).properties.measure, true);
  assert.deepEqual([0, 2, 3].map(id => pitch(saved, id)), [330, 330, 660]);
  saved.getNoteById(2).setVariable('frequencyString', '350');
  assert.deepEqual([0, 2, 3].map(id => pitch(saved, id)), [350, 350, 700]);
});

test('an indirect dependency on an omitted note cannot create a cycle at base.f', async () => {
  const { reopened } = await copy({ ...base, frequency: '[ 21 ].f' }, [
    note(20, '330'), note(21, '[ 20 ].f'), note(22, 'base.f * 2'),
  ], [21, 22]);
  assert.deepEqual([0, 1, 2].map(id => pitch(reopened, id)), [330, 330, 660]);
});

test('external values retain symbolic pitch, approximate time and interpretation', async () => {
  const { source, reopened } = await copy({
    ...base, frequency: '[20].f', duration: '[20].d', amplitude: '[20].a',
  }, [
    { ...note(20, '330 * 2^(1/12)'), duration: '~0.61', amplitude: '(3/4)' },
    note(21, 'base.f'), note(22, 'base.f * 2'),
  ], [21, 22]);
  for (const key of ['frequency', 'duration', 'amplitude']) {
    assert.ok(equals(source.baseNote.getExactVariable(key), reopened.baseNote.getExactVariable(key)), key);
  }
  assert.ok(!isRational(reopened.baseNote.getExactVariable('frequency')));
  assert.ok(isApprox(reopened.baseNote.getExactVariable('duration')));
});

test('a pitch derived from a start keeps its value when the copy starts at zero', async () => {
  const { reopened } = await copy({ ...base, frequency: '[21].t * 110' }, [
    note(21, 'base.f', '3'), note(22, 'base.f * 2', '4'),
  ], [21, 22]);
  assert.equal(Number(reopened.getNoteById(1).getVariable('startTime')), 0);
  assert.deepEqual([0, 1, 2].map(id => pitch(reopened, id)), [330, 330, 660]);
});

test('rebasing a nonlinear onset and cross-property time reads preserves their links', async () => {
  const { data, reopened } = await copy(base, [
    note(15, '440', '3'),
    { ...note(16, '[15].t * 110', '2 * [ # a bracket comment\n 15 ].t # double'), duration: '[15].t' },
    note(17, '[16].f', '[16].t + [16].d'),
  ], [15, 16, 17]);
  const value = (id, key) => Number(reopened.getNoteById(id).getVariable(key));
  assert.deepEqual(['startTime', 'duration', 'frequency'].map(key => value(2, key)), [3, 3, 330]);
  assert.equal(value(3, 'startTime'), 6);
  assert.equal(data.notes[2].startTime, '[2].t + [2].d');
  assert.match(data.notes[1].startTime, /# a bracket comment\n 1 \]/);
  reopened.getNoteById(1).setVariable('startTimeString', '1');
  assert.deepEqual(['startTime', 'duration', 'frequency'].map(key => value(2, key)), [5, 4, 440]);
  assert.equal(value(3, 'startTime'), 9);
  assert.equal(value(3, 'frequency'), 440);
});

test('a start computed from an internal duration also rebases and remains editable', async () => {
  const { reopened } = await copy({ ...base, startTime: '2' }, [
    { ...note(21, 'base.t * 100', '3'), duration: '4' },
    note(22, '[21].f', '[21].d'),
  ], [21, 22]);
  const second = reopened.getNoteById(2);
  assert.equal(pitch(reopened, 1), 200);
  assert.equal(Number(second.getVariable('startTime')), 1);
  reopened.getNoteById(1).setVariable('durationString', '5');
  assert.equal(Number(second.getVariable('startTime')), 2);
});

test('exact external fields survive when division by a symbolic anchor would approximate', async () => {
  const sum = '1 + 2^(1/2)';
  const { source, reopened } = await copy({
    ...base, frequency: sum, amplitude: sum, duration: sum,
  }, [
    { ...note(20, '440', '4'), duration: '3', amplitude: '(1/2)' },
    note(21, 'base.f', '1'),
    { ...note(22, '[20].f', '[20].t'), duration: '[20].d', amplitude: '[20].a' },
  ], [21, 22]);
  const original = source.getNoteById(22);
  const result = reopened.getNoteById(2);
  for (const key of ['frequency', 'amplitude', 'duration']) {
    assert.ok(equals(original.getExactVariable(key), result.getExactVariable(key)), key);
  }
  assert.ok(isRational(result.getExactVariable('startTime')));
  assert.equal(Number(result.getVariable('startTime')), 3);
});

test('a base-time onset plus an internal duration stays relative to the new origin', async () => {
  const { reopened } = await copy(base, [
    { ...note(21, '440', '3'), duration: '4' },
    note(22, '[21].f', 'base.t + [21].d'),
  ], [21, 22]);
  assert.equal(Number(reopened.getNoteById(2).getVariable('startTime')), 1);
  reopened.getNoteById(1).setVariable('durationString', '7');
  assert.equal(Number(reopened.getNoteById(2).getVariable('startTime')), 4);
});

test('copying pitch references without timed notes preserves their shape and pitch links', async () => {
  const { data, reopened } = await copy({ ...base, startTime: '3' }, [
    { id: 21, frequency: 'base.t * 110' }, { id: 22, frequency: '[21].f * 2' },
  ], [22, 21]);
  assert.ok(data.notes.every(row => row.startTime === undefined && row.duration === undefined));
  assert.deepEqual([1, 2].map(id => pitch(reopened, id)), [330, 660]);
  reopened.getNoteById(1).setVariable('frequencyString', '350');
  assert.equal(pitch(reopened, 2), 700);
});

test('an approximate origin does not turn an exact pitch derived from time approximate', async () => {
  const { reopened } = await copy(base, [
    note(1, '220', '~1.5'), note(2, '330', '2'), note(3, '[2].t * 220', '4'),
  ], [1, 2, 3]);
  const result = reopened.getNoteById(3).getExactVariable('frequency');
  assert.ok(isRational(result));
  assert.equal(Number(result), 440);
});

test('a copy beginning at zero can move without changing a pitch derived from time', async () => {
  const { reopened } = await copy(base, [
    note(20, '330', '0'), note(21, '330', '3'), note(22, '[21].t * 110', '2 * [21].t'),
  ], [20, 21, 22]);
  reopened.baseNote.setVariable('startTimeString', '5');
  assert.equal(Number(reopened.getNoteById(3).getVariable('startTime')), 11);
  assert.equal(pitch(reopened, 3), 330);
});
