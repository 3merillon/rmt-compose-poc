import { compiler, decompiler } from '../src/expression-compiler.js';
import { isDSLSyntax } from '../src/dsl/index.js';
import { validateExpressionSyntax } from '../src/utils/safe-expression-validator.js';

const cases = [
  '2 * beat(base)',
  '1 + beat(base)',
  '60 / tempo(base)',
  '2 * measure(base)',
  'beat(base) * 2',
  '[1]f',
  'base.q',
  'garbage nonsense !!',
  'new Fraction(5).neg()',
  '(3/2) * base.f',
  'base.f * 2',
];

for (const c of cases) {
  const dsl = isDSLSyntax(c);
  let out, err = null;
  try {
    const b = compiler.compile(c);
    out = decompiler.decompile(b);
  } catch (e) { err = e.message; }
  let valid;
  try { valid = JSON.stringify(validateExpressionSyntax(c)); } catch (e) { valid = 'THREW: ' + e.message; }
  console.log(`INPUT ${JSON.stringify(c)}\n   isDSL=${dsl} | compile-> ${err ? 'THREW ' + err : JSON.stringify(out)} | validateExpressionSyntax=${valid}`);
}
