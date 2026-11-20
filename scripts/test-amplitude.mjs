#!/usr/bin/env node
/**
 * Amplitude — the seventh expression variable (npm test).
 *
 * `amplitude` is a relative gain: an exact fraction like every other variable,
 * default 1, inherited from the BaseNote by any note that does not define it.
 * This test pins down the contract:
 *
 *   A. Unset stays unset — a module that never mentions amplitude loads,
 *      evaluates and saves without the key appearing, and every note sounds
 *      at exactly 1 (so playback is unchanged). Checked on every shipped module.
 *   B. Inheritance and references — `base.a` scales the notes that do not
 *      define their own; `[N].a` reads what note N sounds at; `a`, `amp` and
 *      `amplitude` are the same property; a module in the retired
 *      method-chain syntax converts on load.
 *   C. Exactness — a 50-note chain of `(121/100) * [prev].a` evaluates to
 *      exactly (121/100)^50 (compared against native BigInt).
 *   D. Irrational gains raise the amplitude corruption bit (0x08) and no other.
 *   E. A BaseNote amplitude edit reaches notes that only name another note.
 *   F. Save → load round-trips, including the reindexing "Save Module" does.
 *   G. Clearing a note's amplitude puts it back on the inherited value.
 *   H. The audio boundary clamps to [0, 4]; the module keeps the exact value.
 *
 * Run via `node scripts/test-amplitude.mjs`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'public', 'modules');

const { Module } = await import('../src/module.js');
const { compiler } = await import('../src/expression-compiler.js');
const { amplitudeToGain, MAX_AMPLITUDE } = await import('../src/player/amplitude.js');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const BASE = { frequency: '440', startTime: '0', duration: '1' };
const note = (id, extra = {}) => ({
  id,
  startTime: id === 1 ? 'base.t' : `[${id - 1}].t + [${id - 1}].d`,
  duration: 'base.d',
  frequency: 'base.f',
  ...extra,
});
const load = async (baseNote, notes) => {
  const mod = await Module.loadFromJSON({ baseNote, notes });
  mod.evaluateModule();
  return mod;
};
/** What note `id` sounds at, as an 'n/d' string. */
const amp = (mod, id) => mod.findAmplitude(mod.getNoteById(id)).toFraction();

// --- A: unset stays unset -------------------------------------------------------
console.log('Amplitude: a module that never sets it is untouched\n');
{
  const lib = JSON.parse(readFileSync(join(modulesDir, 'library.json'), 'utf8'));
  const files = ['defaultModule.json', ...lib.sections.flatMap((s) => (s.items || []).map((i) => i.file))];
  let leaked = 0, notUnity = 0, notes = 0;
  for (const file of files) {
    const mod = await Module.loadFromJSON(JSON.parse(readFileSync(join(modulesDir, file), 'utf8')));
    const cache = mod.evaluateModule();
    if (/"amplitude"/.test(JSON.stringify(mod.createModuleJSON()))) leaked++;
    if (/"amplitude"/.test(await mod.exportOrderedModule())) leaked++;
    for (const id of Object.keys(mod.notes)) {
      notes++;
      const r = cache.get(Number(id));
      const a = mod.findAmplitude(mod.notes[id]);
      if ((r && r.amplitude != null) || a.n !== 1n || a.d !== 1n || a.s !== 1n) notUnity++;
    }
  }
  check(leaked === 0, `A1 no "amplitude" key written for any of ${files.length} shipped modules`);
  check(notUnity === 0, `A2 all ${notes} notes sound at exactly 1/1`);
  check(amplitudeToGain(null) === 1 && 0.2 * amplitudeToGain(null) === 0.2, 'A3 unity gain leaves the envelope peak bit-identical');
}

// --- B: inheritance and references ---------------------------------------------
console.log('\nAmplitude: inheritance and references\n');
{
  const mod = await load({ ...BASE, amplitude: '(1/2)' }, [
    note(1),                                             // inherits the BaseNote's
    note(2, { amplitude: '(121/100) * [1].a' }),         // relative to a note that inherits
    note(3, { amplitude: '2' }),                         // a constant: no longer follows the base
    note(4, { amplitude: '[2].amp * base.amplitude' }),  // the other spellings
    note(5, { amplitude: "module.getNoteById(2).getVariable('amplitude').mul(new Fraction(2))" }),
  ]);
  check(amp(mod, 0) === '1/2', 'B1 BaseNote amplitude evaluates');
  check(amp(mod, 1) === '1/2' && mod.evaluateModule().get(1).amplitude === null, 'B2 a note without one inherits the BaseNote\'s (and stores nothing)');
  check(amp(mod, 2) === '121/200', 'B3 [N].a reads what an inheriting note sounds at');
  check(amp(mod, 3) === '2', 'B4 a note\'s own amplitude wins over the BaseNote\'s');
  check(amp(mod, 4) === '121/400', 'B5 amp / amplitude are the same property as a');
  check(amp(mod, 5) === '121/100', 'B6 a module written with getVariable(\'amplitude\') converts on load');

  const bytes = (src) => { const b = compiler.compile(src); return Array.from(b.bytecode.subarray(0, b.length)).join(','); };
  check(bytes('[7].a') === bytes('[7].amp') && bytes('[7].a') === bytes('[7].amplitude')
    && bytes('base.a') === bytes('base.amplitude'), 'B7 all three spellings compile to the same bytecode');

  const none = await load(BASE, [note(1), note(2, { amplitude: '[1].a * 3' })]);
  check(amp(none, 0) === '1' && amp(none, 1) === '1' && amp(none, 2) === '3', 'B8 with no BaseNote amplitude the default is 1');
}

// --- C: exactness ----------------------------------------------------------------
console.log('\nAmplitude: exact at any depth\n');
{
  const DEPTH = 50;
  const notes = [];
  for (let k = 1; k <= DEPTH; k++) {
    notes.push(note(k, { amplitude: k === 1 ? '(121/100) * base.a' : `(121/100) * [${k - 1}].a` }));
  }
  const mod = await load(BASE, notes);
  const got = mod.getNoteById(DEPTH).getVariable('amplitude');
  const wantN = 121n ** BigInt(DEPTH), wantD = 100n ** BigInt(DEPTH);   // coprime: 121 = 11², 100 = 2²·5²
  check(got && got.s * got.n === wantN && got.d === wantD,
    `C1 ${DEPTH}-note (121/100) chain: exact (${wantN.toString().length}-digit numerator)`);
  check(amplitudeToGain(got) === MAX_AMPLITUDE, 'C2 the engine clamps it; the module keeps every digit');
}

// --- D: irrational gains ---------------------------------------------------------
console.log('\nAmplitude: irrational values\n');
{
  const mod = await load(BASE, [note(1, { amplitude: '10^(-6/20)' }), note(2, { frequency: 'base.f * 2^(7/12)' })]);
  const cache = mod.evaluateModule();
  check(cache.get(1).corruptionFlags === 0x08, 'D1 an irrational amplitude sets flag 0x08 and nothing else');
  check(cache.get(2).corruptionFlags === 0x04, 'D2 an irrational frequency still sets only 0x04');
  check(Math.abs(amplitudeToGain(mod.findAmplitude(mod.getNoteById(1))) - Math.pow(10, -6 / 20)) < 1e-9, 'D3 -6 dB evaluates to ≈0.501187');
}

// --- E: BaseNote edits propagate ---------------------------------------------------
console.log('\nAmplitude: a BaseNote edit reaches every note that inherits through another\n');
{
  // Note 2 names only note 1, and note 1 names nothing at all.
  const mod = await load(BASE, [
    { id: 1, startTime: '0', duration: '1', frequency: '440' },
    { id: 2, startTime: '1', duration: '1', frequency: '440', amplitude: '[1].a * 2' },
  ]);
  const before = amp(mod, 2);
  mod.baseNote.setVariable('amplitude', '(3/4)');
  mod.evaluateModule();
  check(before === '2' && amp(mod, 2) === '3/2', `E1 [1].a * 2 follows base.a: ${before} -> ${amp(mod, 2)}`);
}

// --- F: save round-trip ------------------------------------------------------------
console.log('\nAmplitude: save and load\n');
{
  // Out of time order on purpose, so "Save Module" has to renumber the ids.
  const mod = await load({ ...BASE, amplitude: '(2/3)' }, [
    { id: 7, startTime: 'base.t + base.d * 2', duration: 'base.d', frequency: 'base.f', amplitude: '[9].a * (5/4)' },
    { id: 9, startTime: 'base.t', duration: 'base.d', frequency: 'base.f', amplitude: 'base.a * (9/10)' },
  ]);
  const snap = await Module.loadFromJSON(JSON.parse(JSON.stringify(mod.createModuleJSON())));
  snap.evaluateModule();
  check(amp(snap, 7) === amp(mod, 7) && amp(snap, 9) === amp(mod, 9) && amp(snap, 0) === '2/3', 'F1 snapshot (history, autosave) round-trips');

  const saved = JSON.parse(await mod.exportOrderedModule());
  const reloaded = await Module.loadFromJSON(saved);
  reloaded.evaluateModule();
  const first = saved.notes.find((n) => n.amplitude === 'base.a * (9/10)');
  const second = saved.notes.find((n) => n !== first);
  check(saved.baseNote.amplitude === '(2/3)' && first && second && second.amplitude === `[${first.id}].a * (5/4)`,
    `F2 "Save Module" keeps amplitude and renumbers its references ([9] -> [${first?.id}])`);
  check(amp(reloaded, second.id) === '3/4' && amp(reloaded, first.id) === '3/5', 'F3 the saved file evaluates to the same gains');
}

// --- G: clearing ---------------------------------------------------------------------
console.log('\nAmplitude: removing a note\'s own value\n');
{
  const mod = await load({ ...BASE, amplitude: '(1/2)' }, [note(1, { amplitude: '3' }), note(2, { amplitude: '[1].a' })]);
  const removed = mod.getNoteById(1).clearExpression('amplitude');
  mod.evaluateModule();
  check(removed && amp(mod, 1) === '1/2' && amp(mod, 2) === '1/2', 'G1 the note and its dependents fall back to the BaseNote\'s');
  check(!('amplitude' in mod.createModuleJSON().notes[0]), 'G2 the key is no longer saved');
}

// --- H: the audio boundary -----------------------------------------------------------
console.log('\nAmplitude: clamp at the audio boundary\n');
{
  check(MAX_AMPLITUDE === 4, 'H1 maximum gain is 4 (+12 dB)');
  check(amplitudeToGain(9) === 4 && amplitudeToGain(-2) === 0 && amplitudeToGain(0) === 0 && amplitudeToGain(0.5) === 0.5,
    'H2 above 4 -> 4, negative -> 0, in range -> unchanged');
}

// --- I: the envelope display setting -----------------------------------------------
console.log('\nEnvelope display: Settings > Appearance > Envelope inside notes, Tails after the note\'s end\n');
{
  const { defaultSettings, validateSettings } = await import('../src/settings/settings-schema.js');
  const { defaultRendererConfig } = await import('../src/renderer/webgl2/renderer-config.js');
  const v = (a) => validateSettings({ appearance: a }).appearance;
  check(defaultSettings().appearance.envelopes === 'own' && defaultSettings().appearance.showTails === false,
    'I1 by default only notes that set attack or release draw it, and no tails (the app as it was)');
  check(defaultRendererConfig.note.envelopeMode === 'own' && defaultRendererConfig.note.showTails === false, 'I2 the renderer config defaults the same');
  check(v({ envelopes: 'all' }).envelopes === 'all' && v({ envelopes: 'none' }).envelopes === 'none' && v({ showTails: true }).showTails === true,
    'I3 every choice survives validation');
  check(v({ envelopes: 'some' }).envelopes === 'own' && v({ showTails: 'yes' }).showTails === false, 'I4 anything else falls back to the default');
  check(v({ showEnvelopes: true }).envelopes === 'all' && v({ showEnvelopes: false }).envelopes === 'own',
    'I5 the old "Show every envelope" switch carries over: on reads as Every note');
  check(v({ envelopes: 'all', note: { heightWU: 30 } }).envelopes === 'all',
    'I6 it sits beside appearance.note (which a theme preset replaces), not inside it');
}

// --- J: the voice limit -----------------------------------------------------------
console.log('\nVoice limit: Settings > Audio > Most voices at once\n');
{
  const { defaultSettings, validateSettings, VOICE_LIMITS } = await import('../src/settings/settings-schema.js');
  const v = (x) => validateSettings({ audio: { maxVoices: x } }).audio.maxVoices;
  check(defaultSettings().audio.maxVoices === 256, 'J1 256 by default');
  check(VOICE_LIMITS.every((n) => v(n) === n) && v('1024') === 1024, 'J2 every offered limit survives validation (a number or its string)');
  check(v(300) === 256 && v(-1) === 256 && v('lots') === 256, 'J3 anything else falls back to 256');
}

console.log(`\n${failures ? `${failures} failure(s).` : 'All amplitude checks passed.'}`);
process.exit(failures ? 1 : 0);
