#!/usr/bin/env node
/**
 * Measures the loudest cue that tells a pure interval from a tempered one, and that nothing else moved.
 *
 * The app plays exact frequency ratios. Two notes a ratio p/q apart share an overtone (partial p of the lower is
 * partial q of the upper), and that overtone stands still when the interval is pure and beats when it is not. It
 * is the most salient cue to tuning, and it needs a voice that has those partials and holds them steady. This
 * renders intervals through the real AudioEngine, on an OfflineAudioContext in a headless browser, and reads the
 * result as numbers:
 *
 *   UNCHANGED   (--compare <git-ref>) every instrument that exists in <git-ref> renders the same from the working
 *               tree: single-source notes bit for bit, and a five-note figure through the dry chain, the default chain
 *               (reverb, limiter) and with stereo on to within the browser's own rounding (ROUNDING, below).
 *   TEMPERED   Settings → Audio → Tempered hands the instruments base·2^(round(12·log2(f/base))/12) and changes
 *               nothing else; off, it hands them the module's own frequencies.
 *   VOICES      The harmonium voices are what they claim: partials 1…16 all present and none beyond, each one
 *               steady (no detune, no vibrato), attack and release the same milliseconds whatever the note's length.
 *   PURITY      A major third, a fifth, a harmonic seventh and an eleventh harmonic, two seconds each, pure and then
 *               with the switch on. For the ratio p/q the lower note's partial p and the upper note's partial q fall
 *               on one frequency; the amplitude of that band is followed through the held note and its swing reported
 *               (peak-to-trough, dB). Pure: it stands still. Tempered: it beats.
 *   SINES       The same switch on sine-wave, reported and not judged. A sine chord has no shared partial, so the
 *               measure above has nothing to read there. That is a limit of the measure, not of the sound: pure
 *               against tempered is audible on sines, in the pitches themselves and in the difference tones the
 *               ear adds, and neither of those is an envelope in the signal. What the signal does show is printed:
 *               the pitches handed over, and how far the waveform's peak and level move through a held triad.
 *
 * No dev server is needed: the page's requests for /src/** and /samples/** are answered from the working tree, or
 * from `git show <ref>:…` for the comparison. Chromium is used if Playwright has it, otherwise Edge or Chrome.
 *
 *   node scripts/perf/check-purity.mjs
 *   node scripts/perf/check-purity.mjs --compare HEAD     # also: before against after
 *   node scripts/perf/check-purity.mjs --wav              # also write the thirds as .wav files, to listen to
 *
 * Options: --base <Hz> (263)  --out <dir> (scripts/perf/__visual__/purity)  --channel <msedge|chrome>
 * Exit code 1 if any check fails. This measures; it does not listen.
 *
 * ROUNDING. Web Audio does not fix the order in which a node sums its inputs, and float addition is not
 * associative. As soon as three or more voices overlap (or one voice is three oscillators, as vibraphone is), two renders of the SAME code can differ by a unit in the last place of a float32: 6e-8, about
 * −138 dB re the peak, and up to 1e-6 once a filter has recirculated it. One or two single-source voices render
 * bit-identically. So "unchanged" is asserted bit for bit where that is possible and to within TOLERANCE elsewhere,
 * and the working tree is rendered twice to show what the browser alone does. A real change is far larger: a
 * frequency one float32 step off is 7e-5 out of phase within two seconds.
 */
import { browserAsset, diskTree, gitTree } from './source-tree.ts';
import type { Browser, Page } from 'playwright';
import type { EvaluationRecord } from '../../src/model-types.ts';
import type { PreparedNote } from '../../src/player/audio-engine.ts';

interface Tone { id: number; instrument: string; freq: number[]; start: number[]; dur: number[] }
type Settings = Record<string, boolean>;
interface RenderJob { notes: Tone[]; base: number[]; seconds: number; sampleRate: number; settings?: Settings; volume?: number; mono?: boolean }
interface Render { t0: number; sources: number; handed: [string | null, number][]; applied: Record<string, unknown>; registered: string[]; list: PreparedNote[]; pcm: string[] }
interface EnvelopeJob { instrument: string; dur: number; sampleRate: number; peak?: number }
interface VoiceDescription { name: string; partials: number[] | null; attackSec: number | null; releaseSec: number | null; level: number | null }
declare global { interface Window { __h: {
  render(job: RenderJob): Promise<Render>;
  envelope(job: EnvelopeJob): Promise<{ start: number; pcm: string }>;
  describe(instrument: string): Promise<VoiceDescription | null>;
} } }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = <T extends string | number | null>(name: string, fallback: T) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name: string) => argv.includes(name);

const ROOT = resolve('.');
const OUT = flag('--out', 'scripts/perf/__visual__/purity');
const COMPARE = flag('--compare', null);
const CHANNEL = flag('--channel', null);
const BASE = Number(flag('--base', 263));          // Hz; the BaseNote of the test module (must be a whole number)
const WAV = has('--wav');
const SR = 48000;
const VOLUME = 0.2;                                 // the per-note peak player.js passes (INITIAL_VOLUME)
if (!Number.isInteger(BASE) || BASE <= 0) { console.error('--base must be a whole number of Hz'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const NEW_VOICES = ['harmonium', 'harmonium-soft'];
// The voices they are measured against: in the interval table, and (a longer list) for which partials each has.
const CONTEXT_VOICES = ['sine-wave', 'organ', 'sawtooth-wave'];
const SPECTRUM_VOICES = ['sine-wave', 'triangle-wave', 'square-wave', 'sawtooth-wave', 'organ'];
const INTERVALS: [number, number, string][] = [[5, 4, 'major third'], [3, 2, 'fifth'], [7, 4, 'harmonic seventh'], [11, 8, 'eleventh harmonic']];

const checks: {name: string; pass: boolean; detail: string}[] = [];
const check = (name: string, pass: boolean, detail?: string) => {
  checks.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ───────────────────────────────────── a page that is the app's audio code and nothing else ─────────────────────

const fromDisk = diskTree;
const fromGit = gitTree;

async function launch() {
  const tries = CHANNEL ? [{ channel: CHANNEL }] : [{}, { channel: 'msedge' }, { channel: 'chrome' }];
  let last;
  for (const opts of tries) {
    try { return await chromium.launch({ headless: true, ...opts }); } catch (e) { last = e; }
  }
  throw last;
}

async function openHarness(browser: Browser, source: ReturnType<typeof diskTree>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => { problems.push(e.message); console.log('  !! pageerror:', e.message); });
  // A warning counts too: a sample that fails to decode only warns, and then plays as a sine.
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    problems.push(m.text());
    console.log(`  !! console.${m.type()}:`, m.text());
  });
  await page.route('**/*', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    // The source imports the bare package `fraction.js`: an import map resolves it to node_modules.
    if (path === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>rmt audio harness</title><script type="importmap">{"imports":{"fraction.js":"/node_modules/fraction.js/dist/fraction.mjs"}}</script>' });
    if (path.startsWith('node_modules/')) { const f = resolve(ROOT, path); return existsSync(f) ? route.fulfill({ contentType: 'text/javascript', body: readFileSync(f) }) : route.fulfill({ status: 404, body: '' }); }
    if (path === 'favicon.ico') return route.fulfill({ contentType: 'image/x-icon', body: '' });
    // /src/** is the source tree; everything else is served from public/, as Vite does.
    return route.fulfill(browserAsset(source, path));
  });
  await page.goto('http://harness.localhost/');
  await page.evaluate(installHarness);
  return { page, problems, close: () => context.close() };
}

// Runs in the page. Self-contained: it is serialized, so it may not close over anything in this file.
async function installHarness() {
  // The reverb's impulse response is noise from Math.random. Seeded, the same IR comes out every time, so two
  // renders through the default chain can be compared sample for sample.
  let state = 1;
  Math.random = () => {
    let t = (state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const reseed = (s: number) => { state = s >>> 0; };

  // The evaluator hands the engine exact fractions with BigInt fields; so does this.
  const { default: Fraction } = await import('fraction.js');
  const frac = ([n, d]: number[]) => new Fraction(n, d);
  const num = ([n, d]: number[]) => n / d;
  const base64 = (f32: Float32Array) => {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const load = () => Promise.all([
    import('/src/player/audio-engine.js'),
    import('/src/instruments/synth-instruments.js'),
    import('/src/instruments/sample-instruments.js'),
    import('/src/settings/settings-store.js'),
  ]);

  // The instruments alone, on a context of their own.
  const manager = async (ctx: BaseAudioContext) => {
    const [{ InstrumentManager }, synth, sample] = await Promise.all([
      import('/src/instruments/instrument-manager.js'),
      import('/src/instruments/synth-instruments.js'),
      import('/src/instruments/sample-instruments.js'),
    ]);
    const im = new InstrumentManager(ctx);
    im.registerBuiltInInstruments(synth.SynthInstruments, sample.SampleInstruments);
    return im;
  };

  window.__h = {
    /**
     * Render notes through the real AudioEngine: preparePlayback() on a stand-in module whose evaluation cache
     * holds exact fractions, then play(), on an OfflineAudioContext.
     * notes: [{ id, instrument, freq: [n, d] (Hz), start: [n, d] (s), dur: [n, d] (s) }]
     */
    async render({ notes, base, seconds, sampleRate, settings = {}, volume = 0.2, mono = false }) {
      const [{ AudioEngine }, synth, sample, { settingsStore }] = await load();

      // Every render starts from factory settings, so no render depends on the one before it.
      settingsStore.resetAll();
      for (const [path, value] of Object.entries(settings)) settingsStore.set(path, value);
      const applied: Record<string, unknown> = {};
      for (const path of Object.keys(settings)) applied[path] = settingsStore.get(path);

      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
      // preparePlayback() resumes a suspended context. An offline context is "suspended" until it renders and
      // rejects resume() before that, which would leave the promise hanging.
      ctx.resume = () => Promise.resolve();
      const RealAudioContext = window.AudioContext;
      Object.defineProperty(window, 'AudioContext', { value: function () { return ctx; }, configurable: true, writable: true });
      let engine;
      try { engine = new AudioEngine({ initialVolume: volume }); } finally { window.AudioContext = RealAudioContext; }
      engine.registerInstruments(synth.SynthInstruments, sample.SampleInstruments);

      // The module as the engine sees it: notes by id (0 is the BaseNote), an evaluation cache, an instrument per note.
      const cache = new Map<number, Partial<EvaluationRecord>>([[0, { startTime: frac([0, 1]), frequency: frac(base) }]]);
      type FixtureNote = { id: number; instrument?: string };
      const moduleNotes: Record<number, FixtureNote> = { 0: { id: 0 } };
      let end = 0;
      for (const n of notes) {
        cache.set(n.id, { startTime: frac(n.start), duration: frac(n.dur), frequency: frac(n.freq) });
        moduleNotes[n.id] = { id: n.id, instrument: n.instrument };
        end = Math.max(end, num(n.start) + num(n.dur));
      }
      const module = {
        notes: moduleNotes,
        baseNote: moduleNotes[0],
        getModuleEndTime: () => end,
        getEvaluationCache: () => cache,
        findInstrument: (note: FixtureNote) => note.instrument!,
      };

      // What the engine hands to the instruments, in the order it hands it.
      const handed: Render["handed"] = [];
      const im = engine.instrumentManager;
      const create = im.createOscillator.bind(im);
      im.createOscillator = (name, hz) => { handed.push([name, hz]); return create(name, hz); };

      const list = await engine.preparePlayback(module, 0);
      if (settingsStore.get('audio.reverb.enabled')) {
        reseed(0x5eed);
        await engine.graph._regenIR(settingsStore.get('audio.reverb'));
      }
      // Count the sources actually used for this take. A preset can have a
      // different implementation in the compared revision (e.g. unison).
      let sources = 0;
      const oscillator = ctx.createOscillator.bind(ctx);
      const bufferSource = ctx.createBufferSource.bind(ctx);
      ctx.createOscillator = () => { sources++; return oscillator(); };
      ctx.createBufferSource = () => { sources++; return bufferSource(); };
      const t0 = engine.play(list, { initialVolume: volume });
      const buffer = await ctx.startRendering();
      try { engine.graph.dispose(); } catch {}

      return {
        t0, sources, handed, applied,
        registered: im.getAvailableInstruments(),
        list: list.map((n) => ({ ...n })),
        pcm: mono ? [base64(buffer.getChannelData(0))] : [base64(buffer.getChannelData(0)), base64(buffer.getChannelData(1))],
      };
    },

    /** The gain curve an instrument's envelope draws for one note: a constant 1 through that envelope. */
    async envelope({ instrument, dur, sampleRate, peak = 1 }) {
      const start = 0.1;
      const ctx = new OfflineAudioContext(1, Math.ceil((start + dur + 0.2) * sampleRate), sampleRate);
      const im = await manager(ctx);
      const one = ctx.createConstantSource();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      im.applyEnvelope(instrument, gain, start, dur, peak);
      one.connect(gain);
      gain.connect(ctx.destination);
      one.start(0);
      const buffer = await ctx.startRendering();
      return { start, pcm: base64(buffer.getChannelData(0)) };
    },

    /** How a harmonic voice declares itself in the source (null fields on a voice that declares nothing). */
    async describe(instrument: string) {
      const im = await manager(new OfflineAudioContext(1, 128, 48000));
      const voice = im.instruments.get(instrument);
      if (!voice) return null;
      return {
        name: voice.name,
        partials: 'partials' in voice && Array.isArray(voice.partials) ? Array.from(voice.partials) : null,
        attackSec: 'attackSec' in voice && typeof voice.attackSec === 'number' ? voice.attackSec : null,
        releaseSec: 'releaseSec' in voice && typeof voice.releaseSec === 'number' ? voice.releaseSec : null,
        level: 'level' in voice && typeof voice.level === 'number' ? voice.level : null,
      };
    },
  };
}

// ───────────────────────────────────── reading a render ─────────────────────────────────────

function decode(b64: string) {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = bytes.readFloatLE(i * 4);
  return out;
}
const sha = (channels: string[]) => { const h = createHash('sha256'); for (const c of channels) h.update(Buffer.from(c, 'base64')); return h.digest('hex'); };
const db = (ratio: number) => 20 * Math.log10(ratio);
const rmsOf = (x: Float32Array, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const peakOf = (x: Float32Array) => { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };

/**
 * The amplitude of the band around `fc`, through time: multiply by e^(−2πi·fc·t) and average under a Hann window
 * `win` seconds long, every `hop` seconds. A sinusoid of amplitude A at fc reads A.
 *
 * Two partials that straddle fc symmetrically pass with the same gain, so the DEPTH of the beat between them is
 * exact, not smoothed: the averaging is done on the complex signal, before the magnitude is taken. Anything further
 * from fc than 2/win is rejected; with win a whole number of periods of every tone present, exactly.
 */
function bandEnvelope(x: Float32Array, sr: number, fc: number, win: number, hop = 0.0005) {
  const N = win * sr, n = Math.floor(N);
  const w = new Float64Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) { w[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / N); sum += w[k]; }
  const step = Math.max(1, Math.round(hop * sr)), dphi = (2 * Math.PI * fc) / sr;
  const t = [], a = [];
  for (let i0 = 0; i0 + n <= x.length; i0 += step) {
    let re = 0, im = 0;
    for (let k = 0; k < n; k++) { const v = x[i0 + k] * w[k], ph = dphi * (i0 + k); re += v * Math.cos(ph); im -= v * Math.sin(ph); }
    t.push((i0 + n / 2) / sr);
    a.push((2 * Math.hypot(re, im)) / sum);
  }
  return { t, a };
}
// The swing of an envelope between two times: its highest and lowest value, and the ratio between them.
function swing(env: ReturnType<typeof bandEnvelope>, from: number, to: number) {
  let max = 0, min = Infinity, total = 0, count = 0;
  for (let i = 0; i < env.t.length; i++) {
    if (env.t[i] < from || env.t[i] > to) continue;
    max = Math.max(max, env.a[i]); min = Math.min(min, env.a[i]); total += env.a[i]; count++;
  }
  return { max, min, mean: count ? total / count : 0, p2t: min > 0 ? db(max / min) : Infinity, count };
}
// The power in each frequency bin (0 … N/2 − 1, bin k is k·SR/N Hz) of N samples under a Hann window. N is a
// power of two.
function powerSpectrum(x: Float32Array, from: number, N: number) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[from + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let i = 1, j = 0; i < N; i++) {                      // bit reversal (the input is real: im is still zero)
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {                  // radix-2 FFT
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const power = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}
// A-weighted level of a stretch of signal, dB re full scale: a rough stand-in for loudness (IEC 61672 curve), so
// that a bright voice and a dull one can be compared at all. Uses the largest power of two samples that fit.
function aWeightedDb(x: Float32Array, from: number, to: number) {
  const N = 2 ** Math.floor(Math.log2(to - from)), power = powerSpectrum(x, from, N);
  let sum = 0;
  for (let k = 1; k < N / 2; k++) {
    const f2 = ((k * SR) / N) ** 2;
    const a = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)) * 10 ** (2 / 20);
    sum += 2 * power[k] * a * a;
  }
  return 10 * Math.log10(sum / (N * N * 0.375));            // 0.375: mean square of the Hann window
}
// The strongest thing in a spectrum that is not a partial of `f0`, dB re the strongest partial: what aliasing
// (partials folded back from above half the sample rate) or any other by-product would show up as. A partial
// owns the bins within `guard` Hz of it; that far out, the Hann window's own skirt is more than 120 dB down.
function strayDb(x: Float32Array, from: number, N: number, f0: number, guard = 150) {
  const power = powerSpectrum(x, from, N), bin = SR / N;
  let partial = 0, stray = 0;
  for (let k = Math.ceil(guard / bin); k < N / 2; k++) {
    const nearest = Math.round((k * bin) / f0) * f0;
    if (nearest > 0 && Math.abs(k * bin - nearest) <= guard) partial = Math.max(partial, power[k]);
    else stray = Math.max(stray, power[k]);
  }
  return 10 * Math.log10(stray / partial);
}
// The same pitch on the nearest key of a keyboard tuned from `baseHz`, written independently of the app's code.
const keyOf = (hz: number, baseHz: number) => baseHz * 2 ** (Math.round(12 * Math.log2(hz / baseHz)) / 12);

function writeWav(file: string, x: Float32Array, sr: number) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24);
  head.writeUInt32LE(sr * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}

// ───────────────────────────────────── the renders ─────────────────────────────────────

const DRY = { 'audio.reverb.enabled': false, 'audio.limiter.enabled': false };
const hz = (n: number, d = 1) => [BASE * n, d];   // a ratio of the BaseNote as an exact fraction of Hz

// One figure that reaches the corners of every instrument: long and short notes (the envelope floors and the
// squeeze of attack + release into a short note), a low note (the filter's 200 Hz floor, the lowest sample zone)
// and a high one, and notes that overlap. Every start is inside the scheduler's first batch.
const FIGURE = (instrument: string) => [
  { id: 1, instrument, freq: hz(1), start: [0, 1], dur: [3, 2] },
  { id: 2, instrument, freq: hz(5, 4), start: [1, 4], dur: [3, 4] },
  { id: 3, instrument, freq: hz(3, 2), start: [1, 2], dur: [1, 10] },
  { id: 4, instrument, freq: hz(1, 4), start: [0, 1], dur: [2, 1] },
  { id: 5, instrument, freq: hz(27, 4), start: [1, 1], dur: [1, 2] },
];
const CHAINS = {
  dry: DRY,
  default: {},
  stereo: { 'audio.reverb.enabled': false, 'audio.stereo.enabled': true },
};

const TOLERANCE = 1e-5;   // of full scale (−100 dBFS); see ROUNDING in the header
// The fields a prepared note had before this change, for the note-list comparison.
const oldFields = ({ id, startTime, duration, frequency, instrument, panPos }: PreparedNote) => ({ id, startTime, duration, frequency, instrument, panPos });

// For each instrument: the figure through each chain, then each of its notes alone through the dry chain.
type Figure = { hash: string; sources: number; left: Float32Array; right: Float32Array; rms: number; list: ReturnType<typeof oldFields>[]; handed: Render['handed'] };
async function renderFigures(page: Page, instruments: string[]) {
  const out: Record<string, Figure> = {};
  const run = async (key: string, notes: Tone[], settings: Settings, seconds: number) => {
    const r = await page.evaluate((job) => window.__h.render(job), { notes, base: [BASE, 1], seconds, sampleRate: SR, settings, volume: VOLUME });
    const left = decode(r.pcm[0]), right = decode(r.pcm[1]);
    out[key] = { hash: sha(r.pcm), sources: r.sources, left, right, rms: rmsOf(left), list: r.list.map(oldFields), handed: r.handed };
  };
  for (const instrument of instruments) {
    for (const [chain, settings] of Object.entries(CHAINS)) await run(`${instrument} / figure / ${chain}`, FIGURE(instrument), settings, 2.4);
    for (const note of FIGURE(instrument)) {
      await run(`${instrument} / note ${note.id} alone`, [{ ...note, start: [0, 1] }], DRY, note.dur[0] / note.dur[1] + 0.4);
    }
  }
  return out;
}
// The largest difference between two renders, as a fraction of full scale.
function apart(a: Figure, b: Figure) {
  let worst = 0;
  for (const ch of ['left', 'right'] as const) {
    if (a[ch].length !== b[ch].length) return Infinity;
    for (let i = 0; i < a[ch].length; i++) { const d = Math.abs(a[ch][i] - b[ch][i]); if (d > worst) worst = d; }
  }
  return worst;
}

const dyad = (instrument: string, p: number, q: number|undefined) => [
  { id: 1, instrument, freq: hz(1), start: [0, 1], dur: [2, 1] },
  { id: 2, instrument, freq: hz(p, q), start: [0, 1], dur: [2, 1] },
];
const renderMono = async (page: Page, notes: Tone[], settings: Settings, seconds = 2.3) => {
  const r = await page.evaluate((job) => window.__h.render(job), { notes, base: [BASE, 1], seconds, sampleRate: SR, settings, volume: VOLUME, mono: true });
  return { ...r, x: decode(r.pcm[0]) };
};
const WIN = 8 / BASE;   // eight periods of the lower note: the partials of 5/4, 3/2, 7/4 and 11/8 all fall on its nulls
// The stretch of a two-second note through which an instrument holds one level, in seconds from the note's start.
// Read off the instrument's own gain curve (attack and decay over, release not begun) and pulled in by half an
// analysis window at each end, so that what is measured there is the sound and not the envelope.
const heldCache = new Map<string, [number, number]>();
async function heldOf(page: Page, instrument: string) {
  if (!heldCache.has(instrument)) {
    const e = await page.evaluate((job) => window.__h.envelope(job), { instrument, dur: 2, sampleRate: SR });
    const g = decode(e.pcm), mid = Math.round((e.start + 1) * SR), level = g[mid];
    let a = mid, b = mid;
    while (a > 0 && Math.abs(g[a - 1] - level) <= 1e-6 * level) a--;
    while (b < g.length - 1 && Math.abs(g[b + 1] - level) <= 1e-6 * level) b++;
    heldCache.set(instrument, [a / SR - e.start + WIN / 2 + 0.005, b / SR - e.start - WIN / 2 - 0.005]);
  }
  return heldCache.get(instrument)!;
}
const span = async (page: Page, instrument: string, t0: number): Promise<[number, number]> => {
  const [start, end] = await heldOf(page, instrument);
  return [start + t0, end + t0];
};

// ───────────────────────────────────── run ─────────────────────────────────────

const browser = await launch();
console.log(`\ncheck-purity — ${browser.browserType().name()} ${browser.version()}, ${SR} Hz, BaseNote ${BASE} Hz\n`);
const report: Record<string, unknown> = { browser: browser.version(), sampleRate: SR, base: BASE };
const work = await openHarness(browser, fromDisk(ROOT));
const registered = (await work.page.evaluate((job) => window.__h.render(job), {
  notes: [{ id: 1, instrument: 'sine-wave', freq: hz(1), start: [0, 1], dur: [1, 10] }], base: [BASE, 1], seconds: 0.3, sampleRate: SR, settings: DRY,
})).registered;
console.log(`  instruments registered: ${registered.join(', ')}\n`);
report.registered = registered;

// ── UNCHANGED ──────────────────────────────────────────────────────────────────
if (COMPARE) {
  const source = fromGit(COMPARE);
  console.log(`UNCHANGED — against ${source.label}`);
  const then = await openHarness(browser, source);
  const thenRegistered = (await then.page.evaluate((job) => window.__h.render(job), {
    notes: [{ id: 1, instrument: 'sine-wave', freq: hz(1), start: [0, 1], dur: [1, 10] }], base: [BASE, 1], seconds: 0.3, sampleRate: SR, settings: DRY,
  })).registered;
  const before = await renderFigures(then.page, thenRegistered);
  const after = await renderFigures(work.page, thenRegistered);
  // The yardstick: the working tree against itself. Whatever that shows is the browser's rounding, not the code.
  const again = await renderFigures(work.page, thenRegistered);
  check(`no page errors or warnings from ${COMPARE}`, then.problems.length === 0, then.problems.slice(0, 3).join(' | '));
  await then.close();

  const keys = Object.keys(before);
  const solo = keys.filter((k) => k.endsWith('alone') && before[k].sources === 1 && after[k].sources === 1);
  const soloSame = solo.filter((k) => before[k].hash === after[k].hash);
  const gap = Object.fromEntries(keys.map((k) => [k, apart(before[k], after[k])]));
  const selfGap = Math.max(...keys.map((k) => apart(after[k], again[k])));
  const worst = keys.reduce((w, k) => (gap[k] > gap[w] ? k : w), keys[0]);
  const within = keys.filter((k) => gap[k] <= TOLERANCE);
  const identical = keys.filter((k) => before[k].hash === after[k].hash);
  const silent = keys.filter((k) => !(before[k].rms > 1e-4));
  const lists = keys.filter((k) => JSON.stringify(before[k].list) === JSON.stringify(after[k].list));
  const handedSame = keys.filter((k) => JSON.stringify(before[k].handed) === JSON.stringify(after[k].handed));
  const dbfs = (v: number) => (v > 0 ? `${db(v).toFixed(0)} dBFS` : 'nothing');

  check('no render is silent', silent.length === 0, silent.length ? `silent: ${silent.join(', ')}` : `${keys.length} renders, quietest ${db(Math.min(...keys.map((k) => before[k].rms))).toFixed(1)} dBFS rms`);
  check('single notes of single-source instruments: bit-identical', soloSame.length === solo.length,
    `${soloSame.length}/${solo.length}${soloSame.length === solo.length ? '' : ` — differ: ${solo.filter((k) => !soloSame.includes(k)).join('; ')}`}`);
  check(`every render of every instrument of ${COMPARE}: the same to within rounding`, within.length === keys.length,
    `${within.length}/${keys.length} within ${TOLERANCE} of full scale, ${identical.length} of them bit-identical; largest difference ${gap[worst].toExponential(1)} (${dbfs(gap[worst])}, ${worst}); the working tree against itself: ${selfGap.toExponential(1)} (${dbfs(selfGap)})`);
  check('note lists agree in every field that existed', lists.length === keys.length, `${lists.length}/${keys.length}`);
  check('the instruments are handed the same frequencies', handedSame.length === keys.length, `${handedSame.length}/${keys.length}`);
  report.unchanged = {
    against: source.label, instruments: thenRegistered, renders: keys.length, tolerance: TOLERANCE,
    bitIdentical: identical.length, singleNotesBitIdentical: `${soloSame.length}/${solo.length}`,
    largestDifference: gap[worst], largestDifferenceIn: worst, workingTreeAgainstItself: selfGap,
    perRender: Object.fromEntries(keys.map((k) => [k, { difference: gap[k], bitIdentical: before[k].hash === after[k].hash }])),
  };
  console.log('');
}

// ── TEMPERED ───────────────────────────────────────────────────────────────────
const SWITCH = 'audio.tempered.enabled';
{
  console.log('TEMPERED — what the switch hands the instruments');
  const ratios = [[1, 1], [81, 80], [16, 15], [10, 9], [9, 8], [6, 5], [5, 4], [4, 3], [11, 8], [45, 32], [3, 2], [8, 5], [13, 8], [5, 3], [7, 4], [16, 9], [15, 8], [2, 1], [3, 1], [1, 2], [2, 3], [4, 5], [1, 4]];
  const notes = ratios.map(([p, q], i) => ({ id: i + 1, instrument: 'sine-wave', freq: hz(p, q), start: [0, 1], dur: [1, 10] }));
  const off = await renderMono(work.page, notes, DRY, 0.4);
  const on = await renderMono(work.page, notes, { ...DRY, [SWITCH]: true }, 0.4);
  const exists = on.applied[SWITCH] === true;
  check('the setting exists and holds', exists, `audio.tempered.enabled reads back ${JSON.stringify(on.applied[SWITCH])}`);
  if (exists) {
    // The engine schedules in list order and asks the instrument manager for one voice per note.
    const handedTo = (r: Render) => new Map(r.list.map((n, i: number) => [n.id, r.handed[i][1]]));
    const offHz = handedTo(off), onHz = handedTo(on);
    const pure = (p: number, q: number) => (BASE * p) / q;
    const idOf = (p: number, q: number) => ratios.findIndex(([a, b]) => a === p && b === q) + 1;
    const at = (p: number, q: number) => onHz.get(idOf(p, q))!;
    const worstOff = Math.max(...ratios.map(([p, q]) => Math.abs(offHz.get(idOf(p, q))! - pure(p, q))));
    const worstOn = Math.max(...ratios.map(([p, q]) => Math.abs(at(p, q) / keyOf(pure(p, q), BASE) - 1)));
    check('off: the frequencies of the module, untouched', worstOff === 0, `${ratios.length} ratios, largest difference ${worstOff} Hz`);
    check('on: the nearest of 12 equal steps from the BaseNote', worstOn < 1e-12, `${ratios.length} ratios, largest relative difference ${worstOn.toExponential(1)}`);
    check('on: the BaseNote and its octaves do not move', at(1, 1) === BASE && at(2, 1) === 2 * BASE && at(1, 2) === BASE / 2 && at(1, 4) === BASE / 4);
    check('on: two notes a comma apart land on one key', at(10, 9) === at(9, 8) && at(81, 80) === BASE, `10/9 and 9/8 → ${at(9, 8).toFixed(3)} Hz; 81/80 → ${at(81, 80)} Hz`);
    const fields = (r: Render) => JSON.stringify(r.list.map(({ id, startTime, duration, frequency, instrument, panPos }) => ({ id, startTime, duration, frequency, instrument, panPos })));
    check('on: nothing else in the note list changes', fields(on) === fields(off), 'start, duration, frequency, instrument and pan position are the same either way');
    const cents = (p: number, q: number) => 1200 * Math.log2(at(p, q) / pure(p, q));
    report.tempered = Object.fromEntries(ratios.map(([p, q]) => [`${p}/${q}`, { pure: pure(p, q), tempered: at(p, q), cents: cents(p, q) }]));
    console.log(`     ${[[5, 4], [3, 2], [7, 4], [11, 8]].map(([p, q]) => `${p}/${q}: ${pure(p, q).toFixed(3)} → ${at(p, q).toFixed(3)} Hz (${cents(p, q) >= 0 ? '+' : ''}${cents(p, q).toFixed(1)} c)`).join(';  ')}`);
  }
  console.log('');
}

// ── VOICES ─────────────────────────────────────────────────────────────────────
const voices = NEW_VOICES.filter((v) => registered.includes(v));
const spectra: Record<string, { mean: number; p2t: number }[]> = {};   // voice → amplitude of partial k (1-based index) for one note at the BaseNote
{
  console.log('VOICES — one note, dry');
  check('the harmonium voices are registered', voices.length === NEW_VOICES.length, `found: ${voices.join(', ') || 'none'}`);

  // Levels of every instrument, for balance: one two-second note at the BaseNote through the dry chain, read
  // where the instrument holds its level.
  const levels: Record<string, unknown> = {}; report.levels = levels;
  console.log(`     one held note at ${BASE} Hz (dBFS):      peak       rms   A-weighted   crest   held for`);
  for (const v of registered) {
    const r = await renderMono(work.page, [{ id: 1, instrument: v, freq: hz(1), start: [0, 1], dur: [2, 1] }], DRY);
    const during = await span(work.page, v, r.t0);
    const [a, b] = during.map((t: number) => Math.round(t * SR));
    const rms = rmsOf(r.x, a, b), peak = peakOf(r.x.subarray(a, b)), loud = aWeightedDb(r.x, a, b);
    levels[v] = { peak: db(peak), rms: db(rms), aWeighted: loud, heldSec: during[1] - during[0] };
    console.log(`       ${v.padEnd(34)}${db(peak).toFixed(1).padStart(6)}    ${db(rms).toFixed(1).padStart(6)}    ${loud.toFixed(1).padStart(8)}   ${db(peak / rms).toFixed(1).padStart(5)}    ${(during[1] - during[0]).toFixed(2)} s`);
    if ([...voices, ...CONTEXT_VOICES, ...SPECTRUM_VOICES].includes(v)) {
      const amps = [];
      for (let k = 1; k <= 20; k++) {
        if (k * BASE > SR / 2 - 500) { amps.push({ mean: 0, p2t: 0 }); continue; }
        amps.push(swing(bandEnvelope(r.x, SR, k * BASE, WIN, 0.004), ...during));
      }
      spectra[v] = amps;
    }
  }
  // The voices they are measured against: which partials each has at all (— is more than 90 dB under the first),
  // and how far the least steady of them swings while one note is held.
  console.log('\n     the other synth voices: partials 1…12 in dB re the fundamental, and the largest swing of any of them through one held note');
  const context: Record<string, unknown> = {}; report.context = context;
  for (const v of SPECTRUM_VOICES.filter((name) => spectra[name])) {
    const a1 = spectra[v][0].mean;
    const rel = spectra[v].slice(0, 12).map((s) => (s.mean > a1 * 10 ** (-90 / 20) ? db(s.mean / a1) : null));
    const wobble = Math.max(...spectra[v].slice(0, 12).filter((s, i: number) => rel[i] != null).map((s) => s.p2t));
    context[v] = { partialsDb: rel, largestPartialSwingDb: wobble };
    console.log(`       ${v.padEnd(15)} ${rel.map((d: number|null, i: number) => `${i + 1}:${d == null ? '—' : d.toFixed(0)}`).join('  ')}   swing ${wobble.toFixed(wobble < 0.1 ? 4 : 1)} dB`);
  }

  const measuredVoices: Record<string, unknown> = {}; report.voices = measuredVoices;
  for (const v of voices) {
    const amps = spectra[v], a1 = amps[0].mean;
    const rel = amps.map((s) => (s.mean > 0 ? db(s.mean / a1) : -Infinity));
    const declared = await work.page.evaluate((name) => window.__h.describe(name), v);
    console.log(`\n     ${v}: partial levels re the fundamental (dB)`);
    console.log(`       ${rel.slice(0, 16).map((d: number, i: number) => `${i + 1}:${d.toFixed(1)}`).join('  ')}`);
    check(`${v}: partials 1…16 all sound`, rel.slice(0, 16).every((d: number) => d > -50), `weakest ${Math.min(...rel.slice(0, 16)).toFixed(1)} dB`);
    check(`${v}: nothing above the 16th`, rel.slice(16).every((d: number) => d < -90), `partials 17…20 at most ${Math.max(...rel.slice(16)).toFixed(0)} dB`);
    const wobble = Math.max(...amps.slice(0, 16).map((s) => s.p2t));
    check(`${v}: every partial stands still (no detune, no vibrato)`, wobble < 0.01, `largest swing of any partial through the held note ${wobble.toFixed(5)} dB`);
    if (declared && declared.partials) {
      const want = declared.partials.map((a: number) => db(a / declared.partials![0]));
      const off = Math.max(...want.map((d: number, i: number) => Math.abs(d - rel[i])));
      check(`${v}: the spectrum is the one the source declares`, off < 0.05, `largest difference ${off.toFixed(4)} dB over ${want.length} partials`);
    }
    // Three octaves up, only eleven partials fit under half the sample rate. The rest must be dropped, not
    // folded back into the sound.
    const high = await renderMono(work.page, [{ id: 1, instrument: v, freq: hz(8), start: [0, 1], dur: [1, 1] }], DRY, 1.3);
    const stray = strayDb(high.x, Math.round((high.t0 + 0.15) * SR), 32768, 8 * BASE);
    check(`${v}: nothing folds back at ${8 * BASE} Hz (no aliasing)`, stray < -80, `strongest component that is not a partial: ${stray.toFixed(0)} dB re the strongest partial`);

    // The envelope: a constant through it, at three note lengths.
    const times: {dur: number; attack: number; release: number; top: number; heldFor: number}[] = [];
    for (const dur of [0.25, 1, 4]) {
      const e = await work.page.evaluate((job) => window.__h.envelope(job), { instrument: v, dur, sampleRate: SR });
      const g = decode(e.pcm), s0 = Math.round(e.start * SR), top = peakOf(g);
      let up = s0; while (up < g.length && g[up] < 0.999 * top) up++;
      let down = g.length - 1; while (down > 0 && g[down] < 0.999 * top) down--;
      // The release is an exponential ramp to the envelope's floor (0.0001), which it reaches at the note's end.
      let floor = down; while (floor < g.length && g[floor] > 1.001e-4) floor++;
      times.push({ dur, attack: (up - s0) / SR, release: (floor - down) / SR, top, heldFor: (down - up) / SR });
    }
    const spread = (key: 'attack' | 'release') => Math.max(...times.map((t) => t[key])) - Math.min(...times.map((t) => t[key]));
    console.log(`     ${v}: envelope  ${times.map((t) => `${t.dur} s note → attack ${(t.attack * 1000).toFixed(1)} ms, release ${(t.release * 1000).toFixed(1)} ms`).join(';  ')}`);
    check(`${v}: attack and release are fixed times, not fractions of the note`, spread('attack') < 0.001 && spread('release') < 0.001,
      `spread over 0.25 s, 1 s and 4 s notes: attack ${(spread('attack') * 1000).toFixed(2)} ms, release ${(spread('release') * 1000).toFixed(2)} ms`);
    if (declared && declared.attackSec != null && declared.releaseSec != null) {
      check(`${v}: they are the times the source declares`, Math.abs(times[1].attack - declared.attackSec) < 0.001 && Math.abs(times[1].release - declared.releaseSec) < 0.002,
        `declared ${declared.attackSec * 1000} ms / ${declared.releaseSec * 1000} ms`);
    }
    measuredVoices[v] = { partialsDb: rel, largestPartialSwingDb: wobble, strayAtHighPitchDb: stray, envelope: times, declared };
  }
  console.log('');
}

// Whether this tree has the switch at all (a tree from before it renders the same with or without).
const canTemper = registered.includes('sine-wave') && (await renderMono(work.page, dyad('sine-wave', 5, 4), { ...DRY, [SWITCH]: true }, 0.3)).applied[SWITCH] === true;

// ── PURITY ─────────────────────────────────────────────────────────────────────
{
  console.log(`PURITY — two notes held for two seconds; the band where partial p of the lower meets partial q of the upper`);
  console.log(`         swing = highest over lowest amplitude of that band while the notes are held (dB); level re full scale\n`);
  const purity: Record<string, Record<string, { band: number; pureSwingDb: number | null; pureLevelDb: number | null; temperedSwingDb: number | null; beatHz: number; predictedSwingDb: number | null; lowerHas: boolean; upperHas: boolean }>> = {};
  report.purity = purity;
  const row = (cells: string[]) => console.log(`     ${cells[0].padEnd(16)}${cells[1].padEnd(24)}${cells[2].padStart(11)}${cells[3].padStart(13)}${cells[4].padStart(12)}${cells[5].padStart(13)}`);
  row(['voice', 'interval (band)', 'pure swing', 'pure level', 'temp. swing', 'beat']);
  const present = (v: string) => registered.includes(v);
  for (const v of [...CONTEXT_VOICES.filter(present), ...voices]) {
    purity[v] = {};
    for (const [p, q, name] of INTERVALS) {
      const f1 = BASE, fPure = (BASE * p) / q, fKey = keyOf(fPure, BASE);
      const pure = await renderMono(work.page, dyad(v, p, q), DRY);
      const during = await span(work.page, v, pure.t0);
      const meet = p * f1;                                   // = q · fPure
      const sPure = swing(bandEnvelope(pure.x, SR, meet, WIN), ...during);
      const audible = sPure.mean > 1e-5;                     // below −100 dBFS there is no partial there to speak of
      let sKey = null;
      if (canTemper) {
        const key = await renderMono(work.page, dyad(v, p, q), { ...DRY, [SWITCH]: true });
        sKey = swing(bandEnvelope(key.x, SR, (p * f1 + q * fKey) / 2, WIN), ...during);
        if (WAV && voices.includes(v) && p === 5) {
          writeWav(join(OUT, `${v}-third-pure.wav`), pure.x, SR);
          writeWav(join(OUT, `${v}-third-tempered.wav`), key.x, SR);
        }
      }
      const beat = Math.abs(p * f1 - q * fKey);
      // What the spectrum of one note predicts for the beat between the two partials.
      const ap = spectra[v] ? spectra[v][p - 1].mean : 0, aq = spectra[v] ? spectra[v][q - 1].mean : 0;
      const predicted = ap > 1e-5 && aq > 1e-5 ? db((ap + aq) / Math.abs(ap - aq)) : null;
      purity[v][`${p}/${q}`] = { band: meet, pureSwingDb: audible ? sPure.p2t : null, pureLevelDb: audible ? db(sPure.mean) : null,
        temperedSwingDb: sKey && sKey.mean > 1e-5 ? sKey.p2t : null, beatHz: beat, predictedSwingDb: predicted, lowerHas: ap > 1e-5, upperHas: aq > 1e-5 };
      row([v, `${p}/${q} ${name.split(' ').pop()} (${meet} Hz)`,
        audible ? `${sPure.p2t.toFixed(3)} dB` : '—',
        audible ? `${db(sPure.mean).toFixed(1)} dB` : 'no partial',
        sKey && sKey.mean > 1e-5 ? `${sKey.p2t.toFixed(1)} dB` : '—',
        `${beat.toFixed(1)} Hz`]);
    }
  }
  console.log('\n     "no partial": sine-wave has nothing in these bands for this measure to read. That is the measure\'s limit,');
  console.log('     not a finding about the sound; what the signal of a sine chord does show is under SINES.\n');
  for (const v of voices) {
    const third = purity[v]['5/4'];
    check(`${v}: a pure major third stands still`, third.pureSwingDb != null && third.pureSwingDb < 0.05, `${third.pureSwingDb?.toFixed(4)} dB of swing in the band at ${third.band} Hz`);
    if (canTemper) {
      check(`${v}: the tempered major third beats`, (third.temperedSwingDb ?? 0) > 6, `${third.temperedSwingDb?.toFixed(1)} dB of swing, ${third.beatHz.toFixed(2)} times a second (the spectrum predicts ${third.predictedSwingDb?.toFixed(1)} dB)`);
      for (const [p, q] of [[7, 4], [11, 8]]) {
        const r = purity[v][`${p}/${q}`];
        check(`${v}: ${p}/${q} has partials to meet`, r.lowerHas && r.upperHas && r.pureSwingDb != null && r.pureSwingDb < 0.05 && (r.temperedSwingDb ?? 0) > 3, `pure ${r.pureSwingDb?.toFixed(4)} dB, tempered ${r.temperedSwingDb?.toFixed(1)} dB`);
      }
    }
  }

  // The same third through the chain a listener has by default: reverb at 25 %, limiter on.
  if (canTemper && voices.length) {
    console.log('\n     the major third through the default chain (reverb 25 %, limiter on):');
    const purityDefaultChain: Record<string, unknown> = {}; report.purityDefaultChain = purityDefaultChain;
    for (const v of voices) {
      const pure = await renderMono(work.page, dyad(v, 5, 4), {});
      const key = await renderMono(work.page, dyad(v, 5, 4), { [SWITCH]: true });
      // The room is still filling for the first second of a held note, so read the second second.
      const later: [number, number] = [pure.t0 + 1.0, pure.t0 + 1.75];
      const a = swing(bandEnvelope(pure.x, SR, 5 * BASE, WIN), ...later);
      const b = swing(bandEnvelope(key.x, SR, (5 * BASE + 4 * keyOf((BASE * 5) / 4, BASE)) / 2, WIN), ...later);
      purityDefaultChain[v] = { pureSwingDb: a.p2t, temperedSwingDb: b.p2t };
      console.log(`       ${v.padEnd(16)} pure ${a.p2t.toFixed(2)} dB   tempered ${b.p2t.toFixed(1)} dB`);
    }
  }
  console.log('');
}

// ── SINES ──────────────────────────────────────────────────────────────────────
// Reported, not judged. What tells a pure chord of sines from a tempered one is, for a listener, the pitches and
// the difference tones the ear adds; neither is an envelope in the signal. So little shows here, and nothing here
// is evidence that the two sound alike.
if (registered.includes('sine-wave')) {
  console.log('SINES — the same switch on sine-wave, where no two partials meet (reported, not judged)');
  const triad = [[1, 1], [5, 4], [3, 2]].map(([p, q], i) => ({ id: i + 1, instrument: 'sine-wave', freq: hz(p, q), start: [0, 1], dur: [2, 1] }));
  const pure = await renderMono(work.page, triad, DRY);
  const key = canTemper ? await renderMono(work.page, triad, { ...DRY, [SWITCH]: true }) : null;
  const during = await span(work.page, 'sine-wave', pure.t0);
  // One period of the pure chord at a time: 4:5:6 repeats every four cycles of its root. That is not a whole
  // number of samples, so the level counts the last sample by the fraction of it that belongs to the period.
  const exact = (4 / BASE) * SR, whole = Math.floor(exact), part = exact - whole, period = whole + 1;
  const follow = (x: Float32Array, peak: boolean) => {
    const t = [], a = [];
    for (let i0 = 0; i0 + period <= x.length; i0 += 48) {
      t.push((i0 + period / 2) / SR);
      if (peak) { a.push(peakOf(x.subarray(i0, i0 + period))); continue; }
      let s = part * x[i0 + whole] * x[i0 + whole];
      for (let i = 0; i < whole; i++) s += x[i0 + i] * x[i0 + i];
      a.push(Math.sqrt(s / exact));
    }
    return { t, a };
  };
  const read = (r: Awaited<ReturnType<typeof renderMono>>) => {
    const [c, e, g] = r.handed.map(([, f]) => f);
    return { handed: [c, e, g], level: swing(follow(r.x, false), ...during).p2t, peak: swing(follow(r.x, true), ...during).p2t, tones: [e - c, g - e] };
  };
  const a = read(pure), b = key ? read(key) : null;
  const cents = (f: number, ref: number) => 1200 * Math.log2(f / ref);
  const line = (label: string, left: string, right: string) => console.log(`       ${label.padEnd(46)}${left.padEnd(30)}${right}`);
  console.log(`     a major triad 4:5:6 on ${BASE} Hz, held two seconds, dry`);
  line('', 'pure', b ? 'tempered' : '');
  line('handed to the oscillators (Hz)', a.handed.map((f) => +f.toFixed(3)).join(' / '), b ? b.handed.map((f) => +f.toFixed(3)).join(' / ') : '');
  line('level, one period of the chord at a time', `moves ${a.level.toFixed(3)} dB`, b ? `moves ${b.level.toFixed(3)} dB` : '');
  line('waveform peak, likewise', `moves ${a.peak.toFixed(3)} dB`, b ? `moves ${b.peak.toFixed(2)} dB` : '');
  line('difference tones E−C and G−E (arithmetic)', `${a.tones.map((f) => f.toFixed(2)).join(' and ')} Hz`,
    b ? `${b.tones.map((f) => f.toFixed(2)).join(' and ')} Hz, ${Math.abs(b.tones[0] - b.tones[1]).toFixed(2)} Hz apart` : '');
  if (b) {
    const signed = (c: number) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(1)} c`;
    console.log(`     What differs in the signal: the pitches (third ${signed(cents(b.handed[1], a.handed[1]))}, fifth ${signed(cents(b.handed[2], a.handed[2]))}) and the waveform. In the pure`);
    console.log(`     chord it repeats exactly, so its peak holds; in the tempered one its shape keeps changing and its peak moves`);
    console.log(`     ${b.peak.toFixed(1)} dB, while the level of the chord stays within ${Math.max(a.level, b.level).toFixed(1)} dB either way. The difference tones are made by the`);
    console.log('     ear, not by the signal, so this script cannot render them: by arithmetic they coincide in the pure chord and');
    console.log('     lie that far apart, and beat, in the tempered one. None of this says the two sound alike on sines.');
    if (WAV && key) {
      writeWav(join(OUT, 'sine-wave-triad-pure.wav'), pure.x, SR);
      writeWav(join(OUT, 'sine-wave-triad-tempered.wav'), key.x, SR);
    }
  }
  report.sines = { pure: a, tempered: b };
  console.log('');
}

check('no page errors', work.problems.length === 0, work.problems.slice(0, 3).join(' | '));
await work.close();
await browser.close();

const failed = checks.filter((c) => !c.pass);
report.checks = checks;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} passed. Report in ${join(OUT, 'report.json')}${WAV ? `, .wav files beside it` : ''}`);
process.exit(failed.length ? 1 : 0);
