#!/usr/bin/env node
/**
 * Convert module JSON files to relational time and the DSL, in place.
 *
 *   node scripts/migrate-modules.mjs <file-or-folder>... [--dry-run]
 *
 * Uses the same conversions the app applies on load, in the same order:
 * src/migrate/relational-time.js (tempo, beats per measure and measure length
 * become relations of base.d), then src/migrate/legacy-syntax.js (the retired
 * method-chain syntax becomes DSL). A converted file evaluates to exactly the
 * values it had (scripts/test-relational-time.mjs and test-legacy-syntax.mjs
 * check this against the old engines). Files already in the current form are
 * left untouched. Line endings and two-space indentation are kept.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { isInputScore } from '../src/model-types.ts';
import { migrateTimeModel } from '../src/migrate/relational-time.ts';
import { migrateSyntax } from '../src/migrate/legacy-syntax.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter(a => a !== '--dry-run');
if (targets.length === 0) {
  console.error('usage: node scripts/migrate-modules.mjs <file-or-folder>... [--dry-run]');
  process.exit(2);
}

function walk(p: string, acc: string[]) {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) walk(join(p, f), acc);
  } else if (p.endsWith('.json') && !['index.json', 'library.json'].includes(basename(p))) {
    acc.push(p);
  }
  return acc;
}

/** BaseNote keys in a readable order: frequency, startTime, duration first. */
function orderBase(base: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ['frequency', 'startTime', 'duration']) if (k in base) out[k] = base[k];
  for (const [k, v] of Object.entries(base)) if (!(k in out)) out[k] = v;
  return out;
}

let converted = 0, unchanged = 0, failed = 0;
for (const file of targets.flatMap(t => walk(t, []))) {
  const text = readFileSync(file, 'utf8');
  let data: unknown;
  try { data = JSON.parse(text); } catch { continue; }
  if (!isInputScore(data)) continue;
  try {
    const time = migrateTimeModel(data);
    const syntax = migrateSyntax(time.data);
    if (!time.migrated && !syntax.migrated) { unchanged++; continue; }
    const r = { data: syntax.data, report: [...time.report, ...syntax.report] };
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
    console.error(`FAILED ${file}: ${(e instanceof Error ? e.message : String(e))}`);
  }
}
console.log(`\n${converted} converted, ${unchanged} already current, ${failed} failed`);
process.exit(failed ? 1 : 0);
