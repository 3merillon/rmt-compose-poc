#!/usr/bin/env node
/**
 * What every instrument plays, measured offline (Phase I, step 1).
 *
 * Each registered instrument plays one note at a time, at three lengths (0.1, 0.6 and 4 s) and three pitches
 * (65.75, 263 and 1052 Hz: two octaves either side of 263), through the app's own instrument classes and its
 * own envelope (InstrumentManager.applyVoiceEnvelope), stopped where the AudioEngine stops it (the note's end
 * plus RELEASE_TAIL), on an OfflineAudioContext in headless Edge. No dev server: the page's requests for /src/**
 * and /samples/** are answered from the working tree, as in check-purity.mjs.
 *
 * Recorded per note, as numbers:
 *   - the RMS envelope (5 ms windows, dB re the note's own peak) and the gain curve the envelope schedules
 *     (a constant 1 through the same envelope on a second channel);
 *   - the envelope the workspace draws (envelopeShares, through the shader's own formula) and how far it is
 *     from the scheduled gain curve;
 *   - the level at the note's end, how long sound lasts after it, and whether the stop cuts sound off;
 *   - for long notes, the slope of the held part (dB/s: a piano string dies away, a held sample does not);
 *   - partials 1..12 (dB re the fundamental) early, mid and late in the note, and the spectral centroid;
 *   - the pitch: mean offset from the written frequency (cents) and the swing of the pitch track (vibrato).
 * And per sample zone (piano, violin): the recording's length and its own pitch at playback rate 1 against
 * the root the manifest gives it.
 *
 *   node scripts/perf/measure-instruments.mjs            # all instruments
 *   node scripts/perf/measure-instruments.mjs --only piano,violin
 * Writes scripts/perf/__visual__/instruments/{measure.json, summary.txt, <instrument>.svg}. Measures; does not listen.
 */
import type { Envelope, envelopeShares, envelopeTimes } from '../../src/instruments/instrument-manager.ts';
type Shares = ReturnType<typeof envelopeShares>;
type MeasureJob = { name: string; freq: number; dur: number; sr: number; pre: number; post: number; peak: number; tail: number };
type NoteRender = { shares: Shares; drawn: Shares; times: ReturnType<typeof envelopeTimes>; env: Envelope; zone: {root: string | null; rootHz: number; rate: number; seconds: number | null} | null; length: number; noteOff: boolean; pcm: string; gain: string };
type ZoneRender = {root: string | null; rootHz: number} & ({error: true} | {seconds: number; sampleRate: number; pcm: string});
declare global {interface Window { __m: {
  names(): Promise<string[]>;
  note(job: MeasureJob): Promise<NoteRender>;
  zones(job: Pick<MeasureJob, 'name' | 'sr'>): Promise<ZoneRender[]>;
} }}
import { browserAsset, diskTree } from './source-tree.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = <T extends string | null>(name: string, fallback: T) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const ROOT = resolve('.');
const OUT = flag('--out', 'scripts/perf/__visual__/instruments');
const ONLY = flag('--only', null)?.split(',');
const SR = 48000;
const PRE = 0.05;                 // the note starts this far into the render
const POST = 1.6;                 // and the render runs this far past its end
const PEAK = 0.2;                 // INITIAL_VOLUME, the per-note peak the player passes
const RELEASE_TAIL = 0.15;        // audio-engine.js: voice.stop(start + duration + RELEASE_TAIL)
const DURS = [0.1, 0.6, 4];
const FREQS = [263 / 4, 263, 263 * 4];
mkdirSync(OUT, { recursive: true });

const source = diskTree(ROOT);

async function openPage() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  !! console.${m.type()}:`, m.text()); });
  await page.route('**/*', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    if (path === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>measure</title>' });
    return route.fulfill(browserAsset(source, path));
  });
  await page.goto('http://harness.localhost/');
  await page.evaluate(installPage);
  return { browser, page };
}

// Runs in the page (serialized: no closures over this file).
function installPage() {
  const b64 = (f32: Float32Array) => {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const mods = () => Promise.all([
    import('/src/instruments/instrument-manager.js'),
    import('/src/instruments/synth-instruments.js'),
    import('/src/instruments/sample-instruments.js'),
  ]);
  const manager = async (ctx: BaseAudioContext) => {
    const [im, synth, sample] = await mods();
    const m = new im.InstrumentManager(ctx);
    m.registerBuiltInInstruments(synth.SynthInstruments, sample.SampleInstruments);
    for (const name of m.getAvailableInstruments()) { const i = m.getInstrument(name); if (i?.waitForLoad) await i.waitForLoad(); }
    return { m, im, sample };
  };
  window.__m = {
    async names() {
      const { m } = await manager(new OfflineAudioContext(1, 128, 48000));
      return m.getAvailableInstruments();
    },
    async note({ name, freq, dur, sr, pre, post, peak, tail }) {
      const ctx = new OfflineAudioContext(2, Math.ceil((pre + dur + post) * sr), sr);
      const { m, im, sample } = await manager(ctx);
      const inst = m.getInstrument(name)!;
      if (inst.prepare) await inst.prepare([freq]);
      const merger = ctx.createChannelMerger(2);
      merger.connect(ctx.destination);
      // Channel 0: the note.
      const voice = m.createOscillator(name, freq);
      const g = ctx.createGain(); g.gain.value = 0;
      m.applyEnvelope(name, g, pre, dur, peak, null, freq);
      // Stopped where the AudioEngine stops it: since Phase I after the note's tail
      // (voiceLength), before it at the note's end + RELEASE_TAIL.
      const noteOff = typeof m.voiceLength === 'function';
      const length = noteOff ? m.voiceLength(name, dur, null, freq) : dur + tail;
      voice.connect(g); g.connect(merger, 0, 0);
      voice.start(pre); voice.stop(pre + length);
      // Channel 1: the gain curve that envelope schedules (a constant 1 through it).
      const one = ctx.createConstantSource();
      const g2 = ctx.createGain(); g2.gain.value = 0;
      m.applyEnvelope(name, g2, pre, dur, peak, null, freq);
      one.connect(g2); g2.connect(merger, 0, 1);
      one.start(pre); one.stop(pre + length);
      const env = inst.getEnvelopeSettings ? (inst.getEnvelopeSettings(dur, freq) || {}) : {};
      const shares = im.envelopeShares(env, dur, null);
      // What the workspace draws inside the note: since Phase I the release lies after the end.
      const drawn = noteOff ? { ...shares, release: 0 } : shares;
      const times = im.envelopeTimes(env, dur, null);
      let zone = null;
      if (inst instanceof sample.PianoInstrument || inst instanceof sample.ViolinInstrument) {
        const z = inst._zoneFor(freq);
        zone = z && { root: z.root, rootHz: z.rootHz, rate: freq / z.rootHz, seconds: z.buffer ? z.buffer.duration : null };
      }
      const buf = await ctx.startRendering();
      return { shares, drawn, times, env, zone, length, noteOff, pcm: b64(buf.getChannelData(0)), gain: b64(buf.getChannelData(1)) };
    },
    // Every zone of a sampled instrument, decoded, as recorded (rate 1).
    async zones({ name, sr }) {
      const ctx = new OfflineAudioContext(1, 128, sr);
      const { m, sample } = await manager(ctx);
      const inst = m.getInstrument(name)!;
      const out: ZoneRender[] = [];
      if (!(inst instanceof sample.PianoInstrument || inst instanceof sample.ViolinInstrument)) return out;
      for (const z of inst.zones || []) {
        const buf = await inst._decodeZone(z);
        if (!buf) { out.push({ root: z.root, rootHz: z.rootHz, error: true }); continue; }
        out.push({ root: z.root, rootHz: z.rootHz, seconds: buf.duration, sampleRate: buf.sampleRate, pcm: b64(buf.getChannelData(0)) });
      }
      return out;
    },
  };
}

// ───────────────────────────── analysis (Node) ─────────────────────────────

const f32 = (s: string) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const dB = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200);

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
// Magnitude spectrum of x[from, from+len) with a Hann window, zero-padded to `size`.
function spectrum(x: Float32Array, from: number, len: number, size: number) {
  const re = new Float64Array(size), im = new Float64Array(size);
  let wsum = 0;
  for (let i = 0; i < len && from + i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1));
    re[i] = (x[from + i] || 0) * w; wsum += w;
  }
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) mag[k] = 2 * Math.hypot(re[k], im[k]) / wsum;
  return mag;
}
// The strongest bin within ±`cents` of `hz`, interpolated: [Hz, amplitude].
function peakNear(mag: Float64Array, size: number, sr: number, hz: number, cents = 60) {
  const lo = Math.max(1, Math.floor(hz * 2 ** (-cents / 1200) * size / sr));
  const hi = Math.min(mag.length - 2, Math.ceil(hz * 2 ** (cents / 1200) * size / sr));
  let k = lo;
  for (let i = lo; i <= hi; i++) if (mag[i] > mag[k]) k = i;
  const a = Math.log(mag[k - 1] + 1e-30), b = Math.log(mag[k] + 1e-30), c = Math.log(mag[k + 1] + 1e-30);
  const p = (a - 2 * b + c) === 0 ? 0 : 0.5 * (a - c) / (a - 2 * b + c);
  return [(k + p) * sr / size, Math.exp(b - 0.25 * (a - c) * p)];
}
const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(n));

function rmsTrack(x: Float32Array, sr: number, win = 0.005) {
  const n = Math.round(win * sr), out = [];
  for (let i = 0; i + n <= x.length; i += n) {
    let s = 0;
    for (let j = 0; j < n; j++) s += x[i + j] * x[i + j];
    out.push(Math.sqrt(s / n));
  }
  return out;
}
// The shader's level at share x (renderer.js rectBorderFS), 0 outside [0, 1].
function drawnLevel(sh: Shares, x: number) {
  if (x < 0 || x > 1) return 0;
  const atk = Math.max(sh.attack, 1e-5), dec = sh.decay, sus = sh.sustain, rel = Math.max(sh.release, 1e-5);
  if (x < atk) return x / atk;
  if (x < atk + dec) return 1 + (sus - 1) * (x - atk) / Math.max(dec, 1e-5);
  if (x < 1 - rel) return sus;
  return sus * Math.min(1, Math.max(0, (1 - x) / rel));
}

function analyseNote(r: NoteRender, { freq, dur }: Pick<MeasureJob, 'freq' | 'dur'>) {
  const x = f32(r.pcm), gain = f32(r.gain);
  const W = 0.005, rms = rmsTrack(x, SR, W);
  const peak = Math.max(...rms);
  const at = (t: number) => rms[Math.min(rms.length - 1, Math.max(0, Math.floor(t / W)))] || 0;
  const rel = (v: number) => dB(v / peak);
  const tPeak = rms.indexOf(peak) * W - PRE;
  const end = PRE + dur, stop = PRE + r.length;
  // Where sound inside the note last stands above -50 dB re peak: a sample shorter than the note dies before it.
  let lastLoud = Math.floor(PRE / W);
  for (let i = Math.floor(PRE / W); i < Math.floor(end / W); i++) if (rel(rms[i]) > -50) lastLoud = i;
  const soundEnd = Math.min(end, (lastLoud + 1) * W);
  const silentBeforeEnd = end - soundEnd > 0.06 ? +(end - soundEnd).toFixed(2) : 0;
  // Sound after the end: first window after `end` below -60 dB re peak.
  let ringTo = null;
  for (let i = Math.ceil(end / W); i < rms.length; i++) if (rel(rms[i]) < -60) { ringTo = i * W - end; break; }
  // Gain curve against the drawn shares (both relative to peak gain).
  let gpk = 0; for (const v of gain) if (v > gpk) gpk = v;
  let maxDrawErr = 0, maxDrawErrAt = 0;
  for (let i = Math.floor(PRE * SR); i < Math.floor(end * SR); i += 24) {
    const share = (i / SR - PRE) / dur;
    const e = Math.abs(gain[i] / gpk - drawnLevel(r.drawn, share));
    if (e > maxDrawErr) { maxDrawErr = e; maxDrawErrAt = share; }
  }
  // Heard level (RMS, normalised) against drawn, at quarter points of the note.
  const heardVsDrawn = [0.25, 0.5, 0.75, 0.95].map((s) => ({
    share: s, drawn: +drawnLevel(r.drawn, s).toFixed(3), scheduledGain: +(gain[Math.floor((PRE + s * dur) * SR)] / gpk).toFixed(3),
    heard: +(at(PRE + s * dur) / peak).toFixed(3),
  }));
  // Held-part slope (long notes): dB/s between 0.4 s and the start of the release.
  let holdSlope = null;
  if (dur >= 2) {
    const t1 = PRE + 0.4, t2 = Math.min(PRE + dur - (r.noteOff ? 0 : r.times.release) - 0.05, soundEnd - 0.1);
    holdSlope = (rel(at(t2)) - rel(at(t1))) / (t2 - t1);
  }
  // Spectrum: early (30 ms in), middle, late (just before the release).
  const spec = (t: number) => {
    const len = Math.min(Math.round(Math.max(0.04, Math.min(0.25, dur * 0.4)) * SR), 12000);
    const from = Math.max(0, Math.round(t * SR - len / 2));
    const size = pow2(len * 4);
    const mag = spectrum(x, from, len, size);
    const f0 = peakNear(mag, size, SR, freq, 40)[1];
    const partials = [];
    let num = 0, den = 0;
    for (let n = 1; n <= 12; n++) {
      if (n * freq > SR * 0.45) break;
      const a = peakNear(mag, size, SR, n * freq, 40)[1];
      partials.push(+(dB(a / f0)).toFixed(1));
      num += n * a * a; den += a * a;
    }
    return { at: +(t - PRE).toFixed(3), partials, centroid: +(num / den).toFixed(2) };
  };
  const relIn = r.noteOff ? 0 : r.times.release;   // release inside the note (before Phase I only)
  const spectra = [spec(PRE + Math.min(0.03, dur * 0.3)), spec(PRE + dur * 0.5), spec(Math.min(PRE + Math.max(dur * 0.5, dur - relIn - 0.06), soundEnd - 0.06))];
  // Pitch: mean over the middle of the note (long notes) and the pitch track's swing.
  let pitch = null;
  if (dur >= 0.6) {
    const t1 = PRE + 0.15, t2 = Math.min(PRE + dur - Math.max(0.15, (r.noteOff ? 0 : r.times.release) + 0.05), soundEnd - 0.1);
    const len = Math.round((t2 - t1) * SR), size = pow2(len * 4);
    const mag = spectrum(x, Math.round(t1 * SR), len, size);
    // The mean pitch from the strongest of partials 1..4 (a low piano string's fundamental is weak; a sine has
    // only the first); n <= 4 keeps a piano string's inharmonicity small. The track follows the strongest partial
    // up to about 1 kHz, finer in cents than the fundamental of a low note.
    const strongest = (maxN: number) => {
      let best = 1, amp = 0;
      for (let k = 1; k <= maxN && k * freq < SR * 0.45; k++) { const a = peakNear(mag, size, SR, k * freq, 40)[1]; if (a > amp) { amp = a; best = k; } }
      return best;
    };
    const pn = strongest(4);
    const hz = peakNear(mag, size, SR, pn * freq, 60)[0] / pn;
    const n = strongest(Math.max(1, Math.round(1000 / freq))), fl = Math.round(0.08 * SR), fsz = pow2(fl * 8);
    const track = [];
    for (let s = Math.round(t1 * SR); s + fl <= Math.round(t2 * SR); s += Math.round(0.02 * SR)) {
      const m = spectrum(x, s, fl, fsz);
      track.push(1200 * Math.log2(peakNear(m, fsz, SR, n * freq, 60)[0] / (n * freq)));
    }
    pitch = { cents: +(1200 * Math.log2(hz / freq)).toFixed(2), swingCents: track.length ? +(Math.max(...track) - Math.min(...track)).toFixed(1) : null, trackedPartial: n, meanPartial: pn };
  }
  // Downsampled RMS envelope for the figure (dB re peak), 10 ms steps.
  const curve = [];
  for (let i = 0; i < rms.length; i += 2) curve.push(+Math.max(-80, rel(rms[i])).toFixed(1));
  return {
    freq, dur, zone: r.zone, envTimes: r.times, shares: r.shares, drawn: r.drawn, voiceLength: r.length,
    tPeak: +tPeak.toFixed(3),
    endDb: +rel(at(end - W)).toFixed(1), silentBeforeEnd,
    ringAfterEnd: ringTo == null ? null : +ringTo.toFixed(3),
    atStopDb: +rel(at(stop - W)).toFixed(1),
    maxDrawErr: +maxDrawErr.toFixed(3), maxDrawErrAt: +maxDrawErrAt.toFixed(3),
    heardVsDrawn, holdSlope: holdSlope == null ? null : +holdSlope.toFixed(1),
    spectra, pitch, curve,
  };
}

function analyseZone(z: ZoneRender) {
  if ('error' in z) return z;
  const x = f32(z.pcm), sr = z.sampleRate;
  const W = 0.01, rms = rmsTrack(x, sr, W), peak = Math.max(...rms);
  const tPeak = rms.indexOf(peak) * W;
  const t1 = Math.min(tPeak + 0.3, z.seconds * 0.3), t2 = Math.min(z.seconds - 0.2, t1 + 2.5);
  const len = Math.round((t2 - t1) * sr), size = pow2(len * 4);
  const mag = spectrum(x, Math.round(t1 * sr), len, size);
  const pn = Math.min(4, Math.max(1, Math.round(130 / z.rootHz)));
  const hz = peakNear(mag, size, sr, pn * z.rootHz, 80)[0] / pn;
  // Level over the recording: dB re peak at 1, 2, 3 s.
  const lvl = [0.5, 1, 2, 3].map((t) => +dB((rms[Math.floor(t / W)] || 0) / peak).toFixed(1));
  // Pitch swing (vibrato), 80 ms frames on the partial nearest 1 kHz.
  const n = Math.max(1, Math.round(1000 / z.rootHz)), fl = Math.round(0.08 * sr), fsz = pow2(fl * 8), track = [];
  for (let s = Math.round(t1 * sr); s + fl <= Math.round(t2 * sr); s += Math.round(0.02 * sr)) {
    track.push(1200 * Math.log2(peakNear(spectrum(x, s, fl, fsz), fsz, sr, n * z.rootHz, 80)[0] / (n * z.rootHz)));
  }
  return { root: z.root, rootHz: z.rootHz, seconds: +z.seconds.toFixed(2), centsOffRoot: +(1200 * Math.log2(hz / z.rootHz)).toFixed(1),
    swingCents: +(Math.max(...track) - Math.min(...track)).toFixed(1), levelDbAt_0_5_1_2_3s: lvl };
}

// ───────────────────────────── figures ─────────────────────────────

function svgFor(name: string, results: ReturnType<typeof analyseNote>[]) {
  const Wd = 900, Hrow = 150, pad = 40;
  const rows = DURS.map((d) => results.find((r) => r.dur === d && r.freq === 263)).filter(r => r !== undefined);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${rows.length * Hrow + 30}" font-family="sans-serif" font-size="11">`;
  s += `<rect width="100%" height="100%" fill="#fff"/><text x="${pad}" y="16" font-size="13">${name} at 263 Hz: heard RMS (blue, dB re peak, 0 to -60) and drawn envelope (orange, the same scale as dB of its gain); grey = written note</text>`;
  rows.forEach((r, i) => {
    const y0 = 30 + i * Hrow, h = Hrow - 30, span = PRE + r.dur + POST;
    const X = (t: number) => pad + (t / span) * (Wd - 2 * pad), Y = (db: number) => y0 + (Math.min(0, Math.max(-60, db)) / -60) * h;
    s += `<rect x="${X(PRE)}" y="${y0}" width="${X(PRE + r.dur) - X(PRE)}" height="${h}" fill="#eee"/>`;
    s += `<line x1="${X(PRE + r.voiceLength)}" x2="${X(PRE + r.voiceLength)}" y1="${y0}" y2="${y0 + h}" stroke="#c00" stroke-dasharray="3,3"/>`;
    s += `<text x="${pad}" y="${y0 + h + 14}">${r.dur} s note (red dash: voice stopped)</text>`;
    s += `<polyline fill="none" stroke="#1565c0" stroke-width="1.3" points="${r.curve.map((v, k: number) => `${X(k * 0.01).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
    const pts = [];
    for (let k = 0; k <= 400; k++) { const t = PRE + (k / 400) * r.dur; pts.push(`${X(t).toFixed(1)},${Y(dB(drawnLevel(r.drawn, k / 400))).toFixed(1)}`); }
    s += `<polyline fill="none" stroke="#ef6c00" stroke-width="1.3" points="${pts.join(' ')}"/>`;
    for (const db of [0, -20, -40, -60]) s += `<text x="4" y="${Y(db) + 4}" fill="#777">${db}</text>`;
  });
  return s + '</svg>';
}

// ───────────────────────────── run ─────────────────────────────

const { browser, page } = await openPage();
const names = (await page.evaluate(() => window.__m.names())).filter((n) => !ONLY || ONLY.includes(n));
const all = { sampleRate: SR, peak: PEAK, releaseTail: RELEASE_TAIL, instruments: {} as Record<string, ReturnType<typeof analyseNote>[]>, zones: {} as Record<string, ReturnType<typeof analyseZone>[]> };
const lines: string[] = [];
const out = (s: string) => { lines.push(s); console.log(s); };
for (const name of names) {
  const results = [];
  for (const freq of FREQS) for (const dur of DURS) {
    const r = await page.evaluate((a) => window.__m.note(a), { name, freq, dur, sr: SR, pre: PRE, post: POST, peak: PEAK, tail: RELEASE_TAIL });
    results.push(analyseNote(r, { freq, dur }));
  }
  all.instruments[name] = results;
  writeFileSync(join(OUT, `${name}.svg`), svgFor(name, results));
  out(`\n== ${name}`);
  out('  Hz      dur   atk(s) rel(s) tPeak  end dB  dead-before-end  ring>60dB  atStop dB  hold dB/s  drawErr  cents  swing  centroid early/mid/late');
  for (const r of results) {
    out(`  ${r.freq.toFixed(1).padStart(6)} ${String(r.dur).padStart(5)}  ${r.envTimes.attack.toFixed(3)}  ${r.envTimes.release.toFixed(3)}  ${r.tPeak.toFixed(3)}  ${String(r.endDb).padStart(6)}  ${String(r.silentBeforeEnd).padStart(5)}  ${String(r.ringAfterEnd).padStart(9)}  ${String(r.atStopDb).padStart(9)}  ${String(r.holdSlope).padStart(9)}  ${r.maxDrawErr.toFixed(3)}  ${r.pitch ? String(r.pitch.cents).padStart(5) : '    -'}  ${r.pitch ? String(r.pitch.swingCents).padStart(5) : '    -'}  ${r.spectra.map((s) => s.centroid).join('/')}${r.zone ? `  zone ${r.zone.root} rate ${r.zone.rate.toFixed(3)} (${(1200 * Math.log2(r.zone.rate)).toFixed(0)} c)` : ''}`);
  }
  if (['piano', 'violin'].includes(name)) {
    const zs = (await page.evaluate((a) => window.__m.zones(a), { name, sr: SR })).map(analyseZone);
    all.zones[name] = zs;
    out(`  zones (as recorded): root  Hz  seconds  cents-off-root  swing  level dB at 0.5/1/2/3 s`);
    for (const z of zs) if ('error' in z) out(`    ${z.root}: sample decode failed`); else out(`    ${z.root} ${z.rootHz} ${z.seconds}s  ${z.centsOffRoot}c  swing ${z.swingCents}c  ${z.levelDbAt_0_5_1_2_3s.join(' ')}`);
  }
}
writeFileSync(join(OUT, 'measure.json'), JSON.stringify(all));
writeFileSync(join(OUT, 'summary.txt'), lines.join('\n') + '\n');
await browser.close();
console.log(`\nwritten ${OUT}/{measure.json, summary.txt, *.svg}`);
