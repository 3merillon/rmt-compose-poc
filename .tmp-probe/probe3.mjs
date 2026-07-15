import { Module } from '../src/module.js';
import { validateExpression } from '../src/modals/validation.js';

const m = new Module({ startTime:'0', duration:'1', frequency:'440', tempo:'60', beatsPerMeasure:'4' });
const n = m.addNote({ startTime:'base.t', duration:'beat(base)', frequency:'base.f' });
await m.evaluateModule();

for (const expr of ['2 * beat(base)', '1 + beat(base)', '60 / tempo(base)', 'beat(base) * 2', 'garbage !!']) {
  try {
    const out = validateExpression(m, n.id, expr, 'duration');
    console.log(`SAVE ${JSON.stringify(expr).padEnd(22)} -> ACCEPTED, stored as ${JSON.stringify(out)}`);
  } catch (e) {
    console.log(`SAVE ${JSON.stringify(expr).padEnd(22)} -> REJECTED: ${e.message}`);
  }
}
