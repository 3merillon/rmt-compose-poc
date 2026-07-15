import { Module } from '../src/module.js';
import { settingsStore } from '../src/settings/settings-store.js';

// 1. DSL module round-trip -> does baseNote gain a legacy measureLength?
const dslJson = {
  baseNote: { startTime:'0', frequency:'440', tempo:'120', beatsPerMeasure:'4' },
  notes: [ { id:1, startTime:'base.t', duration:'beat(base)', frequency:'(3/2) * base.f' } ]
};
const m = await Module.loadFromJSON(dslJson);
const out = m.createModuleJSON();
console.log('ROUND-TRIP baseNote:', JSON.stringify(out.baseNote, null, 0));
