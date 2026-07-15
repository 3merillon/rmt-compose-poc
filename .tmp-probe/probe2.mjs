import { Module } from '../src/module.js';
import { isDSLSyntax } from '../src/dsl/index.js';

const cases = [
  ['2 * beat(base)',   'duration'],
  ['1 + beat(base)',   'duration'],
  ['60 / tempo(base)', 'duration'],
  ['2 * measure(base)','duration'],
  ['beat(base) * 2',   'duration'],   // control: leading helper, should work
  ['[1]f',             'frequency'],
  ['garbage !!',       'frequency'],
  ['new Fraction(5).neg()', 'frequency'],
  ['base.f / 0',       'frequency'],
];

for (const [expr, prop] of cases) {
  const m = new Module({ startTime:'0', duration:'1', frequency:'440', tempo:'60', beatsPerMeasure:'4' });
  const n = m.addNote({ startTime: 'base.t', duration: prop==='duration'?expr:'beat(base)', frequency: prop==='frequency'?expr:'base.f' });
  await m.evaluateModule();
  const v = n.getVariable(prop);
  const num = Number(v?.valueOf?.() ?? v);
  console.log(`${JSON.stringify(expr).padEnd(26)} as ${prop.padEnd(9)} isDSL=${String(isDSLSyntax(expr)).padEnd(5)} -> ${num}`);
}
