#!/usr/bin/env node
/**
 * One edit (commit) in the running app, before and after a change, back to back.
 *
 * Runs scripts/perf/profile-commit.mjs (timing only) against two dev servers,
 * one fresh browser per run, alternating which server goes first in each pair
 * so that drift falls on both alike. Reports the median of the per-run commit
 * p50s on each and their ratio.
 *
 * Usage (e.g. v2 HEAD on 3221, a branch on 3220):
 *   node scripts/perf/bench-commit-pairs.mjs [--before http://localhost:3221] [--after http://localhost:3220]
 *        [--module voices-20000] [--pairs 5] [--iter 10]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BEFORE = flag('--before', 'http://localhost:3221');
const AFTER = flag('--after', 'http://localhost:3220');
const MODULE = flag('--module', 'voices-20000');
const PAIRS = Number(flag('--pairs', '5'));
const ITER = flag('--iter', '10');

function run(url: string): { notes: number; evaluator: string; commit: { 'p50 (ms)': number } } {
  const out = spawnSync(process.execPath, [join(here, 'profile-commit.mjs'), '--url', url, '--module', MODULE, '--iter', ITER, '--no-profile', '--json'], { encoding: 'utf8' });
  const line = out.stdout.trim().split('\n').pop();
  try { return JSON.parse(line ?? ''); } catch { throw new Error(`${url}: ${out.stderr || out.stdout}`); }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

type Side = 'before' | 'after';
const p50: Record<Side, number[]> = { before: [], after: [] };
let info = null;
for (let pair = 0; pair < PAIRS; pair++) {
  const order: Side[] = pair % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
  const row: Partial<Record<Side, number>> = {};
  for (const side of order) {
    const r = run(side === 'before' ? BEFORE : AFTER);
    info = r;
    row[side] = r.commit['p50 (ms)'];
    p50[side].push(row[side]);
  }
  console.log(`  pair ${pair + 1} (${order[0]} first): before ${row.before} ms, after ${row.after} ms`);
}
if (!info) throw new Error('Expected at least one benchmark pair');
const b = median(p50.before), a = median(p50.after);
console.log(`\n${MODULE} (${info.notes} notes, ${info.evaluator}), commit p50 over ${PAIRS} pairs x ${Number(ITER) * 2} commits:`);
console.log(`  before ${b} ms   after ${a} ms   before / after ${(b / a).toFixed(2)}`);
