#!/usr/bin/env node
/**
 * Sample loops (npm test): bakeLoopCrossfade and the violin manifest.
 *
 *   A. After the bake, the samples just before the loop's end are the samples just
 *      before its start, so the jump from end to start continues the sound; the
 *      sound before the crossfade and inside the loop is untouched.
 *   B. The blend keeps the level: alike stretches (a sine at whole periods) and
 *      unrelated ones (two noises) both come out within 0.5 dB of the level they
 *      went in at, in every 10 ms of the crossfade.
 *   C. A loop that does not fit the buffer (or leaves no room for the crossfade)
 *      changes nothing.
 *   D. Every violin zone has a loop inside its recording, longer than a second,
 *      starting after the bow's attack (≥ 0.8 s) and ending before the fade (≤ 3.3 s);
 *      no piano zone has one (a piano note dies away and is not held).
 * The rendered loops (seams level, no clicks, notes last) are checked in a browser by
 * scripts/perf/check-violin-loops.mjs.
 *
 * Run via `node scripts/test-loops.mjs`.
 */
import { isRecord } from '../src/model-types.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { bakeLoopCrossfade, LOOP_XFADE } = await import('../src/instruments/multisample-instrument.ts');

let failures = 0;
const ok = (msg: string) => console.log(`  ok   ${msg}`);
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`); };
const check = (cond: unknown, msg: string) => (cond ? ok(msg) : fail(msg));

const SR = 48000;
const fakeBuffer = (x: Float32Array) => ({ sampleRate: SR, length: x.length, numberOfChannels: 1, getChannelData: () => x });
let seed = 7;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
const rmsDb = (x: Float32Array, a: number, b: number) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return 10 * Math.log10(e / (b - a)); };
const L = Math.round(LOOP_XFADE * SR);

console.log('A. The seam continues the sound');
{
  const f = 440, n = 3 * SR, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * f * i / SR) * (1 + 0.3 * Math.sin(2 * Math.PI * 5.3 * i / SR));
  const orig = Float32Array.from(x);
  const loop = { start: 1.0, end: 2.5 };
  check(bakeLoopCrossfade(fakeBuffer(x), loop) === true, 'the bake applies');
  const s = Math.round(loop.start * SR), e = Math.round(loop.end * SR);
  let worst = 0; for (let k = 1; k <= 16; k++) worst = Math.max(worst, Math.abs(x[e - k] - orig[s - k]));
  check(Math.abs(x[e - 1] - orig[s - 1]) < 1e-7, 'the last sample before the end is the one before the start');
  check(worst < 1e-3, `the 16 before it nearly so (the old sound's weight there is under 0.001; worst ${worst.toExponential(1)})`);
  let touched = 0; for (let i = 0; i < e - L; i++) if (x[i] !== orig[i]) touched++;
  for (let i = e; i < n; i++) if (x[i] !== orig[i]) touched++;
  check(touched === 0, 'nothing outside the crossfade changes');
}

console.log('B. The blend keeps the level');
for (const kind of ['alike', 'unrelated']) {
  const n = 3 * SR, x = new Float32Array(n);
  if (kind === 'alike') for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 400 * i / SR);   // 400 Hz: 120 samples a period, loop at whole periods
  else for (let i = 0; i < n; i++) x[i] = noise() * 0.5;
  const before = rmsDb(x, 0, SR);
  const loop = { start: 1.0, end: 2.5 };
  bakeLoopCrossfade(fakeBuffer(x), loop);
  const e = Math.round(loop.end * SR), W = Math.round(0.01 * SR);
  let worst = 0; for (let i = e - L; i + W <= e; i += W) worst = Math.max(worst, Math.abs(rmsDb(x, i, i + W) - before));
  check(worst < 0.5, `${kind} stretches: every 10 ms of the crossfade within 0.5 dB (worst ${worst.toFixed(2)} dB)`);
}

console.log('C. A loop that does not fit changes nothing');
for (const loop of [{ start: 0.05, end: 2 }, { start: 1, end: 3.5 }, { start: 1, end: 1.1 }]) {
  const x = new Float32Array(3 * SR).map(() => noise()), orig = Float32Array.from(x);
  const r = bakeLoopCrossfade(fakeBuffer(x), loop);
  check(r === false && x.every((v, i) => v === orig[i]), `${loop.start}–${loop.end} s in a 3 s buffer: refused, untouched`);
}

console.log('D. The manifests');
{
  const zones = (instrument: string) => {
    const manifest: unknown = JSON.parse(readFileSync(join(here, '../public/samples', instrument, 'manifest.json'), 'utf8'));
    if (!isRecord(manifest) || !Array.isArray(manifest.zones)) throw new Error('Invalid sample manifest');
    return manifest.zones.map((zone: unknown) => {
      if (!isRecord(zone) || typeof zone.root !== 'string') throw new Error('Invalid sample zone');
      const loop = zone.loop;
      if (loop == null) return { root: zone.root, loop: null };
      if (!isRecord(loop) || typeof loop.start !== 'number' || typeof loop.end !== 'number') throw new Error('Invalid loop');
      return { root: zone.root, loop: {start: loop.start, end: loop.end} };
    });
  };
  const violin = zones('violin');
  const bad = violin.filter((z) => !(z.loop && z.loop.start >= 0.8 && z.loop.end <= 3.3 && z.loop.end - z.loop.start > 1));
  check(bad.length === 0, `all ${violin.length} violin zones loop between 0.8 s and 3.3 s, for more than a second${bad.length ? ` (not: ${bad.map((z) => z.root).join(', ')})` : ''}`);
  const piano = zones('piano');
  check(piano.every((z) => !z.loop), 'no piano zone loops');
}

console.log(failures ? `\n${failures} failure(s)` : '\nall loop tests pass');
process.exit(failures ? 1 : 0);
