#!/usr/bin/env node
/**
 * The pitch of every sample zone, measured, written into its manifest as `tuneCents` (Phase I).
 *
 * A recording is not exactly at the pitch its file name gives: the VSCO-2 CE upright is stretch-tuned (its bass
 * flat, its treble sharp, as pianos are) and the violin's recordings sit up to 25 cents off. A zone was played at
 * `frequency / rootHz`, so a written ratio between notes of two zones carried the zones' difference. With
 * `tuneCents` the instrument plays `frequency / (rootHz · 2^(tuneCents/1200))`: the measured pitch of the recording
 * lands on the written frequency, and every ratio is exact across zones.
 *
 * The pitch measured is the recording's first partial as it sounds: partials 1…12 are located in one long window
 * of the held tone and fitted to a stiff string's series, f_n = n·f0·√(1 + B·n²) (least squares on f_n²/n² against
 * n², weighted by amplitude), and the first partial is f0·√(1 + B). The fit uses the partials that are there, so
 * a low string whose fundamental is weak is measured from its upper partials; for the violin B comes out near 0 and
 * the result is the mean of its vibrato. Inharmonicity itself (B) is the instrument's and is left as it is.
 *
 *   node scripts/tune-samples.mjs            # measure, write tuneCents into public/samples/{piano,violin}/manifest.json
 *   node scripts/tune-samples.mjs --check    # measure what the corrected instrument plays (should be ~0 cents)
 *   node scripts/tune-samples.mjs --dry      # measure and print, write nothing
 * Run again after scripts/build-samples.mjs (which writes the manifests without it).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check'), DRY = argv.includes('--dry') || CHECK;
const ROOT = resolve('.');
const SR = 48000;
// A bowed string's partials are locked to an exact harmonic series (Helmholtz motion): its fit has B = 0.
const INSTRUMENTS = ['piano', 'violin'];
const HARMONIC = new Set(['violin']);
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.m4a': 'audio/mp4' };

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await (await browser.newContext()).newPage();
await page.route('**/*', (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
  if (path === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>tune</title>' });
  const file = resolve(ROOT, path.startsWith('src/') ? path : `public/${path}`);
  if (!file.startsWith(ROOT + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ contentType: MIME[extname(path)] || 'application/octet-stream', body: readFileSync(file) });
});
await page.goto('http://harness.localhost/');

// Each zone as recorded (decoded at SR), or, with --check, as the instrument plays its root through the
// corrected rate (an offline render of the zone at playbackRate rootHz / playedHz).
const zonesOf = (name) => page.evaluate(async ({ name, sr, check }) => {
  const m = await fetch(`/samples/${name}/manifest.json`).then((r) => r.json());
  const ctx = new OfflineAudioContext(1, 128, sr);
  const b64 = (f32) => { const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const out = [];
  for (const z of m.zones) {
    const buf = await ctx.decodeAudioData(await fetch(`/samples/${name}/${z.url}`).then((r) => r.arrayBuffer()));
    let pcm = buf.getChannelData(0);
    if (check) {
      const played = z.rootHz * Math.pow(2, (z.tuneCents || 0) / 1200);
      const len = Math.ceil(buf.duration * sr * played / z.rootHz);
      const oc = new OfflineAudioContext(1, Math.max(128, len), sr);
      const src = oc.createBufferSource(); src.buffer = buf; src.playbackRate.value = z.rootHz / played;
      src.connect(oc.destination); src.start(0);
      pcm = (await oc.startRendering()).getChannelData(0);
    }
    out.push({ root: z.root, rootHz: z.rootHz, tuneCents: z.tuneCents ?? null, seconds: buf.duration, pcm: b64(pcm.slice(0, Math.min(pcm.length, Math.round(4 * sr)))) });
  }
  return out;
}, { name, sr: SR, check: CHECK });

// ── analysis ──
const f32 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
const pow2 = (n) => 2 ** Math.ceil(Math.log2(n));
function spectrum(x, from, len) {
  const size = pow2(len * 8), re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < len; i++) re[i] = (x[from + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1)));
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return { mag, size };
}
function peakNear({ mag, size }, hz, cents) {
  const lo = Math.max(1, Math.floor(hz * 2 ** (-cents / 1200) * size / SR)), hi = Math.min(mag.length - 2, Math.ceil(hz * 2 ** (cents / 1200) * size / SR));
  let k = lo; for (let i = lo; i <= hi; i++) if (mag[i] > mag[k]) k = i;
  if (k === lo || k === hi) return null;   // no peak inside the window
  const a = Math.log(mag[k - 1] + 1e-30), b = Math.log(mag[k] + 1e-30), c = Math.log(mag[k + 1] + 1e-30);
  const p = (a - 2 * b + c) === 0 ? 0 : 0.5 * (a - c) / (a - 2 * b + c);
  return { hz: (k + p) * SR / size, amp: Math.exp(b - 0.25 * (a - c) * p) };
}
function measureZone(z, harmonic) {
  const x = f32(z.pcm);
  // The held part: from 0.15 s after the loudest moment, for up to 2 s (the piano's decays; the violin's holds)
  const W = Math.round(0.01 * SR); let peakI = 0, peakV = 0;
  for (let i = 0; i + W < Math.min(x.length, SR); i += W) { let s = 0; for (let j = 0; j < W; j++) s += x[i + j] ** 2; if (s > peakV) { peakV = s; peakI = i; } }
  const from = peakI + Math.round(0.15 * SR), len = Math.min(Math.round(2 * SR), x.length - from - Math.round(0.1 * SR));
  const sp = spectrum(x, from, len);
  // Partials, found one at a time with the window following the fit so far (a stiff string's are sharp)
  let a = z.rootHz ** 2, b = 0;   // f_n^2 / n^2 = a + b n^2
  const found = [];
  let maxAmp = 0;
  for (let n = 1; n <= 12 && n * z.rootHz < SR * 0.4; n++) {
    const predicted = n * Math.sqrt(Math.max(1, a + b * n * n));
    const pk = peakNear(sp, predicted, 45);
    if (!pk) continue;
    found.push({ n, ...pk });
    maxAmp = Math.max(maxAmp, pk.amp);
    const use = found.filter((q) => q.amp > maxAmp * 10 ** (-45 / 20));
    if (use.length >= 2) {
      // weighted least squares of y = f^2/n^2 on x = n^2
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const q of use) { const w = q.amp, X = q.n * q.n, Y = (q.hz / q.n) ** 2; sw += w; sx += w * X; sy += w * Y; sxx += w * X * X; sxy += w * X * Y; }
      const den = sw * sxx - sx * sx;
      if (harmonic) { b = 0; a = sy / sw; }
      else if (Math.abs(den) > 1e-12) { b = (sw * sxy - sx * sy) / den; a = (sy - b * sx) / sw; if (b < 0) { b = 0; a = sy / sw; } }
    } else if (use.length === 1) { a = (use[0].hz / use[0].n) ** 2; b = 0; }
  }
  const used = found.filter((q) => q.amp > maxAmp * 10 ** (-45 / 20));
  const f1 = Math.sqrt(a + b);
  return { root: z.root, rootHz: z.rootHz, cents: 1200 * Math.log2(f1 / z.rootHz), B: b / a, partials: used.length, strongest: used.length ? used.reduce((m, q) => (q.amp > m.amp ? q : m)).n : 0 };
}

let worst = 0;
for (const name of INSTRUMENTS) {
  const zones = await zonesOf(name);
  console.log(`\n== ${name} ${CHECK ? '(as the corrected instrument plays each root)' : '(as recorded)'}`);
  console.log('  zone   root Hz     cents     B        partials  strongest');
  const results = zones.map((z) => measureZone(z, HARMONIC.has(name)));
  for (const r of results) {
    worst = Math.max(worst, Math.abs(r.cents));
    console.log(`  ${r.root.padEnd(5)} ${r.rootHz.toFixed(3).padStart(9)}  ${r.cents.toFixed(2).padStart(7)}  ${r.B.toExponential(1).padStart(8)}   ${String(r.partials).padStart(3)}        ${r.strongest}`);
  }
  if (!DRY) {
    const file = join(ROOT, 'public', 'samples', name, 'manifest.json');
    const m = JSON.parse(readFileSync(file, 'utf8'));
    for (const z of m.zones) {
      const r = results.find((q) => q.root === z.root);
      if (r) z.tuneCents = Math.round(r.cents * 10) / 10;
    }
    writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
    console.log(`  written tuneCents into ${file}`);
  }
}
await browser.close();
if (CHECK) {
  console.log(`\nlargest remaining offset: ${worst.toFixed(2)} cents`);
  process.exit(worst <= 3 ? 0 : 1);   // the measure itself resolves a low, inharmonic string to about 3 cents
}
