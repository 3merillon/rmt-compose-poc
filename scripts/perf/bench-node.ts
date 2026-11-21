#!/usr/bin/env node
/**
 * Headless perf baseline runner.
 *
 * Measures module evaluation in Node (no renderer; use the in-browser
 * harness, ?perf=1, for renderer.sync and end-to-end commits).
 *
 * Usage:
 *   node scripts/perf/bench-node.mjs                    # all stress modules
 *   node scripts/perf/bench-node.mjs chain-1000         # one module
 *   node scripts/perf/bench-node.mjs chain-1000 --runs 5   # five times the samples
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const perfDir = join(here, '..', '..', 'public', 'modules', 'perf');

const args = process.argv.slice(2);
const asJson = args.includes('--json'); // one JSON line per module, for bench-pairs.mjs
const runsAt = args.indexOf('--runs');
const RUNS = runsAt >= 0 ? Math.max(1, Number(args[runsAt + 1]) || 1) : 1;
const targetArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--runs');

const { Module } = await import('../../src/module.ts');

function percentile(sorted: number[], p: number) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    'p50 (ms)': +percentile(s, 50).toFixed(2),
    'p95 (ms)': +percentile(s, 95).toFixed(2),
    'min (ms)': +s[0].toFixed(2),
    'max (ms)': +s[s.length - 1].toFixed(2),
    runs: s.length
  };
}

async function loadModule(name: string) {
  const data = JSON.parse(readFileSync(join(perfDir, `${name}.json`), 'utf8'));
  return Module.loadFromJSON(data);
}

function timed(fn: () => unknown) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

async function bench(name: string) {
  const mod = await loadModule(name);
  const noteIds = Object.keys(mod.notes).map(Number).filter((id) => id !== 0);
  const midId = noteIds[Math.floor(noteIds.length / 2)];
  const midNote = mod.getNoteById(midId);
  if (!midNote) throw new Error('Fixture has no middle note');
  const results: Record<string, ReturnType<typeof stats>> = {};

  // Warm up + initial full evaluation (also compiles everything).
  mod.evaluateModule();

  // 1) Full re-evaluation (everything dirty).
  {
    const samples = [];
    for (let i = 0; i < 8 * RUNS; i++) {
      mod._incrementalEvaluator.invalidateAll();
      mod._dirtyNotes.add(0);
      samples.push(timed(() => mod.evaluateModule()));
    }
    results['full eval'] = stats(samples);
  }

  // 2) Mid-chain commit: change one note's startTime, re-evaluate.
  {
    const original = midNote.variables.startTimeString;
    const alt = `(${original}) + base.d / 8`;
    const samples = [];
    for (let i = 0; i < 20 * RUNS; i++) {
      const expr = i % 2 === 0 ? alt : original;
      samples.push(timed(() => {
        midNote.setVariable('startTimeString', expr);
        mod.evaluateModule();
      }));
    }
    midNote.setVariable('startTimeString', original);
    mod.evaluateModule();
    results[`mid commit (note ${midId})`] = stats(samples);
  }

  // 3) Base-note frequency edit (dirties every dependent).
  {
    const samples = [];
    for (let i = 0; i < 10 * RUNS; i++) {
      const freq = i % 2 === 0 ? '441' : '440';
      samples.push(timed(() => {
        mod.baseNote.setVariable('frequencyString', freq);
        mod.evaluateModule();
      }));
    }
    mod.baseNote.setVariable('frequencyString', '440');
    mod.evaluateModule();
    results['base-note edit'] = stats(samples);
  }

  if (asJson) {
    console.log(JSON.stringify({ name, notes: noteIds.length, evaluator: mod._binaryEvaluator?.constructor?.name, results }));
    return;
  }
  console.log(`\n=== ${name} (${noteIds.length} notes) — evaluator: ${mod._binaryEvaluator?.constructor?.name} ===`);
  console.table(results);
}

const targets = targetArg
  ? [targetArg]
  : ['chain-1000', 'fan-1000', 'lattice-1000', 'chords-dense', 'comma-chain-400'];

for (const t of targets) {
  await bench(t);
}
