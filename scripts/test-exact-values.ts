#!/usr/bin/env node
/**
 * Exact values (npm test): the three kinds of src/value/exact.js, and the
 * evaluator computing with them (design/phase-c-values.md).
 *
 * 1. The algebra: canonical forms, closure, the fallbacks to approximate.
 * 2. The evaluator: twelve steps of 2^(1/12) are exactly 2, dependents read
 *    exact values, TET modules stay irrational, a division by zero is approximate.
 */
import { DSLError } from '../src/dsl/errors.ts';
import { required } from './fixtures/required.ts';
import type { ExactValue } from '../src/value/exact.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const X = await import('../src/value/exact.ts');
const { Module } = await import('../src/module.ts');

let failures = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const check = (cond: unknown, m: string) => (cond ? ok(m) : bad(m));
const F = (n: number | bigint, d: number | bigint = 1) => new Fraction(n, d);
const txt = X.toText;
const quiet = console.info; console.info = () => {};

console.log('\nExact values: the algebra');
{
  const s = X.pow(F(2), F(1, 12));
  check(X.kindOf(s) === 'irrational' && txt(s) === '2^(1/12)', `2^(1/12) is irrational: ${txt(s)}`);
  let v: ExactValue = F(1);
  for (let i = 0; i < 12; i++) v = X.mul(v, s);
  check(X.isRational(v) && v.equals(2), `twelve of them multiply to exactly 2: ${txt(v)}`);
  check(txt(X.pow(F(2), F(13, 12))) === '2 * 2^(1/12)', `2^(13/12) = ${txt(X.pow(F(2), F(13, 12)))}`);
  check(txt(X.pow(F(4), F(1, 2))) === '2', '4^(1/2) = 2');
  check(txt(X.pow(F(6), F(1, 2))) === '2^(1/2) * 3^(1/2)', `6^(1/2) = ${txt(X.pow(F(6), F(1, 2)))}`);
  check(X.equals(X.mul(X.pow(F(2), F(1, 2)), X.pow(F(3), F(1, 2))), X.pow(F(6), F(1, 2))), '2^(1/2) × 3^(1/2) equals 6^(1/2)');
  const r2 = X.pow(F(2), F(1, 2));
  const squaredRoot = X.pow(r2, F(2));
  check(X.isRational(squaredRoot) && squaredRoot.equals(2), '(2^(1/2))^2 = 2');
  check(txt(X.pow(F(9, 4), F(1, 2))) === '(3/2)', '(9/4)^(1/2) = 3/2');
  check(txt(X.pow(F(3, 2), F(1, 2))) === '(1/2) * 2^(1/2) * 3^(1/2)', `(3/2)^(1/2) = ${txt(X.pow(F(3, 2), F(1, 2)))}`);
  check(txt(X.pow(F(-8), F(1, 3))) === '-2', '(-8)^(1/3) = -2');
  check(X.isApprox(X.pow(F(-2), F(1, 2))), '(-2)^(1/2) is not real: approximate');
  const sum = X.add(X.mul(F(3), r2), r2);
  check(txt(sum) === '4 * 2^(1/2)', `3·2^(1/2) + 2^(1/2) = ${txt(sum)}`);
  const s2 = X.add(F(1), r2);
  check(X.isIrrational(s2) && s2.terms.length === 2, `1 + 2^(1/2) stays exact: ${txt(s2)}`);
  const difference = X.sub(s2, r2);
  check(X.isRational(difference) && difference.equals(1), '(1 + 2^(1/2)) − 2^(1/2) = 1');
  const sq = X.mul(s2, s2);
  check(txt(sq) === '3 + 2 * 2^(1/2)', `(1 + 2^(1/2))² = ${txt(sq)}`);
  check(X.isApprox(X.div(F(1), s2)), '1 / (1 + 2^(1/2)) is approximate (÷ by a sum)');
  check(X.isApprox(X.pow(s2, F(1, 2))), '(1 + 2^(1/2))^(1/2) is approximate');
  check(X.equals(X.div(r2, r2), F(1)), '2^(1/2) / 2^(1/2) = 1');
  check(txt(X.div(F(1), r2)) === '(1/2) * 2^(1/2)', `1 / 2^(1/2) = ${txt(X.div(F(1), r2))}`);
  let many: ExactValue = F(0);
  const primes: number[] = [];
  for (let n = 3; primes.length < 70; n += 2) if (primes.every((q) => n % q)) primes.push(n);
  for (const q of primes) many = X.add(many, X.pow(F(q), F(1, 2)));
  check(X.isApprox(many), 'a sum of more than 64 distinct radicals is approximate');
  const a = new X.Approx(F(26163, 100));
  check(X.isApprox(X.mul(a, F(2))) && X.isApprox(X.add(a, r2)), 'anything computed from an approximate value is approximate');
  check(!X.equals(a, F(26163, 100)), 'an approximate value never equals an exact one');
  // Ordering, including a difference far below a double
  check(X.compare(r2, F(141421356, 100000000)) > 0 && X.compare(r2, F(141421357, 100000000)) < 0, 'ordering of 2^(1/2) between 1.41421356 and 1.41421357');
  const near = X.add(r2, F(1, 10n ** 30n));
  check(X.compare(near, r2) > 0 && X.compare(r2, near) < 0, 'ordering of values 1e-30 apart (refined beyond doubles)');
  check(Math.abs(X.toNumber(X.pow(F(2), F(7, 12))) - Math.pow(2, 7 / 12)) < 1e-15, 'toNumber of 2^(7/12)');
  check(X.shadow(r2) instanceof Fraction && X.toNumber(X.shadow(r2)) === Math.SQRT2, 'shadow is the nearest double as a Fraction');
}

// DUP must copy a rational out of the pool and preserve exact symbolic and
// approximate operands. Exercise the bytecode instruction directly.
{
  const { OP } = await import('../src/binary-note.ts');
  const { BinaryEvaluator } = await import('../src/binary-evaluator.ts');
  const { compileDSL } = await import('../src/dsl/index.ts');
  for (const [input, expectedKind, expectedText] of [
    ['2', 'rational', '4'],
    ['2^(1/12)', 'irrational', '2^(1/6)'],
    ['~2', 'approximate', '~4'],
  ]) {
    const expression = compileDSL(input);
    expression.writeByte(OP.DUP);
    expression.writeByte(OP.MUL);
    const evaluator = new BinaryEvaluator(null);
    const fraction = evaluator.evaluate(expression);
    const result = evaluator._lastExact ?? fraction;
    check(X.kindOf(result) === expectedKind && X.toText(result) === expectedText,
      `DUP and multiply preserves ${input} as ${expectedText}`);
  }
}

// Transport end includes silent measure bars with any supported time value.
for (const startTime of ['2^(1/12)', '~1']) {
  const m = await Module.loadFromJSON({ baseNote: {}, notes: [
    { id: 1, measure: true, startTime, duration: 'base.d' },
  ] });
  const bar = required(m.getNoteById(1));
  const end = X.toNumber(X.add(required(bar.getExactVariable('startTime')), required(bar.getExactVariable('duration'))));
  check(m.getModuleEndTime() === end, 'measure end with start ' + startTime);
}

console.log('\nExact values: the evaluator');
{
  const notes = [{ id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f' }];
  for (let i = 2; i <= 13; i++) notes.push({ id: i, startTime: `[${i - 1}].t + [${i - 1}].d`, duration: 'base.d', frequency: `[${i - 1}].f * 2^(1/12)` });
  notes.push({ id: 14, startTime: 'base.t', duration: 'base.d', frequency: '[8].f * (3/2)' });
  notes.push({ id: 15, startTime: 'base.t', duration: 'base.d / 0', frequency: 'base.f' });
  notes.push({ id: 16, startTime: 'base.t', duration: '[2].d * 2^(1/2) + [2].d * 2^(1/2)', frequency: 'base.f' });
  const mod = await Module.loadFromJSON({ baseNote: { frequency: '263', startTime: '0', duration: '1/2' }, notes });
  const quietWarn = console.warn; console.warn = () => {};
  const ev = mod.evaluateModule();
  console.warn = quietWarn;
  const rec13 = required(ev.get(13));
  check(required(rec13.frequency).equals(526) && (!rec13.exact?.frequency), `twelve chained 2^(1/12) above 263 give exactly 526 (record ${required(rec13.frequency).toFraction()})`);
  const e8 = required(ev.get(8)).exact?.frequency;
  check(X.kindOf(e8) === 'irrational' && txt(e8) === '263 * 2^(7/12)', `note 8 is ${txt(e8)}`);
  const e14 = required(ev.get(14)).exact?.frequency;
  check(txt(e14) === '(789/2) * 2^(7/12)', `a dependent reads the exact value: ${txt(e14)}`);
  check((required(ev.get(8)).corruptionFlags & 0x04) && !(required(ev.get(14)).corruptionFlags & 0x04), 'the flag is set by the note\'s own power (direct), not inherited');
  check(Math.abs(required(ev.get(8)?.frequency).valueOf() - 263 * Math.pow(2, 7 / 12)) < 1e-12, 'the record keeps a Fraction shadow next to the exact value');
  const d15 = required(ev.get(15));
  check(X.isApprox(d15.exact?.duration) && (d15.approxFlags & 0x02), 'a division by zero is approximate');
  const d16 = required(ev.get(16)).exact?.duration;
  check(txt(d16) === '2^(1/2)', `a sum of equal radicals stays exact: ${txt(d16)}`);
}

console.log('\nExact values: the TET modules stay exact');
for (const f of ['TET-12', 'TET-19', 'TET-31']) {
  const mod = await Module.loadFromJSON(JSON.parse(readFileSync(join(root, 'public/modules/scale-systems', f + '.json'), 'utf8')));
  const ev = mod.evaluateModule();
  let irr = 0, approx = 0, rat = 0;
  for (const [id, r] of ev) {
    if (id === 0 || r.frequency == null) continue;
    const k = X.kindOf(r.exact?.frequency ?? r.frequency);
    if (k === 'irrational') irr++; else if (k === 'approximate') approx++; else rat++;
  }
  check(approx === 0 && irr > 0, `${f}: ${irr} irrational pitches, ${rat} rational (octaves), none approximate`);
}

console.log('\nExact values: Evaluate to BaseNote writes the exact relation');
{
  const { frequencyExpr, startTimeExpr } = await import('../src/utils/value-expr.ts');
  for (const f of ['TET-12', 'TET-19', 'TET-31', 'BP-13', 'Mixed-Base']) {
    const data = JSON.parse(readFileSync(join(root, 'public/modules/scale-systems', f + '.json'), 'utf8'));
    const mod = await Module.loadFromJSON(data);
    mod.evaluateModule();
    const base = mod.baseNote;
    const out = JSON.parse(JSON.stringify(mod.createModuleJSON()));
    const written = [];
    for (const n of out.notes) {
      const note = required(mod.getNoteById(n.id));
      if (!note.hasExpression('frequency')) continue;
      const e = frequencyExpr(required(note.getExactVariable('frequency')), required(base.getExactVariable('frequency')));
      if (e === null) { written.push(null); continue; }
      n.frequency = e; written.push(e);
      if (note.hasExpression('startTime')) n.startTime = startTimeExpr(required(note.getExactVariable('startTime')), required(base.getExactVariable('startTime')), base.getExactVariable('duration'));
    }
    const again = await Module.loadFromJSON(out);
    again.evaluateModule();
    let same = 0, diff = 0;
    for (const n of out.notes) {
      const a = required(mod.getNoteById(n.id)), b = required(again.getNoteById(n.id));
      if (!a.hasExpression('frequency')) continue;
      if (X.equals(a.getExactVariable('frequency'), b.getExactVariable('frequency'))) same++; else diff++;
    }
    const big = written.filter((e) => e && /\d{10,}/.test(e));
    check(diff === 0 && !written.includes(null) && big.length === 0,
      `${f}: ${same} pitches rewritten from base.f, all exactly equal, no float-derived fraction (e.g. ${written.filter(Boolean).slice(-1)[0]})`);
  }
}

console.log('\nApproximations: ~');
{
  const { compileDSL, decompileToDSL } = await import('../src/dsl/index.ts');
  const { simplifyDSL } = await import('../src/dsl/simplify.ts');
  const { frequencyExpr, valueFactor } = await import('../src/utils/value-expr.ts');
  for (const [src, back] of [['~261.63', '~(26163/100)'], ['~-3', '~-3'], ['~(3/2)', '~(3/2)'], ['[1].f * ~1.4983', '[1].f * ~(14983/10000)'], ['~(-3/4) * base.f', '~(-3/4) * base.f']]) {
    const got = decompileToDSL(compileDSL(src));
    check(got === back && decompileToDSL(compileDSL(got)) === back, `${src} compiles and reads back as ${got}`);
  }
  for (const src of ['~base.f', '~(1 + 2)', '~', '~[1].f']) {
    try { compileDSL(src); bad(`${src} compiled; ~ marks a number only`); }
    catch (e) {
    if (!(e instanceof Error)) throw e;
      const message = e instanceof DSLError ? e.userMessage : e.message;
      check(/'~' marks a number/.test(message), `${src} is refused: ${(message).split(':')[0]}`); }
  }
  check(simplifyDSL('base.f * ~(3/2) * 2') === 'base.f * ~(3/2) * 2', 'the simplifier leaves an approximation alone (never folds it into an exact coefficient)');
  const { scaleDSL } = await import('../src/dsl/simplify.ts');
  for (const e of ['base.f * ~261.63', '~-1.5 * base.f', '~(-3/7) * base.f']) {
    const up = scaleDSL(e, 2, 1), back = scaleDSL(up, 1, 2);
    check(back === e && compileDSL(up) && /^2 \* /.test(up), `arrows on "${e}": "${up}" and back to "${back}"`);
  }

  const mod = await Module.loadFromJSON({ baseNote: { frequency: '263', startTime: '0', duration: '1/2' }, notes: [
    { id: 1, startTime: 'base.t', duration: 'base.d', frequency: 'base.f * ~1.4983' },
    { id: 2, startTime: '[1].t + [1].d', duration: 'base.d', frequency: '[1].f * (5/4)' },
    { id: 3, startTime: 'base.t', duration: 'base.d * ~0.5', frequency: 'base.f' },
  ] });
  const ev = mod.evaluateModule();
  const r1 = required(ev.get(1)), r2 = required(ev.get(2)), r3 = required(ev.get(3));
  check(X.isApprox(r1.exact?.frequency) && (r1.corruptionFlags & 0x04) && (r1.approxFlags & 0x04), '~1.4983 makes the note approximate and flags it (hatched)');
  check(X.isApprox(r2.exact?.frequency) && !(r2.corruptionFlags & 0x04) && (r2.approxFlags & 0x04) && mod.getDependencyGraph().isFrequencyTransitivelyCorrupted(2), 'a dependent is approximate too, and reported transitively');
  check(!X.equals(r1.exact?.frequency, new Fraction(263 * 14983, 10000)), '~1.4983 × 263 does not equal the exact 263 × 14983/10000');
  check(X.isApprox(r3.exact?.duration) && r3.exact.duration.frac.equals(new Fraction(1, 4)), 'an approximate duration: ~0.5 × base.d');
  const written = frequencyExpr(required(mod.getNoteById(2)!.getExactVariable('frequency')), required(mod.baseNote.getExactVariable('frequency')));
  check(written === 'base.f * ~(14983/8000)', `Evaluate to BaseNote writes the approximation with ~: ${written}`);
  check(valueFactor(new X.Approx(new Fraction(-3))) === '~-3', 'a negative approximation as a factor: ~-3');
}

console.log('\nCanvas labels: the exact relation to the BaseNote');
{
  const { noteLabel, LINE_LABEL } = await import('../src/renderer/webgl2/note-label.ts');
  const base = F(263, 4);
  const lab = (v: ExactValue) => { const l = noteLabel(v, base); if (!l) throw new Error("Expected a pitch label"); return 'approx' in l ? '≈' : l.den === LINE_LABEL ? l.num : `${l.num}/${l.den}`; };
  check(lab(X.mul(base, F(3, 2))) === '3/2', 'a pure ratio: 3/2');
  check(lab(X.mul(base, X.pow(F(2), F(7, 12)))) === '2^(7/12)', 'a tempered note: 2^(7/12), on one line');
  check(lab(X.mul(base, X.mul(F(3, 2), X.pow(F(2), F(1, 2))))) === '3/2·2^(1/2)', 'a coefficient and a power: 3/2·2^(1/2)');
  check(lab(X.mul(base, F(2))) === '2/1', 'twelve tempered steps land on the pure octave: 2/1');
  check(lab(X.mul(base, F(19683, 16384))) === '≈', '19683/16384 is too long for the label: drawn rounded, with ≈ (no longer silently)');
  check(lab(X.mul(base, F(6561, 4096))) === '6561/4096', '6561/4096 fits: exact');
  check(lab(new X.Approx(F(394, 1))) === '≈', 'an approximate note: ≈');
}

console.info = quiet;
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll exact-value checks passed');
