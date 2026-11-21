#!/usr/bin/env node
/**
 * The violin's loops, measured offline (Phase I).
 *
 * Every violin zone plays one 10 s note twice (at its own root, playback rate 1, and a whole tone higher,
 * rate 9/8), through the app's own MultisampleInstrument and envelope, on an OfflineAudioContext in headless
 * Edge (no dev server; /src and /samples answered from the working tree). Checked per note:
 *   - it lasts: no 20 ms frame between 0.3 s and the note's end is more than 12 dB below the note's median
 *     level (before the loops a violin note fell silent at about 3.4 s, its recording's end);
 *   - the seams are level: at each jump from the loop's end back to its start, the level step between
 *     neighbouring 20 ms frames is no larger than 1.5 dB or than 99% of the same steps elsewhere in the
 *     note (the recording's own flicker, from the bow and the vibrato), whichever is larger;
 *   - the seams do not click: the largest sample-to-sample step within 5 ms of a seam is no larger than
 *     1.5 × the largest one elsewhere in the held part.
 *   node scripts/perf/check-violin-loops.mjs     (exits 1 on a failure)
 * Measures; does not listen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('.');
const SR = 48000, PRE = 0.05, DUR = 10, POST = 0.5, PEAK = 0.2;
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.m4a': 'audio/mp4' };

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
await page.route('**/*', (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
  if (path === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>loops</title>' });
  const rel = path.startsWith('src/') ? path : path.startsWith('node_modules/') ? path : `public/${path}`;
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ contentType: MIME[extname(path)] || 'application/octet-stream', body: readFileSync(file) });
});
await page.goto('http://harness.localhost/');

const zones = JSON.parse(readFileSync('public/samples/violin/manifest.json', 'utf8')).zones;
const f32 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
let failures = 0;
console.log('zone  rate   lasts(min dB re median)  seam step dB (max)  click ratio   loop');
for (const z of zones) {
  for (const rate of [1, 9 / 8]) {
    const r = await page.evaluate(async ({ root, rate, SR, PRE, DUR, POST, PEAK }) => {
      const [im, synth, sample] = await Promise.all([
        import('/src/instruments/instrument-manager.js'),
        import('/src/instruments/synth-instruments.js'),
        import('/src/instruments/sample-instruments.js'),
      ]);
      const ctx = new OfflineAudioContext(1, Math.ceil((PRE + DUR + POST) * SR), SR);
      const m = new im.InstrumentManager(ctx);
      m.registerBuiltInInstruments(synth.SynthInstruments, sample.SampleInstruments);
      const inst = m.getInstrument('violin');
      if (inst.waitForLoad) await inst.waitForLoad();
      const zone = inst.zones.find((q) => q.root === root);
      const freq = (zone.playedHz || zone.rootHz) * rate;
      if (inst.prepare) await inst.prepare([freq]);
      const voice = m.createOscillator('violin', freq);
      const g = ctx.createGain(); g.gain.value = 0;
      m.applyEnvelope('violin', g, PRE, DUR, PEAK, null, freq);
      voice.connect(g); g.connect(ctx.destination);
      voice.start(PRE); voice.stop(PRE + m.voiceLength('violin', DUR, null, freq));
      const buf = await ctx.startRendering();
      const x = buf.getChannelData(0);
      const u8 = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { pcm: btoa(s), loop: zone.loop, actualRate: freq / (zone.playedHz || zone.rootHz) };
    }, { root: z.root, rate, SR, PRE, DUR, POST, PEAK });
    const x = f32(r.pcm);
    const F = Math.round(0.02 * SR);
    const frame = (t) => { const i0 = Math.round(t * SR); let e = 0; for (let i = i0; i < i0 + F; i++) e += x[i] * x[i]; return 10 * Math.log10(e / F + 1e-20); };
    const frames = []; for (let t = PRE + 0.3; t < PRE + DUR - 0.05; t += 0.02) frames.push({ t, db: frame(t) });
    const sorted = frames.map((f) => f.db).sort((a, b) => a - b), median = sorted[sorted.length >> 1];
    const minRel = sorted[0] - median;
    // Seam times: the source reaches loop.end at loop.end / rate, then every (end - start) / rate
    const seams = [];
    if (r.loop) for (let t = PRE + r.loop.end / r.actualRate; t < PRE + DUR - 0.05; t += (r.loop.end - r.loop.start) / r.actualRate) seams.push(t);
    let seamStep = 0, seamJump = 0, elseJump = 0;
    for (const t of seams) seamStep = Math.max(seamStep, Math.abs(frame(t) - frame(t - 0.02)));
    // The same step everywhere else in the held part: the recording's own flicker (bow, vibrato)
    const steps = [];
    for (let t = PRE + 0.32; t < PRE + DUR - 0.05; t += 0.005) if (!seams.some((q) => Math.abs(t - q) < 0.03)) steps.push(Math.abs(frame(t) - frame(t - 0.02)));
    steps.sort((p, q) => p - q);
    const natural = steps[Math.floor(steps.length * 0.99)];
    const near = (i) => seams.some((t) => Math.abs(i / SR - t) < 0.005);
    for (let i = Math.round((PRE + 0.3) * SR); i < Math.round((PRE + DUR - 0.05) * SR); i++) {
      const d = Math.abs(x[i] - x[i - 1]);
      if (near(i)) seamJump = Math.max(seamJump, d); else elseJump = Math.max(elseJump, d);
    }
    const click = seams.length ? seamJump / elseJump : 0;
    const ok = minRel > -12 && seamStep <= Math.max(1.5, natural) && click <= 1.5 && seams.length > 0;
    if (!ok) failures++;
    console.log(`${z.root.padEnd(5)} ${rate === 1 ? '1    ' : '9/8  '}  ${minRel.toFixed(1).padStart(6)}                  ${seamStep.toFixed(2).padStart(5)} (${seams.length} seams; elsewhere 99% ≤ ${natural.toFixed(2)})      ${click.toFixed(2)}       ${r.loop ? `${r.loop.start}–${r.loop.end}` : 'none'}  ${ok ? 'ok' : 'FAIL'}`);
  }
}
await browser.close();
console.log(failures ? `\n${failures} failing note(s)` : '\nall violin notes last and loop level and without a click');
process.exit(failures ? 1 : 0);
