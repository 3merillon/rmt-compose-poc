import assert from 'node:assert/strict';
import { InstanceRanges } from '../src/renderer/webgl2/instance-ranges.ts';
import { validateSettings } from '../src/settings/settings-schema.ts';
import { MAX_MODULE_NOTES, DEFAULT_DETAIL_CUTOFF } from '../src/limits.ts';

// Renderer dependencies initialize the audio singleton at import time.
const inert: () => void = new Proxy(function () {}, {
  get: (_, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : inert,
  apply: () => inert, construct: () => inert, set: () => true,
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: inert, OfflineAudioContext: inert } });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const { RendererAdapter } = await import('../src/renderer/webgl2/renderer.ts');

const prefs = (appearance: unknown) => validateSettings({ appearance }).appearance;
assert.equal(prefs({}).detailCutoff, DEFAULT_DETAIL_CUTOFF);
assert.equal(prefs({ detailCutoff: 2.5 }).detailCutoff, DEFAULT_DETAIL_CUTOFF);
assert.equal(prefs({ detailCutoff: MAX_MODULE_NOTES + 3 }).detailCutoff, MAX_MODULE_NOTES);
assert.equal(prefs({ detailCutoff: 17, neverReduceDetail: true }).detailCutoff, 17);
assert.equal(prefs({ neverReduceDetail: true }).neverReduceDetail, true);

const renderer = new RendererAdapter({ note: { detailCutoff: 2 } });
renderer.matrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
renderer.instanceCount = 640;
renderer.posSize = new Float32Array(renderer.instanceCount * 4);
for (let i = 0; i < renderer.instanceCount; i++) {
  renderer.posSize.set([i % 2 ? 200 : 0, i % 2 ? 0 : 200, 20, 15], i * 4);
}
renderer.posSize.set([0, 0, 15, 15, 1, 1, 15, 15, 100, 1, 15, 15]);
renderer._rangeIndex = new InstanceRanges(renderer.posSize);
const details = () => {
  renderer._updateVisibleInstances(100, 100);
  return renderer._detailRanges;
};
assert.deepEqual(details(), [0, 2], 'Exactly the cutoff remains detailed, excluding offscreen and edge-touching notes');
renderer.canvasOffset.x = 1;
assert.deepEqual(details(), [], 'Panning one pixel over the threshold immediately reduces detail');
renderer._noteIdToIndex = new Map([[3, 2]]);
renderer._hoveredNoteId = 3;
assert.deepEqual(details(), [2, 3], 'Hovered note remains detailed in a cached crowded frame');
renderer.setConfig({ note: { detailCutoff: Infinity } });
assert.deepEqual(details(), [0, 3], 'Never restores all fitting controls immediately');
renderer.setConfig({ note: { detailCutoff: 2 } });
renderer._rangeIndex = null;
renderer.instanceCount = 3;
renderer.canvasOffset.x = 0;
assert.deepEqual(details(), [0, 2], 'A small score supports cutoffs below the spatial-index size');
renderer._dragActive = true;
renderer._dragFlags = new Float32Array([0, 0, 1]);
renderer._dragOffsetX = -10;
renderer._dragEpoch++;
assert.deepEqual(details(), [2, 3], 'A dragged note entering the viewport counts toward the cutoff');
// Tiny bodies use the regular control layout in every non-crowded view.
renderer._dragActive = false;
renderer.instanceCount = 640;
renderer.posSize.set([0, 0, 2, 1, 1, 1, 1, 2]);
renderer._posEpoch++;
renderer._rangeIndex = new InstanceRanges(renderer.posSize);
assert.deepEqual(details(), [0, 2], 'Regular control layout at the cutoff also receives tiny bodies');
renderer.setConfig({ note: { detailCutoff: Infinity } });
assert.deepEqual(details(), [0, 2], 'Never passes tiny bodies through to normal control layout');

// Guard the first slot beyond the answer: a crowded viewport need only inspect
// cutoff + 1 overlapping rectangles, even when every note in the score is visible.
renderer.instanceCount = MAX_MODULE_NOTES;
renderer._rangeIndex = null;
renderer._hoveredNoteId = null;
renderer.setConfig({ note: { detailCutoff: 2 } });
renderer.posSize = new Proxy(new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]), {
  get(array, index) {
    assert.ok(Number(index) < array.length, 'crowded viewport scanned beyond cutoff + 1');
    return array[Number(index)];
  },
});
assert.deepEqual(details(), []);
console.log('Visible-note cutoff and settings checks passed.');

// A renderer without shader drag offsets uses the CPU preview for both a note
// and the measure that follows its start. The preview must leave the score intact.
const { Workspace } = await import('../src/renderer/webgl2/workspace.ts');
const { Module } = await import('../src/module.ts');
const { mock } = await import('node:test');
const score = await Module.loadFromJSON({
  baseNote: { startTime: '0', duration: '1', frequency: '440' },
  notes: [
    { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' },
    { id: 2, startTime: '[1].t + base.d', duration: 'base.d', measure: true },
  ]
});
const fakeContainer = Object.assign(new EventTarget(), {
  style: {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
});
const workspace = new Workspace();
const initStub = mock.method(RendererAdapter.prototype, 'init', () => true);
try {
  // Only event registration and container bounds are used by these input handlers.
  assert.ok(workspace.init(fakeContainer as unknown as HTMLElement));
  workspace._module = score;
  const legacy = workspace.renderer;
  assert.ok(legacy);
  Object.defineProperty(legacy, 'setDragOffsetPreview', { value: undefined });
  workspace._interaction = {
    active: true, type: 'move', noteId: 1, region: 'body', direction: null, pointerId: 1,
    startClient: { x: 0, y: 0 }, lastClient: { x: 0, y: 0 },
    startWorldX: 0, startWorldRightX: 200, pointerOffsetWorld: 0,
    origStartSec: 0, origDurationSec: 1, lastPreview: { startSec: 0, durationSec: 1 },
    cachedDependents: new Set([2]), baselineStartSec: new Map([[1, 0], [2, 1]]),
  };
  const movement = Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 100, clientY: 0 });
  workspace._updateInteraction(movement as PointerEvent);
  assert.equal(workspace._interaction.lastPreview.startSec, 0.5);
  assert.equal(legacy._measurePreview?.[2], 1.5);
  assert.equal(score.getNoteById(2)?.getVariable('startTime')?.valueOf(), 1);
  console.log('Dependent measure CPU drag preview passed.');
} finally {
  workspace.destroy();
  initStub.mock.restore();
}
