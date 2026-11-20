#!/usr/bin/env node
/**
 * Repeat transposition (npm test): the exact factor of each loop pass, and a
 * module's own repeat (its BaseNote's `repeat`).
 *
 *   A. passTransposition: pass 0 as written; pass k exactly ratio^k; folded into
 *      one octave by exact comparison ([1, 2) rising, (1/2, 1] falling), so six 9/8
 *      are exactly 531441/524288 and a tempered whole tone 2^(1/6) comes home to 1
 *      after six passes.
 *   B. The BaseNote's `repeat` is kept as written and survives save and load.
 *   C. moduleRepeatRatio: `(9/8) * base.f` is exactly 9/8; `[N].f` is that note's
 *      ratio to the BaseNote; `2^(1/6) * base.f` stays irrational (exact); a
 *      module without one, or with one that does not evaluate, has none.
 *   D. The display: shownFrequency multiplies a written frequency by the pass on
 *      screen, exactly; clearing it shows the written value again.
 *
 * Run via `node scripts/test-repeat.mjs`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

const here = dirname(fileURLToPath(import.meta.url));
const { Module } = await import('../src/module.js');
const DT = await import('../src/player/display-transpose.js');
const X = await import('../src/value/exact.js');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const F = (n, d = 1) => new Fraction(n, d);
const eq = (a, b) => X.equals(a, b);

console.log('\nPass factors\n');
{
  const r = F(9, 8);
  check(eq(DT.passTransposition(r, 0, true), F(1)) && eq(DT.passTransposition(r, 1, true), F(9, 8)), 'A1 pass 0 as written, pass 1 exactly 9/8');
  check(eq(DT.passTransposition(r, 5, false), F(59049, 32768)), 'A2 pass 5 unfolded: exactly (9/8)^5');
  check(eq(DT.passTransposition(r, 6, true), F(531441, 524288)) && eq(DT.passTransposition(r, 6, false), F(531441, 262144)),
    'A3 six passes: folded exactly 531441/524288 (a Pythagorean comma), unfolded an octave and a comma');
  let inside = true;
  for (let k = 0; k <= 200; k++) { const v = DT.passTransposition(r, k, true); if (X.compare(v, F(1)) < 0 || X.compare(v, F(2)) >= 0) inside = false; }
  check(inside, 'A4 folded, every pass of 200 lies in [1, 2)');
  const down = DT.passTransposition(F(8, 9), 6, true);
  check(X.compare(down, F(1, 2)) > 0 && X.compare(down, F(1)) <= 0 && eq(down, F(524288, 531441)), 'A5 a falling 8/9 folds into (1/2, 1], exactly');
  const tempered = X.pow(F(2), F(1, 6));
  const t6 = DT.passTransposition(tempered, 6, true), t7 = DT.passTransposition(tempered, 7, true);
  check(eq(t6, F(1)) && eq(t7, tempered), 'A6 a tempered whole tone 2^(1/6) comes home exactly after six passes (folded)');
}

console.log('\nThe module\'s own repeat\n');
const canon = JSON.parse(readFileSync(join(here, '..', 'public', 'modules', 'defaultModule.json'), 'utf8'));
{
  const m = await Module.loadFromJSON({ ...canon, baseNote: { ...canon.baseNote, repeat: '(9/8) * base.f' } });
  check(m.baseNote.getVariable('repeat') === '(9/8) * base.f', 'B1 the BaseNote keeps its repeat as written');
  const saved = m.createModuleJSON();
  const again = await Module.loadFromJSON(saved);
  check(saved.baseNote.repeat === '(9/8) * base.f' && again.baseNote.getVariable('repeat') === '(9/8) * base.f', 'B2 it survives save and load');
  check(eq(DT.moduleRepeatRatio(m), F(9, 8)), 'C1 (9/8) * base.f: exactly 9/8');
  const n24 = await Module.loadFromJSON({ ...canon, baseNote: { ...canon.baseNote, repeat: '[24].f' } });
  const want24 = X.div(n24.getNoteById(24).getExactVariable('frequency'), n24.baseNote.getExactVariable('frequency'));
  check(eq(DT.moduleRepeatRatio(n24), want24), `C2 [24].f: note 24's ratio to the BaseNote (${X.toText ? X.toText(want24) : want24})`);
  const t = await Module.loadFromJSON({ ...canon, baseNote: { ...canon.baseNote, repeat: '2^(1/6) * base.f' } });
  const rt = DT.moduleRepeatRatio(t);
  check(rt && X.isIrrational(rt) && eq(rt, X.pow(F(2), F(1, 6))), 'C3 2^(1/6) * base.f: exactly 2^(1/6), irrational');
  { const { repeat: _r, ...plainBase } = canon.baseNote; check(DT.moduleRepeatRatio(await Module.loadFromJSON({ ...canon, baseNote: plainBase })) === null, 'C4 a module that sets none has none'); }
  const bad = await Module.loadFromJSON({ ...canon, baseNote: { ...canon.baseNote, repeat: '(9/8) * ' } });
  const warn = console.warn; console.warn = () => {};
  const rb = DT.moduleRepeatRatio(bad);
  console.warn = warn;
  check(rb === null, 'C5 one that does not evaluate gives none (and a warning), never a wrong key');
}

{
  const { repeatExprForRatio, setModuleRepeat } = DT;
  check(repeatExprForRatio(9, 8) === '(9/8) * base.f' && repeatExprForRatio(1, 1) === null, 'C6 the ratio editor writes (9/8) * base.f, and nothing for 1/1');
  const m = await Module.loadFromJSON(canon);
  setModuleRepeat(m, repeatExprForRatio(9, 8));
  check(eq(DT.moduleRepeatRatio(m), F(9, 8)) && m.createModuleJSON().baseNote.repeat === '(9/8) * base.f', 'C7 set from the ratio editor: the module repeats 9/8, and saves it');
  m.clearAllNotes(); setModuleRepeat(m, null);
  check(DT.moduleRepeatRatio(m) === null && m.createModuleJSON().baseNote.repeat === undefined, 'C8 Clean Slate: no repeat, nothing saved');
  const shipped = await Module.loadFromJSON(canon);
  check(eq(DT.moduleRepeatRatio(shipped), F(9, 8)), 'C9 the shipped canon loads repeating a pure whole tone higher');
}

console.log('\nThe display\n');
{
  const f = F(263);
  DT.setDisplayTransposition(6, F(531441, 524288));
  check(eq(DT.shownFrequency(f), F(263 * 531441, 524288)) && DT.getDisplayTransposition().pass === 6, 'D1 pass 6 shows 263 · 531441/524288, exactly');
  DT.clearDisplayTransposition();
  check(eq(DT.shownFrequency(f), f) && DT.getDisplayTransposition().factor === null, 'D2 cleared: the written value');
  DT.setDisplayTransposition(1, F(1));
  check(DT.getDisplayTransposition().factor === null, 'D3 a factor of 1 is no transposition');
}

console.log(failures ? `\n${failures} repeat check(s) FAILED` : '\nAll repeat checks passed.');
process.exit(failures ? 1 : 0);
