#!/usr/bin/env node
/**
 * Convert module JSON files to relational time, in place.
 *
 *   node scripts/migrate-modules.mjs <file-or-folder>... [--dry-run]
 *
 * Uses the same conversion the app applies on load (src/migrate/relational-time.js),
 * so a converted file evaluates to exactly the values it had under tempo, beats
 * per measure and measure length (scripts/test-relational-time.mjs checks the
 * library against the old engine). Files already in the relational form are
 * left untouched. Line endings and two-space indentation are kept.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { migrateTimeModel } from '../src/migrate/relational-time.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter(a => a !== '--dry-run');
if (targets.length === 0) {
  console.error('usage: node scripts/migrate-modules.mjs <file-or-folder>... [--dry-run]');
  process.exit(2);
}

function walk(p, acc) {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) walk(join(p, f), acc);
  } else if (p.endsWith('.json') && !['index.json', 'library.json'].includes(basename(p))) {
    acc.push(p);
  }
  return acc;
}

/** BaseNote keys in a readable order: frequency, startTime, duration first. */
function orderBase(base) {
  const out = {};
  for (const k of ['frequency', 'startTime', 'duration']) if (k in base) out[k] = base[k];
  for (const [k, v] of Object.entries(base)) if (!(k in out)) out[k] = v;
  return out;
}

let converted = 0, unchanged = 0, failed = 0;
for (const file of targets.flatMap(t => walk(t, []))) {
  const text = readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(text); } catch { continue; }
  if (!data || !data.baseNote || !Array.isArray(data.notes)) continue;
  try {
    const r = migrateTimeModel(data);
    if (!r.migrated) { unchanged++; continue; }
    r.data.baseNote = orderBase(r.data.baseNote);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const compact = !text.trimEnd().includes('\n'); // generated stress modules are one line
    const out = (compact ? JSON.stringify(r.data) : JSON.stringify(r.data, null, 2).replace(/\n/g, eol)) +
      (/\r?\n$/.test(text) ? eol : '');
    if (!dryRun) writeFileSync(file, out);
    converted++;
    console.log(`${dryRun ? 'would convert' : 'converted'} ${file}: ${r.report.join('; ')}`);
  } catch (e) {
    failed++;
    console.error(`FAILED ${file}: ${e.message}`);
  }
}
console.log(`\n${converted} converted, ${unchanged} already relational, ${failed} failed`);
process.exit(failed ? 1 : 0);
