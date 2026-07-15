#!/usr/bin/env node
/**
 * End-to-end test of the WASM evaluator hot-swap (currently blocked in the browser; see docs/developer/wasm/overview.md).
 *
 * Reproduces the browser race headlessly: constructs a Module BEFORE WASM
 * init completes (so it starts on the JS fallback), then completes WASM init
 * and verifies the module hot-swapped to the WASM evaluator with identical
 * evaluation results and working base-note propagation.
 *
 * Node's fetch can't load file:// URLs (which wasm-bindgen's init uses), so
 * we shim fetch for .wasm file URLs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fraction from 'fraction.js';

// --- fetch shim for file:// wasm loading in Node ---
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...args) => {
  const u = String(url);
  if (u.startsWith('file://') && u.endsWith('.wasm')) {
    const buf = readFileSync(fileURLToPath(u));
    return new Response(buf, { headers: { 'content-type': 'application/wasm' } });
  }
  return realFetch(url, ...args);
};

const { Module } = await import('../../src/module.js');
const { initWasm, isWasmAvailable } = await import('../../src/wasm/index.js');
const { isWasmBackedEvaluator } = await import('../../src/wasm/evaluator-adapter.js');

const data = JSON.parse(readFileSync(new URL('../../public/modules/perf/chain-1000.json', import.meta.url), 'utf8'));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// 1) Construct module BEFORE WASM init completes (mirrors the browser race).
const mod = await Module.loadFromJSON(data);
check('module starts on JS fallback', !isWasmBackedEvaluator(mod._binaryEvaluator),
  mod._binaryEvaluator.constructor.name);

const jsCache = mod.evaluateModule();
const jsSamples = [1, 250, 500, 750, 1000].map((id) => ({
  id,
  f: jsCache.get(id).frequency.toFraction(),
  t: jsCache.get(id).startTime.toFraction()
}));

// 2) Complete WASM init -> onWasmReady fires -> hot-swap.
const wasmLoaded = await initWasm();
check('WASM initialized', wasmLoaded && isWasmAvailable());

// onWasmReady callbacks run on a microtask; give them a tick.
await new Promise((r) => setTimeout(r, 0));

check('evaluator hot-swapped to WASM', isWasmBackedEvaluator(mod._binaryEvaluator),
  mod._binaryEvaluator.constructor.name);

// 3) Results identical on the WASM engine.
const wasmCache = mod.evaluateModule();
for (const s of jsSamples) {
  const w = wasmCache.get(s.id);
  const same = w && w.frequency.toFraction() === s.f && w.startTime.toFraction() === s.t;
  check(`note ${s.id} identical across engines`, !!same,
    same ? `${s.f} @ ${s.t}` : `js=${s.f}@${s.t} wasm=${w?.frequency?.toFraction()}@${w?.startTime?.toFraction()}`);
}

// 4) Base-note edit propagates on the WASM path (exact: after = before · 2).
const before = new Fraction(wasmCache.get(1000).frequency.toFraction());
mod.baseNote.setVariable('frequencyString', '880');
const after = new Fraction(mod.evaluateModule().get(1000).frequency.toFraction());
check('base edit propagates through chain on WASM', after.equals(before.mul(2)),
  `${before.toFraction()} -> ${after.toFraction()}`);

// 5) A module created AFTER WASM is ready starts on WASM directly.
const mod2 = await Module.loadFromJSON(data);
check('post-init module starts on WASM', isWasmBackedEvaluator(mod2._binaryEvaluator),
  mod2._binaryEvaluator.constructor.name);

process.exit(failures ? 1 : 0);
