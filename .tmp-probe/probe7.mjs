import { Module } from '../src/module.js';
// per-note tempo: does beat([N]) honour it and measure([N]) not?
const m = await Module.loadFromJSON({
  baseNote: { startTime:'0', frequency:'440', tempo:'100', beatsPerMeasure:'4' },
  notes: [
    { id:10, startTime:'base.t', duration:'beat(base)', frequency:'base.f', tempo:'120' },
    { id:11, startTime:'base.t', duration:'beat([10])', frequency:'base.f' },
    { id:12, startTime:'base.t', duration:'measure([10])', frequency:'base.f' },
  ]
});
await m.evaluateModule();
const v = (id,p) => Number(m.getNoteById(id).getVariable(p)?.valueOf?.() ?? NaN);
console.log('note10 tempo=120, base tempo=100, bpm=4');
console.log('  beat([10])    =', v(11,'duration'), ' (expected 60/120 = 0.5)');
console.log('  measure([10]) =', v(12,'duration'), ' (expected 4*0.5 = 2.0; base measure = 4*0.6 = 2.4)');
