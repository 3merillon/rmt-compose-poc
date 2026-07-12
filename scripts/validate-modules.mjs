#!/usr/bin/env node
/**
 * Validate every shipped library module (ROADMAP Phase 6.5).
 *
 * For each module referenced by public/modules/library.json (v2 manifest):
 *   1. structure    — object with baseNote{} + notes[]
 *   2. expressions  — every expression string passes validateExpressionSyntax
 *   3. self-contained — every [id] / getNoteById(id) reference resolves to a
 *      note defined in the module (or the base, id 0). This is what guarantees
 *      the module imports cleanly onto BOTH a note and the base note: on drop,
 *      id 0 is remapped to the target and internal ids are renumbered, so no
 *      reference may dangle to an outside note.
 *   4. evaluates    — Module.loadFromJSON + evaluateModule yields finite
 *      startTime / duration / frequency for every note (no NaN/∞, no cycles).
 *   5. ratio/cents  — for single-note interval modules, the evaluated frequency
 *      matches (ratio · base) and the manifest cents match 1200·log2(ratio).
 *
 * Exit code is non-zero if any module fails. Run via `npm test`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const modulesDir = join(root, 'public', 'modules');

const { Module } = await import('../src/module.js');
const { validateExpressionSyntax } = await import('../src/utils/safe-expression-validator.js');

const EXPR_KEYS = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

let failures = 0;
let checked = 0;
const fail = (file, msg) => { failures++; console.error(`  ✗ ${file}: ${msg}`); };

function extractRefIds(expr) {
  const ids = new Set();
  const s = String(expr);
  let m;
  const re1 = /\[(\d+)\]/g;
  while ((m = re1.exec(s))) ids.add(Number(m[1]));
  const re2 = /getNoteById\(\s*(\d+)\s*\)/g;
  while ((m = re2.exec(s))) ids.add(Number(m[1]));
  return ids;
}

async function validateModuleFile(relFile, meta) {
  const abs = join(modulesDir, relFile);
  if (!existsSync(abs)) { fail(relFile, 'file referenced by manifest not found'); return; }
  let data;
  try { data = JSON.parse(readFileSync(abs, 'utf8')); }
  catch (e) { fail(relFile, 'invalid JSON: ' + e.message); return; }

  if (!data || typeof data !== 'object' || Array.isArray(data)) { fail(relFile, 'module must be a JSON object'); return; }
  if (!data.baseNote || typeof data.baseNote !== 'object') { fail(relFile, 'missing baseNote object'); return; }
  if (!Array.isArray(data.notes)) { fail(relFile, 'missing notes array'); return; }

  const definedIds = new Set([0]);
  for (const n of data.notes) definedIds.add(Number(n.id));

  const checkExprs = (obj, label) => {
    for (const k of Object.keys(obj)) {
      if (!EXPR_KEYS.includes(k)) continue;
      const v = obj[k];
      if (typeof v !== 'string') continue;
      const r = validateExpressionSyntax(v);
      if (!r.valid) fail(relFile, `${label}.${k} invalid expression: ${r.error}`);
      for (const id of extractRefIds(v)) {
        if (!definedIds.has(id)) fail(relFile, `${label}.${k} references undefined note [${id}] — not self-contained`);
      }
    }
  };
  checkExprs(data.baseNote, 'baseNote');
  for (const n of data.notes) checkExprs(n, `note ${n.id}`);

  let mod;
  try {
    mod = await Module.loadFromJSON(data);
    mod.evaluateModule();
  } catch (e) { fail(relFile, 'evaluate threw: ' + e.message); return; }

  for (const n of data.notes) {
    const note = mod.getNoteById(Number(n.id));
    if (!note) { fail(relFile, `note ${n.id} missing after load`); continue; }
    for (const prop of ['startTime', 'duration', 'frequency']) {
      if (n[prop] == null) continue; // silences/measure notes may omit some props
      let val;
      try { val = note.getVariable(prop)?.valueOf?.(); } catch (e) { val = NaN; }
      if (typeof val !== 'number' || !Number.isFinite(val)) fail(relFile, `note ${n.id}.${prop} evaluated to ${val} (not finite)`);
    }
  }

  // Ratio / cents cross-check for single-note interval modules.
  if (meta && meta.ratio && /^\d+\/\d+$/.test(meta.ratio) && data.notes.length === 1) {
    const [rn, rd] = meta.ratio.split('/').map(Number);
    const baseF = mod.baseNote.getVariable('frequency').valueOf();
    const got = mod.getNoteById(Number(data.notes[0].id)).getVariable('frequency').valueOf();
    const expected = baseF * rn / rd;
    if (Math.abs(got - expected) > 1e-6 * expected) fail(relFile, `frequency ${got} ≠ ratio ${meta.ratio}·base (${expected})`);
    if (meta.cents != null) {
      const cents = 1200 * Math.log2(rn / rd);
      if (Math.abs(cents - meta.cents) > 0.01) fail(relFile, `manifest cents ${meta.cents} ≠ computed ${cents.toFixed(3)}`);
    }
  }

  checked++;
}

const libPath = join(modulesDir, 'library.json');
if (!existsSync(libPath)) { console.error('library.json not found'); process.exit(1); }
const lib = JSON.parse(readFileSync(libPath, 'utf8'));
if (!lib || lib.version !== 2 || !Array.isArray(lib.sections)) { console.error('library.json is not a v2 manifest'); process.exit(1); }

console.log(`Validating modules across ${lib.sections.length} sections...\n`);
for (const sec of lib.sections) {
  const items = sec.items || [];
  let secFails = failures;
  for (const item of items) await validateModuleFile(item.file, item);
  const n = items.length;
  const ok = n - (failures - secFails);
  console.log(`  ${sec.id}: ${ok}/${n} ok`);
}

console.log(`\n${checked} modules validated, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
