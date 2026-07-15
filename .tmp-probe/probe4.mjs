import { BinaryExpression } from '../src/binary-note.js';
import { compiler } from '../src/expression-compiler.js';
const e = new BinaryExpression();
for (let i = 1; i <= 20; i++) e.addDependency(i);
console.log('depCount', e.depCount, 'deps cap', e.dependencies.length);
try { const c = e.clone(); console.log('clone OK, depCount', c.depCount); }
catch (err) { console.log('clone THREW:', err.constructor.name, err.message); }
// realistic: an expression referencing 17 distinct notes
const expr = Array.from({length:17}, (_,i)=>`[${i+1}].f`).join(' + ');
try { const b = compiler.compile(expr); console.log('compile 17-ref expr OK, depCount', b.depCount); }
catch (err) { console.log('compile 17-ref expr THREW:', err.constructor.name, err.message); }
