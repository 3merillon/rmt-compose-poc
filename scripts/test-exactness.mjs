#!/usr/bin/env node
/**
 * Arbitrary-precision exactness test.
 *
 * Proves that exact rational arithmetic survives any depth of module tree:
 *
 *   A. 200-note chain, each frequency `[prev].f * (3/2)` — the tail note must
 *      evaluate to EXACTLY base.f * 3^200 / 2^200 (compared against native
 *      BigInt, ~96-digit numerator), and the exactness must survive the full
 *      round-trip: compile → evaluate → decompile → module save → load →
 *      re-evaluate.
 *   B. A single huge literal constant (the same ~96-digit fraction written as
 *      a `(N/D)` literal) — parse → LOAD_CONST_BIG emit → decode → evaluate →
 *      decompile must all preserve every digit.
 *
 * On fraction.js 4.x (double-backed n/d) this test MUST fail — doubles go
 * inexact past 2^53, around note 33 of the chain. After the BigInt migration
 * it must pass. Run via `node scripts/test-exactness.mjs`.
 */

const { Module } = await import('../src/module.js');
const { decompileToDSL } = await import('../src/dsl/index.js');

const DEPTH = 200;

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; };

// Expected tail frequency: 440 * 3^200 / 2^200, fully reduced.
const BASE_F = 440n;
let expN = BASE_F * 3n ** BigInt(DEPTH);
let expD = 2n ** BigInt(DEPTH);
{ const g = gcd(expN, expD); expN /= g; expD /= g; }

/** Convert a Fraction field (Number in 4.x, BigInt in 5.x) to BigInt, or null if it cannot be exact. */
function fieldToBigInt(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  return null; // unsafe double (or NaN/∞) — cannot represent the exact value
}

function assertExact(frac, wantN, wantD, label) {
  if (!frac) { fail(`${label}: no value`); return; }
  const n = fieldToBigInt(frac.n);
  const d = fieldToBigInt(frac.d);
  const s = frac.s == null ? 1n : BigInt(frac.s);
  if (n === null || d === null) {
    fail(`${label}: n/d are unsafe doubles (n=${frac.n}, d=${frac.d}) — precision already lost`);
    return;
  }
  if (s * n !== wantN || d !== wantD) {
    const show = (x) => { const t = x.toString(); return t.length > 40 ? `${t.slice(0, 18)}…${t.slice(-18)} (${t.length} digits)` : t; };
    fail(`${label}: got ${show(s * n)}/${show(d)}, want ${show(wantN)}/${show(wantD)}`);
    return;
  }
  ok(`${label}: exact (${wantN.toString().length}-digit numerator)`);
}

function buildChainJSON(depth) {
  const notes = [];
  for (let k = 1; k <= depth; k++) {
    notes.push({
      id: k,
      startTime: k === 1 ? 'base.t' : `[${k - 1}].t + beat(base) / 4`,
      duration: 'beat(base)',
      frequency: k === 1 ? 'base.f * (3/2)' : `[${k - 1}].f * (3/2)`,
    });
  }
  return { baseNote: { frequency: '440', startTime: '0', tempo: '60', beatsPerMeasure: '4' }, notes };
}

console.log(`Exactness: ${DEPTH}-note (3/2) chain vs native BigInt\n`);

// --- A1: compile → evaluate ---------------------------------------------------
const mod = await Module.loadFromJSON(buildChainJSON(DEPTH));
mod.evaluateModule();
assertExact(mod.getNoteById(DEPTH).getVariable('frequency'), expN, expD, `A1 evaluate: [${DEPTH}].f`);

// --- A2: decompile every frequency expression and recompile into a new module -
const rebuilt = buildChainJSON(DEPTH);
for (const n of rebuilt.notes) {
  const expr = mod.getNoteById(n.id).getExpression('frequency');
  const dsl = decompileToDSL(expr);
  if (typeof dsl !== 'string' || !dsl.length) { fail(`A2 decompile: note ${n.id} decompiled to ${JSON.stringify(dsl)}`); break; }
  n.frequency = dsl;
}
const mod2 = await Module.loadFromJSON(rebuilt);
mod2.evaluateModule();
assertExact(mod2.getNoteById(DEPTH).getVariable('frequency'), expN, expD, 'A2 decompile→recompile→evaluate');

// --- A3: module save (JSON round-trip) → load → re-evaluate -------------------
let saved;
try {
  saved = JSON.stringify(mod.createModuleJSON());
} catch (e) {
  fail(`A3 save: JSON.stringify threw: ${e.message}`);
}
if (saved) {
  const mod3 = await Module.loadFromJSON(JSON.parse(saved));
  mod3.evaluateModule();
  assertExact(mod3.getNoteById(DEPTH).getVariable('frequency'), expN, expD, 'A3 save→load→re-evaluate');
}

// --- B: huge literal constant through the constant-encoding path --------------
console.log(`\nExactness: huge literal constant (LOAD_CONST_BIG path)\n`);
const litN = expN; // ~96 digits
const litD = expD;
const litMod = await Module.loadFromJSON({
  baseNote: { frequency: '1', startTime: '0', tempo: '60', beatsPerMeasure: '4' },
  notes: [{ id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: `(${litN}/${litD}) * base.f` }],
});
litMod.evaluateModule();
assertExact(litMod.getNoteById(1).getVariable('frequency'), litN, litD, 'B1 literal parse→emit→decode→evaluate');

const litBack = decompileToDSL(litMod.getNoteById(1).getExpression('frequency'));
if (litBack && litBack.includes(litN.toString()) && litBack.includes(litD.toString())) {
  ok('B2 decompile reproduces every digit');
} else {
  const shown = typeof litBack === 'string' ? `${litBack.slice(0, 60)}…` : JSON.stringify(litBack);
  fail(`B2 decompile lost digits: ${shown}`);
}

console.log(`\n${failures ? `${failures} failure(s).` : 'All exactness checks passed.'}`);
process.exit(failures ? 1 : 0);
