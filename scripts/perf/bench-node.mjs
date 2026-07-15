#!/usr/bin/env node
/**
 * Headless perf baseline runner.
 *
 * Measures the JS evaluation path (Node has no WASM artifact wiring by
 * default and no renderer, so this benchmarks module evaluation only —
 * use the in-browser harness (?perf=1) for WASM + renderer.sync numbers).
 *
 * Usage:
 *   node scripts/perf/bench-node.mjs                    # all stress modules (JS path)
 *   node scripts/perf/bench-node.mjs chain-1000         # one module
 *   node scripts/perf/bench-node.mjs --wasm             # WASM evaluator path
 *   node scripts/perf/bench-node.mjs chain-1000 --wasm
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const perfDir = join(here, '..', '..', 'public', 'modules', 'perf');

const args = process.argv.slice(2);
const useWasm = args.includes('--wasm');
const targetArg = args.find((a) => !a.startsWith('--'));

const { Module } = await import('../../src/module.js');

if (useWasm) {
  // Node's fetch can't load file:// URLs (wasm-bindgen init uses one) — shim it.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, ...rest) => {
    const u = String(url);
    if (u.startsWith('file://') && u.endsWith('.wasm')) {
      const buf = readFileSync(fileURLToPath(u));
      return new Response(buf, { headers: { 'content-type': 'application/wasm' } });
    }
    return realFetch(url, ...rest);
  };
  const { initWasm } = await import('../../src/wasm/index.js');
  const ok = await initWasm();
  if (!ok) {
    console.error('WASM failed to initialize; aborting --wasm bench');
    process.exit(1);
  }
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    'p50 (ms)': +percentile(s, 50).toFixed(2),
    'p95 (ms)': +percentile(s, 95).toFixed(2),
    'min (ms)': +s[0].toFixed(2),
    'max (ms)': +s[s.length - 1].toFixed(2),
    runs: s.length
  };
}

async function loadModule(name) {
  const data = JSON.parse(readFileSync(join(perfDir, `${name}.json`), 'utf8'));
  return Module.loadFromJSON(data);
}

function timed(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

async function bench(name) {
  const mod = await loadModule(name);
  const noteIds = Object.keys(mod.notes).map(Number).filter((id) => id !== 0);
  const midId = noteIds[Math.floor(noteIds.length / 2)];
  const midNote = mod.getNoteById(midId);
  const results = {};

  // Warm up + initial full evaluation (also compiles everything).
  mod.evaluateModule();

  // 1) Full re-evaluation (everything dirty).
  {
    const samples = [];
    for (let i = 0; i < 8; i++) {
      mod._incrementalEvaluator.invalidateAll();
      mod._dirtyNotes.add(0);
      samples.push(timed(() => mod.evaluateModule()));
    }
    results['full eval'] = stats(samples);
  }

  // 2) Mid-chain commit: change one note's startTime, re-evaluate.
  {
    const original = midNote.variables.startTimeString;
    const alt = `(${original}) + beat(base) / 8`;
    const samples = [];
    for (let i = 0; i < 20; i++) {
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
    for (let i = 0; i < 10; i++) {
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

  console.log(`\n=== ${name} (${noteIds.length} notes) — evaluator: ${mod._binaryEvaluator?.constructor?.name} ===`);
  console.table(results);
}

const targets = process.argv[2]
  ? [process.argv[2]]
  : ['chain-1000', 'fan-1000', 'lattice-1000', 'chords-dense'];

for (const t of targets) {
  await bench(t);
}
