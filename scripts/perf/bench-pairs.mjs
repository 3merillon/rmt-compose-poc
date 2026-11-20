#!/usr/bin/env node
/**
 * The JavaScript and WASM evaluators, benched back to back.
 *
 * Runs scripts/perf/bench-node.mjs once per engine per pair, each in its own
 * process, alternating which engine goes first so that drift (thermal, other
 * load) falls on both alike. Reports per module and row the median of the
 * per-run p50s on each engine and their ratio.
 *
 * Usage:
 *   node scripts/perf/bench-pairs.mjs                      # every stress module, 5 pairs
 *   node scripts/perf/bench-pairs.mjs chain-1000 --pairs 9 --runs 3
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const PAIRS = option('--pairs', 5);
const RUNS = option('--runs', 2);
const modules = args.filter((a, i) => !a.startsWith('--') && !['--pairs', '--runs'].includes(args[i - 1]));
const targets = modules.length > 0 ? modules : ['chain-1000', 'fan-1000', 'lattice-1000', 'chords-dense', 'comma-chain-400'];

function run(name, engine) {
  const flags = [join(here, 'bench-node.mjs'), name, '--json', '--runs', String(RUNS)];
  if (engine === 'wasm') flags.push('--wasm');
  const out = spawnSync(process.execPath, flags, { encoding: 'utf8' });
  const line = out.stdout.trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`${name} on ${engine}: ${out.stderr || out.stdout}`);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const rows = [];
for (const name of targets) {
  const p50 = { js: {}, wasm: {} };
  let notes = 0;
  for (let pair = 0; pair < PAIRS; pair++) {
    for (const engine of pair % 2 === 0 ? ['js', 'wasm'] : ['wasm', 'js']) {
      const result = run(name, engine);
      notes = result.notes;
      for (const [row, stats] of Object.entries(result.results)) {
        const key = row.replace(/\s*\(note \d+\)/, '');
        (p50[engine][key] ||= []).push(stats['p50 (ms)']);
      }
    }
  }
  for (const key of Object.keys(p50.js)) {
    const js = median(p50.js[key]);
    const wasm = median(p50.wasm[key]);
    rows.push({ module: `${name} (${notes})`, row: key, 'JS p50 (ms)': js, 'WASM p50 (ms)': wasm, 'JS / WASM': +(js / wasm).toFixed(2) });
  }
}

console.log(`${PAIRS} pairs, ${RUNS}x samples per run; medians of the per-run p50s`);
console.table(rows);
